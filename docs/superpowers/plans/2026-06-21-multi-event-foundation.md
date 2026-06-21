# Multi-Event Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-event Hope Gala photo booth into a white-label platform where each event's theme, copy, logo, background, and AR content live in an isolated config folder selected by a `VITE_EVENT` env var, with all backend data partitioned by `event_id`.

**Architecture:** A `src/events/` directory holds one folder per event, each exporting an `EventConfig`. A registry maps slug → config; `active.ts` resolves the build's event from `import.meta.env.VITE_EVENT` (default `hope-gala`). CSS theming moves from hardcoded gold to semantic CSS variables that each event overrides. The Hope Gala build must stay pixel-identical — this plan only adds the abstraction and refactors Hope Gala into the first event; it adds no new visual output.

**Tech Stack:** Vite 6, React 19, TypeScript 5.8, Tailwind v4 (`@theme` CSS vars), Three.js/R3F, MediaPipe, Supabase (Postgres + Storage + Realtime), Vitest (added here for the config logic).

**Key conventions (read before starting):**
- The event **id equals its slug** (`'hope-gala'`, `'jenna-jake'`). One identifier, used both for the folder/env and as the DB `event_id`.
- Components must reference **semantic** CSS classes/tokens only — never `gold-*`, `gala-*`, `champagne`, `noir-*` directly after migration.
- The data layer ([src/lib/db.ts](../../../src/lib/db.ts)) is the only place that talks to Supabase; all event scoping happens there.
- Dev server runs with `npm run dev` (Vite, `--host`). Typecheck with `npx tsc --noEmit`. Run unit tests with `npm test`.

---

## File Structure

**Create:**
- `src/events/types.ts` — `EventConfig` and sub-interfaces.
- `src/events/eventId.ts` — tiny, dependency-free `EVENT_ID` export (imported by the data layer).
- `src/events/active.ts` — resolves and re-exports the full active `EventConfig`.
- `src/events/registry.ts` — slug → `EventConfig` map.
- `src/events/hope-gala/config.ts` — Hope Gala's `EventConfig`.
- `src/events/hope-gala/copy.ts` — Hope Gala's strings.
- `src/events/hope-gala/theme.css` — Hope Gala's semantic-token values + decorative keyframes.
- `src/events/active.test.ts` — registry/resolution unit tests.
- `vitest.config.ts` — test runner config.
- `docs/EVENTS.md` — how to add an event + deploy.

**Modify:**
- `src/index.css` — introduce semantic tokens; rewrite decorative utilities to read them.
- `src/components/ui/Logo.tsx` — generalize into event-driven `Wordmark`/`Mark` that delegate to the active event.
- `src/components/ui/GalaBackground.tsx` — keep as Hope Gala's background impl; expose a generic `<EventBackground>` indirection.
- `src/lib/db.ts` — add `event_id` filtering to every read, stamp every write, scope subscriptions.
- `src/lib/catalog.ts` — filter/extend built-in AR content per the active event's `arContent` manifest.
- `src/App.tsx` — drive the `/` landing redirect from `activeEvent.landingRoute`.
- `src/main.tsx` (or wherever the root renders / CSS imports happen) — import the active event's `theme.css` and inject its font link.
- `src/vite-env.d.ts` — type `VITE_EVENT`.
- `.env.example` — document `VITE_EVENT`.
- The ~20 components listed in Task 7 — swap hardcoded branding for `activeEvent` copy/components.

---

## Task 1: EventConfig types

**Files:**
- Create: `src/events/types.ts`

- [ ] **Step 1: Write the types**

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-event configuration contract. Every event supplies one EventConfig; all
 * event-specific branding, theming, copy, and AR content flows from it.
 */
import type { ComponentType } from 'react';

/** A single numbered step on the /join landing + onboarding. */
export interface EventStep {
  title: string;
  body: string;
}

/** All human-readable strings that differ per event. */
export interface EventCopy {
  /** Short brand/eyebrow line, e.g. "SCAGO · 2026". */
  eyebrow: string;
  /** Primary event name, e.g. "Hope Gala & Awards". */
  eventName: string;
  /** One-line tagline under the title. */
  tagline: string;
  /** Long-form event name used in footers/share text, e.g. "SCAGO Hope Gala & Awards 2026". */
  fullName: string;
  /** Thank-you line shown after a guest sends a photo. */
  thankYou: string;
  /** Onboarding/landing steps. */
  steps: EventStep[];
  /** Captured-photo file name prefix, e.g. "HopeGala2026". */
  filePrefix: string;
  /** navigator.share title. */
  shareTitle: string;
  /** navigator.share body text. */
  shareText: string;
}

/** Which AR catalog entries this event exposes. */
export interface EventARContent {
  /** Built-in shader ids to include (from src/lib/shaders.ts). Empty = all. */
  shaderIds?: string[];
  /** Built-in border ids to include (from src/lib/borders.ts). Empty = all. */
  borderIds?: string[];
  /** Built-in head-piece ids to include (from src/lib/headPieces.ts). Empty = all. */
  headPieceIds?: string[];
}

export interface EventConfig {
  /** Stable id === slug === DB event_id. */
  id: string;
  copy: EventCopy;
  /** Google Fonts stylesheet href to inject at runtime (or '' if none). */
  fontHref: string;
  /** The event's wordmark lockup. */
  Wordmark: ComponentType<{ size?: 'sm' | 'md' | 'lg' | 'xl' }>;
  /** The event's compact nav mark. */
  Mark: ComponentType;
  /** The event's ambient background (pointer-events-none, absolute inset-0). */
  Background: ComponentType<{ density?: number; className?: string }>;
  /** Path the "/" route redirects to, e.g. '/booth' or '/wall'. */
  landingRoute: string;
  arContent: EventARContent;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no references yet; types compile).

- [ ] **Step 3: Commit**

```bash
git add src/events/types.ts
git commit -m "feat(events): add EventConfig type contract"
```

---

## Task 2: Vitest setup

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest@^2`
Expected: adds `vitest` to devDependencies.

- [ ] **Step 2: Create the config**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json` `scripts`, add:
```json
"test": "vitest run"
```

- [ ] **Step 4: Verify the runner starts**

Run: `npm test`
Expected: PASS with "No test files found" (no tests yet) — exit code 0. If it errors, fix config before continuing.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for config unit tests"
```

---

## Task 3: Event id + registry + active resolution (TDD)

**Files:**
- Create: `src/events/eventId.ts`, `src/events/registry.ts`, `src/events/active.ts`, `src/events/active.test.ts`
- Depends on: a placeholder Hope Gala config (created minimally here, fleshed out in Task 6)

- [ ] **Step 1: Write the dependency-free id resolver**

```ts
// src/events/eventId.ts
/**
 * Resolves the active event id from the build env. Kept free of any React/asset
 * imports so the data layer can import it cheaply. id === slug === DB event_id.
 */
export const DEFAULT_EVENT_ID = 'hope-gala';

export function resolveEventId(raw?: string): string {
  const slug = (raw ?? '').trim();
  return slug.length ? slug : DEFAULT_EVENT_ID;
}

export const EVENT_ID = resolveEventId(import.meta.env.VITE_EVENT as string | undefined);
```

- [ ] **Step 2: Write the failing test**

```ts
// src/events/active.test.ts
import { describe, it, expect } from 'vitest';
import { resolveEventId, DEFAULT_EVENT_ID } from './eventId';
import { getEventConfig } from './registry';

describe('resolveEventId', () => {
  it('falls back to the default when env is missing or blank', () => {
    expect(resolveEventId(undefined)).toBe(DEFAULT_EVENT_ID);
    expect(resolveEventId('')).toBe(DEFAULT_EVENT_ID);
    expect(resolveEventId('   ')).toBe(DEFAULT_EVENT_ID);
  });
  it('uses a provided slug verbatim', () => {
    expect(resolveEventId('jenna-jake')).toBe('jenna-jake');
  });
});

describe('getEventConfig', () => {
  it('returns the requested event when registered', () => {
    expect(getEventConfig('hope-gala').id).toBe('hope-gala');
  });
  it('falls back to the default event for an unknown slug', () => {
    expect(getEventConfig('does-not-exist').id).toBe(DEFAULT_EVENT_ID);
  });
});
```

- [ ] **Step 2b: Create a minimal Hope Gala config stub so the registry compiles**

Create `src/events/hope-gala/config.ts` (fleshed out in Task 6 — for now a compiling stub):

```ts
import type { EventConfig } from '../types';

// NOTE: Wordmark/Mark/Background are wired to real components in Task 6.
const noop = () => null;

export const hopeGala: EventConfig = {
  id: 'hope-gala',
  copy: {
    eyebrow: 'SCAGO · 2026',
    eventName: 'Hope Gala & Awards',
    tagline: 'Scan to capture your AR moment',
    fullName: 'SCAGO Hope Gala & Awards 2026',
    thankYou: 'Thank you for being part of the Hope Gala!',
    steps: [
      { title: 'Scan QR', body: '' },
      { title: 'Select a Filter', body: '' },
      { title: 'Snap Photo', body: '' },
      { title: 'Share', body: '' },
    ],
    filePrefix: 'HopeGala2026',
    shareTitle: 'SCAGO Hope Gala & Awards 2026',
    shareText: 'My moment from the SCAGO Hope Gala & Awards 2026.',
  },
  fontHref:
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Pinyon+Script&family=Jost:wght@300;400;500;600&display=swap',
  Wordmark: noop,
  Mark: noop,
  Background: noop,
  landingRoute: '/booth',
  arContent: {},
};
```

- [ ] **Step 3: Write the registry**

```ts
// src/events/registry.ts
import type { EventConfig } from './types';
import { DEFAULT_EVENT_ID } from './eventId';
import { hopeGala } from './hope-gala/config';

const REGISTRY: Record<string, EventConfig> = {
  [hopeGala.id]: hopeGala,
};

export function getEventConfig(slug: string): EventConfig {
  return REGISTRY[slug] ?? REGISTRY[DEFAULT_EVENT_ID];
}
```

- [ ] **Step 4: Write active.ts**

```ts
// src/events/active.ts
import { EVENT_ID } from './eventId';
import { getEventConfig } from './registry';

export const activeEvent = getEventConfig(EVENT_ID);
export { EVENT_ID };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 4 passing tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/events/
git commit -m "feat(events): registry + env-driven active event resolution"
```

---

## Task 4: Semantic theme tokens in index.css

**Files:**
- Modify: `src/index.css`
- Create: `src/events/hope-gala/theme.css`

The goal: keep every existing Tailwind utility class name working and visually identical, but make its **values** come from semantic variables that an event can override.

- [ ] **Step 1: Add semantic variables to the `@theme` block in `src/index.css`**

Inside the existing `@theme { ... }` block (after the gold/ivory/noir scales), add semantic aliases that default to the Hope Gala values:

```css
  /* Semantic theme tokens — events override these in their theme.css */
  --color-brand-bg:      var(--color-noir-900);
  --color-brand-surface: var(--color-noir-700);
  --color-brand-fg:      var(--color-ivory);
  --color-brand-muted:   var(--color-champagne);
  --color-accent:        var(--color-gold-400);
  --color-accent-2:      var(--color-gold-200);
  --color-accent-3:      var(--color-gold-600);
```

- [ ] **Step 2: Make the decorative utilities read the semantic tokens**

In the `@layer utilities` block of `src/index.css`, add semantic aliases alongside the existing gold utilities (do NOT delete the gold ones yet — Task 7 migrates references, then a later step removes them):

```css
  /* Semantic decorative utilities (event-themable) */
  .text-foil { /* alias of .gold-foil, themable */
    background: linear-gradient(100deg, var(--color-accent-3) 0%, var(--color-accent-2) 22%, var(--color-brand-fg) 38%, var(--color-accent-2) 52%, var(--color-accent) 72%, var(--color-accent-3) 100%);
    background-size: 200% auto;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
    animation: foil-shimmer 6s linear infinite;
  }
  .text-foil-static {
    background: linear-gradient(120deg, var(--color-accent-3), var(--color-accent-2) 40%, var(--color-brand-fg) 50%, var(--color-accent) 70%, var(--color-accent-3));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }
  .text-accent { color: var(--color-accent); }
  .glow-accent { box-shadow: 0 0 40px -8px color-mix(in srgb, var(--color-accent) 45%, transparent); }
  .app-bg {
    background:
      radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 60%),
      radial-gradient(90% 60% at 10% 110%, color-mix(in srgb, var(--color-accent-3) 14%, transparent), transparent 60%),
      var(--color-brand-bg);
  }
```

- [ ] **Step 3: Create the Hope Gala theme.css (sets the values; identical to current look)**

```css
/* src/events/hope-gala/theme.css — values already match index.css defaults,
   so importing this is a no-op for Hope Gala but documents the override seam. */
:root {
  --color-brand-bg:      #0A0806;
  --color-brand-surface: #1A130C;
  --color-brand-fg:      #F7F1E3;
  --color-brand-muted:   #E9D9B8;
  --color-accent:        #D4AF37;
  --color-accent-2:      #EFD584;
  --color-accent-3:      #A67C1F;
}
```

- [ ] **Step 4: Import the active theme + inject the font**

In `src/main.tsx` (the entry that imports `index.css`), after the `index.css` import add the active event's theme import and font injection. Because Vite needs static import paths, import every event theme and select by id:

```ts
import './index.css';
import './events/hope-gala/theme.css';
// Future events add their theme import here; the cascade order means the
// active :root block wins because only one event ships per build env... but to
// be safe, scope each theme to a data attribute (see Step 5).
import { activeEvent } from './events/active';

// Inject the event's Google Fonts stylesheet.
if (activeEvent.fontHref) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = activeEvent.fontHref;
  document.head.appendChild(link);
}
// Tag <html> so event-scoped CSS can target the active event.
document.documentElement.dataset.event = activeEvent.id;
```

- [ ] **Step 5: Scope each event theme to its data attribute**

Change the Hope Gala `theme.css` `:root` selector to `:root[data-event='hope-gala']` so multiple imported themes don't collide:

```css
:root[data-event='hope-gala'] {
  --color-brand-bg:      #0A0806;
  /* ...rest unchanged... */
}
```

- [ ] **Step 6: Verify pixel-identical with the dev server**

Run: `npm run dev`, then with the preview tools open `/booth` and `/wall`. Take a screenshot. Compare to a screenshot from before this task (git stash if needed). The gold look must be unchanged.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/events/hope-gala/theme.css src/main.tsx
git commit -m "feat(theme): semantic CSS tokens + event-scoped theme import"
```

---

## Task 5: Generic Logo + Background indirection

**Files:**
- Modify: `src/components/ui/Logo.tsx`, `src/components/ui/GalaBackground.tsx`
- Create: `src/components/ui/EventBackground.tsx`, `src/components/ui/EventLogo.tsx`
- Modify: `src/events/hope-gala/config.ts` (wire real components)

- [ ] **Step 1: Create EventLogo.tsx**

```tsx
// src/components/ui/EventLogo.tsx
import { activeEvent } from '../../events/active';

export function Wordmark(props: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const C = activeEvent.Wordmark;
  return <C {...props} />;
}
export function Mark() {
  const C = activeEvent.Mark;
  return <C />;
}
```

- [ ] **Step 2: Create EventBackground.tsx**

```tsx
// src/components/ui/EventBackground.tsx
import { activeEvent } from '../../events/active';

export default function EventBackground(props: { density?: number; className?: string }) {
  const C = activeEvent.Background;
  return <C {...props} />;
}
```

- [ ] **Step 3: Wire the real Hope Gala components into its config**

In `src/events/hope-gala/config.ts`, replace the `noop` placeholders:

```ts
import { HopeGalaWordmark, HopeGalaMark } from '../../components/ui/Logo';
import GalaBackground from '../../components/ui/GalaBackground';
// ...
  Wordmark: HopeGalaWordmark,
  Mark: HopeGalaMark,
  Background: GalaBackground,
```

(Remove the `const noop` line.)

- [ ] **Step 4: Make Logo.tsx read its strings from the config copy**

In `src/components/ui/Logo.tsx`, replace the hardcoded `SCAGO · 2026`, `HOPE GALA`, `& Awards`, `Hope Gala & Awards` literals with values from `activeEvent.copy` (`eyebrow`, `eventName`). Keep the gold-foil/script styling — Hope Gala still looks the same. Example for the wordmark title line:

```tsx
import { activeEvent } from '../../events/active';
// ...
<span className={`font-label uppercase tracking-luxe text-brand-muted/70 ${scale.eyebrow} mb-2`}>
  {activeEvent.copy.eyebrow}
</span>
<span className={`font-serif font-semibold tracking-wide text-foil ${scale.title}`}>
  {activeEvent.copy.eventName}
</span>
```

- [ ] **Step 5: Typecheck + visual check**

Run: `npx tsc --noEmit` → PASS.
With dev server, confirm `/booth` and `/admin` still show the Hope Gala wordmark identically.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/ src/events/hope-gala/config.ts
git commit -m "feat(events): EventLogo/EventBackground indirection + wire Hope Gala"
```

---

## Task 6: Flesh out Hope Gala copy module

**Files:**
- Create: `src/events/hope-gala/copy.ts`
- Modify: `src/events/hope-gala/config.ts`

- [ ] **Step 1: Extract copy into its own module**

Move the `copy` object from `config.ts` into `src/events/hope-gala/copy.ts`:

```ts
import type { EventCopy } from '../types';

export const hopeGalaCopy: EventCopy = {
  eyebrow: 'SCAGO · 2026',
  eventName: 'Hope Gala & Awards',
  tagline: 'Scan to capture your AR moment',
  fullName: 'SCAGO Hope Gala & Awards 2026',
  thankYou: 'Thank you for being part of the Hope Gala!',
  steps: [
    { title: 'Scan QR', body: '' },
    { title: 'Select a Filter', body: '' },
    { title: 'Snap Photo', body: '' },
    { title: 'Share', body: '' },
  ],
  filePrefix: 'HopeGala2026',
  shareTitle: 'SCAGO Hope Gala & Awards 2026',
  shareText: 'My moment from the SCAGO Hope Gala & Awards 2026.',
};
```

- [ ] **Step 2: Reference it from config**

In `config.ts`: `import { hopeGalaCopy } from './copy';` and set `copy: hopeGalaCopy,`.

- [ ] **Step 3: Typecheck + test**

Run: `npx tsc --noEmit` → PASS. `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/events/hope-gala/
git commit -m "refactor(events): extract Hope Gala copy module"
```

---

## Task 7: Migrate component branding references

**Files (modify — replace hardcoded branding with `activeEvent` copy/components):**

| File | Replace |
|---|---|
| `src/components/JoinBooth.tsx` | `GalaBackground`→`EventBackground`; `ScagoMark`/title → `<Wordmark>`; `gold-foil`→`text-foil` |
| `src/components/MyPhotos.tsx` | `GalaBackground`→`EventBackground`; `HopeGalaWordmark`→`Wordmark`; filename `HopeGala_`→`copy.filePrefix`; share title/text → `copy.shareTitle`/`copy.shareText`; `gold-foil-static`→`text-foil-static` |
| `src/components/Booth.tsx` | `GalaBackground`→`EventBackground`; `ScagoMark` title string → `copy.fullName` |
| `src/components/booth/Welcome.tsx` | `HopeGalaWordmark`→`Wordmark` |
| `src/components/booth/Onboarding.tsx` | brand header strings → `copy.eyebrow`/`copy.eventName`; footer → `copy.fullName`; **move the SCAGO-specific challenge blurb (line 42) into `copy.steps` or a new `copy.onboardingBlurb`** so it isn't hardcoded |
| `src/components/booth/CameraError.tsx` | footer string → `copy.fullName` |
| `src/components/booth/SendOff.tsx` | thank-you → `copy.thankYou`; footer → `copy.eyebrow`/`copy.fullName`; `gold-foil`→`text-foil` |
| `src/components/booth/ReviewPanel.tsx` | filename `HopeGala2026-`→`copy.filePrefix`; share title → `copy.shareTitle` |
| `src/components/booth/StageCanvas.tsx` | watermark `'Hope Gala & Awards'` + `'SCAGO · 2026'` → `copy.eventName`/`copy.eyebrow` |
| `src/components/booth/Countdown.tsx` | `gold-foil`→`text-foil` |
| `src/components/booth/ChallengeSelector.tsx` | `gold-foil-static`→`text-foil-static` |
| `src/components/Wall.tsx` + `src/components/wall/*` (`MarqueeGrid`, `MosaicGrid`, `SlideshowView`, `LeaderboardView`, `BeamIn`) | `HopeGalaWordmark`→`Wordmark`; `SCAGO Hope Gala…` strings → `copy.fullName`; `gold-foil*`→`text-foil*` |
| `src/components/admin/*` (`AdminGate`, `Dashboard`, `Library`, `Assets`, `Challenges`, `Moderation`, `Settings`, `Creator2D`, `Creator3D`) | `GalaBackground`→`EventBackground`; `HopeGalaWordmark`/`HopeGalaMark`→`Wordmark`/`Mark`; `Hope Gala…` strings → `copy.*`; `gold-foil*`→`text-foil*` |

- [ ] **Step 1: Find every reference**

Run: `git grep -nE "Hope Gala|SCAGO|HopeGala|GalaBackground|gold-foil"` and work the list top-to-bottom. Each component imports from the event layer:
- `import EventBackground from '...ui/EventBackground'` (replaces `GalaBackground` import + JSX usage; keep the `density` prop).
- `import { Wordmark, Mark } from '...ui/EventLogo'`.
- `import { activeEvent } from '...events/active'` then use `activeEvent.copy.*`.

`ScagoMark` is a Hope-Gala emblem — leave it where Hope Gala uses it directly inside its own Logo/Onboarding, but for shared surfaces prefer `<Mark>`/`<Wordmark>`. Do not move `ScagoMark` into the generic layer.

- [ ] **Step 2: Typecheck after each file batch**

Run: `npx tsc --noEmit` after every few files. Expected: PASS.

- [ ] **Step 3: Visual regression check (whole app)**

With the dev server, walk `/`, `/booth`, `/wall`, `/me`, `/join`, `/admin` and each admin page. Screenshot key views. Hope Gala must look unchanged. Capture a photo end-to-end and confirm the watermark still reads "Hope Gala & Awards / SCAGO · 2026".

- [ ] **Step 4: Remove now-dead gold utilities (optional cleanup)**

Once `git grep -nE "gold-foil|gala-bg|glow-gold"` returns no component hits, you may delete those legacy utilities from `index.css`. If anything still references them, leave them. Re-run the dev server after.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(events): drive all branding from active event config"
```

---

## Task 8: Per-event AR catalog

**Files:**
- Modify: `src/lib/catalog.ts`

- [ ] **Step 1: Filter built-ins by the active event's manifest**

In `src/lib/catalog.ts`, import the active event and apply its `arContent` allow-lists. Replace `builtinExperiences()` body:

```ts
import { activeEvent } from '../events/active';

function pick<T extends { id: string }>(all: T[], ids?: string[]): T[] {
  if (!ids || ids.length === 0) return all;        // empty = include all
  const set = new Set(ids);
  return all.filter((x) => set.has(x.id));
}

export function builtinExperiences(): Experience[] {
  const ar = activeEvent.arContent;
  const shaders = pick(FILTER_SHADERS, ar.shaderIds);
  const borders = pick(BUILTIN_BORDERS, ar.borderIds);
  const pieces = pick(HEAD_PIECES, ar.headPieceIds);
  return [
    ...pieces.map((p, i) => ({ ...base(`builtin:3d:${p.id}`, p.name, 50 + i), kind: '3d_attachment' as const, asset_url: null, config: { procedural: p.id, anchor: p.config } })),
    ...shaders.map((s, i) => ({ ...base(`builtin:shader:${s.id}`, s.name, 100 + i), kind: 'shader' as const, asset_url: null, config: { shader: { shaderId: s.id, params: defaultParams(s.id) } } })),
    ...borders.map((b, i) => ({ ...base(`builtin:border:${b.id}`, b.name, 200 + i), kind: b.kind, asset_url: toDataUrl(b.svg), config: { transform: { scale: 1, x: 0, y: 0, rotation: 0 }, opacity: 1 } })),
  ];
}
```

Keep the existing `builtinShaderExperiences`/`builtinBorderExperiences`/`builtinHeadPieceExperiences` exports (other code may import them) but have them call `pick(...)` the same way. Hope Gala's `arContent` is `{}` (empty = all), so its catalog is unchanged.

- [ ] **Step 2: Typecheck + visual check**

Run: `npx tsc --noEmit` → PASS. In the booth, confirm the filter drawer still shows every built-in for Hope Gala.

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalog.ts
git commit -m "feat(events): scope built-in AR catalog to active event"
```

---

## Task 9: Database event_id partitioning

**Files:**
- Supabase (via MCP `apply_migration`)
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Inspect current schema**

Use the Supabase MCP `list_tables` for `experiences`, `posts`, `challenges`, `app_settings`. Note the existing primary key / unique constraint on `app_settings` (the `key` column).

- [ ] **Step 2: Apply the migration**

Use `apply_migration` (name: `add_event_id`) with:

```sql
-- 1. add nullable event_id everywhere
alter table experiences  add column if not exists event_id text;
alter table posts         add column if not exists event_id text;
alter table challenges    add column if not exists event_id text;
alter table app_settings  add column if not exists event_id text;

-- 2. backfill existing rows to the first event
update experiences  set event_id = 'hope-gala' where event_id is null;
update posts         set event_id = 'hope-gala' where event_id is null;
update challenges    set event_id = 'hope-gala' where event_id is null;
update app_settings  set event_id = 'hope-gala' where event_id is null;

-- 3. enforce + default
alter table experiences  alter column event_id set not null, alter column event_id set default 'hope-gala';
alter table posts         alter column event_id set not null, alter column event_id set default 'hope-gala';
alter table challenges    alter column event_id set not null, alter column event_id set default 'hope-gala';
alter table app_settings  alter column event_id set not null;

-- 4. app_settings is now keyed by (event_id, key)
alter table app_settings drop constraint if exists app_settings_pkey;
alter table app_settings drop constraint if exists app_settings_key_key;
alter table app_settings add constraint app_settings_event_key unique (event_id, key);

-- 5. helpful indexes
create index if not exists idx_experiences_event on experiences(event_id);
create index if not exists idx_posts_event on posts(event_id);
create index if not exists idx_challenges_event on challenges(event_id);
```

If `app_settings` had a different PK column (e.g. an `id`), adapt step 4 to add the composite unique without dropping a surrogate PK. Verify with `list_tables` afterward.

- [ ] **Step 3: Add event_id to every read in db.ts**

Add `.eq('event_id', EVENT_ID)` to each select query: `fetchExperiences`, `getExperience`, `fetchPosts`, `fetchMyPosts`, `fetchChallenges`, the `fetchLeaderboard` posts query, and the `getSetting`/`getWallSettings`/`getLandingContent`/`getPresetOverrides` `app_settings` selects (`.eq('key', …).eq('event_id', EVENT_ID)`).

Import once at top: `import { EVENT_ID } from '../events/eventId';`

- [ ] **Step 4: Stamp event_id on every write**

Add `event_id: EVENT_ID` to the insert/upsert payloads in: `createExperience`, `submitPost`, `createChallenge`, `setWallSettings`, `setSetting`. For the `app_settings` upserts, change `onConflict: 'key'` → `onConflict: 'event_id,key'`.

- [ ] **Step 5: Scope realtime subscriptions**

In `subscribeToPosts`, add `filter: 'event_id=eq.' + EVENT_ID` to each `postgres_changes` config. In `subscribeToSettings` and `subscribeToLanding`, change the filter to `event_id=eq.<EVENT_ID>` and check the row's `key` inside the callback (realtime allows only one equality filter):

```ts
.on('postgres_changes',
  { event: '*', schema: 'public', table: 'app_settings', filter: `event_id=eq.${EVENT_ID}` },
  (payload) => {
    const row = payload.new as { key?: string; value?: Partial<WallSettings> };
    if (row.key !== 'wall') return;
    if (row.value) onChange({ ...DEFAULT_WALL_SETTINGS, ...row.value });
  })
```

- [ ] **Step 6: RLS hardening (scope anon writes per event)**

Add an RLS policy migration (`name: rls_event_scope`) — adjust to your existing policy setup; if RLS is currently disabled and you rely on anon key only, document that and skip enforcement:

```sql
-- Example: allow anon to insert posts only with a non-null event_id.
-- (Hard cross-event read isolation is NOT enforced on a shared anon key —
--  documented tradeoff. Move a high-stakes event to its own project to harden.)
```

- [ ] **Step 7: Verify end-to-end**

With the dev server (`VITE_EVENT` unset → hope-gala): capture a photo, confirm it appears on `/wall`, confirm the new `posts` row has `event_id='hope-gala'` (check via Supabase MCP `execute_sql: select event_id,count(*) from posts group by 1`). Confirm admin settings still load/save.

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(db): partition all backend I/O by event_id"
```

---

## Task 10: Env typing, example, and EVENTS.md

**Files:**
- Modify: `src/vite-env.d.ts`, `.env.example`
- Create: `docs/EVENTS.md`

- [ ] **Step 1: Type VITE_EVENT**

In `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_EVENT?: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_ADMIN_PASSCODE: string;
  readonly VITE_GEMINI_API_KEY?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
```

- [ ] **Step 2: Document the env var**

Add to `.env.example`:

```
# Which event this build renders (folder name under src/events/). Default: hope-gala
VITE_EVENT="hope-gala"
```

- [ ] **Step 3: Write docs/EVENTS.md**

````markdown
# Adding an Event

Each event is one folder under `src/events/<slug>/` and one Netlify site.

## 1. Create the event folder
- `config.ts` (exports an `EventConfig`), `copy.ts`, `theme.css`
  (`:root[data-event='<slug>'] { … }`), `Logo.tsx`, `Background.tsx`, `arContent.ts`.

## 2. Register it
- Add the config to `src/events/registry.ts`.
- Import its `theme.css` in `src/main.tsx`.

## 3. Create the Netlify site
- New site from this repo, branch `main`, build `npm run build`, publish `dist`.
- Env vars: `VITE_EVENT=<slug>`, plus `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_ADMIN_PASSCODE`. (`netlify.toml` is shared.)

## 4. Data
- All tables carry `event_id`; the build stamps rows with `<slug>` automatically.
- Note: a shared Supabase + shared anon key means isolation is app-level. For a
  high-stakes event, point its Netlify env at a separate Supabase project.

Push to `main` → every event's Netlify site rebuilds with the change.
````

- [ ] **Step 4: Final verification**

Run: `npm test` → PASS. `npx tsc --noEmit` → PASS. `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/vite-env.d.ts .env.example docs/EVENTS.md
git commit -m "docs: event env typing + EVENTS.md guide"
```

---

## Self-review notes

- **Spec coverage:** event config system (T1,3,6), semantic theming (T4,5,7), data partitioning (T9), deploy docs (T10), per-event AR mechanism (T8). All §1 foundation items covered.
- **Pixel-identical guarantee:** Tasks 4/5/7 each end with a visual check against Hope Gala. The festival event's *content* is Plan 2.
- **Type consistency:** `EVENT_ID`/`activeEvent`/`getEventConfig`/`EventConfig.copy.*` names are used identically across tasks.
- **Known live step:** none in this plan — it is fully specifiable. The palette/logo selection lives in Plan 2.
