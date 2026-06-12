-- ============================================================
-- Pickleball Scheduler — schema v2 (additive)
--
-- Adds individual user accounts and a join-request flow on top
-- of the original PIN-based group schema. Run AFTER schema.sql
-- in the Supabase SQL editor. Safe to re-run (uses IF NOT EXISTS
-- everywhere).
-- ============================================================

-- ------------------------------------------------------------
-- Profiles: one row per individual user (auth.users.id is the PK)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (length(display_name) between 2 and 60),
  email         text not null,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;

-- Display names are public so groups can show "joined: Alice, Bob, …".
create policy profiles_read   on public.profiles for select using (true);
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using      (id = auth.uid());

-- ------------------------------------------------------------
-- Members ← optionally link to an individual auth user
-- ------------------------------------------------------------
alter table public.members
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create index if not exists members_auth_user_idx on public.members(auth_user_id);

-- Optional: prevent the same individual from holding two seats in one group.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'members_unique_user_per_group'
  ) then
    alter table public.members
      add constraint members_unique_user_per_group
      unique (group_id, auth_user_id);
  end if;
end $$;

-- ------------------------------------------------------------
-- Join requests
-- ------------------------------------------------------------
create table if not exists public.join_requests (
  id             uuid primary key default gen_random_uuid(),
  individual_id  uuid not null references auth.users(id) on delete cascade,
  group_id       uuid not null references public.groups(id) on delete cascade,
  message        text,
  status         text not null default 'pending'
                 check (status in ('pending','accepted','declined','cancelled')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists join_requests_group_idx      on public.join_requests(group_id);
create index if not exists join_requests_individual_idx on public.join_requests(individual_id);

-- At most one pending request per (individual, group).
create unique index if not exists join_requests_pending_unique
  on public.join_requests (individual_id, group_id)
  where status = 'pending';

alter table public.join_requests enable row level security;

drop policy if exists joins_read           on public.join_requests;
drop policy if exists joins_insert         on public.join_requests;
drop policy if exists joins_update_parties on public.join_requests;

-- Visible to the requesting individual and to the captain of the target group.
create policy joins_read on public.join_requests for select using (
  individual_id = auth.uid()
  or group_id in (select id from public.groups where auth_user_id = auth.uid())
);

create policy joins_insert on public.join_requests for insert with check (
  individual_id = auth.uid()
);

create policy joins_update_parties on public.join_requests for update using (
  individual_id = auth.uid()
  or group_id in (select id from public.groups where auth_user_id = auth.uid())
);

-- ------------------------------------------------------------
-- Bookings RLS: allow joined members to book on behalf of their group
-- ------------------------------------------------------------
drop policy if exists bookings_insert_own on public.bookings;
drop policy if exists bookings_delete_own on public.bookings;

create policy bookings_insert_own on public.bookings
  for insert with check (
    group_id in (
      select id       from public.groups  where auth_user_id = auth.uid()
      union
      select group_id from public.members where auth_user_id = auth.uid()
    )
  );

create policy bookings_delete_own on public.bookings
  for delete using (
    group_id in (
      select id       from public.groups  where auth_user_id = auth.uid()
      union
      select group_id from public.members where auth_user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- Members RLS: captain can manage all rows; an individual can
-- remove themselves (leave the group).
-- ------------------------------------------------------------
drop policy if exists members_write_own     on public.members;
drop policy if exists members_write_captain on public.members;
drop policy if exists members_delete_self   on public.members;

create policy members_write_captain on public.members
  for all
  using      (group_id in (select id from public.groups where auth_user_id = auth.uid()))
  with check (group_id in (select id from public.groups where auth_user_id = auth.uid()));

create policy members_delete_self on public.members
  for delete using (auth_user_id = auth.uid());

-- ------------------------------------------------------------
-- A view for the groups browse page: name, member count, captain auth_user_id.
-- ------------------------------------------------------------
create or replace view public.groups_directory as
  select
    g.id,
    g.name,
    g.slug,
    g.created_at,
    g.auth_user_id          as captain_auth_user_id,
    (select count(*) from public.members m where m.group_id = g.id) as member_count
  from public.groups g;

grant select on public.groups_directory to anon, authenticated;

-- ------------------------------------------------------------
-- Helper RPC: look up a group's auth email by group name.
--
-- We don't want to expose `groups.leader_email` to every anon client
-- via a normal SELECT. Group login needs it, though, so we expose
-- a narrow SECURITY DEFINER function that returns only the email
-- string for one group name. Case-insensitive match.
-- ------------------------------------------------------------
create or replace function public.email_for_group(p_name text)
returns text
language sql
security definer
set search_path = public
as $$
  select leader_email
    from public.groups
   where lower(name) = lower(p_name)
   limit 1
$$;

revoke all on function public.email_for_group(text) from public;
grant execute on function public.email_for_group(text) to anon, authenticated;
