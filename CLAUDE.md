# CLAUDE.md — Beamwall platform: agent onboarding & working memory

Read this first. It's the map of **where the platform is, what's next, and the
rules of the road** so any agent can pick up without re-discovering everything.
Deep detail lives in the linked docs; this file is the index + conventions +
watchouts + the maintenance protocol you must follow when you finish work.

- Product/architecture overview → [`README.md`](README.md)
- Go-live / secrets runbook → [`docs/DEPLOYMENT-CHECKLIST.md`](docs/DEPLOYMENT-CHECKLIST.md)
- Money model / packaging → [`docs/superpowers/specs/2026-07-03-saas-platform-strategy.md`](docs/superpowers/specs/2026-07-03-saas-platform-strategy.md)
- **Active workstream (platform admin suite)** → [`docs/ADMIN-SUITE.md`](docs/ADMIN-SUITE.md)

---

## What Beamwall is (one paragraph)

A self-serve, multi-tenant SaaS for AR photo booths + live photo walls + keepsake
cards. **One repo, two ships:** `main` → the **Beamwall platform** (Netlify site
`beamwall`); `legacy-events` → the 3 frozen original single-event sites
(galabooth / jennajake / theadetoyis) — don't break those. Stack: Vite · React 19
· TS · Tailwind v4 · Three.js/R3F · MediaPipe · **Supabase** (Auth + Postgres/RLS
+ Storage + Realtime + Edge Functions) · Stripe · Gemini/Meshy/Higgsfield · HeyGen.

Supabase project: **`SCAGO-HopeGala-PhotoBooth` = `zrtftliozslrjomxbfrr`** (the live
DB for both platform and legacy). Platform owner / first platform-admin:
`dapo@rethinkreality.ai`.

---

## Current state (as of 2026-07-06)

**Merged to `main`:** the multi-tenant platform (PR #5) + the go-to-market pass
(PR #9: full de-brand to Beamwall, template-driven onboarding wizard, studio
go-live checklist, transparent pricing, guest cross-page nav + Challenges page +
`liquid-glass` default look). `legacy-events` carries the refined guest
upload/frame/nav (PR #7). All green.

**Active branch:** `claude/platform-admin-suite` → **draft PR #10**. Building a
**platform super-admin suite at `/admin`** (run the whole business: every
customer, all events cross-tenant, payments, support actions) — distinct from the
per-event host studio. **Phase 1 is DONE and DEPLOYED**; Phases 2–5 pending. See
[`docs/ADMIN-SUITE.md`](docs/ADMIN-SUITE.md).

**Live Supabase state:** migrations **`001`–`009`** applied; all edge functions
deployed **including `admin-api`**; `platform_admins` seeded with the owner.
(`009` + `admin-api` were applied via the Supabase MCP this session and are also
committed to the repo — keep repo and live DB in lockstep, see conventions.)

**The one thing blocking real paying customers:** Stripe keys are **not
provisioned** → all billing returns `503 billing_not_configured` and there is
zero live purchase data. This is the #1 launch gate (see Roadmap).

---

## Repo map (the parts you'll touch)

```
src/
  App.tsx                    route tree (runtime multi-tenant vs legacy VITE_EVENT modes)
  events/                    EventContext + runtime.ts (slug → config, theming, basePath)
  lib/
    supabase.ts auth.ts      shared client + useSession() gate
    host.ts db.ts            per-org / per-event data helpers (RLS-scoped)
    admin.ts                 admin-api client + checkIsPlatformAdmin() (NEW, admin suite)
    entitlements.ts          tier → features (client mirror of the server gates)
    cn.ts adminFormat.ts     shared helpers (NEW)
  pages/
    host/                    /host studio (HostLayout, EventsList, NewEvent, Billing, EventStudio)
    admin/                   /admin platform suite (AdminLayout, Overview…)  (NEW)
    auth/ cards/ manager/    login/signup, greeting cards, day-of console
  components/
    admin/                   per-EVENT studio screens (Dashboard, Moderation, …) — NOT the platform admin
    ui/                      shared UI (StatusPill + statusPill.ts, GuestNav, …)
    booth/ ar/ wall/ upload/ guest experience
supabase/
  migrations/                001–009 checked-in DDL (mirror the live DB)
  functions/                 edge functions; each has its own deno.json import map
  tests/rls-probes.sql       manual tenant-isolation probes
docs/                        README-linked docs (deployment, strategy, admin suite, audits)
```

---

## Roadmap to real customers (ordered)

1. **Finish the platform admin suite (Phases 2–5)** — in progress on PR #10. The
   operational cockpit to run the business. Full plan + per-phase tasks in
   [`docs/ADMIN-SUITE.md`](docs/ADMIN-SUITE.md).
2. **Provision Stripe (the money gate)** — `STRIPE_SECRET_KEY` +
   `STRIPE_WEBHOOK_SECRET` + the webhook endpoint. Until then nobody can pay.
   Steps in [`docs/DEPLOYMENT-CHECKLIST.md`](docs/DEPLOYMENT-CHECKLIST.md) §3.
   Admin-suite **Phase 3** adds an `orders` table + `invoice.payment_succeeded`
   so revenue is actually recorded once keys are live.
3. **Kill the default-event redirect leak** — bare runtime paths (`/booth`,
   `/wall`, …) still redirect to `/e/hope-gala` (`VITE_DEFAULT_EVENT` fallback in
   `src/App.tsx`). Point it at a neutral demo event or redirect to the Landing
   before driving traffic.
4. **In-app password reset** — there is no "forgot password" screen today
   (`src/pages/auth/*`). Admin-suite **Phase 4** adds admin-mediated reset
   (`generateLink`); a self-serve guest reset is still a gap.
5. **Remaining go-live keys** — AI (Gemini/Meshy), Resend email, HeyGen film,
   custom domain. All optional/degrade-gracefully; see the checklist.

---

## Conventions (follow these — they're load-bearing)

**Git / PRs.** Work on a `claude/<topic>` branch off latest `origin/main` (never
push straight to `main`/`legacy-events`). Open a **draft PR** and keep CI green.
End commit messages with the `Co-Authored-By` + `Claude-Session` trailers used on
existing commits. Do **not** put model identifiers or session URLs in code, docs,
or PR bodies. A merged PR is done — start follow-up work as a fresh branch off
`main`.

**Migrations.** Sequential `NNN_name.sql` in `supabase/migrations/`, idempotent
(`if not exists`, `create or replace`, `drop policy if exists`). SECURITY DEFINER
helpers use `set search_path = public` and `revoke … from public, anon,
authenticated` (grant back to `service_role` for functions the edge layer calls
via rpc). **The live DB and the repo must stay in lockstep:** if you apply a
migration via the Supabase MCP `apply_migration`, also commit the identical
`.sql` file (and vice-versa). Tenant RLS is sacred — don't loosen it; add
cross-tenant access through the service-role edge layer instead.

**Edge functions.** Each function dir needs its own `deno.json` (import map:
`@supabase/supabase-js` → `npm:@supabase/supabase-js@2`) — a missing one breaks
deploy. Auth pattern: user-scoped anon client (forwarded `Authorization`) →
`auth.getUser()` → then a service-role client for privileged work; trust the JWT
sub, never body fields. `admin-api` additionally asserts `platform_admins`
membership **before** the action switch.

**Tests.** `vitest`, `npm test` (= `vitest run`), typecheck `npm run lint` (=
`tsc --noEmit`), build `npm run build`. Env is **`node`**, glob is
**`src/**/*.test.ts` (NOT `.tsx`)** — pure-logic tests only, no React rendering.
Keep real logic in plain `.ts` modules with colocated `.test.ts`. ⚠️ **Before
running tests, ensure there is no `.env.local` setting `VITE_EVENT`** — it flips
the app into legacy mode and breaks `catalog.test.ts` (which is pinned to the
platform catalog). `.env*` is gitignored.

**UI/theming.** Platform surfaces (`/`, `/login`, `/host`, `/admin`) render
**outside** `EventProvider`, so they use the **semantic, theme-aware** utilities
(`app-bg`, `glass`/`glass-strong`/`liquid-glass`, `text-foil-static`,
`text-brand-fg/muted`, `text-accent`, `--color-accent`/`--accent-rgb`) — not the
hardcoded-gold ones. Default premium look = `liquid-glass`.

**Data-key gotcha.** `event_plans.event_id` = `events.id` (**UUID**);
`posts.event_id` / `cards.event_id` / `app_settings.event_id` = `events.slug`
(**text**). Cross-tenant joins that use the wrong key silently return empty.

---

## Watchouts (the sharp edges that have bitten us)

- **Stripe unprovisioned** → billing 503, no revenue data. #1 gate.
- **Default-event redirect** leaks bare paths to `/e/hope-gala`.
- **No self-serve password reset** UI exists yet.
- **User management = ban, never delete** (`ban_duration`): deleting a user
  cascades `profiles`/`org_members` and nulls `orgs.owner_id`, orphaning the org.
- **Password-recovery links are session-granting secrets** — never log, store, or
  put them in `admin_audit.meta`.
- **Admin authz is server-side.** `checkIsPlatformAdmin()` on the client is UX
  only (self-scoped read); the real gate is the `is_platform_admin` assert inside
  `admin-api`, before dispatch.
- **CI does not test the backend.** GitHub Actions runs tsc/vitest/build on the
  Vite app only — Deno functions and SQL migrations are never exercised by CI.
  Verify those by careful review + (if you can) applying to the DB and reading back.
- **Sandbox limits (this environment).** Outbound HTTPS from the build container
  to `*.supabase.co` is **blocked by network policy** (can't curl the functions
  directly — use the Supabase MCP, or verify from a browser). Some approval-gated
  tools have been flaky (`deploy_edge_function` needed retries; `send_later`,
  `AskUserQuestion`, `ExitPlanMode` sometimes fail on a closed permission stream).
- **Legacy sites build from `legacy-events`** and read the same DB via grandfather
  RLS — don't change their behavior from platform work.

---

## When you finish a task, UPDATE THESE (maintenance protocol)

Leave the map accurate for the next agent:

1. **This file (`CLAUDE.md`)** — bump *Current state* (branch/PR, migrations
   applied, functions deployed), move finished items out of *Roadmap*, and add any
   new *Watchout* you discovered.
2. **[`docs/ADMIN-SUITE.md`](docs/ADMIN-SUITE.md)** — flip the phase's status to
   done, and record the new `admin-api` actions + screens you shipped.
3. **Code registries that must grow per phase:**
   - `src/pages/admin/AdminLayout.tsx` → set the nav item's `ready: true` and add
     its `<Route>` in `src/App.tsx`.
   - `supabase/functions/admin-api/index.ts` → the action `switch`; keep the
     `is_platform_admin` assert before it, and `admin_audit` every mutation.
4. **Migrations** — new file `NNN_*.sql`, applied to the live DB **and** committed
   (repo ↔ DB lockstep). Update the migration range wherever it's cited
   (`README.md`, `docs/DEPLOYMENT-CHECKLIST.md`).
5. **[`README.md`](README.md) / [`docs/DEPLOYMENT-CHECKLIST.md`](docs/DEPLOYMENT-CHECKLIST.md)**
   — when you add tables, functions, routes, or new go-live secrets.
6. **PR** — keep the body + test count current; ensure `npm run lint && npm test
   && npm run build` are green before every push.
