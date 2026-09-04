# Beamwall — the AR Event Platform

A self-serve, multi-tenant SaaS for **augmented-reality photo booths, live photo
walls, and animated keepsake cards** — built for weddings first, and any major
event (galas, milestone birthdays, remote celebrations). Hosts sign up, spin up
their own event page in minutes, design frames with AI, drop 3D props onto every
guest, and send everyone home with a keepsake film.

Built with Vite · React 19 · TypeScript · Tailwind v4 · Three.js (R3F) ·
MediaPipe FaceLandmarker · **Supabase** (Auth + Postgres/RLS + Storage +
Realtime + Edge Functions) · Stripe · Gemini / Higgsfield / Meshy · HeyGen
HyperFrames.

> **Two things ship from this one repo:**
> - **`main` → the Beamwall platform** (new Netlify site) — everything below.
> - **`legacy-events` → the 3 original single-event sites** (galabooth /
>   jennajake / theadetoyis). They are frozen on that branch and unaffected by
>   platform work. See [docs/EVENTS.md](docs/EVENTS.md).

---

## What it does (three connected products)

1. **AR Photo Booth + Live Wall** — guests scan a QR, open a browser AR booth
   (no app download), and pose with face-tracked frames, shaders and 3D props;
   photos/videos beam live onto a projected wall.
2. **AI Event Studio** — the host uploads frame art *or* generates it from a
   prompt (Gemini default / Higgsfield premium), and picks 3D props from a
   curated library *or* generates them (Meshy image/text → GLB, auto face-anchored).
3. **Greeting Cards / Video Guestbook** — guests' captures + remote video
   messages compile into a beautiful animated web card, emailed to the celebrant;
   Deluxe events also get a rendered MP4 keepsake film (HeyGen HyperFrames).

## Routes

| Area | Route | Notes |
|------|-------|-------|
| Marketing / auth | `/`, `/login`, `/signup` | platform landing + Supabase Auth |
| Host dashboard | `/host`, `/host/new`, `/host/concierge`, `/host/billing`, `/host/support`, `/host/import` | events, AI wizard, copilot, credits/plans, support desk, Frame Forge handback |
| Event studio | `/host/events/:id/*` | the 10 studio screens (branding, library, creator 2D/3D, moderation, challenges, settings, manager access…), gated by org membership |
| **Platform admin** | `/admin/*` | RethinkReality super-admin across all tenants — customers, events, payments, catalogue, features, credits, users, support, audit, and `/admin/landing` (CMS for the marketing page's copy, images and films); gated by `platform_admins` (see [docs/ADMIN-SUITE.md](docs/ADMIN-SUITE.md)) |
| Guest (per event) | `/e/:slug` → `/welcome` `/booth` `/wall` `/me` `/upload` `/experience/:id` | runtime-resolved tenant; `/welcome` = instruction landing for signage QRs |
| Greeting card | `/c/:publicId`, `/c/:publicId/contribute?t=` | public viewer + token-gated contribution |
| Day-of staff | `/m/:slug` | PIN/link manager console (moderation + wall settings) |
| **DEV only** | `/dev/studio`, `/dev/asset-prep` | registered only when `import.meta.env.DEV` — the studio harness (no auth, no network) and the asset-prep tool that turns a raw GLB into a configurator template. Never ship to production; note `vite build --mode development` does **not** set `DEV` (`NODE_ENV` is the load-bearing part), so these 404 in a static build unless you set it. |

## Run locally

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:5173
```

Platform build uses **no `VITE_EVENT`** (so `/` is the marketing/login page).
Legacy single-event builds set `VITE_EVENT=<slug>` and render exactly as before.

Agent tooling: `npm run gen:agent-tools` regenerates the Copilot's `# Tools`
prompt section from `src/lib/copilotTools.ts`; `npm run bench:agent` replays
the agent eval fixtures against real Gemini models (owner-run locally with
`GEMINI_API_KEY`; `--record` saves outputs that `src/lib/agentEvals.test.ts`
replays deterministically).

## Architecture

- **Multi-tenant data** — Supabase Postgres with real RLS. `orgs → events`
  tenancy; `event_id` (= `events.slug`) partitions the existing content tables.
  Migrations are checked in under `supabase/migrations/` (001–038; two files
  are numbered 030) and mirror what's applied to the live project. The three legacy slugs keep working via
  **grandfather RLS policies**.
- **Runtime tenancy** — `src/events/runtime.ts` + `EventContext.tsx` resolve an
  event by slug at runtime (replacing the old build-time `VITE_EVENT`). The
  single data-access chokepoint `src/lib/db.ts` takes an explicit `eventId`.
- **Server layer** — Supabase Edge Functions under `supabase/functions/`:
  `submit-post` · `create-event` · `admin-api` (platform super-admin) · `manager-api` · `stripe-checkout`/`-portal`/
  `-webhook` · `ai-generate-image` · `ai-generate-3d` · `ai-job-status` ·
  `ai-event-designer` (conversational event concierge for `/host/new` **and** the
  Platform Copilot's tool proposals; falls back to a client-side keyword planner
  when unprovisioned; replies render as interactive **A2UI v0.9.1** generative-UI
  cards — protocol core in `src/lib/a2ui.ts`, themed renderer in
  `src/components/a2ui/`; deploys as FIVE files — `index.ts` transport ·
  `prompt.ts` pure sectioned prompts · `tools.generated.ts`, GENERATED from the
  typed tool registry `src/lib/copilotTools.ts` by `npm run gen:agent-tools` and
  drift-tested · `profiles.ts` per-mode model profiles with `GEMINI_*_<MODE>`
  secret overrides · `deno.json`; every turn logs to `agent_turns`. Four request
  modes: `create` (the concierge — "you decide" fills the whole plan from a
  `# Deferral` rule, and the plan carries a nested `brief`), `copilot` (up to
  `MAX_ACTIONS = 5` tool proposals per turn, at most one credit-spender and it
  goes last; a ≥2-step reply renders as one bundle card), `scene` (Studio
  Director) and `copy` (the four guest lines — tagline · welcomeIntro · thankYou
  · keepsakeIntro — written ONCE per event on `gemini-2.5-flash-lite` by
  `src/lib/eventCopy.ts` at create-success or go-live, stamped
  `config.copy.generatedAt`). The event brief itself (`src/lib/eventBrief.ts`)
  lives in `events.config.brief` — no table — and is read by all three chat
  modes) ·
  `validate-challenge-photo` (anonymous guest photo
  check for challenges that require an AI visual match — reads the requirement
  server-side from the challenge's `validation` config, SSRF-guards any reference
  image to the public `assets` bucket, treats the guest photo as data-only, and
  records one `challenge_checks` verdict row per call, fire-and-forget) ·
  `card-contribute`/`-view`/`-publish` · `card-render`/`-render-status`. All AI
  and payment keys live here, never in the client.
- **Billing & credits** — Stripe (per-event packages + Pro subscription + credit
  packs); atomic `spend_credits`/`grant_credits`; entitlements in
  `src/lib/entitlements.ts` gate features client-side and are **re-checked
  server-side** in every function.
- **Face AR / booth / wall** — unchanged from the original app
  (`src/lib/faceRig.ts`, `src/components/ar/*`, `src/components/booth/*`,
  `src/components/Wall.tsx`); MediaPipe FaceLandmarker + R3F + WebGL shaders.

The full productization strategy is in
[`docs/superpowers/specs/2026-07-03-saas-platform-strategy.md`](docs/superpowers/specs/2026-07-03-saas-platform-strategy.md);
per-phase audit trail is in [`docs/superpowers/audits/`](docs/superpowers/audits/). The
platform super-admin console (`/admin`) is in [`docs/ADMIN-SUITE.md`](docs/ADMIN-SUITE.md);
agent onboarding + working memory is in [`CLAUDE.md`](CLAUDE.md).

## Deploying / going live

The platform ships **safe-by-default**: every integration degrades gracefully
until its key is set (billing → "setup pending", AI → `ai_not_configured`, card
email → `email_not_configured`, film render → `render_not_configured`). The full
operator runbook — Netlify sites, Supabase function secrets, Stripe/Google/
Resend/HeyGen setup — is in
**[`docs/DEPLOYMENT-CHECKLIST.md`](docs/DEPLOYMENT-CHECKLIST.md)**.

## Backend (Supabase `zrtftliozslrjomxbfrr`)

Tables — tenant: `orgs`, `org_members`, `profiles`, `events`, `experiences`,
`posts`, `challenges`, `app_settings`, `event_catalog_links`,
`event_access_tokens`, `cards`, `card_contributions`, `card_renders`,
`org_provider_keys` (BYO AI keys). Billing: `event_plans`, `subscriptions`,
`credit_balances`, `credit_ledger`, `orders`, `billing_catalog`, `promo_codes`,
`promo_redemptions`, `stripe_webhook_events`. Entitlements: `feature_flags`,
`plan_feature_defaults`, `org_feature_overrides`, `event_feature_overrides`
(resolved by `resolve_features_raw`, migration 028 — SQL, not TS, so both
runtimes read one authority). Platform: `platform_admins`, `admin_audit`,
`platform_config`, `landing_content` (marketing-page CMS; anon reads the
published half only, via `get_landing_content()`), `support_tickets`,
`support_messages`, `client_errors`, `ai_jobs`, `ai_designer_usage`,
`agent_turns` (per-turn AI telemetry — no message text; service-role only;
`mode` ∈ create · copilot · scene · copy), `challenge_checks` (one row per AI
photo-check verdict — pass/confidence/reason/model/latency, NO guest identity;
written by `validate-challenge-photo` on the service role, readable by the
event's org members; 2000/event/day cap), +
idempotency/quota helpers (`guest_quota`).
Buckets: `posts`, `assets` (public — platform-owned landing media lives under
the admin-only `_platform/` prefix), `cards`, `renders`, `support` (private).
RLS verified by `supabase/tests/rls-probes.sql`.
