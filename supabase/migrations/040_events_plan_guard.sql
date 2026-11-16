-- 040: A host cannot grant their own event a paid plan, or move it between orgs.
--
-- THE HOLE (verified on the live database 2026-11-16, read-only):
--   * role `authenticated` (and `anon`) hold INSERT and UPDATE on EVERY column
--     of public.events, plan_tier and org_id included — Supabase's default
--     grants, never narrowed;
--   * RLS is events_member_update (USING + WITH CHECK is_org_member(org_id))
--     and events_member_insert (WITH CHECK is_org_member(org_id)) — they say
--     WHICH rows a member may write, not WHICH COLUMNS;
--   * the only trigger was event_org_cap_trg (BEFORE INSERT, 032).
-- So any signed-in host could run, from the browser console,
--     supabase.from('events').update({ plan_tier: 'deluxe' }).eq('id', theirEvent)
-- and the feature resolver (028), the watermark and every AI gate would treat
-- the event as paid. A member of two orgs could also re-home an event by
-- writing org_id (WITH CHECK only requires membership of the NEW org).
--
-- WHO LEGITIMATELY WRITES THESE COLUMNS — every one runs as the service role:
--   * create-event   (supabase/functions/create-event/index.ts:176) INSERT,
--                    plan_tier 'deluxe' only for platform admins;
--   * stripe-webhook (supabase/functions/stripe-webhook/index.ts:344) UPDATE
--                    plan_tier after a paid event_package;
--   * admin-api      set_event_tier (plan_tier) / set_event_status (status).
-- The browser writes events in exactly five places, none touching either
-- column: src/lib/host.ts updateEventConfig (config), updateEventStatus
-- (status, archived_at), updateEventDate (starts_at), updateEventName (name),
-- and src/pages/host/EventStudio.tsx:188 (config). The browser never INSERTs
-- an event (create-event does). So this guard changes no legitimate path.
--
-- WHO COUNTS AS "NOT A CLIENT". No earlier migration tells the service role
-- apart inside a trigger (032/033 gate with GRANTs, and 032 deliberately binds
-- every writer), so this states the rule once, explicitly:
--   * the caller's role is the PostgREST JWT `role` claim — the same two
--     settings auth.role() reads (live definition: request.jwt.claim.role,
--     then request.jwt.claims->>'role'). The JWT is signed; it cannot be forged
--     from the browser;
--   * with no JWT at all (a direct database session: migrations, the SQL
--     editor, cron) the session's SET ROLE is used instead, so an owner who
--     does `set local role authenticated` to test this IS treated as a client;
--   * only 'anon' and 'authenticated' are clients. service_role and direct
--     superuser sessions pass untouched.
-- SECURITY DEFINER does not change either setting (it switches the executing
-- user, not the request GUCs), so reading them here is reliable.
--
-- BEHAVIOUR for a client:
--   UPDATE that changes plan_tier → ERROR events_plan_tier_locked (42501)
--   UPDATE that changes org_id    → ERROR events_org_locked      (42501)
--   INSERT                        → plan_tier forced to 'free' (no error: the
--                                   only correct value for a self-made event)
-- 42501 (insufficient_privilege) is what PostgREST maps to HTTP 403.
-- RLS is not touched — this only removes power, it never adds any.
--
-- Idempotent. Additive. Existing rows are not modified.
--
-- ROLLBACK (restores the exact pre-040 state):
--   drop trigger if exists events_plan_guard_trg on public.events;
--   drop function if exists public.events_plan_guard();
--
-- VERIFY AFTER APPLYING (SQL editor; every probe ROLLS BACK, nothing persists):
--   -- 1. the trigger is installed beside 032's
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.events'::regclass and not tgisinternal order by tgname;
--   -- expect: event_org_cap_trg (BEFORE INSERT) and events_plan_guard_trg
--   --         (BEFORE INSERT OR UPDATE)
--
--   -- 2. a host raising their own plan is refused
--   begin;
--   select set_config('request.jwt.claims',
--            json_build_object('role', 'authenticated', 'sub', o.owner_id)::text, true),
--          set_config('probe.event_id', e.id::text, true)
--     from public.events e join public.orgs o on o.id = e.org_id
--    where o.owner_id is not null and e.plan_tier = 'free'
--    limit 1;
--   set local role authenticated;
--   update public.events set plan_tier = 'deluxe'
--    where id = current_setting('probe.event_id')::uuid;
--   -- expect: ERROR:  events_plan_tier_locked
--   rollback;
--
--   -- 3. the same host can still do what the app does (positive control —
--   --    proves probe 2 reached the row and was not merely RLS-filtered)
--   begin;
--   (same two set_config lines as probe 2)
--   set local role authenticated;
--   update public.events set name = name
--    where id = current_setting('probe.event_id')::uuid;
--   -- expect: UPDATE 1
--   rollback;
--
--   -- 4. the service role still can (stripe-webhook / admin-api path)
--   begin;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   update public.events set plan_tier = plan_tier
--    where id = (select id from public.events limit 1);
--   -- expect: UPDATE 1, no error
--   rollback;
--
--   -- 5. a host-made INSERT cannot start paid
--   begin;
--   (same two set_config lines as probe 2, plus:)
--   select set_config('probe.org_id', e.org_id::text, true)
--     from public.events e where e.id = current_setting('probe.event_id')::uuid;
--   set local role authenticated;
--   insert into public.events (org_id, slug, name, plan_tier)
--   values (current_setting('probe.org_id')::uuid, 'zz-plan-guard-probe', 'probe', 'deluxe')
--   returning plan_tier;
--   -- expect: free
--   rollback;

create or replace function public.events_plan_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('role', true), 'none')
  );

  if v_role is null or v_role not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.plan_tier := 'free';
    return new;
  end if;

  if new.plan_tier is distinct from old.plan_tier then
    raise exception 'events_plan_tier_locked'
      using errcode = '42501',
            hint = 'Plans change only through checkout or a platform admin.';
  end if;

  if new.org_id is distinct from old.org_id then
    raise exception 'events_org_locked'
      using errcode = '42501',
            hint = 'An event cannot be moved to another organization from the app.';
  end if;

  return new;
end $$;

revoke all on function public.events_plan_guard() from public, anon, authenticated;

drop trigger if exists events_plan_guard_trg on public.events;
create trigger events_plan_guard_trg
  before insert or update on public.events
  for each row execute function public.events_plan_guard();
