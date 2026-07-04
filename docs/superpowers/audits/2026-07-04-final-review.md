# Final Cross-Cutting Review — full `main...HEAD` diff (all 6 phases)

**Date:** 2026-07-04 · **Branch:** `claude/photo-wall-saas-strategy-xd1rxf`

A whole-diff review looking for issues the per-phase audits could miss. Verified
**clean**: legacy safety (VITE_EVENT builds byte-identical; all edge functions
exempt the 3 legacy slugs; no migration 004–008 tightened a legacy grandfather
in a breaking way), credit accounting (every `spend_credits` has a guaranteed
single refund on failure), RLS/tenancy (the 008 fix fully closes the card
token/PII leak; no org-A-reads-org-B path), and stale env refs
(`VITE_GEMINI_API_KEY` fully removed).

Three new cross-cutting issues found and **FIXED**:

## 1. MEDIUM — deleting a pinned landing card trapped guests on a 404
Cross-cut: card lifecycle (P5) × event routing (P1). `doUnpublish` cleared the
`events.config.primary_card` pin, but `doDelete` did not — and `primary_card` is
a JSON blob (no FK cascade). After a host pinned a card as the event landing and
deleted it, every `/e/:slug` guest (the QR target) was redirected to a deleted
card → `card-view` 404 → dead-end.
**Fix:** `doDelete` now clears the pin (+ `refreshConfig`) when the deleted card
was the landing, mirroring `doUnpublish` (`src/pages/host/CardsTab.tsx`).

## 2. LOW–MEDIUM — submit-post didn't re-check `videoEnabled` server-side
Every entitlement was mirrored server-side except this one boolean: a free-tier
DB event would accept 60 MB video posts from any client bypassing the UI gate
(paying-feature/storage abuse).
**Fix:** `submit-post` `handleInit` now rejects `mediaType:'video'` on free-tier
events with `403 video_not_allowed`, exempting legacy slugs and events whose org
holds an active Pro subscription — mirroring the post-cap's Pro lift. (Deployed
as submit-post v4.)

## 3. LOW — Pro-subscription floor leaked across orgs (client cosmetic)
`hasActiveProSubscription()` returned true for the *viewer's own* org and applied
that floor to whatever event was viewed, so a signed-in Pro host viewing another
org's event got premium client entitlements (most tangibly, watermark dropped on
a capture they personally made on the foreign booth). Server re-checks always use
the *event's* org, so AI/cards/caps were never affected.
**Fix:** replaced with `eventOrgHasActivePro(eventUuid)` — scoped to the event's
org. RLS on `subscriptions` returns nothing for guests or members of other orgs,
so the Pro floor now applies only on the viewer's own events
(`src/lib/host.ts`, `src/lib/entitlements.ts`).

## Gate
tsc clean · 50/50 vitest · vite build OK · `VITE_EVENT=hope-gala` smoke OK.

## Still-open documented items (not regressions)
Guest-side Pro watermark for a Pro org's *free-package* event remains the
Phase-3-documented follow-up (denormalize the org Pro flag onto `events` so
guests, who can't see `subscriptions` under RLS, get a consistent treatment).
HyperFrames cloud API contract + local video compositing remain the Phase-6
validate-before-go-live items.
