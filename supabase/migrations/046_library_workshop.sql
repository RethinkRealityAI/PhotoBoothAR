-- 046_library_workshop.sql
--
-- Lets a platform admin EDIT a shared-library item in the full Studio and
-- publish the result as a new version.
--
-- Why a workshop event at all: the Studio is event-scoped end to end. It loads
-- and saves `experiences` rows by event SLUG under tenant RLS, and uploads to
-- `assets/<slug>/uploads`. A global library row (event_id null) can never be
-- loaded or written there, and loosening tenant RLS to allow it is off the
-- table. So admin-api gives each admin a private draft event in their own org
-- (events.config.libraryWorkshop.owner = their user id) and COPIES the library
-- item into it as an ordinary event scene. The admin edits that copy with every
-- Studio tool; publish_library_item then versions it.
--
-- This table remembers which library item a workshop scene was copied from and
-- which version CHAIN it belongs to, so publishing the copy makes version N+1
-- of the SAME piece (and retires vN when the new one is listed) instead of a
-- brand-new, unrelated library item. Rendered content stays immutable: vN is
-- never modified, and events that linked it keep it.
--
-- Columns:
--   experience_id    the workshop scene (an event-owned experiences row); the
--                    row goes away with the scene (or the workshop event).
--   library_item_id  the global row it was copied from. No FK on purpose: a
--                    library item may be deleted later, and the scene and its
--                    lineage must survive that.
--   lineage_id       the version chain (src/lib/libraryPublish.ts lineageOf).
--   created_by       the admin who opened it.
--
-- Security: RLS on with NO policies, and every table privilege revoked from
-- anon/authenticated (Supabase's default privileges grant them ALL, TRUNCATE
-- included). Only the service role, i.e. admin-api after its platform-admin
-- assert, reads or writes it. Tenant RLS is not touched.
--
-- Idempotent. Additive.
--
-- ROLLBACK: drop table if exists public.library_workshop_scenes;

create table if not exists public.library_workshop_scenes (
  experience_id   uuid primary key references public.experiences(id) on delete cascade,
  library_item_id uuid not null,
  lineage_id      uuid not null,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create index if not exists library_workshop_scenes_item_idx
  on public.library_workshop_scenes (library_item_id);
create index if not exists library_workshop_scenes_lineage_idx
  on public.library_workshop_scenes (lineage_id);

alter table public.library_workshop_scenes enable row level security;

revoke all on public.library_workshop_scenes from anon, authenticated;
