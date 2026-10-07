// The web app writes straight to Supabase, so there is nothing to sync. Same exports as syncEngine.ts.

export type SyncStatus = {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  retryAt: string | null;
};

const status: SyncStatus = { state: 'idle', lastSyncedAt: null, retryAt: null };

export const getSyncStatus = (): SyncStatus => status;
export const onSyncStatus = (_listener: (s: SyncStatus) => void): (() => void) => () => {};
export const setSyncUser = (_userId: string | null): void => {};
export const requestSync = (_delay?: number): void => {};
export const syncNow = async (): Promise<void> => {};
