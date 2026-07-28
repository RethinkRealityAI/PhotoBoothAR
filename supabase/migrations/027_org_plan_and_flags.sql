-- 027_org_plan_and_flags.sql
-- Org-level plans, and a feature-flag system with four layers.
--
-- WHY: `orgs` has had no plan column since 001. A plan lives per-EVENT
-- (events.plan_tier) or as a Pro `subscriptions` row, so the only admin lever
-- over a customer was set_event_tier — a single-event comp. There was no way to
-- upgrade or downgrade an ACCOUNT, no way to grant one capability to one
-- customer, and no way to turn a feature off platform-wide when a provider
-- breaks. Entitlements were a hardcoded TypeScript table mirrored by hand into
-- four Deno functions, so "give this customer a special feature" meant editing
-- code and deploying.
--
-- This migration adds the DATA. 028 adds the resolver that reads it.
--
-- Additive and idempotent.

-- ── Org-level plan ───────────────────────────────────────────────────────────
alter table public.orgs
  add column if not exists plan_tier       text not null default 'free',
  -- An expiring comp is the difference between a trial and a free tier created
  -- by accident. The resolver treats an expired plan as 'free'.
  add column if not exists plan_expires_at timestamptz,
  add column if not exists plan_note       text,
  add column if not exists plan_source     text not null default 'default',
  add column if not exists plan_set_by     uuid references auth.users(id) on delete set null,
  add column if not exists plan_set_at     timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint
                 where conrelid='public.orgs'::regclass and conname='orgs_plan_tier_check') then
    alter table public.orgs add constraint orgs_plan_tier_check
      check (plan_tier in ('free','essentials','premium','deluxe')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid='public.orgs'::regclass and conname='orgs_plan_source_check') then
    alter table public.orgs add constraint orgs_plan_source_check
      check (plan_source in ('default','stripe','admin_override')) not valid;
  end if;
  -- events.plan_tier has been unconstrained since 001 while event_plans.tier and
  -- orders.kind both have CHECKs. Same rule, same NOT VALID reasoning.
  if not exists (select 1 from pg_constraint
                 where conrelid='public.events'::regclass and conname='events_plan_tier_check') then
    alter table public.events add constraint events_plan_tier_check
      check (plan_tier in ('free','essentials','premium','deluxe')) not valid;
  end if;
end $$;

-- ── The registry ─────────────────────────────────────────────────────────────
create table if not exists public.feature_flags (
  key         text primary key,
  label       text not null,
  description text not null,
  category    text not null,
  value_type  text not null check (value_type in ('boolean','nullable_number')),
  -- Granting this by override gives away something a customer would otherwise
  -- pay for. Surfaced in the admin UI so a comp is never accidental.
  paid        boolean not null default false,
  -- Whether a global kill switch may force this flag. FALSE for the two that
  -- would break a live legacy wall if switched off mid-event.
  killable    boolean not null default true,
  killed      boolean not null default false,
  killed_value jsonb,
  killed_reason text,
  killed_at   timestamptz,
  killed_by   uuid references auth.users(id) on delete set null,
  sort        int not null default 100
);

-- ── Per-plan defaults (editable, so a tier's contents change without a deploy) ─
create table if not exists public.plan_feature_defaults (
  tier     text not null check (tier in ('free','essentials','premium','deluxe')),
  flag_key text not null references public.feature_flags(key) on delete cascade,
  value    jsonb not null,
  primary key (tier, flag_key)
);

-- ── Overrides. Absent row = inherit; that is the third state. ─────────────────
create table if not exists public.org_feature_overrides (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  flag_key   text not null references public.feature_flags(key) on delete cascade,
  value      jsonb not null,
  reason     text,
  expires_at timestamptz,
  set_by     uuid references auth.users(id) on delete set null,
  set_at     timestamptz not null default now(),
  primary key (org_id, flag_key)
);

create table if not exists public.event_feature_overrides (
  -- events.id UUID (the event_plans convention), NOT the slug. CLAUDE.md's trap.
  event_id   uuid not null references public.events(id) on delete cascade,
  flag_key   text not null references public.feature_flags(key) on delete cascade,
  value      jsonb not null,
  reason     text,
  expires_at timestamptz,
  set_by     uuid references auth.users(id) on delete set null,
  set_at     timestamptz not null default now(),
  primary key (event_id, flag_key)
);

-- RLS on, ZERO client policies on all four: reads go through the SECURITY
-- DEFINER resolvers in 028, writes are service-role via admin-api only. Same
-- posture as admin_audit / orders / platform_config.
alter table public.feature_flags           enable row level security;
alter table public.plan_feature_defaults   enable row level security;
alter table public.org_feature_overrides   enable row level security;
alter table public.event_feature_overrides enable row level security;

-- ── Seed: transcribed from src/lib/plans.ts ENTITLEMENTS ─────────────────────
-- `on conflict do nothing` so re-applying never clobbers a live tweak an
-- operator has since made through /admin/features.
insert into public.feature_flags (key, label, description, category, value_type, paid, killable, sort) values
  ('maxPosts',           'Post cap',            'How many photos or videos an event may collect. Empty = unlimited.', 'capture', 'nullable_number', true,  true,  10),
  ('videoEnabled',       'Video capture',       'Guests may record video, not just photos.',                          'capture', 'boolean',         true,  true,  20),
  ('watermark',          'Beamwall signature',  'The Beamwall credit is drawn into captures.',                         'capture', 'boolean',         false, false, 30),
  ('aiStudio',           'AI studio',           'AI frame and 3D generation in the studio.',                           'ai',      'boolean',         true,  true,  40),
  ('cardsStandard',      'Keepsake cards',      'The greeting-card guestbook.',                                        'cards',   'boolean',         true,  true,  50),
  ('cardsPremiumRender', 'Card film render',    'The rendered MP4 keepsake film.',                                     'cards',   'boolean',         true,  true,  60),
  ('projectionMode',     'Projection mode',     'Full-screen wall projection for the venue screen.',                   'wall',    'boolean',         false, false, 70),
  ('retentionDays',      'Media retention',     'Days captures are kept. Empty = forever.',                            'capture', 'nullable_number', true,  true,  80)
on conflict (key) do nothing;

insert into public.plan_feature_defaults (tier, flag_key, value) values
  ('free','maxPosts','25'::jsonb),          ('free','videoEnabled','false'::jsonb),
  ('free','watermark','true'::jsonb),        ('free','aiStudio','false'::jsonb),
  ('free','cardsStandard','false'::jsonb),   ('free','cardsPremiumRender','false'::jsonb),
  ('free','projectionMode','true'::jsonb),   ('free','retentionDays','7'::jsonb),

  ('essentials','maxPosts','500'::jsonb),    ('essentials','videoEnabled','true'::jsonb),
  ('essentials','watermark','false'::jsonb), ('essentials','aiStudio','true'::jsonb),
  ('essentials','cardsStandard','false'::jsonb), ('essentials','cardsPremiumRender','false'::jsonb),
  ('essentials','projectionMode','true'::jsonb), ('essentials','retentionDays','90'::jsonb),

  ('premium','maxPosts','null'::jsonb),      ('premium','videoEnabled','true'::jsonb),
  ('premium','watermark','false'::jsonb),    ('premium','aiStudio','true'::jsonb),
  ('premium','cardsStandard','true'::jsonb), ('premium','cardsPremiumRender','false'::jsonb),
  ('premium','projectionMode','true'::jsonb), ('premium','retentionDays','365'::jsonb),

  ('deluxe','maxPosts','null'::jsonb),       ('deluxe','videoEnabled','true'::jsonb),
  ('deluxe','watermark','false'::jsonb),     ('deluxe','aiStudio','true'::jsonb),
  ('deluxe','cardsStandard','true'::jsonb),  ('deluxe','cardsPremiumRender','true'::jsonb),
  ('deluxe','projectionMode','true'::jsonb), ('deluxe','retentionDays','365'::jsonb)
on conflict (tier, flag_key) do nothing;

create index if not exists org_feature_overrides_org_idx   on public.org_feature_overrides (org_id);
create index if not exists event_feature_overrides_evt_idx on public.event_feature_overrides (event_id);
