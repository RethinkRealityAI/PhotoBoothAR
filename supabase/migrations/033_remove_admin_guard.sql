-- 033: Make "you cannot remove the last platform admin" ATOMIC.
--
-- admin-api's remove_admin did this:
--
--     select count(*) from platform_admins        -- 2
--     if count <= 1 -> reject
--     delete from platform_admins where user_id = $1
--
-- Two admins removing each other at the same moment both read 2, both pass the
-- guard, and both deletes land. The roster is then EMPTY, and because
-- platform_admins has no client insert/update/delete policy (009), nobody can
-- put themselves back: /admin is locked out permanently and the only way back
-- in is a service-role SQL session. Low probability, unbounded blast radius.
--
-- WHY THE OBVIOUS ONE-STATEMENT FIX IS NOT ENOUGH. The tempting version is
--
--     delete from platform_admins
--      where user_id = p_user and (select count(*) from platform_admins) > 1
--
-- and on its own it still loses the race. Under READ COMMITTED each statement
-- evaluates that subquery against its own snapshot, and PostgreSQL only
-- re-evaluates a WHERE clause against fresh data when a concurrent writer has
-- locked THE SAME ROW (the EvalPlanQual recheck). The two admins are deleting
-- DIFFERENT rows, so nothing conflicts, no recheck happens, and both snapshots
-- still say "there are 2 of us". The count is only correct if the removals are
-- serialized, so this function takes a self-conflicting table lock first.
--
-- SHARE ROW EXCLUSIVE is the weakest mode that conflicts with itself and with
-- the ROW EXCLUSIVE that INSERT/UPDATE/DELETE take: concurrent removals (and a
-- concurrent add_admin) queue behind each other, while ordinary reads —
-- is_platform_admin() on every single admin-api request — are NOT blocked.
-- The table holds a handful of rows and is written a few times a year, so the
-- contention cost is nil.
--
-- The DELETE keeps the guard in its own WHERE clause as well. Under the lock
-- that is belt and braces, but it means the statement is still correct if it is
-- ever copied somewhere that holds the lock differently.
--
-- platform_admins has RLS on and NO write policy at all (009), so this delete
-- only lands because a SECURITY DEFINER function runs as its owner. That is the
-- same footing `claim_platform_admin` in 009 already inserts on.
--
-- Gate: revoked from public/anon/authenticated and granted only to service_role
-- — a SECURITY DEFINER function is exposed at /rest/v1/rpc/<name> to whichever
-- API roles hold EXECUTE unless you take it away, which is the whole reason
-- migration 022 had to exist. The sole caller is admin-api's remove_admin,
-- which asserts is_platform_admin before its action switch and writes
-- admin_audit after the delete.
--
-- Idempotent.

create or replace function public.admin_remove_platform_admin(p_user uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_removed uuid;
  v_total   int;
begin
  -- Serializes this guard against every other writer of the roster. Released on
  -- commit; plain SELECTs (is_platform_admin) are unaffected by this mode.
  lock table public.platform_admins in share row exclusive mode;

  delete from public.platform_admins a
   where a.user_id = p_user
     and (select count(*) from public.platform_admins) > 1
  returning a.user_id into v_removed;

  if v_removed is not null then
    return v_removed;
  end if;

  -- Nothing was deleted. Say WHICH of the two reasons it was, so the edge
  -- function can keep answering 400 cannot_remove_last_admin vs 404 not_found
  -- exactly as it did before. Still under the lock, so this count agrees with
  -- the one the DELETE just used.
  select count(*) into v_total from public.platform_admins;
  if v_total <= 1 then
    raise exception 'cannot_remove_last_admin'
      using errcode = 'P0001',
            hint = 'At least one platform admin must remain.';
  end if;

  raise exception 'admin_not_found'
    using errcode = 'P0002',
          hint = 'That user is not on the platform-admin roster.';
end $$;

revoke all on function public.admin_remove_platform_admin(uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_platform_admin(uuid) to service_role;
