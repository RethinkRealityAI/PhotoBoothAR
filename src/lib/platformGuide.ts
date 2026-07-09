/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Platform Guide — a hand-written digest of how Beamwall works, sent as
 * grounding for the copilot's help mode (same "client's live copy wins"
 * pattern as the template catalog; the edge fn caps it at 12k chars and
 * falls back to a one-liner). Keep it terse, factual, and current — this IS
 * what the agent knows about the product. Update it when surfaces change.
 */
export const PLATFORM_GUIDE = `
BEAMWALL — self-serve AR photo-booth + live photo-wall + keepsake-card platform for events (weddings, galas, birthdays, corporate, parties). Everything runs in the browser; guests never install an app.

GUEST EXPERIENCE (per event, at /e/<slug>):
- /welcome — landing page explaining the event's features, one tap into each; best target for printed signage QRs.
- /booth — AR photo booth: live face-tracked 3D pieces (crowns, glasses…), frames, shader effects, photo + video capture, countdown timer, front/back camera. Captures beam to the wall.
- /wall — the live photo wall (project it at the venue); realtime, with optional QR overlay and challenge leaderboard.
- /upload — guests send photos from their camera roll to the wall.
- /challenges — photo missions (each has a title, emoji, points); completing one tags the capture and scores the leaderboard. Hosts toggle the feature per event.
- Moderation: hosts approve/hide posts in the studio Wall tab; day-of staff can use a manager link (token) at /m/<slug>.

HOST STUDIO (/host/events/<id>, tabs):
- Dashboard: go-live checklist (name, look, frames, test photo), live stats, Go-live button (event starts as draft; guests join once live).
- Experiences (library): every frame/filter/3D piece; publish/unpublish; set booth default.
- Studio: one unified editor for every experience. Switch between 2D (frames, stickers, shader filters), 3D (head-anchored props with a live face-tracked preview + reference-head orbit view), and Preview (see the composited result exactly as guests capture) — all sharing one camera. Browse or drag built-in art, uploads, and head pieces onto the canvas; upload art or AI-generate frames/stickers (first 3 AI images per event are free, then 1 credit each). 3D props are occluded by the real head, and a per-event "head size" slider matches props to real faces. AI Scene Director (top-bar button): describe a look and it designs a matching frame + filter + 3D piece to accept piece by piece.
- Assets: every file uploaded to the event's asset bucket (browse, copy URL, delete).
- Wall: moderation + wall settings (QR, leaderboard, challenges toggle).
- Challenges: create/edit/delete photo missions (title, emoji, points, active).
- Cards: greeting cards / video guestbook — create a card, share its contribution link (/c/<publicId>/contribute?t=<token>) so anyone can add photos/videos/notes; publish makes the card viewable at /c/<publicId>; publishing/email requires a premium+ event (or org Pro subscription); Deluxe adds a rendered MP4 keepsake film (30 credits).
- Share: QR kit for every guest surface + print signage mode.
- Branding: theme colours, background, fonts, copy. Settings: landing route, defaults. Manager access: mint day-of staff links.

CREATING EVENTS:
- /host/new — the Event Concierge: describe the event in chat and the AI designs it (name, style template, accent colour, date, link, remote mode) with a live preview card; or use the manual 3-step wizard. On success, the AI Frame Studio designs a signature 9:16 frame, publishes it and sets it as the booth default (drag to position, size slider).
- /host/concierge — the Concierge workspace: every event as a card (rename inline, go live/end, copy link, open studio) beside this chat; pick an event and manage it in plain words. Ask for a "challenge pack" to get a themed set of 3-6 challenges added in one confirm.
- Remote/virtual celebrations: guests contribute to a greeting card from anywhere; the card can be pinned as the event landing.

PLANS & CREDITS:
- Tiers per event: free (25 posts, photo only, watermark, 7-day retention) → essentials (500 posts, video, no watermark, AI studio) → premium (unlimited posts, cards) → deluxe (premium render/keepsake film). An org-level Pro subscription raises every event to premium-level.
- Credits: AI generation currency (1 credit ≈ one AI image; 3D and film cost more). Bought in packs; first 3 images per event are free. Billing lives at /host/billing.

COMMON HOW-TOS:
- Show someone what Beamwall does without an account: the home page (/) has a live no-sign-in demo booth — real AR camera, frames, effects and a mini live wall.
- Go live: finish the Dashboard checklist → Go live button. Share: Share tab → print signage (point signage at /welcome).
- Change the booth's default frame: Experiences → publish the frame → set as default (or let the Frame Studio do it at create time).
- Design a whole coordinated look fast: Studio → Scene Director → describe the vibe → accept the frame, filter, and head piece it proposes.
- Make a 3D prop sit right on real faces: Studio → 3D → nudge the "Head size" slider up if props look small in Preview.
- Add a challenge: Challenges tab → New challenge (or ask the copilot).
- Make a greeting card: Cards tab → create card → copy the contribution link (or ask the copilot). Publish when ready to share the viewer link.
- Day-of staff: Manager access tab → create token → share /m/<slug> link.
`.trim();
