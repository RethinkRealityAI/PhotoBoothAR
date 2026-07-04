-- 001: Tenancy core — profiles, orgs, org_members, events + legacy seed.
-- Additive only: legacy sites (hope-gala, jenna-jake, detola-wuyi) are unaffected.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null,
  event_type text not null default 'wedding',
  status text not null default 'draft'
    check (status in ('draft', 'live', 'ended', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  plan_tier text not null default 'free',
  created_at timestamptz not null default now()
);
create index if not exists events_org_idx on public.events (org_id);

alter table public.profiles enable row level security;
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.events enable row level security;

-- Profile auto-create on signup; the platform owner's signup also claims the
-- seeded Legacy org (owner is not a resolvable auth user at migration time).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  if lower(new.email) = 'dapo@rethinkreality.ai' then
    update public.orgs set owner_id = new.id
      where name = 'Legacy Events' and owner_id is null;
    insert into public.org_members (org_id, user_id, role)
      select id, new.id, 'owner' from public.orgs where name = 'Legacy Events'
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seed the Legacy org and the three live events as tenant rows (idempotent).
insert into public.orgs (name)
select 'Legacy Events'
where not exists (select 1 from public.orgs where name = 'Legacy Events');

insert into public.events (org_id, slug, name, event_type, status)
select o.id, v.slug, v.name, v.event_type, 'live'
from (values
  ('hope-gala',   'SCAGO Hope Gala 2026', 'gala'),
  ('jenna-jake',  'Jenna & Jake',         'wedding'),
  ('detola-wuyi', 'Detola & Wuyi',        'wedding')
) as v (slug, name, event_type)
cross join (select id from public.orgs where name = 'Legacy Events' limit 1) o
where not exists (select 1 from public.events e where e.slug = v.slug);
