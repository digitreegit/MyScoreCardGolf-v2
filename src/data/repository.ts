// Native repository: reads/writes the local SQLite database, then nudges the sync engine.
// The web build resolves ./repository.web.ts instead (same exports, talks to Supabase directly).

import { nowIso, type Round, type RoundHole, type RoundWithHoles } from '@/domain/types';

import { emitDataChanged } from './events';
import * as db from './local/db';
import { serial } from './serial';
import { requestSync } from './sync/syncEngine';

function changed() {
  emitDataChanged();
  requestSync();
}

export async function listRounds(): Promise<RoundWithHoles[]> {
  return db.selectRounds();
}

export async function getRound(id: string): Promise<RoundWithHoles | null> {
  return db.selectRound(id);
}

export async function saveRounds(items: RoundWithHoles[]): Promise<void> {
  await db.writeRoundWithHoles(items);
  changed();
}

/** Applies `patch` to the latest stored round; `round` only identifies the row. */
export function updateRound(round: Round, patch: Partial<Round>): Promise<Round> {
  return serial(async () => {
    const latest = (await db.selectRound(round.id))?.round ?? round;
    const next = { ...latest, ...patch, updated_at: nowIso() };
    await db.writeRound(next);
    changed();
    return next;
  });
}

/** Applies `patch` to the latest stored hole; `hole` only identifies the row. */
export function updateHole(hole: RoundHole, patch: Partial<RoundHole>): Promise<RoundHole> {
  return serial(async () => {
    const latest = (await db.selectHole(hole.round_id, hole.hole_number)) ?? hole;
    const next = { ...latest, ...patch, updated_at: nowIso() };
    await db.writeHole(next);
    changed();
    return next;
  });
}

export async function deleteRound(round: Round): Promise<void> {
  const at = nowIso();
  await db.writeRound({ ...round, deleted_at: at, updated_at: at });
  changed();
}
