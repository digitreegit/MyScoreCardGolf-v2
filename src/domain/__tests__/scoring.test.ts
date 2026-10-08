import { describe, expect, it } from '@jest/globals';

import { courseNameMatches, displayScore, padStrokes, parChangePatch, parsFromHistory, toParRange } from '../scoring';
import { emptyHoles, type Round, type RoundWithHoles } from '../types';

const round = (over: Partial<Round>, pars: number[], strokes: Array<number | null> = []): RoundWithHoles => {
  const r: Round = {
    id: over.id ?? 'r',
    user_id: null,
    course_id: null,
    course_name: '',
    tee_box: null,
    companions: '',
    played_on: '2026-01-01',
    holes_count: 18,
    entry_mode: 'par',
    exclude_from_stats: false,
    notes: '',
    source: 'v1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...over,
  };
  const holes = emptyHoles(r.id, null, 18, pars).map((h, i) => ({ ...h, strokes: strokes[i] ?? null }));
  return { round: r, holes };
};

const NORTH = [5, 4, 4, 5, 3, 4, 4, 3, 4, 4, 5, 4, 4, 4, 4, 4, 3, 4];
const ALL4 = Array(18).fill(4);

describe('score display', () => {
  it('shows strokes or over/under par', () => {
    expect(displayScore(5, 4, 'stroke')).toBe('5');
    expect(displayScore(5, 4, 'par')).toBe('+1');
    expect(displayScore(4, 4, 'par')).toBe('0');
    expect(displayScore(3, 4, 'par')).toBe('-1');
    expect(displayScore(null, 4, 'par')).toBe('');
  });
  it('sums over/under par for scored holes only', () => {
    const { holes } = round({}, NORTH, [6, 4, 3]);
    expect(toParRange(holes, 1, 9)).toBe(0); // +1, 0, -1
    expect(toParRange(holes, 10, 18)).toBeNull();
  });
  it('offers -3…+6 on the par-mode pad, never below 1 stroke', () => {
    expect(padStrokes(4, 'par')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(padStrokes(3, 'par')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(padStrokes(5, 'stroke')[0]).toBe(1);
  });
  it('keeps the written value when the par is corrected', () => {
    const h = { ...round({}, ALL4).holes[0], strokes: 5 }; // par 4, written "+1" / "5"
    expect(parChangePatch(h, 5, 'par')).toEqual({ par: 5, strokes: 6 });
    expect(parChangePatch(h, 5, 'stroke')).toEqual({ par: 5 });
  });
});

describe('pars from history', () => {
  it('matches v1 names to index names', () => {
    expect(courseNameMatches('Charleston North', 'Charleston Springs Golf Course (North)')).toBe(true);
    expect(courseNameMatches('Charleston North', 'Charleston Springs Golf Course (South)')).toBe(false);
    expect(courseNameMatches('Hominy Hills', 'Hominy Hill Golf Course')).toBe(true);
    expect(courseNameMatches('Pine Brook', 'Pine Brook Golf Course')).toBe(true);
    expect(courseNameMatches('Golf Club', 'Pine Brook Golf Course')).toBe(false);
  });
  it('uses the latest round whose pars were actually entered', () => {
    const rounds = [
      round({ id: 'a', course_name: 'Charleston North', played_on: '2026-05-02' }, NORTH),
      round({ id: 'b', course_name: 'Charleston North', played_on: '2026-10-03' }, ALL4), // never filled in
      round({ id: 'c', course_name: 'Charleston South', played_on: '2026-10-05' }, [3, ...NORTH.slice(1)]),
    ];
    const course = { id: 'osm:way/40149863', name: 'Charleston Springs Golf Course (North)' };
    expect(parsFromHistory(rounds, course, 18)).toEqual(NORTH);
    expect(parsFromHistory(rounds, course, 9)).toEqual(NORTH.slice(0, 9));
    expect(parsFromHistory(rounds.slice(1), course, 18)).toBeNull();
  });
  it('prefers a round linked by course id and skips deleted rounds', () => {
    const linked = round({ id: 'x', course_id: 'osm:1', course_name: 'Somewhere', played_on: '2026-09-01' }, NORTH);
    const deleted = round({ id: 'y', course_id: 'osm:1', played_on: '2026-10-01', deleted_at: '2026-10-02T00:00:00Z' }, [3, ...ALL4.slice(1)]);
    expect(parsFromHistory([linked, deleted], { id: 'osm:1', name: 'Other name' }, 18)).toEqual(NORTH);
  });
});
