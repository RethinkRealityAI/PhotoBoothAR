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
2. **Provision Stripe (the money gate)** — SANDBOX `STRIPE_SECRET_KEY` +
   `STRIPE_WEBHOOK_SECRET` + webhook endpoint are set and validated end-to-end (real
   test-mode `credit_pack` checkout -> webhook -> `credit_ledger`/`orders` all confirmed,
   2026-07-06). Still open: test `event_package`/`pro_subscription` the same way, then
   swap to LIVE keys (new webhook endpoint + signing secret, `DEPLOYMENT-CHECKLIST.md`
   §3) before real customers — until the LIVE swap, nobody can actually pay.
3. ~~**Kill the default-event redirect leak**~~ — done: bare runtime paths (`/booth`,
   `/wall`, …) now redirect to `/e/demo` (the neutral Demo Sandbox org's event), not a
   real customer's live gala. `VITE_DEFAULT_EVENT` still overrides if ever needed.
4. ~~**In-app password reset**~~ — done (PR #17): self-serve `/forgot-password` +
   `/reset-password` (`src/pages/auth/ForgotPassword.tsx` / `ResetPassword.tsx`), plus the
   admin-mediated reset (`generateLink`, admin Phase 4) for platform admins.
5. **Remaining go-live keys** — AI (Gemini/Meshy), Resend email, HeyGen film, custom
   domain (all optional / degrade gracefully; `DEPLOYMENT-CHECKLIST.md` §2,4,5,6).

## Backlog

Low-severity hardening items a full security sweep (2026-07-06, reviewing the admin-suite
PR + this session's own fixes) surfaced. None are cross-tenant/critical — the sweep found
no other instance of the `fetchMyEvents`-class bug anywhere, no IDOR, no mass-assignment,
no SQL injection. Worth picking up opportunistically, not blocking launch:
- `manager-api` never reads/enforces `event_access_tokens.role` — every valid token grants
  identical full access regardless of role. Not yet exploitable (only `role:'manager'` is
  ever minted, `src/lib/host.ts`), but latent if a lower-trust role is ever added.
- No cap on `event_access_tokens` rows per event, or on draft `events` rows per
  user/org — either could be spammed by an authenticated caller (resource exhaustion, not
  data exposure).
- `admin-api`'s `remove_admin` has a narrow TOCTOU: exactly 2 admins removing each other
  simultaneously could both pass the "can't remove the last admin" count check, dropping
  the roster to 0 (permanent admin lockout — migration `009`'s seed only fires on
  user-creation, not on an already-empty table).
- `fetchMyOrg()` (`src/lib/host.ts`) is still hard-coded single-org (`.limit(1)`) while
  `fetchMyEvents()` is now correctly multi-org-aware — a host in 2+ orgs would see a
  combined events grid but billing/credits for only one, arbitrarily-picked org.
- Minor modulo bias in `randomToken()`'s byte->alphabet mapping (`src/lib/host.ts`) —
  negligible at the current `TOKEN_LENGTH` (24), would compound if ever shortened.

## Watchouts

- Stripe is SANDBOX-only (validated for `credit_pack`; `event_package`/`pro_subscription`
  untested). LIVE keys still needed before real customers can pay — #1 launch gate.
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
