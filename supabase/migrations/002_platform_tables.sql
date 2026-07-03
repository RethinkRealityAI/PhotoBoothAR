-- 002: FKs to events, experiences catalog columns, billing/credits, AI jobs,
-- manager tokens, guest quotas, private storage buckets. Additive; legacy-safe
-- (pre-verified: every existing event_id is one of the three seeded slugs).

-- Experiences become catalog-capable: global rows have no event.
alter table public.experiences
  add column if not exists org_id uuid references public.orgs(id) on delete set null,
  add column if not exists is_global boolean not null default false,
  add column if not exists source text not null default 'upload'
    check (source in ('upload', 'procedural', 'ai_gemini', 'ai_higgsfield', 'ai_meshy'));
alter table public.experiences alter column event_id drop not null;
alter table public.experiences drop constraint if exists experiences_global_or_event;
alter table public.experiences
  add constraint experiences_global_or_event check (is_global or event_id is not null);

-- Tenant FKs (event_id text = events.slug; no data rewrite).
alter table public.experiences drop constraint if exists experiences_event_fk;
alter table public.experiences
  add constraint experiences_event_fk foreign key (event_id)
  references public.events(slug) on delete cascade;
alter table public.posts drop constraint if exists posts_event_fk;
alter table public.posts
  add constraint posts_event_fk foreign key (event_id)
  references public.events(slug) on delete cascade;
alter table public.challenges drop constraint if exists challenges_event_fk;
alter table public.challenges
  add constraint challenges_event_fk foreign key (event_id)
  references public.events(slug) on delete cascade;
alter table public.app_settings drop constraint if exists app_settings_event_fk;
alter table public.app_settings
  add constraint app_settings_event_fk foreign key (event_id)
  references public.events(slug) on delete cascade;

-- Linking global catalog items into an event's library (no copying).
create table if not exists public.event_catalog_links (
  event_id text not null references public.events(slug) on delete cascade,
  experience_id uuid not null references public.experiences(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, experience_id)
);

-- Anonymous-write abuse control (maintained by the submit-post edge function).
create table if not exists public.guest_quota (
  event_id text not null references public.events(slug) on delete cascade,
  session_id text not null,
  window_start timestamptz not null default now(),
  post_count int not null default 0,
  primary key (event_id, session_id)
);

-- Billing ------------------------------------------------------------------
create table if not exists public.event_plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  tier text not null check (tier in ('essentials', 'premium', 'deluxe')),
  stripe_payment_intent text,
  features jsonb not null default '{}'::jsonb,
  purchased_at timestamptz not null default now()
);
create index if not exists event_plans_event_idx on public.event_plans (event_id);

create table if not exists public.subscriptions (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  tier text not null default 'pro',
  current_period_end timestamptz
);

create table if not exists public.credit_balances (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  balance int not null default 0 check (balance >= 0)
);

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  delta int not null,
  reason text not null,
  ref jsonb,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_org_idx on public.credit_ledger (org_id, created_at desc);

create table if not exists public.stripe_webhook_events (
  id text primary key,
  type text,
  processed_at timestamptz not null default now()
);

-- AI jobs (Meshy is async; image jobs recorded for audit/refund too).
create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  kind text not null check (kind in ('image', 'model3d')),
  provider text not null,
  provider_job_id text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'refunded')),
  input jsonb,
  result_url text,
  error text,
  credits_charged int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_jobs_org_idx on public.ai_jobs (org_id, created_at desc);

-- Day-of staff access (hashed PIN/link tokens; validated by manager-api fn).
create table if not exists public.event_access_tokens (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  token_hash text not null,
  role text not null default 'manager',
  label text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists event_access_tokens_event_idx on public.event_access_tokens (event_id);

alter table public.event_catalog_links enable row level security;
alter table public.guest_quota enable row level security;
alter table public.event_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_balances enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.event_access_tokens enable row level security;

-- Courtesy starter credits for the Legacy org.
insert into public.credit_balances (org_id, balance)
select id, 25 from public.orgs where name = 'Legacy Events'
on conflict (org_id) do nothing;

-- Private buckets for greeting-card media and rendered films.
insert into storage.buckets (id, name, public)
values ('cards', 'cards', false), ('renders', 'renders', false)
on conflict (id) do nothing;
