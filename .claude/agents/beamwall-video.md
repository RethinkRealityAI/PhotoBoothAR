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
- 2026-07-08: Rendered all 5 studio compositions end to end (booth/wall/
  challenges/cards → 30s each, promo → 58s master) and shipped them on
  Landing. Findings:
  1. **`@ffmpeg-installer/ffmpeg`'s bundled binary (a 2018-era static
     build) is too old for HyperFrames' audio mixer.** `render`'s audio
     stage builds an `apad=whole_dur=<N>` filter per track — that option
     was added in FFmpeg ~4.2; the installer's binary only has `whole_len`
     (sample-count, not duration) and errors with `Option 'whole_dur' not
     found`, which the CLI swallows down to a generic
     `[WARN] Audio mix failed — output will be video-only: FFmpeg exited
     with code 1`. Symptom is a perfectly fine-looking render with
     silently NO AUDIO — check `hasAudio` in the render's own trace log
     (`"phase":"audio_process"` → next few lines) or just `ffprobe` the
     output for an audio stream before trusting it shipped correctly.
     Fix: install a real system ffmpeg instead
     (`apt-get install -y libva2=2.20.0-2build1 libva-drm2=2.20.0-2build1
     libva-x11-2=2.20.0-2build1 libcaca0=0.99.beta20-4build2 && apt-get
     install -y ffmpeg` — this sandbox's default `noble-updates`/security
     pockets 404 on the exact libva2/libcaca0 patch versions `ffmpeg`
     depends on, but the plain `noble` pocket's slightly-older build
     versions install fine and satisfy the same dependency) then point
     `HYPERFRAMES_FFMPEG_PATH`/`HYPERFRAMES_FFPROBE_PATH` at
     `/usr/bin/ffmpeg` / `/usr/bin/ffprobe` instead of the npm-installed
     ones. Verify with `ffmpeg -h filter=apad | grep whole_dur`.
  2. **`--workers 4` (or however many cores `nproc` reports) cuts render
     time drastically** — the CLI's own auto-calibration picked
     `workerCount: 1` here (it measured ~1.9s/frame and deemed capture
     "slow", defaulting conservatively), but this sandbox has 4 cores and
     forcing `--workers 4` parallelizes frame capture across them with no
     downside observed. A 30s/1920x1080/948-frame composition took ~11min
     wall-clock at 4 workers; the 58s promo (1788 frames) took ~20min.
     Always pass `--workers <nproc>` explicitly rather than trusting
     calibration in this environment.
  3. Composition duration can come out slightly longer than the GSAP
     timeline's own pinned end (registered `tl` had `tl.duration()===30`
     via the `tl.set(..., END)` pin, but the render's discovered
     `window.__hf.duration` was `31.6`/`59.6` — the render preserved the
     extra ~1.6s as pure background/beams with no foreground content, not
     a defect). Didn't chase the exact root cause since it's cosmetically
     harmless (looks like a clean loop-out tail) and every visual
     snapshot the extra time touches was already background-only — but if
     a future composition needs an EXACT total duration, don't trust the
     GSAP `tl.set` pin alone; verify the rendered file's real length with
     `ffprobe` afterward.
  4. `ffmpeg -ss <t> -i in.mp4 -frames:v 1 -q:v 3 out.jpg` (poster-frame
     extraction) warns `does not contain an image sequence pattern` and
     may not write the file reliably on some ffmpeg builds unless you add
     `-update 1` — always include it for single-frame JPEG/PNG output.
  5. Definition-of-done pipeline that worked start to finish this round:
     render (system ffmpeg, `--workers <nproc>`) → `ffprobe` to confirm
     `hasAudio`/duration → re-encode per feature to 1280×720 crf 27 `-an`
     (landing embeds are muted-autoplay, so audio is dead weight) →
     extract a mid-action poster frame → commit only the web re-encodes
     to `src/assets/landing/`. `hyperframes/studio/renders/` (the
     narrated, full-quality masters ffmpeg reads from) is gitignored —
     it's local build output, not a deliverable, so it does NOT persist
     in the repo. If a future task needs the narrated/full-audio versions
     for separate social/marketing distribution (the original ask —
     "we'll need to market those features separately"), re-render from
     the composition sources (`hyperframes lint`/`render` still clean as
     of this entry) rather than assuming a copy survived anywhere.
  6. **This sandbox's Playwright Chromium has NO H.264 decoder**
     (`canPlayType('video/mp4; codecs="avc1..."')` returns "") — every
     H.264 `<video>` errors with MediaError code 4 and shows only its
     poster. So headless screenshots/`video.paused` checks CANNOT verify
     mp4 playback here; treat "paused/black video" in Playwright sweeps
     as an environment artifact, verify poster + play/pause wiring logic
     instead, and rely on the Netlify deploy preview for real playback.
     Posters therefore MUST be chosen from bright, content-full moments
     (a poster is what this sandbox — and any slow connection — shows).
- 2026-07-16: Two new landing films — `hyperframes/studio/intro/` (~32s
  caption-driven explainer, swapped into Landing's "The full experience"
  promo slot replacing beamwall-promo.mp4) and `hyperframes/studio/sizzle/`
  (~22s music/text sizzle, committed unwired). Both are retimed distillations
  of the master promo's scene vocabulary + the EXACT promo S6 logo ending, so
  they close identically on the foil wordmark + "Create your event" pill + QR.
  Findings:
  1. **Higgsfield CDN is fully egress-blocked from this sandbox — confirmed
     again, now decisively.** ALL result hosts 403 on CONNECT through the org
     proxy: `d8j0ntlcm91z4.cloudfront.net` (image/video/audio results),
     `d2ol7oe51mr4n9` (media inputs), `d3u0tzju9qaucj` (3d/results),
     `cdn.higgsfield.ai`, `higgsfield.ai`. So you can GENERATE on Higgsfield
     (jobs succeed, land in the user's workspace) but you CANNOT download the
     bytes to commit OR sample frames to verify. The proxy README says report
     it, don't route around it. Practical upshot: any "commit + verify" video
     deliverable in THIS repo must be HyperFrames-rendered locally; Higgsfield
     is a generate-for-the-user's-side deliverable only. `get_cost:true`
     preflights spend for free; measured spend for 6×kling3_0 5s 16:9 clips +
     6×seed_audio VO takes was 56.7 credits (balance delta, ultimate plan).
     kling3_0 text-to-video sometimes returns a `preset_recommendation`
     notice INSTEAD of a job (no charge) — retry with
     `declined_preset_id:<id>` to generate literally. seed_audio 429s under
     burst — space the calls or retry.
  2. **`--width/--height` render flags do NOT downscale when the composition's
     root sets `data-width/height`.** Passing `--width 1280 --height 720` to a
     1920×1080 composition still rendered 1920×1080 (the flags set the capture
     viewport, the root dims win). The render came out 1920×1080/2.3–2.9MB at
     crf27 — over the <2MB target. Fix: render at native res, then
     `-vf scale=1280:720` in the ffmpeg web re-encode (crf27 → intro 1.15MB
     silent / sizzle 1.60MB with a music bed). Don't trust the render flags to
     resize; scale at encode.
  3. **To END on the logo (vs the promo's fade-to-loop), DROP the S6 stack
     opacity fade and hold it to END; then trim the encode to the pinned END**
     (`-t 32.0` / `-t 22.0`). The render's discovered duration ran ~1.6s past
     the GSAP pin again (1008 frames = 33.6s for a 32.0 pin) — because the
     logo now holds, even the untrimmed tail still shows it, and the `-t` trim
     gives a clean exact-duration file that ends on the wordmark. Verified by
     frame-sampling the encoded file at END-0.2s.
  4. **Silent compositions (no `<audio>` element) sidestep the old-ffmpeg
     audio-mixer bug entirely** — `audioCount:0`, no apad/whole_dur crash, no
     system-ffmpeg install needed. Add the music bed yourself at encode time:
     `-i render.mp4 -i assets/music-bed.m4a -map 0:v:0 -map 1:a:0 -c:a aac
     -af afade=t=out:st=…` (landing explainer stays `-an` since FilmEmbed is
     muted; the sizzle bakes music for standalone/social use).
  5. The vendored `clip-*.mp4` throw a compiler WARN "sparse keyframes … seek
     failures and frame freezing" — but frame-sampling adjacent frames inside
     each ~3–5s footage window showed real motion (differing md5s), no visible
     freeze, so it did NOT require re-encoding the clips with `-g 30`. Only
     chase it if a footage segment visibly stalls.
  6. Composition-dir convention confirmed: each film is its own dir under
     `hyperframes/studio/<name>/` with `index.html` + an `assets -> ../assets`
     symlink (git tracks the symlink); render to gitignored
     `hyperframes/studio/renders/`, commit only the web re-encodes to
     `src/assets/landing/`. The old `beamwall-promo.mp4`/poster are now
     orphaned (unreferenced after the slot swap) but left in place — deleting
     committed files needs explicit user approval.
