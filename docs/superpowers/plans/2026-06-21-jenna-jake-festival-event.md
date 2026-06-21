# Jenna & Jake EDM Festival Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **PREREQUISITE:** The multi-event foundation plan (`2026-06-21-multi-event-foundation.md`) must be fully implemented and merged first. This plan assumes `src/events/`, semantic theme tokens, `EventBackground`/`EventLogo` indirection, the per-event AR allow-list (catalog Task 8), and `event_id` partitioning all exist.

**Goal:** Add "Jenna & Jake" — a vivid EDM-festival wedding event — as a second event: neon palette, heart-and-sunglasses logo, animated R3F shader-orb background, photo-wall landing page, and festival AR content (neon sunglasses head-piece, neon/holographic shaders, festival frames).

**Architecture:** All AR effects live in the shared registries (`src/lib/shaders.ts`, `borders.ts`, `headPieces.ts`); each event's `arContent` lists the ids it uses. So this plan (a) pins Hope Gala to an explicit id list so festival additions can't leak into it, (b) adds festival effects to the shared registries, and (c) creates the `src/events/jenna-jake/` folder selecting them. The event renders when built with `VITE_EVENT=jenna-jake`.

**Tech Stack:** Same as foundation. Background uses `@react-three/fiber` + `@react-three/drei` (`MeshDistortMaterial`) — already installed. No new deps.

**Visual tasks note:** The logo, palette, shader orbs, GLSL effects, and head-piece geometry are **iteratively tuned against the running dev server** (`VITE_EVENT=jenna-jake npm run dev`). Each such task ships complete starter code and ends with a screenshot-review loop. Final palette/logo are chosen with the user in Task 1.

---

## File Structure

**Create:**
- `src/events/jenna-jake/config.ts`, `copy.ts`, `theme.css`, `Logo.tsx`, `Background.tsx`, `arContent.ts`
- `docs/superpowers/assets/jenna-jake-logo-options.md` — the 3 logo/palette options for selection

**Modify:**
- `src/events/hope-gala/config.ts` — pin `arContent` to explicit current ids
- `src/lib/shaders.ts` — add festival shaders
- `src/lib/borders.ts` — add festival frames
- `src/lib/headPieces.ts` — add neon-sunglasses metadata
- `src/components/ar/HeadPieces.tsx` — add neon-sunglasses geometry
- `src/events/registry.ts` — register jenna-jake
- `src/main.tsx` — import `jenna-jake/theme.css`

---

## Task 1: Palette + logo selection (live, with user)

**Files:**
- Create: `docs/superpowers/assets/jenna-jake-logo-options.md`

- [ ] **Step 1: Produce 3 logo + palette options**

Use the `mcp__visualize__show_widget` tool (or inline SVG) to render **3 distinct directions** for the "Jenna & Jake" mark. Each option = one heart-with-sunglasses lockup + a 5-swatch palette. Reference vibe: Osega/EDM festival — holographic, neon, high-energy. Suggested starting directions:
- **A — Holographic Heart:** rounded heart outline with a chrome/iridescent gradient stroke; aviator sunglasses across the heart's top dip; names in a bold condensed sans inside. Palette: electric magenta `#FF2D9B`, cyan `#19E3FF`, violet `#7A2BFF`, lime `#C6FF1A`, midnight `#0B0220`.
- **B — Neon Outline:** single-weight neon-tube heart (glow), wayfarer shades, script names. Palette: hot pink `#FF3D7F`, aqua `#21F1C8`, indigo `#3A1DB8`, amber `#FFC73A`, near-black `#070411`.
- **C — Festival Poster:** filled gradient heart, mirrored-lens sunglasses reflecting a sunset gradient, stacked names. Palette: coral `#FF5C5C`, tangerine `#FF9E2C`, magenta `#E12AFB`, teal `#2CE0C8`, deep plum `#140426`.

- [ ] **Step 2: Get the user's pick**

Ask the user which option (or a blend) and confirm the final 5 hex values + the logo direction. Record the decision in `docs/superpowers/assets/jenna-jake-logo-options.md` (the chosen palette hexes mapped to `--color-accent`, `--color-accent-2`, `--color-accent-3`, `--color-brand-bg`, `--color-brand-surface`, `--color-brand-fg`, `--color-brand-muted`).

- [ ] **Step 3: Commit the decision**

```bash
git add docs/superpowers/assets/jenna-jake-logo-options.md
git commit -m "docs(jenna-jake): record chosen festival palette + logo direction"
```

**Downstream tasks use these recorded values.** Where this plan shows placeholder hexes, substitute the recorded ones.

---

## Task 2: Pin Hope Gala AR content to explicit ids

**Files:**
- Modify: `src/events/hope-gala/config.ts`

Foundation Task 8 treats an empty `arContent` as "include all built-ins." Once we add festival effects to the shared registries, "all" would leak them into Hope Gala. Pin Hope Gala to its current ids first.

- [ ] **Step 1: List the current built-in ids**

Run: `git grep -nE "id: '" src/lib/shaders.ts src/lib/borders.ts src/lib/headPieces.ts` and collect every non-`special` shader id, every border id, every head-piece id.

- [ ] **Step 2: Set Hope Gala's arContent explicitly**

In `src/events/hope-gala/config.ts`, replace `arContent: {}` with the enumerated current ids, e.g.:

```ts
arContent: {
  shaderIds: ['none', 'champagne-sparkle', /* …every current non-special shader id… */],
  borderIds: [/* …every current border id… */],
  headPieceIds: ['royal-crown', 'queen-tiara', 'cheek-stars', 'hope-halo'],
},
```

- [ ] **Step 3: Verify Hope Gala catalog unchanged**

Run: `VITE_EVENT=hope-gala npm run dev`. In the booth filter drawer, confirm the exact same set of filters/frames/head-pieces as before. Run `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/events/hope-gala/config.ts
git commit -m "feat(hope-gala): pin AR catalog to explicit ids"
```

---

## Task 3: Festival theme.css

**Files:**
- Create: `src/events/jenna-jake/theme.css`

- [ ] **Step 1: Write the festival tokens + neon decorative overrides**

Substitute the Task 1 hexes. Scope to the event's data attribute and override the semantic decorative utilities with a neon/holographic treatment:

```css
/* src/events/jenna-jake/theme.css */
:root[data-event='jenna-jake'] {
  --color-brand-bg:      #0B0220;  /* midnight (Task 1) */
  --color-brand-surface: #16093A;
  --color-brand-fg:      #F4ECFF;
  --color-brand-muted:   #B79CFF;
  --color-accent:        #FF2D9B;  /* electric magenta */
  --color-accent-2:      #19E3FF;  /* cyan */
  --color-accent-3:      #7A2BFF;  /* violet */
}

/* Festival "foil" = animated holographic neon sweep (re-skins .text-foil) */
:root[data-event='jenna-jake'] .text-foil {
  background: linear-gradient(100deg, var(--color-accent) 0%, var(--color-accent-2) 30%, #C6FF1A 50%, var(--color-accent-2) 70%, var(--color-accent-3) 100%);
  background-size: 220% auto;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: foil-shimmer 4s linear infinite;
}
:root[data-event='jenna-jake'] .text-foil-static {
  background: linear-gradient(120deg, var(--color-accent), var(--color-accent-2) 50%, var(--color-accent-3));
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
:root[data-event='jenna-jake'] .glow-accent {
  box-shadow: 0 0 50px -6px color-mix(in srgb, var(--color-accent) 70%, transparent),
              0 0 90px -10px color-mix(in srgb, var(--color-accent-2) 50%, transparent);
}
```

- [ ] **Step 2: Import it in main.tsx**

In `src/main.tsx`, add `import './events/jenna-jake/theme.css';` next to the Hope Gala theme import.

- [ ] **Step 3: Commit**

```bash
git add src/events/jenna-jake/theme.css src/main.tsx
git commit -m "feat(jenna-jake): festival theme tokens + neon utilities"
```

---

## Task 4: Festival logo (heart + sunglasses)

**Files:**
- Create: `src/events/jenna-jake/Logo.tsx`

- [ ] **Step 1: Write the wordmark + mark**

Embed the chosen SVG from Task 1. Complete starter (a holographic heart whose top dip carries aviator shades, names inside), to be refined against the dev server:

```tsx
/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Jenna & Jake festival lockup — names in a heart crowned by festival shades,
 * holographic neon fill.
 */
function HeartGlasses({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <defs>
        <linearGradient id="jj-holo" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-accent)" />
          <stop offset="0.5" stopColor="var(--color-accent-2)" />
          <stop offset="1" stopColor="var(--color-accent-3)" />
        </linearGradient>
      </defs>
      {/* heart */}
      <path d="M60 104 C20 76 8 52 8 34 C8 18 22 8 38 8 C49 8 56 14 60 22 C64 14 71 8 82 8 C98 8 112 18 112 34 C112 52 100 76 60 104 Z"
            stroke="url(#jj-holo)" strokeWidth="4" fill="none"
            style={{ filter: 'drop-shadow(0 0 10px color-mix(in srgb, var(--color-accent) 60%, transparent))' }} />
      {/* sunglasses across the heart's top dip */}
      <g stroke="url(#jj-holo)" strokeWidth="3.5" fill="color-mix(in srgb, var(--color-brand-bg) 70%, transparent)">
        <rect x="34" y="34" width="20" height="13" rx="5" />
        <rect x="66" y="34" width="20" height="13" rx="5" />
        <path d="M54 38 H66" />
      </g>
    </svg>
  );
}

export function JennaJakeWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const s = { sm: { mark: 44, title: 'text-2xl', sub: 'text-[9px]' }, md: { mark: 64, title: 'text-4xl', sub: 'text-[10px]' }, lg: { mark: 92, title: 'text-6xl', sub: 'text-xs' }, xl: { mark: 120, title: 'text-7xl sm:text-8xl', sub: 'text-sm' } }[size];
  return (
    <div className="flex flex-col items-center text-center leading-none select-none">
      <HeartGlasses size={s.mark} />
      <span className={`mt-3 font-label uppercase tracking-luxe text-brand-muted/80 ${s.sub}`}>The Wedding Festival</span>
      <span className={`font-serif font-semibold tracking-wide text-foil ${s.title}`}>Jenna &amp; Jake</span>
    </div>
  );
}

export function JennaJakeMark() {
  return (
    <div className="flex items-center gap-3 select-none">
      <HeartGlasses size={36} />
      <span className="font-serif italic text-xl tracking-wide text-brand-fg">Jenna &amp; Jake</span>
    </div>
  );
}
```

- [ ] **Step 2: Tune against the dev server**

Run `VITE_EVENT=jenna-jake npm run dev`, render where `<Wordmark>` appears (after Task 9 wires config). Screenshot, refine the SVG path/glasses to match the chosen Task 1 direction. Loop until it matches.

- [ ] **Step 3: Commit**

```bash
git add src/events/jenna-jake/Logo.tsx
git commit -m "feat(jenna-jake): heart + sunglasses festival logo"
```

---

## Task 5: Shader-orb background

**Files:**
- Create: `src/events/jenna-jake/Background.tsx`

- [ ] **Step 1: Write the R3F orbs background**

Dependency-free (three + drei already present). Drifting distorted emissive orbs in the accent colors over the midnight background; CSS blur softens them into bloom-like glow.

```tsx
/**
 * @license SPDX-License-Identifier: Apache-2.0
 * Jenna & Jake ambient background — drifting neon shader orbs (R3F).
 * pointer-events-none, absolute inset-0.
 */
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

function Orb({ seed, color }: { seed: number; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const base = useMemo(() => ({
    x: Math.sin(seed) * 3.2,
    y: Math.cos(seed * 1.7) * 2.0,
    z: -2 - (seed % 3),
    speed: 0.15 + (seed % 5) * 0.05,
    scale: 1.2 + (seed % 4) * 0.5,
  }), [seed]);
  useFrame((state) => {
    const t = state.clock.elapsedTime * base.speed + seed;
    if (ref.current) {
      ref.current.position.set(base.x + Math.sin(t) * 1.2, base.y + Math.cos(t * 0.8) * 1.0, base.z);
    }
  });
  return (
    <mesh ref={ref} scale={base.scale}>
      <sphereGeometry args={[1, 48, 48]} />
      <MeshDistortMaterial color={color} emissive={color} emissiveIntensity={1.3} distort={0.45} speed={2} roughness={0.2} toneMapped={false} />
    </mesh>
  );
}

export default function FestivalBackground({ density = 6, className = '' }: { density?: number; className?: string }) {
  // Pull accent values from CSS variables so the orbs follow the theme.
  const colors = ['#FF2D9B', '#19E3FF', '#7A2BFF', '#C6FF1A']; // Task 1 palette
  const orbs = Array.from({ length: density }, (_, i) => ({ seed: i * 1.6180339, color: colors[i % colors.length] }));
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden
         style={{ background: 'radial-gradient(120% 90% at 50% 0%, #16093A 0%, #0B0220 60%)' }}>
      <div className="absolute inset-0" style={{ filter: 'blur(38px) saturate(140%)' }}>
        <Canvas camera={{ position: [0, 0, 6], fov: 55 }} gl={{ antialias: true, alpha: true }} dpr={[1, 1.5]}>
          <ambientLight intensity={0.8} />
          {orbs.map((o, i) => <Orb key={i} seed={o.seed} color={o.color} />)}
        </Canvas>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Performance + visual check**

Run `VITE_EVENT=jenna-jake npm run dev`, view `/wall` (after Task 9). Confirm smooth animation (check console for WebGL warnings via preview tools) and that the orbs read as soft festival glow, not hard spheres. Tune `density`, `blur`, `distort`, `emissiveIntensity`. Keep `density` ≤ 6 on the booth to protect the camera/MediaPipe frame rate.

- [ ] **Step 3: Commit**

```bash
git add src/events/jenna-jake/Background.tsx
git commit -m "feat(jenna-jake): R3F shader-orb ambient background"
```

---

## Task 6: Festival shaders

**Files:**
- Modify: `src/lib/shaders.ts`

- [ ] **Step 1: Add festival effects to the shared SHADERS array**

Append new `ShaderDef`s using the existing `compose(...)` helper and uniforms (`uIntensity`, `uTime`, `uSparkle`, `uBloom`, etc.). Start with one complete neon-glow effect (laser scanlines + chromatic edge bloom), screen-blended like the others:

```ts
{
  id: 'neon-pulse',
  name: 'Neon Pulse',
  description: 'Magenta/cyan laser scanlines + chromatic bloom that pulse to the beat.',
  animated: true,
  fragment: compose(`
void main(){
  vec2 uv = vUv;
  vec3 col = texture2D(uTexture, uv).rgb;
  // chromatic edge split
  float ca = 0.004 * uIntensity;
  vec3 chroma = vec3(
    texture2D(uTexture, uv + vec2(ca, 0.0)).r,
    col.g,
    texture2D(uTexture, uv - vec2(ca, 0.0)).b);
  // moving laser scanlines
  float beat = 0.6 + 0.4 * sin(uTime * 3.0);
  float lines = smoothstep(0.9, 1.0, sin((uv.y + uTime * 0.15) * 140.0));
  vec3 neon = mix(vec3(1.0, 0.18, 0.61), vec3(0.10, 0.89, 1.0), uv.y);
  vec3 glow = neon * lines * beat * uIntensity;
  gl_FragColor = vec4(screenBlend(chroma, glow), 1.0);
}`),
  params: [{ key: 'uIntensity', label: 'Intensity', min: 0, max: 1.5, step: 0.05, default: 0.8 }],
},
```

- [ ] **Step 2: Add two more following the same pattern**

Add `holo-bloom` (iridescent oil-slick sheen over highlights, driven by `uBloom`) and `laser-sparkle` (a recoloured variant of the existing sparkle effect using magenta/cyan/lime instead of gold). Mirror the structure of the existing `champagne-sparkle` shader for the sparkle one — read it in `src/lib/shaders.ts` and swap the colour constants. Keep each under ~40 lines of GLSL.

- [ ] **Step 3: Verify they compile + render**

Run `VITE_EVENT=jenna-jake npm run dev`. After Task 9 lists these ids in festival `arContent`, select each in the booth. Confirm no shader-compile errors in the console and the effect reads as festival neon. Tune constants against the live camera. Confirm Hope Gala (`VITE_EVENT=hope-gala`) does **not** show these (its allow-list excludes them).

- [ ] **Step 4: Commit**

```bash
git add src/lib/shaders.ts
git commit -m "feat(ar): festival neon shaders (neon-pulse, holo-bloom, laser-sparkle)"
```

---

## Task 7: Neon-sunglasses head-piece

**Files:**
- Modify: `src/lib/headPieces.ts`, `src/components/ar/HeadPieces.tsx`

- [ ] **Step 1: Add the metadata**

In `src/lib/headPieces.ts`, append to `HEAD_PIECES`:

```ts
{ id: 'neon-shades', name: 'Neon Shades', anchor: 'noseBridge', config: cfg('noseBridge', [0, 1.4, 1.2], 1) },
```

(Anchor on the nose bridge so the glasses sit over the eyes; tune the offset in Step 3.)

- [ ] **Step 2: Add the geometry**

In `src/components/ar/HeadPieces.tsx`, read how existing procedural ids (e.g. `royal-crown`) switch on `procedural` id and render R3F meshes. Add a `neon-shades` case: two rounded lens boxes + a bridge bar, emissive in the accent colors:

```tsx
// inside the procedural renderer switch/map, add:
if (id === 'neon-shades') {
  const lens = (x: number) => (
    <mesh position={[x, 0, 0]}>
      <boxGeometry args={[2.2, 1.3, 0.2]} />
      <meshStandardMaterial color="#0B0220" emissive="#FF2D9B" emissiveIntensity={1.2} metalness={0.6} roughness={0.2} toneMapped={false} />
    </mesh>
  );
  return (
    <group>
      {lens(-1.4)}
      {lens(1.4)}
      <mesh><boxGeometry args={[0.8, 0.18, 0.18]} /><meshStandardMaterial color="#19E3FF" emissive="#19E3FF" emissiveIntensity={1.5} toneMapped={false} /></mesh>
    </group>
  );
}
```

Match the file's actual rendering convention (it may use a registry map rather than a literal `if`); follow whatever pattern `royal-crown` uses.

- [ ] **Step 3: Place it correctly against a live face**

Run `VITE_EVENT=jenna-jake npm run dev`, open the booth, select Neon Shades, and confirm via the preview tools / a real face that the glasses sit on the eyes. Adjust the `cfg('noseBridge', …)` offset/scale in `headPieces.ts` until it tracks naturally. (The booth renders through `<FaceRig>` so placement is WYSIWYG.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/headPieces.ts src/components/ar/HeadPieces.tsx
git commit -m "feat(ar): neon sunglasses head-piece"
```

---

## Task 8: Festival frames

**Files:**
- Modify: `src/lib/borders.ts`

- [ ] **Step 1: Add festival SVG frames**

Read `src/lib/borders.ts` for the `BUILTIN_BORDERS` shape (`{id,name,kind,svg}`, 1080×1920 transparent). Append festival frames mirroring an existing minimal frame's structure, recoloured neon:
- `jj-neon-frame` — double neon-tube border (magenta outer, cyan inner) with corner glow.
- `jj-lower-third` — "JENNA & JAKE" wordmark band across the bottom in holographic gradient.
- `jj-equalizer` — animated-look EQ bars along the bottom edge (static SVG bars in accent colors).

Each is a complete 1080×1920 SVG string using the festival hexes. Follow the exact `kind` (`'border'`) and `toDataUrl` usage of the existing entries.

- [ ] **Step 2: Verify**

Run `VITE_EVENT=jenna-jake npm run dev`. After Task 9 lists these ids, confirm each frame composites correctly over a captured photo at 1080×1920. Confirm Hope Gala does not show them.

- [ ] **Step 3: Commit**

```bash
git add src/lib/borders.ts
git commit -m "feat(ar): festival frames (neon, lower-third, equalizer)"
```

---

## Task 9: Festival copy + config + registry

**Files:**
- Create: `src/events/jenna-jake/copy.ts`, `src/events/jenna-jake/arContent.ts`, `src/events/jenna-jake/config.ts`
- Modify: `src/events/registry.ts`

- [ ] **Step 1: Write the copy**

```ts
// src/events/jenna-jake/copy.ts
import type { EventCopy } from '../types';
export const jennaJakeCopy: EventCopy = {
  eyebrow: 'JENNA & JAKE · 2026',
  eventName: 'Jenna & Jake',
  tagline: "Snap your festival moment on the dance floor",
  fullName: "Jenna & Jake's Wedding Festival 2026",
  thankYou: 'Welcome to the party — see you on the wall!',
  steps: [
    { title: 'Scan QR', body: 'Point your camera at the code on the screen.' },
    { title: 'Grab a Filter', body: 'Neon shades, lasers, holo frames — pick your vibe.' },
    { title: 'Strike a Pose', body: 'Snap a photo or record a clip.' },
    { title: 'Hit the Wall', body: 'Your moment beams onto the big festival wall.' },
  ],
  filePrefix: 'JennaJake2026',
  shareTitle: "Jenna & Jake's Wedding Festival 2026",
  shareText: "My moment from Jenna & Jake's wedding festival! 🎉",
};
```

- [ ] **Step 2: Write the AR manifest**

Use the ids added in Tasks 6–8 plus any shared effects worth reusing:

```ts
// src/events/jenna-jake/arContent.ts
import type { EventARContent } from '../types';
export const jennaJakeAR: EventARContent = {
  shaderIds: ['none', 'neon-pulse', 'holo-bloom', 'laser-sparkle'],
  borderIds: ['jj-neon-frame', 'jj-lower-third', 'jj-equalizer'],
  headPieceIds: ['neon-shades'],
};
```

- [ ] **Step 3: Write the config**

```ts
// src/events/jenna-jake/config.ts
import type { EventConfig } from '../types';
import { jennaJakeCopy } from './copy';
import { jennaJakeAR } from './arContent';
import { JennaJakeWordmark, JennaJakeMark } from './Logo';
import FestivalBackground from './Background';

export const jennaJake: EventConfig = {
  id: 'jenna-jake',
  copy: jennaJakeCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Inter:wght@300;400;500;600;700&family=Pacifico&display=swap',
  Wordmark: JennaJakeWordmark,
  Mark: JennaJakeMark,
  Background: FestivalBackground,
  landingRoute: '/wall',
  arContent: jennaJakeAR,
};
```

(If the festival logo uses a script face, the `font-script`/`font-serif` tokens can be remapped in `theme.css`; otherwise the above fonts cover display + body.)

- [ ] **Step 4: Register it**

In `src/events/registry.ts`:

```ts
import { jennaJake } from './jenna-jake/config';
// ...
const REGISTRY: Record<string, EventConfig> = {
  [hopeGala.id]: hopeGala,
  [jennaJake.id]: jennaJake,
};
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/events/jenna-jake/ src/events/registry.ts
git commit -m "feat(jenna-jake): festival copy, AR manifest, config, registration"
```

---

## Task 10: Seed data + Netlify site

**Files:** none (infra + DB)

- [ ] **Step 1: Seed festival app_settings**

Via Supabase MCP `execute_sql`, insert the festival landing + wall settings rows with `event_id='jenna-jake'` (so `/wall` and `/join` render festival copy and the wall starts on the right defaults). Example:

```sql
insert into app_settings (event_id, key, value)
values
 ('jenna-jake', 'wall', '{"showQR":true,"showLeaderboard":false,"showChallenges":false,"galleryScroll":true,"galleryScrollSpeed":1.4,"slideshowInterval":6,"defaultExperienceId":null}'::jsonb)
on conflict (event_id, key) do nothing;
```

(Landing content falls back to the in-app `DEFAULT_LANDING` + festival copy if no row exists; insert a `landing` row only if you want to override.)

- [ ] **Step 2: Create the Netlify site**

Following `docs/EVENTS.md`: new Netlify site from this repo, branch `main`, build `npm run build`, publish `dist`. Env vars: `VITE_EVENT=jenna-jake`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (shared project), `VITE_ADMIN_PASSCODE` (festival passcode). Use the Netlify MCP if available, otherwise do it in the Netlify UI.

- [ ] **Step 3: Verify the deploy**

Trigger a deploy; once live, load the festival URL: confirm `/` redirects to the photo wall, the orb background renders, the logo is the heart-and-sunglasses lockup, and the booth shows festival filters/frames/shades. Capture a photo and confirm its `posts` row has `event_id='jenna-jake'` and it appears on the festival wall (not the Hope Gala wall).

---

## Task 11: Full dual-event verification

- [ ] **Step 1: Hope Gala regression**

Run `VITE_EVENT=hope-gala npm run build && npm run preview`. Walk the whole app — it must be visually and behaviorally identical to before both plans. Capture a photo; confirm `event_id='hope-gala'`.

- [ ] **Step 2: Festival smoke test**

Run `VITE_EVENT=jenna-jake npm run build && npm run preview`. Confirm festival theme, logo, orb background, wall landing, neon AR content, and `event_id='jenna-jake'` data scoping.

- [ ] **Step 3: Cross-event isolation**

Confirm the Hope Gala wall shows only `hope-gala` posts and the festival wall shows only `jenna-jake` posts (the app-level `event_id` filter from foundation Task 9).

- [ ] **Step 4: Final commit / tag**

```bash
git add -A
git commit -m "test: verify dual-event builds (hope-gala + jenna-jake)"
```

---

## Self-review notes

- **Spec coverage (§5 of the design):** logo (T1,T4), palette (T1,T3), shader-orb background (T5), wall landing (`landingRoute:'/wall'`, T9), festival AR content — neon shaders (T6), neon sunglasses (T7), festival frames (T8) — copy (T9), backend `event_id` + Netlify (T10). All covered.
- **Leak prevention:** Task 2 pins Hope Gala to explicit ids before any shared-registry additions, so festival effects never appear in Hope Gala. Verified in T3/T6/T8 and T11.
- **Type consistency:** `EventConfig`, `EventCopy`, `EventARContent` match the foundation's `src/events/types.ts`. AR ids in `arContent.ts` (T9) match those added in T6–T8.
- **Live-tuned tasks (expected):** Task 1 (palette/logo selection), and the visual refinement loops in T4/T5/T6/T7/T8. These ship complete starter code and end with a screenshot/preview review — appropriate for iterative visual work, not placeholders.
