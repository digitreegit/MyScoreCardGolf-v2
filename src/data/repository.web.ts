// Web repository: no local database — the web app requires sign-in and works online.
// Writes go through the same sync_push RPC as the phone, so last-write-wins rules are identical.

import { nowIso, type FairwayResult, type Round, type RoundHole, type RoundWithHoles } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';

import { emitDataChanged } from './events';

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
  return data ? toItem(data as RoundRow) : null;
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

export async function updateRound(round: Round, patch: Partial<Round>): Promise<Round> {
  const next = { ...round, ...patch, updated_at: nowIso() };
  await push([next], []);
  return next;
}

export async function updateHole(hole: RoundHole, patch: Partial<RoundHole>): Promise<RoundHole> {
  const next = { ...hole, ...patch, updated_at: nowIso() };
  await push([], [next]);
  return next;
}

export async function deleteRound(round: Round): Promise<void> {
  const at = nowIso();
  await push([{ ...round, deleted_at: at, updated_at: at }], []);
}
