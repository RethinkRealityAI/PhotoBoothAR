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
| Host dashboard | `/host`, `/host/new`, `/host/billing` | events, wizard, credits/plans |
| Event studio | `/host/events/:id/*` | the 10 studio screens (branding, library, creator 2D/3D, moderation, challenges, settings, manager access…), gated by org membership |
| **Platform admin** | `/admin/*` | RethinkReality super-admin across all tenants; gated by `platform_admins` (see [docs/ADMIN-SUITE.md](docs/ADMIN-SUITE.md)) |
| Guest (per event) | `/e/:slug` → `/booth` `/wall` `/me` `/upload` `/experience/:id` | runtime-resolved tenant |
| Greeting card | `/c/:publicId`, `/c/:publicId/contribute?t=` | public viewer + token-gated contribution |
| Day-of staff | `/m/:slug` | PIN/link manager console (moderation + wall settings) |

## Run locally

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:5180
```

Platform build uses **no `VITE_EVENT`** (so `/` is the marketing/login page).
Legacy single-event builds set `VITE_EVENT=<slug>` and render exactly as before.

## Architecture

- **Multi-tenant data** — Supabase Postgres with real RLS. `orgs → events`
  tenancy; `event_id` (= `events.slug`) partitions the existing content tables.
  Migrations are checked in under `supabase/migrations/` (001–009) and mirror
  what's applied to the live project. The three legacy slugs keep working via
  **grandfather RLS policies**.
- **Runtime tenancy** — `src/events/runtime.ts` + `EventContext.tsx` resolve an
  event by slug at runtime (replacing the old build-time `VITE_EVENT`). The
  single data-access chokepoint `src/lib/db.ts` takes an explicit `eventId`.
- **Server layer** — Supabase Edge Functions under `supabase/functions/`:
  `submit-post` · `create-event` · `admin-api` (platform super-admin) · `manager-api` · `stripe-checkout`/`-portal`/
  `-webhook` · `ai-generate-image` · `ai-generate-3d` · `ai-job-status` ·
  `ai-event-designer` (conversational event concierge for `/host/new`; falls
  back to a client-side keyword planner when unprovisioned; replies render as
  interactive **A2UI v0.9.1** generative-UI cards — protocol core in
  `src/lib/a2ui.ts`, themed renderer in `src/components/a2ui/`) ·
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

Tables: `orgs`, `org_members`, `profiles`, `events`, `experiences`, `posts`,
`challenges`, `app_settings`, `event_catalog_links`, `event_plans`,
`subscriptions`, `credit_balances`, `credit_ledger`, `ai_jobs`,
`event_access_tokens`, `cards`, `card_contributions`, `card_renders`,
`platform_admins`, `admin_audit`, + idempotency/quota helpers. Buckets: `posts`, `assets` (public), `cards`,
`renders` (private). RLS verified by `supabase/tests/rls-probes.sql`.
