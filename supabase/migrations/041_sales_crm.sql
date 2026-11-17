-- 041_sales_crm.sql
--
-- Lightweight partnerships CRM for the internal sales hub (src/pages/sales).
--
-- WHY a login + RLS when the hub itself is a hidden link: the decks and
-- scripts behind that link are not secret, but this table holds third
-- parties' names, emails, phone numbers and notes. A forwarded URL must never
-- be enough to read or wipe that list (privacy law: PIPEDA/CASL in Canada,
-- GDPR for EU prospects). So: the hub page is open, the DATA is not.
--
-- Access model (deliberately NOT tenant-scoped — this is Rethink Reality's own
-- pipeline, not a customer's):
--   * sales_team: who is a rep. No client write policies; the roster changes
--     only through sales_grant_access / sales_revoke_access, which assert
--     is_platform_admin() themselves.
--   * is_sales_member(): on the roster OR a platform admin.
--   * sales_prospects / sales_activities: every member can READ the whole
--     pipeline (stops two people cold-DMing the same planner); a row can only
--     be CHANGED or DELETED by the rep who owns it or a platform admin, which
--     also keeps commission attribution (owner_id) honest.
--   * anon has no grant at all on any of these tables.
--
-- Next number after the beta stack's 039/040. Idempotent.

-- ── Roster ────────────────────────────────────────────────────────────────
create table if not exists public.sales_team (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'rep' check (role in ('rep', 'manager')),
  -- Short public code a rep puts on shared links (?ref=jamesa) so a prospect
  -- who signs up can be attributed. Lowercase, url-safe.
  ref_code   text unique check (ref_code ~ '^[a-z0-9-]{2,24}$'),
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.sales_team enable row level security;

create or replace function public.is_sales_member(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from public.sales_team t where t.user_id = p_user)
    or public.is_platform_admin(p_user)
  );
$$;
-- Load-bearing (see 022): a definer fn is exposed at /rest/v1/rpc/ otherwise.
revoke all on function public.is_sales_member(uuid) from public;
grant execute on function public.is_sales_member(uuid) to authenticated;

drop policy if exists sales_team_read on public.sales_team;
create policy sales_team_read on public.sales_team for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

-- ── Prospects ─────────────────────────────────────────────────────────────
create table if not exists public.sales_prospects (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid references auth.users(id) on delete set null default auth.uid(),
  name              text not null check (char_length(btrim(name)) between 1 and 200),
  company           text check (char_length(company) <= 200),
  role              text check (char_length(role) <= 120),
  icp               text not null default 'planners'
                      check (icp in ('planners', 'brands', 'creators', 'other')),
  -- Launch market: 'ng' Nigeria (James's primary focus, invoiced) | 'na' North America.
  market            text not null default 'ng' check (market in ('ng', 'na')),
  email             text check (char_length(email) <= 254),
  phone             text check (char_length(phone) <= 40),
  website           text check (char_length(website) <= 500),
  location          text check (char_length(location) <= 120),
  -- { instagram, linkedin, tiktok, facebook, youtube, x } → url. The client
  -- only stores https URLs (crm.ts normalizeUrl); the size cap is the backstop.
  socials           jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(socials) = 'object' and pg_column_size(socials) <= 4096),
  source            text check (char_length(source) <= 120),
  status            text not null default 'new'
                      check (status in ('new', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost', 'nurture')),
  -- Estimated or closed deal value, whole cents.
  deal_value_cents  int check (deal_value_cents >= 0),
  next_follow_up    date,
  last_contacted_at timestamptz,
  notes             text check (char_length(notes) <= 20000),
  -- { collateralId: ISO timestamp it was sent } — ids from salesTypes COLLATERAL.
  collateral        jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(collateral) = 'object' and pg_column_size(collateral) <= 4096),
  tags              text[] not null default '{}' check (cardinality(tags) <= 20),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists sales_prospects_owner_idx on public.sales_prospects (owner_id);
create index if not exists sales_prospects_follow_up_idx on public.sales_prospects (next_follow_up)
  where status not in ('won', 'lost');
alter table public.sales_prospects enable row level security;

drop trigger if exists sales_prospects_updated_at on public.sales_prospects;
create trigger sales_prospects_updated_at before update on public.sales_prospects
  for each row execute function public.set_updated_at();

drop policy if exists sales_prospects_read on public.sales_prospects;
create policy sales_prospects_read on public.sales_prospects for select to authenticated
  using (public.is_sales_member());

drop policy if exists sales_prospects_insert on public.sales_prospects;
create policy sales_prospects_insert on public.sales_prospects for insert to authenticated
  with check (public.is_sales_member() and owner_id = auth.uid());

drop policy if exists sales_prospects_update on public.sales_prospects;
create policy sales_prospects_update on public.sales_prospects for update to authenticated
  using (public.is_sales_member() and (owner_id = auth.uid() or public.is_platform_admin()))
  -- WITH CHECK stops a rep re-assigning a row (and its commission) to someone
  -- else; an admin may reassign.
  with check (public.is_sales_member() and (owner_id = auth.uid() or public.is_platform_admin()));

drop policy if exists sales_prospects_delete on public.sales_prospects;
create policy sales_prospects_delete on public.sales_prospects for delete to authenticated
  using (public.is_sales_member() and (owner_id = auth.uid() or public.is_platform_admin()));

-- ── Activity log (touches) — powers the daily outreach counter ────────────
create table if not exists public.sales_activities (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.sales_prospects(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null default auth.uid(),
  kind        text not null check (kind in ('dm', 'email', 'call', 'meeting', 'note', 'status')),
  channel     text check (char_length(channel) <= 40),
  body        text check (char_length(body) <= 4000),
  created_at  timestamptz not null default now()
);
create index if not exists sales_activities_prospect_idx on public.sales_activities (prospect_id, created_at desc);
create index if not exists sales_activities_actor_day_idx on public.sales_activities (actor_id, created_at desc);
alter table public.sales_activities enable row level security;

drop policy if exists sales_activities_read on public.sales_activities;
create policy sales_activities_read on public.sales_activities for select to authenticated
  using (public.is_sales_member());

drop policy if exists sales_activities_insert on public.sales_activities;
create policy sales_activities_insert on public.sales_activities for insert to authenticated
  with check (public.is_sales_member() and actor_id = auth.uid());

-- Append-only log: no update policy. Delete = your own entry, or an admin.
drop policy if exists sales_activities_delete on public.sales_activities;
create policy sales_activities_delete on public.sales_activities for delete to authenticated
  using (public.is_sales_member() and (actor_id = auth.uid() or public.is_platform_admin()));

-- ── Grants: authenticated only, anon gets nothing ──────────────────────────
revoke all on public.sales_team, public.sales_prospects, public.sales_activities from anon;
revoke all on public.sales_team from authenticated;
grant select on public.sales_team to authenticated;
grant select, insert, update, delete on public.sales_prospects to authenticated;
grant select, insert, delete on public.sales_activities to authenticated;

-- ── Roster management (platform admins only, audited) ─────────────────────
-- The user must already have an account (sign up at /signup first).
create or replace function public.sales_grant_access(p_email text, p_role text default 'rep', p_ref_code text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_role not in ('rep', 'manager') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_user is null then
    raise exception 'no_account' using errcode = 'P0002',
      hint = 'They need to create an account at /signup first.';
  end if;
  insert into public.sales_team (user_id, role, ref_code, added_by)
    values (v_user, p_role, nullif(lower(btrim(p_ref_code)), ''), auth.uid())
  on conflict (user_id) do update
    set role = excluded.role,
        ref_code = coalesce(excluded.ref_code, public.sales_team.ref_code);
  insert into public.admin_audit (actor_user_id, action, target_type, target_id, meta)
    values (auth.uid(), 'sales_grant_access', 'user', v_user::text, jsonb_build_object('role', p_role));
  return v_user;
end;
$$;
revoke all on function public.sales_grant_access(text, text, text) from public;
grant execute on function public.sales_grant_access(text, text, text) to authenticated;

create or replace function public.sales_revoke_access(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.sales_team where user_id = p_user;
  insert into public.admin_audit (actor_user_id, action, target_type, target_id, meta)
    values (auth.uid(), 'sales_revoke_access', 'user', p_user::text, '{}'::jsonb);
end;
$$;
revoke all on function public.sales_revoke_access(uuid) from public;
grant execute on function public.sales_revoke_access(uuid) to authenticated;

-- Roster with emails, for the admin's Team panel and for showing "owner" names
-- on prospect rows. Members see the roster (names only matter internally);
-- non-members get an empty set.
create or replace function public.sales_team_list()
returns table (user_id uuid, email text, display_name text, role text, ref_code text, created_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select t.user_id, u.email::text, p.display_name, t.role, t.ref_code, t.created_at
  from public.sales_team t
  join auth.users u on u.id = t.user_id
  left join public.profiles p on p.id = t.user_id
  where public.is_sales_member()
  order by t.created_at;
$$;
revoke all on function public.sales_team_list() from public;
grant execute on function public.sales_team_list() to authenticated;
