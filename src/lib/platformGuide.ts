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
- Assets, 2D/Shader creator (upload art or AI-generate frames/stickers; first 3 AI images per event are free, then credits — 1 credit per Gemini image), 3D Anchors (place 3D props on face anchor points with a live preview).
- Wall: moderation + wall settings (QR, leaderboard, challenges toggle).
- Challenges: create/edit/delete photo missions (title, emoji, points, active).
- Cards: greeting cards / video guestbook — create a card, share its contribution link (/c/<publicId>/contribute?t=<token>) so anyone can add photos/videos/notes; publish makes the card viewable at /c/<publicId>; publishing/email requires a premium+ event (or org Pro subscription); Deluxe adds a rendered MP4 keepsake film (30 credits).
- Share: QR kit for every guest surface + print signage mode.
- Branding: theme colours, background, fonts, copy. Settings: landing route, defaults. Manager access: mint day-of staff links.

CREATING EVENTS:
- /host/new — the Event Concierge: describe the event in chat and the AI designs it (name, style template, accent colour, date, link, remote mode) with a live preview card; or use the manual 3-step wizard. On success, the AI Frame Studio designs a signature 9:16 frame, publishes it and sets it as the booth default (drag to position, size slider).
- Remote/virtual celebrations: guests contribute to a greeting card from anywhere; the card can be pinned as the event landing.

PLANS & CREDITS:
- Tiers per event: free (25 posts, photo only, watermark, 7-day retention) → essentials (500 posts, video, no watermark, AI studio) → premium (unlimited posts, cards) → deluxe (premium render/keepsake film). An org-level Pro subscription raises every event to premium-level.
- Credits: AI generation currency (1 credit ≈ one AI image; 3D and film cost more). Bought in packs; first 3 images per event are free. Billing lives at /host/billing.

COMMON HOW-TOS:
- Show someone what Beamwall does without an account: the home page (/) has a live no-sign-in demo booth — real AR camera, frames, effects and a mini live wall.
- Go live: finish the Dashboard checklist → Go live button. Share: Share tab → print signage (point signage at /welcome).
- Change the booth's default frame: Experiences → publish the frame → set as default (or let the Frame Studio do it at create time).
- Add a challenge: Challenges tab → New challenge (or ask the copilot).
- Make a greeting card: Cards tab → create card → copy the contribution link (or ask the copilot). Publish when ready to share the viewer link.
- Day-of staff: Manager access tab → create token → share /m/<slug> link.
`.trim();
