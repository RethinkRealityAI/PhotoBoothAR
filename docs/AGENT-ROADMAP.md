# Event Agent roadmap — from concierge to full event copilot

Where the AI concierge goes next. Current state (2026-07-07): chat-driven event
creation in `/host/new` (`src/lib/eventDesigner.ts`) rendering A2UI v0.9.1 plan
cards (`src/lib/a2ui.ts` + `src/components/a2ui/A2uiSurface.tsx`), edge fn
`ai-event-designer` (Gemini), 3 free AI frames per event (`ai-generate-image`),
guest landing at `/e/:slug/welcome`.

## Model & cost strategy (researched 2026-07)

| Job | Model | Cost | Why |
|---|---|---|---|
| Concierge / event-agent chat | `gemini-2.5-flash` | ~$0.30/M in, $2.50/M out | Already deployed; structured output; fast |
| Chat cost-floor option | `gemini-2.5-flash-lite` | ~$0.10/M in, $0.40/M out | Swap-in if chat volume gets expensive; same API |
| Frame/sticker images | `gemini-2.5-flash-image` | ~$0.039/image (1290 out-tokens) | Already deployed; **Imagen 4 is deprecated (EOL 2026-08-17) — do NOT migrate to it** |
| Credit math | 1 credit = 1 gemini image | ~26x margin at $1/credit | Free allowance: `FREE_IMAGES_PER_EVENT = 3` in `ai-generate-image` |

## Phase 1 — Studio Copilot (the big one)

A persistent chat panel inside EventStudio (`/host/events/:id`) — same
A2UI pipeline, but **event-aware and tool-using**:

- **Architecture**: extend `ai-event-designer` (or new `ai-event-agent`) with
  Gemini *function calling*. Tools return structured calls; the CLIENT
  executes them with the host's own RLS-scoped session (challenges, config)
  or via existing edge fns (image gen). The server never needs write access
  beyond what already exists — no RLS loosening.
- **Context injection**: on each turn the client sends a compact event
  snapshot (name, tier, config.copy, template, challenge list, experience
  names/kinds, post count, wall settings) so the agent "knows everything"
  about that event. ~1-2k tokens; cheap on flash.
- **Tool catalog v1** (each maps to an existing helper + an A2UI widget):
  | Tool | Executes via | Widget rendered |
  |---|---|---|
  | list/query event info | snapshot (no call) | Text/Card summary |
  | add/update/remove challenge | store/admin challenge helpers | Column of TextFields + confirm Button |
  | set theme/template/copy | `updateEventConfig` | ChoicePicker + preview |
  | generate frame/sticker | `generateImage` (`src/lib/ai.ts`) | Image + publish Button |
  | set default experience / landing route | `updateEventConfig` | ChoicePicker |
  | share kit (QRs for welcome/booth/wall/challenges) | client-render | Card with QR Images |
- **Beamwall widget catalog** (`BEAMWALL_CATALOG_ID` in `src/lib/a2ui.ts`,
  rendered by `A2uiSurface.tsx`). Rule: every agent mutation renders a
  PREVIEW widget of what it's about to change before the confirm button.
  Shipped: `TemplatePreview { templateId, eventName }` (live look preview in
  the plan card), `QrCode { value, caption }`. Planned next:
  | Widget | Previews |
  |---|---|
  | `FramePreview { assetUrl, transform }` | a generated/selected frame over a sample photo |
  | `ChallengeList { path }` (templated) | challenge set being added/edited |
  | `EventStat { label, value }` | query answers ("how many wall posts?") |
  | `BoothMock { experienceId }` | booth orb-bar with the new default highlighted |
  | `Diff { before, after }` | copy/theme changes before applying |
  | `Modal` (basic catalog) | destructive-action confirmations |
  The renderer's action contract generalizes from `confirm_plan` to a
  `name`-dispatched handler map on the consumer side.

## Concierge v3 — the whole checklist happens in chat (next build)

The goal: a host finishes look, colours, AND a signature frame inside the
concierge, so the studio dashboard's only remaining step is the test photo.
- **Colour picking as a widget**: a `ColorChoice` custom widget bound to
  `/plan/accent` etc., live-restyling the `TemplatePreview` (same two-way
  binding the style chips already use).
- **In-chat frame generation**: post-create handoff — after Create, the
  concierge keeps the conversation, now event-aware, and offers "want me to
  design your signature frame?" → calls `ai-generate-image` (kind `border`,
  9:16 / 1080×1920 portrait — the booth capture size) → renders a
  `FramePreview` widget → host can nudge position/scale (drag = editing the
  experience's `transform`) and hit Save → the experience publishes to their
  studio Library automatically.
- Checklist steps then read "done" because the host actually did them in
  chat; template-default passes stay labelled as defaults (shipped 2026-07-07).

## Admin limits console (user-requested; pairs with admin-suite Phase 4)

Platform admins are already limit-free end-to-end (create-event → deluxe,
designer rate-limit exempt, orgs comped 1000 credits, existing events
upgraded). The manual "space to change limits per event/user" = admin-suite
Phase 4's `set_event_tier` + `adjust_credits` admin-api actions + a Limits
screen (event tier dropdown, org credit grants) — build it there so it gets
the audit trail (`admin_audit`) for free. See docs/ADMIN-SUITE.md Phase 4.

## Phase 2 — Share kit & signage

- Host-facing "Share & Print" screen: per-surface QR codes (welcome, booth,
  wall, challenges, upload) + printable table-card/poster layout (CSS print).
- Point signage QRs at `/e/:slug/welcome` (live now) instead of raw booth.

## Phase 3 — Hardening (before real traffic)

- Rate-limit `ai-event-designer` (per-user hourly cap; simple count on a
  `ai_chat_usage` table or KV) — it is free + JWT-gated only.
- Persist concierge transcripts (sessionStorage first; `event_chats` table if
  cross-device matters).
- Restrict the Gemini key to the Generative Language API; rotate (owner said
  post-deploy).
- Server-streamed A2UI: document the action-name contract (`confirm_plan`,
  context bound to `/plan`) so server-authored cards stay compatible; share
  template ids with the edge fn from one source (build-time constant or
  fetch) to kill the "keep in lockstep" comment.
- Funnel analytics on /host/new (concierge vs manual, turns-to-create).

## Known accepted tradeoffs

- Renderer implements catalog components no local producer emits yet
  (Icon/Image/templated List) — kept deliberately: they're the A2UI basic
  catalog and phase-1 tools will emit them.
- `smoothing.ts` hand-rolls slerp to stay three.js-free for node vitest.
- Free-image count is best-effort under exact concurrency (worst case: one
  extra free image).
