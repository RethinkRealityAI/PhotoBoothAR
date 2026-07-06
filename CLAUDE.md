<!-- guardrails-kit: v1.0 migrated 2026-07-06 -->
<!-- BEGIN KIT CORE v1.0 -->
<!-- Editing this file? Read docs/guardrails/_FORMAT.md first. Never paraphrase kit text. -->
These rules compensate for known model failure modes. They are procedures, not advice — follow them literally.

## Routing — the moment X happens, your next tool call is Read on the doc
| The moment you... | Read |
|---|---|
| realize — at start or mid-task — the task needs >2 file edits or edits in >1 top-level directory, or are about to Edit a 3rd file with no TASK block posted | docs/guardrails/PLAN.md |
| are about to create or modify a repo file — by Edit, Write, or a shell command that writes files — for the first time since session start or the last compaction | docs/guardrails/CODE.md |
| see a test you expected to pass fail, a build/test/run command exit non-zero, a traceback, run output that contradicts your prediction, or a user-reported bug you have not reproduced this session | docs/guardrails/DEBUG.md |
| are about to write "done", "fixed", "works", "passing", "complete", "resolved", or "ready", or to run git commit / gh pr create | docs/guardrails/VERIFY.md |
| are about to Read a 3rd file over 300 lines, or a search returned >50 hits | docs/guardrails/EFFICIENCY.md |
| return from compaction or /resume, the user pauses the work ("stop", "later", "tomorrow"), or a task with a TASK block has no docs/STATE.md | docs/guardrails/SESSION.md |
| no row above matches but the work feels risky | docs/guardrails/PLAN.md |

Row matched: write `TRIGGER: <event> -> <doc>`; your next tool call is Read on that doc, in the same message, with no acting tool call beside it (other triggered Reads may batch with it). 2+ rows match at once? Write one TRIGGER line per row and Read each matched doc, in table order, before any other tool call. Already Read the doc since the last compaction? Write `TRIGGER: <event> -> <doc> (cached: <its checklist IDs, from memory>)` and obey those items — cannot list the IDs without looking? It is not cached: Read the doc. A TRIGGER line whose next tool call is not that Read is itself a violation.

## Iron rules
- Before your first Edit of a file: Read the enclosing function/class plus the import block — a Grep snippet is not a Read; under 250 lines, Read it all (guessed edits patch the wrong code).
- Modify existing files with Edit, never Write — sole exception: the rewrite procedure in docs/guardrails/CODE.md; if Edit fails twice, re-Read the region and retry Edit (memory rewrites delete real code).
- After changing any signature, symbol name, return shape, config key, route, CLI flag, env var, or enum member: run REFERENCE SWEEP per docs/guardrails/CODE.md (missed callers break silently).
- Before calling an unfamiliar or third-party API with 2+ arguments: paste its real signature per docs/guardrails/CODE.md C5 (plausible is not real).
- Claim done/fixed/works/passing/complete/resolved/ready only beside fresh command output in the same turn; otherwise report `EDITED-UNVERIFIED: <file>` (unrun code is unknown code).
- Never write "should work", "should fix", "likely resolves", or "ought to now" — only the two legal forms in docs/guardrails/VERIFY.md: `Verified: <command> -> <result line>` / `UNVERIFIED — to confirm, run: <command>` (hedges hide skipped runs).
- Treat the user's stated bug location or cause as a hypothesis; trace evidence to file:line before editing there (wrong premise wastes the fix).
- Change only lines the task requires; log other findings as `NOTED (not done): <thing> <file:line>` (drive-by edits are unreviewed bugs).
- Never truthiness-check a value that can be 0, "", or false — compare to null/undefined/None explicitly; JS defaults use ?? (zero is data).
- About to write "probably / presumably / likely / I assume / should be" about this repo's code: run the Grep or Read that answers it instead (a guess costs 10x the lookup).
- The turn the user states "don't / only / keep / stop": append it verbatim to docs/STATE.md `## Constraints` — file missing? Create it per docs/guardrails/SESSION.md S2 (unwritten constraints decay within 50 turns).
- Batch independent tool calls into one message; between calls write at most one line, findings and decisions only — details: docs/guardrails/EFFICIENCY.md E5/E6 (narration buries findings).
<!-- END KIT CORE -->

## Project
<!-- Project-specific commands, ports, paths, and constraints go below this line. Cap: 40 lines. -->
Beamwall — self-serve multi-tenant AR photo-booth + live-wall + keepsake-card SaaS. One repo, two ships: `main` -> the platform (Netlify site `beamwall`); `legacy-events` -> 3 frozen single-event sites (galabooth/jennajake/theadetoyis) — never break them.
Stack: Vite · React 19 · TS · Tailwind v4 · Three.js/R3F · MediaPipe · Supabase (Auth + Postgres/RLS + Storage + Edge Functions) · Stripe.
Supabase project ref: `zrtftliozslrjomxbfrr`. Platform owner / first platform-admin: `dapo@rethinkreality.ai` (no separate admin password — `/admin` = normal Supabase login + `platform_admins` membership).

Commands: dev `npm run dev` (http://localhost:5180) · typecheck `npm run lint` (= `tsc --noEmit`) · test `npm test` (= `vitest run`) · build `npm run build`.

Current state (2026-07-06): PR #10 merged to `main` (platform super-admin suite Phase 1). Active: branch `claude/beamwall-admin-suite-5muz8t` building the admin suite — Phases 2-3 (Customers/Events, Payments+`orders` table, `admin-api` v3) done and deployed; Phases 4-5 remain. Live Supabase: migrations `001`-`010` + edge fns `admin-api`/`stripe-webhook` deployed; `platform_admins` seeded. Stripe keys UNPROVISIONED -> billing returns 503 = the #1 gate before real customers.

Before `npm test`: no `.env.local` may set `VITE_EVENT` — it flips the app to legacy mode and breaks `src/lib/catalog.test.ts` (`.env*` is gitignored).
Tests run in vitest `node` env, glob `src/**/*.test.ts` ONLY (never `.tsx`) — pure logic, no React render (jsdom/RTL not installed); keep real logic in plain `.ts` + colocated `.test.ts`.
Migrations: sequential `supabase/migrations/NNN_*.sql`, idempotent, SECURITY DEFINER `set search_path = public`; apply to the live DB via Supabase MCP `apply_migration` AND commit the identical `.sql` — repo and DB stay in lockstep. Never loosen tenant RLS; add cross-tenant access through the service-role edge layer.
Edge functions: every function dir needs its own `deno.json` import map (a missing one breaks deploy); `admin-api` asserts `is_platform_admin` BEFORE its action switch.
Platform surfaces (`/`, `/login`, `/host`, `/admin`) render outside `EventProvider` -> use the semantic Tailwind utilities (`app-bg`, `glass`/`glass-strong`/`liquid-glass`, `text-foil-static`, `text-brand-fg`/`text-brand-muted`, `--color-accent`) — default premium look is `liquid-glass`.
`event_id` key trap: `event_plans.event_id` = events.id (UUID); `posts`/`cards`/`app_settings.event_id` = events.slug (text) — the wrong key silently returns empty.

continuing/building the platform admin suite -> Read docs/ADMIN-SUITE.md
going live: provisioning Stripe / AI / email secrets -> Read docs/DEPLOYMENT-CHECKLIST.md
need architecture, routes, or the tables/functions list -> Read README.md
prioritizing launch work or need the full roadmap to real customers -> Read docs/guardrails/PROJECT.md#roadmap
about to touch billing, auth, migrations, deploy, or the test setup -> Read docs/guardrails/PROJECT.md#watchouts
finished a platform task and about to write done -> Read docs/guardrails/PROJECT.md#finishing-a-task

<!-- BEGIN KIT FOOTER v1.0 -->
## Hard stops
- NEVER make a failing test or check pass by weakening it — no skips, deleted tests, loosened asserts, raised tolerances, widened catch blocks, `as any` / `# type: ignore`, lint-disables -> instead: quote the failure, propose the change, wait for approval (a silenced check certifies the regression).
- NEVER run `git push` unless the user asked for a push in this conversation — quote their words beside the command -> instead: commit locally and report (publication is irreversible).
- NEVER kill processes by image name (`taskkill /IM node.exe`, `pkill node`) -> instead: find the PID via the port (`lsof -ti :PORT` | `netstat -ano | findstr :PORT`) then kill that PID (image-name kills take down your own harness).
- NEVER delete files/branches or run `git reset --hard` / `git checkout -- <file>` without pasting what will be lost -> instead: paste the exact target list and wait for the user's approval in this conversation (deletion is unrecoverable).

After compaction or /resume: routing row 6 has fired — write its TRIGGER line and Read docs/guardrails/SESSION.md (S1 runs first). Docs read before compaction no longer count as read: `(cached)` is invalid until you Read the doc again.
<!-- END KIT FOOTER -->
