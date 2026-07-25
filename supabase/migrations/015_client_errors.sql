-- 015_client_errors.sql
-- Minimum-viable client-side error telemetry (observability workstream).
-- Browser clients (anonymous guest booth + authenticated host/admin) report
-- uncaught errors via src/lib/errorReport.ts. The table is WRITE-ONLY from the
-- client:
--   - anon + authenticated may INSERT only; with no select/update/delete
--     policies RLS denies everything else (service_role bypasses RLS as usual);
--   - platform admins may SELECT for triage via public.is_platform_admin()
--     (SECURITY DEFINER helper from 009_platform_admin.sql).
-- Anti-flood is client-side by design: the reporter caps message/stack lengths
-- (2k/8k chars), sends at most 10 reports per page session, and dedupes
-- identical messages within 5 minutes — a DB trigger/CHECK would be overkill
-- for a best-effort telemetry table. Additive + idempotent.

create table if not exists public.client_errors (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  session_id text,
  url        text,
  message    text,
  stack      text,
  user_agent text,
  context    jsonb
);

create index if not exists client_errors_created_idx
  on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

-- Write-only for browsers: INSERT allowed, nothing else.
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated
  with check (true);

-- Platform-admin triage read (same gate the /admin suite uses).
drop policy if exists client_errors_admin_read on public.client_errors;
create policy client_errors_admin_read on public.client_errors
  for select to authenticated
  using (public.is_platform_admin());
