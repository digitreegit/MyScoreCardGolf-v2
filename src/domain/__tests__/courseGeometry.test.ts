import { describe, expect, it } from '@jest/globals';

import { computeHoleTargets, estimatePar, type OsmWay } from '../../../supabase/functions/_shared/courseGeometry';
import { haversineMeters } from '../geo';

// Synthetic hole near San Diego: tee at the origin, green ~350 m due north.
const LAT0 = 32.9;
const LON0 = -117.25;
const mLat = (m: number) => LAT0 + m / 111_320;
const mLon = (m: number) => LON0 + m / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (east: number, north: number) => ({ lat: mLat(north), lon: mLon(east) });

// 30 m (north-south) × 20 m (east-west) green centered 350 m north of the tee.
const green: OsmWay = {
  type: 'way',
  id: 2,
  tags: { golf: 'green' },
  geometry: [pt(-10, 335), pt(10, 335), pt(10, 365), pt(-10, 365), pt(-10, 335)],
};

const hole = (id: number, ref: string, pts: ReturnType<typeof pt>[], extra: Record<string, string> = {}): OsmWay => ({
  type: 'way',
  id,
  tags: { golf: 'hole', ref, ...extra },
  geometry: pts,
});

describe('computeHoleTargets', () => {
  it('finds green center, front and back along the line of play', () => {
    const { holes } = computeHoleTargets([hole(1, '1', [pt(0, 0), pt(0, 200), pt(0, 350)], { par: '4', handicap: '7' }), green]);
    expect(holes).toHaveLength(1);
    const h = holes[0];
    expect(h).toMatchObject({ hole_number: 1, par: 4, par_estimated: false, handicap: 7 });
    const tee = { lat: LAT0, lng: LON0 };
    expect(haversineMeters(tee, h.green_center)).toBeCloseTo(350, 0);
    expect(haversineMeters(tee, h.green_front!)).toBeCloseTo(335, 0);
    expect(haversineMeters(tee, h.green_back!)).toBeCloseTo(365, 0);
  });

  it('reverses holes drawn green → tee', () => {
    const { holes } = computeHoleTargets([hole(1, '1', [pt(0, 350), pt(0, 0)]), green]);
    expect(haversineMeters({ lat: LAT0, lng: LON0 }, holes[0].green_front!)).toBeCloseTo(335, 0);
  });

  it('falls back to the line end without a mapped green and estimates par', () => {
    const { holes } = computeHoleTargets([hole(1, '5', [pt(0, 0), pt(0, 180)])]);
    expect(holes[0]).toMatchObject({ hole_number: 5, par: 3, par_estimated: true, green_front: null, green_back: null });
    expect(haversineMeters({ lat: LAT0, lng: LON0 }, holes[0].green_center)).toBeCloseTo(180, 0);
  });

  it('skips holes without a usable ref and duplicate numbers', () => {
    const { holes, skipped } = computeHoleTargets([
      hole(1, '1', [pt(0, 0), pt(0, 350)]),
      hole(2, '1', [pt(50, 0), pt(50, 350)]),
      hole(3, 'A', [pt(80, 0), pt(80, 350)]),
      green,
    ]);
    expect(holes.map((h) => h.hole_number)).toEqual([1]);
    expect(skipped.map((s) => s.wayId)).toEqual([2, 3]);
  });

  it('estimates par from length', () => {
    expect([150, 300, 480].map(estimatePar)).toEqual([3, 4, 5]);
  });
});
