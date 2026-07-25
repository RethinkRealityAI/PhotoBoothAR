-- 021: Bound the anonymous error sink, and expire what it collects.
--
-- `client_errors` (015) is INSERT-open to `anon` with `with check (true)`. That
-- is deliberate — a guest whose booth crashed has no session to authenticate
-- with, and telemetry that only reports logged-in failures reports the wrong
-- half of the product. But "deliberate" is not the same as "bounded", and every
-- limit protecting it lived in the CLIENT: src/lib/errorReport.ts truncates the
-- message at 2k and the stack at 8k, caps ten reports per page session, and
-- dedupes. None of that constrains anyone who skips the client and posts to
-- PostgREST directly, which is a five-line curl against a public anon key.
--
-- So the same limits move to where they are actually enforced.
--
-- 1. SIZE. A CHECK constraint, not a policy clause: a CHECK binds every writer
--    including the service role, which is right for a telemetry table nobody
--    should be writing novels into. Bounds are the client's own caps with
--    headroom, so a legitimate report can never be rejected by them.
--
-- 2. TIME. `created_at` has a default, but a client may still send one — and a
--    row dated 2050 would sit in the table forever, immune to the retention
--    sweep below. Future-dating is refused.
--
-- 3. RATE. A BEFORE INSERT trigger drops a session past 40 rows in an hour.
--    Stated plainly: `session_id` is chosen by the client, so anyone determined
--    to flood the table just rotates it — this bounds the ACCIDENT (a render
--    loop in one browser tab hammering the sink), which is the case that
--    actually occurs, not an attack. The trigger returns NULL rather than
--    raising: telemetry must never surface an error to the app it is watching.
--
-- 4. RETENTION. Nothing ever deleted these rows. A daily sweep drops anything
--    older than 30 days, which is well past the point where a client-side stack
--    trace is still actionable.
--
-- Idempotent, and additive — no existing row is rewritten or removed by the
-- DDL itself (the first retention run will delete rows older than 30 days,
-- which is the intent).

-- ── 1 + 2. Size and time bounds ──────────────────────────────────────────────
-- NOT VALID: enforced for every new row, but not validated against history.
-- Existing rows predate the rule and there is nothing useful to do about one
-- that breaks it; failing the migration over old telemetry would be absurd.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_errors'::regclass and conname = 'client_errors_bounds'
  ) then
    alter table public.client_errors add constraint client_errors_bounds check (
      length(coalesce(message, ''))    <= 4000
      and length(coalesce(stack, ''))       <= 16000
      and length(coalesce(url, ''))         <= 2000
      and length(coalesce(user_agent, ''))  <= 1000
      and length(coalesce(session_id, ''))  <= 200
      and length(coalesce(context::text, '')) <= 8000
      and (created_at is null or created_at <= now() + interval '5 minutes')
    ) not valid;
  end if;
end $$;

-- ── 3. Per-session flood ceiling ─────────────────────────────────────────────
create index if not exists client_errors_session_created_idx
  on public.client_errors (session_id, created_at desc);

create or replace function public.client_errors_rate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No session id: nothing to group by, so nothing to limit. The size bounds
  -- above still apply.
  if new.session_id is null or new.session_id = '' then
    return new;
  end if;
  if (
    select count(*) from public.client_errors
    where session_id = new.session_id
      and created_at > now() - interval '1 hour'
  ) >= 40 then
    return null; -- drop, silently and successfully
  end if;
  return new;
end $$;

drop trigger if exists client_errors_rate_guard_trg on public.client_errors;
create trigger client_errors_rate_guard_trg
  before insert on public.client_errors
  for each row execute function public.client_errors_rate_guard();

-- ── 4. Retention ─────────────────────────────────────────────────────────────
create or replace function public.client_errors_purge()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.client_errors where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.client_errors_purge() from public, anon, authenticated;

-- pg_cron is already installed by 019. Unlike the AI reconciler this needs no
-- Vault secret and no HTTP call — it is plain SQL in the same database, so it
-- starts working the moment this migration lands.
create extension if not exists pg_cron;

select cron.unschedule('client-errors-purge')
where exists (select 1 from cron.job where jobname = 'client-errors-purge');

select cron.schedule(
  'client-errors-purge',
  '17 4 * * *', -- daily, off the hour so it does not pile onto other jobs
  $$select public.client_errors_purge();$$
);
