-- Generic monthly quota for paid AI features other than scorecard scans (first user: voice assist).
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('voice')),
  period text not null, -- 'YYYY-MM' (UTC)
  count int not null default 0,
  primary key (user_id, feature, period)
);

alter table public.ai_usage enable row level security;
create policy "ai_usage: owner read" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

-- Atomically consumes one use. Returns uses remaining this month, or -1 when the limit is reached.
create function public.consume_ai_quota(p_feature text, p_limit int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.ai_usage (user_id, feature, period, count) values (v_uid, p_feature, v_period, 1)
  on conflict (user_id, feature, period) do update set count = public.ai_usage.count + 1
    where public.ai_usage.count < p_limit
  returning count into v_count;

  if v_count is null then
    return -1;
  end if;
  return p_limit - v_count;
end;
$$;

revoke execute on function public.consume_ai_quota(text, int) from public, anon;
grant execute on function public.consume_ai_quota(text, int) to authenticated;
