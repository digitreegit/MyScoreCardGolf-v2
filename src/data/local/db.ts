// Native-only local database (expo-sqlite). This is the source of truth on the phone:
// every edit lands here first with dirty = 1, and the sync engine pushes it later.
// Never import this file from *.web.ts code.

import * as SQLite from 'expo-sqlite';

import type { FairwayResult, Round, RoundHole, RoundWithHoles } from '@/domain/types';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE rounds (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    course_id TEXT,
    course_name TEXT NOT NULL,
    tee_box TEXT,
    companions TEXT NOT NULL DEFAULT '',
    played_on TEXT NOT NULL,
    holes_count INTEGER NOT NULL,
    entry_mode TEXT NOT NULL,
    exclude_from_stats INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX rounds_played_on ON rounds (played_on DESC);
  CREATE TABLE round_holes (
    round_id TEXT NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
    user_id TEXT,
    hole_number INTEGER NOT NULL,
    par INTEGER NOT NULL,
    strokes INTEGER,
    putts INTEGER,
    fairway TEXT,
    penalties INTEGER,
    updated_at TEXT NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (round_id, hole_number)
  );
  CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  -- Downloaded course geometry, cached so GPS works without signal on the course.
  CREATE TABLE course_cache (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, downloaded_at TEXT NOT NULL);
  `,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// All writes go through one queue. Exclusive transactions use their own connection, so a sync
// pass writing while the user taps a score failed with "database is locked" (SQLITE_BUSY).
let writeTail: Promise<unknown> = Promise.resolve();
function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = writeTail.then(task, task);
  writeTail = run.catch(() => undefined);
  return run;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('myscorecard.db');
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      let version = row?.user_version ?? 0;
      while (version < MIGRATIONS.length) {
        await db.withExclusiveTransactionAsync(async (tx) => {
          await tx.execAsync(MIGRATIONS[version]);
          await tx.execAsync(`PRAGMA user_version = ${version + 1}`);
        });
        version += 1;
      }
      return db;
    })();
  }
  return dbPromise;
}

// ───────────────────────────── row mapping

interface RoundRow extends Omit<Round, 'exclude_from_stats' | 'holes_count'> {
  exclude_from_stats: number;
  holes_count: number;
  dirty: number;
}
interface HoleRow extends Omit<RoundHole, 'fairway'> {
  fairway: string | null;
  dirty: number;
}

const toRound = ({ dirty: _d, ...r }: RoundRow): Round => ({
  ...r,
  holes_count: r.holes_count === 9 ? 9 : 18,
  exclude_from_stats: r.exclude_from_stats === 1,
});
const toHole = ({ dirty: _d, ...h }: HoleRow): RoundHole => ({ ...h, fairway: h.fairway as FairwayResult | null });

const ROUND_COLS = [
  'id', 'user_id', 'course_id', 'course_name', 'tee_box', 'companions', 'played_on', 'holes_count', 'entry_mode',
  'exclude_from_stats', 'notes', 'source', 'created_at', 'updated_at', 'deleted_at',
] as const;
const HOLE_COLS = [
  'round_id', 'user_id', 'hole_number', 'par', 'strokes', 'putts', 'fairway', 'penalties', 'updated_at',
] as const;

const roundParams = (r: Round) =>
  ROUND_COLS.map((c) => (c === 'exclude_from_stats' ? (r.exclude_from_stats ? 1 : 0) : (r[c] ?? null)));
const holeParams = (h: RoundHole) => HOLE_COLS.map((c) => h[c] ?? null);

const placeholders = (n: number) => Array(n).fill('?').join(', ');

// True upserts, not INSERT OR REPLACE: REPLACE deletes the old row first, which would
// cascade-delete every hole of a round whenever the round itself is saved.
const upsertSql = (table: string, cols: readonly string[], key: string) =>
  `INSERT INTO ${table} (${cols.join(', ')}, dirty) VALUES (${placeholders(cols.length)}, ?)
   ON CONFLICT (${key}) DO UPDATE SET ${[...cols, 'dirty']
     .filter((c) => !key.split(', ').includes(c))
     .map((c) => `${c} = excluded.${c}`)
     .join(', ')}`;

const UPSERT_ROUND = upsertSql('rounds', ROUND_COLS, 'id');
const UPSERT_HOLE = upsertSql('round_holes', HOLE_COLS, 'round_id, hole_number');

// ───────────────────────────── reads

export async function selectRounds(includeDeleted = false): Promise<RoundWithHoles[]> {
  const db = await getDb();
  const rounds = await db.getAllAsync<RoundRow>(
    `SELECT * FROM rounds ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY played_on DESC, created_at DESC`,
  );
  const holes = await db.getAllAsync<HoleRow>('SELECT * FROM round_holes ORDER BY round_id, hole_number');
  const byRound = new Map<string, RoundHole[]>();
  for (const h of holes) {
    const list = byRound.get(h.round_id) ?? [];
    list.push(toHole(h));
    byRound.set(h.round_id, list);
  }
  return rounds.map((r) => ({ round: toRound(r), holes: byRound.get(r.id) ?? [] }));
}

export async function selectRound(id: string): Promise<RoundWithHoles | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<RoundRow>('SELECT * FROM rounds WHERE id = ?', id);
  if (!r) return null;
  const holes = await db.getAllAsync<HoleRow>('SELECT * FROM round_holes WHERE round_id = ? ORDER BY hole_number', id);
  return { round: toRound(r), holes: holes.map(toHole) };
}

export async function selectHole(roundId: string, holeNumber: number): Promise<RoundHole | null> {
  const db = await getDb();
  const h = await db.getFirstAsync<HoleRow>(
    'SELECT * FROM round_holes WHERE round_id = ? AND hole_number = ?',
    roundId,
    holeNumber,
  );
  return h ? toHole(h) : null;
}

// ───────────────────────────── local writes (always dirty)

export function writeRoundWithHoles(items: RoundWithHoles[]): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const { round, holes } of items) {
        await tx.runAsync(UPSERT_ROUND, [...roundParams(round), 1]);
        for (const h of holes) await tx.runAsync(UPSERT_HOLE, [...holeParams(h), 1]);
      }
    });
  });
}

export function writeRound(round: Round): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.runAsync(UPSERT_ROUND, [...roundParams(round), 1]);
  });
}

export function writeHole(hole: RoundHole): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.runAsync(UPSERT_HOLE, [...holeParams(hole), 1]);
  });
}

// ───────────────────────────── sync support

export async function selectDirty(): Promise<{ rounds: Round[]; holes: RoundHole[] }> {
  const db = await getDb();
  const rounds = await db.getAllAsync<RoundRow>('SELECT * FROM rounds WHERE dirty = 1 AND user_id IS NOT NULL');
  const holes = await db.getAllAsync<HoleRow>('SELECT * FROM round_holes WHERE dirty = 1 AND user_id IS NOT NULL');
  return { rounds: rounds.map(toRound), holes: holes.map(toHole) };
}

/** Clears the dirty flag only if the row was not edited again while the push was in flight. */
export function markPushed(rounds: Round[], holes: RoundHole[]): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const r of rounds) {
        await tx.runAsync('UPDATE rounds SET dirty = 0 WHERE id = ? AND updated_at = ?', r.id, r.updated_at);
      }
      for (const h of holes) {
        await tx.runAsync(
          'UPDATE round_holes SET dirty = 0 WHERE round_id = ? AND hole_number = ? AND updated_at = ?',
          h.round_id,
          h.hole_number,
          h.updated_at,
        );
      }
    });
  });
}

/** Applies pulled server rows with last-write-wins; a newer unpushed local edit is kept. */
export function applyRemote(rounds: Round[], holes: RoundHole[]): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const r of rounds) {
        const local = await tx.getFirstAsync<{ updated_at: string; dirty: number }>(
          'SELECT updated_at, dirty FROM rounds WHERE id = ?',
          r.id,
        );
        if (local && local.dirty === 1 && local.updated_at >= r.updated_at) continue;
        await tx.runAsync(UPSERT_ROUND, [...roundParams(r), 0]);
      }
      for (const h of holes) {
        const local = await tx.getFirstAsync<{ updated_at: string; dirty: number }>(
          'SELECT updated_at, dirty FROM round_holes WHERE round_id = ? AND hole_number = ?',
          h.round_id,
          h.hole_number,
        );
        if (local && local.dirty === 1 && local.updated_at >= h.updated_at) continue;
        const parent = await tx.getFirstAsync('SELECT 1 FROM rounds WHERE id = ?', h.round_id);
        if (!parent) continue; // parent arrives in a later page; the next pull picks this hole up again
        await tx.runAsync(UPSERT_HOLE, [...holeParams(h), 0]);
      }
    });
  });
}

/** After sign-in, guest rounds become the user's rounds and are queued for upload. */
export function claimGuestData(userId: string): Promise<number> {
  return locked(async () => {
    const db = await getDb();
    const res = await db.runAsync('UPDATE rounds SET user_id = ?, dirty = 1 WHERE user_id IS NULL', userId);
    await db.runAsync('UPDATE round_holes SET user_id = ?, dirty = 1 WHERE user_id IS NULL', userId);
    return res.changes;
  });
}

/** On sign-out the account's data is removed from the device (it lives on the server). */
export function clearAccountData(): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.execAsync("DELETE FROM round_holes; DELETE FROM rounds; DELETE FROM kv WHERE key LIKE 'sync:%';");
  });
}

export async function countUnsynced(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT (SELECT COUNT(*) FROM rounds WHERE dirty = 1) + (SELECT COUNT(*) FROM round_holes WHERE dirty = 1) AS n',
  );
  return row?.n ?? 0;
}

// ───────────────────────────── key/value

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row?.value ?? null;
}

export function kvSet(key: string, value: string): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
  });
}

// ───────────────────────────── course cache

export async function getCachedCourse(id: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM course_cache WHERE id = ?', id);
  return row?.json ?? null;
}

export function putCachedCourse(id: string, json: string, at: string): Promise<void> {
  return locked(async () => {
    const db = await getDb();
    await db.runAsync('INSERT OR REPLACE INTO course_cache (id, json, downloaded_at) VALUES (?, ?, ?)', id, json, at);
  });
}
