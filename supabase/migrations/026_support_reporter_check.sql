-- 026_support_reporter_check.sql
-- Let a guest report a problem without handing over their email address.
--
-- 023 required `created_by is not null or reporter_email is not null`, on the
-- reasoning that every ticket must be answerable by someone. That reasoning was
-- right and the constraint was still wrong: it assumed the only way to answer a
-- ticket is to email the person who filed it.
--
-- A guest at a live event is anonymous by construction — no account, and asking
-- for an email before they can tell us the camera is broken is exactly the
-- friction that means they close the tab instead. Their ticket is still fully
-- answerable, just not by replying to them: it carries org_id (stamped from the
-- event), so it lands in that host's /host/support where the host can fix the
-- event; and it carries session_id, which joins to the client_errors rows the
-- same browser reported, which is what actually gets the bug fixed.
--
-- What stays refused is a genuinely orphaned row: no user, no email, and no org
-- to route it to. That one nobody could ever act on.
--
-- Idempotent. NOT VALID for the same reason 021's bounds are: the rule binds
-- every new row without the migration having to validate history.

alter table public.support_tickets
  drop constraint if exists support_tickets_reporter_present;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.support_tickets'::regclass
      and conname = 'support_tickets_routable'
  ) then
    alter table public.support_tickets add constraint support_tickets_routable check (
      created_by is not null
      or reporter_email is not null
      or org_id is not null
    ) not valid;
  end if;
end $$;
