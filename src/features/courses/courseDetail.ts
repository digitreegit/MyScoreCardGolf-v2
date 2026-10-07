// Native: serve course geometry from the SQLite cache so GPS keeps working without signal on the course.
import { getCachedCourse, putCachedCourse } from '@/data/local/db';
import { nowIso } from '@/domain/types';
import { isBackendConfigured } from '@/lib/env';

import { fetchCourseDetail, type CourseDetail } from './courseApi';

export type { CourseDetail } from './courseApi';

export async function getCourseDetail(id: string): Promise<CourseDetail | null> {
  const cached = await getCachedCourse(id);
  if (cached) return JSON.parse(cached) as CourseDetail;
  if (!isBackendConfigured) return null;
  const fresh = await fetchCourseDetail(id);
  // Courses without mapped holes aren't cached, so geometry added to OSM later still reaches the phone.
  if (fresh?.holes.length) await putCachedCourse(id, JSON.stringify(fresh), nowIso());
  return fresh;
}

/** Call when a round is created so the course is on the phone before the first tee. */
export async function prefetchCourse(id: string): Promise<void> {
  try {
    await getCourseDetail(id);
  } catch {
    // Offline at creation time; the GPS screen retries.
  }
}
