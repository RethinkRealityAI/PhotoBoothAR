-- 052_marketing_reveals.sql
--
-- Beamwall's OWN marketing "reveals" (not a customer feature): an email with a
-- glowing "Reveal now" button that opens /reveal/:slug, where Beamy guards the
-- news until the reader unlocks it. Edited at /admin/reveals by platform
-- admins only.
--
-- Shape: draft/publish, like 030_landing_content. `draft` is what the editor
-- saves as the admin types; `published` is what /reveal/:slug shows. Both are
-- OPAQUE jsonb here: the browser runs every read through normalizeRevealDoc
-- (src/lib/reveals/revealModel.ts), a TOTAL function, so a malformed blob can
-- never blank the page.
--
-- Access: platform admins read and write the table directly (the 041 precedent:
-- is_platform_admin() in the policy; no customer can ever match it). Nobody
-- else has a policy, so `draft` (unreviewed copy) is never public. Anonymous
-- readers get ONLY a published blob, by slug, through get_marketing_reveal().
--
-- Idempotent.

create table if not exists public.marketing_reveals (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                  check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$'),
  name          text not null default 'Untitled reveal' check (char_length(name) <= 120),
  draft         jsonb not null default '{}'::jsonb check (pg_column_size(draft) <= 65536),
  published     jsonb check (published is null or pg_column_size(published) <= 65536),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

alter table public.marketing_reveals enable row level security;

drop policy if exists marketing_reveals_admin_all on public.marketing_reveals;
create policy marketing_reveals_admin_all on public.marketing_reveals
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop trigger if exists marketing_reveals_updated_at on public.marketing_reveals;
create trigger marketing_reveals_updated_at before update on public.marketing_reveals
  for each row execute function public.set_updated_at();

-- The one public read: a PUBLISHED blob by slug (null when unknown or never
-- published). Draft never crosses this boundary.
create or replace function public.get_marketing_reveal(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select published from public.marketing_reveals
   where slug = p_slug and published is not null
   limit 1;
$$;
-- LOAD-BEARING (see 022/030): a SECURITY DEFINER function is exposed at
-- /rest/v1/rpc/ to public unless revoked. Revoke, then grant the readers.
revoke all on function public.get_marketing_reveal(text) from public;
grant execute on function public.get_marketing_reveal(text) to anon, authenticated;

-- Supabase default privileges grant ALL (incl. TRUNCATE) on new public tables
-- to anon/authenticated; RLS stops row access but not TRUNCATE. Take back what
-- no client needs.
revoke all on public.marketing_reveals from anon;
revoke truncate, references, trigger on public.marketing_reveals from authenticated;
