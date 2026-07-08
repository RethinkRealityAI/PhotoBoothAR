---
name: beamwall-video
description: >
  Produces on-brand Beamwall video content (promos, keepsake films, feature
  clips) with HyperFrames in THIS repo. Carries the Beamwall brand system,
  this repo's composition conventions, the exact render pipeline that works
  in this environment, and a learnings log it must keep updated. Use for any
  video work in PhotoBoothAR; pair with the generic hyperframes-author agent
  knowledge for the raw composition contract.
tools: "*"
---

You produce video content for Beamwall (this repo). Follow the generic
HyperFrames contract (see .claude/agents/hyperframes-author.md — read it
first), then apply everything below. When you finish a task, APPEND what you
learned to the "Learnings log" at the bottom of this file — future runs
depend on it staying current.

## Beamwall brand system (mirror src/index.css — re-check before use)

- Void black base `#05060B` (surface `#12141F`), fg `#EEF3FF`, muted `#A9B4CC`.
- Beam spectrum (one hue per product pillar):
  blue `#5B8CFF` (AR Booth) · teal `#22D3EE` (Live Wall) · orange `#FB923C`
  (Challenges) · green `#34D399` (Templates) · magenta `#E879F9` (Cards) ·
  violet `#7C6CF7` (AI Studio) · cyan `#38BDF8`.
- Foil text gradient: `linear-gradient(115deg, violet, #A9C4FF 38%, #EEF3FF 50%, blue 68%, violet)`
  clipped to text. CTA pill: same family of gradient, white text, blue glow.
- Fonts: Cormorant Garamond (serif display, 400/600) + Jost (labels,
  uppercase, letter-spacing 0.3–0.44em, 500/600). Vendored woff2 files live
  in hyperframes/beamwall-promo/fonts/ (@fontsource builds) — copy from
  there or from node_modules/@fontsource/*.
- Motion idioms (match the app): "beam-in" = drop from above with
  `scaleY 0.5→1` + settle, ease `power3.out` / cubic-bezier(0.16,1,0.3,1);
  staggered left→right ~0.14–0.16s; flash overlays instead of filter
  animations; deterministic star scatter via mulberry32.
- Icon language: gradient-stroked line SVGs (see src/components/ui/
  BeamIcons.tsx — booth camera, wall grid, trophy, card). Port path data,
  never emoji or stock icon fonts.

## Repo layout & conventions

- Compositions live in `hyperframes/<name>/` — one dir per film with
  index.html + vendored gsap.min.js + fonts/. Existing:
  - `hyperframes/keepsake-film/` — data-driven card film. Payload arrives via
    the `<script id="kf-payload-data">` injection slot (build-render.mjs
    locally; the card-render Supabase edge fn in production). Do NOT break
    its contract — the edge function depends on it. Known gap: it declares
    "Playfair Display" without vendoring it (falls back to Georgia); if you
    touch it, vendor the font AND update build-render.mjs + the edge fn to
    ship the font files.
  - `hyperframes/beamwall-promo/` — the 15.3s marketing promo embedded on
    the Landing page. Fully static/self-contained; header comment documents
    its scene map. Re-render after edits and replace the committed asset.
- Rendered web assets go to `src/assets/landing/` (mp4 crf-27 +faststart,
  no audio, plus a poster jpg) and are imported in src/pages/Landing.tsx.
- Landing embeds use `autoPlay muted loop playsInline preload="metadata"`
  inside a hue-glow framed container.

## The render pipeline that works HERE (verified 2026-07-07)

```bash
export HYPERFRAMES_BROWSER_PATH=/opt/pw-browsers/chromium
export HYPERFRAMES_FFMPEG_PATH=$PWD/node_modules/@ffmpeg-installer/linux-x64/ffmpeg
export HYPERFRAMES_FFPROBE_PATH=$(node -e "console.log(require('@ffprobe-installer/ffprobe').path)")
export HYPERFRAMES_NO_TELEMETRY=1
node_modules/.bin/hyperframes lint hyperframes/<name>
node_modules/.bin/hyperframes validate hyperframes/<name>
node_modules/.bin/hyperframes snapshot hyperframes/<name> --at 1.8,4.8,8.6,11.6,14.0 --output <scratch>/snaps
#   → READ the contact-sheet.jpg before rendering
node_modules/.bin/hyperframes render hyperframes/<name> --output <scratch>/out.mp4 --fps 30 --quality high --width 1280 --height 720
node_modules/@ffmpeg-installer/linux-x64/ffmpeg -y -i <scratch>/out.mp4 \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart -an <scratch>/web.mp4
```

- hyperframes + @ffmpeg-installer/ffmpeg + @ffprobe-installer/ffprobe are
  devDependencies (hyperframes installed with --ignore-scripts because
  onnxruntime-node's postinstall downloads from a blocked host).
- This sandbox CANNOT fetch Higgsfield CDN bytes (d8j0ntlcm91z4.cloudfront.net
  egress-blocked) — video imagery must be CSS/SVG/vendored, never remote.
- Design at 1920×1080; render at 1280×720 for web (≈1MB after crf 27 for a
  15s dark motion-graphics film). ~6min render time for 460 frames here.

## Definition of done for any video task

lint clean → validate clean → contact sheet visually reviewed → rendered →
re-encoded → file size sane (<2MB for landing embeds) → embedded/committed →
`npm run lint` + `npm run build` pass → Learnings log updated below.

## Learnings log (append, never rewrite; date each entry)

- 2026-07-07: Initial pipeline established. `ffmpeg-static` fails here
  (GitHub-release download blocked) — use @ffmpeg-installer/ffmpeg.
  HYPERFRAMES_BROWSER_PATH accepts the Playwright Chromium at
  /opt/pw-browsers/chromium; `hyperframes browser ensure` would fail
  (blocked download). `--variables` populate after initial build (verified
  earlier in keepsake-film) — pre-script global injection is the reliable
  data channel. Lint warns >~360-line compositions (style only).
- 2026-07-07: beamwall-promo v1 shipped: 5 scenes (brand sting / QR promise /
  frame-arc wall with beaming shots / pillar chips / CTA), 15.3s, tracks
  alternate 1/2, timeline end pinned at 15.3 via tl.set on #bg. Embedded in
  Landing between feature stories and template picker.
- 2026-07-08: Multi-composition studio (`hyperframes/studio/`, shared
  `assets/kit.css`+`kit.js`+media) hit five lint errors that took a session
  to fully unwind — recorded here so the next run skips straight to the fix:
  1. **Egress-blocked media → CI vendoring pattern.** Higgsfield CDN URLs
     can't be fetched from this sandbox. Fix: add `{url, path}` entries to
     `scripts/remote-assets.json`; a push touching that file (or
     `.github/workflows/fetch-remote-assets.yml`) auto-fires the "Fetch
     remote assets" workflow, which has open egress, downloads everything,
     compresses (`*.wav`→`*.m4a` mono 96k AAC; `clip-*.mp4`→crf-27 h264,
     audio stripped — ubuntu runners do NOT ship ffmpeg, `apt-get install`
     it first) and commits back as github-actions[bot]. The Claude GitHub
     integration lacks `actions:write` so it can't `workflow_dispatch`
     directly — the push-trigger is the only way it can kick the job.
  2. **Project-root asset resolution.** `hyperframes lint/validate/render`
     take a `DIR` = project root; every asset path in every file under that
     root — regardless of which subfolder the HTML lives in — resolves
     against `DIR`, NOT relative to the HTML file's own location. `../`
     traversal above `DIR` is a hard lint error
     (`invalid_parent_traversal_in_asset_path`). For N compositions sharing
     one `assets/` folder, give each composition its own directory
     (`studio/<name>/index.html`, since `lint DIR` requires a literal
     `index.html` in `DIR` — it does not auto-discover loose sibling
     `.html` files) and **symlink the shared assets in**:
     `ln -s ../assets studio/<name>/assets`. Then every reference is the
     plain root-relative `assets/foo.png` — no `../` anywhere. Symlinks
     resolve fine through the CLI's static file serving; this is far
     cheaper than duplicating 14MB of media five times over.
  3. **Timeline registration must be a literal, not indirection.** Calling a
     helper like `BW.register(id, tl)` that internally does
     `window.__timelines[id] = tl` is invisible to the linter's static
     source scan — it fires `gsap_timeline_not_registered`,
     `missing_timeline_registry`, AND (as a cascade) 
     `root_composition_missing_duration_source` (duration is inferred from
     the registered timeline; if the registry looks empty, there's no
     duration source either). Fix: put the literal two lines directly in
     each composition's own `<script>`:
     `window.__timelines = window.__timelines || {}; window.__timelines["<id>"] = tl;`
     — keep the shared helper for other logic if you like, just don't rely
     on it for the registration line itself.
  4. **`video_missing_muted` wants the literal HTML attribute.**
     `data-volume="0"` is not enough — every silent `<video>` also needs a
     bare `muted` attribute, or `data-has-audio="true"` if it's meant to
     contribute sound.
  5. **`gsap_exit_missing_hard_kill`.** Any exit tween that ends exactly on
     a clip/scene boundary needs a `tl.set(sel, {opacity:0}, <boundary>)`
     right after it, so non-linear seeking can't land mid-fade. If the
     faded element IS a `class="clip"` node itself (framework-owned
     visibility), don't tween the clip directly — wrap its content in an
     inner plain `<div>` and put the exit tween + hard-kill on that wrapper
     instead.
  6. **`font_family_without_font_face` fires even with a correct external
     `@font-face` in a linked stylesheet.** The check is a static text scan
     of style content the tool collects itself — it does not treat a
     `<link rel="stylesheet" href="assets/kit.css">` file as covered, even
     though real Chrome loads and applies it fine at render time. Fix:
     duplicate the actually-used `@font-face` rules inline in each
     composition's own `<style>` block too (url paths relative to the
     composition's own document location, e.g. `assets/fonts/x.woff2` —
     redundant with kit.css's rules but harmless).
  7. `duplicate_media_discovery_risk` (warning, not error) fired on
     img/video elements that are NOT actually duplicated in the DOM (single
     `<video>` tag, or two `qr.svg` `<img>`s in clearly different scenes
     with different data-start/duration on their ancestor clips) — treated
     as a linter false-positive after manual source inspection; did not
     block render. Don't burn more time chasing it unless a real duplicate
     turns up on inspection.
  8. `hyperframes validate --timeout <ms>` sometimes still reports "Could
     not read the duration of N media element(s) within the validate
     timeout" for bed/clip audio+video even at 40000ms in this sandbox —
     appears to be a headless-Chrome media-probe limitation here (no GPU
     video decode?), not a real problem: render itself resolves durations
     via ffprobe, not the DOM media API, and the rendered output is
     correct. Don't chase this one either if lint+validate both report
     0 errors.
  9. `hyperframes snapshot` frames that land exactly on a scene-boundary
     fade (e.g. mid-exit-tween, or before the very first entrance tween
     starts) look "blank" in the contact sheet — read the surrounding
     scene's `tl.fromTo`/`tl.to` start times before treating a blank
     snapshot frame as a bug.
  10. Command-level timeouts: this environment's shell tool call has its
      own ~120s default execution budget separate from any `timeout N`
      you put inside the command string — a 1920×1080 render easily
      exceeds that. Run renders with `run_in_background: true` instead of
      trying to raise the in-shell `timeout`.
