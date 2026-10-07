-- Hole geometry is fetched from OpenStreetMap on first request (edge function course-geometry)
-- and cached here. geometry_fetched_at marks courses already looked up, including ones with no
-- mapped holes, so they are not re-queried on every request.
alter table public.courses add column if not exists geometry_fetched_at timestamptz;
alter table public.course_holes add column if not exists par_estimated boolean not null default false;
