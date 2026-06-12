-- Pickleball Scheduler — Supabase schema
-- Run this once in the Supabase SQL editor for a fresh project.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.groups (
  id            uuid primary key default gen_random_uuid(),
  name          text unique not null check (length(name) between 2 and 40),
  slug          text unique not null,
  leader_email  text not null,
  auth_user_id  uuid unique references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create table if not exists public.members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.groups(id) on delete cascade,
  name      text not null,
  ordinal   int  not null check (ordinal between 1 and 6),
  unique (group_id, ordinal)
);

create table if not exists public.bookings (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  slot_date     date not null,
  slot_hour     int  not null check (slot_hour between 0 and 23),
  is_extension  boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (slot_date, slot_hour)
);

create index if not exists bookings_group_date_idx on public.bookings(group_id, slot_date);
create index if not exists bookings_date_idx       on public.bookings(slot_date);

create table if not exists public.swap_requests (
  id                    uuid primary key default gen_random_uuid(),
  requesting_group_id   uuid not null references public.groups(id) on delete cascade,
  target_booking_id     uuid not null references public.bookings(id) on delete cascade,
  message               text,
  status                text not null default 'pending'
                        check (status in ('pending','accepted','declined','cancelled')),
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

create index if not exists swap_requests_target_idx on public.swap_requests(target_booking_id);

-- ============================================================
-- Helpers
-- ============================================================

create or replace function public.iso_week_start(d date)
returns date language sql immutable as $$
  select (d - ((extract(isodow from d)::int - 1)))::date;
$$;

-- ============================================================
-- Trigger: enforce booking rules
--   * same hour <= 2x per ISO week per group (extensions exempt)
--   * <= 16 bookings per ISO week per group
--   * extensions: prior hour must already be booked by same group,
--                 and current time must be past prior slot's half mark
-- ============================================================

create or replace function public.enforce_booking_rules()
returns trigger language plpgsql as $$
declare
  v_week_start      date;
  v_week_end        date;
  v_same_hour_count int;
  v_week_total      int;
  v_prev_start      timestamptz;
begin
  v_week_start := public.iso_week_start(new.slot_date);
  v_week_end   := v_week_start + 6;

  if not new.is_extension then
    select count(*) into v_same_hour_count
      from public.bookings
     where group_id = new.group_id
       and slot_hour = new.slot_hour
       and slot_date between v_week_start and v_week_end
       and (tg_op = 'INSERT' or id <> new.id);

    if v_same_hour_count >= 2 then
      raise exception 'Your group already has 2 bookings at hour % this week', new.slot_hour
        using errcode = 'check_violation';
    end if;
  end if;

  select count(*) into v_week_total
    from public.bookings
   where group_id = new.group_id
     and slot_date between v_week_start and v_week_end
     and (tg_op = 'INSERT' or id <> new.id);

  if v_week_total >= 16 then
    raise exception 'Weekly limit of 16 bookings reached'
      using errcode = 'check_violation';
  end if;

  if new.is_extension then
    if new.slot_hour = 0 then
      raise exception 'Cannot extend across midnight';
    end if;

    if not exists (
      select 1 from public.bookings
       where group_id  = new.group_id
         and slot_date = new.slot_date
         and slot_hour = new.slot_hour - 1
    ) then
      raise exception 'Extension requires an existing booking in the prior hour';
    end if;

    v_prev_start := (new.slot_date::text || ' ' || (new.slot_hour - 1)::text || ':00:00')::timestamptz;
    if now() < v_prev_start + interval '30 minutes' then
      raise exception 'Extensions are allowed only after the current slot reaches its halfway mark';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_enforce_rules on public.bookings;
create trigger bookings_enforce_rules
  before insert or update on public.bookings
  for each row execute function public.enforce_booking_rules();

-- ============================================================
-- RLS
-- ============================================================

alter table public.groups        enable row level security;
alter table public.members       enable row level security;
alter table public.bookings      enable row level security;
alter table public.swap_requests enable row level security;

-- Community-readable
drop policy if exists groups_read   on public.groups;
drop policy if exists members_read  on public.members;
drop policy if exists bookings_read on public.bookings;
drop policy if exists swaps_read    on public.swap_requests;

create policy groups_read   on public.groups        for select using (true);
create policy members_read  on public.members       for select using (true);
create policy bookings_read on public.bookings      for select using (true);
create policy swaps_read    on public.swap_requests for select using (true);

-- Groups: signed-in user can create exactly one group tied to their uid; can update/delete own
drop policy if exists groups_insert_self on public.groups;
drop policy if exists groups_update_self on public.groups;
drop policy if exists groups_delete_self on public.groups;

create policy groups_insert_self on public.groups
  for insert with check (auth_user_id = auth.uid());
create policy groups_update_self on public.groups
  for update using (auth_user_id = auth.uid());
create policy groups_delete_self on public.groups
  for delete using (auth_user_id = auth.uid());

-- Members: managed by owning group
drop policy if exists members_write_own on public.members;
create policy members_write_own on public.members
  for all
  using      (group_id in (select id from public.groups where auth_user_id = auth.uid()))
  with check (group_id in (select id from public.groups where auth_user_id = auth.uid()));

-- Bookings: insert/delete only for own group
drop policy if exists bookings_insert_own on public.bookings;
drop policy if exists bookings_delete_own on public.bookings;

create policy bookings_insert_own on public.bookings
  for insert with check (
    group_id in (select id from public.groups where auth_user_id = auth.uid())
  );
create policy bookings_delete_own on public.bookings
  for delete using (
    group_id in (select id from public.groups where auth_user_id = auth.uid())
  );

-- Swap requests: creator can insert/cancel, target booking owner can accept/decline
drop policy if exists swaps_insert_own         on public.swap_requests;
drop policy if exists swaps_update_participant on public.swap_requests;

create policy swaps_insert_own on public.swap_requests
  for insert with check (
    requesting_group_id in (select id from public.groups where auth_user_id = auth.uid())
  );

create policy swaps_update_participant on public.swap_requests
  for update using (
    requesting_group_id in (select id from public.groups where auth_user_id = auth.uid())
    or exists (
      select 1
        from public.bookings b
        join public.groups   g on g.id = b.group_id
       where b.id = target_booking_id
         and g.auth_user_id = auth.uid()
    )
  );

-- ============================================================
-- View: bookings with group names (handy for the schedule grid)
-- ============================================================
create or replace view public.bookings_view as
  select b.id,
         b.group_id,
         g.name as group_name,
         g.slug as group_slug,
         b.slot_date,
         b.slot_hour,
         b.is_extension,
         b.created_at
    from public.bookings b
    join public.groups g on g.id = b.group_id;

grant select on public.bookings_view to anon, authenticated;
