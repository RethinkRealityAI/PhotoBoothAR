# STATE

## Goal
Refine AR tracking + booth UX smoothness, and add an AI agent (concierge) that designs whole events conversationally in the onboarding wizard.

## Now
Live-fix batch from user testing (gated 2026-07-08: lint clean · 139/139 tests · build ✓): CopilotPanel rewritten side-drawer → floating bottom-right liquid-glass popup (no gray backdrop) + dark-themed event select; CopilotChat quick-action pills (Stats/Share links/New challenge/New card, no AI round-trip); ai-event-designer copilot schema switched to actionsJson STRING (see Facts). Redeploying the fn + committing/pushing to PR #13.

## Next
1. HUMAN E2E (5 min, deploy-preview-13--beamwall.netlify.app, admin login): copilot popup (FAB bottom-right) → ask "add a scavenger hunt challenge worth 20 points" → confirm card → row in Challenges tab; Frame Studio generate (billing now enabled — direct gemini-2.5-flash-image curl returned 200+PNG); concierge chat → accent swatch → create. Sandbox cannot do this (*.supabase.co blocked).
2. Concierge v3 remainder: draggable frame placement (edit experience transform in FrameStudio preview); post-create event-aware chat handoff (tools: challenges CRUD, event queries; widgets FramePreview/ChallengeList/EventStat per AGENT-ROADMAP).
3. Admin Limits console = admin-suite Phase 4 (`set_event_tier`, `adjust_credits` admin-api actions + Limits screen, audited).
4. Admin-suite Phases 2-5 on branch claude/platform-admin-suite (PR #10).
5. Platform gates (docs/guardrails/PROJECT.md#roadmap): Stripe keys (#1), default-event redirect leak, self-serve password reset.
6. After deploy: rotate GEMINI_API_KEY + restrict it to the Generative Language API.
7. Merge PR #13 when reviewed; then PR #10 workstream.

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
- GEMINI TRAP (verified live 2026-07-07 by direct curl bisection): any ARRAY-of-OBJECT in gemini-2.5-flash responseSchema makes constrained decoding HANG → edge fn times out as 502. Encode arrays as a JSON STRING field (copilot uses actionsJson) and JSON.parse server-side; {reply, actionsJson} answers in ~2s.
- gemini-2.5-flash-image works post-billing (direct curl 200 + PNG, ~5s) — earlier frame-gen 502s were the pre-billing quota (now surfaced as ai_quota/503).
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
- Platform Copilot — RESULT: shipped in commit 2756650 (FAB+panel across /host/**, ai-event-designer v5 copilot mode, 6 tools, A2UI confirm cards, 139 tests).
- Copilot 502 diagnosis — RESULT: bisected via direct Gemini curl; ARRAY-of-OBJECT responseSchema hangs, actionsJson STRING answers in ~2s and emitted a correct add_challenge proposal.

## Open items
- Stripe/AI keys unprovisioned (platform gate, out of scope).
- AUDIT items FIXED 2026-07-07 (all verified by lint+125 tests): (1) reviewAndCreate reads latest card plan via confirmPlan; (2) FaceRig visibleRef null-init reports first frame, Booth reset effect removed; (3) applyPlan honors DesignResult.decided flags; (4) extractName regexes fixed (+4 regression tests); (5) localOnly nudges filtered from agent history; (6) confirmPlan runs slugClientError; (7) A2uiSurface memoized. STILL OPEN (accepted/deferred): edge fn TEMPLATES duplication, 3rd FunctionsHttpError decode copy, inputClass drift — see docs/AGENT-ROADMAP.md Phase 3.
- No rate limit on ai-event-designer (free JWT-gated Gemini calls once key set) — roadmap Phase 3.

## Failed attempts
(none)
