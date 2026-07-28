-- 025_support_unread.sql
-- Make "unread" a column the database can filter and count on.
--
-- Unread is a comparison between TWO columns (last_message_at vs the read
-- pointer for that side). PostgREST cannot express a column-to-column
-- comparison in a filter, so the first cut of support-api fetched rows and
-- filtered them in TypeScript. That is wrong in two ways that both matter:
--
--   1. Filtering after paging makes `hasMore` lie — you get "page 1 of unread"
--      computed from "page 1 of everything", so an inbox with 60 read tickets
--      ahead of an unread one reports zero unread and no more pages.
--   2. The badge counts had to select every ticket row to count them, which is
--      fine at ten customers and not fine later.
--
-- STORED rather than a view: it is indexable, and the badge query becomes a
-- count over an index instead of a scan. Both expressions are immutable
-- (timestamptz comparison does not depend on the session TimeZone), which is
-- what a generated column requires.
--
-- Additive and idempotent — no existing row is rewritten by the DDL beyond the
-- backfill Postgres does when adding a stored generated column.

alter table public.support_tickets
  add column if not exists admin_unread boolean
    generated always as (
      admin_last_read_at is null or last_message_at > admin_last_read_at
    ) stored;

alter table public.support_tickets
  add column if not exists customer_unread boolean
    generated always as (
      customer_last_read_at is null or last_message_at > customer_last_read_at
    ) stored;

-- Partial indexes: the inbox only ever asks for the TRUE side, and an unread
-- ticket is the minority of the table once the desk is being worked.
create index if not exists support_tickets_admin_unread_idx
  on public.support_tickets (last_message_at desc)
  where admin_unread;

create index if not exists support_tickets_customer_unread_idx
  on public.support_tickets (org_id, last_message_at desc)
  where customer_unread;
