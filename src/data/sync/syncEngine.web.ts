// The web app writes straight to Supabase, so there is nothing to push or pull. It only listens for
// changes made elsewhere (e.g. on the phone) and reloads its views. Same exports as syncEngine.ts.

import { emitDataChanged } from '../events';
import { subscribeToRoundChanges, unsubscribeFromRoundChanges } from './liveUpdates';

export type SyncStatus = {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  retryAt: string | null;
};

const status: SyncStatus = { state: 'idle', lastSyncedAt: null, retryAt: null };

export const getSyncStatus = (): SyncStatus => status;
export const onSyncStatus = (_listener: (s: SyncStatus) => void): (() => void) => () => {};
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesces a burst of realtime events (one per hole) into a single reload. */
function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    emitDataChanged();
  }, 300);
}

function onVisible() {
  if (document.visibilityState === 'visible') scheduleReload();
}

export const setSyncUser = (userId: string | null): void => {
  if (typeof window === 'undefined') return;
  document.removeEventListener('visibilitychange', onVisible);
  if (userId) {
    subscribeToRoundChanges(userId, scheduleReload);
    document.addEventListener('visibilitychange', onVisible); // catch up after the tab was in the background
  } else {
    unsubscribeFromRoundChanges();
  }
};
export const requestSync = (_delay?: number): void => {};
export const syncNow = async (): Promise<void> => {};
