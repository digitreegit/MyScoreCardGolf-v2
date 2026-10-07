// Course geometry (pars + green targets) from the course-geometry edge function, which serves the
// Supabase cache or builds it from OpenStreetMap on first use. Only the course id is sent — never
// the user's location.
import type { GreenPoints } from '@/domain/geo';
import { getSupabase } from '@/lib/supabase';

export interface CourseHoleDetail {
  hole_number: number;
  par: number;
  handicap: number | null;
  green: GreenPoints;
  tee_yardages: Record<string, number>;
}

export interface CourseDetail {
  id: string;
  name: string;
  holes: CourseHoleDetail[];
}

export async function fetchCourseDetail(id: string): Promise<CourseDetail | null> {
  const { data, error } = await getSupabase().functions.invoke<{ course: CourseDetail }>('course-geometry', {
    body: { courseId: id },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 404 || status === 400) return null; // not an OSM golf course id (e.g. old sample ids)
    throw error;
  }
  return data?.course ?? null;
}
