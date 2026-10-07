// Returns per-hole green targets for a course. Served from public.course_holes when cached;
// otherwise fetched once from OpenStreetMap (Overpass), computed, stored, and returned.
//
// Called with only a course id from the bundled index (e.g. "osm:way/35679036"). No user data or
// location is involved, so guests can call it (verify_jwt = false in supabase/config.toml).

import { createClient } from 'npm:@supabase/supabase-js@2';

import { computeHoleTargets, type OsmWay } from '../_shared/courseGeometry.ts';
import { corsHeaders, json } from '../_shared/http.ts';

// Public Overpass instances, tried in order. They are shared community servers with different
// rate limits and client policies (overpass-api.de rejects the edge runtime's default user agent),
// so one being unavailable must not break GPS. Results are cached, so each course is fetched once.
const OVERPASS_URLS = (
  Deno.env.get('OVERPASS_URLS') ??
  'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.private.coffee/api/interpreter'
).split(',');
const REFRESH_EMPTY_AFTER_DAYS = 30; // re-check courses that had no mapped holes

interface HoleRow {
  hole_number: number;
  par: number;
  par_estimated: boolean;
  handicap: number | null;
  green_front_lat: number | null;
  green_front_lng: number | null;
  green_center_lat: number;
  green_center_lng: number;
  green_back_lat: number | null;
  green_back_lng: number | null;
  tee_yardages: Record<string, number>;
}

function toDetail(id: string, name: string, rows: HoleRow[]) {
  const point = (lat: number | null, lng: number | null) => (lat != null && lng != null ? { lat, lng } : null);
  return {
    id,
    name,
    holes: rows
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
      .sort((a, b) => a.hole_number - b.hole_number),
  };
}

async function fetchOsm(type: 'way' | 'relation', osmId: string) {
  const query = `
    [out:json][timeout:60];
    ${type}(${osmId})->.course;
    .course map_to_area->.a;
    (way["golf"="hole"](area.a); way["golf"="green"](area.a););
    out geom tags;
    .course out center tags;
  `;
  let res: Response | null = null;
  const failures: string[] = [];
  for (const url of OVERPASS_URLS) {
    try {
      const attempt = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MyScoreCardGolf/2 (course geometry cache)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(45_000),
      });
      if (attempt.ok) {
        res = attempt;
        break;
      }
      failures.push(`${new URL(url).host} ${attempt.status}`);
    } catch (err) {
      failures.push(`${new URL(url).host} ${(err as Error).name}`);
    }
  }
  if (!res) throw new Error(failures.join(', '));
  const { elements } = (await res.json()) as { elements: Array<OsmWay & { center?: { lat: number; lon: number } }> };
  const course = elements.find((e) => e.type === type && String(e.id) === osmId);
  return { elements, course };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let courseId: string | undefined;
  try {
    ({ courseId } = await req.json());
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const m = courseId?.match(/^osm:(way|relation)\/(\d{1,12})$/);
  if (!courseId || !m) return json({ error: 'invalid_course_id' }, 400);
  const [, type, osmId] = m as unknown as [string, 'way' | 'relation', string];

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: cached, error: readError } = await db
    .from('courses')
    .select('id, name, geometry_fetched_at, course_holes(*)')
    .eq('id', courseId)
    .maybeSingle();
  if (readError) return json({ error: 'db_read_failed' }, 500);

  const holes = (cached?.course_holes ?? []) as HoleRow[];
  const fetchedAt = cached?.geometry_fetched_at ? new Date(cached.geometry_fetched_at).getTime() : 0;
  const emptyIsStale = Date.now() - fetchedAt > REFRESH_EMPTY_AFTER_DAYS * 86_400_000;
  if (cached && (holes.length > 0 || !emptyIsStale)) {
    return json({ course: toDetail(courseId, cached.name, holes), source: 'cache' });
  }

  let osm;
  try {
    osm = await fetchOsm(type, osmId);
  } catch (err) {
    return json({ error: 'osm_unavailable', detail: String((err as Error).message ?? err) }, 503);
  }
  if (!osm.course || osm.course.tags?.leisure !== 'golf_course') return json({ error: 'not_a_golf_course' }, 404);

  const { holes: targets } = computeHoleTargets(osm.elements);
  const center = osm.course.center ?? { lat: targets[0]?.green_center.lat ?? 0, lon: targets[0]?.green_center.lng ?? 0 };
  const name = osm.course.tags?.name ?? cached?.name ?? 'Golf course';

  const { error: courseError } = await db.from('courses').upsert({
    id: courseId,
    name,
    lat: center.lat,
    lng: center.lon,
    holes_count: targets.length || 18,
    source: 'osm',
    geometry_fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (courseError) return json({ error: 'db_write_failed' }, 500);

  const rows: HoleRow[] = targets.map((t) => ({
    hole_number: t.hole_number,
    par: t.par,
    par_estimated: t.par_estimated,
    handicap: t.handicap,
    green_front_lat: t.green_front?.lat ?? null,
    green_front_lng: t.green_front?.lng ?? null,
    green_center_lat: t.green_center.lat,
    green_center_lng: t.green_center.lng,
    green_back_lat: t.green_back?.lat ?? null,
    green_back_lng: t.green_back?.lng ?? null,
    tee_yardages: {},
  }));
  if (rows.length) {
    const { error: holesError } = await db
      .from('course_holes')
      .upsert(rows.map((r) => ({ ...r, course_id: courseId })), { onConflict: 'course_id,hole_number' });
    if (holesError) return json({ error: 'db_write_failed' }, 500);
  }

  return json({ course: toDetail(courseId, name, rows), source: 'osm' });
});
