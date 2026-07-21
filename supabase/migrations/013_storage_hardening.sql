-- 013: storage hardening. Closes the deliberately-permissive anon policies on
-- the public 'posts' and 'assets' buckets that 003 grandfathered (003:6-9).
--
-- Live policies before this migration (pg_policies, schemaname='storage'):
--   posts_objects_all   ALL  {public}  bucket_id='posts'   -- dropped here
--   assets_objects_all  ALL  {public}  bucket_id='assets'  -- dropped here
--   cards_bucket_member_read (kept, untouched)
--
-- What legacy anon clients actually do (src/lib/db.ts submitPostDirect /
-- uploadAsset — the pinned legacy builds' shapes, per 003's storage note):
--   posts:  upload flat ROOT names `${uid()}.${ext}` where uid() is
--           crypto.randomUUID() or `${Date.now()}_${rand36}` and ext is one of
--           jpg|png|webp (image) / webm|mp4 (video), with upsert:true. Names
--           are freshly random per call, so the upsert never conflicts —
--           an INSERT policy alone satisfies it (ON CONFLICT UPDATE policies
--           are only evaluated on an actual conflict).
--   assets: upload flat ROOT names `${uid()}-${sanitized}.${ext}` (sanitized
--           keeps [A-Za-z0-9.\-_]; ext png|webp|jpg|svg|glb|webm|mp4),
--           upsert:true (same non-conflicting-name argument), plus LIST the
--           bucket root (listAssets).
--   Reads are via public-bucket URLs (no RLS involved).
--
-- New-tenant guest uploads go through submit-post signed upload URLs (token
-- authorized, no anon policy needed); host/studio asset uploads run as
-- `authenticated`; edge functions run as service role (RLS bypass).
--
-- Deliberately NOT granted to anon anymore (was allowed by the old ALL policy):
--   * UPDATE/DELETE anywhere — an anon overwrite/delete of a known object name
--     could deface or destroy any tenant's content. Legacy guest flows never
--     update or delete; the only loss is the frozen legacy admin's
--     "delete asset" button (accepted — events are over).
--   * Nested paths, other extensions, other buckets.

-- Drop the permissive grandfather policies ------------------------------------
drop policy if exists posts_objects_all on storage.objects;
drop policy if exists assets_objects_all on storage.objects;

-- posts: anon INSERT limited to the exact legacy flat-root name shape ---------
drop policy if exists posts_legacy_anon_insert on storage.objects;
create policy posts_legacy_anon_insert on storage.objects for insert to anon
  with check (
    bucket_id = 'posts'
    and name ~ '^[A-Za-z0-9_-]{1,64}\.(jpg|png|webp|webm|mp4)$'
  );

-- assets: anon INSERT limited to the exact legacy flat-root name shape --------
drop policy if exists assets_legacy_anon_insert on storage.objects;
create policy assets_legacy_anon_insert on storage.objects for insert to anon
  with check (
    bucket_id = 'assets'
    and name ~ '^[A-Za-z0-9_-]{1,64}-[A-Za-z0-9._-]{1,120}\.(png|webp|jpg|svg|glb|webm|mp4)$'
  );

-- assets: platform hosts (authenticated) keep full management of the flat
-- assets library (Assets tab / studio uploads / delete). The bucket has no
-- tenant prefix today, so this is bucket-scoped like the client code expects.
drop policy if exists assets_authenticated_insert on storage.objects;
create policy assets_authenticated_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'assets');
drop policy if exists assets_authenticated_update on storage.objects;
create policy assets_authenticated_update on storage.objects for update to authenticated
  using (bucket_id = 'assets') with check (bucket_id = 'assets');
drop policy if exists assets_authenticated_delete on storage.objects;
create policy assets_authenticated_delete on storage.objects for delete to authenticated
  using (bucket_id = 'assets');

-- SELECT (listing): both buckets are public, so object CONTENT is already
-- world-readable via public URLs — a select policy only adds the ability to
-- list names, which listAssets (legacy admin + platform Assets library) needs.
drop policy if exists posts_objects_read on storage.objects;
create policy posts_objects_read on storage.objects for select
  using (bucket_id = 'posts');
drop policy if exists assets_objects_read on storage.objects;
create policy assets_objects_read on storage.objects for select
  using (bucket_id = 'assets');
