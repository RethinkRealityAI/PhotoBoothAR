-- 048_library_access.sql
--
-- Host-only library items. A platform admin can make a shared-library item
-- usable by CHOSEN customers (orgs) only — a piece built for one client stays
-- that client's — instead of every host on the platform.
--
--   experiences.library_access   'everyone' (default; every existing row) or
--                                'orgs' (only the orgs in library_item_access).
--   library_item_access          (experience_id, org_id) — who may use it.
--
-- An explicit mode column rather than "has rows = restricted": removing the
-- last chosen org must never silently open a client's piece to everyone.
-- 'orgs' with no rows means nobody (fails closed).
--
-- Enforcement is in the database, not the UI. Both checks are RESTRICTIVE
-- policies, so they AND with the existing permissive ones and no existing
-- policy is dropped or rewritten:
--   1. experiences SELECT — a restricted global row is visible only to:
--        members of a chosen org, platform admins, and anyone who can already
--        see an event that LINKED it (that event's guests in the booth, its
--        hosts). The link clause is what keeps a live event working, and it
--        also means an event that linked the piece before it was restricted
--        keeps it, exactly like retiring.
--   2. event_catalog_links INSERT — a host can link a restricted item only
--        into an event whose org is one of the chosen orgs. Without this, a
--        host who learned the uuid could link it and read it through clause 1.
-- Hidden ('retired') stays the existing visibility state; this is WHO, that is
-- WHETHER.
--
-- Not covered (by design): model/picture FILES live in the public `assets`
-- bucket, so a restricted piece's file is readable by anyone who has its URL.
-- The gate keeps it out of every other host's picker, search and events.
--
-- Writes: admin_set_library_access() is the only writer — one atomic call per
-- bulk change, service_role only (admin-api, after its platform-admin assert).
-- The table has RLS on with NO policies and no anon/authenticated privileges.
--
-- Idempotent. Additive.
--
-- ROLLBACK:
--   drop policy if exists experiences_library_access on public.experiences;
--   drop policy if exists catalog_links_library_access on public.event_catalog_links;
--   drop function if exists public.admin_set_library_access(uuid[], text, uuid[]);
--   drop function if exists public.library_item_linkable(uuid, text);
--   drop function if exists public.library_item_visible(uuid);
--   drop table if exists public.library_item_access;
--   alter table public.experiences drop column if exists library_access;

alter table public.experiences
  add column if not exists library_access text not null default 'everyone';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'experiences_library_access_check') then
    alter table public.experiences
      add constraint experiences_library_access_check check (library_access in ('everyone', 'orgs'));
  end if;
end $$;

create table if not exists public.library_item_access (
  experience_id uuid not null references public.experiences(id) on delete cascade,
  org_id        uuid not null references public.orgs(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (experience_id, org_id)
);
create index if not exists library_item_access_org_idx on public.library_item_access (org_id);

alter table public.library_item_access enable row level security;
revoke all on public.library_item_access from anon, authenticated;

/** Can the caller see this global library row? (Policy helper.) */
create or replace function public.library_item_visible(p_experience uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select e.library_access = 'everyone'
      or public.is_platform_admin(auth.uid())
      or exists (
        select 1 from public.library_item_access a
        where a.experience_id = e.id and public.is_org_member(a.org_id)
      )
      or exists (
        select 1 from public.event_catalog_links l
        where l.experience_id = e.id
          and (public.event_is_public(l.event_id) or public.is_event_member(l.event_id))
      )
    from public.experiences e
    where e.id = p_experience
  ), false);
$$;

/** May this item be linked into this event? (Policy helper.) */
create or replace function public.library_item_linkable(p_experience uuid, p_event text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select not e.is_global
      or e.library_access = 'everyone'
      or exists (
        select 1 from public.library_item_access a
        join public.events ev on ev.org_id = a.org_id
        where a.experience_id = e.id and ev.slug = p_event
      )
    from public.experiences e
    where e.id = p_experience
  ), false);
$$;

/**
 * The one writer. Sets the mode on every id and REPLACES its org list, in one
 * transaction. Returns how many library rows changed. Unknown or non-global
 * ids are skipped (the caller compares the count); unknown orgs raise.
 */
create or replace function public.admin_set_library_access(p_ids uuid[], p_access text, p_orgs uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_orgs uuid[] := coalesce(p_orgs, '{}');
begin
  if p_access not in ('everyone', 'orgs') then
    raise exception 'invalid_access';
  end if;
  if p_access = 'orgs' and cardinality(v_orgs) = 0 then
    raise exception 'orgs_required';
  end if;
  if (select count(*) from public.orgs where id = any (v_orgs)) <> cardinality(array(select distinct unnest(v_orgs))) then
    raise exception 'unknown_org';
  end if;

  select array_agg(id) into v_ids
  from public.experiences
  where id = any (coalesce(p_ids, '{}')) and is_global;
  if v_ids is null then
    return 0;
  end if;

  delete from public.library_item_access where experience_id = any (v_ids);
  if p_access = 'orgs' then
    insert into public.library_item_access (experience_id, org_id)
    select i, o from unnest(v_ids) i cross join (select distinct unnest(v_orgs) o) x;
  end if;
  update public.experiences set library_access = p_access where id = any (v_ids);
  return cardinality(v_ids);
end;
$$;

revoke all on function public.admin_set_library_access(uuid[], text, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_set_library_access(uuid[], text, uuid[]) to service_role;
-- The policy helpers run as the querying role, so anon/authenticated need
-- EXECUTE; both only answer yes/no about one row.
revoke all on function public.library_item_visible(uuid) from public;
grant execute on function public.library_item_visible(uuid) to anon, authenticated, service_role;
revoke all on function public.library_item_linkable(uuid, text) from public;
grant execute on function public.library_item_linkable(uuid, text) to anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'experiences'
                 and policyname = 'experiences_library_access') then
    create policy experiences_library_access on public.experiences
      as restrictive for select
      using (not is_global or library_access = 'everyone' or public.library_item_visible(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'event_catalog_links'
                 and policyname = 'catalog_links_library_access') then
    create policy catalog_links_library_access on public.event_catalog_links
      as restrictive for insert to authenticated
      with check (public.library_item_linkable(experience_id, event_id));
  end if;
end $$;
