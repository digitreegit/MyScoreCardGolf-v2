-- Broadcast round changes so a phone and the web app see each other's edits without reopening.
-- Realtime postgres_changes respects RLS, so subscribers only receive their own rows.
alter publication supabase_realtime add table public.rounds, public.round_holes;
