# Hope Gala AR Photo Booth — Foundation API & Conventions

This app is a Vite + React 19 + TypeScript + Tailwind v4 + Three.js (R3F) + MediaPipe
photo-booth platform for the **SCAGO Hope Gala 2026** (Sat June 13, 2026). Backend is
**Supabase** (Postgres + Storage + Realtime). Deploy target: static build on Netlify.

**You are implementing on top of a finished foundation.** Do NOT modify shared files
(`App.tsx`, `store.ts`, `types.ts`, anything in `src/lib/`, `src/components/ui/`,
`src/components/ar/`). Only touch the files your task assigns. If you need a new helper,
create it inside your own component subfolder.

---

## Theme (use these — never hardcode hex)

Palette tokens (Tailwind classes): `gold-50 100 200 300 400 500 600 700`, `ivory`,
`cream`, `champagne`, `noir-900 800 700 600`, `rose`. Legacy aliases `brand-bg`,
`brand-gold`, `brand-text` still resolve. Primary metallic gold = `gold-400` (#D4AF37).

Fonts: `font-serif` (Cormorant Garamond — elegant display), `font-script`
(Pinyon Script — flourishes like "& Awards"), `font-label` (Jost — uppercase tracked
labels), `font-sans` (Inter — body).

Utility classes available globally:
- `glass`, `glass-strong` — frosted gold-tinted panels
- `gold-foil` (animated shimmer), `gold-foil-static` — metallic gradient clipped to text
- `bg-foil` — gold gradient fill (buttons)
- `glow-gold`, `glow-soft` — gold glows; `animate-pulse-glow`
- `gala-bg` — warm bokeh background wash; `vignette` (::after vignette)
- `face-grid` — subtle dotted grid; `hide-scrollbar`; `tracking-luxe` (0.28em)
- `animate-rise-in` — elegant entrance

Shared UI components:
- `import GalaBackground from 'src/components/ui/GalaBackground'` — `<GalaBackground density={36} />`
  ambient bokeh + drifting gold dust (pointer-events none). Use density 24–36 on mobile,
  60–90 on the projected wall.
- `import { HopeGalaWordmark, HopeGalaMark } from 'src/components/ui/Logo'`
  `<HopeGalaWordmark size="sm|md|lg|xl" />` (the invitation lockup), `<HopeGalaMark />` (nav).

Design language: black-tie elegant. Gold + ivory on warm near-black. Serif display
headings, uppercase tracked `font-label` eyebrows, generous spacing, soft glows, glass.
Buttons: primary = `bg-foil text-noir-900` rounded-xl with `glow-gold`; secondary = glass.
Match the gala invitation (gold foil, hexagon motif, champagne).

---

## Types (`src/types.ts`)

```ts
type ExperienceKind = '2d_filter' | 'border' | 'shader' | '3d_attachment' | 'composite';
type HeadAnchor = 'crown'|'forehead'|'noseBridge'|'noseTip'|'leftEye'|'rightEye'
                 |'leftEar'|'rightEar'|'leftCheek'|'rightCheek'|'mouth'|'chin';
interface Transform2D { scale:number; x:number; y:number; rotation:number } // x,y are % of frame
interface ShaderConfig { shaderId:string; params?:Record<string,number> }
interface AnchorConfig { anchor:HeadAnchor; offset:{x,y,z}; rotation:{x,y,z}; scale:number }
interface ExperienceConfig { transform?; opacity?; blendMode?; shader?; anchor?; layers?; ambientShader? }
interface Experience { id; created_at; updated_at; name; kind; asset_url; thumbnail_url;
                       config:ExperienceConfig; is_published; featured; sort_order }
interface Post { id; created_at; image_url; message; guest_name; experience_id;
                 session_id; approved; hidden; width; height }
interface SavedPhoto { id; image_url; message?; createdAt:number }
type ExperienceDraft = Partial<...> & { id? }
```

## Data layer (`src/lib/db.ts`) — all backend I/O goes through here

```ts
fetchExperiences({publishedOnly?}) : Promise<Experience[]>
getExperience(id) ; createExperience(draft) ; updateExperience(id, patch) ; deleteExperience(id)
fetchPosts({includeHidden?, limit?}) ; fetchMyPosts()  // my = this device's session
setPostHidden(id, hidden) ; deletePost(id)
subscribeToPosts({ onInsert, onUpdate, onDelete }) : () => void   // realtime; returns unsubscribe
uploadAsset(blob, name?) : Promise<string|null>   // -> public URL in 'assets' bucket
submitPost({ blob, message?, guestName?, experienceId?, width?, height? }) : Promise<Post|null>
```

## Session/local gallery (`src/lib/session.ts`)
`getSessionId()`, `getSavedPhotos()`, `savePhoto({id,image_url,message?,createdAt})`,
`clearGallery()`. Fires `window` event `'gallery:changed'`. Lets guests re-download later.

## Global store (`src/store.ts`, zustand)
`useStore()` → `{ experiences, experiencesLoaded, fetchExperiences(publishedOnly?),
currentFilter, setCurrentFilter, posts, postsLoaded, fetchPosts(includeHidden?),
prependPost, removePost, updatePost }`.

## Catalog (`src/lib/catalog.ts`)
`builtinExperiences()` → built-in shaders + borders as `Experience[]` (ids `builtin:...`).
`buildCatalog(dbExperiences)` → merged, sorted list for the booth. `isBuiltin(id)`.

## Shader engine (`src/lib/shaders.ts`)
`SHADERS: ShaderDef[]` (id,name,description,animated,fragment,params[]), `SHADER_MAP`,
`defaultParams(id)`. `class ShaderRunner(w,h)`:
`.available`, `.resize(w,h)`, `.draw(source, shaderId, params, flipX?) -> HTMLCanvasElement|null`,
`.dispose()`. Reuse one runner for live preview (call draw per frame). Shaders: `none`,
`golden-hour`, `soft-glam`, `noir-gold`, `champagne-bloom`, `duotone-gold`, `film-grain`(anim),
`sparkle-bokeh`(anim).

## Borders/overlays (`src/lib/borders.ts`)
`BUILTIN_BORDERS: {id,name,kind,svg}[]`, `BORDER_MAP`, `toDataUrl(svg)`. 1080x1920 transparent
SVGs (gold frames incl. hexagon-from-invitation, deco, minimal; sparkle + confetti overlays).

## Face AR (shared — `src/lib/faceRig.ts` + `src/components/ar/FaceRig.tsx`)
`ANCHOR_PRESETS`, `ANCHOR_MAP`, `updateHeadPose(group, video):boolean`, `RIG_CAMERA {position,fov}`.
`<FaceRig videoId anchor config={Partial<AnchorConfig>} paused onVisibilityChange>{children}</FaceRig>`
parents children on the tracked head at an anchor. `<Model url />` loads+caches a GLB.
Tracking: `initializeFaceLandmarker()` / `getFaceLandmarker()` from `src/lib/faceTracking.ts`.
**Booth and the 3D editor MUST render through `<FaceRig>` so placement is WYSIWYG.**

---

## Capture / compositing convention (booth + studio previews)
Capture target is **1080x1920 (9:16)**. Pipeline order when compositing to a 2D canvas:
1. Draw mirrored video (cover-fit) → 2. apply shader via `ShaderRunner.draw` (draw its canvas) →
3. draw Three.js (3D) canvas → 4. draw 2D overlay/border (apply its Transform2D: scale, x/y %,
rotation). Export `image/jpeg` quality 0.9. Use `gl={{ preserveDrawingBuffer: true }}` on R3F
Canvas so it can be drawn to the composite.

## Magical effects to implement (specs)
- **Send-off ("fold + dust")**: when a guest taps Send, animate the preview card folding/
  shrinking with a gold dust dissolve (particles drifting up), then it "beams" away. Use
  CSS/Canvas/Framer Motion (`motion/react` is installed). ~1.2s. Then confirm sent.
- **Wall beam-in**: when a new post arrives (realtime), it materializes via a vertical light
  beam + bloom, settling into the grid/slideshow. Gold light streak. ~1s.
- Confetti available via `canvas-confetti` (gold colors `#D4AF37 #E8C766 #FBF3D9`).

## Routes (already wired in App.tsx — don't change)
`/` & `/booth` & `/experience/:id` → Booth · `/wall` → Wall · `/me` & `/gallery` → MyPhotos ·
`/admin` Dashboard · `/admin/library` Library · `/admin/creator` Creator2D ·
`/admin/creator3d` Creator3D · `/admin/moderation` Moderation (all admin gated).

## NEW in round 2 (video, challenges, settings, leaderboard, camera/recorder)

**Types** (`types.ts`): `Post` now has `media_type:'image'|'video'`, `duration_ms`, `challenge_id`.
New: `Challenge {id,title,description,emoji,points,sort_order,active}`,
`WallSettings {showQR,showLeaderboard,showChallenges}`,
`LeaderboardEntry {sessionId,name,photos,challengesCompleted,points}`, `MediaType`.

**db.ts** additions:
- `submitPost({blob, mediaType?, durationMs?, challengeId?, ...})` — now handles video blobs too.
- Challenges: `fetchChallenges({activeOnly?})`, `createChallenge`, `updateChallenge(id,patch)`, `deleteChallenge(id)`.
- Settings: `getWallSettings()`, `setWallSettings(patch)`, `subscribeToSettings(cb) => unsub` (realtime).
- Leaderboard: `fetchLeaderboard(limit?)` — aggregated from posts+challenges, sorted by points.

**store.ts** additions: `challenges, challengesLoaded, fetchChallenges`, `wallSettings, fetchWallSettings, setWallSettings`,
`leaderboard, fetchLeaderboard`.

**camera.ts**: `getCameraStream({facingMode:'user'|'environment', withAudio?, deviceId?})` (best-quality w/ fallback),
`listVideoInputs()`, `hasMultipleCameras()`, `stopStream(s)`, `streamResolution(s)`.

**recorder.ts**: `class StreamRecorder({maxMs?, videoBitsPerSecond?, onTick, onMaxReached})` with `.start(stream)`,
`.stop():Promise<Blob>`, `.recording`, `.dispose()`. `buildRecordStream(canvas, audioFromStream?, fps?)` →
`canvas.captureStream()` + audio track. `recordingSupported()`, `pickVideoMimeType()`.

**Booth direction (round 2):** remove the basic "Look" shader strip (the plain color grades). Keep FRAMES. Shaders
become *cool combinable EFFECTS* (sparkle/light-leak/etc — see updated `SHADERS`) that layer over the frame. Unify the
picker (frames + 3D + effects) into ONE sleek **collapsible** drawer that doesn't eat the viewport, with easy
switching. Add front/back camera flip (only show if `hasMultipleCameras()`), highest quality, photo/video toggle
(record up to 30s via recorder.ts on a composite canvas + audio), optional timer (off/3/5/10s), a first-launch
onboarding modal, and optional challenge selection (tag the post via `challengeId`).

**New admin pages** (routes already wired): `/admin/settings` (`Settings.tsx` — QR + feature toggles via
`setWallSettings`/db), `/admin/challenges` (`Challenges.tsx` — CRUD). Add nav entries in `AdminGate.tsx`.

**Wall (round 2):** render `media_type:'video'` posts as `<video autoplay loop muted playsInline>`. Gate the QR
codes on `wallSettings.showQR` (live via `subscribeToSettings`). Add a **Leaderboard** view mode + optional
challenges ticker (gated by `showLeaderboard`/`showChallenges`).

## Don'ts
- No new heavy deps without need (already have: three, @react-three/fiber + drei, motion,
  canvas-confetti, qrcode.react, lucide-react, zustand, @supabase/supabase-js,
  @mediapipe/tasks-vision, react-resizable-panels, clsx, tailwind-merge).
- Don't run the dev server (it's running on :5180) or `npm install`. Keep `npx tsc --noEmit`
  scoped if you typecheck.
- Camera requires HTTPS in production (Netlify) — fine on localhost for dev.
```
