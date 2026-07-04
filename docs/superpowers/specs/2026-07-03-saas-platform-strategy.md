# PhotoBoothAR → Event Platform SaaS — Productization Strategy & Architecture

**Date:** 2026-07-03
**Status:** Approved (strategy + architecture)
**Author:** Dapo + Claude

## Problem

PhotoBoothAR is a white-label AR photo booth + live photo wall that has run three real
events (Hope Gala, Jenna & Jake, Detola & Wuyi). Each event is a code folder deployed as
its own Netlify site, selected by a build-time env var (`VITE_EVENT`) — the model locked
in by the 2026-06-21 multi-event spec, whose explicit non-goals were runtime tenancy,
self-serve event creation, and real auth.

We now deliberately cross that boundary: turn the platform into a self-serve,
revenue-generating SaaS. Hosts sign up, create their own event page (tenant), customize
frames (uploaded or AI-generated), use a curated 3D asset library (or AI-generate props),
run the live AR booth + wall at their event, and optionally create animated greeting
cards from captured photos/video — including remote "video guestbook" collection.

**Hard requirement:** the three live event sites are untouchable — their URLs, printed
QR codes, and behavior must be preserved throughout (see §5.4a). The platform launches
as a new, separate Netlify site; the legacy events also appear as tenants on it.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Business model | Per-event packages (couples/hosts) + Pro monthly subscription (planners/venues/booth operators) |
| V1 scope | Full vision: tenant platform, AI frames, AI 3D, greeting cards |
| Backend | Supabase (Auth + Postgres/RLS + Storage + Edge Functions); Stripe billing |
| Image AI | Multi-provider: **Gemini default** (~$0.04/img, generous free tier, already integrated), **Higgsfield premium styles** — one metered edge function, vendors swappable |
| 3D AI | **Meshy** (image/text → GLB); Higgsfield's API also proxies Meshy as a fallback vendor path |
| Greeting cards | Interactive animated web card standard; rendered MP4 montage premium (Remotion Lambda) |
| Market | Weddings first; generic events supported (galas, milestone birthdays, remote celebrations) |
| Platform home | New Netlify site (working name `photoboothar.netlify.app`; availability checked at creation) — `/` is marketing/signup, never an event |

## What exists today (verified)

**Strong foundation (reuse):**
- Booth capture pipeline (`src/components/booth/capture.ts`): camera → WebGL shaders →
  Three.js face-anchored 3D → 2D frame → watermark, 1080×1920; photo + 30s video w/ audio
  (`src/lib/recorder.ts`).
- AR: MediaPipe FaceLandmarker + 12 named face anchors (`src/lib/faceRig.ts`), procedural
  head pieces AND GLB upload with WYSIWYG anchor placement (`/admin/creator3d`, `FaceRig.tsx`).
- Live wall (`src/components/Wall.tsx`): mosaic/marquee/slideshow/leaderboard, projection
  mode, realtime beam-in, QR join.
- Admin studio (`/admin/*`): branding (7 runtime theme colors, logo, copy), 2D creator
  (with Gemini generate), 3D creator, asset library, moderation, challenges, wall settings.
- Single data-access chokepoint `src/lib/db.ts`; every table already carries `event_id`.
- PR #4 (guest Upload-to-Wall): passcode-gated `/upload` with bulk upload, frame
  selection, pan/zoom crop (`compositeUpload()`), name + message.

**The SaaS gap (build):**
- No auth (client-side passcode), permissive RLS, shared anon key — isolation is
  app-enforced only.
- Tenants are code folders + build-time `VITE_EVENT` — no self-serve creation, no
  runtime routing.
- No billing, no credit system, no server layer (Gemini key currently shipped to browser).
- No greeting cards; no AI 3D generation.

---

## 1. Product shape

One platform, three connected products:

1. **AR Photo Booth + Live Wall** (exists, becomes self-serve): guests scan QR → browser
   AR booth (no app download — browser-based platforms see 65–85% guest participation vs
   30–45% for app-download) → photos/videos beam onto the projected wall.
2. **AI Event Studio** (new): host uploads frame art OR generates it ("art-deco gold
   wedding frame with our names"); picks 3D props from a curated library OR generates
   ("a 3D crown of white roses") → auto face-anchored.
3. **Greeting Cards / Video Guestbook** (new): guest captures + remote contributions
   compiled into an animated interactive web card (standard) or rendered MP4 montage
   (premium), emailed to the celebrant. Works standalone for remote events — an
   acquisition wedge of its own.

### PR #4 (guest Upload-to-Wall) — build on it, don't duplicate

Assume PR #4 merges first:
- `/upload` re-homes to a per-event, tenant-scoped route; `VITE_UPLOAD_PASSCODE` becomes
  a per-event DB setting (host sets/rotates the PIN in their dashboard).
- Its upload → frame → name/message flow is ~80% of the greeting-card contribution flow:
  reuse `UploadDropzone`, `FrameEditor`, `CropStage`, `compositeUpload()`,
  `GoldFrameCard`, swapping destination from `posts` to `card_contributions`.

## 2. Unit economics (AI + infra, researched July 2026)

- **Gemini image gen (default)**: ~$0.04/image, generous free tier; already integrated
  in Creator2D (moves server-side).
- **Higgsfield image gen (premium styles)**: ~$0.12–0.23/generation via API;
  platform top-up credits ~$0.05/credit.
- **Meshy 3D**: ~20 Meshy credits per full textured model; Pro $20/mo = 1,000 credits
  → **~$0.40/model** (rigging/animation roughly doubles it).
- **MP4 render**: Remotion Lambda ≈ $0.01–0.06 per rendered minute (Creatomate fallback
  ≈ $0.20–0.50/min).
- **Supabase**: Pro $25/mo baseline; storage ~$0.021/GB-mo, egress ~$0.09/GB. Typical
  event ≈ 1–2 GB (200 posts, ~30% video) → pennies per event; per-tier retention bounds it.

**Platform credit design** — 1 credit ≈ $0.10 retail, ~50–70% gross margin:

| Action | Raw cost | Credits | Retail |
|---|---|---|---|
| AI frame/overlay image (Gemini, default) | ~$0.04 | 1 | $0.10 |
| AI frame/overlay image (Higgsfield, premium styles) | ~$0.15 | 2 | $0.20 |
| AI 3D prop (textured GLB) | ~$0.40–1.00 | 10 | $1.00 |
| AI 3D prop + rig/animate | ~$1–2 | 20 | $2.00 |
| Premium MP4 card render | ~$0.50–1.50 | 30 | $3.00 |

Credit packs: 50/$5, 120/$10, 300/$20. Package tiers include an allowance.

## 3. Pricing

Anchors: Kululu $39–99/event, Fotify $30–50/event, physical booth rental $475+. We
deliver booth + wall + AI studio + cards — priced above photo-sharing apps, far below
hardware.

**Per-event packages (couples/hosts):**
- **Free trial — $0**: 1 draft event, 25 uploads, watermarked, 7-day retention,
  ~10 trial credits (lets them taste the AI studio).
- **Essentials — $49/event**: 500 uploads, custom uploaded frames, full curated 3D
  library, live wall + projection mode, 20 AI credits, 3-month storage.
- **Premium — $99/event** ⭐ most popular: unlimited uploads, AI Studio (100 credits),
  interactive greeting card + video guestbook, remote contributions, 1-year storage.
- **Deluxe — $169/event**: everything + rendered MP4 keepsake film, custom subdomain,
  priority support, downloadable full-res archive.

**Pro subscription (planners / venues / booth operators):**
- **Pro — $79/mo** (or $790/yr): unlimited events (fair use), white-label, 300
  credits/mo, reusable brand/theme templates, client hand-off links, multi-seat org.
  The recurring-revenue engine; a booth operator charging $475/event pays for Pro with
  one booking.

Add-ons: extra MP4 card $9.99; extended storage $19/yr; credit packs.

**Illustrative early revenue math:** 60 paid events/mo at ~$90 avg + 15 Pro subs
= ~$6.6k MRR; AI COGS <10%, infra <$300/mo.

## 4. Go-to-market (weddings first)

- **Built-in viral loop**: every event exposes 75–150 guests via a "Create your own"
  footer on wall, gallery, and greeting cards. Weddings beget weddings.
- **Channels:** The Knot / Zola / WeddingWire vendor listings; Instagram/TikTok (AR
  captures are inherently demo-able); SEO ("virtual photo booth for weddings", "video
  guestbook", "live wedding photo wall").
- **B2B wedge (Pro tier):** photo-booth operators, DJs, planners, venues — they resell
  per event at markup. Partner/affiliate: 20% recurring for planner referrals.
- **Greeting card as standalone wedge:** "video guestbook for remote celebrations" is
  searched independently (milestone birthdays, retirements, memorials) and onboards
  buyers who later run full events.

**Landing copy direction (hero):**
> **Your event, in augmented reality.**
> Give every guest a magical AR photo booth in their pocket — no app to download. Watch
> their photos beam onto a live wall, styled with frames and 3D magic you designed in
> minutes with AI. Then send it all home as a keepsake they'll never forget.
> [Create your event free] — *Loved at weddings, galas & milestone birthdays.*

Feature bullets: "Scan. Pose. Beam." / "Design frames with AI — type it, see it, use it"
/ "A 3D prop library that puts crowns, halos & confetti on every guest" / "The Video
Guestbook: greetings from anywhere in the world, wrapped in one beautiful animated card."

---

## 5. Technical architecture

### 5.0 Guiding decisions

0. **The three live event sites are untouchable** — see §5.4a.
1. **Tenancy unit = event; billing unit = org.** An `org` (couple, planner, venue) owns
   N `events`. One-time packages attach to an event; Pro subscription to the org.
2. **Runtime tenancy via path `/e/:slug`** (not subdomains in v1 — QR codes don't care;
   custom domains later via a `custom_domains` table + hostname→slug resolution).
3. **`src/lib/db.ts` stays the single chokepoint** — refactor every function from the
   build-time `EVENT_ID` constant to an explicit `eventId` parameter. This one refactor
   carries most of the tenancy work.
4. **Guests stay anonymous**, but all guest *writes* (posts, card contributions) go
   through Edge Functions (signed upload URLs + service-role inserts) — tenant-scoped,
   quota-enforceable, race-safe. Guest *reads* (wall, assets) stay direct-from-Supabase
   with public-read RLS so realtime + CDN performance is untouched.
5. **MP4 renders = Remotion on Remotion Lambda** — the interactive web card and rendered
   MP4 share the same React template components (frame-driven animation). Fallback:
   Creatomate API.
6. **Email = Resend** (React Email templates).
7. **All AI keys server-side; one multi-provider `ai-generate-image` function**
   (`provider: 'gemini' | 'higgsfield'`, Gemini default) + `ai-generate-3d` (Meshy) —
   all metered through one credit ledger so vendors are swappable.

### 5.1 Data model (new schema, Supabase migrations)

- **Identity/tenancy:** `profiles` (1:1 auth.users), `orgs` (stripe_customer_id),
  `org_members` (role: owner/editor), `events` (org_id, unique `slug`, status
  draft/live/ended/archived, `config jsonb` = runtime EventConfig: copy, palette,
  logo_url, background_template, landing route, AR content flags; denormalized `plan_tier`).
- **Existing 4 tables keep `event_id text`** = `events.slug` (FK added — no data
  rewrite). `experiences` gains `org_id`, `is_global`, `source`
  ('upload'|'procedural'|'ai_gemini'|'ai_higgsfield'|'ai_meshy') → the global curated
  catalog is `is_global=true, org_id null`; events link items via `event_catalog_links`
  instead of copying.
- **Billing:** `event_plans` (one-time package per event, entitlement snapshot),
  `subscriptions` (org-level Pro), `credit_balances` (one lockable row per org),
  `credit_ledger` (append-only), `stripe_webhook_events` (idempotency).
- **AI:** `ai_jobs` (kind image/model3d, provider, provider_job_id, status,
  credits_charged) — Meshy is async.
- **Cards:** `cards` (event_id, unguessable `public_id`, `contribute_token` invite
  links, template, status collecting/published/rendered, deadline),
  `card_contributions` (name, message, media_type photo/video/text, media_path,
  approved/hidden, session_id), `card_renders`.
- **Day-of staff:** `event_access_tokens` (hashed PIN/link token, role 'manager',
  expiry) — replaces the shared admin passcode for on-site staff.
- **Migration order:** (1) tenancy tables + seed "Legacy" org + 3 event rows from code
  configs; (2) FKs + experiences columns; (3) RLS swap last, in a maintenance window,
  with legacy grandfather policies (§5.4a).

### 5.2 RLS design (the security core)

- Helper fns: `is_org_member(org)`, `event_org(slug)`, `event_is_public(slug)`.
- `events`: public select where not draft; member CUD. `experiences/challenges/
  app_settings`: public select where event public (+ published `is_global` rows);
  member write. `posts`: public select where `approved and not hidden` and event
  public; **zero anon insert/update policies** — writes only via `submit-post` edge fn.
  `cards`: public select only when published (fetched by unguessable public_id);
  `card_contributions`: **no public select** (media via signed URLs inside the compiled
  card); anon insert only via `card-contribute` fn validating `contribute_token`.
  Billing/credit/job tables: member select, service-role write.
- Verified by a pgTAP suite (member / other-org / anon / manager-token per table)
  + `get_advisors` lint in CI.

### 5.3 Storage

| Bucket | Visibility | Path | Writes |
|---|---|---|---|
| `posts` | public (wall/CDN perf) | `{slug}/{session}/{uuid}` | signed URLs from `submit-post` only |
| `assets` | public (booth loads GLB/frames fast) | `{slug}/...`, `global/...` | member storage-RLS + service role (AI outputs) |
| `cards` | **private** | `{slug}/{card}/{contribution}` | signed URLs from `card-contribute` |
| `renders` | **private** | `{card}/{render}.mp4` | service role; long-lived signed URL in email |

Abuse resistance on anonymous writes: event-live + date-window checks, per-session
sliding quota (~30 posts/hr), size caps (photo 8 MB, video 60 MB/30 s — matches recorder
cap), content-type allowlist, optional pre-moderation per event. Per-event storage quotas
by tier; free-tier media purged after 30 days (upgrade driver).

### 5.4 Runtime tenancy & routing

```
/                          marketing + login        /signup /login
/host/*                    org dashboard (events, billing, credits)
/host/events/:id/*         per-event studio (today's /admin/* screens)
/e/:slug                   guest landing   + /booth /wall /me /upload /experience/:id
/c/:publicId               greeting card viewer
/c/:publicId/contribute    remote contribution flow (?t=<token>)
/m/:slug                   event-manager (PIN) console
```

- New `src/events/runtime.ts`: `loadEventConfig(slug)` = `events` row + `app_settings`
  overrides merged with defaults, cached in zustand via the existing `applyBranding`
  path. `EventProvider` context replaces module-level `activeEvent`/`EVENT_ID`.
- **Component theming → data:** Logo components → uploaded logo URL (+ text-wordmark
  fallback from name+font); per-event `Background.tsx` → 6–10 parameterized background
  templates (`src/components/theme/backgrounds/*`) tinted by the existing 7 branding
  colors; per-event `theme.css` → the existing runtime CSS-variable mechanism
  (`src/lib/branding.ts`).
- Legacy: keep `src/events/registry.ts` and the three `src/events/<slug>/` folders
  **while their sites are live**. The platform site runs with no `VITE_EVENT`, so `/`
  is the marketing/login page, never an event.
- **PR #4 integration:** `/upload` re-homes to `/e/:slug/upload`;
  `VITE_UPLOAD_PASSCODE` → per-event DB setting; its components are reused as the base
  of the card-contribution flow.

### 5.4a Legacy-site protection (hard requirement)

Two blast radiuses to contain:

1. **Code/deploys.** Today every push to `main` rebuilds all three Netlify sites.
   **Step zero of Phase 1:** cut a `legacy-events` branch at the current `main` tip and,
   via the Netlify MCP, switch each existing site's production branch to `legacy-events`
   (or lock published deploys). From then on, `main` evolves into the platform; legacy
   sites only change via deliberate cherry-picks. The **new platform site** is created
   via the Netlify MCP and tracks `main`.
2. **Shared database.** The legacy builds write to Supabase directly from the browser
   with the anon key, so RLS hardening would break them. Mitigation: migration 003
   includes **grandfather policies** — anon insert/select scoped to
   `event_id in ('hope-gala','jenna-jake','detola-wuyi')`, preserving today's behavior
   for exactly those slugs (still safer than `USING (true)`). Each grandfather policy is
   dropped when its event is archived. New tenants never get anon-write policies. Verify
   legacy flows (booth capture → wall beam-in on all three sites) immediately after
   migration 003.

The three events are *also* seeded as tenant rows on the new platform (owned by a
"Legacy" org) — same slugs, same `event_id`-partitioned data, both frontends reading the
same rows. No data migration, no double-entry.

### 5.5 Auth

- Hosts: Supabase Auth (email+password, Google OAuth); `persistSession: true` (guests
  unaffected — no session). Signup wizard → `create-event` fn provisions org + first
  event atomically.
- Event creation wizard: name/date/type → slug → branding (logo upload, palette seeded
  from logo colors, background template) → starter AR pack from global catalog → QR +
  link. Writes `events.config` + `app_settings` so existing runtime machinery renders
  immediately.
- Guests: unchanged (localStorage session UUID, no login).
- `AdminGate.tsx` passcode deleted on the platform; `/host/*` = session + `org_members`
  (RLS is the real enforcement). Day-of staff: `/m/:slug` manager console via hashed
  token in `event_access_tokens` through a `manager-api` fn (approve/hide posts, wall
  settings) — revocable, no Supabase session minted.

### 5.6 Edge functions (new `supabase/` dir + GitHub Actions CI)

`create-event` · `submit-post` (2-step signed-URL upload) · `manager-api` ·
`ai-generate-image` (multi-provider: Gemini default / Higgsfield premium; replaces the
browser Gemini call in `Creator2D.tsx`, `VITE_GEMINI_API_KEY` deleted) ·
`ai-generate-3d` + `meshy-webhook`/`ai-job-status` (download GLB → post-process →
auto-insert `experiences` row with face-anchor default + sane scale; refund credits on
failure) · `stripe-checkout`/`stripe-portal`/`stripe-webhook` (idempotent) ·
`card-contribute` · `card-publish` · `card-render`/`card-render-status` (Remotion
Lambda) · `send-card-email` (Resend).

**Atomic credit spend** — single conditional
`UPDATE ... WHERE balance >= amount RETURNING` in a `spend_credits()` security-definer
fn + ledger insert; refunds are compensating +delta rows. Race-safe without locks. UI
reads balance for display only; every function re-checks server-side.

### 5.7 AI features UX

- **Frames:** prompt + style presets → preview → save to event library. Server-side
  alpha check enforces transparent centers. ~1–2 credits.
- **3D props:** text or reference image → Meshy → job progress card → GLB lands in the
  library pre-anchored (12 anchors in `src/lib/faceRig.ts`), immediately try-on-able in
  `FaceRig.tsx`. ~10 credits. Post-process: reject/decimate >50k tris, normalize scale,
  thumbnail. The curated global catalog is the safe default; AI 3D is additive, not
  load-bearing.
- Free tier: ~10 signup credits; packages/Pro include grants; overage via credit packs.

### 5.8 Greeting cards

- Extract `<CaptureSurface>` from Booth/capture/recorder for reuse by the booth AND
  `/c/:publicId/contribute` (camera capture, optional AR props, prompt card, name +
  message). Photo/file-upload contributions reuse PR #4's components.
- Web card templates in `src/components/cards/templates/*` (Storybook page-flip, 3D
  Gallery Wall on the existing Three.js stack, Film Strip) — React components taking
  `{card, contributions[]}`, **frame/progress-driven animation from day one** so they
  dual-target Remotion.
- Host curates (reorder/hide), publishes → Resend email with card link. Premium:
  `card-render` → Remotion Lambda → MP4 → private `renders` bucket → signed URL emailed.
- Remote-event mode = `event_type='remote'` config: landing routes straight to
  contribution; the card is the primary artifact. Config, not new code paths.

### 5.9 Billing & gating

Stripe products: `event_starter/premium/deluxe` (one-time, metadata.event_id),
`credits_*` packs, `pro_operator` (monthly, org). Webhook → `event_plans` /
`subscriptions` / credit grants; denormalize `events.plan_tier`. One shared
`entitlements.ts` (tier → maxPosts, videoEnabled, aiCredits, cards, removeWatermark…):
`useEntitlements(eventId)` gates UI (upsell modals); every edge function re-checks from
DB. The existing watermark step in `capture.ts` becomes the free-tier watermark, removed
by entitlement.

### 5.10 Phasing (~15 weeks solo + AI; each phase demoable)

0. **Merge PR #4 first** (guest Upload-to-Wall) — prerequisite, reused downstream.
1. **Foundations (~3 wk):** *step zero:* pin the 3 legacy sites to a `legacy-events`
   branch + create the new platform Netlify site (both before any code changes). Then
   migrations (incl. grandfather RLS), auth, `/e/:slug` routing, `EventProvider`,
   `db.ts` eventId refactor, `submit-post` fn, CI. *Demo: real signup on the platform
   site; legacy events visible as tenants; guest flow at `/e/hope-gala` with real RLS —
   while all three original sites still work unchanged.*
2. **Self-serve studio (~2.5 wk):** event wizard, logo/background-template theming,
   `/host/*` studio (re-home 9 admin screens, kill AdminGate), manager PIN console,
   global catalog, tenant-scoped `/upload` w/ DB passcode. *Demo: stranger creates a
   wedding → QR → guests capture → wall. The core SaaS demo.*
3. **Billing + credits (~2 wk):** Stripe checkout/webhook/portal, ledger, entitlement
   gating incl. watermark removal. *Demo: buy Premium in test mode; watermark gone,
   credits granted.*
4. **AI generation (~2.5 wk):** multi-provider `ai-generate-image`, `ai-generate-3d` +
   webhook + job UI, auto face-anchoring. *Demo: type a prompt → wearable 3D prop on
   your face.*
5. **Greeting cards standard (~3 wk):** cards schema/flows, `<CaptureSurface>`
   extraction, contribution page (reusing PR #4 components), 2 web templates, publish +
   email, remote-event mode. *Demo: 5 friends record greetings from phones anywhere;
   celebrant opens an animated card.*
6. **Premium MP4 (~2 wk):** `remotion/` workspace sharing card templates, Lambda,
   render fn + email. *Demo: click "Render keepsake film", receive MP4.*

Phases 3⇄4 can swap; 5→6 ordered. Premium render can slip without blocking launch.

### 5.11 Reuse vs replace

- **Reused as-is:** entire AR/booth guest stack (`faceTracking.ts`, `faceRig.ts`,
  `headPieces.ts`, `shaders.ts`, `camera.ts`, `recorder.ts`, `src/components/ar/*`,
  `src/components/booth/*`), `Wall.tsx` (+slug param), `MyPhotos`, `JoinBooth`,
  branding/`app_settings` override system, all admin screen UIs (re-homed), PR #4
  upload flow.
- **Extended:** `db.ts` (eventId params + new tables — remains chokepoint), `store.ts`,
  `types.ts`, `capture.ts` (upload path + watermark gating only).
- **Replaced/removed (on the platform site only):** `AdminGate.tsx`, browser Gemini
  call, `VITE_EVENT`/`VITE_ADMIN_PASSCODE`/`VITE_UPLOAD_PASSCODE`/`VITE_GEMINI_API_KEY`.
  The `src/events/<slug>/` folders and registry **stay** while the legacy sites are
  live; new tenants are DB-only. Legacy Netlify sites are retired only by the owner,
  per event, when done.

### 5.12 Risk register

| Risk | Sev | Mitigation |
|---|---|---|
| Breaking the 3 live legacy sites (shared repo + shared DB) | High | Step zero: pin their Netlify sites to a frozen `legacy-events` branch before any platform work; grandfather anon RLS policies for exactly their 3 slugs; regression-check all three sites after every migration |
| RLS correctness (cross-tenant leak / broken guest reads) | High | One migration + pgTAP suite (member/other-org/anon/manager per table); anon role for **new** tenants has zero write policies; `get_advisors` in CI |
| MP4 pipeline (new infra, dual-target templates) | High | Frame-driven templates from day one; Creatomate fallback; premium add-on can slip |
| Meshy GLB quality/polycount for face props | Med-High | Webhook post-process (decimate >50k tris, normalize scale); curated catalog is the default |
| Guest video storage costs | Med | 60 MB/30 s caps, per-tier quotas, free-tier 30-day purge, no transcode v1 |
| `db.ts` refactor regressions (thin tests) | Med | Mechanical single PR; 3 legacy events as live fixtures; add smoke tests |
| Stripe ↔ entitlement drift | Med | Idempotency table + nightly reconciliation fn |
| Slug squatting / signup abuse | Low | Reserved words, free-tier caps, quotas in `submit-post` |

## 6. Verification (per phase)

- Phase 1: pgTAP RLS suite green; manual cross-tenant probe with a second account;
  guest capture→wall works at `/e/hope-gala` on the platform site; **regression check
  on all three legacy sites after every migration**.
- Phase 2: fresh-account E2E — signup → wizard → QR on a phone → capture → wall
  beam-in; manager PIN can moderate, cannot access billing.
- Phase 3: Stripe test-mode checkout for each product; webhook replay idempotency;
  watermark toggles by tier.
- Phase 4: prompt → frame (transparent center verified) and → GLB prop rendered on face
  in booth; credit balance decremented exactly once under parallel requests; failed job
  refunds.
- Phase 5/6: remote contribution from a second device; published card email received;
  MP4 render matches web card template.

## Sources

- Higgsfield pricing: higgsfield.ai/pricing (plans $15/$39/$99; top-ups ~$5/100cr);
  Segmind per-generation API pricing
- Meshy: docs.meshy.ai/en/api/pricing; help.meshy.ai (20 credits/textured generation;
  Pro $20/mo = 1,000 credits)
- Market: kululu.com/pricing, fotify.app, pov.camera/pricing, snapbar.com photo-booth
  cost comparisons
