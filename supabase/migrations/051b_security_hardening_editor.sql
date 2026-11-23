-- 051b: the owner-pasted half of 051 — every statement 051 was not allowed to
-- contain (policy removals, grant narrowing, one row removal).
--
-- HOW TO RUN: apply 051_security_hardening.sql FIRST (Supabase MCP
-- apply_migration or the SQL editor), run its VERIFY block, then paste THIS
-- whole file into the SQL editor. It is one transaction: either every
-- statement below lands or none does. Each statement is safe to re-run
-- (if exists / revoke of an absent grant / a delete that matches nothing).
--
-- WHAT IT REMOVES, EXACTLY:
--   1. policy public.events.events_member_delete
--   2. policy public.orgs.orgs_owner_insert
--   3. EXECUTE on 051's new trigger functions for public/anon/authenticated
--   4. every privilege anon/authenticated hold on public.email_send_log
--   5. ONE org_members row: beamwall-cap-test@example.com (user
--      6431a1e7-a836-442a-be9a-c1412f6f688e) as 'editor' of "Legacy Events"
--      (org a95c96b5-840f-4bac-a9fd-1d33156f6b6f). Its own org "Cap Test Event
--      Events" (f6838ff8-…, which owns event cap-test-event) and its owner
--      membership there are NOT touched.
-- Nothing else. The optional airohub lock-down at the bottom is commented out
-- on purpose — see M4.

begin;

-- ── 1. M2: no member can remove an event over REST ─────────────────────────
-- events_member_delete (USING is_org_member(org_id)) let ANY member — an
-- editor included — remove a LIVE event with one REST call, skipping
-- delete-event's archived-only rule, its server-checked type-the-name confirm
-- and its storage sweep (which runs BEFORE the row so no media is orphaned).
-- The browser never removes events directly: grep src for
-- from('events')…delete() → zero hits; the only remover is delete-event
-- (supabase/functions/delete-event/index.ts:294) on the service role, which
-- bypasses RLS and so does not need this policy. Removing it changes no
-- legitimate path.
drop policy if exists events_member_delete on public.events;

-- ── 2. C2 defence in depth: hosts never insert orgs themselves ─────────────
-- orgs_owner_insert (CHECK owner_id = auth.uid()) is the door the credit loop
-- used. 051 already makes a client-made org harmless (plan forced to free,
-- 5-per-owner cap, signup bonus once per owner), so this is belt and braces.
-- Every legitimate org INSERT is service-role: create-event
-- (index.ts:148-155) and admin-api's library workshop (index.ts:1968-1972).
-- The browser has zero .from('orgs') writes.
drop policy if exists orgs_owner_insert on public.orgs;

-- ── 3. hygiene: 051's new functions are not anyone's to EXECUTE ────────────
-- They are trigger functions — Postgres refuses to run one outside a trigger,
-- and PostgREST does not expose functions that return `trigger` — so this is
-- not a live hole, only the same narrowing 032/040 applied to their guards.
-- Verified on a scratch cluster: a trigger still fires for a client after its
-- function's EXECUTE is revoked (firing is not an EXECUTE check).
-- handle_new_org / guest_contact_cap_guard / support_rate_guard are replaced
-- by 051 with `create or replace`, which keeps their existing live ACL
-- (postgres + service_role only), so they need nothing here.
revoke all on function public.orgs_client_guard()    from public, anon, authenticated;
revoke all on function public.orgs_owner_cap_guard() from public, anon, authenticated;
revoke all on function public.profiles_promo_guard() from public, anon, authenticated;
revoke all on function public.cards_client_guard()   from public, anon, authenticated;
revoke all on function public.email_send_cap_guard() from public, anon, authenticated;

-- ── 4. hygiene: the send ledger is service-role only ───────────────────────
-- Supabase's default privileges gave anon/authenticated ALL (TRUNCATE
-- included) on the new table. RLS with no policy already denies every row
-- operation; TRUNCATE is not subject to RLS, so the grant is what matters.
revoke all on table public.email_send_log from anon, authenticated;

-- ── 5. the cap-test account leaves Legacy Events ───────────────────────────
-- Verified live 2026-11-21: this is an 'editor' membership of the org that
-- owns the three frozen legacy events (hope-gala, jenna-jake, detola-wuyi).
-- A throwaway test login should not hold edit rights over a customer's live
-- walls. OWNER NOTE: docs/STATE.md records "We can keep this cap test event
-- … Don't remove anything from it at the moment." That event lives in the
-- account's OWN org, which this statement does not touch — but if this Legacy
-- Events membership is how you test the legacy walls from that login, skip
-- this one statement.
delete from public.org_members
 where org_id  = 'a95c96b5-840f-4bac-a9fd-1d33156f6b6f'
   and user_id = '6431a1e7-a836-442a-be9a-c1412f6f688e'
   and role    = 'editor';

commit;

-- VERIFY AFTER RUNNING:
--   select policyname from pg_policies
--    where (tablename, policyname) in (('events','events_member_delete'), ('orgs','orgs_owner_insert'));
--   -- expect: 0 rows
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'email_send_log'
--      and grantee in ('anon', 'authenticated');
--   -- expect: 0 rows
--   select count(*) from public.org_members
--    where org_id = 'a95c96b5-840f-4bac-a9fd-1d33156f6b6f'
--      and user_id = '6431a1e7-a836-442a-be9a-c1412f6f688e';
--   -- expect: 0
--   -- delete-event still works: archive a scratch event in the host UI, then
--   -- Delete it there (service role — unaffected by policy 1).

-- ── OPTIONAL — M4, OWNER DECISION: lock down the airohub_* tables ──────────
-- Live 2026-11-21: airohub_models and airohub_model_reviews each carry
-- SELECT/INSERT/UPDATE/DELETE policies for {anon, authenticated} with
-- USING/CHECK `true`, and the PUBLIC storage bucket `airohub-models` has anon
-- read/upload/delete policies on storage.objects. All three are EMPTY (0 rows,
-- 0 objects). Nothing in this repo references them (grep src + supabase/
-- functions: 0 hits) — migrations `airohub_custom_models` (2026-08-25) and
-- `airohub_model_reviews` (2026-08-31) were applied from outside this repo,
-- so they likely belong to another product sharing the project. As they stand,
-- anyone on the internet can write to them and host files from the bucket
-- under this project's domain. Uncomment ONLY if they are yours to close; the
-- result is "service role only", the same shape as 036_agent_turns.
--
-- begin;
-- drop policy if exists airohub_models_read          on public.airohub_models;
-- drop policy if exists airohub_models_insert        on public.airohub_models;
-- drop policy if exists airohub_models_delete        on public.airohub_models;
-- drop policy if exists airohub_model_reviews_read   on public.airohub_model_reviews;
-- drop policy if exists airohub_model_reviews_insert on public.airohub_model_reviews;
-- drop policy if exists airohub_model_reviews_update on public.airohub_model_reviews;
-- drop policy if exists airohub_model_reviews_delete on public.airohub_model_reviews;
-- drop policy if exists "airohub models public read"  on storage.objects;
-- drop policy if exists "airohub models anon upload"  on storage.objects;
-- drop policy if exists "airohub models anon delete"  on storage.objects;
-- update storage.buckets set public = false where id = 'airohub-models';
-- commit;

-- ── ROLLBACK of 051 (only if it must be backed out; restores pre-051) ──────
--   drop trigger if exists orgs_client_guard_trg    on public.orgs;
--   drop trigger if exists orgs_owner_cap_trg       on public.orgs;
--   drop trigger if exists profiles_promo_guard_trg on public.profiles;
--   drop trigger if exists cards_client_guard_trg   on public.cards;
--   drop trigger if exists email_send_cap_trg       on public.email_send_log;
--   drop index   if exists public.posts_image_url_key;
--   -- then re-run 011's handle_new_org, 034's guest_contact_cap_guard and
--   -- 024's support_rate_guard bodies; email_send_log can stay (inert without
--   -- its writers) or be dropped. The edge functions deployed with 051 need
--   -- email_send_log present: roll them back first.
-- ROLLBACK of this file: recreate the two policies from 001 (events_member_delete,
-- orgs_owner_insert) and re-insert the org_members row with role 'editor'.
