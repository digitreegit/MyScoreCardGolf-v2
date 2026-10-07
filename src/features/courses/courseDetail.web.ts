// Web: no offline cache. Same exports as courseDetail.ts.
import { isBackendConfigured } from '@/lib/env';

import { fetchCourseDetail, type CourseDetail } from './courseApi';

export type { CourseDetail } from './courseApi';

export async function getCourseDetail(id: string): Promise<CourseDetail | null> {
  return isBackendConfigured ? fetchCourseDetail(id) : null;
}

export async function prefetchCourse(_id: string): Promise<void> {}
