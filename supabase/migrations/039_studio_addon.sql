-- 039_studio_addon.sql
-- The creative Studio (the event's Studio + Assets tabs, the 2D/3D creators and
-- the Scene Director) becomes an ADD-ON for teams and large organisations.
-- Every host keeps Frames & filters (ready-made library + the quick AI frame).
--
-- DARK LAUNCH. The client ships first and treats a MISSING `studio` key in the
-- resolver's answer as TRUE (src/lib/features.ts normalizeResolvedFeatures), so
-- merging the client changes nothing. This migration is what turns the gate on,
-- and it grandfathers every org that exists when it runs — so on the day it is
-- applied nothing changes for any current customer either. Only orgs created
-- AFTER it runs resolve studio = false (plan default) until an admin comps them
-- in /admin/features (org override) or they buy the add-on.
--
-- NO FUNCTION CHANGE, NO RLS CHANGE, NO GRANT CHANGE. resolve_features_raw
-- (028) loops over feature_flags rows, so a new row is picked up by every layer
-- (plan default → Pro floor → org override → event override → kill switch) and
-- by event_features / org_features / explain_features automatically.
--
-- LEGACY NOTE: 028's layer 0 copies the DELUXE defaults for the three frozen
-- coded events (hope-gala, jenna-jake, detola-wuyi), so after this migration
-- the DB answers studio = false for them. The client never gates them
-- (studioAllowed() checks LEGACY_EVENT_IDS, and LEGACY_ENTITLEMENTS.studio is
-- true), and the legacy sites do not read the resolver for the studio at all —
-- so this is deliberately left alone rather than special-cased in SQL.
--
-- KILL SWITCH: killable = true. Killing it hides the Studio for EVERYONE,
-- grandfathered orgs included (layer -1 beats overrides). Platform admins still
-- get in (the client lets is_platform_admin through regardless).
--
-- Idempotent: every insert is ON CONFLICT DO NOTHING, so a re-run neither
-- duplicates nor overwrites an admin's later edits (a default flipped in
-- /admin/features, or an org override revoked by hand, survives a re-run).
-- A re-run DOES grandfather orgs created since the first run — run it once.

insert into public.feature_flags (key, label, description, category, value_type, paid, killable, sort) values
  ('studio', 'Studio (add-on)',
   'The creative Studio and its Assets tab — design your own frames, filters and 3D props. An add-on for teams and large organisations.',
   'studio', 'boolean', true, true, 90)
on conflict (key) do nothing;

insert into public.plan_feature_defaults (tier, flag_key, value) values
  ('free',       'studio', 'false'::jsonb),
  ('essentials', 'studio', 'false'::jsonb),
  ('premium',    'studio', 'false'::jsonb),
  ('deluxe',     'studio', 'false'::jsonb)
on conflict (tier, flag_key) do nothing;

-- Grandfather every org that exists right now. set_by stays null (a migration,
-- not a person); the reason is what /admin/features shows as provenance.
insert into public.org_feature_overrides (org_id, flag_key, value, reason)
select o.id, 'studio', 'true'::jsonb, 'grandfathered: Studio became an add-on (039)'
  from public.orgs o
on conflict (org_id, flag_key) do nothing;
