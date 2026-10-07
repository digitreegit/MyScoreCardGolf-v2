// Native repository: reads/writes the local SQLite database, then nudges the sync engine.
// The web build resolves ./repository.web.ts instead (same exports, talks to Supabase directly).

import { nowIso, type Round, type RoundHole, type RoundWithHoles } from '@/domain/types';

import { emitDataChanged } from './events';
import * as db from './local/db';
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

export async function updateRound(round: Round, patch: Partial<Round>): Promise<Round> {
  const next = { ...round, ...patch, updated_at: nowIso() };
  await db.writeRound(next);
  changed();
  return next;
}

export async function updateHole(hole: RoundHole, patch: Partial<RoundHole>): Promise<RoundHole> {
  const next = { ...hole, ...patch, updated_at: nowIso() };
  await db.writeHole(next);
  changed();
  return next;
}

export async function deleteRound(round: Round): Promise<void> {
  const at = nowIso();
  await db.writeRound({ ...round, deleted_at: at, updated_at: at });
  changed();
}
