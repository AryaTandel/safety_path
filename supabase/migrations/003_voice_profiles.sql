-- ============================================================
-- Voice ID profiles for SOS check-in verification
-- (run this in the Supabase SQL editor if the table doesn't already exist)
--
-- Used by js/voice-auth.js: enrollUserVoice() writes here, hasVoiceProfile()
-- and verifyVoiceSample() read from here. One row per user (auth_id is the
-- Supabase Auth user id — the same uuid as auth.uid() for that user).
--
-- The stored "voiceprint" JSON blob is already encrypted client-side
-- (crypto.js) before it ever reaches Supabase, so this table only ever
-- holds ciphertext — but RLS below still restricts it to the owning user.
-- ============================================================

create table if not exists voice_profiles (
  auth_id      uuid primary key references auth.users(id) on delete cascade,
  voiceprint   text not null,        -- encrypted JSON: {spectralVectors, pitchValues}
  sample_count int not null default 3,
  updated_at   timestamptz not null default now()
);

alter table voice_profiles enable row level security;

-- A user can only see/create/update/delete their OWN voice profile.
create policy "user can read own voice profile"
  on voice_profiles for select
  to authenticated
  using (auth.uid() = auth_id);

create policy "user can insert own voice profile"
  on voice_profiles for insert
  to authenticated
  with check (auth.uid() = auth_id);

create policy "user can update own voice profile"
  on voice_profiles for update
  to authenticated
  using (auth.uid() = auth_id)
  with check (auth.uid() = auth_id);

create policy "user can delete own voice profile"
  on voice_profiles for delete
  to authenticated
  using (auth.uid() = auth_id);
