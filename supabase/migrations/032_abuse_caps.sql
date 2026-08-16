-- 032_abuse_caps.sql
-- Two ceilings on rows an authenticated caller could otherwise create without
-- limit: day-of access tokens per event, and events per org.
--
-- These are NOT plan limits. Entitlements live in the feature resolver (028)
-- and nothing there may raise these numbers — they are abuse backstops, the
-- same family as submit-post's QUOTA_MAX_POSTS. Both are set far above what a
-- real customer does, so the only caller they ever answer is a script or a
-- stuck retry loop.
--
-- Shaped after 024_support_guard.sql §3, and it keeps 024's choice over 021's:
-- the guard RAISES rather than silently dropping the row. 021's telemetry sink
-- drops silently because a sink must never surface an error to the app it is
-- watching; here the caller is a host who clicked a button, and a token or an
-- event that vanishes while the UI reports success is worse than an error.
--
-- BEFORE INSERT only, so a tenant already above a ceiling keeps every row it
-- has — nothing existing is invalidated, revoked, or deleted by this migration.
--
-- Both guards are SECURITY DEFINER, which is what lets them count rows the
-- caller's RLS view may not show, and both bind EVERY writer including the
-- service role. That is deliberate, not an oversight: `events` is inserted from
-- exactly one place, create-event (supabase/functions/create-event/index.ts:174)
-- running as the service role, so a guard that exempted the service role would
-- be decorative.
--
-- Idempotent and additive.

-- ── 1. Day-of access tokens: 50 per event ────────────────────────────────────
-- src/lib/host.ts `createManagerToken` mints these one at a time from the host
-- UI, one per person working the door. Fifty is a large event's entire floor
-- staff several times over.
--
-- Every row counts, expired ones included: counting only live tokens would let
-- a caller mint without limit simply by back-dating `expires_at`. Revoking a
-- token DELETES its row (`revokeManagerToken`), so a host who genuinely fills
-- the quota clears it the same way they would tidy up anyway.
--
-- The count rides `event_access_tokens_event_idx` (migration 002).
create or replace function public.event_access_token_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing int;
begin
  select count(*) into existing
    from public.event_access_tokens
   where event_id = new.event_id;

  if existing >= 50 then
    raise exception 'event_access_token_cap' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.event_access_token_cap_guard() from public, anon, authenticated;

drop trigger if exists event_access_token_cap_trg on public.event_access_tokens;
create trigger event_access_token_cap_trg
  before insert on public.event_access_tokens
  for each row execute function public.event_access_token_cap_guard();

-- ── 2. Events: 100 non-archived per org ──────────────────────────────────────
-- This schema has no soft-delete column — there is no `deleted_at` on `events`
-- anywhere in migrations 001-030. 'archived' is the retirement state the
-- product actually uses (001's status CHECK: draft/live/ended/archived), so it
-- is what "deleted" means here: archiving an old event frees headroom without
-- destroying a single post, card, or credit-ledger line.
--
-- 100 is deliberately generous. An agency shooting a wedding every weekend
-- takes two years to reach it, and holds only a handful un-archived at a time.
--
-- The count rides `events_org_idx` (migration 001). `status` is NOT NULL, so
-- `<> 'archived'` needs no null handling.
create or replace function public.event_org_cap_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing int;
begin
  select count(*) into existing
    from public.events
   where org_id = new.org_id
     and status <> 'archived';

  if existing >= 100 then
    raise exception 'event_cap' using errcode = 'P0001';
  end if;

  return new;
end $$;

revoke all on function public.event_org_cap_guard() from public, anon, authenticated;

drop trigger if exists event_org_cap_trg on public.events;
create trigger event_org_cap_trg
  before insert on public.events
  for each row execute function public.event_org_cap_guard();
