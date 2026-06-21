# Adding an Event

This app is a white-label platform. Each event is **one folder** under
`src/events/<slug>/` plus **one Netlify site**, all built from the same `main`
branch. The event id **equals its slug** and is also the database `event_id`.

Push to `main` → every event's Netlify site rebuilds with the change. No forking.

## 1. Create the event folder

`src/events/<slug>/`:
- `config.ts` — exports an `EventConfig` (see `src/events/types.ts`).
- `copy.ts` — the event's `EventCopy` strings.
- `theme.css` — semantic-token values scoped to the event:
  `:root[data-event='<slug>'] { --color-brand-bg: …; --color-accent: …; … }`.
  To recolor the bulk of the UI, also override the underlying scale tokens this
  event reuses (`--color-gold-*`, `--color-champagne`, `--color-noir-*`, etc.).
- `Logo.tsx` — the event's `Wordmark({size})` and `Mark()` components.
- `Background.tsx` — the event's ambient background (`pointer-events-none`,
  `absolute inset-0`, accepts `{ density?, className? }`).
- `arContent.ts` (optional) — `EventARContent` listing the built-in shader /
  border / head-piece ids this event exposes. **An empty/omitted list = include
  all.** Pin existing events to explicit id lists before adding new shared AR
  effects, so additions don't leak into them.

## 2. Register it

- Add the config to `src/events/registry.ts`.
- Import its `theme.css` in `src/main.tsx`.

## 3. Create the Netlify site

New Netlify site from this repo, branch `main`, build `npm run build`, publish
`dist` (`netlify.toml` is shared). Environment variables:

| Var | Value |
| --- | --- |
| `VITE_EVENT` | `<slug>` |
| `VITE_SUPABASE_URL` | shared project URL |
| `VITE_SUPABASE_ANON_KEY` | shared anon key |
| `VITE_ADMIN_PASSCODE` | per-event passcode |
| `VITE_GEMINI_API_KEY` | optional |

## 4. Data

All event tables (`experiences`, `posts`, `challenges`, `app_settings`) carry an
`event_id` column; the build stamps every write with `<slug>` and filters every
read by it (`src/lib/db.ts`). `app_settings` is keyed by `(event_id, key)`.

### Isolation tradeoff (important)

The Supabase project and anon key are **shared** across events, and the table RLS
policies are permissive (`USING (true)`). So event isolation is enforced by the
**app** (the `event_id` filter), not by the database — a determined client could
query another event's public photos. This is acceptable for non-sensitive,
already-public wall images.

**To harden a high-stakes event:** point that event's Netlify env at its own
separate Supabase project. No code changes are needed — backend selection is
already env-driven.
