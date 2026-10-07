-- rounds.course_id holds an id from the bundled on-device course index (assets/courses/us-index.json,
-- ~16k US courses). public.courses only has the subset with hole geometry, so a foreign key rejected
-- every round played at a course without GPS data. Keep it as a plain reference.
alter table public.rounds drop constraint if exists rounds_course_id_fkey;

create index if not exists rounds_course_id_idx on public.rounds (course_id);
