-- 044: Media retention bookkeeping.
--
-- The plans promise retention (7 / 90 / 365 / 730 days) and nothing enforced
-- it. The `media-retention` edge function now does; this table is its memory:
-- when the host was reminded, when the media was removed, and how much.
--
-- A SEPARATE TABLE, not columns on events, on purpose: role `authenticated`
-- holds UPDATE on every column of public.events (see 040), so a
-- `media_purged_at` column there could be set by a host to opt an event out of
-- the purge. Here RLS is ON with ZERO client policies — service role only, the
-- same posture as orders / post_secrets / agent_turns.
--
-- Nothing in this migration deletes anything. The edge function runs in
-- DRY-RUN until the RETENTION_ENFORCE secret is set to 'true', and it is only
-- ever invoked by a schedule the owner turns on (see the commented cron block
-- below). The clock never starts before 2026-11-19 (src/lib/retention.ts
-- RETENTION_POLICY_START), and the three legacy slugs are exempt.
--
-- Idempotent. Additive.
--
-- ROLLBACK:
--   drop table if exists public.event_retention;

create table if not exists public.event_retention (
  event_id        uuid primary key references public.events(id) on delete cascade,
  notice_sent_at  timestamptz,
  notice_to       text,
  purged_at       timestamptz,
  objects_removed int,
  posts_removed   int,
  last_error      text,
  updated_at      timestamptz not null default now()
);

alter table public.event_retention enable row level security;
-- No policies: reads and writes are the service role (media-retention) only.
revoke all on public.event_retention from anon, authenticated;

-- SCHEDULE (owner step — NOT run by this migration). Once the function is
-- deployed and the dry-run report looks right, schedule it daily at 09:00 UTC.
-- The secret must match the function's RETENTION_CRON_SECRET.
--
--   select cron.schedule('media-retention-daily', '0 9 * * *', $$
--     select net.http_post(
--       url     := 'https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/media-retention',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                                     'x-retention-secret', '<RETENTION_CRON_SECRET>'),
--       body    := '{}'::jsonb
--     );
--   $$);
--
--   -- to stop it:  select cron.unschedule('media-retention-daily');
