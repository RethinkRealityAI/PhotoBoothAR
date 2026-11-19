-- 043: Video clip length becomes the plan lever; Free records video.
--
-- Owner decision 2026-11-19 ("Unlimited + fair use"): paid plans stay
-- unlimited on post COUNT, and differ on the things that actually cost money:
-- clip length and how long media is kept. Measured on the live bucket that day,
-- videos were ~20% of posts but ~85% of stored bytes.
--
--   videoMaxSec    free 30 · essentials 30 · premium 60 · deluxe 90   (NEW)
--   videoEnabled   free false → true
--   retentionDays  deluxe 365 → 730
--
-- Mirrors src/lib/plans.ts ENTITLEMENTS (the browser's optimistic copy; this
-- table is the authority read by resolve_features_raw, 028).
--
-- NO FUNCTION, RLS OR GRANT CHANGE. resolve_features_raw loops over
-- feature_flags rows, so the new row is picked up by every layer (plan default
-- → Pro floor → org override → event override → kill switch) automatically.
-- 'nullable_number' merges with greatest(), which is the right "better value"
-- for a clip length (the browser treats a null as "fall back", never unlimited).
--
-- FILE SIZE: every clip still fits the posts bucket's existing 25 MB per-file
-- limit — the booth lowers the bitrate for longer clips (plans.ts
-- videoBitsPerSecondFor). No storage change.
--
-- LEGACY: layer 0 copies deluxe's defaults for the three frozen coded events,
-- so the DB will answer videoMaxSec 90 / retentionDays 730 for them. Neither
-- reaches them: the legacy sites read LEGACY_ENTITLEMENTS (30 s, 365 days) in
-- the browser, and the retention purge exempts them by slug.
--
-- Idempotent. The two UPDATEs only fire while the value is still the one 027
-- seeded, so a later edit made in /admin/features survives a re-run.
--
-- ROLLBACK:
--   delete from public.plan_feature_defaults where flag_key = 'videoMaxSec';
--   delete from public.org_feature_overrides   where flag_key = 'videoMaxSec';
--   delete from public.event_feature_overrides where flag_key = 'videoMaxSec';
--   delete from public.feature_flags where key = 'videoMaxSec';
--   update public.plan_feature_defaults set value = 'false'::jsonb where tier = 'free'   and flag_key = 'videoEnabled';
--   update public.plan_feature_defaults set value = '365'::jsonb   where tier = 'deluxe' and flag_key = 'retentionDays';
--
-- VERIFY:
--   select tier, flag_key, value from public.plan_feature_defaults
--    where flag_key in ('videoEnabled','videoMaxSec','retentionDays') order by 2, 1;
--   -- expect videoMaxSec 30/30/60/90, free videoEnabled true, deluxe retentionDays 730
--   select key, value_type from public.feature_flags where key = 'videoMaxSec';

insert into public.feature_flags (key, label, description, category, value_type, paid, killable, sort) values
  ('videoMaxSec', 'Video clip length',
   'Longest single video clip a guest may record, in seconds.',
   'capture', 'nullable_number', true, true, 25)
on conflict (key) do nothing;

insert into public.plan_feature_defaults (tier, flag_key, value) values
  ('free',       'videoMaxSec', '30'::jsonb),
  ('essentials', 'videoMaxSec', '30'::jsonb),
  ('premium',    'videoMaxSec', '60'::jsonb),
  ('deluxe',     'videoMaxSec', '90'::jsonb)
on conflict (tier, flag_key) do nothing;

update public.plan_feature_defaults
   set value = 'true'::jsonb
 where tier = 'free' and flag_key = 'videoEnabled' and value = 'false'::jsonb;

update public.plan_feature_defaults
   set value = '730'::jsonb
 where tier = 'deluxe' and flag_key = 'retentionDays' and value = '365'::jsonb;
