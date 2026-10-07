// The web app keeps no local copy of rounds. Same exports as accountData.ts.
export async function claimGuestDataForUser(_userId: string): Promise<void> {}
export async function clearLocalAccountData(): Promise<void> {}
export async function countUnsynced(): Promise<number> {
  return 0;
}
