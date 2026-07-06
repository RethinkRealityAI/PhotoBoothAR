# Beamwall — Go-Live / Operator Checklist

Everything needed to take the platform (PR #5) from "merged" to "live and
charging". The platform is **safe-by-default**: every integration below degrades
gracefully until its key is set, so you can enable them one at a time.

Supabase project: `zrtftliozslrjomxbfrr`. All migrations 001–010 and all edge
functions (incl. `admin-api`, `stripe-webhook`) are **already applied/deployed** to it. Set secrets in
**Supabase → Project Settings → Edge Functions → Secrets** (or `supabase secrets set`).

---

## 0. Before merging PR #5 — protect the 3 live sites  ⚠️ REQUIRED

These are the only steps that must happen **before** `main` changes, because
today all three legacy Netlify sites build from `main`.

- [ ] In Netlify, repoint each legacy site's **production branch** to
      `legacy-events` (Site config → Build & deploy → Branches):
      **galabooth**, **jennajake**, **theadetoyis**.
      (The `legacy-events` branch is already pushed, frozen at the pre-platform tip.)
- [ ] Create the new platform site **`beamwall`** (Netlify): link this repo,
      production branch `main`, build `npm run build`, publish `dist`. Env:
      `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same values as the legacy
      sites). **Do NOT set `VITE_EVENT`** — its absence is what makes `/` the
      marketing/login page.
- [ ] After the first `beamwall` deploy, verify all three legacy sites still
      load, capture, and beam (they read the same DB; migration 003 grandfathers
      their anon access).

> These two Netlify actions couldn't be automated from the build container
> (MCP writes were approval-gated); they're ~2 minutes each in the Netlify UI.

## 1. Auth (Supabase) — needed for any host to sign up

- [ ] Supabase → Authentication: confirm **Email** sign-in is on (email
      confirmation recommended — the Legacy-org auto-claim only fires on a
      *confirmed* `dapo@rethinkreality.ai` signup).
- [ ] (Optional) Enable **Google OAuth** (client id/secret in Supabase Auth →
      Providers; the app already calls `signInWithGoogle`).
- [ ] Sign up once as `dapo@rethinkreality.ai` and confirm → this claims the
      "Legacy Events" org so the 3 legacy events appear in your `/host` dashboard.
- [ ] **Platform admin** — migration `009` seeds `dapo@rethinkreality.ai` into
      `platform_admins` (and re-claims on confirm), so the cross-tenant super-admin
      console at `/admin` unlocks with that same login (no separate password). In-UI
      add/remove of other admins ships with the admin suite (PR #10, Phase 5); until
      then grant one by inserting into `platform_admins`. See [ADMIN-SUITE.md](ADMIN-SUITE.md).

## 2. AI generation — Gemini (default), then Meshy / Higgsfield

- [ ] `GEMINI_API_KEY` — enables AI frame/sticker generation (was the old
      client-side `VITE_GEMINI_API_KEY`, now server-only). Without it,
      image gen returns `ai_not_configured` (credits auto-refunded).
- [ ] `MESHY_API_KEY` — enables 3D-prop generation (image/text → GLB).
- [ ] `HIGGSFIELD_API_KEY` + `HIGGSFIELD_API_URL` — optional premium image
      provider; Gemini is the default and works alone.

## 3. Billing — Stripe (test first)

- [ ] `STRIPE_SECRET_KEY` (test mode to start).
- [ ] Add a Stripe **webhook endpoint** →
      `https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/stripe-webhook`
      with events `checkout.session.completed`,
      `customer.subscription.updated`, `customer.subscription.deleted`. Copy its
      signing secret into `STRIPE_WEBHOOK_SECRET`.
- [ ] Test: buy an event package / credit pack / Pro sub in test mode → confirm
      `event_plans` / `subscriptions` / `credit_ledger` update and the watermark
      drops on that event. (No Stripe products to pre-create — prices are inline.)

## 4. Greeting-card email — Resend

- [ ] `RESEND_API_KEY` — enables the "email this card" button. Without it,
      publish still works; email returns `email_not_configured`.
- [ ] `PUBLIC_SITE_URL` (e.g. `https://beamwall.app` or the beamwall Netlify URL)
      — used as the card-link domain in emails (hardcoded fallback otherwise).
- [ ] (Optional) `CARDS_FROM_EMAIL` — verified Resend sender
      (default `Beamwall <cards@beamwall.app>`; must be a domain you've verified
      in Resend).

## 5. Keepsake MP4 film — HeyGen HyperFrames (Deluxe add-on)

Ships **disabled** by default (`card-render` returns `render_not_configured`,
credits refunded). To enable:

- [ ] Upload the composition `hyperframes/keepsake-film/` (index.html +
      gsap.min.js) to HeyGen HyperFrames once → record its **asset id**.
- [ ] `RENDER_BACKEND=hyperframes`, `HEYGEN_HYPERFRAMES_API_KEY`,
      `HEYGEN_HYPERFRAMES_ASSET_ID` (+ optional `HEYGEN_HYPERFRAMES_API_URL`).
- [ ] ⚠️ **Validate the cloud render contract** — the submit/poll API shape is an
      informed assumption (no public HeyGen REST docs were reachable); it's
      isolated to one place in `card-render`/`card-render-status`. Confirm
      endpoints/fields against the real API before charging for films. Fallback:
      the AWS-Lambda self-host path (`npx hyperframes lambda`).
- [ ] ⚠️ Validate **video** contributions render on the cloud producer (the local
      producer composites runtime `<video>` as a themed backdrop + caption; the
      web card plays video fine). Consider a poster-still treatment if needed.

## 6. Custom domains (later)

Point `beamwall.app` (or chosen domain) at the beamwall Netlify site. Per-event
custom subdomains are a future enhancement (a `custom_domains` table +
hostname→slug resolution — not built yet).

---

## Verification once keys are in

- `supabase/tests/rls-probes.sql` → all PASS (tenant isolation).
- End-to-end on beamwall: signup → create event → QR → AR capture → wall →
  AI frame (Gemini) → publish a card → email → (Deluxe) render film.
- The three legacy sites: capture → wall, unchanged.

## Where the money model lives

Pricing/packaging is in
`docs/superpowers/specs/2026-07-03-saas-platform-strategy.md` (§2–§4). Credit
costs and tier entitlements are the single source of truth in
`src/lib/entitlements.ts` (client) mirrored in the edge functions (server).
