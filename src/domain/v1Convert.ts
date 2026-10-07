// Converts rounds stored by v1 (AsyncStorage key "golf_score_rounds_v3") into the v2 model.
// v2 ships under the same bundle IDs as v1, so the old data is still on the device after update.

import { parseSheetDate } from './spreadsheet/roundsSheet';
import { TEE_BOXES, type Round, type RoundHole, type RoundWithHoles, type TeeBox } from './types';

export const V1_ROUNDS_KEY = 'golf_score_rounds_v3';
export const V1_SETTINGS_KEY = 'golf_score_settings_v3';

/** Shape written by v1 (src/screens/NativeScoreCardApp.tsx in the v1 repo). Every field is optional here on purpose. */
export interface V1Round {
  id?: string;
  date?: string;
  course?: string;
  teeBox?: string | null;
  companion?: string;
  holes?: number;
  relScores?: Array<number | null>;
  strokeScores?: Array<number | null>;
  putts?: Array<number | null>;
  pars?: number[];
  entryMode?: 'par' | 'stroke';
  exclude?: boolean;
  notes?: string;
  createdAt?: number;
}

export interface V1Settings {
  lang?: string;
  darkMode?: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function convertV1Round(
  v1: V1Round,
  opts: { userId: string | null; newId: () => string; now: string },
): RoundWithHoles | null {
  const playedOn = parseSheetDate(v1.date);
  if (!playedOn) return null;

  const holesCount: 9 | 18 = v1.holes === 9 ? 9 : 18;
  const id = opts.newId(); // v1 ids are not UUIDs; the server column is uuid
  const created = num(v1.createdAt) != null ? new Date(v1.createdAt!).toISOString() : opts.now;
  const preferRel = v1.entryMode !== 'stroke';

  const holes: RoundHole[] = [];
  for (let i = 0; i < holesCount; i++) {
    const par = num(v1.pars?.[i]) ?? 4;
    const rel = num(v1.relScores?.[i]);
    const abs = num(v1.strokeScores?.[i]);
    const fromRel = rel != null ? par + rel : null;
    const strokes = preferRel ? (fromRel ?? abs) : (abs ?? fromRel);
    holes.push({
      round_id: id,
      user_id: opts.userId,
      hole_number: i + 1,
      par,
      strokes: strokes != null && strokes >= 1 ? strokes : null,
      putts: num(v1.putts?.[i]),
      fairway: null,
      penalties: null,
      updated_at: opts.now,
    });
  }

  const tee = (TEE_BOXES as string[]).includes(v1.teeBox ?? '') ? (v1.teeBox as TeeBox) : null;
  const round: Round = {
    id,
    user_id: opts.userId,
    course_id: null,
    course_name: (v1.course ?? '').trim() || 'Unknown course',
    tee_box: tee,
    companions: v1.companion ?? '',
    played_on: playedOn,
    holes_count: holesCount,
    entry_mode: v1.entryMode === 'stroke' ? 'stroke' : 'par',
    exclude_from_stats: Boolean(v1.exclude),
    notes: v1.notes ?? '',
    source: 'v1',
    created_at: created,
    updated_at: opts.now,
    deleted_at: null,
  };
  return { round, holes };
}

export function convertV1Rounds(
  raw: string | null,
  opts: { userId: string | null; newId: () => string; now: string },
): RoundWithHoles[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((r) => convertV1Round(r as V1Round, opts)).filter((r): r is RoundWithHoles => r !== null);
}
