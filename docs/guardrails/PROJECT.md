# PROJECT.md — Beamwall specifics

Project-authored archive (exempt from `_FORMAT.md` doc-shape rules). Detail behind the
CLAUDE.md `## Project` pointers. See also: `README.md` (architecture / routes / tables),
`docs/ADMIN-SUITE.md` (the active admin workstream), `docs/DEPLOYMENT-CHECKLIST.md`
(go-live secrets runbook), `docs/superpowers/specs/2026-07-03-saas-platform-strategy.md`
(money model).

## Roadmap

Ordered path to real paying customers:
1. ~~**Finish the platform admin suite (Phases 2–5)**~~ — done: all five phases built,
   deployed, and pending merge/review (PR #11); detail in `docs/ADMIN-SUITE.md`. The
   cockpit to run the business.
2. **Provision Stripe (the money gate)** — `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
   + the webhook endpoint (`DEPLOYMENT-CHECKLIST.md` §3). Until then nobody can pay and
   there is zero revenue data. The `orders` table + `invoice.payment_succeeded` handler
   (admin Phase 3) are already live, so revenue starts recording the moment keys are set.
3. ~~**Kill the default-event redirect leak**~~ — done: bare runtime paths (`/booth`,
   `/wall`, …) now redirect to `/e/demo` (the neutral Demo Sandbox org's event), not a
   real customer's live gala. `VITE_DEFAULT_EVENT` still overrides if ever needed.
4. **In-app password reset** — there is no self-serve "forgot password" screen
   (`src/pages/auth/*`). Admin-mediated reset (`generateLink`, admin Phase 4) is live for
   platform admins; a guest self-serve reset is still a gap.
5. **Remaining go-live keys** — AI (Gemini/Meshy), Resend email, HeyGen film, custom
   domain (all optional / degrade gracefully; `DEPLOYMENT-CHECKLIST.md` §2,4,5,6).

## Watchouts

- Stripe unprovisioned -> billing 503, no revenue data. #1 launch gate.
- No self-serve password-reset UI exists yet.
- User management = **ban, never delete** (`ban_duration`): deleting a user cascades
  `profiles`/`org_members` and nulls `orgs.owner_id`, orphaning the org.
- Password-recovery links are session-granting secrets — never log, store, or put them in
  `admin_audit.meta`.
- Admin authz is server-side: `checkIsPlatformAdmin()` on the client is UX-only
  (self-scoped read); the real gate is the `is_platform_admin` assert inside `admin-api`,
  before dispatch. Trust the JWT sub, never body ids.
- CI does not test the backend: GitHub Actions runs tsc/vitest/build on the Vite app only
  — Deno edge functions and SQL migrations are never exercised by CI. Verify those via the
  Supabase MCP (`apply_migration`, `execute_sql` read-backs) + a browser login.
- Sandbox limits (cloud build env): outbound HTTPS to `*.supabase.co` is blocked by
  network policy (can't curl the functions — use the Supabase MCP or a browser). Some
  approval-gated tools have been flaky (`deploy_edge_function` needed retries;
  `send_later`/`AskUserQuestion`/`ExitPlanMode` sometimes fail on a closed permission stream).
- Legacy sites build from `legacy-events` and read the same DB via grandfather RLS — don't
  change their behavior from platform work.

## Finishing a task

Leave the map accurate for the next agent. When you finish a unit of work, update:
1. `CLAUDE.md` `## Project` — bump the *Current state* line (branch/PR, migrations applied,
   functions deployed) and add any new one-line constraint or pointer.
2. `docs/ADMIN-SUITE.md` — flip the phase's status to done; record the new `admin-api`
   actions + screens shipped.
3. Code registries that grow per admin phase: `src/pages/admin/AdminLayout.tsx` (`NAV`
   item `ready: true`) + the matching `<Route>` in `src/App.tsx`;
   `supabase/functions/admin-api/index.ts` (action `switch` — keep the `is_platform_admin`
   assert before it, `admin_audit` every mutation).
4. Migrations: new `supabase/migrations/NNN_*.sql`, applied to the live DB **and** committed
   (repo↔DB lockstep); update the migration range cited in `README.md` +
   `docs/DEPLOYMENT-CHECKLIST.md`.
5. `README.md` / `docs/DEPLOYMENT-CHECKLIST.md` — when you add tables, functions, routes, or
   new go-live secrets.
6. Keep `npm run lint && npm test && npm run build` green before every push.
