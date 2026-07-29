-- 030_org_provider_keys.sql
-- Bring-your-own provider credentials, per org, per provider.
--
-- WHY A NEW TABLE AND NOT app_settings: `app_settings` is PUBLICLY READABLE —
-- the booth, the wall and the keepsake pages all read branding/wall/studio
-- values out of it with the anon key, so anything stored there is world-visible
-- by construction. A provider API secret in app_settings would be a published
-- secret. Hence a dedicated table whose only reader is the service role.
--
-- WHY IT EXISTS AT ALL: a host who brings their own Higgsfield key pays
-- Higgsfield directly, so their generations cost ZERO platform credits. That
-- makes the key a billing input, which is why it must be server-resolved (the
-- edge function reads it) and never client-resolved.
--
-- RLS IS ENABLED WITH NO POLICIES ON PURPOSE. RLS on + zero policies = deny-all
-- to anon and authenticated; the service role bypasses RLS, so the
-- `provider-keys` edge function (which does its own org_members assert) is the
-- sole reader/writer. This is the same posture as public.orders and
-- public.platform_config, and it is why those tables carry an
-- `rls_enabled_no_policy` INFO from the Supabase advisor that is correct by
-- design rather than a finding. NEVER add a client policy here: a select policy
-- keyed on org membership would hand every org member the raw secret, and the
-- app never needs the secret — only whether one is configured, which
-- `provider-keys` action 'status' answers with a masked key id.
--
-- Additive and idempotent.

create table if not exists public.org_provider_keys (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  -- One row per (org, provider). Constrained rather than free text so a typo
  -- cannot create a silently-unused credential row.
  provider   text not null check (provider in ('higgsfield')),
  key_id     text not null,
  key_secret text not null,
  -- 'unverified' until something actually calls the provider with it. No
  -- verification path exists yet, so the honest default is "we have not tried".
  status     text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

do $$ begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.org_provider_keys'::regclass
                   and conname = 'org_provider_keys_status_check') then
    alter table public.org_provider_keys add constraint org_provider_keys_status_check
      check (status in ('unverified','valid','invalid')) not valid;
  end if;
end $$;

-- Self-contained touch trigger. public.set_updated_at() exists on the live DB
-- but is not created by any migration in this repo, so this table owns its own
-- rather than depending on a definition the repo cannot show.
create or replace function public.org_provider_keys_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.org_provider_keys_touch_updated_at() from public, anon, authenticated;

drop trigger if exists org_provider_keys_touch_trg on public.org_provider_keys;
create trigger org_provider_keys_touch_trg
  before update on public.org_provider_keys
  for each row execute function public.org_provider_keys_touch_updated_at();

alter table public.org_provider_keys enable row level security;
-- Deliberately NO policies — see the header. Service role only.
