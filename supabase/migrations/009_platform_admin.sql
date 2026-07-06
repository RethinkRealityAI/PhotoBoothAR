-- 009: Platform super-admin foundation.
--
-- Adds a platform-admin identity (distinct from per-org owner/editor), an
-- append-only admin audit log, and the SECURITY DEFINER helpers the cross-tenant
-- `admin-api` edge function needs (signed credit adjust, bulk email resolution).
--
-- Security model: tenant RLS stays strictly tenant-scoped (unchanged). ALL
-- cross-tenant access goes through the service-role `admin-api` function, which
-- re-checks platform-admin membership before every action. The client-side read
-- policy below is UX-only (show/hide /admin) and is self-scoped so it cannot be
-- used to enumerate the admin roster.

-- ── Identity ────────────────────────────────────────────────────────────────
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

-- UX-only: a signed-in user may see ONLY their own admin row (never the roster).
drop policy if exists platform_admins_self_read on public.platform_admins;
create policy platform_admins_self_read on public.platform_admins
  for select using (user_id = auth.uid());
-- No insert/update/delete policies → the roster is mutated by service-role only.

create or replace function public.is_platform_admin(p_user uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins a where a.user_id = p_user);
$$;
revoke all on function public.is_platform_admin(uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;

-- ── Seed + claim-on-confirm (mirrors claim_legacy_org in 005) ────────────────
-- Opportunistic: seed now if the user already exists.
insert into public.platform_admins (user_id, email)
select id, email from auth.users where lower(email) = 'dapo@rethinkreality.ai'
on conflict (user_id) do nothing;

-- Deferred: claim on email-confirm, so a stranger signing up with the address
-- (but never confirming) can't consume it. Email-gated to the platform owner.
create or replace function public.claim_platform_admin(p_user uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(p_email, '')) = 'dapo@rethinkreality.ai' then
    insert into public.platform_admins (user_id, email) values (p_user, p_email)
    on conflict (user_id) do nothing;
  end if;
end $$;
revoke all on function public.claim_platform_admin(uuid, text) from public, anon, authenticated;

-- Extend the existing signup/confirm triggers to also claim platform-admin.
-- Bodies reproduce 005's behavior verbatim, plus the one new perform.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform public.claim_legacy_org(new.id, new.email);
    perform public.claim_platform_admin(new.id, new.email);
  end if;
  return new;
end $$;

create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform public.claim_legacy_org(new.id, new.email);
    perform public.claim_platform_admin(new.id, new.email);
  end if;
  return new;
end $$;
revoke all on function public.handle_user_confirmed() from public, anon, authenticated;

-- ── Audit log (append-only; service-role writes, admin-api reads) ────────────
create table if not exists public.admin_audit (
  id            bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  meta          jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);
alter table public.admin_audit enable row level security;
-- No client policies: service-role (RLS-bypassing) writes and reads via admin-api.

-- ── Signed credit adjustment (comp up OR claw back; floors at 0) ─────────────
-- grant_credits is positive-only and spend_credits raises on insufficient, so a
-- comp *decrease* had no primitive. Records the move in the same ledger.
create or replace function public.admin_adjust_credits(
  p_org uuid, p_delta int, p_reason text, p_ref jsonb default null
) returns int
language plpgsql security definer set search_path = public as $$
declare nb int;
begin
  update public.credit_balances set balance = greatest(0, balance + p_delta)
    where org_id = p_org returning balance into nb;
  if not found then
    insert into public.credit_balances(org_id, balance) values (p_org, greatest(0, p_delta))
    returning balance into nb;
  end if;
  insert into public.credit_ledger(org_id, delta, reason, ref) values (p_org, p_delta, p_reason, p_ref);
  return nb;
end $$;
revoke all on function public.admin_adjust_credits(uuid, int, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_adjust_credits(uuid, int, text, jsonb) to service_role;

-- ── Bulk email resolution (auth.users isn't exposed to PostgREST; PII gate) ──
create or replace function public.admin_user_emails(p_ids uuid[])
returns table(id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email from auth.users u where u.id = any(p_ids);
$$;
revoke all on function public.admin_user_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_user_emails(uuid[]) to service_role;
