-- 047: Scheduled delivery for greeting cards ("send it on their birthday").
--
-- A host picks a date and time; at that moment the card closes to new
-- contributions, publishes itself, and is emailed to the recipient. Before
-- this, a host had to remember to press Publish and then Email on the day.
--
-- Moving parts:
--   • cards.deliver_* columns  — the schedule and its outcome, written by the
--     card-publish edge function ('schedule' / 'unschedule' / 'deliver_due').
--   • claim_due_card_deliveries() — atomic claim (FOR UPDATE SKIP LOCKED), so
--     two overlapping runs can never both email the same card. A claim also
--     sets a 10-minute lease: a run that dies mid-send is reclaimed later, and
--     Resend's Idempotency-Key (card id + scheduled time) makes that retry a
--     no-op if the first send actually went out.
--   • card_delivery_token_ok() — the scheduler's credential check. The token is
--     random, generated INSIDE the database into Vault below, and never leaves
--     it except in the cron job's own request header — so there is no secret
--     for anyone to copy into a dashboard, and the edge function holds no new
--     env var (it asks the database whether the presented token is the one).
--   • cron job 'card-deliveries' — every 5 minutes, and it only makes an HTTP
--     call when at least one card is actually due.
--
-- Email itself still needs RESEND_API_KEY in the edge-function secrets. Until
-- it is set, due cards stay scheduled, carry delivery_error
-- 'email_not_configured' (the host sees "waiting on email setup"), and are
-- retried every 30 minutes — nothing is published or marked failed early.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.cards
  add column if not exists deliver_at timestamptz,
  -- IANA zone the host picked the time in — display only (deliver_at is UTC).
  add column if not exists deliver_time_zone text,
  add column if not exists delivery_state text,
  add column if not exists delivery_attempts int not null default 0,
  -- Earliest next attempt (retry backoff / crash lease). Null = deliver_at.
  add column if not exists delivery_retry_at timestamptz,
  add column if not exists delivery_error text,
  add column if not exists delivered_at timestamptz;

do $$ begin
  alter table public.cards add constraint cards_delivery_state_check
    check (delivery_state is null or delivery_state in ('scheduled', 'sending', 'sent', 'failed'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.cards add constraint cards_deliver_tz_len
    check (deliver_time_zone is null or char_length(deliver_time_zone) <= 64);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.cards add constraint cards_delivery_error_len
    check (delivery_error is null or char_length(delivery_error) <= 64);
exception when duplicate_object then null;
end $$;

-- The scheduler's scan: only rows still in flight.
create index if not exists cards_delivery_due_idx
  on public.cards ((coalesce(delivery_retry_at, deliver_at)))
  where delivery_state in ('scheduled', 'sending');

-- NOTE on grants: anon reads cards through an explicit column list (007), so
-- these columns are NOT visible to anon. `authenticated` keeps its table
-- grant; member RLS (cards_member_all) still scopes rows to the event's team.

-- ---------------------------------------------------------------------------
-- Atomic claim
-- ---------------------------------------------------------------------------

create or replace function public.claim_due_card_deliveries(p_limit int default 20)
returns setof public.cards
language sql
volatile
security definer
set search_path = public
as $$
  update public.cards c
     set delivery_state    = 'sending',
         delivery_attempts = c.delivery_attempts + 1,
         -- Lease: if this run never reports back, the row is due again then.
         delivery_retry_at = now() + interval '10 minutes'
   where c.id in (
     select id
       from public.cards
      where delivery_state in ('scheduled', 'sending')
        and coalesce(delivery_retry_at, deliver_at) <= now()
      order by deliver_at
      limit greatest(1, least(coalesce(p_limit, 20), 50))
      for update skip locked
   )
  returning c.*;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler credential (random, created in-database; never in this file)
-- ---------------------------------------------------------------------------

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'card_delivery_cron_token',
  'Presented by the card-deliveries cron job to card-publish (047). Rotate by deleting and re-running 047.'
)
where not exists (select 1 from vault.secrets where name = 'card_delivery_cron_token');

create or replace function public.card_delivery_token_ok(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_token is not null
    and char_length(p_token) >= 32
    and exists (
      select 1 from vault.decrypted_secrets
       where name = 'card_delivery_cron_token' and decrypted_secret = p_token
    ),
    false
  );
$$;

-- Both are service-role only. A SECURITY DEFINER function is otherwise exposed
-- at /rest/v1/rpc/ to anon (the bug 022 fixed) — the revoke is load-bearing.
revoke all on function public.claim_due_card_deliveries(int) from public, anon, authenticated;
grant execute on function public.claim_due_card_deliveries(int) to service_role;
revoke all on function public.card_delivery_token_ok(text) from public, anon, authenticated;
grant execute on function public.card_delivery_token_ok(text) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('card-deliveries')
where exists (select 1 from cron.job where jobname = 'card-deliveries');

select cron.schedule(
  'card-deliveries',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/card-publish',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (
        select decrypted_secret from vault.decrypted_secrets where name = 'card_delivery_cron_token' limit 1
      )
    ),
    body    := jsonb_build_object('action', 'deliver_due'),
    timeout_milliseconds := 55000
  )
  where exists (
    select 1 from public.cards
     where delivery_state in ('scheduled', 'sending')
       and coalesce(delivery_retry_at, deliver_at) <= now()
  )
  and exists (select 1 from vault.decrypted_secrets where name = 'card_delivery_cron_token');
  $$
);
