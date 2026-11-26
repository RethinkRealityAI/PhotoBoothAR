/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The hub's Features tab: every major thing Beamwall does, one card each, with
 * a real product picture and ONE line a rep can say out loud. The hub's other
 * cheat sheet (CHEAT_SHEET in salesContent.ts) is positioning and rules; this
 * one is "what can it do?" — the list a rep scans before a call.
 *
 * Pure data (no React, no asset imports) so the tests can hold the copy to
 * the house vocabulary: Looks / Frames / Props / Paint / Effects, never the
 * word for photo overlays that the platform retired. Pictures are named by
 * key; HubFeatures.tsx maps every key (typed, so a missing one is a compile
 * error). Claims stay honest: anything plan-gated says so in its tag.
 */

/** The lucide icon a card wears (mapped in HubFeatures.tsx). */
export type FeatureIcon =
  | 'qr' | 'frame' | 'crown' | 'paint' | 'sparkles' | 'box' | 'camera' | 'trophy' | 'eye' | 'zap'
  | 'monitor' | 'shield' | 'mail' | 'film' | 'gift' | 'wand' | 'library' | 'wizard' | 'bot' | 'studio'
  | 'handshake' | 'megaphone' | 'users' | 'smartphone';

/** Real product pictures. `phone` = a 9:16-ish phone screen, `wide` = desktop or a landscape still. */
export type FeatureImageKey =
  | 'guest-welcome' | 'guest-frame' | 'guest-crown' | 'guest-paint' | 'guest-effects' | 'guest-more-looks'
  | 'guest-challenges' | 'guest-send' | 'world-place' | 'photo-strips' | 'wall-grid' | 'wall-gallery'
  | 'setup-looks' | 'setup-launch' | 'setup-welcome' | 'setup-powerups' | 'studio-editor' | 'library-try-on'
  | 'ai-frame-maker' | 'card-designs' | 'keepsake-film' | 'beamy-reveals' | 'beamy-wave';

export type FeatureTag = 'New' | 'Paid plans' | 'Enterprise add-on' | 'Done for you' | 'Free plan' | 'Coming soon';

export interface Feature {
  id: string;
  title: string;
  /** The line to say. One sentence, plain words, ≤ 140 characters. */
  line: string;
  /** Optional proof point or detail for a follow-up question. ≤ 160 characters. */
  detail?: string;
  icon: FeatureIcon;
  image?: FeatureImageKey;
  tag?: FeatureTag;
  /** A live page the rep can open in front of the prospect (public, no sign-in). */
  demo?: { label: string; path: string };
}

export interface FeatureGroup {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  features: Feature[];
}

/** The public demo event every "show them" link opens. */
export const DEMO_EVENT = 'the-winter-gala';

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'booth',
    eyebrow: 'The booth',
    title: 'A virtual photo booth in every pocket',
    intro: 'Guests scan a QR code and the booth opens in their phone’s browser. Everything they try on is a Look.',
    features: [
      {
        id: 'no-app',
        title: 'Scan and shoot, no app',
        line: 'Guests scan one QR code and the booth opens in their browser: no app, no sign-in, no queue, no hardware to hire.',
        detail: 'Think Snapchat and Instagram, in the browser. Works on any modern iPhone or Android, and every guest shoots at once, so there is never a line.',
        icon: 'qr',
        image: 'guest-welcome',
        demo: { label: 'Open the demo booth', path: `/e/${DEMO_EVENT}/welcome` },
      },
      {
        id: 'frames',
        title: 'Frames',
        line: 'Branded 2D frames around every shot, so the event’s name, colours and logo travel with every photo.',
        detail: 'Hosts pick from the library; for a custom one, our team designs it with AI in minutes.',
        icon: 'frame',
        image: 'guest-frame',
      },
      {
        id: 'props',
        title: 'Props',
        line: 'Realistic 3D props that follow every face: crowns, hats, masks, jewellery, lit like the room they are in.',
        detail: 'Up to three faces in one shot each get their own prop. Guests pick colourways, like Jamaica and Nigeria flags on masks and shades, and add engraved names.',
        icon: 'crown',
        image: 'guest-crown',
      },
      {
        id: 'paint',
        title: 'Paint',
        line: 'Face paint that moves with every smile: tigers, butterflies, full-face flags, wedding designs, or a logo on a cheek.',
        icon: 'paint',
        image: 'guest-paint',
      },
      {
        id: 'effects',
        title: 'Effects',
        line: 'Whole-screen sparkle, snow, confetti and colour grades that layer over any Look.',
        icon: 'sparkles',
        image: 'guest-effects',
      },
      {
        id: 'animated-frames',
        title: 'Animated frames',
        line: 'Frames that come alive: balloons rise, stars twinkle, petals sway, and the motion is saved in every video.',
        detail: 'Each piece animates in, then keeps moving gently. Guests tap Replay to restart the entrance right before they record.',
        icon: 'film',
        tag: 'New',
      },
      {
        id: 'gesture-looks',
        title: 'Looks that react',
        line: 'Smile, wink, raise your brows or open wide and confetti, hearts or fireworks burst out on cue.',
        detail: 'A short “Try this” card pops up when a guest picks one, so they know exactly what to do.',
        icon: 'sparkles',
        tag: 'New',
      },
      {
        id: 'mix',
        title: 'Mix and match',
        line: 'Guests mix a frame, a prop and an effect into their own Look, or tap a ready-made combo the host built.',
        icon: 'smartphone',
        image: 'guest-more-looks',
      },
      {
        id: 'world',
        title: 'World mode: 3D frames in the room',
        line: 'Flip to the back camera and a life-size frame stands in the room, so friends can step inside it together.',
        detail: 'Point at the floor, tap to place, pinch to resize. Flip back and the face Looks carry on as before.',
        icon: 'box',
        image: 'world-place',
        tag: 'New',
      },
      {
        id: 'modes',
        title: 'Photos, videos and strips',
        line: 'Photos, short videos with sound, and 2-, 3- or 4-shot photo strips laid out in the event’s colours.',
        detail: 'Videos run up to 30 seconds on Free and Essentials, 60 on Premium and 90 on Deluxe.',
        icon: 'camera',
        image: 'photo-strips',
      },
      {
        id: 'challenges',
        title: 'Challenges and a leaderboard',
        line: 'Photo missions with points and a leaderboard keep guests shooting all night, and AI checks each shot fits.',
        detail: 'Tap a challenge and the camera opens on it; after sending, guests see their points and the next mission.',
        icon: 'trophy',
        image: 'guest-challenges',
        demo: { label: 'See the challenges', path: `/e/${DEMO_EVENT}/challenges` },
      },
      {
        id: 'surprise',
        title: 'Surprise me',
        line: 'One tap dresses a guest in a random frame, prop and effect, so nobody gets stuck choosing.',
        detail: 'It only picks Looks that work together and never repeats the one already on.',
        icon: 'wand',
        tag: 'New',
      },
      {
        id: 'powerups',
        title: 'Power-Ups',
        line: 'Smile or open your mouth to fire a beam, and coloured contact lenses that follow every glance.',
        icon: 'zap',
        image: 'setup-powerups',
      },
    ],
  },
  {
    id: 'wall',
    eyebrow: 'The big screen',
    title: 'Every shot, live on the wall',
    intro: 'The moment a guest taps Send, their photo beams onto the venue screen. That is the wow in the room.',
    features: [
      {
        id: 'live-wall',
        title: 'Live wall',
        line: 'Every photo beams onto the venue screen the moment it is sent, with a QR code so the whole room joins in.',
        detail: 'Runs on any screen with a browser. Layout, QR codes and sharing sit in one Display menu.',
        icon: 'monitor',
        image: 'wall-grid',
        demo: { label: 'Open the demo wall', path: `/e/${DEMO_EVENT}/wall` },
      },
      {
        id: 'wall-styles',
        title: 'Wall styles',
        line: 'Grid, gallery, 3D carousel or a wall + leaderboard split screen, with arrival effects styled to match the event.',
        icon: 'sparkles',
        image: 'wall-gallery',
      },
      {
        id: 'send',
        title: 'One tap to send',
        line: 'Guests add a name or note and send in one tap; they keep a copy on their phone too.',
        icon: 'users',
        image: 'guest-send',
      },
      {
        id: 'keep-shot',
        title: 'Straight to Photos and Instagram',
        line: 'One Save or share button hands guests the real photo or clip, ready for Photos, Instagram or WhatsApp.',
        detail: 'Every share carries the event’s name, so each post is free reach for the host.',
        icon: 'smartphone',
        tag: 'New',
      },
      {
        id: 'reactions',
        title: 'Live reactions',
        line: 'Guests tap a heart or a laugh on any photo and it floats up from that photo on the big screen.',
        detail: 'Guests can also jump straight to their own photo on the wall from the “Sent!” screen.',
        icon: 'sparkles',
        tag: 'New',
      },
      {
        id: 'moderation',
        title: 'Moderation',
        line: 'Hosts approve or hide any photo from their phone, so nothing lands on the wall they would not want there.',
        icon: 'shield',
      },
    ],
  },
  {
    id: 'after',
    eyebrow: 'After the night',
    title: 'Keepsakes people actually keep',
    intro: 'The event keeps working after the lights go up. Everything here is digital, nothing to print or post.',
    features: [
      {
        id: 'album',
        title: 'Digital album by email',
        line: 'Next morning, guests get a digital album by email, with a recap page of the whole night.',
        icon: 'mail',
      },
      {
        id: 'film',
        title: 'Keepsake film',
        line: 'A highlight film of the night, cut from the guests’ own photos and videos.',
        icon: 'film',
        image: 'keepsake-film',
        tag: 'Paid plans',
      },
      {
        id: 'cards',
        title: 'Birthday and celebration cards',
        line: 'Friends anywhere add a photo, video or note to one digital card, and it arrives on the day, right on time.',
        detail: '20 animated designs to choose from. Friends can record their message in the AR booth.',
        icon: 'gift',
        image: 'card-designs',
        demo: { label: 'Browse card designs', path: '/card-designs' },
      },
    ],
  },
  {
    id: 'hosts',
    eyebrow: 'For hosts',
    title: 'Set up in minutes, not days',
    intro: 'A host goes from sign-up to a live event on their phone without calling anyone.',
    features: [
      {
        id: 'wizard',
        title: 'Host setup wizard',
        line: 'A guided setup takes a host from name and date to Looks, challenges, live wall and launch in minutes.',
        icon: 'wizard',
        image: 'setup-looks',
      },
      {
        id: 'ai-frames',
        title: 'AI frame maker',
        line: 'Describe a vibe and our team’s AI designs custom frames in the event’s colours in minutes.',
        detail: 'Hosts can’t run it themselves yet (it is being refined), so offer it as part of done-for-you.',
        icon: 'wand',
        tag: 'Done for you',
        image: 'ai-frame-maker',
      },
      {
        id: 'library',
        title: 'Shared library',
        line: 'A growing library of ready Looks for weddings, galas, birthdays and festive nights; try any on before adding it.',
        icon: 'library',
        image: 'library-try-on',
      },
      {
        id: 'welcome',
        title: 'Branded welcome page',
        line: 'Each event gets its own welcome page in its colours, the first thing guests see after the QR code.',
        icon: 'qr',
        image: 'setup-welcome',
      },
      {
        id: 'copilot',
        title: 'AI assistant',
        line: 'Soon hosts can ask an assistant in plain words to build or change their event: “add a toast challenge”.',
        detail: 'Not open to hosts yet. Don’t promise it as live; the setup wizard covers the same ground today.',
        icon: 'bot',
        tag: 'Coming soon',
      },
      {
        id: 'launch',
        title: 'Go live and share',
        line: 'One tap to go live, with a printable QR sign and a share link ready to send.',
        icon: 'megaphone',
        image: 'setup-launch',
      },
    ],
  },
  {
    id: 'premium',
    eyebrow: 'Premium and services',
    title: 'When they want it custom',
    intro: 'For brands, agencies and planners who want their own pieces, or want us to do it all.',
    features: [
      {
        id: 'studio',
        title: 'Studio',
        line: 'A pro editor to build bespoke 3D Props, scenes and Looks from scratch, for agencies and brands.',
        detail: 'Sold as an enterprise add-on, not on the self-serve plans.',
        icon: 'studio',
        image: 'studio-editor',
        tag: 'Enterprise add-on',
      },
      {
        id: 'dfy',
        title: 'Done for you',
        line: 'We build the whole event remotely: custom frames, 3D Props, challenges, wall and keepsakes. You get the link.',
        detail: 'Fully remote. Nothing for us to do on the day, no venue visit needed.',
        icon: 'handshake',
        image: 'beamy-wave',
        tag: 'Done for you',
      },
      {
        id: 'reveals',
        title: 'Beamy reveal emails',
        line: 'Customers hear about new features and offers through playful emails they unlock with Beamy.',
        detail: 'Our own marketing, not a customer tool. Good proof of the polish they are buying.',
        icon: 'megaphone',
        image: 'beamy-reveals',
      },
    ],
  },
];

/** If you only have 30 seconds: the five lines that carry the pitch. */
export const FAST_FIVE: string[] = [
  'It is an immersive virtual photo booth: think Snapchat and Instagram, in the browser. No app, no sign-in.',
  'They try on Looks: branded Frames, 3D Props, face Paint and Effects.',
  'Every photo beams onto the venue’s big screen the moment it is sent.',
  'Challenges and a leaderboard keep the whole room shooting all night.',
  'Next morning everyone gets a digital album, plus a film on paid plans.',
];

/** Every feature, flat (search, tests). */
export const ALL_FEATURES: Feature[] = FEATURE_GROUPS.flatMap((g) => g.features);

/** Case-insensitive match over title, line and detail. Empty query = everything. */
export function searchFeatures(groups: FeatureGroup[], query: string): FeatureGroup[] {
  const q = query.trim().toLowerCase();
  if (q === '') return groups;
  return groups
    .map((g) => ({
      ...g,
      features: g.features.filter((f) => `${f.title} ${f.line} ${f.detail ?? ''} ${f.tag ?? ''}`.toLowerCase().includes(q)),
    }))
    .filter((g) => g.features.length > 0);
}
