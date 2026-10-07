// Course geometry (pars + green coordinates) downloaded from Supabase. Public data: no user info is sent.
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

interface HoleRow {
  hole_number: number;
  par: number;
  handicap: number | null;
  green_front_lat: number | null;
  green_front_lng: number | null;
  green_center_lat: number;
  green_center_lng: number;
  green_back_lat: number | null;
  green_back_lng: number | null;
  tee_yardages: Record<string, number> | null;
}

const point = (lat: number | null, lng: number | null) => (lat != null && lng != null ? { lat, lng } : null);

export async function fetchCourseDetail(id: string): Promise<CourseDetail | null> {
  const { data, error } = await getSupabase()
    .from('courses')
    .select('id, name, course_holes(*)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const holes = ((data.course_holes ?? []) as HoleRow[])
    .map((h) => ({
      hole_number: h.hole_number,
      par: h.par,
      handicap: h.handicap,
      green: {
        front: point(h.green_front_lat, h.green_front_lng),
        center: { lat: h.green_center_lat, lng: h.green_center_lng },
        back: point(h.green_back_lat, h.green_back_lng),
      },
      tee_yardages: h.tee_yardages ?? {},
    }))
    .sort((a, b) => a.hole_number - b.hole_number);
  return { id: data.id as string, name: data.name as string, holes };
}
