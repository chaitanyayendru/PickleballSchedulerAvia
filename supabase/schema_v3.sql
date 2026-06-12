-- ============================================================
-- Pickleball Scheduler — schema v3 (additive / safe to re-run)
--
-- - Booking trigger now also requires the group to have at least
--   4 members before any booking (or extension) can be inserted.
-- - Drops public.email_for_group: group auth is gone; the captain
--   logs in as an individual.
-- ============================================================

create or replace function public.enforce_booking_rules()
returns trigger language plpgsql as $$
declare
  v_week_start      date;
  v_week_end        date;
  v_same_hour_count int;
  v_week_total      int;
  v_member_count    int;
  v_prev_start      timestamptz;
begin
  v_week_start := public.iso_week_start(new.slot_date);
  v_week_end   := v_week_start + 6;

  -- New in v3: a group needs >= 4 members before it can book anything.
  select count(*) into v_member_count
    from public.members
   where group_id = new.group_id;

  if v_member_count < 4 then
    raise exception 'Group needs at least 4 members to book (currently %).', v_member_count
      using errcode = 'check_violation';
  end if;

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

-- The v2 RPC is no longer used (captain logs in as an individual).
drop function if exists public.email_for_group(text);
