-- 034_guest_contacts.sql
-- Consented guest email capture, so a host can send ONE keepsake email per
-- event after the night is over.
--
-- Until now the platform held no guest contact detail at all: a guest is a
-- device (src/lib/session.ts `getSessionId`), their keepsakes live in
-- localStorage, and clearing the browser loses them. This table is the first
-- guest PII in the schema, so it is deliberately the most closed one:
--
--   * clients may INSERT and nothing else — the shape of 015_client_errors,
--     where anon + authenticated get an insert policy and the ABSENCE of any
--     select/update/delete policy is what denies the rest (service_role
--     bypasses RLS as usual). The `send-keepsakes` edge function on the
--     service role is the sole reader and the sole writer of `last_sent_at` /
--     `unsubscribed_at`.
--   * no column-level revoke is added. 007_cards.sql had to re-scope column
--     grants because a permissive SELECT policy existed; here there is no
--     SELECT policy at all, so RLS already denies every client read. Revoking
--     the table grant instead would silently break the first admin-read policy
--     anyone adds later — the 007 trap running the other way.
--
-- Idempotent and additive.

-- ── 1. The table ─────────────────────────────────────────────────────────────
-- `event_id` is the event SLUG, not its uuid: `posts`, `cards` and
-- `app_settings` all key on the slug (002_platform_tables.sql:36, 007:24) and a
-- guest-facing row must join the same way. The FK cascades, so deleting an
-- event takes its contact list with it.
--
-- `session_id` is the same device-local id `getSessionId(eventId)` mints for
-- posts. It is the de-duplication key: one device, one keepsake address per
-- event. It is client-chosen and NOT an identity — the UNIQUE below stops the
-- honest double-tap, not a determined re-submitter (who is bounded by §3).
--
-- The email CHECK is a pragmatic shape test, not RFC 5322 — the same rule the
-- edge functions apply (card-publish/index.ts:40), plus RFC 5321's 320-char
-- ceiling, which is also what 024_support_guard.sql bounds `reporter_email` at.
-- It is a CHECK rather than a policy clause because a CHECK binds EVERY writer
-- including the service role, which is right for a table whose other writer is
-- a service-role edge function (024 §1's reasoning).
create table if not exists public.guest_contacts (
  id                uuid primary key default gen_random_uuid(),
  event_id          text not null references public.events(slug) on delete cascade,
  session_id        text not null,
  email             text not null,
  consent_at        timestamptz not null default now(),
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  unsubscribed_at   timestamptz,
  last_sent_at      timestamptz,
  created_at        timestamptz not null default now(),

  constraint guest_contacts_event_session_key unique (event_id, session_id),

  constraint guest_contacts_bounds check (
    length(email) between 3 and 320
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    and length(session_id) between 1 and 200
    -- A row dated 2050 would sit past every time-windowed query forever
    -- (024_support_guard.sql §1).
    and (created_at is null or created_at <= now() + interval '5 minutes')
  )
);

-- No separate event_id index: `guest_contacts_event_session_key` is a btree on
-- (event_id, session_id) whose LEADING column is event_id, so the per-event
-- send scan, the `max(last_sent_at)` re-send guard and the §3 count all ride it.
create index if not exists guest_contacts_unsub_token_idx
  on public.guest_contacts (unsubscribe_token);

alter table public.guest_contacts enable row level security;

-- ── 2. The one client policy: INSERT, on a reachable event ───────────────────
-- WITH CHECK proves the event exists and is not a draft. The subquery needs no
-- SECURITY DEFINER helper: `events_public_read` (003_rls_hardening.sql:118)
-- already exposes exactly `status <> 'draft'` rows to anon, so an inline EXISTS
-- evaluates correctly for a signed-out guest. The explicit `e.status <> 'draft'`
-- is still written out rather than leaned on, so a member — whose view of
-- `events` DOES include their own drafts — cannot bank contacts against an
-- unpublished event while testing their booth.
--
-- There is deliberately NO update policy, so a guest cannot change or clear
-- another device's row, and no select policy, so no client can enumerate an
-- event's guest list. Correcting a typo'd address is a support request, not a
-- capability we hand the browser.
drop policy if exists guest_contacts_guest_insert on public.guest_contacts;
create policy guest_contacts_guest_insert on public.guest_contacts
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.events e
       where e.slug = guest_contacts.event_id
         and e.status <> 'draft'
    )
  );

-- ── 3. Cap: 500 contacts per event ───────────────────────────────────────────
-- An abuse backstop, not a plan limit — the same family as 032_abuse_caps.sql
-- and submit-post's QUOTA_MAX_POSTS, and nothing in the feature resolver (028)
-- may raise it. 500 is well past a large event's guest list, so the only caller
-- it ever answers is a script or a stuck retry loop.
--
-- It RAISES rather than silently dropping the row, keeping 024's choice over
-- 021's: the caller here is a guest who tapped a button and is watching for an
-- answer, and a consent that vanishes while the UI says "we'll email you" is
-- worse than an error. src/lib/keepsakeContacts.ts maps it to a plain
-- "couldn't save" so the guest can try again or ask a host.
--
-- BEFORE INSERT fires ahead of the unique-index check, so a re-submit from a
-- device that already opted in is counted too. That is only reachable at the
-- ceiling, where erring toward the error is the point.
create or replace function public.guest_contact_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing int;
begin
  select count(*) into existing
    from public.guest_contacts
   where event_id = new.event_id;

  if existing >= 500 then
    raise exception 'guest_contact_cap' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.guest_contact_cap_guard() from public, anon, authenticated;

drop trigger if exists guest_contact_cap_trg on public.guest_contacts;
create trigger guest_contact_cap_trg
  before insert on public.guest_contacts
  for each row execute function public.guest_contact_cap_guard();
