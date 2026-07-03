-- 003: RLS hardening. Replaces the permissive USING(true) policies with real
-- tenant isolation, PLUS grandfather policies that preserve today's behavior
-- for exactly the three legacy slugs (their pinned builds write directly with
-- the anon key). Each grandfather policy is dropped when its event is archived.
--
-- Storage note: the existing permissive policies on the public 'posts' and
-- 'assets' buckets are deliberately KEPT — legacy builds upload flat paths with
-- the anon key. New-tenant uploads go through edge functions (service role).
-- Storage hardening is scheduled for when the legacy events are archived.

-- Helper functions -----------------------------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.event_org(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.events where slug = p_slug;
$$;

create or replace function public.event_org_by_id(p_event uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.events where id = p_event;
$$;

create or replace function public.event_is_public(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.slug = p_slug and e.status in ('live', 'ended')
  );
$$;

create or replace function public.is_event_member(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_org_member(public.event_org(p_slug));
$$;

-- Atomic credit spend: single conditional UPDATE = race-safe without locks.
-- Service-role only (edge functions); not callable from clients.
create or replace function public.spend_credits(p_org uuid, p_amount int, p_reason text, p_ref jsonb default null)
returns int language plpgsql security definer set search_path = public as $$
declare new_balance int;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  update public.credit_balances
    set balance = balance - p_amount
    where org_id = p_org and balance >= p_amount
    returning balance into new_balance;
  if not found then
    raise exception 'insufficient_credits';
  end if;
  insert into public.credit_ledger (org_id, delta, reason, ref)
    values (p_org, -p_amount, p_reason, p_ref);
  return new_balance;
end $$;
revoke all on function public.spend_credits(uuid, int, text, jsonb) from public, anon, authenticated;

-- Org bootstrap: creating an org auto-enrolls the creator as owner.
create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null then
    insert into public.org_members (org_id, user_id, role)
      values (new.id, new.owner_id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists on_org_created on public.orgs;
create trigger on_org_created after insert on public.orgs
  for each row execute function public.handle_new_org();

-- Drop the permissive legacy policies ---------------------------------------
drop policy if exists experiences_all on public.experiences;
drop policy if exists posts_all on public.posts;
drop policy if exists challenges_all on public.challenges;
drop policy if exists app_settings_all on public.app_settings;

-- GRANDFATHER: exact current behavior, scoped to the three legacy slugs ------
-- (drop each when its event is archived)
create policy legacy_experiences_all on public.experiences for all
  using (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'))
  with check (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'));
create policy legacy_posts_all on public.posts for all
  using (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'))
  with check (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'));
create policy legacy_challenges_all on public.challenges for all
  using (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'))
  with check (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'));
create policy legacy_app_settings_all on public.app_settings for all
  using (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'))
  with check (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'));

-- Tenancy tables --------------------------------------------------------------
create policy profiles_own_read on public.profiles for select
  using (id = auth.uid());
create policy profiles_own_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy orgs_member_read on public.orgs for select
  using (public.is_org_member(id));
create policy orgs_owner_insert on public.orgs for insert to authenticated
  with check (owner_id = auth.uid());
create policy orgs_member_update on public.orgs for update to authenticated
  using (public.is_org_member(id)) with check (public.is_org_member(id));

create policy org_members_member_read on public.org_members for select
  using (public.is_org_member(org_id));
-- membership changes are service-role / trigger managed; owners manage via edge fn

create policy events_public_read on public.events for select
  using (status <> 'draft' or public.is_org_member(org_id));
create policy events_member_insert on public.events for insert to authenticated
  with check (public.is_org_member(org_id));
create policy events_member_update on public.events for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy events_member_delete on public.events for delete to authenticated
  using (public.is_org_member(org_id));

-- Content tables (new tenants; grandfather policies above cover legacy slugs) --
create policy experiences_public_read on public.experiences for select
  using (
    (is_global and is_published)
    or (event_id is not null and is_published and public.event_is_public(event_id))
    or (event_id is not null and public.is_event_member(event_id))
  );
create policy experiences_member_insert on public.experiences for insert to authenticated
  with check (event_id is not null and not is_global and public.is_event_member(event_id));
create policy experiences_member_update on public.experiences for update to authenticated
  using (event_id is not null and not is_global and public.is_event_member(event_id))
  with check (event_id is not null and not is_global and public.is_event_member(event_id));
create policy experiences_member_delete on public.experiences for delete to authenticated
  using (event_id is not null and not is_global and public.is_event_member(event_id));

create policy posts_public_read on public.posts for select
  using (
    (approved and not hidden and public.event_is_public(event_id))
    or public.is_event_member(event_id)
  );
-- NO anon insert/update for new tenants: writes go through the submit-post
-- edge function (service role). Members moderate:
create policy posts_member_update on public.posts for update to authenticated
  using (public.is_event_member(event_id)) with check (public.is_event_member(event_id));
create policy posts_member_delete on public.posts for delete to authenticated
  using (public.is_event_member(event_id));

create policy challenges_public_read on public.challenges for select
  using (public.event_is_public(event_id) or public.is_event_member(event_id));
create policy challenges_member_write on public.challenges for insert to authenticated
  with check (public.is_event_member(event_id));
create policy challenges_member_update on public.challenges for update to authenticated
  using (public.is_event_member(event_id)) with check (public.is_event_member(event_id));
create policy challenges_member_delete on public.challenges for delete to authenticated
  using (public.is_event_member(event_id));

create policy app_settings_public_read on public.app_settings for select
  using (public.event_is_public(event_id) or public.is_event_member(event_id));
create policy app_settings_member_write on public.app_settings for insert to authenticated
  with check (public.is_event_member(event_id));
create policy app_settings_member_update on public.app_settings for update to authenticated
  using (public.is_event_member(event_id)) with check (public.is_event_member(event_id));
create policy app_settings_member_delete on public.app_settings for delete to authenticated
  using (public.is_event_member(event_id));

create policy catalog_links_public_read on public.event_catalog_links for select
  using (public.event_is_public(event_id) or public.is_event_member(event_id));
create policy catalog_links_member_write on public.event_catalog_links for insert to authenticated
  with check (public.is_event_member(event_id));
create policy catalog_links_member_delete on public.event_catalog_links for delete to authenticated
  using (public.is_event_member(event_id));

-- Billing / jobs: member read, service-role-only writes ------------------------
create policy event_plans_member_read on public.event_plans for select to authenticated
  using (public.is_org_member(public.event_org_by_id(event_id)));
create policy subscriptions_member_read on public.subscriptions for select to authenticated
  using (public.is_org_member(org_id));
create policy credit_balances_member_read on public.credit_balances for select to authenticated
  using (public.is_org_member(org_id));
create policy credit_ledger_member_read on public.credit_ledger for select to authenticated
  using (public.is_org_member(org_id));
create policy ai_jobs_member_read on public.ai_jobs for select to authenticated
  using (public.is_org_member(org_id));
create policy access_tokens_member_all on public.event_access_tokens for all to authenticated
  using (public.is_org_member(public.event_org_by_id(event_id)))
  with check (public.is_org_member(public.event_org_by_id(event_id)));
-- guest_quota, stripe_webhook_events: no client policies (service role only).
