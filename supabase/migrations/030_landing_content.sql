-- 030_landing_content.sql
--
-- CMS for the PLATFORM marketing landing page (src/pages/Landing.tsx) — the
-- owner swaps images, videos and copy from /admin/landing without a deploy.
-- Distinct from the per-EVENT "landing" app_settings key (types.ts
-- LandingContent, the guest /join page): this is one singleton row for the
-- whole platform.
--
-- Shape: draft/publish. `draft` is what the admin editor works on; `published`
-- is what anonymous visitors read. Publishing copies draft → published and
-- bumps `version`. Both blobs are OPAQUE jsonb here — the browser runs every
-- read through normalizeLandingContent (src/lib/landingContent.ts), a total
-- function that falls back per-field to the bundled defaults, so a malformed
-- or empty blob can never blank the marketing page.
--
-- Access: NO client policies — `draft` must never be publicly readable (it may
-- contain unreviewed copy), so clients cannot touch the table at all; admin-api
-- (service role) is the sole writer. Anonymous visitors read ONLY the published
-- half through get_landing_content() below.
--
-- Idempotent.

create table if not exists public.landing_content (
  id          int  primary key default 1 check (id = 1),   -- singleton row
  published   jsonb not null default '{}'::jsonb,
  draft       jsonb not null default '{}'::jsonb,
  version     int  not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.landing_content enable row level security;
-- No client policies: draft must never be publicly readable. admin-api
-- (service role) writes; RLS-on with no policy = deny-all to clients.
insert into public.landing_content (id) values (1) on conflict do nothing;

-- The one public read: the PUBLISHED blob only. Draft never crosses this
-- boundary.
create or replace function public.get_landing_content()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(published, '{}'::jsonb) from public.landing_content where id = 1;
$$;
-- The revoke-then-grant below is LOAD-BEARING: a SECURITY DEFINER function is
-- auto-exposed at /rest/v1/rpc/ to public unless revoked — migration 022 exists
-- because exactly this class of bug shipped once already. Revoke everything,
-- then grant back only the readers the marketing page needs.
revoke all on function public.get_landing_content() from public;
grant execute on function public.get_landing_content() to anon, authenticated;
