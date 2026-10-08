// Pars for a new round, best source first:
//   1. the player's own latest round at this course (they saw the real card)
//   2. OpenStreetMap hole data via course-geometry (cached on the phone after the first fetch)
//   3. a typical par-72 layout, fixed by tapping the par on the score screen
import { listRounds } from '@/data/repository';
import { parsFromHistory } from '@/domain/scoring';
import { DEFAULT_PARS_18 } from '@/domain/types';

import { getCourseDetail } from './courseDetail';

export type ParSource = 'history' | 'map' | 'default';

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

export async function parsForCourse(
  course: { id: string | null; name: string },
  holesCount: 9 | 18,
  mapTimeoutMs = 8_000,
): Promise<{ pars: number[]; source: ParSource }> {
  const fromHistory = parsFromHistory(await listRounds(), course, holesCount);
  if (fromHistory) return { pars: fromHistory, source: 'history' };

  if (course.id) {
    // First fetch of an unmapped course can take a while (Overpass); don't hold up the first tee.
    const detail = await withTimeout(getCourseDetail(course.id).catch(() => null), mapTimeoutMs);
    const byHole = new Map(detail?.holes.map((h) => [h.hole_number, h.par]));
    const pars = Array.from({ length: holesCount }, (_, i) => byHole.get(i + 1));
    if (pars.every((p): p is number => p != null)) return { pars, source: 'map' };
  }
  return { pars: DEFAULT_PARS_18.slice(0, holesCount), source: 'default' };
}
