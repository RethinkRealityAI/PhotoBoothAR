-- 054_platform_settings.sql
--
-- Platform-wide switches the OWNER flips (not plan features, not per-customer
-- overrides — those live in 027/028's feature flags). First switch:
--
--   ai_for_hosts  (boolean, default FALSE)
--     Every host-facing AI tool — AI frame/sticker generation, AI 3D props, the
--     Event Concierge / Platform Copilot chat and the Studio's Scene Director.
--     OFF = only platform admins can use them (they keep refining them);
--     ON  = hosts get them again, still subject to their plan's `aiStudio`
--     flag and credits exactly as before.
--
--   Deliberately NOT a kill switch on `aiStudio`: a kill switch beats EVERY
--   layer, so it would also lock the platform admins out, and the chat
--   assistant was never gated by `aiStudio` at all.
--
--   NOT covered (stay on): the guest booth's AI challenge photo-check and the
--   go-live guest-copy writer (no host-facing tool; turning them off only
--   degrades the guest side).
--
-- Who decides: public.ai_allowed_for(user) is the ONE authority. The three AI
-- edge functions (ai-generate-image, ai-generate-3d, ai-event-designer) call
-- it on the service role and fail CLOSED; the browser calls my_ai_access()
-- only to hide buttons — hiding is cosmetic, the edge functions are the gate.
--
-- Turn hosts back on (either works):
--   /admin/features → "AI tools for hosts" → On
--   update public.platform_settings set value = 'true'::jsonb where key = 'ai_for_hosts';
--
-- Idempotent.

create table if not exists public.platform_settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value       jsonb not null,
  note        text check (note is null or char_length(note) <= 500),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

alter table public.platform_settings enable row level security;

-- Platform admins read and write directly (the 052 precedent). Nobody else has
-- a policy: hosts learn only what my_ai_access() tells them.
drop policy if exists platform_settings_admin_all on public.platform_settings;
create policy platform_settings_admin_all on public.platform_settings
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop trigger if exists platform_settings_updated_at on public.platform_settings;
create trigger platform_settings_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

revoke truncate, references, trigger on public.platform_settings from anon, authenticated;

insert into public.platform_settings (key, value, note)
values ('ai_for_hosts', 'false'::jsonb,
        'Host-facing AI tools (frame/3D generation, concierge/copilot, scene director). false = platform admins only.')
on conflict (key) do nothing;

-- The ONE authority. A missing row or a non-boolean value reads as OFF.
create or replace function public.ai_allowed_for(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    public.is_platform_admin(p_user)
    or coalesce((select value = 'true'::jsonb from public.platform_settings where key = 'ai_for_hosts'), false)
  );
$$;
-- LOAD-BEARING (022/030/052): revoke the default public execute, then grant.
-- service_role only — it takes ANY user id, so it must never be callable
-- by a browser.
revoke all on function public.ai_allowed_for(uuid) from public;
-- Supabase default privileges ALSO grant execute to anon/authenticated
-- explicitly, so revoking from public alone is not enough.
revoke all on function public.ai_allowed_for(uuid) from anon, authenticated;
grant execute on function public.ai_allowed_for(uuid) to service_role;

-- What the signed-in browser may ask: its OWN answer, nothing more.
create or replace function public.my_ai_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.ai_allowed_for(auth.uid());
$$;
revoke all on function public.my_ai_access() from public;
revoke all on function public.my_ai_access() from anon;
grant execute on function public.my_ai_access() to authenticated;
