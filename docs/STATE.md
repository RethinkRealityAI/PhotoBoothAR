## Goal
Overnight autonomous pass (owner asleep, full permission): polish the host journey (login → first event → share), refine guest UX, health-check the admin portal, and build a landing-page CMS so the owner swaps images/videos/copy from /admin — branch `claude/customer-journey-platform-polish-ejozbj`, draft PR #36. (Prior session's STATE preserved at this file's history, commit 2101e0e and earlier.)

## Now
All three implementation waves complete (CMS · host journey · guest UX) + admin health fixes. Unified gate running (tsc · vitest · build · legacy build). Ship steps after green: commit+push → apply migration 030 live → deploy admin-api → refresh PR #36 body.

## Next
- Commit all wave work + this file; push; keep PR #36 draft, update its body with final gate numbers.
- Apply `supabase/migrations/030_landing_content.sql` live via Supabase MCP (file already committed as 2101e0e) — repo/DB lockstep.
- Deploy `admin-api` (adds get_landing_content_admin / save_landing_draft / publish_landing_content / revert_landing_draft; live is v14). Esbuild parse + in-file identifier check done by the implementing agent; re-verify before deploy.
- Local screenshot pass: vite preview + Playwright on `/` (landing must render on the fallback path when the RPC is unreachable — the never-breaks contract), 390×844 + 1440×900.
- OWNER: live DB carries migration `org_provider_keys` (2026-07-29) with NO repo counterpart — from a concurrent session; reconcile.
- OWNER (unchanged): Stripe LIVE keys (#1 gate) · SUPPORT_NOTIFY_EMAIL · /admin/catalog Provision in Stripe · custom SMTP · vault service_role_key for ai-jobs cron · HaveIBeenPwned toggle.

## Constraints
- Standing (from prior sessions, still binding): never break legacy-events; no new npm deps; tests `.ts` only, never import anything reaching src/lib/supabase.ts; never loosen tenant RLS; liquid-glass idiom on platform surfaces; prefers-reduced-motion; Gemini key never committed; no VITE_EVENT in .env.local during tests; do-not-touch: StageCanvas.drawFrame semantics, booth capture/submitPost, experiences schema; FrameStudio.tsx + DemoBooth.tsx not deleted without owner approval; generic-only template library (no legacy-event branding).
- User (2026-07-30, verbatim gist): "polish and refine anything you think we need to in regards to the customer journey from login to deploying their first experience"; "refine the guest experience ... easy, smooth and amazing"; "admin portal ... especially want to be able to control the landing page via a cms so I can swap out images and videos as needed"; "utilize all necessary subagents"; "feel free to add any wow and amazing features"; "if there's anything for me to do, just note it but you should finish all you can without me".

- User (2026-07-30, landing round 7, verbatim gist): remove the red-marked highlights strips "in all the sections as it shows in the videos already"; "Just a nice one sentence hook then video" — text must not be "repetitive of the videos"; "the video should play automatically as they scroll to that area and it should show the playback controls... there should be play and pause, thats it. even then make it subtle and bottom right of the video"; "check all the videos again ensure they make sense have the best visuals and not redundant and are engaging and hook the user"; header frames get "photorealistic images of various types... by default we should use the ai ones, making sure they match the type for event the frames are for"; "make sure these images are also optimized webp so they load fast. same with any videos"; switchable via the CMS; free rein on other landing improvements — "slick, beautiful and not overly info dense".

## Decisions
- DECISION: landing CMS = singleton `landing_content` (draft/published jsonb) + SECURITY DEFINER `get_landing_content()` (anon reads PUBLISHED only; revoke-then-grant per the 022 lesson); writes via admin-api (audited) — platform_config was int-only/no-client-policies and an RLS admin-write table has no precedent.
- DECISION: landing media rides the existing public `assets` bucket under `_platform/landing/` — migration 018 already grants platform admins bucket-wide write and `_platform` can never be an event slug; zero new storage policy.
- DECISION: `DEFAULT_LANDING_CONTENT` media fields are undefined = "use bundled import" (Landing.tsx resolves), keeping landingContent.ts pure/test-importable and first paint instant; a total Supabase outage is invisible on the marketing page.
- DECISION: guest QR retarget to /welcome is gated on `RuntimeEvent.source === 'db'` — legacy walls keep byte-identical targets (legacy DOES have /welcome, but the sites are frozen).
- DECISION: Dashboard go-live no longer reloads the page; optional `onStatusChange` prop keeps EventStudio's pill in sync; legacy mounts pass nothing.

## Facts
- Commands: `npm run lint` (tsc) · `npm test` (vitest node, src/**/*.test.ts only) · `npm run build` · legacy `VITE_EVENT=hope-gala npm run build`. Install with `npm install --ignore-scripts`.
- Baseline at session start: tsc 0 · 1966 tests (99 files). After waves: 1990 tests (101 files) per both implementing agents' runs.
- New modules: src/lib/landingContent.ts (pure, +16 tests) · landingContentClient.ts · landingMedia.ts · src/lib/camera.ts classifyCameraError/CameraUnavailableError (+8 tests in camera.test.ts) · src/pages/admin/Landing.tsx (/admin/landing, NAV 'Landing').
- admin-api new actions: get_landing_content_admin / save_landing_draft (≤200k JSON guard) / publish_landing_content / revert_landing_draft — all audited; pre-switch guards untouched.
- store.ts: new `experiencesFailed` flag; PickerDrawer has loading / failed-retry / empty states.
- Playwright: executablePath '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'. Sandbox egress: *.supabase.co and Netlify previews 403 — Supabase only via MCP.
- PR #36 (draft) targets main; Netlify deploy previews build per push.

## Done
- 2026-07-30 THREE AUDITS (host journey 26 findings · guest UX 28 findings · admin+CMS design) — RESULT: ranked implementation briefs, all file:line-cited.
- 2026-07-30 ADMIN HEALTH (commit 60c9f52): Payments renders LoadError instead of confident-empty on failed orders fetch; Credits failure states got Retry.
- 2026-07-30 CMS WAVE — RESULT: migration 030 (committed 2101e0e, NOT yet applied) · admin-api +4 audited actions (NOT yet deployed) · pure normalize layer (hostile-input tests: javascript:/data:/foreign-origin URLs rejected, fixed-slot arrays never resize) · /admin/landing editor (ConfirmModal publish, media slots Replace/Reset, LoadError/useToast, OG-static notice) · Landing.tsx reads content.* with bundled fallbacks; agent-verified tsc 0 · 1990/101 · both builds ✓.
- 2026-07-30 HOST WAVE — RESULT: 12/12 items (ToastProvider on /host + success toasts · Go live + Print signage on create-success · signup resend · live linked getting-started checklist w/ progress ring · Dashboard QR → /welcome + share link, platform-gated · go-live without reload · checkout-return toasts on EventsList/EventStudio · honest wizard steps + disabled-CTA copy · signup password reveal + promo echo · rail New-event CTA + per-path titles + sign-out confirm · platformGuide no longer advertises unmounted FrameStudio · template-seed failure notice); gated in isolated worktree tsc 0 · 1966/99 · both builds ✓.
- 2026-07-30 GUEST WAVE — RESULT: 15/15 items (12-CTA --on-accent contrast fix · camera-hang 8s exit w/ ways-out · webview/NotReadable error taxonomy · 3D-load failure surfaced + shimmer disarm · tracker-ready gating of the face hint · SPA links at post-send hop · "Yours" chips on wall tiles/lightbox, device-local only · welcome promoted to front door w/ live moment count + QR retarget gated to db events · experiencesFailed + PickerDrawer honest states · onboarding gestures step + optional challenges step · reduced-motion gates on SendOff/ChallengeCheck · micro-type 7.5-8px → 10px · booth entry-gate ways-out · viewfinder aria); agent-verified tsc 0 · 1990/101 · both builds ✓.

## Open items
- Deploy-time: apply 030 + deploy admin-api (see Next). /admin/landing errors honestly until deployed.
- NOTED from waves: MarqueeGrid tiles lack the "Yours" chip · FeaturedSpotlight builds its own QR target (not retargeted) · WallLightbox Download / ChallengeSelector:156 Trophy / PickerDrawer sparkle still text-noir-900 · PickerDrawer section headers still 8px · /admin/support inbox hardcodes limit 100, no paging · list_promos/list_admins/list_feature_flags/list_catalog unbounded · event delete/rename-slug/archive missing (schema+edge work) · wall-cap meter can vanish on count failure · FrameStudio.tsx orphaned (wire or delete — owner call) · guest keepsakes are localStorage-only (email/SMS capture = schema work) · guest self-delete of posts (design in prior STATE history, needs migration+edge fn).
- OG image/<title> are static in index.html — the CMS states this in its UI; changing them = code deploy.

## Failed attempts
- (none this session; env: plain `npm install` dies on onnxruntime postinstall — use --ignore-scripts, reconfirmed.)
