-- 005: Phase 1 adversarial-audit fixes.
--
-- Finding 1 (cross-tenant content injection): the grandfather policy on
-- experiences let ANON insert/update legacy-slug rows with is_global=true,
-- which would surface them in every tenant's catalog. Legacy builds never set
-- is_global, so tightening WITH CHECK preserves their behavior exactly.
drop policy if exists legacy_experiences_all on public.experiences;
create policy legacy_experiences_all on public.experiences for all
  using (event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi'))
  with check (
    event_id in ('hope-gala', 'jenna-jake', 'detola-wuyi')
    and not is_global
  );

-- Finding 2 (org-claim before email confirmation): handle_new_user claimed the
-- Legacy org at auth.users INSERT time — before the address is verified, so a
-- stranger signing up with the owner's email would consume the claim (and hold
-- an org_members row they could use if ever confirmed). Claim now happens only
-- once the email is CONFIRMED (covers OAuth signups, which arrive confirmed).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform public.claim_legacy_org(new.id, new.email);
  end if;
  return new;
end $$;

create or replace function public.claim_legacy_org(p_user uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(p_email, '')) = 'dapo@rethinkreality.ai' then
    update public.orgs set owner_id = p_user
      where name = 'Legacy Events' and owner_id is null;
    insert into public.org_members (org_id, user_id, role)
      select id, p_user, 'owner' from public.orgs
      where name = 'Legacy Events' and owner_id = p_user
    on conflict do nothing;
  end if;
end $$;
revoke all on function public.claim_legacy_org(uuid, text) from public, anon, authenticated;

create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform public.claim_legacy_org(new.id, new.email);
  end if;
  return new;
end $$;
revoke all on function public.handle_user_confirmed() from public, anon, authenticated;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row execute function public.handle_user_confirmed();

-- Clean any premature claim made under the old trigger by an UNCONFIRMED user
-- (defensive; none expected).
update public.orgs o set owner_id = null
where o.name = 'Legacy Events'
  and o.owner_id is not null
  and exists (
    select 1 from auth.users u
    where u.id = o.owner_id and u.email_confirmed_at is null
  );
delete from public.org_members m
using public.orgs o
where o.name = 'Legacy Events' and m.org_id = o.id
  and exists (
    select 1 from auth.users u
    where u.id = m.user_id and u.email_confirmed_at is null
  );
