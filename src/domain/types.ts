// Core domain model shared by the app (native + web), sync, and spreadsheet I/O.
// Field names mirror the Supabase columns (snake_case) so rows round-trip without mapping.

export type TeeBox = 'black' | 'blue' | 'white' | 'gold' | 'silver' | 'red' | 'green';
export const TEE_BOXES: TeeBox[] = ['black', 'blue', 'white', 'gold', 'silver', 'red', 'green'];

/** How the score was entered. Kept from v1: "par" mode records +/- relative to par. */
export type EntryMode = 'par' | 'stroke';

export type RoundSource = 'manual' | 'scan' | 'voice' | 'import' | 'v1';

export type FairwayResult = 'hit' | 'left' | 'right' | 'short' | 'na';

export interface Round {
  id: string; // client-generated UUID
  user_id: string | null; // null = guest (local only, never synced)
  course_id: string | null; // references courses.id when picked from the course index
  course_name: string;
  tee_box: TeeBox | null;
  companions: string;
  played_on: string; // YYYY-MM-DD
  holes_count: 9 | 18;
  entry_mode: EntryMode;
  exclude_from_stats: boolean;
  notes: string;
  source: RoundSource;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp, client clock — used for last-write-wins
  deleted_at: string | null; // soft delete so deletions sync
}

export interface RoundHole {
  round_id: string;
  user_id: string | null;
  hole_number: number; // 1-based
  par: number;
  strokes: number | null;
  putts: number | null;
  fairway: FairwayResult | null;
  penalties: number | null;
  updated_at: string; // per-hole timestamp so phone/web edits to different holes never clobber each other
}

export interface RoundWithHoles {
  round: Round;
  holes: RoundHole[];
}

export const DEFAULT_PARS_18 = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayLocalDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function emptyHoles(
  roundId: string,
  userId: string | null,
  holesCount: 9 | 18,
  pars: number[] = DEFAULT_PARS_18,
  at: string = nowIso(),
): RoundHole[] {
  return Array.from({ length: holesCount }, (_, i) => ({
    round_id: roundId,
    user_id: userId,
    hole_number: i + 1,
    par: pars[i] ?? 4,
    strokes: null,
    putts: null,
    fairway: null,
    penalties: null,
    updated_at: at,
  }));
}
