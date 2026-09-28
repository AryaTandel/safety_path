-- ============================================================
-- Per-waypoint safety reviews (run this in the Supabase SQL editor)
--
-- The existing route_ratings table + get_area_risk_adjustments() only
-- nudges the risk of an EXISTING crime-zone circle up or down — it can't
-- create a new risk marker somewhere the map has no zone yet (e.g. a
-- station that was never flagged as a hotspot). That's the gap here:
-- individual points along a journey (a station, a stop, a locality) get
-- their own small "zone" once enough people have reviewed them, entirely
-- separate from the destination's own score.
--
-- Needs at least MIN_REVIEWS opinions for the SAME point and time-of-day
-- slot before it does anything, and only creates a risk zone when most of
-- those reviews say "unsafe" — a single bad review changes nothing.
-- ============================================================

create table if not exists waypoint_ratings (
  id          uuid primary key default gen_random_uuid(),
  lat         double precision not null,
  lng         double precision not null,
  place_name  text,
  time_slot   text not null check (time_slot in ('morning','afternoon','evening','night')),
  felt_unsafe boolean not null,
  voter_id    text,        -- an anonymous per-device id (localStorage), not a login — keeps feedback open to everyone
  user_id     uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_waypoint_ratings_loc on waypoint_ratings (lat, lng, time_slot);

alter table waypoint_ratings enable row level security;

create policy "anyone can submit a waypoint review"
  on waypoint_ratings for insert
  to anon, authenticated
  with check (true);

-- Individual reviews are never read back directly — only the aggregated
-- function below is, so who-said-what stays private.
create policy "no direct read access"
  on waypoint_ratings for select
  to anon, authenticated
  using (false);

-- Groups nearby reviews (~110 m grid) by time-of-day slot and turns any
-- well-supported, majority-unsafe cluster into a small synthetic risk
-- zone the app can treat exactly like one of its predefined crime zones
-- Fetched once (all slots at once); the app filters by slot client-side.
create or replace function get_waypoint_risk_zones()
returns table (lat double precision, lng double precision, radius int, risk numeric, time_slot text, rating_count bigint)
language sql stable as $$
  select
    round(lat::numeric, 3)::float8 as lat,
    round(lng::numeric, 3)::float8 as lng,
    180 as radius,
    round((5 + least(1, (avg(felt_unsafe::int) - 0.5) * 2) * 4)::numeric, 2) as risk,  -- 5 (bare majority) up to 9 (near-unanimous)
    time_slot,
    count(*) as rating_count
  from waypoint_ratings
  where created_at > now() - interval '180 days'
  group by round(lat::numeric, 3), round(lng::numeric, 3), time_slot
  having count(*) >= 5 and avg(felt_unsafe::int) > 0.5;
$$;

grant execute on function get_waypoint_risk_zones() to anon, authenticated;
