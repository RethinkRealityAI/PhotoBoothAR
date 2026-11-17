-- 031_event_archive.sql — host-facing event lifecycle: archive / restore.
--
-- archived_at NULL     = active event (today's behaviour, unchanged)
-- archived_at NOT NULL = archived: hidden from the host's default events grid,
--                        the guest booth shows an "event has ended" state and
--                        submit-post rejects new posts (code-side guards read
--                        this column); the wall stays viewable as a keepsake.
--
-- Zero RLS change on purpose: events_member_update (003) already lets org
-- members set columns on their own events, and events_public_read deliberately
-- keeps archived events readable so existing wall/gallery links keep working.

alter table public.events add column if not exists archived_at timestamptz;

comment on column public.events.archived_at is
  'Archived (ended) timestamp. NULL = active. Archived events are hidden from '
  'host grids, refuse new posts, and show an ended state in the booth; the '
  'wall stays viewable as a keepsake.';

create index if not exists events_org_active_idx
  on public.events (org_id) where archived_at is null;
