-- ============================================================
-- Voice ID profiles for SOS voice verification
-- (run this in the Supabase SQL editor)
--
-- js/voice-auth.js reads/writes this table to decide whether an SOS
-- check-in "I'm safe" needs to match the enrolled user's own voice.
-- If this table doesn't exist yet in your project, every call to
-- hasVoiceProfile() / verifyVoiceSample() fails silently (the code
-- catches the error and just returns "no profile"), which makes SOS
-- fall back to the plain manual "Tap Instead" confirmation and looks
-- exactly like "the app isn't recognising my voice" — because it
-- never even got to check. Running this migration is what's missing.
--
-- TWO profiles per user, on purpose:
--   registration_voiceprint / registration_language
--     — written ONCE, the very first time this user ever enrolls a
--       voice (normally during sign-up). Never overwritten again,
--       even if they later re-enroll from the dashboard. This is the
--       permanent fallback.
--   latest_voiceprint / latest_language
--     — overwritten every time the user (re-)enrolls, from anywhere
--       (sign-up or dashboard). This is what SOS checks first.
-- verifyVoiceSample() in js/voice-auth.js checks the sample against
-- "latest" first, and — only if that doesn't match — against
-- "registration" as a second chance.
--
-- IMPORTANT — if you already ran an earlier version of this file, it
-- left the table with an old `voiceprint` (singular) column that is
-- `NOT NULL`. The app never writes to that column anymore (it writes
-- `latest_voiceprint`/`registration_voiceprint` instead), so every new
-- enrollment was failing with:
--   "null value in column "voiceprint" of relation "voice_profiles"
--    violates not-null constraint"
-- This version fixes that by backfilling from it and then DROPPING it
-- (and its `language` companion column) once the data is safely copied
-- over. Safe to re-run any number of times.
-- ============================================================

create table if not exists voice_profiles (
  auth_id                uuid primary key references auth.users(id) on delete cascade,
  registration_voiceprint text,                -- set once, first enrollment ever; never overwritten after that
  registration_language   text,
  latest_voiceprint       text,                 -- most recent enrollment (same as registration until re-enrolled)
  latest_language         text not null default 'en',
  sample_count            int not null default 3,
  updated_at              timestamptz not null default now()
);

-- Upgrading an older install that only had a single `voiceprint`/`language`
-- column: add the new columns if missing, backfill from the old ones, then
-- drop the old ones outright (rather than just relaxing NOT NULL) so the app
-- never has to satisfy a legacy column it doesn't know about again.
alter table voice_profiles add column if not exists registration_voiceprint text;
alter table voice_profiles add column if not exists registration_language text;
alter table voice_profiles add column if not exists latest_voiceprint text;
alter table voice_profiles add column if not exists latest_language text not null default 'en';

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'voice_profiles' and column_name = 'voiceprint') then
    update voice_profiles set
      latest_voiceprint = coalesce(latest_voiceprint, voiceprint),
      registration_voiceprint = coalesce(registration_voiceprint, voiceprint),
      latest_language = coalesce(latest_language, language, 'en'),
      registration_language = coalesce(registration_language, language, 'en');

    alter table voice_profiles drop column voiceprint;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'voice_profiles' and column_name = 'language') then
    alter table voice_profiles drop column language;
  end if;
end $$;

alter table voice_profiles enable row level security;

drop policy if exists "users manage their own voice profile" on voice_profiles;
create policy "users manage their own voice profile"
  on voice_profiles for all
  to authenticated
  using (auth.uid() = auth_id)
  with check (auth.uid() = auth_id);
