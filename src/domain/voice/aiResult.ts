// Validation for the parse-voice edge function's answer. The model output is schema-constrained,
// but values are still range-checked before anything is written to a scorecard.

export interface AiVoiceResult {
  understood: boolean;
  hole: number | null;
  strokes: number | null;
  putts: number | null;
}

export interface AiVoicePatch {
  hole: number | null; // null → the currently selected hole
  strokes: number | null;
  putts: number | null;
}

const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Returns null when there is nothing safe to apply. */
export function sanitizeAiResult(raw: unknown, holesCount: number): AiVoicePatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<AiVoiceResult>;
  if (r.understood !== true) return null;
  const hole = r.hole == null ? null : intIn(r.hole, 1, holesCount);
  if (r.hole != null && hole == null) return null; // named a hole that isn't on this card
  const strokes = intIn(r.strokes, 1, 20);
  const putts = intIn(r.putts, 0, 10);
  if (strokes == null && putts == null) return null;
  if (strokes != null && putts != null && putts > strokes) return null; // impossible score
  return { hole, strokes, putts };
}
