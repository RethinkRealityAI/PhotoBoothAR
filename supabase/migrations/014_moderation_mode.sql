-- 014: per-event moderation mode.
--
-- Stored in events.config (jsonb, added in 001) under the key 'moderation',
-- matching the existing config-key pattern ('primary_card' etc.):
--   absent / 'post'  -> post-moderation (default, today's behavior):
--                       submit-post inserts approved=true; hosts hide after.
--   'pre'            -> pre-moderation: submit-post inserts approved=false;
--                       a post reaches the wall only after a host/manager
--                       approves it (posts_member_update RLS / manager-api
--                       set_post_approved). Wall clients filter
--                       approved && !hidden on both fetch and realtime.
--
-- No new column: only a guard constraint so a typo'd mode can never be stored.
-- All existing rows lack the key (verified live) — the constraint is satisfied.
alter table public.events drop constraint if exists events_moderation_mode_check;
alter table public.events add constraint events_moderation_mode_check
  check (
    config->>'moderation' is null
    or config->>'moderation' in ('post', 'pre')
  );

-- guest_quota doubles as the guest-facing rate-limit counter store: besides the
-- plain per-(event, session) post quota, edge functions keep prefixed counters
-- in session_id — 'ip:<addr>' (submit-post per-IP), 'day:<YYYY-MM-DD>'
-- (submit-post per-event daily ceiling), 'vs:<session>' / 'vip:<addr>' /
-- 'vday:<YYYY-MM-DD>' (validate-challenge-photo). Prefixes contain ':' which
-- SESSION_ID_RE forbids in real session ids, so keys can never collide.
-- Service-role-only table (RLS enabled, no policies) — unchanged.
comment on table public.guest_quota is
  'Anonymous-guest abuse counters, maintained by edge functions (service role only). Plain session_id = per-session post quota; '':''-prefixed session_id = rate-limit buckets (ip:, day:, vs:, vip:, vday:).';
