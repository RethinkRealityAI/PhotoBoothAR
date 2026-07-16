-- 011_credits_config_promo.sql
--
-- Signup welcome credits (admin-configurable), plus a promo-code system.
--
-- Orgs are created lazily (create-event edge fn), so both the welcome bonus and
-- any promo the user entered at signup are applied in handle_new_org(), the
-- org-creation trigger. The promo code is captured into profiles at signup
-- (handle_new_user) and consumed + cleared when the org is created.
--
-- Additive + idempotent. Credits stay ORG-scoped (each self-serve host = their
-- own org). All new tables are service-role/definer-only (no client policies);
-- clients touch them only through admin-api (service role) and the SECURITY
-- DEFINER functions below.

/* ── Platform config (admin-editable settings, e.g. the welcome amount) ── */
create table if not exists public.platform_config (
  key        text primary key,
  int_value  int,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.platform_config enable row level security;
-- No client policies: read by SECURITY DEFINER functions (RLS-bypassing) and
-- read/written by admin-api (service role).
insert into public.platform_config (key, int_value) values ('signup_bonus_credits', 25)
  on conflict (key) do nothing;

/* ── Promo code carried from signup to org-creation ────────────────────── */
alter table public.profiles add column if not exists pending_promo_code text;

/* ── Promo codes + redemptions ─────────────────────────────────────────── */
create table if not exists public.promo_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  credits         int  not null check (credits > 0),
  max_redemptions int,            -- null = unlimited
  redemptions     int  not null default 0,
  expires_at      timestamptz,    -- null = never expires
  active          boolean not null default true,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create unique index if not exists promo_codes_code_uidx on public.promo_codes (lower(code));
alter table public.promo_codes enable row level security;
-- No client policies: managed via admin-api (service role), read by redeem_promo.

create table if not exists public.promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references public.promo_codes(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (promo_id, org_id)       -- one redemption per org
);
alter table public.promo_redemptions enable row level security;

/* ── redeem_promo: validate + grant + record. Never raises — returns the
      credits granted (0 when the code is missing/invalid/expired/capped or
      already redeemed by this org), so the org-creation trigger can't fail. ── */
create or replace function public.redeem_promo(p_org uuid, p_code text, p_user uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_promo public.promo_codes%rowtype;
begin
  if p_code is null or btrim(p_code) = '' then
    return 0;
  end if;

  select * into v_promo from public.promo_codes
    where lower(code) = lower(btrim(p_code))
      and active
      and (expires_at is null or expires_at > now())
      and (max_redemptions is null or redemptions < max_redemptions)
    for update;
  if not found then
    return 0;
  end if;

  insert into public.promo_redemptions (promo_id, org_id, user_id)
    values (v_promo.id, p_org, p_user)
    on conflict (promo_id, org_id) do nothing;
  if not found then
    return 0;  -- this org already redeemed this code
  end if;

  update public.promo_codes set redemptions = redemptions + 1 where id = v_promo.id;
  perform public.grant_credits(p_org, v_promo.credits, 'promo:' || v_promo.code,
                               jsonb_build_object('promo_id', v_promo.id));
  return v_promo.credits;
end $$;
-- Internal only (called by handle_new_org, which runs as definer).
revoke all on function public.redeem_promo(uuid, text, uuid) from public, anon, authenticated;

/* ── Org bootstrap: enrol owner + grant welcome credits + redeem promo ──── */
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_bonus int;
  v_code  text;
begin
  if new.owner_id is not null then
    insert into public.org_members (org_id, user_id, role)
      values (new.id, new.owner_id, 'owner')
    on conflict do nothing;

    -- Welcome credits — amount is admin-configurable (default 25 if unset).
    v_bonus := coalesce((select int_value from public.platform_config
                         where key = 'signup_bonus_credits'), 25);
    if v_bonus > 0 then
      perform public.grant_credits(new.id, v_bonus, 'signup_bonus');
    end if;

    -- Apply a promo code the owner entered at signup, then clear it.
    select pending_promo_code into v_code from public.profiles where id = new.owner_id;
    if v_code is not null and btrim(v_code) <> '' then
      perform public.redeem_promo(new.id, v_code, new.owner_id);
      update public.profiles set pending_promo_code = null where id = new.owner_id;
    end if;
  end if;
  return new;
end $$;

/* ── Capture the promo code at signup (reproduces 009 verbatim + promo). ── */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, pending_promo_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    nullif(btrim(new.raw_user_meta_data ->> 'promo_code'), '')
  )
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform public.claim_legacy_org(new.id, new.email);
    perform public.claim_platform_admin(new.id, new.email);
  end if;
  return new;
end $$;
