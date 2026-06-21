# Multi-Event Platform — Design Spec

**Date:** 2026-06-21
**Status:** Approved (architecture), pending spec review
**Author:** Dapo + Claude

## Problem

The app is a single-event AR photo booth, hardcoded for the **SCAGO Hope Gala 2026**.
Branding, palette, copy, and AR content are baked into ~30 files; the Supabase
backend has no notion of "which event." We want to run a **second event** — Jenna &
Jake's EDM-festival wedding — and future events, **without forking the project**.

Goal: one shared codebase. Each event supplies its own theme, assets, copy, logo, and
AR content as isolated config. Each event publishes to its own Netlify site from the
same `main` branch, so platform updates propagate to every event automatically.

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Data isolation | **Shared Supabase, partition by `event_id`** | One backend to operate; acceptable for non-sensitive public photo data. |
| Deploy model | **One repo/branch → many Netlify sites, event chosen by env var** | Push to `main`, every event rebuilds with the update. No divergence. |
| New-event scope | **Full festival build** | New logo, palette, shader-orb background, photo-wall landing, festival AR content. |

## Architecture

### Sub-project 1 — Multi-event foundation

#### 1.1 Event config system

A single source of per-event truth, selected at build time.

```
src/events/
  types.ts          # EventConfig interface
  registry.ts       # slug -> EventConfig
  active.ts         # reads VITE_EVENT, exports active config (+ id); defaults to 'hope-gala'
  hope-gala/
    config.ts  theme.css  Logo.tsx  Background.tsx  arContent.ts
  jenna-jake/
    config.ts  theme.css  Logo.tsx  Background.tsx  arContent.ts
```

`EventConfig` fields:

- `id: string` — the DB `event_id` (e.g. `'hope-gala'`, `'jenna-jake'`).
- `slug: string` — folder/env identifier.
- `name`, `copy` — display name + all event strings (taglines, landing steps, eyebrow,
  CTA, footer, admin labels). Replaces hardcoded "Hope Gala / SCAGO" strings.
- `theme` — semantic token values (see 1.2) + font family names + Google-Fonts import URL.
- `Logo`, `Mark` — React components (wordmark lockup + compact nav mark).
- `Background` — React component for the ambient backdrop.
- `landingRoute: string` — path `/` redirects to (`'/booth'` for gala, `'/wall'` for festival).
- `features` — feature flags (e.g. `showChallenges`, default wall mode).
- `arContent` — manifest: which built-in shaders/borders/head-pieces to include +
  event-specific AR entries.

`active.ts`:
```ts
const slug = (import.meta.env.VITE_EVENT as string) ?? 'hope-gala';
export const activeEvent = registry[slug] ?? registry['hope-gala'];
export const EVENT_ID = activeEvent.id;
```

#### 1.2 Theming mechanism — semantic CSS-variable tokens

Today the palette is hardcoded gold (`--color-gold-400`, `.gala-bg`, `.gold-foil`).

Introduce a **semantic layer** in `index.css` `@theme`:
`--brand-bg`, `--brand-fg`, `--accent`, `--accent-2`, `--accent-3`, `--surface`,
`--glow`, plus font vars. Rewrite the decorative utilities to read these variables:
`.app-bg` (was `.gala-bg`), `.text-foil` (was `.gold-foil`), `.text-accent`,
`.glow-accent` (was `.glow-gold`), `.glass`/`.glass-strong`.

Each event ships `theme.css` that:
1. Sets the semantic variable **values** for that event.
2. Where the *vibe* differs structurally (gala metallic foil vs festival animated neon
   gradient), supplies its own keyframes/gradients **bound to the same semantic class
   names**.

`active.ts` / app bootstrap imports the active event's `theme.css` and injects its font
`<link>`. Components reference **semantic classes only** — never `gold-*`.

**Migration:** mechanical search-replace of `gold-*` / `gala-*` / `glow-gold` references
across components to the semantic names. Verified against the running dev server with the
preview tools so **Hope Gala renders pixel-identical** afterward.

Rejected alternative: a separate prebuilt CSS bundle per event imported by env — fights
Vite static analysis and duplicates the utility layer.

#### 1.3 Data partitioning (`event_id`)

Supabase migration (via Supabase MCP):
1. Add `event_id text` (nullable) to `experiences`, `posts`, `challenges`, `app_settings`.
2. Backfill all existing rows to `'hope-gala'`.
3. Set `NOT NULL`. For `app_settings`, the primary key becomes `(event_id, key)`.

[db.ts](../../../src/lib/db.ts): every read adds `.eq('event_id', EVENT_ID)`; every
write stamps `event_id: EVENT_ID`. Realtime subscriptions filter on `event_id`.

**Isolation tradeoff (accepted):** the anon key is shared across sites, so `event_id`
filtering is enforced by the **app**, not hard security — public photos of another event
are technically queryable. Acceptable for non-sensitive, already-public wall images. RLS
will scope anon writes per event. **Hardening path:** move a high-stakes event to its own
Supabase project later — trivial, since backend selection is already env-driven.

#### 1.4 Deployment

`netlify.toml` stays shared. Each event = one Netlify site, same repo + `main` branch:

| Env var | Example |
|---|---|
| `VITE_EVENT` | `jenna-jake` |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | shared project |
| `VITE_ADMIN_PASSCODE` | per-event passcode |

Push to `main` → all sites rebuild. Documented in `docs/EVENTS.md` (how to add an event).

### Sub-project 2 — Jenna & Jake EDM festival event

- **Logo (SVG):** "Jenna & Jake" lockup — names inside a heart whose top edge is a pair of
  festival sunglasses, lenses reflecting a holographic gradient. Animated neon fill.
  Compact `Mark` = heart-glasses icon alone.
- **Palette:** vivid EDM — electric magenta / cyan / violet / lime over deep midnight,
  neon glows, holographic gradients. **2–3 palette + logo options shown for selection
  before finalizing.**
- **Background:** R3F **shader orbs** — drifting, bloom-lit gradient spheres via a soft
  fragment shader (reuses existing Three.js setup) as the ambient `Background`.
- **Landing:** photo wall (`landingRoute: '/wall'`).
- **Festival AR content:** neon sunglasses head-piece; glow/neon/holographic shaders
  (light-leak, chromatic, laser-sparkle); festival frames (neon borders, "JENNA & JAKE"
  lower-third, equalizer bars).
- **Copy:** festival-toned strings throughout.
- **Backend:** `event_id = 'jenna-jake'` row data; Netlify site + env.

## Implementation phasing

1. **Foundation:** event config system + semantic theming + DB `event_id` migration +
   refactor Hope Gala into the first event config (zero visual change — proves the
   abstraction).
2. **Jenna & Jake content:** palette, logo, shader-orb background, festival AR assets,
   wall-landing, copy.
3. **Deploy docs + Netlify wiring** (`docs/EVENTS.md`).

## Non-goals / YAGNI

- No runtime multi-tenant routing (subdomain/path switching) — env-per-site is enough.
- No admin UI for creating events — events are code+config, added by a developer.
- No per-event separate Supabase projects in this pass (documented as future hardening).

## Success criteria

- `VITE_EVENT=hope-gala` build is pixel-identical to today.
- `VITE_EVENT=jenna-jake` build shows the festival theme, logo, shader-orb background,
  photo-wall landing, and festival AR content.
- Each event's photos/wall/filters are partitioned by `event_id`; no cross-event bleed in
  the app.
- A platform change merged to `main` appears on both Netlify sites after rebuild.
