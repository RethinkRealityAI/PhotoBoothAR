-- 024_support_guard.sql
-- Bound the support tables, give attachments somewhere private to live, and
-- expire the attachments (but never the tickets).
--
-- Shaped after 021_client_errors_guard.sql, with ONE behaviour deliberately
-- inverted — see §3.
--
-- Idempotent and additive.

-- ── 1. SIZE ──────────────────────────────────────────────────────────────────
-- CHECK constraints, not policy clauses: a CHECK binds every writer including
-- the service role, which is right for tables whose only legitimate writer IS
-- the service role. NOT VALID so the rule applies to every new row without the
-- migration having to validate history it cannot fix.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.support_tickets'::regclass
      and conname = 'support_tickets_bounds'
  ) then
    alter table public.support_tickets add constraint support_tickets_bounds check (
      length(coalesce(subject, ''))              between 1 and 200
      and length(coalesce(reporter_email, ''))   <= 320   -- RFC 5321 max
      and length(coalesce(reporter_name, ''))    <= 200
      and length(coalesce(event_slug, ''))       <= 64
      and length(coalesce(session_id, ''))       <= 200
      and length(coalesce(diagnostics::text, '')) <= 8000
      and jsonb_typeof(diagnostics) = 'object'
      -- A row dated 2050 would sit past every time-windowed query forever.
      and (created_at is null or created_at <= now() + interval '5 minutes')
    ) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.support_messages'::regclass
      and conname = 'support_messages_bounds'
  ) then
    alter table public.support_messages add constraint support_messages_bounds check (
      length(coalesce(body, '')) between 1 and 10000
      and length(coalesce(attachments::text, '')) <= 4000
      and jsonb_typeof(attachments) = 'array'
      and jsonb_array_length(attachments) <= 5
      and (created_at is null or created_at <= now() + interval '5 minutes')
    ) not valid;
  end if;
end $$;

-- ── 2. Indexes the rate guard counts on ──────────────────────────────────────
create index if not exists support_tickets_session_created_idx
  on public.support_tickets (session_id, created_at desc);
create index if not exists support_tickets_slug_created_idx
  on public.support_tickets (event_slug, created_at desc);
create index if not exists support_tickets_org_created_idx
  on public.support_tickets (org_id, created_at desc);

-- ── 3. RATE — and here we deliberately break from 021 ────────────────────────
-- 021's guard returns NULL: it drops the row silently and reports success,
-- because telemetry must never surface an error to the app it is watching.
--
-- A support ticket is the opposite case. A ticket that vanishes silently is
-- WORSE than no support at all: the customer believes they have been heard,
-- waits, and hears nothing. So this guard RAISES. src/lib/support.ts maps
-- 'support_rate_limited' onto "You've sent a few reports already — email us
-- directly at dapo@rethinkreality.ai", degrading to the channel that existed
-- before this feature did.
--
-- As in 021, session_id is client-chosen and anyone determined to flood can
-- rotate it. This bounds the ACCIDENT (a stuck retry loop, a frustrated guest
-- tapping submit) and the casual case, which is what actually happens.
create or replace function public.support_rate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  if new.created_by is null then
    -- Anonymous guest: per-device, then per-event so one event cannot be used
    -- to flood the queue via rotated session ids.
    if new.session_id is not null and new.session_id <> '' then
      select count(*) into recent
        from public.support_tickets
       where session_id = new.session_id
         and created_at > now() - interval '1 hour';
      if recent >= 3 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;

    if new.event_slug is not null and new.event_slug <> '' then
      select count(*) into recent
        from public.support_tickets
       where event_slug = new.event_slug
         and created_by is null
         and created_at > now() - interval '1 hour';
      if recent >= 20 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;
  else
    -- Signed-in customer: generous, since they are identifiable and we WANT
    -- them talking to us. This is an accident ceiling, not a quota.
    if new.org_id is not null then
      select count(*) into recent
        from public.support_tickets
       where org_id = new.org_id
         and created_at > now() - interval '1 hour';
      if recent >= 20 then
        raise exception 'support_rate_limited' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end $$;

revoke all on function public.support_rate_guard() from public, anon, authenticated;

drop trigger if exists support_rate_guard_trg on public.support_tickets;
create trigger support_rate_guard_trg
  before insert on public.support_tickets
  for each row execute function public.support_rate_guard();

-- ── 4. Storage: a PRIVATE bucket for screenshots ─────────────────────────────
-- Private, unlike `assets` and `posts`. A support screenshot is whatever was on
-- the customer's screen when it broke — a guest list, an invoice, a face — and
-- must not be served from a public URL to anyone holding the path.
--
-- Path shape: <orgId>/<ticketId>/<uid>-<name>.<ext>, so foldername()[1] is the
-- tenant, exactly as 018 scoped the assets bucket.
--
-- Anonymous guests cannot upload at all: there is no anon policy here, and an
-- anon-writable storage prefix is free file hosting. The report dialog says
-- "Sign in to attach a screenshot" rather than hiding the control.
insert into storage.buckets (id, name, public)
values ('support', 'support', false)
on conflict (id) do nothing;

do $$ begin
  drop policy if exists support_bucket_member_read on storage.objects;
  create policy support_bucket_member_read on storage.objects
    for select to authenticated
    using (
      bucket_id = 'support'
      and public.is_org_member(((storage.foldername(name))[1])::uuid)
    );
exception
  when insufficient_privilege then
    raise notice 'skipping support storage read policy (insufficient privilege on storage.objects)';
  when others then
    raise notice 'skipping support storage read policy (%)', sqlerrm;
end $$;

do $$ begin
  drop policy if exists support_bucket_member_insert on storage.objects;
  create policy support_bucket_member_insert on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'support'
      and public.is_org_member(((storage.foldername(name))[1])::uuid)
    );
exception
  when insufficient_privilege then
    raise notice 'skipping support storage insert policy (insufficient privilege on storage.objects)';
  when others then
    raise notice 'skipping support storage insert policy (%)', sqlerrm;
end $$;

-- ── 5. RETENTION — attachments only, never the tickets ───────────────────────
-- 021 expires client_errors after 30 days because a month-old stack trace is
-- not actionable. Support tickets are the opposite: they are business records.
-- A billing dispute, a refund, a "you told me in March that…" — deleting those
-- destroys the evidence that settles them. So ticket ROWS are never purged.
--
-- Attachments are bulk, and their value decays with the thread. Objects
-- belonging to tickets closed or resolved more than 180 days ago are removed.
create or replace function public.support_attachments_purge()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from storage.objects o
   where o.bucket_id = 'support'
     and exists (
       select 1 from public.support_tickets t
        where t.id::text = (storage.foldername(o.name))[2]
          and t.status in ('resolved', 'closed')
          and coalesce(t.resolved_at, t.updated_at) < now() - interval '180 days'
     );
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.support_attachments_purge() from public, anon, authenticated;

-- pg_cron installed by 019. Off the hour, like 021, so the jobs do not pile up.
create extension if not exists pg_cron;

select cron.unschedule('support-attachments-purge')
where exists (select 1 from cron.job where jobname = 'support-attachments-purge');

select cron.schedule(
  'support-attachments-purge',
  '23 4 * * *',
  $$select public.support_attachments_purge();$$
);
