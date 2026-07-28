-- 023_support_core.sql
-- The support suite's tables: tickets and their message threads.
--
-- Until now "support" was three unconnected mailto: links (src/lib/errorReport.ts,
-- src/pages/host/HostLayout.tsx, src/pages/legal/Legal.tsx). A customer who hit a
-- problem wrote into a personal inbox: no ticket, no status, no record, and no way
-- for the platform to know a booth had broken at somebody's wedding.
--
-- WRITE POSTURE — the load-bearing decision in this file.
-- There are NO client INSERT/UPDATE/DELETE policies on either table. Every write
-- goes through the `support-api` edge function on the service role, exactly as
-- admin_audit / orders / platform_config already do. Two reasons:
--   1. The rate-limit and size guards (024) are the door. A client INSERT policy
--      would let anyone post straight to PostgREST and walk around the door — a
--      five-line curl against a public anon key, which is precisely the hole 021
--      had to close for client_errors after the fact.
--   2. An UPDATE policy on support_tickets is an UPDATE policy on `status`,
--      `priority` and `assigned_to`. There is no way to grant "mark as read"
--      through a policy without also granting "close my own ticket as resolved".
--      Read receipts therefore go through one narrow SECURITY DEFINER function
--      (support_mark_read, below) that writes exactly one column.
-- Reads stay on PostgREST + RLS, which is what the host UI wants anyway.
--
-- Additive and idempotent.

-- ── Tickets ──────────────────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  -- Human reference for email subject lines: 'BW-7K3QD2'. Filled by
  -- support_ref() below (declared after the table, since it self-references).
  public_ref     text unique,

  -- Tenancy. org_id is stamped SERVER-SIDE — from the caller's membership for a
  -- host ticket, or from event_org_by_id() for a guest ticket. It is never read
  -- from the request body. A guest report therefore reaches both the platform
  -- and the host of the event it happened at, which is the routing we want.
  org_id         uuid references public.orgs(id)   on delete set null,

  -- BOTH event keys are stored, on purpose. CLAUDE.md's event_id trap says
  -- event_plans.event_id is the events.id UUID while posts/cards/app_settings
  -- use the slug; here neither alone is sufficient. A guest arrives holding only
  -- a slug (it is what is in their URL), the slug may not resolve to a row at
  -- all, and if the event is later deleted the UUID goes null — at which point
  -- the slug is the only remaining evidence of where the problem happened.
  event_id       uuid references public.events(id) on delete set null,
  event_slug     text,

  created_by     uuid references auth.users(id) on delete set null,
  reporter_email text,
  reporter_name  text,

  source   text not null check (source in
             ('host_rail','event_studio','guest_booth','manager_console',
              'error_boundary','landing','admin')),
  category text not null check (category in
             ('bug','billing','event_setup','guest_issue',
              'feature_request','account','other')),
  priority text not null default 'normal'
             check (priority in ('low','normal','high','urgent')),
  status   text not null default 'new' check (status in
             ('new','open','waiting_on_customer','waiting_on_us','resolved','closed')),

  subject     text not null,
  assigned_to uuid references auth.users(id) on delete set null,

  -- Redacted client context (url, route, viewport, user agent, app version).
  -- src/lib/supportModel.ts strips the URL fragment and token-shaped query params
  -- before this is ever sent: after a Supabase recovery/magic-link flow the
  -- fragment carries a session-granting access_token, and an operator reading a
  -- ticket must never be handed one.
  diagnostics jsonb not null default '{}'::jsonb,

  -- Deliberately the SAME id src/lib/errorReport.ts mints for client_errors.
  -- This is the join that turns "it broke" into a stack trace, and it is the
  -- highest-value column in the table.
  session_id text,

  first_response_at     timestamptz,
  resolved_at           timestamptz,
  customer_last_read_at timestamptz,
  admin_last_read_at    timestamptz,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Every ticket must be answerable by someone.
  constraint support_tickets_reporter_present
    check (created_by is not null or reporter_email is not null)
);

-- ── Messages ─────────────────────────────────────────────────────────────────
create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  author_kind text not null check (author_kind in ('customer','admin','system')),
  author_user_id uuid references auth.users(id) on delete set null,
  author_email   text,
  body        text not null,

  -- An internal note is where an operator writes "this customer is abusive,
  -- refund and churn". Leaking one is business-ending, so `internal = false`
  -- appears in the USING clause of the customer read policy below rather than
  -- being filtered in application code.
  internal    boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,

  -- Outcome of the Resend send for this message. A ticket must never fail
  -- because email failed, so the failure is recorded here instead of raised.
  email_sent_at timestamptz,
  email_error   text,
  created_at    timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at);
create index if not exists support_tickets_org_idx
  on public.support_tickets (org_id, last_message_at desc);
create index if not exists support_tickets_status_idx
  on public.support_tickets (status, last_message_at desc);
create index if not exists support_tickets_session_idx
  on public.support_tickets (session_id);
create index if not exists support_tickets_event_idx
  on public.support_tickets (event_id);

-- ── Human reference generator ────────────────────────────────────────────────
-- Declared after the table because it probes it for collisions. Crockford-ish
-- alphabet: no 0/1/I/L/O/U, so a ref read aloud over the phone survives.
-- service_role only — the edge function is the only writer, so this never needs
-- to be reachable from /rest/v1/rpc/ (the exposure 022 had to revoke).
create or replace function public.support_ref()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'BW-';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.support_tickets where public_ref = candidate
    );
  end loop;
  return candidate;
end $$;

revoke all on function public.support_ref() from public, anon, authenticated;
grant execute on function public.support_ref() to service_role;

alter table public.support_tickets
  alter column public_ref set default public.support_ref();

-- ── updated_at touch ─────────────────────────────────────────────────────────
create or replace function public.support_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.support_touch_updated_at() from public, anon, authenticated;

drop trigger if exists support_tickets_touch_trg on public.support_tickets;
create trigger support_tickets_touch_trg
  before update on public.support_tickets
  for each row execute function public.support_touch_updated_at();

-- ── RLS: reads only ──────────────────────────────────────────────────────────
alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

-- Org members read their own org's tickets — including tickets a GUEST filed
-- against one of their events, since those carry the org_id of the event.
drop policy if exists support_tickets_member_read on public.support_tickets;
create policy support_tickets_member_read on public.support_tickets
  for select to authenticated
  using (org_id is not null and public.is_org_member(org_id));

-- `internal = false` is load-bearing here; see the column comment above.
drop policy if exists support_messages_member_read on public.support_messages;
create policy support_messages_member_read on public.support_messages
  for select to authenticated
  using (
    internal = false
    and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id
        and t.org_id is not null
        and public.is_org_member(t.org_id)
    )
  );

-- No INSERT/UPDATE/DELETE policies on either table, and no platform-admin read
-- policy. client_errors (015) does grant platform admins a SELECT policy, and
-- this is a knowing divergence from it, not an oversight: tickets carry customer
-- PII and the operator also needs to write, so both directions go through the
-- single service-role door that admin-api and support-api already are.

-- ── Read receipts ────────────────────────────────────────────────────────────
-- The one write a customer may perform, narrowed to one column on one ticket
-- they already have read access to. Everything else about a ticket is the
-- operator's to change.
create or replace function public.support_mark_read(p_ticket uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_tickets t
     set customer_last_read_at = now()
   where t.id = p_ticket
     and t.org_id is not null
     and public.is_org_member(t.org_id);
end $$;

revoke all on function public.support_mark_read(uuid) from public, anon;
grant execute on function public.support_mark_read(uuid) to authenticated, service_role;
