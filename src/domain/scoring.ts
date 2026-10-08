// Score display modes and where a new round's pars come from.
// Strokes are always stored as absolute numbers; "par" mode only changes how they are shown and
// entered (0 = par, -1 = birdie, +1 = bogey), like writing a card in over/under.

import type { EntryMode, Round, RoundHole, RoundWithHoles } from './types';

export function formatToPar(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** What a score cell shows: "5" in stroke mode, "+1" on a par 4 in par mode. */
export function displayScore(strokes: number | null, par: number, mode: EntryMode): string {
  if (strokes == null) return '';
  return mode === 'par' ? formatToPar(strokes - par) : String(strokes);
}

/** Over/under par of the scored holes in a range (1-based, inclusive), or null when none scored. */
export function toParRange(holes: RoundHole[], from: number, to: number): number | null {
  let total = 0;
  let seen = false;
  for (const h of holes) {
    if (h.hole_number < from || h.hole_number > to || h.strokes == null) continue;
    total += h.strokes - h.par;
    seen = true;
  }
  return seen ? total : null;
}

/** Stroke values offered on the pad. Par mode: -3…+6 around par (a par 3 can't go below an ace). */
export function padStrokes(par: number, mode: EntryMode): number[] {
  if (mode === 'stroke') return Array.from({ length: 10 }, (_, i) => i + 1);
  return Array.from({ length: 10 }, (_, i) => par - 3 + i).filter((s) => s >= 1);
}

/**
 * Patch for changing a hole's par. In par mode the player wrote "+1", so that stays +1 and the
 * strokes move with the par; in stroke mode the strokes are what was written and stay put.
 */
export function parChangePatch(hole: RoundHole, par: number, mode: EntryMode): Partial<RoundHole> {
  if (mode === 'par' && hole.strokes != null) return { par, strokes: Math.max(1, hole.strokes + par - hole.par) };
  return { par };
}

// --- Pars for a new round -------------------------------------------------------------------

const GENERIC = new Set(['golf', 'course', 'club', 'country', 'cc', 'gc', 'the', 'links', 'and', 'of', 'at']);

const tokens = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9가-힣 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !GENERIC.has(t));

/**
 * True when a round's free-text course name refers to the picked course: every distinctive word
 * of the shorter name appears in the other ("Charleston North" ↔ "Charleston Springs North",
 * "Hominy Hills" ↔ "Hominy Hill Golf Course"). v1 rounds only have names, no course id.
 */
export function courseNameMatches(a: string, b: string): boolean {
  const [short, long] = [tokens(a), tokens(b)].sort((x, y) => x.length - y.length);
  if (!short.length) return false;
  const same = (x: string, y: string) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
  return short.every((t) => long.some((u) => same(t, u)));
}

/** A card where every hole is the same par was never filled in (v1 defaulted to all 4s). */
const parsWereEntered = (pars: number[]) => new Set(pars).size > 1;

/**
 * Pars from the player's latest round at this course, if they ever set them. This beats map data:
 * the player saw the real card, while OpenStreetMap pars are often estimated from hole length.
 */
export function parsFromHistory(
  rounds: RoundWithHoles[],
  course: { id: string | null; name: string },
  holesCount: 9 | 18,
): number[] | null {
  const sameCourse = (r: Round) =>
    (course.id != null && r.course_id === course.id) || courseNameMatches(r.course_name, course.name);
  const candidates = rounds
    .filter(({ round, holes }) => !round.deleted_at && holes.length >= holesCount && sameCourse(round))
    .sort((a, b) => (b.round.played_on + b.round.updated_at).localeCompare(a.round.played_on + a.round.updated_at));
  for (const { holes } of candidates) {
    const pars = [...holes].sort((a, b) => a.hole_number - b.hole_number).slice(0, holesCount).map((h) => h.par);
    if (parsWereEntered(pars)) return pars;
  }
  return null;
}
