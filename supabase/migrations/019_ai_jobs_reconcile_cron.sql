-- 019: Schedule the AI-job reconciliation sweep.
--
-- A Meshy job only advances when something POLLS it — the poll is what starts
-- the refine pass, downloads the GLB, creates the experience, or refunds a
-- failure. Every poller in the product is an in-flight UI loop, so a host who
-- closes the tab leaves the job finished at the provider and frozen at
-- `running` here forever: ~11 credits spent, no experience, and Meshy deletes
-- the asset after three days.
--
-- src/lib/useAiJobSweep.ts recovers those when the host comes BACK. This
-- recovers them when they do not.
--
-- Calls ai-job-status with `{ sweep: true }` and the service-role key, which
-- that function already holds in its own env — so this needs no NEW secret, and
-- anyone able to present that key could already do everything the function
-- does. The function fails closed if the key is unset.
--
-- ONE-TIME SETUP (not automatable from a migration, by design — a migration
-- must never contain a credential): store the service-role key in Vault once.
--
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--
-- Until that exists the schedule below is created but each run is a no-op that
-- records the reason in cron.job_run_details — nothing else is affected, and
-- the client-side sweep continues to cover returning hosts.
--
-- Idempotent.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Re-scheduling the same name replaces it, so re-running this is safe.
select cron.unschedule('ai-jobs-reconcile')
where exists (select 1 from cron.job where jobname = 'ai-jobs-reconcile');

-- Every 15 minutes. The sweep only touches jobs older than 11 minutes (a live
-- UI loop owns anything younger), and each run takes at most 10 jobs, so this
-- drains a backlog steadily without ever racing a host who is still watching.
select cron.schedule(
  'ai-jobs-reconcile',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/ai-job-status',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
      )
    ),
    body    := jsonb_build_object('sweep', true),
    timeout_milliseconds := 55000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'service_role_key');
  $$
);
