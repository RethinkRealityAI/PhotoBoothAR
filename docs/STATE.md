# STATE

## Goal
Two platform overhauls converging to main: (1) unified event studio editor — single camera, mixed 2D/3D scenes, AR occlusion + auto head-size, drag-and-drop, a conversational AI Director, Magic Triggers (PR #14); (2) InteractiveShowcase — the landing page's interactive AR demo with a cross-device phone-to-wall beam (PR #15).

## Now
IN PROGRESS (branch claude/ai-agent-experience-creator-uh8puh): AI Experience Creator — after the concierge creates an event, `/host/new` continues the SAME chat inline as an event-aware build phase (`CopilotChat mode="build"`). New copilot tools (`src/lib/copilot.ts` union + normalizeActions gate + executors): generate_frame (two-phase A2UI card: propose→generate→preview→apply, reuses ai-generate-image + frameProcessing chroma-key, single charge point + `runningGen` latch), set_filter, add_head_piece (builtin + AI-generate via concept→ai-generate-3d), set_default_experience (writes BOTH wallSettings + events.config — booth reads wall first, Booth.tsx:231), go_live, test_experience (BoothTest widget: QR on desktop / open on mobile, honest draft-vs-live copy + Go-live CTA). New A2UI widgets FramePreview + BoothTest (`A2uiSurface.tsx`); new pure modules `src/lib/copilotBooth.ts`, `src/lib/studio/copilotExperience.ts`, `src/lib/studio/frameProcessing.ts` (extracted from AiFramePanel). Edge fn `ai-event-designer` copilot prompt gained the tools (flat args; client sends live filter/head-piece catalogs). Gates: tsc 0 · 485 tests (+19 new pure tests) · build ✓. UNVERIFIED at runtime (Supabase/Gemini/camera unavailable in sandbox): live generation, apply-to-booth, go-live, edge-fn proposals — client degrades gracefully (build-mode chips drive every tool without the AI). Edge fn NOT redeployed (needs deploy for the AI to propose the new tools).

MERGED TO MAIN (2026-07-11). PR #14 (studio) and PR #15 (landing) were combined on the studio branch (merge commit db67b37 — only src/App.tsx and this doc were touched by both PRs, both resolved cleanly: App.tsx auto-merged, App.tsx additive-only overlap; STATE.md hand-compacted), gates re-verified on the combined tree (tsc 0 · 466 tests · build ✓), pushed, PR #14 marked ready-for-review and merged via GitHub (merge commit 5e94c35 on main) — PR #15 auto-closed as merged since its commits became ancestors of main. CI green on main (`CI` + `Fetch remote assets` workflows both success on 5e94c35). Local main fast-forwarded to 5e94c35.

## Next
Nothing queued. Remaining work is the live-hardware checklists below (user-driven) and the platform launch gates (valid GEMINI_API_KEY, Stripe LIVE keys). DemoBooth.tsx deletion still needs explicit user approval before doing it.

## Constraints
- User (2026-07-07): Gemini API key must NEVER be committed to the repo; Supabase edge-function secrets only.
- (platform) Never break legacy-events sites — faceRig/Booth/Overlay3D are shared; keep default behavior compatible.
- (platform) No `.env.local` with VITE_EVENT during tests.
- (task) No new npm dependencies; edge fn dir needs its own deno.json; never loosen tenant RLS.
- (plan, user-approved) Do NOT touch: StageCanvas.drawFrame semantics/Transform2D meaning, booth capture/submitPost, RLS/migrations, experiences schema (studio persistence = jsonb config + app_settings 'studio' key only).
- (task, SUPERSEDED 2026-07-11 — see last line below) Push only to claude/studio-editing-ux-improvements-xfn36m; draft PR after push.
- User (2026-07-10): "an experience doesn't have to be just 2D or 3D... It's both" — mixed scenes are the default model; content persists across 2D/3D/Preview view switches.
- User (2026-07-10, W7 verbatim): "we just have a section called My Assets and then maybe different sections: Studio Library... 3D Generated or Generated Assets... Uploaded Assets"; Director "Not overly conversational"; rejection "should have a flow for capturing the intent again for that rejected asset"; reference uploads "Use this image to generate a frame" / "Use this image to generate a 3D model".
- AskUserQuestion (2026-07-10 W7, locked): asset click = add instantly + settings expand below tile; trigger actions = ALL THREE (particle bursts, piece reveal, filter pulse); Director regen after reject = charged, clearly labeled (frame 1cr, 3D 11cr).
- User (2026-07-10, InteractiveShowcase): "While I like the frame, the UI of the camera, everything, and also maintaining our colors" — keep the current in-camera UI idiom, frame, and brand colors; amplify, don't replace. "sticking to the general premise of what the below mini PRD for this component is" (idle|camera|beaming|wall, phone collapse, beam, polaroid drop, capture-again). "Remove the old one for this new effect" — no doubled photo in flight; particles are photo-sampled PLUS a sprinkle of spectrum hues.
- User (2026-07-11, verbatim): "Pull in PR 15, merge with it, and then commit everything to main." — push to origin AND merge to main is explicitly authorized now, superseding the studio-branch-only default above.

## Decisions
- DECISION (user, 2026-07-10, W6): Scene Director folds into the Platform Copilot — one assistant, studio-aware, docked right-side panel (not modal); accepted assets dispatch into the open draft; composer cards per asset (checkerboard 2D, R3F 3D viewer, Meshy progress); scene templates; booth reveal animation.
- DECISION (user, 2026-07-10, W5): Meshy ONLY for runtime 3D gen; Gemini concept image → ai-generate-3d image mode for head pieces; frame transparency = browser-side chroma-key (no new npm deps).
- DECISION (user, 2026-07-10): MIXED SCENES — one experience = ≤1 frame + N stickers + N 3D pieces + one optional scene-level filter slot; soft cap 20 (frame exempt); kind 'composite' when mixed; single-family scenes keep today's kinds.
- DECISION: occluder from vendored MediaPipe canonical_face_model.obj (metric cm = faceRig.ts anchor space) + procedural cranium ellipsoid; colorWrite:false, renderOrder −1, raycast no-op → composites in the booth with zero StageCanvas changes.
- DECISION (W8): headScale calibration gets a live tracker-fit estimate + Apply chip storing a baseline; the booth then transfers per-guest fit by RATIO to that baseline (opt-in, zero change without a stored baseline). ReferenceBust is GLB-only — the procedural fallback head was deleted per user instruction ("make sure the old 3D one doesn't show at all").
- DECISION: hand-rolled pointer-event DnD (no dnd-kit) — portal DragGhost + setPointerCapture; pure drop math in lib/studio/dnd.ts.
- DECISION (2026-07-10, InteractiveShowcase): ShowcasePhone/CameraExperience runs the REAL booth pipeline (StageCanvas + Overlay3D), not a mock — the landing demo has full booth fidelity; BeamStrike/ParticleBeam are pure WAAPI/WebGL presentation with zero booth-state coupling; cross-device transport = Supabase Realtime broadcast (ephemeral, no auth/DB writes) with a BroadcastChannel test twin (`?beamlocal=1`, `L`-prefixed ids); DemoBooth.tsx is superseded and unreferenced but intentionally NOT deleted pending explicit user approval.

## Facts
- Branch: claude/studio-editing-ux-improvements-xfn36m (merging PR #15 in, then → main). Commands: npm run lint (tsc --noEmit) · npm test (vitest run, node env, src/**/*.test.ts only, never .tsx) · npm run build · dev :5173 (`vite --host`; CLAUDE.md's ":5180" is stale).
- tsconfig excludes supabase/ — edge fns not type-checked by lint.
- Camera hook: src/components/booth/useCameraStream.ts `useCameraStream(enabled, withAudio)`; booth video id booth-video; studio video id studio-video (ONE camera, shared across 2D/3D/Preview).
- Head space: src/lib/faceRig.ts ANCHOR_PRESETS in cm (crown y+8.3, ears ±7.7, chin −9.4, noseTip z+7.6); RIG_CAMERA origin fov 63; One-Euro filtered pose (OneEuroVec3/OneEuroQuat); live head-fit ring-buffer estimator (getHeadFitEstimate, median of ~45 samples) feeds W8 auto head-size.
- Persistence: src/lib/db.ts experiences config jsonb; getStudioSettings/setStudioSettings (app_settings key 'studio', additive {headScale, baselineFit?, autoHeadScale?}); uploadAsset→assets bucket. Deep links ?id= from Library.tsx.
- Vendoring: scripts/remote-assets.json + .github/workflows/fetch-remote-assets.yml. canonical_face_model.obj (468v, bbox verified) + public/models/reference-head.glb (Higgsfield bust, GLB-only render — see Decisions).
- Design tokens: src/index.css @theme (liquid-glass = premium standard, --accent-rgb); lucide-react + BeamIcons gradient idiom; motion/react; zustand; react-resizable-panels; ui/Tooltip.tsx (portal, delay).
- GEMINI_API_KEY secret is REJECTED by Google in prod (400 API_KEY_INVALID → app reports ai_key_invalid truthfully) — v7+ of the edge fns detect this correctly; the remaining blocker is a valid key value (user/dashboard action, no MCP secrets tool).
- GEMINI TRAP: ARRAY-of-OBJECT responseSchema hangs gemini-2.5-flash constrained decoding — encode arrays as JSON STRING fields (e.g. actionsJson, planJson patterns).
- shaders.ts: ShaderParam/ShaderDef, SHADERS, SHADER_MAP, FILTER_SHADERS, class ShaderRunner (incl. aspectCropped cover-crop fix).
- StageCanvas drawFrame steps: 1 video mirror · 2 shader coverFit · 3 three canvas drawImage · 4 overlay transform · 5 sparkles/trigger-fx (additive-optional) · 6 signature. Buffer: FIXED 720×1280 preview + object-cover, capture path 1080 — canvas buffer immune to the CSS-transform getBoundingClientRect measurement trap.
- borders.ts pure: BUILTIN_BORDERS, toDataUrl, BuiltinBorder{id,name,kind,svg}. cn() at src/lib/cn.ts.
- Edge fn pattern: supabase/functions/*/index.ts (json(), serviceClient(), user JWT auth); ai-generate-image v12, ai-event-designer v12 deployed (studio Director: reference images, reply+optional plan).
- eventTemplates.ts (EVENT_TEMPLATES, templateConfigPatch); host.ts createEvent/updateEventConfig.
- DemoBooth.tsx (822L, superseded/unreferenced — see Decisions): DEMO_FRAME_SVGS, FRAMES/FILTERS/PROPS, BeamFlightFx, Orb/OrbThumb, capture/measureFlight/beamToWall/wall grid.
- Landing.tsx: FEATURES, FilmEmbed, GSAP scroll choreography, demo section now mounts InteractiveShowcase.

## Done
- STUDIO OVERHAUL (8 waves, 2026-07-09→11, branch head b5b65eb before this merge) — RESULT: unified StudioShell (single camera, 2D/3D/Preview pure views, mixed scenes ≤1 frame+N stickers+N 3D+1 filter slot, soft cap 20), AR occlusion + live head-size calibration with auto-fit, hand-rolled DnD, undo/redo, unified My Assets panel, docked conversational AI Director (dwell-previews, reject+feedback regen, reference images), Magic Triggers (smile/mouth/wink/brow → burst/reveal/filter-pulse, live in studio AND booth), scale-gizmo + GLB auto-fit fixes, adaptive chroma-key with an honesty gate. Every wave: build agents on disjoint files → adversarial logic audit + Playwright UI/UX review → fix → gates. Final gates: tsc 0 · 444 tests · build ✓. Full wave ledger: PR #14 description / git log.
- INTERACTIVE SHOWCASE (branch claude/interactive-ar-showcase-pinf3x, 2026-07-10, 2 rounds) — RESULT: landing demo rebuilt as InteractiveShowcase (ShowcasePhone running the real booth pipeline, BeamStrike WAAPI ceremony, ParticleBeam 13.7k-point WebGL dissolve, LiveWall polaroid grid); cross-device /beam/:channelId (BeamDemoPhone, consent-first) via demoBeamTransport (Supabase Realtime broadcast + BroadcastChannel test twin); demoBeam.ts/beamGeometry.ts pure+tested. Gates: lint clean · 185 tests · build ✓ · 2-page cross-device E2E over the local transport, pageerror-free.

## Open items
- Live-hardware checklist (studio, needs camera + valid keys): transparent frame generation; Director ideation→plan→dwell-previews→Add-N; reject+feedback regen; reference image→frame/→3D; Meshy piece lands ~14cm + gizmo drags 1:1; My Assets inline settings; Magic Triggers firing bursts/reveals/pulses live AND in the captured photo; tracker-estimate Apply → booth per-guest transfer.
- Live-hardware checklist (landing): scan the `/beam/:channelId` QR on a real phone against the deploy/production URL to confirm the Supabase Realtime wire end-to-end (unverifiable from sandbox — *.supabase.co blocked).
- DemoBooth.tsx is superseded + unreferenced — NOT deleted, pending explicit user approval to delete.
- Minor deferred (studio, all logged non-blocking): gizmo can scroll off-frame on deep orbit zoom (cosmetic); triggers on a filter-only scene don't fire in the booth yet; revealedIds not reset on photo retake; Mine-tab fetch failures read as empty (pre-existing db.ts swallow); mobile top-bar buttons are icon-only; CLAUDE.md dev-port line says :5180 (real :5173).
- Platform launch gates (unchanged): valid GEMINI_API_KEY in Supabase secrets (current key rejected), Stripe LIVE keys.

## Failed attempts
- ATTEMPT 1 [L1] (env, npm install): plain `npm install` → `read ECONNRESET` during reify/postinstall.
- ATTEMPT 2 [L1]: immediate retry → same ECONNRESET, log pins it at `postinstall:node_modules/onnxruntime-node` (external binary CDN reset by proxy; registry fetches fine — use `npm install --ignore-scripts`, not needed for lint/test/build).
