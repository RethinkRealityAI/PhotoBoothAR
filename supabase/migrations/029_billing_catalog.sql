-- 029_billing_catalog.sql
-- A real product catalogue, and the end of the third mirror family.
--
-- WHY: stripe-checkout builds every line item from inline `price_data`, so no
-- Stripe Product or Price object has ever existed for this business. Two
-- consequences, both biting:
--   1. There is nothing to move a subscription ONTO. An admin "change this
--      customer's plan" cannot be expressed in Stripe at all, and Stripe's own
--      revenue/product reporting sees eight unrelated ad-hoc charges instead of
--      a catalogue.
--   2. The prices and the credit grants are duplicated: `PRICES` in
--      stripe-checkout, and PACKAGE_CREDITS/PACK_CREDITS/PRO_MONTHLY_CREDITS in
--      stripe-webhook. Two files that must agree about money, held together by
--      nothing. (This is the same failure shape as the four ENTITLEMENTS
--      mirrors that 028 exists to end.)
--
-- This table is the single source for both, and carries the Stripe ids once
-- they have been provisioned. `id` is our own stable key and is what metadata
-- and lookup_key are built from, so re-running provisioning is idempotent and
-- a price can be re-pointed without touching code.
--
-- Amounts stay in CENTS as integers — never floats, never dollars.
--
-- Additive and idempotent.

create table if not exists public.billing_catalog (
  -- Stable business key, e.g. 'event_package.premium'. Also the Stripe
  -- lookup_key, which is what makes provisioning idempotent.
  id       text primary key,
  kind     text not null check (kind in ('event_package','credit_pack','pro_subscription')),
  -- Tier within the kind ('premium', '120', or null for the single Pro plan).
  tier     text,
  name     text not null,
  description text,
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'usd',
  -- null = one-time. 'month'/'year' = recurring.
  recurring_interval text check (recurring_interval in ('month','year')),
  -- Credits this purchase grants. stripe-webhook reads THIS instead of its own
  -- three constant maps.
  credits_granted int not null default 0 check (credits_granted >= 0),
  -- Sold today? Retiring a price must never delete the row: existing orders
  -- reference it, and Stripe forbids deleting a Price that has been used.
  active   boolean not null default true,
  sort     int not null default 100,

  stripe_product_id text,
  stripe_price_id   text,
  synced_at   timestamptz,
  sync_error  text,
  updated_at  timestamptz not null default now()
);

create index if not exists billing_catalog_kind_idx on public.billing_catalog (kind, sort);

alter table public.billing_catalog enable row level security;

-- Prices are not secret — they are on the pricing page. A public read of the
-- ACTIVE rows lets the marketing page, the in-app upgrade card and Stripe all
-- quote one number, instead of the three hand-kept copies that exist today.
-- Writes stay service-role only (admin-api), like every other money table.
drop policy if exists billing_catalog_public_read on public.billing_catalog;
create policy billing_catalog_public_read on public.billing_catalog
  for select to anon, authenticated
  using (active);

create or replace function public.billing_catalog_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.billing_catalog_touch() from public, anon, authenticated;

drop trigger if exists billing_catalog_touch_trg on public.billing_catalog;
create trigger billing_catalog_touch_trg
  before update on public.billing_catalog
  for each row execute function public.billing_catalog_touch();

-- Seed: transcribed EXACTLY from stripe-checkout PRICES and stripe-webhook's
-- credit maps. `on conflict do nothing` so re-applying never overwrites a price
-- an operator has since changed through /admin/catalog.
insert into public.billing_catalog
  (id, kind, tier, name, description, amount_cents, recurring_interval, credits_granted, sort) values
  ('event_package.essentials', 'event_package', 'essentials', 'Essentials event package',
   'One event: 500 photos & videos, every frame, no watermark, 90-day storage.', 4900, null, 20, 10),
  ('event_package.premium', 'event_package', 'premium', 'Premium event package',
   'One event: unlimited captures, keepsake cards, 1-year storage.', 9900, null, 100, 20),
  ('event_package.deluxe', 'event_package', 'deluxe', 'Deluxe event package',
   'One event: everything in Premium plus the rendered keepsake film.', 16900, null, 130, 30),
  ('credit_pack.50', 'credit_pack', '50', '50 credit pack',
   'Credits for AI frames and 3D props.', 500, null, 50, 40),
  ('credit_pack.120', 'credit_pack', '120', '120 credit pack',
   'Credits for AI frames and 3D props.', 1000, null, 120, 50),
  ('credit_pack.300', 'credit_pack', '300', '300 credit pack',
   'Credits for AI frames and 3D props.', 2000, null, 300, 60),
  ('pro_subscription.monthly', 'pro_subscription', null, 'Beamwall Pro',
   'Unlimited events at Premium level, plus 300 credits a month.', 7900, 'month', 300, 70)
on conflict (id) do nothing;
