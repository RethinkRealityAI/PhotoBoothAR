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

## 1b. Auth email / SMTP  ⚠️ LAUNCH GATE — blocks beta invites

Supabase's **built-in SMTP is best-effort and rate-limited to roughly 2–4
emails per hour** (shared infra, no deliverability guarantees). Every signup
confirmation, magic link, and password reset goes through it — at beta scale
invites will silently stall in the queue. **Do not send beta invites until a
custom SMTP provider is wired.**

Steps (recommended provider: **Resend** — we already plan `RESEND_API_KEY` for
card email in §4, so one account covers both):

- [ ] In Resend: **Domains → Add domain** for your sender domain (e.g.
      `rethinkreality.ai` or `beamwall.app`) and add the DKIM/SPF DNS records it
      shows; wait for the domain to read **Verified**.
- [ ] In Resend: create an **API key**. For SMTP, the key doubles as the
      password.
- [ ] Supabase Dashboard → **Project Settings → Auth → SMTP Settings** (project
      `zrtftliozslrjomxbfrr`): enable **Custom SMTP** with
      - Host: `smtp.resend.com`
      - Port: `465` (or `587` STARTTLS)
      - Username: `resend`
      - Password: *the Resend API key*
      - Sender address: a verified-domain address, e.g.
        `Beamwall <auth@beamwall.app>` (must match the verified domain)
- [ ] Same page: raise the **email rate limit** from the default to a sane beta
      value (e.g. 100/hour) — the default cap stays low even after custom SMTP
      until you change it.
- [ ] **Verify delivery**: sign up on the deployed site with a fresh address
      (e.g. a `+smtp-test` alias) and confirm the confirmation email lands in
      **under a minute**, from your sender address, not spam-foldered. Also
      trigger **Forgot password** once and confirm that email arrives too.

Until every box above is checked, treat beta invites as **blocked**.

## 2. AI generation — Gemini (default), then Meshy / Higgsfield

- [x] `GEMINI_API_KEY` — **SET (2026-07-07)**; rotate post-deploy and restrict
      the new key to the Generative Language API in Google Cloud console.
      Enables AI frame/sticker generation (server-only). Without it,
      image gen returns `ai_not_configured` (credits auto-refunded).
      Also powers `ai-event-designer` (the /host/new Event Concierge chat);
      without the key it returns `ai_not_configured` and the client falls
      back to the local keyword planner — the chat flow keeps working.
- [ ] `MESHY_API_KEY` — enables 3D-prop generation (image/text → GLB).
- [ ] `HIGGSFIELD_API_KEY` + `HIGGSFIELD_API_URL` — optional premium image
      provider; Gemini is the default and works alone.

## 3. Billing — Stripe (test first)

- [x] `STRIPE_SECRET_KEY` (test/sandbox mode) — set 2026-07-06.
- [x] Stripe **webhook endpoint** →
      `https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/stripe-webhook`
      with events `checkout.session.completed`, `invoice.payment_succeeded`,
      `customer.subscription.updated`, `customer.subscription.deleted`.
      `STRIPE_WEBHOOK_SECRET` set 2026-07-06.
- [x] Test `credit_pack` in test mode → confirmed 2026-07-06: real checkout session,
      webhook signature verified, `credit_ledger` + `orders` both updated correctly.
- [ ] Test `event_package` and `pro_subscription` the same way (only `credit_pack` has
      been proven end-to-end so far) — confirm `event_plans`/`subscriptions` update and
      the watermark drops on that event.
- [ ] **Go live**: swap `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` for LIVE-mode values
      — this means a NEW webhook endpoint in Stripe's live mode (test-mode and live-mode
      webhook endpoints/secrets are separate) and a new signing secret. Until this swap,
      no real money can move even though sandbox billing works end-to-end.

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
