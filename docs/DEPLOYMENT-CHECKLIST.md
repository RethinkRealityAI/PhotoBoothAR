# Beamwall — Go-Live / Operator Checklist

Everything needed to take the platform (PR #5) from "merged" to "live and
charging". The platform is **safe-by-default**: every integration below degrades
gracefully until its key is set, so you can enable them one at a time.

Supabase project: `zrtftliozslrjomxbfrr`. Migrations 001–035 (two files are
numbered 030 — do not renumber) and all edge functions (incl. `admin-api`,
`stripe-webhook`) are **already applied/deployed** to it; `036_agent_turns`
ships with PR #44 and is applied at its merge (§2a). Set secrets in
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

**Owner note (2026-07-21): Resend SMTP settings are wired** — remaining boxes
are the rate-limit bump and the live delivery check above.

### Branded email templates (paste-in — there is no API/MCP path for these)

The six on-brand HTML templates live in **`supabase/email-templates/`**
(dark void background, beam-gradient button, serif wordmark — table-layout +
inline styles, safe in Gmail/Outlook/Apple Mail; Supabase `{{ .X }}` variables
already in place). The Supabase MCP server exposes no auth-config tool, so
they must be pasted once by hand:

Supabase Dashboard → **Authentication → Emails** (project
`zrtftliozslrjomxbfrr`) → for each template below, paste the file's full
contents into **Message body (HTML)** and set the subject:

| Dashboard template | Repo file | Subject line |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your email — Beamwall |
| Invite user | `invite.html` | You're invited to Beamwall |
| Magic link | `magic-link.html` | Your Beamwall sign-in link |
| Change email address | `change-email.html` | Confirm your new email — Beamwall |
| Reset password | `reset-password.html` | Reset your Beamwall password |
| Reauthentication | `reauthentication.html` | Your Beamwall verification code |

- [ ] All six pasted + subjects set
- [ ] Send yourself one of each (signup + forgot-password at minimum) and
      confirm they render with the dark card + gradient button intact.

Until the remaining boxes are checked, treat beta invites as **blocked**.

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

### 2a. AI agent functions — multi-file deploys, model overrides, telemetry (added 2026-09-02, PR #44)

Four AI functions now deploy as MORE THAN ONE FILE. The MCP
`deploy_edge_function` call takes an explicit `files[]` — **a missing sibling
is an import error at boot, and every request to that function 500s** (the
PR #28 class: nothing in the repo gates a Deno import). Deploy lists:

| Function | Files (all required) | verify_jwt |
|---|---|---|
| `ai-event-designer` | `index.ts` · `prompt.ts` · `tools.generated.ts` · `profiles.ts` · `deno.json` | ON |
| `validate-challenge-photo` | `index.ts` · `deno.json` | **OFF** (anon guest check, as today) |
| `ai-generate-image` | `index.ts` · `frameLayout.ts` · `deno.json` | ON |
| `ai-generate-3d` | `index.ts` · `pieceGeometry.ts` · `deno.json` | ON |

`tools.generated.ts` is GENERATED — never hand-edit it; run
`npm run gen:agent-tools` after any change to `src/lib/copilotTools.ts`
(`src/lib/copilotTools.drift.test.ts` fails CI otherwise).

**Optional secrets** (all read at request time — a change is a secret edit,
not a redeploy; an invalid value is ignored and the default stands):

| Secret | Default | Range |
|---|---|---|
| `GEMINI_MODEL_CREATE` / `_COPILOT` / `_SCENE` | `gemini-2.5-flash` | model id, `/^[a-z0-9.-]+$/i` |
| `GEMINI_THINKING_CREATE` / `_COPILOT` / `_SCENE` | 0 / 0 / 512 | integer 0..8192 |
| `GEMINI_TEMPERATURE_CREATE` / `_COPILOT` / `_SCENE` | 0.6 / 0.2 / 0.5 | number 0..2 |
| `GEMINI_MAX_TOKENS_CREATE` / `_COPILOT` / `_SCENE` | 2048 / 3072 / 4096 | integer 256..8192 (raised automatically to clear the thinking budget) |
| `GEMINI_MODEL_VALIDATE` | `gemini-2.5-flash-lite` | model id, for `validate-challenge-photo` |

Per-attempt timeouts are fixed in code (create/copilot 25s, scene 40s,
validate 12s) with ONE retry on network/abort/5xx only.

**Deploy sequence at merge** (order matters — the function inserts into the
table, and the client tolerates absent `turnId` but the server must accept
absent `surface`/`lastTurn`):

- [x] 1. Apply `supabase/migrations/036_agent_turns.sql` (MCP `apply_migration`),
      then read back with `execute_sql`: `select count(*) from public.agent_turns`
      → 0, and `get_advisors` shows no new security finding (RLS on, no policies).
      DONE 2026-09-02 (`20260902131409 036_agent_turns`; RLS on, 0 policies).
- [x] 2. `get_edge_function` snapshot of the live `ai-event-designer` source →
      deploy with all FIVE files → read the deployed source back and diff every
      file (hand-transcribed payloads have lost bytes before) → boot-probe TWICE:
      once without a JWT (expect the gateway's `401 UNAUTHORIZED_NO_AUTH_HEADER` —
      proves routing only, the isolate never runs) and once with the anon key as
      `Bearer` (expect the function's OWN `401 {"error":"unauthorized"}` — that
      body only exists if index.ts and every sibling import booted). Never 500.
      DONE 2026-09-02: **v22**, five files byte-identical, both probes as expected.
- [x] 3. Deploy `validate-challenge-photo` (verify_jwt OFF), `ai-generate-image`
      (3 files), `ai-generate-3d` (3 files) the same way.
      DONE 2026-09-02: validate-challenge-photo **v4** (verify_jwt off, `{}` →
      handled `400 invalid_body`), ai-generate-image **v21**, ai-generate-3d **v11**
      — all byte-identical read-backs, handler-level 401 on the anon-key probe.
- [ ] 4. Live checks: two consecutive copilot turns in `/host/concierge`, then
      `select id, mode, surface, model, attempts, latency_ms, prompt_tokens,
      cached_tokens, error_code from agent_turns order by id desc limit 3`
      — expect `cached_tokens > 0` on the second turn (proves the static prompt
      prefix stayed byte-stable); press thumbs on a reply → that row's
      `feedback` = 1 or -1; `query_logs` shows no `agent_turns insert failed`;
      compare `validate-challenge-photo` latency in `query_logs` for a day and
      keep or revert `GEMINI_MODEL_VALIDATE` on the numbers.

`agent_turns` stores no message text (sizes, tokens, latency, model, the
proposal JSON ≤ 8 KB, error code, feedback); retention is intended at 90 days
but no purge job exists yet — `delete from public.agent_turns where created_at
< now() - interval '90 days'` is the manual step.

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
- [ ] **Provision the product catalogue** (added 2026-07-28, migration 029): in
      `/admin/catalog` press **Provision in Stripe** — creates one Product + one
      Price per active `billing_catalog` row, idempotent via `lookup_key`. Run it
      once in test mode, and AGAIN after the live-key swap (live mode has its own
      objects). Until provisioned, `stripe-checkout` falls back to inline
      `price_data`, so selling never stops either way.
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

## 4b. Support desk — new-ticket email (added 2026-07-28)

- [ ] `SUPPORT_NOTIFY_EMAIL` — the inbox that gets a Resend email when a
      customer or guest files a support ticket (`support-api` v1 is deployed;
      migrations 023–026 are live). Email is deliberately never load-bearing:
      without this secret, tickets still land in `/admin/support` and the DB row
      is always written first — only the notification is skipped.
      Uses the same `RESEND_API_KEY` + `PUBLIC_SITE_URL` as §4.

## 5. Keepsake MP4 film — HeyGen HyperFrames (Deluxe add-on)

Ships **disabled** by default (`card-render` returns `render_not_configured`,
credits refunded). To enable:

- [ ] Upload the composition `hyperframes/keepsake-film/` (index.html +
      gsap.min.js) to HeyGen HyperFrames once → record its **asset id**.
- [ ] ⚠️ **RE-UPLOAD after any change to `hyperframes/keepsake-film/index.html`.**
      HeyGen renders the ASSET it holds, not the repo file, so an edit here is
      invisible in production until the bundle is re-uploaded (and, if the
      upload mints a new id, `HEYGEN_HYPERFRAMES_ASSET_ID` is updated). This is
      outstanding NOW: the composition gained a late-`--variables` wait (it
      polls up to 3s and rebuilds the film in place when the payload lands),
      which is what stops a cloud render from silently producing a film with no
      card data in it. Verified in a real browser — with the runtime populating
      at 400ms, the film rebuilds into the SAME paused timeline instance.
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
