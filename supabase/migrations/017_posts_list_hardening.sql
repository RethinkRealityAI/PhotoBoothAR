-- 017: Drop anonymous LIST on the posts bucket (audit follow-up to 013).
--
-- 013 re-created posts_objects_read as SELECT USING (bucket_id='posts') with
-- no role -> defaults to public/anon. Object CONTENT was always reachable via
-- public URLs (the bucket is public), but this policy additionally let anyone
-- with the shipped anon key call the storage LIST API and enumerate
-- slug/session/uuid object names for EVERY event platform-wide — a privacy
-- leak with no legitimate consumer: the wall renders public URLs from the
-- posts table, finalize paths run service-role, and the only client-side
-- storage LIST in the app is listAssets on the ASSETS bucket (db.ts), whose
-- assets_objects_read policy is intentionally kept.
--
-- Idempotent; no tenant RLS loosened (this only REMOVES anon capability).

drop policy if exists posts_objects_read on storage.objects;
