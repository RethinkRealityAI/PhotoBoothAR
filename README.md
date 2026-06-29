# Hope Gala 2026 — AR Photo Booth & Live Wall

An immersive, face-tracked AR photo-booth platform for the **SCAGO Hope Gala & Awards**
(Sat June 13, 2026 · Renaissance by the Creek, Mississauga ON). Guests capture magical
gold-themed photos with AR filters, shaders, frames and 3D head pieces, then beam them to a
live photo wall projected throughout the night — and download their own photos afterward.

Built with Vite · React 19 · TypeScript · Tailwind v4 · Three.js (R3F) · MediaPipe
FaceLandmarker · **Supabase** (Postgres + Storage + Realtime).

---

## Quick links (the night of)

| What | URL |
|------|-----|
| 🎟️ **Guest booth** (QR this) | `https://scago-hopegala-booth.netlify.app/` |
| 🖼️ **Live wall** (projector, use "Project" mode) | `https://scago-hopegala-booth.netlify.app/wall` |
| 📥 **Get your photos** (guests) | `https://scago-hopegala-booth.netlify.app/me` |
| 🛠️ **Studio / admin** (passcode `hopegala2026`) | `https://scago-hopegala-booth.netlify.app/admin` |

> The booth needs **camera access**, which requires **HTTPS** — always use the Netlify URL
> on phones (localhost is fine for dev). On the projector, open `/wall` and tap **Project**
> for full-screen, chrome-free slideshow.

## Routes

- `/` , `/booth` — guest photo booth (Look + Filter pickers, capture, send-off animation)
- `/experience/:id` — booth pre-loaded with a specific published experience (QR per filter)
- `/wall` — projected live wall: **Gallery** (mosaic), **Slideshow**, **Project** (kiosk)
- `/upload` — passcode-gated guest upload: bulk drag-and-drop photos/videos, wrap images in any
  frame (pan/zoom crop), add name + message, post to the wall
- `/me` , `/gallery` — a guest's own photos (persists on their device), download / share
- `/admin` — studio dashboard (passcode-gated)
  - `/admin/library` — manage & publish experiences, QR codes, duplicate/delete
  - `/admin/creator` — author 2D stickers, borders & shader looks (drag-to-place on live feed)
  - `/admin/creator3d` — place 3D models on head anchor points with live WYSIWYG preview
  - `/admin/moderation` — show/hide/delete posts on the wall in real time

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:5180
```

## Environment (`.env.local`)

```
VITE_SUPABASE_URL=https://zrtftliozslrjomxbfrr.supabase.co
VITE_SUPABASE_ANON_KEY=<anon/publishable key>
VITE_ADMIN_PASSCODE=hopegala2026
VITE_UPLOAD_PASSCODE=          # passcode for the /upload page (falls back to VITE_ADMIN_PASSCODE)
VITE_GEMINI_API_KEY=            # optional — enables "AI Generate" in the 2D studio
```

`VITE_*` vars are inlined at **build** time. Change the admin passcode before the event and
rebuild. The Supabase anon key is meant to be public.

## Deploy

The static build deploys to Netlify (site `scago-hopegala-booth`, already linked):

```bash
npm run build                       # outputs dist/
netlify deploy --prod --dir=dist    # promote to https://scago-hopegala-booth.netlify.app
```

Use `netlify deploy --dir=dist` (no `--prod`) for a throwaway preview URL first.

## Architecture

- **Data layer** — all backend I/O goes through `src/lib/db.ts` (experiences, posts, realtime,
  storage). State in `src/store.ts` (zustand). Guest "my photos" persistence in `src/lib/session.ts`.
- **Face AR** — `src/lib/faceRig.ts` (named head anchors + head-pose math) and
  `src/components/ar/FaceRig.tsx` (`<FaceRig>`, `<Model>`), shared by the booth and the 3D
  editor so placement is true WYSIWYG. Engine: MediaPipe FaceLandmarker.
- **Shaders** — `src/lib/shaders.ts`: a WebGL `ShaderRunner` + 7 gala color grades (Golden
  Hour, Soft Glam, Noir & Gold, Champagne Bloom, Gilded Duotone, Cinéma, Sparkle). Live + capture.
- **Borders/overlays** — `src/lib/borders.ts`: curated gold SVG frames (incl. a hexagon motif
  from the invitation) and sparkle/confetti overlays.
- **Catalog** — `src/lib/catalog.ts` merges built-in filters (always available) with custom
  studio experiences from Supabase.
- **Theme** — `src/index.css`: champagne-gold / ivory / warm-noir tokens, gold-foil text,
  glass, bokeh dust. Shared UI in `src/components/ui/`.

See `docs/FOUNDATION.md` for the full internal API.

## Backend (Supabase `zrtftliozslrjomxbfrr`)

- Tables: `experiences`, `posts`. Buckets: `posts`, `assets` (public). Realtime on both tables.
- **Security note:** ships with permissive anon RLS + a client-side admin passcode for the
  single-night event. Harden with Supabase Auth afterward.
