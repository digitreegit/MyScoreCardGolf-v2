import type { RoundHole, RoundWithHoles } from './types';

export interface RoundTotals {
  holesPlayed: number;
  strokes: number;
  par: number; // par of the holes that have a score
  toPar: number;
  putts: number | null; // null when no putts recorded
  complete: boolean; // every hole has a score
}

export function roundTotals(holes: RoundHole[]): RoundTotals {
  let strokes = 0;
  let par = 0;
  let putts = 0;
  let puttsSeen = false;
  let holesPlayed = 0;
  for (const h of holes) {
    if (h.strokes == null) continue;
    holesPlayed += 1;
    strokes += h.strokes;
    par += h.par;
    if (h.putts != null) {
      putts += h.putts;
      puttsSeen = true;
    }
  }
  return {
    holesPlayed,
    strokes,
    par,
    toPar: strokes - par,
    putts: puttsSeen ? putts : null,
    complete: holes.length > 0 && holesPlayed === holes.length,
  };
}

/** Sum of strokes for a hole range (1-based, inclusive), e.g. OUT = 1..9. */
export function sumRange(holes: RoundHole[], from: number, to: number, key: 'strokes' | 'par' | 'putts'): number | null {
  let total = 0;
  let seen = false;
  for (const h of holes) {
    if (h.hole_number < from || h.hole_number > to) continue;
    const v = h[key];
    if (v == null) continue;
    total += v;
    seen = true;
  }
  return seen ? total : null;
}

export type ScoreName = 'eagleOrBetter' | 'birdie' | 'par' | 'bogey' | 'double' | 'tripleOrWorse';

export function scoreName(strokes: number, par: number): ScoreName {
  const d = strokes - par;
  if (d <= -2) return 'eagleOrBetter';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  if (d === 2) return 'double';
  return 'tripleOrWorse';
}

export interface PlayerStats {
  rounds: number; // complete, non-excluded rounds counted
  scoringAvg18: number | null; // 9-hole rounds are doubled into 18-hole equivalents
  best18: number | null;
  avgToPar18: number | null;
  avgPutts18: number | null;
  parTypeAvg: Record<3 | 4 | 5, number | null>;
  distribution: Record<ScoreName, number>; // share of holes, 0..1
  firPct: number | null; // fairways hit / fairway attempts (par 4/5 with a recorded result)
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeStats(rounds: RoundWithHoles[]): PlayerStats {
  const counted = rounds.filter(
    (r) => !r.round.exclude_from_stats && !r.round.deleted_at && roundTotals(r.holes).complete,
  );

  const scores18: number[] = [];
  const toPar18: number[] = [];
  const putts18: number[] = [];
  const parType: Record<3 | 4 | 5, { sum: number; n: number }> = {
    3: { sum: 0, n: 0 },
    4: { sum: 0, n: 0 },
    5: { sum: 0, n: 0 },
  };
  const dist: Record<ScoreName, number> = {
    eagleOrBetter: 0,
    birdie: 0,
    par: 0,
    bogey: 0,
    double: 0,
    tripleOrWorse: 0,
  };
  let holeCount = 0;
  let fwAttempts = 0;
  let fwHits = 0;

  for (const { round, holes } of counted) {
    const t = roundTotals(holes);
    const factor = round.holes_count === 9 ? 2 : 1;
    scores18.push(t.strokes * factor);
    toPar18.push(t.toPar * factor);
    if (t.putts != null) putts18.push(t.putts * factor);

    for (const h of holes) {
      if (h.strokes == null) continue;
      holeCount += 1;
      dist[scoreName(h.strokes, h.par)] += 1;
      if (h.par === 3 || h.par === 4 || h.par === 5) {
        parType[h.par].sum += h.strokes;
        parType[h.par].n += 1;
      }
      if (h.par >= 4 && h.fairway && h.fairway !== 'na') {
        fwAttempts += 1;
        if (h.fairway === 'hit') fwHits += 1;
      }
    }
  }

  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const pt = (k: 3 | 4 | 5) => (parType[k].n ? Math.round((parType[k].sum / parType[k].n) * 100) / 100 : null);

  if (holeCount > 0) {
    for (const k of Object.keys(dist) as ScoreName[]) dist[k] = dist[k] / holeCount;
  }

  return {
    rounds: counted.length,
    scoringAvg18: avg(scores18),
    best18: scores18.length ? Math.min(...scores18) : null,
    avgToPar18: avg(toPar18),
    avgPutts18: avg(putts18),
    parTypeAvg: { 3: pt(3), 4: pt(4), 5: pt(5) },
    distribution: dist,
    firPct: fwAttempts ? Math.round((fwHits / fwAttempts) * 1000) / 10 : null,
  };
}
