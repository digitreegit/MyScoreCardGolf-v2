-- MyScoreCard Golf v2 — initial schema
-- Privacy rule: no table stores a user's location. Course geometry is public reference data.

-- ─────────────────────────────────────────── profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text,
  distance_unit text not null default 'yards' check (distance_unit in ('yards', 'meters')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles: owner update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────── courses (public reference data)
create table public.courses (
  id text primary key, -- e.g. 'osm:way/123456' or 'sample:pebble-beach'
  name text not null,
  city text,
  state text,
  country text not null default 'US',
  lat double precision not null,
  lng double precision not null,
  holes_count int not null default 18,
  source text not null default 'osm',
  updated_at timestamptz not null default now()
);

create table public.course_holes (
  course_id text not null references public.courses (id) on delete cascade,
  hole_number int not null check (hole_number between 1 and 36),
  par int not null check (par between 3 and 6),
  handicap int,
  green_front_lat double precision,
  green_front_lng double precision,
  green_center_lat double precision not null,
  green_center_lng double precision not null,
  green_back_lat double precision,
  green_back_lng double precision,
  tee_yardages jsonb not null default '{}'::jsonb, -- {"blue": 410, "white": 385}
  primary key (course_id, hole_number)
);

create index courses_name_idx on public.courses using gin (to_tsvector('simple', name));

alter table public.courses enable row level security;
alter table public.course_holes enable row level security;
-- Read-only for everyone; writes only via service role (import scripts).
create policy "courses: public read" on public.courses for select to anon, authenticated using (true);
create policy "course_holes: public read" on public.course_holes for select to anon, authenticated using (true);

-- ─────────────────────────────────────────── rounds
create table public.rounds (
  id uuid primary key, -- generated on the client so offline-created rounds keep their id
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id text references public.courses (id) on delete set null,
  course_name text not null,
  tee_box text check (tee_box in ('black', 'blue', 'white', 'gold', 'silver', 'red', 'green')),
  companions text not null default '',
  played_on date not null,
  holes_count int not null check (holes_count in (9, 18)),
  entry_mode text not null default 'stroke' check (entry_mode in ('par', 'stroke')),
  exclude_from_stats boolean not null default false,
  notes text not null default '',
  source text not null default 'manual' check (source in ('manual', 'scan', 'voice', 'import', 'v1')),
  created_at timestamptz not null,
  updated_at timestamptz not null, -- client clock; last-write-wins key
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp() -- pull cursor
);

create table public.round_holes (
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade, -- denormalized for RLS + pull filtering
  hole_number int not null check (hole_number between 1 and 18),
  par int not null check (par between 3 and 6),
  strokes int check (strokes between 1 and 20),
  putts int check (putts between 0 and 10),
  fairway text check (fairway in ('hit', 'left', 'right', 'short', 'na')),
  penalties int check (penalties between 0 and 10),
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (round_id, hole_number)
);

create index rounds_user_sync_idx on public.rounds (user_id, server_updated_at);
create index round_holes_user_sync_idx on public.round_holes (user_id, server_updated_at);
create index rounds_user_played_idx on public.rounds (user_id, played_on desc);

create function public.touch_server_updated_at() returns trigger
language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger rounds_touch before insert or update on public.rounds
  for each row execute function public.touch_server_updated_at();
create trigger round_holes_touch before insert or update on public.round_holes
  for each row execute function public.touch_server_updated_at();

alter table public.rounds enable row level security;
alter table public.round_holes enable row level security;

create policy "rounds: owner select" on public.rounds for select to authenticated using (user_id = (select auth.uid()));
create policy "rounds: owner insert" on public.rounds for insert to authenticated with check (user_id = (select auth.uid()));
create policy "rounds: owner update" on public.rounds for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy: deletes are soft (deleted_at) so they propagate to other devices.

create policy "round_holes: owner select" on public.round_holes for select to authenticated using (user_id = (select auth.uid()));
create policy "round_holes: owner insert" on public.round_holes for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.rounds r where r.id = round_id and r.user_id = (select auth.uid()))
);
create policy "round_holes: owner update" on public.round_holes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ─────────────────────────────────────────── sync
-- Batch upsert with last-write-wins on the client-side updated_at.
-- Runs as the caller (security invoker), so the RLS policies above still apply.
create function public.sync_push(p_rounds jsonb, p_holes jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into rounds (id, user_id, course_id, course_name, tee_box, companions, played_on, holes_count,
                      entry_mode, exclude_from_stats, notes, source, created_at, updated_at, deleted_at)
  select r.id, auth.uid(), r.course_id, r.course_name, r.tee_box, coalesce(r.companions, ''), r.played_on,
         r.holes_count, r.entry_mode, coalesce(r.exclude_from_stats, false), coalesce(r.notes, ''), r.source,
         r.created_at, r.updated_at, r.deleted_at
  from jsonb_to_recordset(coalesce(p_rounds, '[]'::jsonb)) as r(
    id uuid, course_id text, course_name text, tee_box text, companions text, played_on date, holes_count int,
    entry_mode text, exclude_from_stats boolean, notes text, source text, created_at timestamptz,
    updated_at timestamptz, deleted_at timestamptz)
  on conflict (id) do update set
    course_id = excluded.course_id,
    course_name = excluded.course_name,
    tee_box = excluded.tee_box,
    companions = excluded.companions,
    played_on = excluded.played_on,
    holes_count = excluded.holes_count,
    entry_mode = excluded.entry_mode,
    exclude_from_stats = excluded.exclude_from_stats,
    notes = excluded.notes,
    source = excluded.source,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
  where rounds.updated_at < excluded.updated_at;

  insert into round_holes (round_id, user_id, hole_number, par, strokes, putts, fairway, penalties, updated_at)
  select h.round_id, auth.uid(), h.hole_number, h.par, h.strokes, h.putts, h.fairway, h.penalties, h.updated_at
  from jsonb_to_recordset(coalesce(p_holes, '[]'::jsonb)) as h(
    round_id uuid, hole_number int, par int, strokes int, putts int, fairway text, penalties int,
    updated_at timestamptz)
  on conflict (round_id, hole_number) do update set
    par = excluded.par,
    strokes = excluded.strokes,
    putts = excluded.putts,
    fairway = excluded.fairway,
    penalties = excluded.penalties,
    updated_at = excluded.updated_at
  where round_holes.updated_at < excluded.updated_at;
end;
$$;

revoke execute on function public.sync_push(jsonb, jsonb) from public, anon;
grant execute on function public.sync_push(jsonb, jsonb) to authenticated;

-- ─────────────────────────────────────────── scan quota (paid LLM feature)
create table public.scan_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  period text not null, -- 'YYYY-MM' (UTC)
  count int not null default 0,
  primary key (user_id, period)
);

alter table public.scan_usage enable row level security;
create policy "scan_usage: owner read" on public.scan_usage for select to authenticated using (user_id = (select auth.uid()));

-- Atomically consumes one scan. Returns scans remaining this month, or -1 when the limit is reached.
create function public.consume_scan_quota(p_limit int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.scan_usage (user_id, period, count) values (v_uid, v_period, 1)
  on conflict (user_id, period) do update set count = public.scan_usage.count + 1
    where public.scan_usage.count < p_limit
  returning count into v_count;

  if v_count is null then
    return -1;
  end if;
  return p_limit - v_count;
end;
$$;

revoke execute on function public.consume_scan_quota(int) from public, anon;
grant execute on function public.consume_scan_quota(int) to authenticated;
