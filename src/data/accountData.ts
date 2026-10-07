// Account transitions for the local database (native). See accountData.web.ts for the web no-ops.
import { emitDataChanged } from './events';
import * as db from './local/db';

export async function claimGuestDataForUser(userId: string): Promise<void> {
  const claimed = await db.claimGuestData(userId);
  if (claimed > 0) emitDataChanged();
}

export async function clearLocalAccountData(): Promise<void> {
  await db.clearAccountData();
  emitDataChanged();
}

export function countUnsynced(): Promise<number> {
  return db.countUnsynced();
}
