# STATE

## Goal
Refine AR tracking + booth UX smoothness, and add an AI agent (concierge) that designs whole events conversationally in the onboarding wizard.

## Now
A2UI done & verified; commit. Push still permission-blocked (needs explicit user "push" in-conversation).

## Next
1. User: set GEMINI_API_KEY as a Supabase edge-function secret (dashboard → Edge Functions → Secrets) — key given in chat 2026-07-07, NEVER commit it; user will rotate post-deploy.
2. On user's word: push claude/ar-agent-ai-studio-da6d0f + open draft PR.

## Constraints
- User (2026-07-07): Gemini API key shared in chat for the platform; "i'll rotate it later once we deploy" — key must NEVER be committed to the repo; it belongs in Supabase edge-function secrets (GEMINI_API_KEY) only.
- User (2026-07-07): "Sorry by tambo, this is what I meant to use for the Generative UI framework. Implement it now https://a2ui.org/composer/" — generative UI = A2UI protocol.
- (platform) Never break legacy-events sites — faceRig/Booth are shared; keep default behavior compatible.
- (platform) No `.env.local` with VITE_EVENT during tests.
- (task) No new npm dependencies; edge fn dir needs its own deno.json; never loosen tenant RLS.

## Decisions
- DECISION: One-Euro filter in new src/lib/smoothing.ts (pure, node-testable) — faceRig.ts imports mediapipe, unsafe for vitest node env.
- DECISION: AI concierge = new edge fn `ai-event-designer` (Gemini, JWT-auth, NO credit charge) + client-side keyword fallback so the flow works while GEMINI_API_KEY is unprovisioned.
- DECISION: No Tambo/generative-UI dependency now — in-house chat panel in NewEvent.tsx; note framework option in PR body.

## Facts
- Branch: claude/ar-agent-ai-studio-da6d0f. Commands: npm run lint (tsc), npm test (vitest, src/**/*.test.ts only, node env), dev :5180.
- tsconfig excludes supabase/ — edge fns not type-checked by lint.
- Tracking core: src/lib/faceRig.ts updateHeadPose (fixed lerp 0.45/0.5/0.4 at :182-184); detection throttle 33ms, HOLD_MS 500.
- Templates: src/lib/eventTemplates.ts (EVENT_TEMPLATES, templateConfigPatch). Event create: src/lib/host.ts createEvent + updateEventConfig.
- Edge fn pattern: supabase/functions/ai-generate-image/index.ts (json(), serviceClient(), user JWT auth). Gemini text model available via GEMINI_API_KEY secret (may be unprovisioned → 503 ai_not_configured).
- BASELINE: npm run lint clean; npm test 84 passed (13 files).

## Done
- Investigation — RESULT: task block posted; no "General Studio" symbol exists (user means booth + host studio overall).
- Step 1 One-Euro smoothing — RESULT: src/lib/smoothing.ts + 9 tests green; faceRig.ts dt-aware adaptive filtering (lint clean).
- Step 2 booth face hint — RESULT: Overlay3D onFaceVisible prop + Booth "Center your face" pill (lint clean).
- Step 3 eventDesigner planner — RESULT: 16 tests green (template/name/date/remote extraction + normalizePlan).
- Step 4 edge fn — RESULT: ai-event-designer deployed v1 ACTIVE (verify_jwt on) via Supabase MCP.
- Step 5 concierge UI — RESULT: NewEvent.tsx chat mode (default) drives wizard state; lint + 109 tests + build all green.
- Docs — RESULT: README fn list, DEPLOYMENT-CHECKLIST §2, CLAUDE.md current-state updated.
- A2UI adoption — RESULT: src/lib/a2ui.ts (v0.9.1 core: JSON-Pointer model, reducer, bindings; 10 tests) + src/components/a2ui/A2uiSurface.tsx (themed basic-catalog renderer) + buildPlanSurface in eventDesigner.ts (3 tests); NewEvent chat renders interactive plan cards w/ confirm_plan action. lint clean, 122 tests, build green.
- Gemini key — RESULT: validated live (200, gemini-2.5-flash replied "ok"); cannot set Supabase secret from sandbox (no MCP secrets tool, *.supabase.co blocked).

## Open items
- Stripe/AI keys unprovisioned (platform gate, out of scope).
- AUDIT items FIXED 2026-07-07 (all verified by lint+125 tests): (1) reviewAndCreate reads latest card plan via confirmPlan; (2) FaceRig visibleRef null-init reports first frame, Booth reset effect removed; (3) applyPlan honors DesignResult.decided flags; (4) extractName regexes fixed (+4 regression tests); (5) localOnly nudges filtered from agent history; (6) confirmPlan runs slugClientError; (7) A2uiSurface memoized. STILL OPEN (accepted/deferred): edge fn TEMPLATES duplication, 3rd FunctionsHttpError decode copy, inputClass drift — see docs/AGENT-ROADMAP.md Phase 3.
- No rate limit on ai-event-designer (free JWT-gated Gemini calls once key set) — roadmap Phase 3.

## Failed attempts
(none)
