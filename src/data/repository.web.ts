// Web repository: no local database — the web app requires sign-in and works online.
// Writes go through the same sync_push RPC as the phone, so last-write-wins rules are identical.

import { nowIso, type FairwayResult, type Round, type RoundHole, type RoundWithHoles } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';

import { emitDataChanged } from './events';
import { serial } from './serial';

type RoundRow = Round & { server_updated_at?: string; round_holes?: RoundHole[] };

const stripRound = ({ user_id: _u, ...r }: Round) => r;
const stripHole = ({ user_id: _u, ...h }: RoundHole) => h;

async function push(rounds: Round[], holes: RoundHole[]): Promise<void> {
  const { error } = await getSupabase().rpc('sync_push', {
    p_rounds: rounds.map(stripRound),
    p_holes: holes.map(stripHole),
  });
  if (error) throw error;
  emitDataChanged();
}

function toItem(row: RoundRow): RoundWithHoles {
  const { round_holes, server_updated_at: _s, ...round } = row;
  const holes = (round_holes ?? [])
    .map(({ server_updated_at: _hs, ...h }: RoundHole & { server_updated_at?: string }) => ({
      ...h,
      fairway: h.fairway as FairwayResult | null,
    }))
    .sort((a, b) => a.hole_number - b.hole_number);
  return { round: { ...round, holes_count: round.holes_count === 9 ? 9 : 18 }, holes };
}

export async function listRounds(): Promise<RoundWithHoles[]> {
  const { data, error } = await getSupabase()
    .from('rounds')
    .select('*, round_holes(*)')
    .is('deleted_at', null)
    .order('played_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as RoundRow[]).map(toItem);
}

export async function getRound(id: string): Promise<RoundWithHoles | null> {
  const { data, error } = await getSupabase().from('rounds').select('*, round_holes(*)').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const item = toItem(data as RoundRow);
  remember(item);
  return item;
}

export async function saveRounds(items: RoundWithHoles[]): Promise<void> {
  // Chunk large spreadsheet imports to keep each RPC payload small.
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    await push(
      chunk.map((c) => c.round),
      chunk.flatMap((c) => c.holes),
    );
  }
}

// Web keeps the last written row per key so rapid edits build on each other, not on a stale snapshot.
const lastRound = new Map<string, Round>();
const lastHole = new Map<string, RoundHole>();
const holeKey = (h: RoundHole) => `${h.round_id}:${h.hole_number}`;

/** Server rows newer than our last write (e.g. edited on the phone) replace the cached copy. */
function remember({ round, holes }: RoundWithHoles) {
  const r = lastRound.get(round.id);
  if (!r || new Date(round.updated_at) >= new Date(r.updated_at)) lastRound.set(round.id, round);
  for (const h of holes) {
    const c = lastHole.get(holeKey(h));
    if (!c || new Date(h.updated_at) >= new Date(c.updated_at)) lastHole.set(holeKey(h), h);
  }
}

export function updateRound(round: Round, patch: Partial<Round>): Promise<Round> {
  return serial(async () => {
    const base = lastRound.get(round.id) ?? round;
    const next = { ...base, ...patch, updated_at: nowIso() };
    await push([next], []);
    lastRound.set(round.id, next);
    return next;
  });
}

export function updateHole(hole: RoundHole, patch: Partial<RoundHole>): Promise<RoundHole> {
  return serial(async () => {
    const base = lastHole.get(holeKey(hole)) ?? hole;
    const next = { ...base, ...patch, updated_at: nowIso() };
    await push([], [next]);
    lastHole.set(holeKey(hole), next);
    return next;
  });
}

export async function deleteRound(round: Round): Promise<void> {
  const at = nowIso();
  await push([{ ...round, deleted_at: at, updated_at: at }], []);
}
