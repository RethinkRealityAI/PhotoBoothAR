-- 010: Orders — the revenue data path for the admin Payments screen (Phase 3).
--
-- One row per fulfilled Stripe charge: the initial checkout for all three
-- purchase kinds (event_package, credit_pack, pro_subscription), plus each
-- Pro renewal (stripe-webhook's invoice.payment_succeeded handler, gated on
-- billing_reason = 'subscription_cycle' so the first period isn't double-
-- counted against the checkout-session row). Amounts are integer cents,
-- exactly as Stripe reports them — never recomputed from a client-side price
-- table. Written only by the service-role stripe-webhook function; read by
-- admin-api. No client policies: tenant orgs never see raw payment rows here
-- (their own billing view goes through subscriptions/event_plans instead).

create table if not exists public.orders (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  event_id     uuid references public.events(id) on delete set null,
  kind         text not null check (kind = any (array['event_package', 'credit_pack', 'pro_subscription'])),
  tier         text,
  amount_total integer not null check (amount_total >= 0),
  currency     text not null default 'usd',
  status       text not null default 'paid' check (status = any (array['paid', 'refunded'])),
  stripe_ref   text,
  created_at   timestamptz not null default now()
);
create index if not exists orders_org_idx on public.orders (org_id);
create index if not exists orders_created_idx on public.orders (created_at desc);

alter table public.orders enable row level security;
-- No select/insert/update/delete policies for anon/authenticated: service-role
-- (stripe-webhook writes, admin-api reads) only, same posture as admin_audit.
