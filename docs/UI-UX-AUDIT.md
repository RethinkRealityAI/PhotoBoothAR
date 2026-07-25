# Platform UI/UX audit — 2026-07-25

Four-surface audit of the platform ahead of beta invites, run against
`claude/beta-release-readiness-tihw04` @ `3898a63` (the real current product — `main`
is a version behind, and the live Supabase project already carries this branch's
migrations `013`–`016`).

**Baseline at audit time:** tsc 0 · 608 tests (49 files) · build ✓.

## Method

Each surface was audited against the same seven lenses so findings stay comparable:

| Lens | |
|---|---|
| L1 | IA & navigation |
| L2 | Responsive (390 / 768 / 1440, safe areas, ≥44px targets) |
| L3 | State honesty — empty vs loading vs error |
| L4 | Design-system compliance |
| L5 | Accessibility |
| L6 | Copy |
| L7 | Perceived performance |

Severity: **P0** blocks or misleads a real user (guest can't post, host can't ship,
operator moves money blind, prospect is mis-sold). **P1** visible damage to trust or
comprehension. **P2** polish.

Evidence came from two passes: a code audit of every screen in scope, and a
44-screenshot sweep (22 routes × 390/1440) driven by Playwright against `vite dev`
with a throwaway Supabase stub, capturing `pageerror`, console errors and document
overflow per route.

### What could not be verified here

The sandbox cannot reach `*.supabase.co` or the Netlify deploy preview (both return
`CONNECT tunnel failed, 403` through the egress proxy). So: no live data, no Stripe
state, no real device. Contrast ratios and tap-target heights below are computed from
token values and class strings, and anything depending on production data is marked
`UNVERIFIED`. Findings that need a real phone (iOS safe areas, camera permission
sheets, keyboard overlap) are flagged for the live-hardware checklist.

## The five patterns behind most of it

1. **Swallowed fetch errors become confident emptiness.** Eleven separate data paths
   `catch` a failure, return `[]` or `null`, and let the UI render its empty state. A
   guest on bad venue wifi is told *"Event not found — double-check the link or QR code
   you were given."* A host with cards is told *"No cards yet."* An operator searching
   for a customer is told *"No organizations match."* This is the single most
   repeated defect in the product and the top item on three of the four surface verdicts.
2. **Dead ends at exactly the worst moment.** Camera denied and send-permanently-failed
   are both full-screen takeovers whose only control cannot succeed.
3. **Overlays are not dialogs.** No shared Escape handler, `role="dialog"`, focus trap
   or focus restore — across ~14 overlays including every admin money confirm.
4. **Micro-typography carrying load-bearing meaning.** 8–10px uppercase at 0.28em
   tracking and 30–50% opacity is used for the pre-camera privacy disclosure, feature
   descriptions, and the "Most popular" pricing badge.
5. **Declared-but-undefined CSS.** `pt-safe-top` / `pb-safe-bottom` are used in 7 places
   and defined nowhere, so every safe-area allowance in the app is currently inert.

---

## Surface: guest (`/e/:slug/**`)

> Visually finished but structurally dishonest — five swallowed-fetch paths turn "the
> network failed" into "your QR code is wrong", "nobody has posted", or "you have no
> photos", and the two moments a guest is most likely to be stranded are literal dead ends.

| Sev | Lens | Location | Finding |
|---|---|---|---|
| P0 | L3 | `src/events/runtime.ts:157` | Any error (offline, RLS, 500) returns null → EventProvider renders "Event not found — double-check the link or QR code". No retry exists anywhere. |
| P0 | L3 | `src/events/EventContext.tsx:194` | `loadEventConfig(slug).then(...)` has no `.catch`; a rejected fetch leaves `phase:'loading'` forever — "Setting the stage…" with no cancel. |
| P0 | L6 | `src/components/booth/Welcome.tsx:69` | "your photo is only shared when you choose" is untrue on a challenge: `Booth.tsx:838` uploads to `validate-challenge-photo` before any post exists, and Retake leaves an already-transmitted photo. |
| P0 | L6 | `src/components/booth/Welcome.tsx:63` | The only pre-camera privacy disclosure is `text-[8px] text-brand-muted/30`. |
| P0 | L1 | `src/components/booth/CameraError.tsx:60` | Permission-denied offers only "Try Again", which re-rejects instantly on iOS. No path to `/upload` or the wall — a blocked guest cannot participate at all. |
| P0 | L1 | `src/components/booth/SendFailed.tsx:115` | For permanent failures the only action is "Save to my phone" — no retake, no wall, no dismiss, on a `z-50` full-screen overlay. |
| P0 | L3 | `src/components/Booth.tsx:918` | "Starting camera…" has no timeout or cancel; if `getUserMedia` never settles, the guest waits on a pulsing ring indefinitely. |
| P0 | L3 | `src/lib/db.ts:179` | `fetchPosts` swallows the error and returns `[]` while `store.ts:139` sets `postsLoaded:true` → the wall renders "Be the first to capture a moment". |
| P0 | L3 | `src/lib/db.ts:194` | Same swallow in `fetchMyPosts` → "No media yet · Step up to the booth" after a failed fetch. |
| P0 | L3 | `src/pages/cards/CardContribute.tsx:127` | `error:'network'` collapses into `phase:'invalid'` → "This link isn't valid" shown to an offline guest holding a good link. `CardViewer.tsx:51` identical, with no retry. |
| P0 | L3 | `src/components/UploadToWall.tsx:475` | Done screen always reads "On the wall!" even when `result.posted === 0`, then says "0 items are now live". |
| P0 | L3 | `src/components/UploadToWall.tsx:103` | Video files are dropped from the batch with only a `console.warn` — the guest picks a video and nothing is said. |
| P0 | L1 | `src/components/Wall.tsx:420` | Guest-visible "⊡ Project" hides all chrome; the only escape is gated on `onMouseMove`, and the flag persists to localStorage — a phone guest is permanently trapped. |
| P0 | L1 | `src/components/Wall.tsx:261` | `toggleQR` writes `dbSetWallSettings` for the **whole event** from any guest's phone and live-syncs to the venue screen — one guest can delete the join QR everyone else needs. Failure is swallowed by `.catch(() => {})`. |
| P1 | L2 | `src/index.css:94` | `pt-safe-top` / `pb-safe-bottom` are undefined — all 7 uses are dead (booth header under the notch, shutter under the home indicator). |
| P1 | L4 | `src/index.css:159` | `.bg-foil` derives from the host's `--color-accent` but every CTA hard-codes `text-noir-900` or `text-white`, and `branding.ts:86` accepts any hex with no luminance check → a dark host accent yields an invisible shutter. |
| P1 | L5 | `src/index.css:255` | `prefers-reduced-motion` disables only `.animate-float`; `BeamIn` fires a full-viewport 0.9-opacity flash on every insert, `ChallengeCheck`/`SendOff` loop `repeat:Infinity`. |
| P1 | L5 | `src/components/wall/WallLightbox.tsx:51` | No guest overlay has Escape, `role="dialog"`, `aria-modal`, focus trap or scroll lock (7 overlays). |
| P1 | L7 | `src/components/Booth.tsx:948` | Header nav uses raw `<a href>` (also `:959`, `SendOff.tsx:431`, `ChallengesPage.tsx:111`), forcing a full SPA re-download **and a fresh camera permission round-trip**. `ReviewPanel.tsx:37` already documents this bug and uses `<Link>`. |
| P1 | L2 | `src/components/Wall.tsx:443` | Footer sits at `pb-6` while GuestNav's mobile tab bar is fixed at z-40 → the tab bar covers the QR panels at 390px. |
| P1 | L2 | `src/components/Wall.tsx:453` | Two QRPanels need 408px inside a 390px viewport whose root is `overflow-hidden` — the second is clipped and unreachable. |
| P1 | L2 | `src/components/UploadToWall.tsx:304` | Root is `overflow-hidden` with nothing scrollable, so the keyboard hides the Post button. |
| P1 | L2 | `src/components/Booth.tsx:1128` | Sub-44px controls throughout (timer chip ≈22px, header pills 36px, wall mode tabs ≈26px, slideshow pips 8px). |
| P1 | L2 | `src/components/wall/SlideshowView.tsx:261` | Prev/next only appear on `onMouseMove`, which never fires on a phone — a guest cannot advance the slideshow at all. |
| P1 | L3 | `src/store.ts:170` | `fetchChallenges` has no error path → "No challenges yet — this event hasn't added any"; `PickerDrawer.tsx:322` shows "Loading…" forever. |
| P1 | L3 | `src/events/EventContext.tsx:246` | Only `archived` is gated, but the schema allows `draft\|live\|ended\|archived` — a guest scanning a QR for an unlaunched event gets a fully working booth and posts into it. |
| P1 | L3 | `src/lib/db.ts:262` | `.subscribe()` has no status callback — `CHANNEL_ERROR`/`TIMED_OUT` are silent and the wall looks live on only a 20s poll. |
| P1 | L3 | `src/components/Wall.tsx:290` | Empty state branches on `posts.length === 0` ignoring `postsLoaded` → "Be the first" flashes before the grid pops in. |
| P1 | L3 | `src/components/Booth.tsx:143` | Nothing in the guest surface checks `navigator.onLine` (zero occurrences repo-wide outside copilot). |
| P1 | L7 | `src/components/Booth.tsx:149` | `initializeFaceLandmarker()` runs for every guest even when no 3D piece or trigger is used, competing with `getUserMedia`. |
| P1 | L7 | `src/lib/db.ts:174` | `Wall.tsx:131` fetches posts with no limit and `MosaicGrid` maps every one; `MarqueeGrid.tsx:290` hard-codes `MIN_FILL_WIDTH = 3840` → ~20× the cards needed on a phone, each autoplaying video. |
| P1 | L7 | `src/components/MyPhotos.tsx:180` | Every video card is `autoPlay loop` with no `poster`/`preload` while sibling images correctly use `loading="lazy"`. |
| P1 | L5 | `src/components/Booth.tsx:1147` | Shutter/stop/record use `focus:outline-none` with no replacement, and no global `:focus-visible` style exists. |
| P1 | L5 | `index.html:5` | `maximum-scale=1` blocks pinch-zoom (WCAG 1.4.4) — on the surface with 8px consent text. |
| P1 | L5 | `src/components/wall/MosaicGrid.tsx:49` | Photo cards are `<div onClick>` with no role/tabIndex/key handler → lightbox keyboard-unreachable (also MarqueeGrid, FeaturedSpotlight). |
| P1 | L1 | `src/components/Booth.tsx:1227` | A running countdown cannot be cancelled — controls require `phase === 'camera'` and the overlay is `pointer-events-none`. |
| P1 | L6 | `src/components/booth/SendFailed.tsx:29` | "This event's plan doesn't allow video" leaks the host's billing tier to a guest. "Begin the Experience", "Projection mode (hides all chrome)" are internal vocabulary. |
| P2 | L1 | `src/components/GuestWelcome.tsx:31` | QR landing omits My Photos, renders no GuestNav, and links to `/challenges` without checking any exist. |

## Surface: host (`/host/**`)

> Looks composed but is structurally dishonest — six data paths convert a failed fetch
> into "you have nothing yet", the copilot marks failed actions with a success tick, and
> the studio can silently fork a duplicate event.

| Sev | Lens | Location | Finding |
|---|---|---|---|
| P0 | L3 | `src/pages/host/CardsTab.tsx:605` | `listCards` returns `[]` on error (`cards.ts:210`) → "No cards yet — create one" to a host who has cards. |
| P0 | L3 | `src/pages/host/ManagerAccess.tsx:154` | `listManagerTokens` returns `[]` on error (`host.ts:515`) → "No access links yet", hiding live staff tokens and inviting duplicates. |
| P0 | L3 | `src/pages/host/Billing.tsx:303` | `fetchLedger` returns `[]` on error (`host.ts:112`) → "No credit activity yet." printed over real purchases. |
| P0 | L3 | `src/pages/host/EventStudio.tsx:99` | A failed pending-posts fetch only `console.error`s → the moderation queue reads "nothing awaiting approval" and guest photos never go live. |
| P0 | L3 | `src/components/copilot/CopilotChat.tsx:573` | Every `[tool_result]` bubble gets a "✓ " prefix regardless of `result.ok`, and `:476` flashes the tick *before* `executeAction` runs. |
| P0 | L3 | `src/components/studio/StudioShell.tsx:174` | `getExperience` returning null dispatches no LOAD → the host edits a blank draft while `?id=` stays in the URL, and the next Save forks a duplicate. |
| P0 | L3 | `src/components/copilot/CopilotPanel.tsx:76` | `rows ?? []` turns a failed `fetchMyEvents()` into an empty event picker. |
| P0 | L3 | `src/pages/host/Concierge.tsx:197` | `.catch(() => setSnapshot(null))` silently unscopes the copilot: the header still names the event while every proposal answers "Pick which event this is for first". |
| P0 | L3 | `src/pages/host/CardsTab.tsx:114` | `listContributions` returns `[]` on error → "No contributions yet" when guests have contributed. |
| P0 | L3 | `src/pages/host/ManagerAccess.tsx:53` | A failed `createManagerToken` resets the button with zero feedback. |
| P0 | L1 | `src/components/studio/StudioShell.tsx:435` | `state.dirty` is tracked but nothing guards the back link, tab nav or unload — one tap discards an unsaved scene. |
| P0 | L3 | `src/pages/host/NewEvent.tsx:366` | Success screen hands over the guest link + QR for an event that is always created as a **draft**, with no "guests can't open this yet" caveat (`EventsList.tsx:322` carries one). |
| P1 | L1 | `src/App.tsx:219` | `/host/events/:id/*` is mounted **outside** `HostLayout`, so opening any event drops the sidebar — Events, Concierge, Billing, credits and Sign out all vanish on the screen hosts use most. |
| P1 | L5 | `src/pages/host/HostLayout.tsx:86` | Below 640px every nav label is `hidden sm:inline` with no `aria-label` — the host nav is unnamed icons on a phone and to screen readers. |
| P1 | L5 | `src/pages/host/EventsList.tsx:34` | QRModal has no Escape, `role="dialog"`, focus trap or restore (same at `UpgradeCard.tsx:137`, `CopilotPanel.tsx:122`, `StudioShell.tsx:601`). |
| P1 | L5 | `src/pages/host/CardsTab.tsx:37` | `outline-none` on inputs with no `:focus-visible` rule anywhere in `src/index.css`. |
| P1 | L5 | `src/pages/host/Concierge.tsx:60` | The event card is a `div` with `onClick` — a keyboard host can never select an event, so the copilot stays unscoped forever. |
| P1 | L3 | `src/components/copilot/CopilotChat.tsx:418` | `askCopilot`'s `source: 'offline'` fallback (AI down / invalid key) is dropped and printed as an ordinary assistant reply. |
| P1 | L2 | `src/pages/host/EventsList.tsx:304` | Copy-link, QR and open-guest-view are ~26px; Go live/End ~30px — the core share and go-live actions on a phone. |
| P1 | L2 | `src/pages/host/Concierge.tsx:134` | "Go live" / "End" are `text-[8px]` pills at ~22px. |
| P1 | L2 | `src/pages/host/NewEvent.tsx:391` | The success-screen QR is `hidden sm:block` — at 390px the host who just created an event gets no QR on the one screen built to hand it over. |
| P1 | L3 | `src/pages/host/EventsList.tsx:22` | `clipboard.writeText().then()` with no `.catch` (also `:50`, `NewEvent.tsx:383`, `Concierge.tsx:111`). |
| P1 | L3 | `src/components/copilot/CopilotPanel.tsx:104` | `refreshSnapshot` changes the chat's `key`; the remount writes an empty transcript to the `'platform'` store key — the conversation is wiped after every successful action. |
| P1 | L3 | `src/pages/host/NewEvent.tsx:415` | If `loadEventSnapshot` rejects, the fire-and-forget `reloadBuild` leaves an endless "Preparing your build studio…". |
| P1 | L3 | `src/pages/host/ManagerAccess.tsx:67` | Revoke removes the row optimistically then silently re-adds it on failure — the host believes a staff link is dead while it is live. |
| P1 | L3 | `src/pages/host/EventStudio.tsx:275` | A network/RLS error collapses into `phase:'missing'` and bounces to /host with "couldn't open that studio" — an outage reported as a bad link. |
| P1 | L6 | `src/components/studio/StudioShell.tsx:267` | Save failure tells a paying host "Unexpected error — see console." |
| P1 | L6 | `src/pages/host/Billing.tsx:251` | The raw Stripe enum is shown to the customer — a lapsed card displays the pill "past_due". |
| P1 | L6 | `src/pages/host/CardsTab.tsx:546` | "This coded legacy event manages its content from its pinned build" is engineering jargon on a customer screen. |
| P1 | L6 | `src/pages/host/NewEvent.tsx:366` | New-event QR points at `/e/{slug}` while `EventsList.tsx:286` deliberately uses `/e/{slug}/welcome` — two different "guest links" for one event. |
| P1 | L2 | `src/components/copilot/CopilotFab.tsx:54` | `fixed bottom-6 right-6` ignores `env(safe-area-inset-bottom)`, putting the send row in the iOS home-indicator strip. |
| P1 | L4 | `src/pages/host/EventStudio.tsx:169` | The Wall tab uses raw palette classes (`text-champagne`, `border-gold-400/10`, `text-noir-900`) on a platform surface. |
| P1 | L4 | `src/components/a2ui/A2uiSurface.tsx:356` | Hard-coded `#faf6ef`/`#1a1108` QR colours, repeated in 4 more files. |
| P2 | L5 | `src/index.css:255` | Reduced-motion covers only `.animate-float`; `animate-rise-in`, spinners and the copilot springs run unconditionally. |
| P2 | L7 | `src/pages/host/CardsTab.tsx:599` | A bare 16px spinner over `py-16` where card rows will land (same at `EventStudio.tsx:298`, `Billing.tsx:205`); `ManagerAccess.tsx:151` already does skeletons. |

## Surface: platform admin (`/admin/**`)

> Structure and audit trail are sound, but five money-touching paths can fail or fire
> without telling the operator the truth.

| Sev | Lens | Location | Finding |
|---|---|---|---|
| P0 | L3 | `src/pages/admin/Credits.tsx:94` | `toggleActive` ignores `r.error` and Credits never imports `useToast` — deactivating an abused promo code can fail while the pill keeps reading "Active". |
| P0 | L3 | `src/pages/admin/Credits.tsx:58` | `Number('')` → 0 passes `isFinite && >= 0`, so an empty field — exactly what a failed `fetchPlatformConfig` leaves behind, with no error state — writes **0 welcome credits platform-wide** and reports "Saved." |
| P0 | L3 | `src/pages/admin/Customers.tsx:29` | `const { data } = await fetchOrgs()` discards `error`, so a 403/expired session/500 renders "No organizations match." Same at `Events.tsx:39`, `Users.tsx:117`, `Audit.tsx:26`, `Admins.tsx:30`. |
| P0 | L3 | `src/pages/admin/Users.tsx:59` | `submit()` returns silently when the delta is 0 or `orgId` is null, but the button is enabled whenever both fields are non-blank — Apply does nothing, says nothing. |
| P0 | L3 | `src/pages/admin/CustomerDetail.tsx:35` | Credit grants submit from a bare `<form>` (Enter fires it) with no confirmation and no magnitude check — "500" typed for "50" is applied instantly. |
| P1 | L3 | `src/pages/admin/Admins.tsx:39` | Adding and removing a platform admin (cross-tenant god-mode) both execute on one click, no confirmation. |
| P1 | L1 | `src/pages/admin/Customers.tsx:37` | Search is `['name']` only and `OrgRow` carries no email — the "customer emailed us" journey cannot start here. |
| P1 | L1 | `src/pages/admin/Users.tsx:173` | The Organization cell is plain text, not a `Link` (`Events.tsx:89` already links). |
| P1 | L1 | `src/pages/admin/Payments.tsx:57` | `stripe_ref` and `event_id` exist on `OrderRow` but are never rendered — a refund means leaving the console without the charge id. |
| P1 | L1 | `src/pages/admin/Users.tsx:126` | Search keys omit `id`, so a UUID copied out of Audit matches nothing. |
| P1 | L1 | `src/pages/admin/CustomerDetail.tsx:151` | The org's events link nowhere and its orders are absent from the record entirely. |
| P1 | L2 | `src/pages/admin/AdminLayout.tsx:69` | On mobile the rail is a non-wrapping row of 9 items (~430px) inside `overflow-hidden` — at 390px Audit, Admins and Sign out are clipped and unreachable. |
| P1 | L5 | `src/pages/admin/AdminLayout.tsx:89` | Nav labels are `hidden sm:inline` with no `aria-label` — below 640px every console control is unnamed. |
| P1 | L5 | `src/components/ui/DataTable.tsx:68` | `onRowClick` is bound to a `<tr>` with no `tabIndex`/`role`/key handler — the Customers→CustomerDetail drill-in is mouse-only. |
| P1 | L5 | `src/components/ui/Modal.tsx:23` | No Escape handler, no `role="dialog"`/`aria-modal`, no focus trap, no focus restore — every admin confirm is a keyboard trap. |
| P1 | L3 | `src/components/ui/Modal.tsx:26` | The scrim closes unconditionally — one stray click discards a half-typed credit adjustment. |
| P1 | L5 | `src/components/ui/Toast.tsx:38` | No `role="status"`/`aria-live`, and money-action failures vanish after 3.5s. |
| P1 | L5 | `src/pages/admin/Customers.tsx:60` | Icon-only refresh and admin-remove buttons carry no accessible name (6 screens). |
| P1 | L6 | `src/pages/admin/Users.tsx:203` | "Reset password" does not reset a password — it mints a one-time link that signs the user straight in, and it fires with no confirm. |
| P1 | L2 | `src/components/ui/DataTable.tsx:53` | `min-w-[36rem]` forces horizontal scroll at 390px and the action buttons live in the last column, off-screen, at ~26px tall. |
| P1 | L7 | `src/lib/admin.ts:95` | `list_orgs`/`list_events`/`list_orders`/`list_users` return every row with all filtering client-side. |
| P1 | L3 | `src/lib/admin.ts:41` | Every failure collapses to a code string the screens throw away — `unauthorized` (expired session) is indistinguishable from `internal`. |
| P1 | L3 | `src/pages/admin/AdminLayout.tsx:55` | A network error inside `checkIsPlatformAdmin` resolves `false` and silently bounces the operator to /host. |
| P1 | L6 | `src/pages/admin/Payments.tsx:96` | The zero-orders branch hard-asserts "Stripe keys aren't provisioned yet, so nothing has been charged" — after go-live any quiet period states a falsehood. |
| P1 | L3 | `src/pages/admin/CustomerDetail.tsx:43` | The grant outcome is an unstyled `<span>` that never clears, while `ToastProvider` is in scope unused. |
| P2 | L5 | `src/components/ui/DataTable.tsx:57` | `<th>` cells lack `scope="col"`. |
| P2 | L6 | `src/pages/admin/Audit.tsx:42` | Raw snake_case actions, `type:uuid` targets and `JSON.stringify(meta)`; the header reads "Most recent 0" while loading and never discloses the 200-row cap. |
| P2 | L6 | `src/components/ui/StatusPill.tsx:15` | Renders the raw enum ("past_due"), and `disputed` has no tone so a disputed charge looks like an unknown grey. |
| P2 | L4 | `src/pages/admin/Credits.tsx:105` | Hand-rolled panels and promo rows instead of `glass`/`glass-strong` + DataTable/StatusPill; `:157` uses raw `text-red-400` while Toast's error tone is amber. |
| P2 | L4 | `src/pages/admin/CustomerDetail.tsx:189` | Four screens use `text-white` on `bg-foil` while four others use `text-noir-900` on the identical button. |
| P2 | L7 | `src/pages/admin/Customers.tsx:27` | Refresh swaps the table for skeletons and drops page position. |
| P2 | L6 | `src/pages/admin/Customers.tsx:58` | Header counts read the unfiltered array → "0 organizations" mid-load. |
| P2 | L4 | `src/pages/admin/Users.tsx:181` | Hand-rolled purple "Admin" badge duplicating StatusPill. |
| P2 | L1 | `src/App.tsx:222` | No `/admin/events/:id` or `/admin/payments/:id` route — neither record is deep-linkable into a support ticket. |

## Surface: marketing + auth (`/`, `/login`, `/signup`, legal)

> The visual and motion craft is ahead of the commercial substance — the pricing table
> sells Essentials a feature it does not include and hides Free's 7-day expiry.

| Sev | Lens | Location | Finding |
|---|---|---|---|
| P0 | L3 | `src/pages/Landing.tsx:173` | Essentials ($49) advertises "Video guestbook", but `entitlements.ts:52` sets `essentials.cardsStandard = false`. The same claim is baked into the JSON-LD Offer at `index.html:70`. |
| P0 | L3 | `src/pages/Landing.tsx:166` | Landing tiers omit retention entirely, yet Free is `retentionDays: 7` and the in-app `UpgradeCard.tsx:35` makes storage a headline bullet — a prospect signs up not knowing Free photos expire in a week. |
| P0 | L3 | `src/components/ui/LiveHeroCarousel.tsx:35` | The hero streams real guests' photos from real events onto the public homepage, and `Legal.tsx:67` contains no clause permitting promotional use of event content. |
| P0 | L3 | `src/pages/auth/Signup.tsx:44` | The "already confirmed" branch infers confirmation from `identities?.length === 0`; a repo-wide grep for `resend` returns zero hits, so a genuinely unconfirmed account hits "Email not confirmed" at login with no in-app recovery. |
| P1 | L3 | `src/pages/Landing.tsx:180` | Premium sells "Priority support" and Deluxe "White-glove setup", but the footer links only Privacy and Terms — no contact route exists anywhere. |
| P1 | L5 | `index.html:5` | `maximum-scale=1` disables pinch-zoom across the whole marketing + auth surface. |
| P1 | L5 | `src/components/landing/InteractiveShowcase.tsx:822` | `focus-visible` appears zero times in the interactive demo — the hero's second CTA target has no visible keyboard focus. |
| P1 | L1 | `src/components/landing/InteractiveShowcase.tsx:820` | The demo's emotional peak offers only "Capture again" — the component contains no `Link to="/signup"` at all. |
| P1 | L5 | `src/index.css:206` | `.text-foil-static` uses `color: transparent` + `background-clip: text` with no `forced-colors` fallback — in Windows High Contrast every h2, all four prices and the wordmark render invisible. |
| P1 | L7 | `src/pages/Landing.tsx:316` | `FilmEmbed`'s `<video>` has no `width`/`height`/`aspect-ratio` → four CLS events on one page. |
| P1 | L7 | `index.html:23` | The Google Fonts `<link rel="stylesheet">` is render-blocking on a third-party origin, while the comment above it claims it is "async-friendly". |
| P1 | L2 | `src/pages/Landing.tsx:719` | Header nav pills are ~31px tall and are the page's persistent conversion path; "Demo"/"Pricing" are `hidden sm:inline`, so a phone visitor gets no in-page nav on a ~10-section scroll. |
| P1 | L2 | `src/pages/Landing.tsx:417` | Feature `highlights` — the only text alternative to the in-video callouts — render at `text-[10px]` uppercase at 0.28em tracking. |
| P1 | L3 | `src/pages/Landing.tsx:1022` | Footer claims "Loved at weddings, galas & milestone birthdays"; the real events are two weddings and one gala. |
| P1 | L7 | `src/components/ui/LiveHeroCarousel.tsx:230` | The marquee rAF runs forever with no IntersectionObserver, rewriting transforms on 12 cards every frame while scrolled offscreen. |
| P1 | L7 | `src/App.tsx:265` | `<CopilotPanel/>` renders on every route, so its chunk (which statically pulls `three` via glbThumb) downloads on `/`, `/login`, `/signup`. |
| P1 | L5 | `src/pages/auth/Login.tsx:15` | `inputClass` sets `outline-none` and no auth control has any `focus-visible` style. |
| P1 | L5 | `src/pages/auth/Login.tsx:69` | Login renders no `<h1>`; Signup starts at `<h2>`. |
| P1 | L2 | `src/pages/auth/Signup.tsx:57` | The card is centred inside `overflow-y-auto` within an `h-screen overflow-hidden` shell; when it exceeds the viewport the overflow goes off the **top** and cannot be scrolled to. |
| P1 | L2 | `src/pages/auth/Login.tsx:79` | Field labels are `text-[9px]` and microcopy at `text-brand-muted/50` computes to ≈3.1:1, under AA. |
| P1 | L6 | `src/pages/auth/Login.tsx:35` | Raw Supabase strings surface verbatim ("Invalid login credentials", "Email not confirmed") with no next action. |
| P1 | L1 | `src/pages/auth/Signup.tsx:117` | Login offers "Continue with Google" but Signup does not — the conversion page forces password creation. |
| P1 | L5 | `src/pages/auth/Signup.tsx:92` | Success replaces the whole form, destroying focus, with no `aria-live`. |
| P1 | L3 | `src/pages/auth/ResetPassword.tsx:49` | `/session\|expired\|token\|missing/i` also matches "Auth session missing!", which a fast submit returns while `detectSessionInUrl` is still exchanging — a valid reset link is reported as expired. |
| P2 | L2 | `src/components/ui/LiveHeroCarousel.tsx:57` | `COMPACT_VIEWPORT` is a module-level `matchMedia` snapshot taken at import, never re-evaluated. |
| P2 | L3 | `src/pages/Landing.tsx:502` | `hasLiveMedia` initialises to `true`, so a pulsing red live dot renders over empty frames for the whole fetch. |
| P2 | L2 | `src/components/ui/LiveHeroCarousel.tsx:402` | The WCAG-2.2.2 pause control is 36px and the arrows 40px below `sm`. |
| P2 | L1 | `src/pages/Landing.tsx:271` | Credits are never mentioned on the landing or in the FAQ — the first mention arrives after purchase. |
| P2 | L4 | `src/pages/Landing.tsx:236` | Per-section `rgba(...)`/hex hard-coded rather than derived from `--color-accent`. |
| P2 | L6 | `src/components/landing/InteractiveShowcase.tsx:650` | "It all runs in your browser; nothing leaves your device" sits 60 lines above a QR block that transmits a photo over Supabase Realtime. |
| P2 | L5 | `src/components/landing/InteractiveShowcase.tsx:624` | `whileInView` entrance animations are not gated by the file's own `reduced` flag. |
| P2 | L2 | `src/pages/Landing.tsx:947` | The "Most popular" badge is `text-[8px]` — the smallest type on the page sits on the tier the page wants chosen. |
| P2 | L4 | `src/pages/auth/Login.tsx:66` | All four auth cards use `glass-strong` (warm gold) against the beam-blue platform surface, contradicting the `liquid-glass` default. |
| P2 | L6 | `src/pages/auth/Login.tsx:149` | One action carries four nouns: "Create your event" / "Create your account" / "Create your event studio" / "Create account". |
| P2 | L1 | `src/pages/legal/Legal.tsx:188` | The legal footer offers no route forward for a prospect who left signup to read Terms. |

## Screenshot sweep

22 routes × {390, 1440}, `vite dev` + a stubbed Supabase. **0 page errors, 0 document
overflow on every route.** Horizontal-overflow findings above are therefore *within*
`overflow-hidden` containers (clipped and unreachable) rather than document-level
scroll — which is worse for the guest, not better, because there is no way to scroll to
the clipped control.

## Fix status

Six gated packages landed on this branch (each: tsc 0 · vitest green · build ✓).

**Fixed**

| Package | What it closed |
|---|---|
| `fix(a11y)` foundations | Safe-area utilities defined (all 7 dead usages now live, base padding preserved — probed at 40px) · global `:focus-visible` ring (probed with a real Tab press) · reduced-motion extended past `.animate-float` · `forced-colors` fallback for the foil text · `maximum-scale=1` removed |
| `fix(guest)` honesty | Event lookup distinguishes missing from unreachable, with retry · the rejected-promise path that hung on "Setting the stage…" forever · wall / my-photos / challenges report failure instead of emptiness (`lib/listState.ts`, tested) · wall stops flashing its empty state during first load · guest-writable event-wide QR toggle is now per-device · projection mode hidden below `sm` and revealed on touch |
| `fix(guest)` dead ends | Camera-denied offers upload + wall · permanent send failure always offers "Back to the booth" · pre-camera disclosure legible and accurate · challenge check states that the photo is sent even if you retake |
| `fix(host)` honesty | Copilot no longer ticks failed actions (and no longer flashes success before the action runs) · cards / contributions / ledger / manager tokens report failure · manager create+revoke no longer fail silently · new-event handover carries the draft caveat, one link shape, QR on phones |
| `fix(admin)` money paths | Promo toggle failure surfaced · empty welcome-credits field can no longer write 0 · five list screens surface load errors (probed) · credit adjustments validate and confirm · `Modal` is a real dialog with Escape/focus-trap/restore (probed) · toasts are a live region, errors persist |
| `fix(marketing)` | Essentials no longer sells a feature it lacks · retention disclosed on every tier and in JSON-LD, from shared tested helpers · unearned social proof removed · privacy clause for marketing use of event photos · resend-confirmation path · auth `h1`s and top-anchored cards |

**Still open** — everything above not named in that table, notably: `/host/events/:id/*`
mounted outside `HostLayout` (the sidebar vanishes in the studio); `StudioShell`'s
unsaved-work guard and its silent duplicate-fork on a failed load; the remaining
~14 ad-hoc overlays that should route through the now-fixed `Modal`; sub-44px tap
targets across booth/wall/host/admin; admin list screens fetching every row with
client-side filtering; the wall shipping full-resolution originals to phones; and
the copy/token cleanups marked P2. Each row above carries its `file:line`.

**Product decisions deliberately not taken unilaterally**

- Gating `draft` / `ended` events from guests (`EventContext.tsx:246`). Hosts test
  drafts through the guest booth via the copilot's `test_experience` flow, so
  gating drafts would break a shipped path. Needs an owner decision on how host
  preview and guest access should differ.
- `REFERENCE_HEAD_SCALE` and the hero carousel's use of legacy branded frames were
  previously settled by the owner and were left alone.
