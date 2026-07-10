# STATE

## Goal
Refine AR tracking + booth UX smoothness, and add an AI agent (concierge) that designs whole events conversationally in the onboarding wizard.

## Now
Pre-merge-to-main polish batch (2026-07-08, screenshot-verified): NEW /host/concierge workspace (event cards w/ inline rename+status left, inline CopilotChat right; rail item → page, FAB hidden there); popup TRUE FIX — `.liquid-glass` (unlayered CSS) sets position:relative which beats Tailwind's layered `fixed` utility, so the popup was never viewport-anchored → inline style position:fixed + 88% solid bg (readable); copilot arg-extraction prompt (short titles, details→description, clarify-when-ambiguous, worked example) + client splitLongTitle salvage; NEW add_challenge_pack tool (3-6 themed challenges, one confirm card, 🎁 pill) — edge fn v9 DEPLOYED; Creator2D borders now drag/scale/rotate like stickers (generated non-9:16 frames letterboxed with no controls). Gates: lint clean · 141 tests · build ✓ · legacy build ✓. NEXT: merge PR #13 → main, then #11, evaluate #6.

## Next
1. **USER ACTION — the real unblock**: set a VALID GEMINI_API_KEY in Supabase secrets (dashboard → Edge Functions → Secrets, or `supabase secrets set GEMINI_API_KEY=<key> --project-ref zrtftliozslrjomxbfrr`), no wrapping quotes. The v7 trim salvages a quote/whitespace-corrupted key automatically; a genuinely rotated/wrong key must be replaced. Then retest copilot + Frame Studio on the preview. Sandbox cannot set secrets or reach *.supabase.co.
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
- User (2026-07-10, InteractiveShowcase): "While I like the frame, the UI of the camera, everything, and also maintaining our colors" — keep the current in-camera UI idiom, frame, and brand colors; amplify, don't replace.
- User (2026-07-10): "sticking to the general premise of what the below mini PRD for this component is" — PRD (idle|camera|beaming|wall, phone collapse, beam, polaroid drop, capture-again) is the base contract.
- User (2026-07-10): "you can push once you have verified the changes and the UI/UX looks good and the animation and everything works beautifully." — push IS authorized, but only after verification (lint/test/build + visual walkthrough of the full demo flow).

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
- GEMINI TRAP (2026-07-07): ARRAY-of-OBJECT in gemini-2.5-flash responseSchema can hang constrained decoding; copilot encodes actions as an actionsJson STRING and JSON.parse-es server-side. NOTE (2026-07-08): this was NOT the cause of the current 502s — see next line.
- AI-OUTAGE ROOT CAUSE (2026-07-08, verified): edge-function logs show every ai-event-designer/ai-generate-image 502 fires in <1.1s (v4 874ms, v5 825ms, v6 1082ms) — too fast to be a decode hang. A direct POST to gemini-2.5-flash with a bad key returns 400 {reason: API_KEY_INVALID} in 0.53s, matching exactly. So callGemini hits !res.ok fast → generation_failed → 502. Fix: v7 of both fns trims/strips-quotes the key + maps 400 API_KEY_INVALID / 401 / 403 → ai_key_invalid (503). REMAINING BLOCKER: the secret's key VALUE must be valid — a user/dashboard action (no MCP secrets tool; *.supabase.co blocked from sandbox). Sandbox env GOOGLE_API_KEY is a DIFFERENT (Firebase) key, not the Gemini secret.
- gemini-2.5-flash-image works post-billing (direct curl 200 + PNG, ~5s) — earlier frame-gen 502s were the pre-billing quota (now surfaced as ai_quota/503).
- BASELINE (2026-07-10, InteractiveShowcase task): npm run lint clean; npm test 163 passed (22 files). node_modules installed with `npm install --ignore-scripts` (onnxruntime-node postinstall binary download is proxy-blocked; not needed for lint/test/build).
- DemoBooth.tsx map (822L): DEMO_FRAME_SVGS 35-74 · FRAMES/FILTERS/PROPS 80-100 · BeamFlightFx (WAAPI flight+ring+sparks, StrictMode-safe timers) 129-273 · Orb/OrbThumb 277-336 · component 340+ (capture 383, measureFlight 400, beamToWall+reduced-motion policy 414-429, charge effect 433-485, wall grid 787).
- Landing.tsx map (712L): FEATURES 67-134 · FilmEmbed 196 · GSAP scroll choreography (data-reveal/-stagger/-parallax, own scroller) 355-444 · demo booth section 660-683 (lazy DemoBooth at 43).
- StageCanvas: FIXED 720×1280 preview buffer + object-cover (57-58, 333, 388), capture path 1080 — canvas buffer immune to CSS-transform measurement trap (research: getBoundingClientRect lies inside transformed ancestors; keep phone at scale 1/rotate 0 while camera live anyway for Overlay3D).

## Done
- PR #12 merge (2026-07-08) — RESULT: beam-identity redesign (branch claude/beam-wall-redesign-fb8r0p, 21 commits: black/beam theme tokens, Landing rebuild, demo booth, HyperFrames video suite, EventProvider de-theming, gsap dep) merged into PR #13. 3 conflicts resolved (STATE.md ours; index.css their token-based ::selection + our print block; NewEvent our concierge structure + their liquid-glass). Session AI surfaces rethemed to their convention: text-white on bg-foil, liquid-glass, brand-muted/accent-2, QR pads bg-brand-fg (CopilotFab/Panel/Chat, A2uiSurface, NewEvent, FrameStudio, ShareKit); copilot select options → brand-surface/brand-fg.
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
- AI outage re-diagnosis (2026-07-08) — RESULT: real cause is a REJECTED GEMINI_API_KEY secret (fast 400 → 502), not the schema. Both fns v7 harden the key (trim/quote-strip) + report ai_key_invalid; copilot message + UI (mobile popup, concierge viewport) fixed. Lint clean · 139 tests · build ✓. Live unblock = user sets a valid key.

## Open items
- Stripe/AI keys unprovisioned (platform gate, out of scope).
- AUDIT items FIXED 2026-07-07 (all verified by lint+125 tests): (1) reviewAndCreate reads latest card plan via confirmPlan; (2) FaceRig visibleRef null-init reports first frame, Booth reset effect removed; (3) applyPlan honors DesignResult.decided flags; (4) extractName regexes fixed (+4 regression tests); (5) localOnly nudges filtered from agent history; (6) confirmPlan runs slugClientError; (7) A2uiSurface memoized. STILL OPEN (accepted/deferred): edge fn TEMPLATES duplication, 3rd FunctionsHttpError decode copy, inputClass drift — see docs/AGENT-ROADMAP.md Phase 3.
- No rate limit on ai-event-designer (free JWT-gated Gemini calls once key set) — roadmap Phase 3.

## Failed attempts
- ATTEMPT 1 [L1] (env, npm install): plain `npm install` → `read ECONNRESET` during reify/postinstall.
- ATTEMPT 2 [L1]: immediate retry → same ECONNRESET, log pins it at `postinstall:node_modules/onnxruntime-node` (external binary CDN reset by proxy; registry fetches fine).
