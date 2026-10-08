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

/** "La Jolla, CA" — or just "CA" when OSM has no city for the course. */
export function courseLocation(c: Pick<CourseSummary, 'city' | 'state'>): string {
  return [c.city, c.state].filter(Boolean).join(', ');
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9가-힣 ]/g, ' ');

// Folded search text per course, computed once per data set (the full index has ~13k courses).
const searchText = new WeakMap<CourseSummary[], Array<{ hay: string; name: string }>>();

function foldedIndex(data: CourseSummary[]) {
  let folded = searchText.get(data);
  if (!folded) {
    folded = data.map((c) => ({ hay: fold(`${c.name} ${c.city} ${c.state}`), name: fold(c.name) }));
    searchText.set(data, folded);
  }
  return folded;
}

export function searchCourses(query: string, limit = 20, data: CourseSummary[] = load()): CourseSummary[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const folded = foldedIndex(data);
  const scored: Array<{ c: CourseSummary; score: number }> = [];
  for (let i = 0; i < data.length; i++) {
    const { hay, name } = folded[i];
    if (!terms.every((t) => hay.includes(t))) continue;
    scored.push({ c: data[i], score: name.startsWith(terms[0]) ? 0 : 1 });
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

/** Within this distance of a course's center you are taken to be at that course (big 36-hole sites included). */
export const AT_COURSE_METERS = 2_500;

/**
 * Courses the player is probably standing at: everything within AT_COURSE_METERS, closest first.
 * Falls back to the nearest few within 50 km (shown, never auto-picked) when none is that close.
 */
export function coursesHere(me: LatLng, data: CourseSummary[] = load()): { here: boolean; courses: Array<CourseSummary & { meters: number }> } {
  const near = nearestCourses(me, 5, 50_000, data);
  const here = near.filter((c) => c.meters <= AT_COURSE_METERS);
  return here.length ? { here: true, courses: here } : { here: false, courses: near };
}
