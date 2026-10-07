import { describe, expect, it } from '@jest/globals';

import { nearestCourses, searchCourses, type CourseSummary } from '@/features/courses/courseIndex';

import { scanToRound, type ScanResult } from '../scanResult';

const NOW = '2026-10-06T12:00:00.000Z';
const newId = () => 'aaaaaaaa-0000-4000-8000-000000000001';

describe('scanToRound', () => {
  const base: ScanResult = {
    course_name: 'Muni GC',
    played_on: '2026-09-20',
    holes_count: 9,
    notation: 'to_par',
    pars: [4, 4, 3, 5, 4, 4, 3, 4, null],
    players: [
      { name: 'Kim', scores: [0, 1, 0, 2, -1, 0, 1, 0, 1], putts: Array(9).fill(null) },
      { name: 'Lee', scores: Array(9).fill(0), putts: Array(9).fill(2) },
    ],
    confidence: 'high',
  };

  it('converts to-par notation with scanned pars and fills missing pars', () => {
    const { round, holes } = scanToRound(base, 0, { userId: 'u', newId, now: NOW });
    expect(holes.map((h) => h.strokes)).toEqual([4, 5, 3, 7, 3, 4, 4, 4, 6]);
    expect(holes[8].par).toBe(5); // default par for hole 9
    expect(round).toMatchObject({ source: 'scan', companions: 'Lee', played_on: '2026-09-20', holes_count: 9 });
  });

  it('keeps absolute strokes and drops impossible values', () => {
    const scan: ScanResult = { ...base, notation: 'strokes', players: [{ name: null, scores: [5, 0, 25, 4, 4, 4, 4, 4, 4], putts: [2, -1, 2, 2, 2, 2, 2, 2, 2] }] };
    const { holes } = scanToRound(scan, 0, { userId: null, newId, now: NOW });
    expect(holes.slice(0, 3).map((h) => h.strokes)).toEqual([5, null, null]);
    expect(holes[1].putts).toBeNull();
  });
});

describe('course index', () => {
  const data: CourseSummary[] = [
    { id: 'a', name: 'Pebble Beach Golf Links', city: 'Pebble Beach', state: 'CA', lat: 36.5686, lng: -121.9496 },
    { id: 'b', name: 'Spyglass Hill', city: 'Pebble Beach', state: 'CA', lat: 36.5839, lng: -121.9535 },
    { id: 'c', name: 'Bethpage Black', city: 'Farmingdale', state: 'NY', lat: 40.7445, lng: -73.454 },
  ];

  it('searches name and city, ranking name prefix matches first', () => {
    expect(searchCourses('pebble', 10, data).map((c) => c.id)).toEqual(['a', 'b']);
    expect(searchCourses('farmingdale', 10, data).map((c) => c.id)).toEqual(['c']);
    expect(searchCourses('  ', 10, data)).toEqual([]);
  });

  it('finds nearby courses within range only', () => {
    const near = nearestCourses({ lat: 36.57, lng: -121.95 }, 5, 10_000, data);
    expect(near.map((c) => c.id)).toEqual(['a', 'b']);
  });
});
