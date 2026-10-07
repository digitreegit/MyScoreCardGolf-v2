// Bundled index of US golf courses (id, name, city, state, lat, lng), searched entirely on the device.
// "Nearby courses" therefore never sends the user's location anywhere.
// Regenerate the data with `npm run build:course-index` (OpenStreetMap, ODbL — attribution required).

import { haversineMeters, type LatLng } from '@/domain/geo';

export type CourseIndexTuple = [id: string, name: string, city: string, state: string, lat: number, lng: number];

export interface CourseSummary extends LatLng {
  id: string;
  name: string;
  city: string;
  state: string;
}

let cache: CourseSummary[] | null = null;

function load(): CourseSummary[] {
  if (!cache) {
    const raw = require('@/assets/courses/us-index.json') as CourseIndexTuple[];
    cache = raw.map(([id, name, city, state, lat, lng]) => ({ id, name, city, state, lat, lng }));
  }
  return cache;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9가-힣 ]/g, ' ');

export function searchCourses(query: string, limit = 20, data: CourseSummary[] = load()): CourseSummary[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: Array<{ c: CourseSummary; score: number }> = [];
  for (const c of data) {
    const hay = fold(`${c.name} ${c.city} ${c.state}`);
    if (!terms.every((t) => hay.includes(t))) continue;
    const name = fold(c.name);
    scored.push({ c, score: name.startsWith(terms[0]) ? 0 : 1 });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((s) => s.c);
}

export function nearestCourses(
  me: LatLng,
  limit = 5,
  maxMeters = 50_000,
  data: CourseSummary[] = load(),
): Array<CourseSummary & { meters: number }> {
  return data
    .map((c) => ({ ...c, meters: haversineMeters(me, c) }))
    .filter((c) => c.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}
