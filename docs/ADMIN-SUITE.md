# Platform Super-Admin Suite (`/admin`)

Handoff for the platform admin console — the surface for **RethinkReality to run
the whole business**: every customer/org, all events cross-tenant, payments, and
support actions. It is **distinct from the per-event host studio** (`/host/**`,
`src/components/admin/*`) which is a customer managing their *own* event.

Built in phases, each independently shippable. **All five phases are done and
deployed.**

**2026-07-29 (PR #30) — no new phase, no new `admin-api` actions, nothing to
deploy.** Client-side only: `/admin` gained a triage strip (`src/lib/adminTriage.ts`,
pure + tested) that answers "is anything on fire" from three independent reads,
with an `unknown` severity so a FAILED read never renders as all-clear. One real
bug fixed — `Features.tsx` discarded `fetchOrgs`' error and rendered "No customers
match." on a failed read, the same failed-fetch-as-empty class this codebase has
fixed before. The manager console (`/m/:slug`) was rebuilt phone-first with live
arrivals, pending counts, a keyboard queue and undo; note its live path is a POLL
through `manager-api`, not Realtime, because the console holds only the anon key
and anon RLS exposes `approved and not hidden` — i.e. everything EXCEPT the
pending queue it needs. Also fixed there: `get_wall_settings` discarded its error,
so a failed read rendered `DEFAULT_WALL_SETTINGS` as if they were the event's real
values and one Save overwrote a live wall's config mid-event.
Known gaps, described not faked: `events.starts_at` is never SELECTed by
`list_events`/`overview_metrics`, so "events happening today" is absent from the
strip; no `ai_jobs` admin action exists, so "AI jobs stuck" is not surfaced; and
payments triage scans only the most recent 50 orders (stated in the UI). Each
needs an `admin-api` change.

---

## Security architecture (the core — don't weaken it)

- **Identity.** `public.platform_admins(user_id pk, email, added_by, created_at)`
  + `is_platform_admin(uuid default auth.uid())`. Authz keys on `user_id`, never
  email. Seeded with the owner via a **claim-on-confirm trigger** (mirrors
  `claim_legacy_org` in migration `005`), so it survives the chicken-and-egg where
  `auth.users` may not exist at migration time.
- **One fortified door.** ALL cross-tenant access goes through the single
  service-role edge function **`admin-api`**. It clones `create-event`'s auth
  (verify JWT → service client) and asserts `platform_admins` membership **before
  the action `switch`** (same structural guard as `manager-api`'s token check), so
  a new action can't forget its gate. **Tenant RLS is never loosened.**
- **Client gate is UX-only.** `checkIsPlatformAdmin()` (`src/lib/admin.ts`) reads
  the self-scoped `platform_admins` row just to show/hide `/admin`. The real
  enforcement is server-side.
- **Password reset** = `admin.auth.admin.generateLink({type:'recovery'})` (returns
  the link, no SMTP dependency). The link is a session-granting secret — **never
  log/store/audit it**.
- **Disable = ban** (`updateUserById(id,{ban_duration})`), **never delete** (delete
  cascades `profiles`/`org_members`, nulls `orgs.owner_id`, orphans the org).
- **Impersonation is deferred** — highest-risk (an org-scoped session bypasses the
  `admin-api` door). If ever added: time-boxed, step-up re-auth, loudly audited.

---

## Phase 1 — DONE & DEPLOYED ✅

**DB (migration `009_platform_admin.sql`, applied to `zrtftliozslrjomxbfrr`):**
`platform_admins` (+ self-scoped read policy), `is_platform_admin()`,
`claim_platform_admin()` wired into `handle_new_user`/`handle_user_confirmed`,
`admin_audit` (append-only), `admin_adjust_credits()` (signed comp/claw-back,
floored at 0), `admin_user_emails()` (PII-gated bulk email resolution). Owner
`dapo@rethinkreality.ai` is seeded and verified as admin.

**Edge function `admin-api` (deployed, `verify_jwt` on):** auth + `is_platform_admin`
assert middleware, and the `overview_metrics` action (cross-tenant counts).

**Frontend:** `src/lib/admin.ts` (admin-api client + gate); `AdminLayout`
(three-state gate: loading → spinner, no session → `/login`, not admin →
`/host`); `Overview` stat-tile dashboard; `/admin` route added and the legacy
`/admin/*` redirect removed. Shared: `cn()`, `StatusPill` + pure `pillStyles.ts`
tone map, `adminFormat.ts`. Tests: `cn`, `pillStyles`, `adminFormat` (pure).

**Access:** log in at `/login` as a `platform_admins` member (currently the owner)
→ visit `/admin`. Non-admins are bounced to `/host`. There is no separate admin
password — it's the account's normal Supabase login + platform-admin membership.

---

## Phase 2 — DONE & DEPLOYED ✅

**Edge function `admin-api`** (redeployed, version 2): `list_orgs` (org +
event count + subscription + credit balance, no server pagination — table
volume is early-stage), `get_org` (members with resolved emails via
`admin_user_emails`, events, `event_plans`, subscription, credit balance +
recent ledger), `list_events` (cross-tenant, joined with org name),
`set_event_status` (validates the 4 event statuses, audited via the new
`auditLog` helper).

**Frontend:** `Customers` (`/admin/customers`) and `Events` (`/admin/events`)
list screens, `CustomerDetail` (`/admin/customers/:orgId`) drill-down. New
primitives `Modal`, `DataTable`, `Pagination` in `src/components/ui/`. New pure
`src/lib/adminFilters.ts` (search/sort/paginate, client-side — the admin-api
actions return full result sets) with `adminFilters.test.ts`. `AdminLayout` nav
`ready:true` for Customers/Events; routes added in `src/App.tsx`.

**Cleanup:** the three host copies of the local `statusPill()` helper —
`src/pages/host/{EventsList.tsx, EventStudio.tsx, CardsTab.tsx}` — now import
the shared `StatusPill` component instead.

> **Shipped alongside in PR #13:** platform-admin god-mode — `create-event`
> v5 makes any admin-created event `deluxe`, `ai-event-designer` exempts
> admins from its rate limit, existing admin-org events were upgraded live
> and admin orgs comped 1000 credits (`admin_comp`). Phase 4's Limits
> actions (`set_event_tier`, `adjust_credits`) are the manual/audited
> counterpart.

---

## Phase 3 — DONE & DEPLOYED ✅

**DB (migration `010_orders.sql`, applied to `zrtftliozslrjomxbfrr`):** `orders`
(one row per fulfilled charge — `event_package`/`credit_pack`/`pro_subscription`,
integer cents, `paid`/`refunded` status), service-role only (no client policies).

**`supabase/functions/stripe-webhook/index.ts`** (redeployed, version 2,
`verify_jwt` still off): every `checkout.session.completed` branch now also
inserts an `orders` row (amounts straight from `session.amount_total`/
`currency` — never recomputed from `PRICES`); a new `invoice.payment_succeeded`
handler records Pro renewals, gated on `billing_reason='subscription_cycle'` so
the first period isn't double-counted against the checkout-session row.

**Edge function `admin-api`** (redeployed, version 3): `list_orders`
(cross-tenant, joined with org name), `revenue_summary` (SQL-side aggregate —
totals by currency, one-time vs subscription split, excludes `refunded`).
`overview_metrics`'s `revenueCents` is now a real usd-only sum instead of
always-null.

**Frontend:** `Payments` screen (`/admin/payments`) — stat tiles from
`revenue_summary`, a searchable/paginated order table from `list_orders`, and
an honest "no live payments yet" empty state for orgs with nothing recorded
yet. (Stripe SANDBOX keys are now provisioned and validated end-to-end —
2026-07-06 `credit_pack` test purchase shows up here correctly; LIVE keys are
still the real go-live gate, see `DEPLOYMENT-CHECKLIST.md` §3.) New pure
`src/lib/revenue.ts` (`summarizeOrders` — mirrors the Deno `revenueSummary`,
kept in sync the same way `ENTITLEMENTS` already is) with `revenue.test.ts`.
`AdminLayout` nav `ready:true` for Payments; route added in `src/App.tsx`.

---

## Phase 4 — DONE & DEPLOYED ✅

**Edge function `admin-api`** (redeployed, version 4): `list_users`
(`auth.admin.listUsers`, joined with `profiles.display_name`, `org_members`
role/org, `platform_admins` flag), `reset_password` (`generateLink` recovery —
the link is returned once and is **never** written to `admin_audit.meta`, only
that a reset happened and for whom), `set_user_banned` (`updateUserById
ban_duration` — **ban, never delete**, since delete cascades
`profiles`/`org_members` and orphans the org), `adjust_credits`
(`admin_adjust_credits` rpc, audited with the delta/reason/new balance),
`set_event_tier` (an admin comp — updates `events.plan_tier` directly, does
**not** insert an `event_plans` purchase row since no Stripe charge occurred).
All five audited.

**Frontend:** `Users` screen (`/admin/users`) — reset password (link shown
once in a modal, copy-to-clipboard), ban/unban (ban behind a confirm modal),
adjust credits (modal, only offered for users with an org). New primitive
`Toast` (`ToastProvider`/`useToast()`, mounted around `AdminLayout`'s
`Outlet`) gives every mutation user-facing success/error feedback — also
adopted by the Phase 2 `Events` screen's existing status-change flow. `Events`
also gained a "Comp plan" action (`set_event_tier`'s UI home — it's event
data, so it lives there rather than on the Users screen). `AdminLayout` nav
`ready:true` for Users; route added in `src/App.tsx`.

---

## Phase 5 — DONE & DEPLOYED ✅

**Edge function `admin-api`** (redeployed, version 5): `list_audit` (most
recent 200 `admin_audit` rows, joined with resolved actor emails — operational
view, not an archive), `list_admins` (roster joined with resolved emails +
`added_by` email + `profiles.display_name`), `add_admin` (resolves an existing
user by email via the same `listUsers` scan as `list_users`/`reset_password`,
else `inviteUserByEmail`; a duplicate insert into `platform_admins` surfaces
as `409 already_admin`), `remove_admin` (blocks removing yourself and blocks
emptying the roster — the last remaining admin can't be removed even by
someone else). All four audited (add/remove; list actions are reads).

**Frontend:** `Audit` screen (`/admin/audit`, read-only) and `Admins` screen
(`/admin/admins` — add by email, remove behind `canRemoveAdmin`'s client-side
pre-check so a blocked removal shows as a disabled button with a tooltip
instead of a round-trip error). New pure `src/lib/adminAuth.ts`
(`canRemoveAdmin`, `normalizeAdminEmail` — mirrors the Deno `removeAdmin`
guard) with `adminAuth.test.ts`. `AdminLayout` nav `ready:true` for
Audit/Admins; routes added in `src/App.tsx`.

---

## Phase 6 — DONE & DEPLOYED ✅ (support desk · feature flags · catalogue · landing CMS)

Shipped across the 2026-07-28 support/flags/catalogue work and PR #36; full
narrative in `CLAUDE.md`. Screens added since Phase 5: `/admin/support`
(inbox + internal notes, via the separate `support-api` edge fn), `/admin/features`
(capability matrix with per-flag PROVENANCE, plan defaults, kill switches),
`/admin/catalog` (`billing_catalog` + "Provision in Stripe"), and
**`/admin/landing`** (below).

**Landing CMS — `/admin/landing`.** Migration `030_landing_content`: a singleton
`landing_content` row holding `draft` + `published` jsonb. RLS is on with **zero
client policies** — `draft` may contain unreviewed marketing copy, so no client
touches the table. Anonymous visitors read the published half only, through
`get_landing_content()` (SECURITY DEFINER, `set search_path = public`, then
`revoke all … from public` + `grant execute to anon, authenticated` — skipping
the revoke re-creates the bug migration 022 exists to fix).

**`admin-api` (redeployed, version 16)** — four new actions, all behind the same
pre-switch guard, all audited except the read: `get_landing_content_admin`,
`save_landing_draft` (rejects non-objects and blobs over 200 KB; the audit row
records the byte count, never the blob), `publish_landing_content` (copies
draft → published, bumps `version`), `revert_landing_draft`.

**Frontend:** `src/pages/admin/Landing.tsx` (draft/published state, `ConfirmModal`
on Publish since it changes the public site, collapsible sections, per-slot media
Replace/Reset with the bundled default previewed), `src/lib/landingMedia.ts`
(uploads to `assets/_platform/landing/` — migration 018 already grants platform
admins bucket-wide write and `_platform` can never be an event slug, so **no new
storage policy was needed**), and the pure `src/lib/landingContent.ts` +
`landingContent.test.ts` (total normalizer; `resolveMediaUrl` accepts only https
URLs under `/storage/v1/object/public/`). `Landing.tsx` renders bundled defaults
first and swaps overrides in after the fetch, so a failed read or an empty blob
can never blank the marketing page.

**Known limit, stated in the UI:** the OG/social-share image and `<title>` are
static in `index.html` — scrapers don't run JS, so changing those is a code deploy.

---

## Primitives: built vs to-build

| Primitive | Status |
|---|---|
| `cn()`, `StatusPill` + `pillStyles.ts`, `adminFormat.ts` | ✅ built (Phase 1) |
| `Modal`, `DataTable`, `Pagination` | ✅ built (Phase 2) |
| `Toast` (`ToastProvider`/`useToast`) | ✅ built (Phase 4) |

DB helpers already in `009` that later phases just call: `admin_user_emails`
(P2/P4), `admin_adjust_credits` (P4), `admin_audit` (P2+).

---

## Admin-specific watchouts
- Assert `is_platform_admin` **before** the action switch; trust the JWT sub, not
  body ids. Any endpoint returning `auth.users` data without the guard = PII leak.
- `event_plans.event_id` = UUID; `posts`/`cards`/`app_settings.event_id` = slug.
- Recovery links & ban semantics per the security section above.
- CI won't test `admin-api` or the migrations — verify via the Supabase MCP
  (`apply_migration`, `execute_sql` read-backs) and a browser login.

## Verify a phase end-to-end
1. `apply_migration` (if any) to `zrtftliozslrjomxbfrr`; `execute_sql` read-back.
2. `deploy_edge_function` `admin-api` (include `index.ts` **and** `deno.json`).
3. `npm run lint` · `npm test` · `npm run build` all green.
4. Browser: owner → `/admin/<screen>` works; a non-admin → bounced to `/host`.

## When you finish a phase, update
`CLAUDE.md` (current state), this file (phase → done + new actions), `AdminLayout`
nav `ready` + `App.tsx` route, and `README.md`/`DEPLOYMENT-CHECKLIST.md` if tables/
functions/secrets changed. Keep migrations applied **and** committed.
