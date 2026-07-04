-- 008: Phase 5 adversarial-audit fix (HIGH).
--
-- Finding: cards_public_read was a permissive SELECT policy with NO role clause,
-- so it applied to the `authenticated` role too and OR-combined with
-- cards_member_all. Because `authenticated` keeps Postgres's default full-table
-- SELECT grant (needed so a member's own select('*') can read contribute_token /
-- recipient_email for the share link + recipient), ANY logged-in user — incl. a
-- member of another org, or any self-service signup — could read
-- `contribute_token` and `recipient_email` of EVERY published/rendered card
-- across ALL orgs. Cross-tenant leak of a secret capability token + recipient PII.
--
-- Fix: scope the public-read policy to the `anon` role only. Then:
--   * anon        → published/rendered cards, SAFE columns only (the column
--                   grant from 007 already withholds contribute_token /
--                   recipient_email — select('*') / those columns are denied).
--   * member      → own org's cards, all columns, via cards_member_all (unchanged).
--   * authed non-member → NO access to other orgs' cards (public-read no longer
--                   applies to them; member policy requires membership).
-- The public card viewer reads through the service-role card-view function, so
-- it is unaffected. card-view remains the real public read path (it also signs
-- media URLs); this policy is defense-in-depth for anon.

drop policy if exists cards_public_read on public.cards;
create policy cards_public_read on public.cards for select to anon
  using (status in ('published', 'rendered'));
