import { describe, expect, it } from '@jest/globals';

import { formatDistance, greenDistances, haversineMeters, nearestIndex } from '../geo';
import { escapeCellText, parseSheetDate, roundsToRows, rowsToRounds } from '../spreadsheet/roundsSheet';
import { fileToRows, rowsToFile } from '../spreadsheet/workbook';
import { computeStats, roundTotals } from '../stats';
import { MAX_RETRY_DELAY_MS, retryDelayMs } from '../syncRetry';
import { emptyHoles, type Round, type RoundWithHoles } from '../types';
import { convertV1Rounds } from '../v1Convert';

const NOW = '2026-10-06T12:00:00.000Z';
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function makeRound(scores: number[], overrides: Partial<Round> = {}): RoundWithHoles {
  const id = newId();
  const holesCount = scores.length === 9 ? 9 : 18;
  const holes = emptyHoles(id, null, holesCount, undefined, NOW).map((h, i) => ({
    ...h,
    strokes: scores[i],
    putts: 2,
  }));
  return {
    round: {
      id,
      user_id: null,
      course_id: null,
      course_name: 'Test GC',
      tee_box: 'white',
      companions: '',
      played_on: '2026-09-01',
      holes_count: holesCount,
      entry_mode: 'stroke',
      exclude_from_stats: false,
      notes: '',
      source: 'manual',
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      ...overrides,
    },
    holes,
  };
}

describe('stats', () => {
  const pars = emptyHoles('x', null, 18).map((h) => h.par);

  it('totals a round', () => {
    const r = makeRound(pars.map((p) => p + 1));
    expect(roundTotals(r.holes)).toMatchObject({ strokes: 90, par: 72, toPar: 18, putts: 36, complete: true });
  });

  it('doubles 9-hole rounds and skips excluded/incomplete rounds', () => {
    const nine = makeRound(pars.slice(0, 9));
    const excluded = makeRound(pars, { exclude_from_stats: true });
    const incomplete = makeRound(pars);
    incomplete.holes[0].strokes = null;
    const s = computeStats([nine, excluded, incomplete, makeRound(pars.map((p) => p + 1))]);
    expect(s.rounds).toBe(2);
    expect(s.best18).toBe(72); // the 9-hole even-par round, doubled
    expect(s.scoringAvg18).toBe(81);
  });
});

describe('geo', () => {
  it('computes ~1 degree of latitude', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });

  it('formats yards and meters', () => {
    expect(formatDistance(100, 'meters')).toBe(100);
    expect(formatDistance(91.44, 'yards')).toBe(100);
  });

  it('finds green distances and nearest items', () => {
    const me = { lat: 36.5686, lng: -121.95 };
    const d = greenDistances(me, { front: null, center: { lat: 36.5695, lng: -121.95 }, back: null }, 'yards');
    expect(d.center).toBeGreaterThan(100);
    expect(d.front).toBeNull();
    expect(nearestIndex(me, [{ lat: 40, lng: -73 }, { lat: 36.57, lng: -121.95 }])).toBe(1);
    expect(nearestIndex(me, [{ lat: 40, lng: -73 }], 1000)).toBe(-1);
  });
});

describe('spreadsheet', () => {
  it('escapes formula-like text', () => {
    expect(escapeCellText('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(escapeCellText('Pebble Beach')).toBe('Pebble Beach');
  });

  it('parses common date formats', () => {
    expect(parseSheetDate('2026-9-1')).toBe('2026-09-01');
    expect(parseSheetDate('9/1/2026')).toBe('2026-09-01');
    expect(parseSheetDate(46266)).toBe('2026-09-01');
    expect(parseSheetDate('yesterday')).toBeNull();
  });

  it('round-trips rounds through an xlsx file', () => {
    const original = makeRound([4, 5, 3, 4, 6, 4, 3, 4, 5], { course_name: '=evil', notes: 'windy' });
    const file = rowsToFile(roundsToRows([original]), 'xlsx');
    const rows = fileToRows(file.base64);
    const { items, errors } = rowsToRounds(rows, { userId: 'u1', newId, now: NOW });
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].round).toMatchObject({ course_name: '=evil', played_on: '2026-09-01', holes_count: 9, user_id: 'u1' });
    expect(items[0].holes.map((h) => h.strokes)).toEqual([4, 5, 3, 4, 6, 4, 3, 4, 5]);
  });

  it('reports row-level validation errors', () => {
    const { items, errors } = rowsToRounds(
      [{ Date: 'bad', Course: 'X' }, { Date: '2026-01-01', Course: 'Y', Holes: 18, 'Score 1': 40 }],
      { userId: null, newId, now: NOW },
    );
    expect(items).toHaveLength(0);
    expect(errors.map((e) => e.row)).toEqual([2, 3]);
  });
});

describe('v1 import', () => {
  it('converts par-mode and stroke-mode rounds', () => {
    const raw = JSON.stringify([
      { id: 'r1', date: '2025-05-01', course: 'Old Course', holes: 9, entryMode: 'par', relScores: [0, 1, -1, 2, 0, 0, 0, 0, 0], pars: [4, 4, 3, 5, 4, 4, 3, 4, 5], putts: [2, 2, 1, 3, 2, 2, 2, 2, 2] },
      { id: 'r2', date: '2025-05-02', course: 'Other', holes: 18, entryMode: 'stroke', strokeScores: Array(18).fill(5), teeBox: 'blue', exclude: true },
      { id: 'broken' },
    ]);
    const out = convertV1Rounds(raw, { userId: null, newId, now: NOW });
    expect(out).toHaveLength(2);
    expect(out[0].holes.slice(0, 4).map((h) => h.strokes)).toEqual([4, 5, 2, 7]);
    expect(out[0].round.source).toBe('v1');
    expect(out[1].round).toMatchObject({ tee_box: 'blue', exclude_from_stats: true, holes_count: 18 });
    expect(convertV1Rounds('not json', { userId: null, newId, now: NOW })).toEqual([]);
  });
});

describe('sync retry backoff', () => {
  it('grows from 5s to a 5 minute cap', () => {
    const mid = 0.5; // no jitter
    expect([1, 2, 3, 4, 5, 6, 20].map((n) => retryDelayMs(n, mid))).toEqual([
      5_000, 15_000, 30_000, 60_000, 120_000, MAX_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS,
    ]);
  });

  it('keeps jitter within ±20%', () => {
    expect(retryDelayMs(1, 0)).toBe(4_000);
    expect(retryDelayMs(1, 1)).toBe(6_000);
  });
});
