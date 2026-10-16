-- ============================================================
-- Multiple emergency contacts per user (run in the Supabase SQL editor)
--
-- Before: one contact, stored as users.emergency_contact / _phone / _email.
-- Now:    up to 5 contacts per user in this table. SOS emails all of them.
--
-- name / phone / email hold CIPHERTEXT — js/emergency-contacts.js encrypts
-- them client-side (same AES-GCM key as the rest of the profile, crypto.js)
-- before they reach Supabase. RLS below restricts rows to their owner.
--
-- The old users.emergency_* columns are kept and always mirror the PRIMARY
-- contact, so nothing that still reads them breaks. Existing users' single
-- contact is copied into this table automatically the first time they open
-- the dashboard (it has to happen client-side because only the browser can
-- decrypt/re-encrypt it — nothing to backfill here).
-- ============================================================

create table if not exists emergency_contacts (
  id          uuid primary key default gen_random_uuid(),
  auth_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,            -- encrypted
  phone       text not null default '', -- encrypted
  email       text not null default '', -- encrypted
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_emergency_contacts_auth on emergency_contacts (auth_id, created_at);

alter table emergency_contacts enable row level security;

create policy "user can read own contacts"
  on emergency_contacts for select to authenticated
  using (auth.uid() = auth_id);

create policy "user can insert own contacts"
  on emergency_contacts for insert to authenticated
  with check (auth.uid() = auth_id);

create policy "user can update own contacts"
  on emergency_contacts for update to authenticated
  using (auth.uid() = auth_id)
  with check (auth.uid() = auth_id);

create policy "user can delete own contacts"
  on emergency_contacts for delete to authenticated
  using (auth.uid() = auth_id);

-- Hard cap of 5 contacts per user (the UI enforces it too; this stops it
-- being bypassed from the browser console).
create or replace function enforce_emergency_contact_limit()
returns trigger language plpgsql as $$
begin
  if (select count(*) from emergency_contacts where auth_id = new.auth_id) >= 5 then
    raise exception 'You can save at most 5 emergency contacts';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_emergency_contact_limit on emergency_contacts;
create trigger trg_emergency_contact_limit
  before insert on emergency_contacts
  for each row execute function enforce_emergency_contact_limit();

-- Only one primary contact per user.
create unique index if not exists uq_emergency_contacts_one_primary
  on emergency_contacts (auth_id) where is_primary;
