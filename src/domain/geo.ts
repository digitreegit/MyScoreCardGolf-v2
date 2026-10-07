// Distance math for the GPS feature. Runs only on the device: the user's position
// is never sent to any server (see CLAUDE.md "Location privacy").

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_YARD = 0.9144;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export type DistanceUnit = 'yards' | 'meters';

export function formatDistance(meters: number, unit: DistanceUnit): number {
  return Math.round(unit === 'yards' ? meters / M_PER_YARD : meters);
}

export interface GreenPoints {
  front: LatLng | null;
  center: LatLng;
  back: LatLng | null;
}

export interface GreenDistances {
  front: number | null;
  center: number;
  back: number | null;
}

export function greenDistances(me: LatLng, green: GreenPoints, unit: DistanceUnit): GreenDistances {
  const d = (p: LatLng) => formatDistance(haversineMeters(me, p), unit);
  return {
    front: green.front ? d(green.front) : null,
    center: d(green.center),
    back: green.back ? d(green.back) : null,
  };
}

/** Index of the nearest item by straight-line distance; used for on-device course matching. */
export function nearestIndex<T extends LatLng>(me: LatLng, items: T[], maxMeters = Infinity): number {
  let best = -1;
  let bestD = maxMeters;
  for (let i = 0; i < items.length; i++) {
    const dist = haversineMeters(me, items[i]);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  return best;
}
