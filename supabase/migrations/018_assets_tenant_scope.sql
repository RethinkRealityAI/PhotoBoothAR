-- 018: Scope the assets bucket to the owning event. Multi-tenancy fix.
--
-- 013 deliberately left assets_* as BUCKET-WIDE policies, and said why:
-- uploads landed at the bucket ROOT as flat `${uid()}-${name}.${ext}` names, so
-- there was no tenant in the path to scope against. That is no longer true —
-- src/lib/db.ts uploadAsset now writes `<eventSlug>/uploads/...`, matching the
-- `<eventSlug>/ai/...` shape the edge functions already used.
--
-- What the bucket-wide policies actually allowed, all cross-tenant:
--   SELECT  — listAssets() listed the bucket ROOT, so the studio Assets panel
--             and the legacy admin Assets tab showed EVERY host every other
--             host's uploaded files.
--   DELETE  — any authenticated user could remove any object in the bucket,
--             with a delete button rendered next to those cross-tenant files.
--   UPDATE  — any authenticated user could overwrite another event's AI frame
--             or 3D model while that event was live.
--
-- Object CONTENT is unaffected: `assets` is a PUBLIC bucket, so
-- /storage/v1/object/public/... serves without consulting RLS. The proof is in
-- this same database — the `posts` bucket is public and has had NO select
-- policy since migration 017, and the live wall renders its images. So no live
-- booth, frame, wall or keepsake card loses an asset here.
--
-- Files uploaded BEFORE namespacing sit flat at the root, where
-- (storage.foldername(name))[1] is NULL. They keep serving from their public
-- URLs; they simply stop appearing in any host's library. Platform admins keep
-- full read/write over the whole bucket so nothing is stranded or unrecoverable.
--
-- Idempotent. Tightens tenant isolation only — no policy here grants access
-- that did not exist before.

-- Helper: the event slug a given object path belongs to, or NULL for a
-- pre-namespacing flat file. Kept inline (not a function) so the policies stay
-- readable next to the shape they encode: `<slug>/<kind>/<file>`.

-- SELECT — members of the owning event, or a platform admin.
drop policy if exists assets_objects_read on storage.objects;
create policy assets_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'assets'
    and (
      public.is_event_member((storage.foldername(name))[1])
      or public.is_platform_admin(auth.uid())
    )
  );

-- INSERT — write only into your own event's folder.
drop policy if exists assets_authenticated_insert on storage.objects;
create policy assets_authenticated_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and (
      public.is_event_member((storage.foldername(name))[1])
      or public.is_platform_admin(auth.uid())
    )
  );

-- UPDATE — overwrite only your own event's objects (both sides checked, so an
-- update cannot move an object out of the folder that authorised it).
drop policy if exists assets_authenticated_update on storage.objects;
create policy assets_authenticated_update on storage.objects for update to authenticated
  using (
    bucket_id = 'assets'
    and (
      public.is_event_member((storage.foldername(name))[1])
      or public.is_platform_admin(auth.uid())
    )
  )
  with check (
    bucket_id = 'assets'
    and (
      public.is_event_member((storage.foldername(name))[1])
      or public.is_platform_admin(auth.uid())
    )
  );

-- DELETE — remove only your own event's objects.
drop policy if exists assets_authenticated_delete on storage.objects;
create policy assets_authenticated_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'assets'
    and (
      public.is_event_member((storage.foldername(name))[1])
      or public.is_platform_admin(auth.uid())
    )
  );

-- assets_legacy_anon_insert (013) is deliberately UNTOUCHED: it is the narrow
-- flat-name allowance the three frozen legacy-event sites still write through,
-- and removing it would break them. It grants INSERT only, under a strict name
-- regex, and those objects are now visible to platform admins alone.
