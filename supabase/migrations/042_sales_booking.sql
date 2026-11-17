-- 042_sales_booking.sql
--
-- Booking links for the partnerships CRM (041). A rep publishes weekly
-- availability; a prospect opens /book/<ref_code>, picks a slot, and the
-- booking lands in the CRM as a prospect (owned by that rep) + a booking row.
--
-- Security model:
--   * sales_booking_pages: a rep's own settings. Members read all (the team
--     sees each other's links), a rep writes only their own row.
--   * sales_bookings: NO client insert policy. The only way in is the anon
--     RPC sales_book_meeting, which re-validates the slot SERVER-SIDE against
--     the rep's hours, notice, horizon and existing bookings (the client's slot
--     list is a convenience, never trusted), under a per-rep advisory lock so
--     two people cannot take the same slot.
--   * sales_booking_page_public: the anon read. Returns the rep's display name,
--     hours and BUSY TIMES ONLY — never who booked, never an email.
--   * anon gets EXECUTE on exactly those two functions and nothing else.
--
-- Slot grid (MUST match src/lib/booking.ts generateSlots — booking.test.ts
-- pins the shared cases): in the rep's timezone, for each window [ws, we) of a
-- weekday, starts are ws, ws+D, ws+2D … while start + D <= we (D = duration).
-- A slot is free unless a confirmed booking b has
--   b.starts_at < start + D + buffer  AND  b.ends_at > start - buffer.
-- Notice: start >= now() + min_notice_hours. Horizon: the slot's local date is
-- < (local today + horizon_days).
--
-- Idempotent.

-- ── Ref code: a rep may set their OWN, once ───────────────────────────────
-- /book/<ref_code> is the public link, so a rep without one could not have a
-- booking page. Changing an existing code would break every link already sent,
-- so this only fills a NULL; an admin changes codes via sales_grant_access.
create or replace function public.sales_set_my_ref_code(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_cur  text;
begin
  if not exists (select 1 from public.sales_team t where t.user_id = auth.uid()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_code !~ '^[a-z0-9-]{2,24}$' then
    raise exception 'invalid_ref_code' using errcode = '22023';
  end if;
  select ref_code into v_cur from public.sales_team where user_id = auth.uid();
  if v_cur is not null then
    if v_cur = v_code then return v_cur; end if;
    raise exception 'ref_code_locked' using errcode = '22023',
      hint = 'Your link is already live. Ask an admin to change it.';
  end if;
  update public.sales_team set ref_code = v_code where user_id = auth.uid();
  return v_code;
exception when unique_violation then
  raise exception 'ref_code_taken' using errcode = '23505';
end;
$$;
revoke all on function public.sales_set_my_ref_code(text) from public, anon;
grant execute on function public.sales_set_my_ref_code(text) to authenticated;

-- ── Booking page settings ─────────────────────────────────────────────────
create table if not exists public.sales_booking_pages (
  user_id          uuid primary key references public.sales_team(user_id) on delete cascade,
  enabled          boolean not null default true,
  headline         text check (char_length(headline) <= 120),
  intro            text check (char_length(intro) <= 600),
  duration_min     int  not null default 30 check (duration_min in (15, 20, 30, 45, 60)),
  buffer_min       int  not null default 10 check (buffer_min between 0 and 60),
  timezone         text not null default 'Africa/Lagos' check (char_length(timezone) <= 64),
  -- { "0": [["09:00","17:00"]], … "6": [] } — keys = weekday (0 = Sunday),
  -- up to 3 windows a day, validated by the trigger below.
  weekly           jsonb not null default
    '{"1":[["10:00","17:00"]],"2":[["10:00","17:00"]],"3":[["10:00","17:00"]],"4":[["10:00","17:00"]],"5":[["10:00","15:00"]]}'::jsonb,
  min_notice_hours int  not null default 12 check (min_notice_hours between 0 and 168),
  horizon_days     int  not null default 21 check (horizon_days between 1 and 60),
  -- Where the call happens (Meet / Zoom / WhatsApp link). Shown to the booker
  -- only AFTER they book. https only.
  meeting_link     text check (meeting_link is null or (char_length(meeting_link) <= 500 and meeting_link ~ '^https://')),
  market           text not null default 'ng' check (market in ('ng', 'na')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.sales_booking_pages enable row level security;

create or replace function public.sales_booking_pages_validate()
returns trigger language plpgsql set search_path = public as $$
declare
  k text;
  w jsonb;
  win jsonb;
  s text;
  e text;
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'invalid_timezone' using errcode = '22023';
  end;
  if jsonb_typeof(new.weekly) <> 'object' or pg_column_size(new.weekly) > 4096 then
    raise exception 'invalid_hours' using errcode = '22023';
  end if;
  for k, w in select * from jsonb_each(new.weekly) loop
    if k !~ '^[0-6]$' or jsonb_typeof(w) <> 'array' or jsonb_array_length(w) > 3 then
      raise exception 'invalid_hours' using errcode = '22023';
    end if;
    for win in select * from jsonb_array_elements(w) loop
      if jsonb_typeof(win) <> 'array' or jsonb_array_length(win) <> 2 then
        raise exception 'invalid_hours' using errcode = '22023';
      end if;
      s := win ->> 0;
      e := win ->> 1;
      if s !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or e !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' or s >= e then
        raise exception 'invalid_hours' using errcode = '22023';
      end if;
    end loop;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;

-- A trigger function is never called directly; keep it off /rest/v1/rpc/.
revoke all on function public.sales_booking_pages_validate() from public, anon, authenticated;

drop trigger if exists sales_booking_pages_validate on public.sales_booking_pages;
create trigger sales_booking_pages_validate before insert or update on public.sales_booking_pages
  for each row execute function public.sales_booking_pages_validate();

drop policy if exists sales_booking_pages_read on public.sales_booking_pages;
create policy sales_booking_pages_read on public.sales_booking_pages for select to authenticated
  using (public.is_sales_member());
drop policy if exists sales_booking_pages_insert on public.sales_booking_pages;
create policy sales_booking_pages_insert on public.sales_booking_pages for insert to authenticated
  with check (public.is_sales_member() and user_id = auth.uid());
drop policy if exists sales_booking_pages_update on public.sales_booking_pages;
create policy sales_booking_pages_update on public.sales_booking_pages for update to authenticated
  using (user_id = auth.uid() or public.is_platform_admin())
  with check (user_id = auth.uid() or public.is_platform_admin());

-- ── Bookings ──────────────────────────────────────────────────────────────
create table if not exists public.sales_bookings (
  id           uuid primary key default gen_random_uuid(),
  rep_id       uuid not null references auth.users(id) on delete cascade,
  prospect_id  uuid references public.sales_prospects(id) on delete set null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null check (ends_at > starts_at),
  status       text not null default 'confirmed'
                 check (status in ('confirmed', 'completed', 'no_show', 'cancelled')),
  name         text not null check (char_length(btrim(name)) between 1 and 200),
  email        text check (char_length(email) <= 254),
  phone        text check (char_length(phone) <= 40),
  company      text check (char_length(company) <= 200),
  icp          text not null default 'other' check (icp in ('planners', 'brands', 'creators', 'other')),
  event_date   date,
  notes        text check (char_length(notes) <= 1000),
  booker_tz    text check (char_length(booker_tz) <= 64),
  consent_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sales_bookings_rep_time_idx on public.sales_bookings (rep_id, starts_at);
create index if not exists sales_bookings_prospect_idx on public.sales_bookings (prospect_id);
alter table public.sales_bookings enable row level security;

drop trigger if exists sales_bookings_updated_at on public.sales_bookings;
create trigger sales_bookings_updated_at before update on public.sales_bookings
  for each row execute function public.set_updated_at();

drop policy if exists sales_bookings_read on public.sales_bookings;
create policy sales_bookings_read on public.sales_bookings for select to authenticated
  using (public.is_sales_member());
-- Status changes (done / no-show / cancel) by the rep or an admin. No insert
-- policy: bookings only arrive through sales_book_meeting.
drop policy if exists sales_bookings_update on public.sales_bookings;
create policy sales_bookings_update on public.sales_bookings for update to authenticated
  using (public.is_sales_member() and (rep_id = auth.uid() or public.is_platform_admin()))
  with check (public.is_sales_member() and (rep_id = auth.uid() or public.is_platform_admin()));
drop policy if exists sales_bookings_delete on public.sales_bookings;
create policy sales_bookings_delete on public.sales_bookings for delete to authenticated
  using (public.is_sales_member() and (rep_id = auth.uid() or public.is_platform_admin()));

revoke all on public.sales_booking_pages, public.sales_bookings from anon;
revoke all on public.sales_booking_pages, public.sales_bookings from authenticated;
grant select, insert, update on public.sales_booking_pages to authenticated;
grant select, update, delete on public.sales_bookings to authenticated;

-- ── Public read (anon) ────────────────────────────────────────────────────
create or replace function public.sales_booking_page_public(p_ref text)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'ref', t.ref_code,
    'rep_name', coalesce(nullif(btrim(p.display_name), ''), 'the Beamwall team'),
    'headline', bp.headline,
    'intro', bp.intro,
    'duration_min', bp.duration_min,
    'buffer_min', bp.buffer_min,
    'timezone', bp.timezone,
    'weekly', bp.weekly,
    'min_notice_hours', bp.min_notice_hours,
    'horizon_days', bp.horizon_days,
    'market', bp.market,
    -- Busy intervals only: no names, no emails.
    'busy', coalesce((
      select jsonb_agg(jsonb_build_array(b.starts_at, b.ends_at) order by b.starts_at)
      from public.sales_bookings b
      where b.rep_id = t.user_id and b.status = 'confirmed'
        and b.ends_at > now() - interval '1 hour'
        and b.starts_at < now() + make_interval(days => bp.horizon_days + 2)
    ), '[]'::jsonb)
  )
  from public.sales_team t
  join public.sales_booking_pages bp on bp.user_id = t.user_id and bp.enabled
  left join public.profiles p on p.id = t.user_id
  where t.ref_code = lower(btrim(p_ref))
  limit 1;
$$;
revoke all on function public.sales_booking_page_public(text) from public, anon;
grant execute on function public.sales_booking_page_public(text) to anon, authenticated;

-- ── Book (anon) ───────────────────────────────────────────────────────────
create or replace function public.sales_book_meeting(
  p_ref        text,
  p_starts_at  timestamptz,
  p_name       text,
  p_email      text,
  p_phone      text,
  p_company    text,
  p_icp        text,
  p_event_date date,
  p_notes      text,
  p_booker_tz  text,
  p_consent    boolean
)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_rep       uuid;
  bp          public.sales_booking_pages%rowtype;
  v_rep_name  text;
  v_name      text := btrim(coalesce(p_name, ''));
  v_email     text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_company   text := nullif(btrim(coalesce(p_company, '')), '');
  v_notes     text := nullif(btrim(coalesce(p_notes, '')), '');
  v_icp       text := coalesce(nullif(p_icp, ''), 'other');
  v_tz        text := nullif(btrim(coalesce(p_booker_tz, '')), '');
  v_local     timestamp;
  v_min       int;
  v_dur       interval;
  v_end       timestamptz;
  v_ok        boolean := false;
  win         jsonb;
  ws          int;
  we          int;
  v_prospect  uuid;
  v_booking   uuid;
  v_when      text;
begin
  -- Shape first, so junk never takes the lock.
  if p_consent is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'contact_required' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$') then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_phone is not null and (char_length(v_phone) > 40 or v_phone !~ '^[+0-9 ()\-.]{6,40}$') then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if char_length(coalesce(v_company, '')) > 200 or char_length(coalesce(v_notes, '')) > 1000 then
    raise exception 'too_long' using errcode = '22023';
  end if;
  if v_icp not in ('planners', 'brands', 'creators', 'other') then
    v_icp := 'other';
  end if;
  if v_tz is not null and char_length(v_tz) > 64 then v_tz := null; end if;
  if p_event_date is not null and (p_event_date < current_date - 1 or p_event_date > current_date + 730) then
    raise exception 'invalid_event_date' using errcode = '22023';
  end if;

  select t.user_id into v_rep from public.sales_team t where t.ref_code = lower(btrim(coalesce(p_ref, ''))) limit 1;
  if v_rep is null then
    raise exception 'booking_page_not_found' using errcode = 'P0002';
  end if;
  select * into bp from public.sales_booking_pages where user_id = v_rep and enabled;
  if not found then
    raise exception 'booking_page_not_found' using errcode = 'P0002';
  end if;

  -- One booking at a time per rep: the overlap check below and the insert
  -- must be atomic or two people can take the same slot.
  perform pg_advisory_xact_lock(hashtext('sales_booking:' || v_rep::text));

  v_dur := make_interval(mins => bp.duration_min);
  v_end := p_starts_at + v_dur;

  -- Notice + horizon.
  if p_starts_at < now() + make_interval(hours => bp.min_notice_hours) then
    raise exception 'slot_unavailable' using errcode = '22023', hint = 'too_soon';
  end if;
  v_local := p_starts_at at time zone bp.timezone;
  if v_local::date >= (now() at time zone bp.timezone)::date + bp.horizon_days then
    raise exception 'slot_unavailable' using errcode = '22023', hint = 'too_far';
  end if;

  -- On the grid of one of that weekday's windows.
  if extract(second from v_local) <> 0 then
    raise exception 'slot_unavailable' using errcode = '22023', hint = 'off_grid';
  end if;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  for win in select * from jsonb_array_elements(coalesce(bp.weekly -> extract(dow from v_local)::int::text, '[]'::jsonb)) loop
    ws := split_part(win ->> 0, ':', 1)::int * 60 + split_part(win ->> 0, ':', 2)::int;
    we := split_part(win ->> 1, ':', 1)::int * 60 + split_part(win ->> 1, ':', 2)::int;
    if v_min >= ws and v_min + bp.duration_min <= we and (v_min - ws) % bp.duration_min = 0 then
      v_ok := true;
      exit;
    end if;
  end loop;
  if not v_ok then
    raise exception 'slot_unavailable' using errcode = '22023', hint = 'outside_hours';
  end if;

  -- Free (buffer on both sides).
  if exists (
    select 1 from public.sales_bookings b
    where b.rep_id = v_rep and b.status = 'confirmed'
      and b.starts_at < v_end + make_interval(mins => bp.buffer_min)
      and b.ends_at > p_starts_at - make_interval(mins => bp.buffer_min)
  ) then
    raise exception 'slot_taken' using errcode = '23P01';
  end if;

  -- Abuse backstops (a public form): one person can hold 3 upcoming calls
  -- with a rep; a rep's page takes at most 12 bookings an hour.
  if (select count(*) from public.sales_bookings b
      where b.rep_id = v_rep and b.status = 'confirmed' and b.starts_at > now()
        and ((v_email is not null and b.email = v_email) or (v_phone is not null and b.phone = v_phone))) >= 3 then
    raise exception 'too_many_bookings' using errcode = '22023';
  end if;
  if (select count(*) from public.sales_bookings b
      where b.rep_id = v_rep and b.created_at > now() - interval '1 hour') >= 12 then
    raise exception 'too_many_bookings' using errcode = '22023';
  end if;

  -- Attach to this rep's existing prospect with the same email (or phone),
  -- else create one. Only the rep's OWN prospects: never re-own someone else's.
  select id into v_prospect from public.sales_prospects p
  where p.owner_id = v_rep
    and ((v_email is not null and lower(p.email) = v_email) or (v_phone is not null and p.phone = v_phone))
  order by p.updated_at desc limit 1;

  if v_prospect is null then
    insert into public.sales_prospects
      (owner_id, name, company, icp, market, email, phone, source, status, next_follow_up, notes)
    values
      (v_rep, v_name, v_company, v_icp, bp.market, v_email, v_phone, 'Booking link', 'meeting',
       v_local::date, v_notes)
    returning id into v_prospect;
  else
    update public.sales_prospects p set
      status = case when p.status in ('new', 'contacted', 'replied', 'nurture') then 'meeting' else p.status end,
      next_follow_up = v_local::date,
      email = coalesce(p.email, v_email),
      phone = coalesce(p.phone, v_phone),
      company = coalesce(p.company, v_company)
    where p.id = v_prospect;
  end if;

  insert into public.sales_bookings
    (rep_id, prospect_id, starts_at, ends_at, name, email, phone, company, icp, event_date, notes, booker_tz, consent_at)
  values
    (v_rep, v_prospect, p_starts_at, v_end, v_name, v_email, v_phone, v_company, v_icp, p_event_date, v_notes, v_tz, now())
  returning id into v_booking;

  -- A 'note', not a 'meeting': the daily touch counter is for outreach the
  -- rep did, and a booking is the prospect's action.
  v_when := to_char(v_local, 'Dy DD Mon, HH24:MI') || ' (' || bp.timezone || ')';
  insert into public.sales_activities (prospect_id, actor_id, kind, channel, body)
  values (v_prospect, v_rep, 'note', 'booking',
          left('Booked a ' || bp.duration_min || '-min call via the booking link for ' || v_when
               || case when v_notes is not null then E'.\n“' || v_notes || '”' else '.' end, 4000));

  select coalesce(nullif(btrim(p.display_name), ''), 'the Beamwall team') into v_rep_name
  from public.profiles p where p.id = v_rep;

  return jsonb_build_object(
    'booking_id', v_booking,
    'starts_at', p_starts_at,
    'ends_at', v_end,
    'duration_min', bp.duration_min,
    'timezone', bp.timezone,
    'rep_name', coalesce(v_rep_name, 'the Beamwall team'),
    'meeting_link', bp.meeting_link
  );
end;
$$;
revoke all on function public.sales_book_meeting(text, timestamptz, text, text, text, text, text, date, text, text, boolean) from public, anon;
grant execute on function public.sales_book_meeting(text, timestamptz, text, text, text, text, text, date, text, text, boolean) to anon, authenticated;
