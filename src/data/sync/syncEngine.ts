// Offline-first sync between the local SQLite DB and Supabase (native only).
//
//   push: dirty local rows → sync_push RPC (server keeps the newer updated_at per round / per hole)
//   pull: rows whose server_updated_at is past our cursor → applyRemote (local unpushed newer edits win)
//
// Guest users (no account) never sync; their rows have user_id = null.

import { AppState } from 'react-native';

import { retryDelayMs } from '@/domain/syncRetry';
import type { Round, RoundHole } from '@/domain/types';
import { isBackendConfigured } from '@/lib/env';
import { getSupabase } from '@/lib/supabase';

import { emitDataChanged } from '../events';
import * as db from '../local/db';
import { subscribeToRoundChanges, unsubscribeFromRoundChanges } from './liveUpdates';

const PUSH_CHUNK = 200;
const PULL_PAGE = 500;
const DEBOUNCE_MS = 1500;
const REMOTE_CHANGE_DELAY_MS = 500; // coalesces a burst of realtime events into one pull
const POLL_MS = 60_000; // fallback pull while the app is open, in case a realtime event is missed

let currentUserId: string | null = null;
let running: Promise<void> | null = null;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0; // consecutive failed syncs; drives the retry backoff
let poll: ReturnType<typeof setInterval> | null = null;

export type SyncStatus = {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  /** When the next automatic retry runs after a failure (ISO), or null. */
  retryAt: string | null;
};
let status: SyncStatus = { state: 'idle', lastSyncedAt: null, retryAt: null };
const statusListeners = new Set<(s: SyncStatus) => void>();

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  statusListeners.forEach((l) => l(status));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function onSyncStatus(listener: (s: SyncStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function setSyncUser(userId: string | null): void {
  currentUserId = userId;
  failures = 0;
  if (userId && isBackendConfigured) {
    // Edits made on the web (or another phone) arrive while this app stays open.
    subscribeToRoundChanges(userId, () => requestSync(REMOTE_CHANGE_DELAY_MS));
    startPolling();
    requestSync(0);
  } else {
    unsubscribeFromRoundChanges();
    stopPolling();
    if (timer) clearTimeout(timer);
    timer = null;
    setStatus({ state: 'idle', retryAt: null });
  }
}

function startPolling() {
  stopPolling();
  poll = setInterval(() => requestSync(0), POLL_MS);
}

function stopPolling() {
  if (poll) clearInterval(poll);
  poll = null;
}

/** Debounced background sync; safe to call after every edit. */
export function requestSync(delay = DEBOUNCE_MS): void {
  if (!currentUserId || !isBackendConfigured) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

export async function syncNow(): Promise<void> {
  if (!currentUserId || !isBackendConfigured) return;
  if (running) {
    rerun = true; // an edit landed mid-sync; go again once this pass finishes
    return running;
  }
  running = (async () => {
    setStatus({ state: 'syncing', retryAt: null });
    try {
      do {
        rerun = false;
        await push();
        await pull();
      } while (rerun);
      failures = 0;
      setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      const offline = err instanceof TypeError; // fetch network failure
      if (!offline) console.warn('sync failed', err);
      // Retry on our own with backoff; edits, app foregrounding and "Sync now" still sync sooner.
      failures += 1;
      const delay = retryDelayMs(failures);
      setStatus({ state: offline ? 'offline' : 'error', retryAt: new Date(Date.now() + delay).toISOString() });
      requestSync(delay);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function push(): Promise<void> {
  const { rounds, holes } = await db.selectDirty();
  const supabase = getSupabase();
  // Rounds before holes: the server checks that a hole's round belongs to the caller.
  for (let i = 0; i < rounds.length; i += PUSH_CHUNK) {
    const chunk = rounds.slice(i, i + PUSH_CHUNK);
    const { error } = await supabase.rpc('sync_push', { p_rounds: chunk.map(stripUser), p_holes: [] });
    if (error) throw error;
    await db.markPushed(chunk, []);
  }
  for (let i = 0; i < holes.length; i += PUSH_CHUNK) {
    const chunk = holes.slice(i, i + PUSH_CHUNK);
    const { error } = await supabase.rpc('sync_push', { p_rounds: [], p_holes: chunk.map(stripUser) });
    if (error) throw error;
    await db.markPushed([], chunk);
  }
}

async function pull(): Promise<void> {
  let changed = false;
  // Rounds fully first, so every pulled hole already has its parent row locally.
  for (const table of ['rounds', 'round_holes'] as const) {
    const cursorKey = `sync:cursor:${table}`;
    let cursor = (await db.kvGet(cursorKey)) ?? '1970-01-01T00:00:00Z';
    for (;;) {
      const { data, error } = await getSupabase()
        .from(table)
        .select('*')
        .gt('server_updated_at', cursor)
        .order('server_updated_at', { ascending: true })
        .limit(PULL_PAGE);
      if (error) throw error;
      if (!data.length) break;

      const rows = data.map(normalizeTimestamps);
      if (table === 'rounds') await db.applyRemote(rows as unknown as Round[], []);
      else await db.applyRemote([], rows as unknown as RoundHole[]);
      changed = true;

      cursor = data[data.length - 1].server_updated_at as string;
      await db.kvSet(cursorKey, cursor);
      if (data.length < PULL_PAGE) break;
    }
  }
  if (changed) emitDataChanged();
}

function stripUser<T extends { user_id: string | null }>({ user_id: _u, ...rest }: T) {
  return rest;
}

/** Postgres returns "2026-10-06T12:00:00.123+00:00"; local rows use JS ISO strings. LWW compares strings. */
function normalizeTimestamps(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const k of ['created_at', 'updated_at', 'deleted_at']) {
    if (typeof out[k] === 'string') out[k] = new Date(out[k] as string).toISOString();
  }
  return out;
}

AppState.addEventListener('change', (state) => {
  if (!currentUserId) return;
  if (state === 'active') {
    startPolling();
    requestSync(0);
  } else {
    stopPolling(); // no background polling; the realtime socket is paused by the OS anyway
  }
});
