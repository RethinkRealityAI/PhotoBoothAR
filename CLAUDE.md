# CLAUDE.md — Beamwall working memory

Operational memory for agents working in this repo. Product/architecture overview
lives in [`README.md`](README.md); the operator runbook (keys, Netlify, Stripe…)
in [`docs/DEPLOYMENT-CHECKLIST.md`](docs/DEPLOYMENT-CHECKLIST.md); the per-phase
audit trail in [`docs/superpowers/audits/`](docs/superpowers/audits/). This file is
the **living state + watchouts + TODO backlog**. Keep it current: check items off
the backlog as they land, and append to the Failure Log after any major incident.

Beamwall is a multi-tenant SaaS: AR photo booth + live wall + animated keepsake
cards. Vite 6 · React 19 · TS · Tailwind v4 · Three.js/R3F · MediaPipe · Supabase
(Auth/Postgres+RLS/Storage/Realtime/Edge Functions) · Stripe · Gemini/Higgsfield/
Meshy · HeyGen HyperFrames. Supabase project `zrtftliozslrjomxbfrr`.

## The gate — run all four before every commit

```bash
npm run lint                     # tsc --noEmit — must exit 0
npm run test                     # vitest — must be all-green
npm run build                    # runtime (platform) build
VITE_EVENT=hope-gala npm run build   # legacy single-event build MUST still pass
```

Use **Node 22+** (CI pins 22). Node 20 lacks native `WebSocket`, which
`@supabase/realtime-js` requires at client construction — any test importing a
Supabase-dependent module throws on Node 20.

The legacy build is not optional: this one repo ships **two things** — `main` →
the Beamwall platform (Netlify site `beamwall`, no `VITE_EVENT`), and
`legacy-events` → the 3 frozen single-event sites. A platform change that breaks
`VITE_EVENT=<slug> npm run build` is a regression.

## Branch & deploy model

- Feature work → branch off `main` → draft PR into `main`. Merging `main`
  auto-deploys `beamwall`. Legacy sites only rebuild from `legacy-events`.
- If your working branch's PR was already merged, **restart it from `main`** for
  follow-up work (a merged PR can't track new commits) — don't stack on merged
  history.
- Never commit the model identifier, secrets, or keys into repo artifacts.

## Test-driven development (how we build here)

This platform is built test-first and iteratively. Before changing behavior, add
or extend a test that fails for the missing behavior, then make it pass, then run
the full gate.

- **Pure logic** → `src/**/*.test.ts` (Node env). Fast, no DOM. This is the
  default and where most coverage belongs (entitlements, catalog, slug, branding,
  recorder, capture…). Example to copy: `src/lib/entitlements.test.ts`.
- **Components / rendering** → `src/**/*.test.tsx` (jsdom env, Testing Library +
  jest-dom). Wrap router-dependent components in `<MemoryRouter>`. Assert
  behavior (links wired, states render), not pixels. Examples:
  `src/pages/Demo.test.tsx`, `src/pages/Landing.test.tsx`.
- **RLS / tenancy** → `supabase/tests/rls-probes.sql`, run as `anon`/authenticated
  against the live project via the Supabase MCP after any policy change.
- Config: `vitest.config.ts` routes `.test.tsx`→jsdom, injects dummy Supabase env,
  and loads `src/test/setup.ts` (jest-dom matchers + auto-cleanup). "Looking good"
  is verified visually on the **Netlify deploy preview** for the PR, not in tests.

## Watchouts (hard-won — read before editing these areas)

- **Legacy grandfathering is sacred.** Three slugs — `hope-gala`, `jenna-jake`,
  `detola-wuyi` — have grandfather RLS policies and are exempted in edge functions
  (`LEGACY_SLUGS`). Never tighten a grandfather policy in a breaking way; never
  change behavior that a pinned `VITE_EVENT` build depends on.
- **Entitlements are enforced twice.** `src/lib/entitlements.ts` gates the client;
  every edge function **re-checks server-side** (e.g. `submit-post` mirrors
  `TIER_MAX_POSTS` + the video gate). Change one → change the mirror, and update
  `src/lib/entitlements.test.ts`.
- **RLS public-read must be `to anon` only.** The 008 fix closed a leak where
  `cards_public_read` applied to `authenticated` and exposed every org's
  `contribute_token` + `recipient_email`. Never widen a public-read policy to
  `authenticated` without a role/tenant scope.
- **Don't reintroduce a global scroll lock.** `App.tsx`'s root is
  `min-h-[100dvh]` and must NOT go back to `h-screen … overflow-hidden` — that
  clipped every page taller than the viewport. Immersive pages (booth, wall, card
  viewer) own their own `absolute inset-0` scroll; document pages flow.
- **The agent container can't reach external HTTPS.** Org egress policy blocks
  `supabase.co`, CDNs, etc. via curl (403), and there's no service-role key or
  storage-upload tool in the container. To move bytes/do server-side work, deploy
  an **edge function** (its `fetch` runs on Supabase's network) and invoke it from
  SQL via **`pg_net`** (`net.http_post` → read `net._http_response`). This is how
  the demo card's video/photo were seeded.
- **Edge-function redeploys:** always pass `import_map_path: 'deno.json'`
  explicitly (and include the `deno.json` file), or the stored absolute path gets
  mangled and the deploy fails.
- **Transient MCP errors:** "permission stream closed before response received"
  is transient — retry the call once before treating it as blocked.
- **Demo deep-links are hardcoded.** `src/pages/Demo.tsx` `DEMO` consts point at
  seeded records (event slug `demo`, published card `479ee7c5…`, collecting card
  `a4cf1e6a…` + token). If the demo data is reseeded, update those consts (there
  are tests asserting the wiring, not the values).

## Current state (2026-07-04)

- Platform (phases 0–6) merged to `main` and live on `beamwall`. Migrations
  001–008 applied. All edge functions deployed and degrade gracefully until their
  key is set.
- **PR #6** (open, draft): UX pass — no-clip root fix, `/demo` hub, responsive
  landing, wall overflow containment, guest nav (incl. legacy), side-by-side card
  viewer — plus this doc and the new tests. Gate green (66 tests).
- **Demo card enriched**: the published storybook card `/c/479ee7c5…` now shows
  all three media types (2 text + 1 video + 1 photo). Media generated via
  Higgsfield, seeded through the edge-function+`pg_net` bridge.

## TODO backlog (check off + delete when done)

**Engineering**
- [ ] Wire the HyperFrames keepsake-film render: set `RENDER_BACKEND=hyperframes`,
      supply `HEYGEN_HYPERFRAMES` key, validate the cloud contract in
      `card-render`, add local video compositing. (Phase-6 go-live item; today the
      backend is `disabled` → clean upsell, no charge.)
- [ ] Guest-side Pro watermark: a Pro org's *free-package* event still watermarks
      for guests (they can't see `subscriptions` under RLS). Denormalize the org
      Pro flag onto `events` so guests get consistent treatment. (Phase-3 follow-up.)
- [ ] Code-split the ~2.3 MB main bundle (dynamic-import three/MediaPipe;
      `manualChunks`) — build currently warns >500 kB.
- [ ] Grow test coverage (TDD backlog): contribute flow, wall realtime reducer,
      runtime tenancy resolution (`src/events/runtime.ts`), `src/lib/host.ts`,
      CardViewer loading/missing states, Wall header overflow behavior.
- [ ] Delete the decommissioned `demo-seed-media` edge function from the Supabase
      dashboard (currently redeployed as an inert `410`; no MCP delete tool).

**Operator actions (unblock features — see DEPLOYMENT-CHECKLIST.md)**
- [ ] Stripe test keys + webhook endpoint (live checkout still unverified).
- [ ] `RESEND_API_KEY` (greeting-card email).
- [ ] `MESHY_API_KEY` / `HIGGSFIELD_API_KEY` (AI 3D / premium image; Gemini works
      day one).
- [ ] `HEYGEN_HYPERFRAMES` key (keepsake-film render).
- [ ] Google OAuth console configuration.
- [ ] `beamwall` custom domain.

## Failure Log (newest first)

After any **major** failure — a prod incident, a data leak, a broken deploy, or a
gate-breaking regression that shipped — append an entry: **what broke · root cause
· fix · guardrail added**. This is how we stop repeating mistakes.

- **2026-07-04 — CI red while local gate was green (Node drift).** The first
  test to import the Supabase client (`entitlements.test.ts`) threw on CI's Node
  20 ("no native WebSocket", from `@supabase/realtime-js`); locally it passed on
  Node 22. Fix: pinned CI to Node 22 + added the legacy build to CI. Guardrail:
  "use Node 22+" in the gate section.
- **2026-07-04 — App root clipped every tall page.** The root wrapper forced
  `h-screen … overflow-hidden`, so landing cards, tab strips and long pages were
  cut off. Fix: `min-h-[100dvh]`, immersive pages own their scroll. Guardrail:
  "don't reintroduce a global scroll lock" watchout above.
- **2026-07-04 — Cross-tenant card leak (HIGH).** `cards_public_read` applied to
  `authenticated` with no role clause → any logged-in user could read every org's
  `contribute_token` + `recipient_email`. Fix: migration 008 scoped the policy
  `to anon` only. Guardrail: public-read policies are `to anon` only.
- **2026-07-04 — beamwall served Hope Gala.** `main` was still the pre-platform
  single-event app; all platform code was on the PR branch. Fix: merged PR #5 into
  `main`. Guardrail: legacy sites pinned to `legacy-events`; `beamwall` has no
  `VITE_EVENT`; the legacy build stays in the gate.
