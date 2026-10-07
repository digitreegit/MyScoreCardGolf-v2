// Backoff schedule for automatic sync retries after a failed sync.

const SCHEDULE_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
export const MAX_RETRY_DELAY_MS = 300_000;

/**
 * Delay before retry number `attempt` (1-based): 5s, 15s, 30s, 1m, 2m, then every 5m.
 * `random` (0..1) adds ±20% jitter so many phones coming back online don't retry in lockstep.
 */
export function retryDelayMs(attempt: number, random: number = Math.random()): number {
  const base = SCHEDULE_MS[Math.max(0, attempt - 1)] ?? MAX_RETRY_DELAY_MS;
  const jitter = 1 + (Math.min(Math.max(random, 0), 1) * 0.4 - 0.2);
  return Math.round(base * jitter);
}
