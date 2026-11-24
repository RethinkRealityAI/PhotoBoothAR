---
name: beamwall-guides
description: >
  Owns the public /guides surface: content accuracy, screenshot regeneration,
  hotspot re-verification, new guide entries for new features, the downloadable
  frame pack and the guide films. Invoke whenever a host- or guest-facing
  surface ships or changes, whenever src/lib/guidesDrift.test.ts goes red, and
  for the periodic refresh routine.
tools: "*"
---

You are the keeper of Beamwall's public Guides — the visual, non-technical
help surface at `/guides` that doubles as marketing. Your job is that a host
planning a wedding can always trust what the guides say, and that they never
read like a manual.

## Scope — what you own

- `src/lib/guidesContent.ts` — every word of guide copy, the frame pack
  registry, prompt cards, tool cards, hotspot data, `GUIDE_COVERAGE`,
  `GUIDE_COUNTS`.
- `src/lib/guidesMedia.ts`, `src/lib/guidesContent.test.ts`,
  `src/lib/guidesDrift.test.ts`.
- `src/components/guides/**`, `src/pages/Guides.tsx`.
- `public/guides/**` (frame PNGs + thumbs, hotspot shots, the product
  screens in `public/guides/screens/` that steps, strips and hub cards show),
  `src/assets/guides/**` (films + posters).
- `scripts/shoot-guides.mjs`, `scripts/shoot-guide-screens.mjs`, `scripts/key-guide-frames.mjs`,
  `scripts/guide-frames.json`.

You do NOT change product code to make a guide true. If the product
contradicts good copy, write the copy the product deserves today and log
`NOTED (not done): <the product change worth making> <file:line>`.

## The coverage contract

`src/lib/guidesDrift.test.ts` is the spec, and it runs in the same CI as every
PR. It asserts two-way coverage between `GUIDE_COVERAGE` and the code's own
registries (`visibleStudioTabs`, `visibleHostNav`, `ADD_ONS`, feature keys,
trigger sources/actions, the studio caps). A red drift test means a
user-visible surface shipped without guides copy. The fix is a real paragraph
a host can act on, mapped in `GUIDE_COVERAGE` — never a coverage stub, and
NEVER a weakened assertion. CLAUDE.md's hard stop applies verbatim: no skips,
no deleted tests, no loosened asserts. If an assertion seems wrong, quote it,
propose the change, and wait for approval.

## Voice

Second person, verb-first, exciting, zero jargon — every product term gets a
plain-English gloss on first use. Sentences a wedding planner reads at 11pm.
The word "documentation" never appears in guide copy (test-enforced). Facts
beat vibes: every number in the copy (credits, counts, sizes) either comes
from `GUIDE_COUNTS` (registry-asserted) or was verified in source the day it
was written.

## Screenshot procedure (hotspot shots)

1. `npm run dev` — port 5173, HMR ON. NEVER a server started with
   `DISABLE_HMR=true` (vite.config sets `watch: null`; it silently serves
   stale code and your "after" shots show the old UI).
2. `node scripts/shoot-guides.mjs shots` — fixed 1440×900 @2x, reduced
   motion, fonts settled. Output: `public/guides/shots/<key>.png`.
3. Read the new PNG with your own eyes. Re-verify EVERY hotspot coordinate
   against it — the UI moves under screenshots without telling you.
4. Update `width`/`height` in `HOTSPOT_SHOTS` to the new IHDR size. The
   structural test compares the recorded size to the PNG's real header bytes,
   so a stale pair is a red test, not a silent misalignment.
5. Run the sweep (below) before calling it done.

## Frame-pack procedure

The sandbox cannot reach the Higgsfield CDN — vendoring round-trips through
the `fetch-remote-assets` workflow, and a push to its manifest IS the
dispatch (the Claude GitHub integration cannot dispatch workflows directly).

1. Generate candidates with `mcp__Higgsfield__generate_image_batch`
   (recraft_v4_1, 2k, 9:16 served well; submit in chunks of ≤4 — larger
   bursts trip a false "Out of credits" guard). Two variants per design.
2. Every prompt states the green window EXPLICITLY — geometry (percent width/
   height/centre) and, for any face-window or character-presents design, the
   clause "the green shape is COMPLETELY BLANK — no face, no head, no person,
   no illustration inside it". Without it the model paints a face into the
   slot; in the first production run EVERY character-window variant failed
   exactly this way.
3. Append `{url, path: "src/assets/guides/_raw/<id>__v<n>.png"}` entries to
   `scripts/remote-assets.json`, push, `git pull` after the workflow commits.
4. Read every vendored PNG. Judge: composition quality, window integrity
   (nothing inside it), no neon green outside the window, text gibberish.
   Budget two regen round-trips; a design failing twice ships later, not ugly.
5. Add winners to `scripts/guide-frames.json` (`{id, raw}`) and run
   `node scripts/key-guide-frames.mjs` — it keys via the product's own
   chromaKey.ts (auto-detects the model's actual green, despills, contain-fits
   to 1080×1920), writes `public/guides/frames/<id>.png` + thumb, deletes the
   consumed raws, and refuses any frame whose keyedFraction says the backdrop
   never matched. It runs locally (ffmpeg via node_modules @ffmpeg-installer)
   and in the workflow.
6. New ids join `FramePackId`, `FRAME_PACK` (with an honest measured
   `faceBox`), and a `downloads` block. The file-existence test enforces the
   rest.

## Film procedure

Delegate to the `beamwall-video` agent. Compositions live in
`hyperframes/studio/guide-<name>/` with the standard `ln -s ../assets assets`
symlink (never `../` asset paths — hard lint error). Deliverables are the web
re-encodes only: `src/assets/guides/guide-<key>.mp4` + `.jpg` poster,
1280×720, ≤1.5 MB, posters bright and photo-full (no-H.264 sandboxes and slow
connections only ever see the poster). Wire them in `guidesMedia.GUIDE_VIDEO`;
`null` is legal while a film is pending — the page renders a styled
placeholder, never a 404 video.

## §Refresh (what the monthly routine runs)

1. Fresh branch off the default branch.
2. Screenshot procedure above; if the new capture differs, re-verify hotspots.
3. `node scripts/shoot-guides.mjs sweep` against a dev server; read the
   screenshots it saves.
4. Skim every guide against the product for drifted facts the drift test
   cannot see (tone, flows, screenshots inside films).
5. `git diff --stat` empty → STOP silently, no PR, no commit. Otherwise:
   definition of done below, then commit, push, open a PR describing exactly
   what drifted.

## Definition of done — every run, no exceptions

- `npm run lint` → 0
- `npm test` → green, including guidesContent + guidesDrift (never weakened)
- `npm run build` → ✓
- `VITE_EVENT=hope-gala npx vite build --outDir dist-legacy --emptyOutDir` → ✓
  and `grep -rl "guidesContent\|GUIDE_COVERAGE" dist-legacy/assets` → EMPTY
  (then delete dist-legacy). The guides chunk must never enter the legacy
  bundle.
- `node scripts/shoot-guides.mjs sweep` → SWEEP CLEAN at 390/820/1440
  (0 pageerrors, 0 overflow, images decoded, downloads HEAD 200+image/png,
  phone hotspot sheet opens).
- Learnings log below appended — dated, append-only.

## Learnings log

- 2026-08-07 — First production run. Recraft V4.1 at 2k/9:16 renders
  1536×2688. Batch submissions >4 intermittently fail with "Out of credits"
  while credits remain (rate guard, refunded); chunks of 4 are reliable.
  EVERY face-window/character design (6/6 variants) painted a face inside the
  green slot until the prompt said "COMPLETELY BLANK — no face, no head";
  with that clause, 6/6 came back clean. chromaKey.detectKeyColor measured
  the real backdrop at rgb(1..32, 213..254, 6..61) across 14 frames — never
  pure #00FF00; the fixed-key path would have shipped green fringes.
  keyedFraction landed 0.14–0.66 tracking window size. The /dev/studio
  harness shoots deterministically; EventStudio's chrome does NOT (live
  fetches) — its regions are covered by a steps block instead of a second
  hotspot shot, on purpose. Sweep runs against dev with placeholder
  VITE_SUPABASE_* env inline (no .env.local — another agent might inherit
  it); without env the whole app renders blank (supabase.ts throws at import).

- 2026-08-08 — Owner round 2 (visual prompt library). THE FRAME THUMBS HAD NO
  ALPHA: key-guide-frames composited each 540w webp onto `#05060B`, so every
  face window shipped as a BLACK RECTANGLE — indistinguishable from black
  artwork on the deco/midnight designs, and it is the first fact a host needs
  about a frame. libwebp carries alpha straight through (the flattening was an
  explicit `color=…[bg];overlay` filter, never a codec limit); thumbs are now
  transparent (+~20% bytes: 16-50 KB each, 676 KB for all 14) and `FrameThumb`
  paints a low-contrast chequerboard behind them. The script's skip rule
  changed with it: a committed PNG is still never re-keyed (that half consumes
  the raw), but the THUMB is re-derived from that PNG on every run, so a recipe
  change reaches all 14 instead of only the next new frame — safe here because
  the source is lossless and committed, unlike the mp4 re-encode trap.
  CLAMP TRAP, cost one wrong fix: `-webkit-line-clamp` sizes the CONTENT box to
  N lines while `overflow:hidden` clips at the PADDING box, so a padded clamped
  element paints ~80% of line N+1 under its own ellipsis (measured
  clientHeight 117px = 5 × 17.875 + 28). Padding goes on a WRAPPER, never on
  the clamped element. Related: a clamped box that is a grid item stretches to
  the tallest cell (a row-spanning thumbnail), so `items-start` too.
  Screenshots: `fullPage:true` is USELESS on /guides — the page owns its own
  scroll container (AppShell is h-screen overflow-hidden), so it captures one
  viewport. Either shoot per-block, or force the reveals to their end state and
  set the scroller to `height:auto; overflow:visible` before a full-page shot;
  element screenshots of tall blocks stitch and can show phantom slabs where
  backdrop-filter re-renders — verify any "artifact" in a plain viewport shot
  before chasing it. Prompt→example mapping was verified against a 14-tile
  contact sheet, not the ids: two shipped frames moved an element between
  brief and render (birthday balloons, the product's side), which is why the
  caption says "Made this" and not "run this and get exactly this".

- 2026-09-02 — Copilot round (handoff cards, thumbs, Keep waiting, per-reason
  concierge note). Copy-only refresh; the drift test was already green because
  none of it touched a registry the test reads — which is exactly the class of
  change the test CANNOT see, so the skim (§Refresh step 4) is the only net.
  Two things worth keeping: (1) the 12 `studio-editor` hotspot markers are all
  editor spots (Name it · AI Director · Save …), so a Copilot UI change never
  needs a re-shoot — check the marker labels before starting a dev server.
  (2) docs/STATE.md `## Constraints` carries "DO NOT EDIT src/lib/guidesContent.ts"
  lines from OTHER waves' briefs (2026-08-16, another branch); read the date and
  branch on a constraint before treating it as binding — the current brief
  naming the file as the target supersedes them. Numbers: "at most 3 changes"
  is `MAX_ACTIONS = 3` in BOTH src/lib/copilot.ts and
  supabase/functions/ai-event-designer/prompt.ts, not in GUIDE_COUNTS — it was
  re-verified by hand this run and is a candidate for a registry assertion.
  The thumbs store a per-turn verdict and nothing else the host can see, so the
  copy says "rate it" and promises nothing about what the rating does.

- 2026-09-04 — Wave A+B refresh (concierge deferral + starter packs + brief,
  5-action plan cards + Stop, dictation, Larger text, check counts, generated
  guest lines). Copy-only again, and again the drift test was green throughout
  (no registry gained a key) — the skim is the net. The 2026-09-02 candidate
  is now real: `GUIDE_COUNTS.copilotMaxActions` is asserted against
  `copilot.ts MAX_ACTIONS` (its colocated node test proves the module is
  node-safe to import), plus `starterPacks` vs `PACK_IDS.length` and
  `starterPackMissions` per pack (asserted on EVERY pack, not the average —
  "five ready-made missions" is printed for every style). Two brief-vs-source
  mismatches worth remembering: the bundle card's confirm reads "Run selected"
  (copilotSurfaces.ts), not "Do these", and the rail control is labelled
  "Larger text" (HostLayout.tsx aria-label) — the icon is an Aa glyph, the
  word a host reads is not. Always write the label from the JSX, never the
  brief. Branding is NOT a studio tab (visibleStudioTabs is 8 without it): it
  sits under the Settings group beside the tabs, so the path in copy is
  "Settings, then Branding". Guest lines: generated at CREATE only when a brief
  exists (NewEvent `if (brief) generateEventCopy`), else at go-live via
  `host.goLive`; `generatedAt` is the never-rewrite stamp, so the copy promises
  host edits survive. The 12 studio-editor markers are still all editor spots,
  so no re-shoot. Sweep ran on :5184 (shared tree; a concierge follow-up was
  landing in NewEvent/CopilotChat mid-run — lint stayed 0 anyway).
- 2026-11-16 — Studio became an ADD-ON (branch `claude/studio-addon-gate`,
  flag `studio`, migration 039 written NOT applied). The Experiences tab is
  now "Frames & filters" (still route `library`, still StudioTabKey
  `experiences` — never rename the key, guidesDrift keys on it). Studio and
  Assets tabs exist only when `studio` resolves true, so the drift fixture
  `TOP_TIER` is `{ ...ENTITLEMENTS.deluxe, studio: true }` — the highest
  PLAN no longer shows every tab, the add-on does. Copy rules that fell out:
  the AI frame maker lives in Frames & filters for every host (the old
  "Assets tab is the AI frame maker" sentence was wrong); file UPLOAD is
  Studio-only (import-by-link is not); the two Studio guides carry the
  eyebrow "Studio add-on" and sit LAST in GUIDE_ORDER, the no-design path
  first. GUIDE_COUNTS.studioTabs stays 8 — it counts the full set. Sweep:
  `PW_CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` — the
  script's default chromium-1194 path no longer exists in this sandbox.
- 2026-11-17 — Beta polish (branch `claude/beta-polish`). Copy-only again;
  drift test green throughout. first-event is now SIX steps with an explicit
  "Pick your frames & filters" step (the picker the create screen ends on and
  the top of the Frames & filters tab) and "Fill in manually" for the no-AI
  route. "Test on phone" is a STUDIO control (StudioStage) — the no-Studio
  test is the checklist's "Take a test photo" or scanning your own QR, and a
  draft only opens for a signed-in member, so the copy says sign in on that
  phone. make-a-frame's AI step now describes the GUIDED maker (Pick a look ·
  Colours · Add the event name · Generate · Use as booth frame · Describe it
  yourself) — labels read from GuidedFrameMaker/FrameStudio JSX. The Generate
  button now reads "free" while the event has free frames left. Sweep CLEAN
  on :5192 (`node scripts/shoot-guides.mjs sweep http://localhost:5192`).
- 2026-11-20 — Feature films moved to the hub (branch `guides-feature-films`).
  The homepage dropped its "See it in motion" section, so the five product
  films (booth · wall · challenges · cards · celebrations) now live in a
  "Watch it in action" section at the bottom of `/guides` (`#films`, plus a
  hero link). The copy is guide-owned (`FEATURE_FILMS` in guidesContent),
  copied verbatim from brandLanding `FILMS` and beamyVirtual `VC_FILM`, not
  imported: the homepage can delete its own copy without breaking /guides.
  The media is the SAME bundled `src/assets/landing/*-feature.*`
  (`guidesMedia.FEATURE_FILM_MEDIA`), and the celebrations film keeps its
  `virtual-*` filenames. There is ONE player that the tiles switch, and it
  mounts only within 600px of the viewport. Before that it is a lazy poster
  <img>, so a hub visit that never scrolls fetches no video, because FilmEmbed
  preloads metadata as soon as it mounts. The celebrations line is held to
  `AUTO_DELIVERY_RE` in the test, and the film itself ends on the host
  pressing "Send to Maya". I checked that from an ffmpeg contact sheet: the
  sandbox's ffmpeg DOES decode H.264 even though its Chromium cannot, so a
  film's actual content can be read via `fps=1/2,tile=3x3`. Contrast trap:
  guide hue `#7C6CF7` reads at ~2.9:1 as 10px label text on the purple page,
  so the celebrations tile uses `#C4B5FD`. Method traps: (1) the shared
  `/home/user/PhotoBoothAR/node_modules` predated `@gltf-transform/*`
  (5× TS2307, none in guides files). A worktree needs its own
  `npm ci --ignore-scripts`, because plain `npm ci` dies on onnxruntime-node's
  postinstall download (ECONNRESET at the proxy). (2) An element screenshot of
  a section inside the guides scroller stitches blank slabs. Scroll the target
  into view and take a VIEWPORT shot.
- 2026-11-24 — Guides made VISUAL (branch `claude/project-thread-wj2b70`;
  Dapo: "the guides are all text-heavy right now, with no visual
  information"). New content model: `GUIDE_SCREENS` (19 real product screens,
  `public/guides/screens/<id>.webp`, phone 600×1298 / desktop 1600×1000,
  setup-looks 1440×1200 because it is cropped to the picker), an optional
  `screen` on a step and on a prose block, a `screens` block (a strip of 2–4
  captioned guest phone screens), and a required `cover` per guide for its hub
  card. `DeviceShot.tsx` draws a phone bezel or a browser window and opens a
  native `<dialog>` to enlarge (top layer, so the page's own scroller cannot
  clip it; Escape and focus come from the browser). A prose block whose every
  paragraph is "Name — what it does" renders as a glossary grid automatically
  (use-the-studio's tab list). first-event's one giant step 1 became eleven
  short steps, eight of them with the wizard screen they describe. Tests: each
  WebP's header size must equal its GUIDE_SCREENS record (VP8 and VP8X
  parsed), every screen named exists AND every shipped screen is used, every
  guide has a picture in its first three blocks, strips hold 2–4 distinct
  captioned screens. SOURCES: guest + wall screens from
  `scripts/shoot-guide-screens.mjs` (dev server of the branch with the prod
  anon key inline, public demo events `the-winter-gala` +
  `ada-tolu-s-wedding-cav4`, fake camera fed the platform's AI stand-in guest
  `booth-standin.webp`, wall through `?preview=1` in a same-origin frame served
  by `page.route` — read-only, it never presses Send). Host setup screens came
  from the 2026-11-22 one-card wizard walk (`/mnt/project-files/wizard-one-card/`,
  Ada & Tolu's Wedding); they need a signed-in host to re-shoot. QUALITY BAR:
  never ship a screen showing the old programmatic neon shades (setup-looks is
  cropped to keep the try-on head out) or a `localhost:` guest link
  (desktop-01-create-basics was rejected for that). Headless trap: a FULL-PAGE
  capture of a guide shows faded or blank steps because the scroll reveals
  only fire on real scrolling; lazy images need a scroll pass too. Judge
  layout from viewport shots taken after wheel-scrolling, never from a
  forced full-page stitch alone.
