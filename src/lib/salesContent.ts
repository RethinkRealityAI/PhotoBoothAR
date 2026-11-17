/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content for the partnerships sales hub (src/pages/sales/**) and the
 * prospect-facing /pitch/:slug decks.
 *
 * Rules this file keeps (salesContent.test.ts enforces most of them):
 *  - Every product claim maps to something that ships today (landing page,
 *    README, src/lib/plans.ts). No lead-capture forms, no white-label domains,
 *    no offline mode, no instant prints — the product does not have them.
 *  - Every external statistic on a slide carries `source`, and every fact the
 *    playbook leans on is in RESEARCH_NOTES with the URL it came from.
 *  - Beamwall has no public case studies yet. Proof = the live demo, the real
 *    price list and a "founding partner" ask — never invented logos or quotes.
 *  - Sales-led prices (Signature, Partner) are placeholders: prospects only ever
 *    see `publicOfferPrice()`, and decks reach prospects only through
 *    `publicDeck()`, which strips James's speaker notes.
 *  - Two markets, separate collateral (owner, 2026-11-17). Nigeria (NG) is the
 *    primary focus and is INVOICED (PayPal / bank transfer) — NG decks never
 *    show the USD self-serve tiers or a card checkout. North America (NA) sells
 *    the real USD self-serve tiers plus the sales-led offers.
 *
 * Pure data + pure functions. No React, no supabase import.
 */
import {
  TEMPLATE_TOKENS,
  type CheatSheetSection,
  type DailyRoutineBlock,
  type DailyTarget,
  type Deck,
  type DiscoveryQuestion,
  type MessageTemplate,
  type Objection,
  type Offer,
  type PlanWeek,
  type ResearchNote,
  type SopStep,
  type SourcingChannel,
  type TemplateToken,
} from './salesTypes';

/** Image keys the sales UI knows how to render (src/pages/sales/salesImages.ts). */
export const SLIDE_IMAGE_KEYS = [
  'hero-wall', 'booth-phone', 'booth-guy', 'frames', 'card', 'step-create', 'step-qr',
  'step-wall', 'trophy', 'event-wedding', 'event-gala', 'event-conference',
  'event-tradeshow', 'event-activation', 'event-birthday', 'beamy', 'beamy-wave',
] as const;

// Short labels reused on slides so a source string never drifts between decks.
const SRC_CHECKCHERRY = 'Check Cherry booking data, ~118,000 photo booth rentals, 2024–2026';
const SRC_NIELSEN = 'Nielsen Global Trust in Advertising, 2015 (30,000+ respondents, 60 countries)';
const SRC_BEAMWALL = 'Beamwall public price list';

// ── Decks ──────────────────────────────────────────────────────────────────

const NA_PLANNERS_DECK: Deck = {
  id: 'planners',
  market: 'na',
  slug: 'planners',
  name: 'Event & wedding planners',
  audience:
    'Owners and lead planners at wedding and event planning companies running many events a year — a channel, not a one-off sale.',
  oneLiner: 'The guest experience your clients talk about — with zero hardware to haul.',
  rgb: '232, 121, 249',
  slides: [
    {
      id: 'cover',
      kind: 'cover',
      eyebrow: 'For event & wedding planners',
      title: 'Give every client a room that lights up',
      body: 'An AR photo booth on every guest’s phone, beaming live onto a big-screen wall. No hardware, no app.',
      image: 'hero-wall',
      notes:
        'Open on the outcome, not the tech: the moment the room watches its own photos land on the wall. Ask how many events they run a year before you go further — it frames everything after.',
    },
    {
      id: 'problem',
      kind: 'problem',
      eyebrow: 'The usual photo booth',
      title: 'Booths are heavy, fixed and forgettable',
      bullets: [
        'One booth, one queue, one corner of the room',
        'Delivery, setup and an attendant to manage',
        'Same props and prints at every event',
        'Guests rarely see each other’s shots',
      ],
      stats: [
        { value: '$886', label: 'median wedding photo booth booking', source: SRC_CHECKCHERRY },
      ],
      image: 'booth-guy',
      notes:
        'Let them say the pain in their own words — logistics, queues, vendors who run late. The $886 is a real median across ~118k bookings; use it as context, not as an attack on their booth vendor.',
    },
    {
      id: 'solution',
      video: 'wall',
      kind: 'solution',
      eyebrow: 'Beamwall',
      title: 'The booth lives in every pocket',
      body: 'Guests scan one QR code and the booth opens in their phone’s browser. Every shot beams onto the live wall.',
      image: 'booth-phone',
      notes:
        'The key idea: every guest IS the booth, so there is no queue and no corner. Nothing to install, nothing to ship — that is the logistics win for them.',
    },
    {
      id: 'how',
      kind: 'how',
      eyebrow: 'How it works',
      title: 'Ready in minutes, not days',
      items: [
        { title: 'Create the event', body: 'Pick a style, tune frames and effects in the studio.', icon: 'Sparkles' },
        { title: 'Share one QR code', body: 'On tables, screens or the invite. No app.', icon: 'QrCode' },
        { title: 'The room lights up', body: 'Photos and videos beam onto the wall live.', icon: 'MonitorPlay' },
      ],
      image: 'step-qr',
      notes:
        'Keep it to three steps. The next slide is the live booth, so show it there rather than describing it.',
    },
    {
      id: 'demo',
      kind: 'demo',
      eyebrow: 'Try it now',
      title: 'Be a guest for ten seconds',
      body: 'Pick a frame, add a tiara, take a photo and beam it to the wall. This is what your clients’ guests see.',
      demoKit: 'wedding',
      notes:
        'Hand them the booth: tap Start the camera here, or let them scan the QR on their own phone. Nothing is uploaded and photos stay on their device. Say clearly it is a sample kit: every event gets its own frames in the couple’s names, colours and monogram.',
    },
    {
      id: 'features',
      kind: 'features',
      eyebrow: 'What your clients get',
      title: 'Everything a booth does, and more',
      items: [
        { title: 'Branded AR frames', body: 'Face-tracked frames and effects in their colours.', icon: 'Frame', showcase: 'frames' },
        { title: 'AI-designed frames', body: 'Describe the theme; get frames in minutes.', icon: 'Wand2', showcase: 'ai' },
        { title: 'Live photo wall', body: 'Every shot lands on the big screen.', icon: 'MonitorPlay', showcase: 'wall' },
        { title: 'Challenges & leaderboard', body: 'Photo missions that get the room moving.', icon: 'Trophy', showcase: 'challenges' },
        { title: 'Keepsake cards', body: 'Guest moments compiled into one animated card.', icon: 'Mail', showcase: 'keepsake' },
        { title: 'Moderation built in', body: 'Approve photos before they hit the wall.', icon: 'ShieldCheck', showcase: 'moderation' },
      ],
      image: 'frames',
      notes:
        'Match features to their client types: weddings love keepsake cards, corporate clients love branded frames and challenges. AI frames are in Premium and above; greeting cards are Premium and above.',
    },
    {
      id: 'offer',
      kind: 'offer',
      eyebrow: 'Two ways to work with us',
      title: 'We build it, or you do',
      body: 'Signature: we design and build it for your client, then hand over the links. Partner: you build and run it for clients, at your price.',
      offerIds: ['signature-150', 'signature-400', 'signature-custom', 'partner'],
      notes:
        'Signature is done-for-you at list price ($495 up to 150 guests, $795 up to 400, from $1,495 above), and planners get five events for the price of four. Signature is fully remote: we build everything on the platform and hand over the links, Signage Kit and a one-page setup guide 7 days out — we never attend, check the venue, set up a screen, or run or monitor the wall; the client runs the day. Partner ($499/month or $4,990/year) is a licence to build and run Beamwall experiences for their clients and set their own price — no white-label or partner branding yet. There is NO separate reseller margin. Paid in full to book, fully refundable until designs are approved.',
    },
    {
      id: 'roi',
      kind: 'roi',
      eyebrow: 'Illustrative maths',
      title: 'What a season could look like',
      body: 'Example only, using our real $99 Premium tier. Your price, your margin, your call.',
      bullets: [
        'Assumption: 20 events a year',
        'Your cost: $99 Premium per event',
        'Example client price: $450 per event',
        'Margin: $351 per event, $7,020 a year',
      ],
      stats: [
        { value: '$886', label: 'median wedding booth booking', source: SRC_CHECKCHERRY },
        { value: '$99', label: 'Beamwall Premium, per event', source: SRC_BEAMWALL },
      ],
      notes:
        'These numbers are ILLUSTRATIVE — say so out loud. 20 events and a $450 client price are assumptions to swap for theirs; only the $99 self-serve tier and the $886 median are real. For a Partner prospect, rerun it with the $499/month licence spread across their events.',
    },
    {
      id: 'quote',
      video: 'sizzle',
      kind: 'quote',
      title: 'Be the planner whose events get filmed',
      image: 'event-wedding',
      notes:
        'Pause here. This is the aspiration: their events become the ones guests post about, which markets the planner for free.',
    },
    {
      id: 'cta',
      kind: 'cta',
      eyebrow: 'Founding partners',
      title: 'Become a founding planner partner',
      body: 'Launch with us as a founding partner and help shape what we build next. Let’s pick your first event.',
      image: 'beamy-wave',
      notes:
        'The ask: a 20-minute call to pick one upcoming event as a pilot. "Founding partner" is honest — we are early. No scarcity or limited-slot language: there is no cap. Book it on the call; do not leave it as "I will send info".',
    },
  ],
};

const NA_BRANDS_DECK: Deck = {
  id: 'brands',
  market: 'na',
  slug: 'brands',
  name: 'Brands & corporate events',
  audience:
    'Marketing, events and brand leads at SME/SMB companies running launches, activations, conferences and trade-show stands.',
  oneLiner: 'Turn every attendee’s phone into a branded content studio.',
  rgb: '91, 140, 255',
  slides: [
    {
      id: 'cover',
      kind: 'cover',
      eyebrow: 'For brands & corporate events',
      title: 'Every attendee becomes your content crew',
      body: 'Branded AR photos on attendees’ own phones, beaming live onto your screen. No hardware, no app.',
      image: 'event-activation',
      notes:
        'Lead with content and attention, not "photo booth". Ask what their next launch, stand or conference is — the deck lands better with a real event in mind.',
    },
    {
      id: 'problem',
      kind: 'problem',
      eyebrow: 'The usual event',
      title: 'Great events, then the moment vanishes',
      bullets: [
        'Stands compete for the same foot traffic',
        'Photos sit on phones, not your channels',
        'Booth hardware means freight and setup',
        'Hard to show what the event delivered',
      ],
      stats: [
        { value: '$899', label: 'median corporate photo booth booking', source: SRC_CHECKCHERRY },
      ],
      image: 'event-tradeshow',
      notes:
        'Get them to name their own metric — foot traffic, social posts, content for the team. The $899 is a real corporate median; it anchors what they already pay for less.',
    },
    {
      id: 'solution',
      video: 'wall',
      kind: 'solution',
      eyebrow: 'Beamwall',
      title: 'Your brand on every shot',
      body: 'Attendees scan a QR, wear your branded AR frame, and watch their shot land on your live wall.',
      image: 'hero-wall',
      notes:
        'The wall is the draw for the floor; the branded frame is what travels when guests share their shot. Keep it concrete.',
    },
    {
      id: 'how',
      kind: 'how',
      eyebrow: 'How it works',
      title: 'Live in three steps',
      items: [
        { title: 'Brand the booth', body: 'Your logo, colours and AI-designed frames.', icon: 'Palette' },
        { title: 'Put up one QR', body: 'Stand signage, lanyards, slides or screens.', icon: 'QrCode' },
        { title: 'Watch the wall fill', body: 'Every shot beams live to your screen.', icon: 'MonitorPlay' },
      ],
      image: 'step-create',
      notes:
        'A trade-show stand needs a screen and a QR sign — that is the whole kit. The next slide is the live booth; show it rather than describe it.',
    },
    {
      id: 'demo',
      kind: 'demo',
      eyebrow: 'Try it now',
      title: 'Your Christmas party, on their phone',
      body: 'Pick a frame, add a prop, take a photo and beam it to the wall. This is what your guests see.',
      demoKit: 'christmas',
      notes:
        'Let them try it: tap Start the camera here, or scan the QR on their own phone. Nothing is uploaded; photos stay on their device. It is a sample kit: their event gets frames in their brand, campaign and colours.',
    },
    {
      id: 'features',
      kind: 'features',
      eyebrow: 'Built for brand events',
      title: 'Made to draw a crowd',
      items: [
        { title: 'Branded AR frames', body: 'Face-tracked, on-brand, in every photo.', icon: 'Frame', showcase: 'frames' },
        { title: 'AI frame studio', body: 'Describe the campaign; get frames in minutes.', icon: 'Wand2', showcase: 'ai' },
        { title: 'Photo challenges', body: 'Missions and a leaderboard to keep people playing.', icon: 'Trophy', showcase: 'challenges' },
        { title: 'Live wall', body: 'A moving screen that pulls people over.', icon: 'MonitorPlay', showcase: 'wall' },
        { title: 'Moderation', body: 'Approve photos before they hit the wall.', icon: 'ShieldCheck', showcase: 'moderation' },
        { title: 'Gallery link', body: 'Every shot in one gallery afterwards.', icon: 'Images', showcase: 'gallery' },
      ],
      image: 'trophy',
      notes:
        'Do not promise lead-capture forms, CRM sync or analytics dashboards — we do not have them. Do promise branded frames, challenges, moderation and the photos afterwards. Get permission before reusing any guest photo in ads.',
    },
    {
      id: 'proof',
      kind: 'proof',
      eyebrow: 'Why guest content works',
      title: 'People trust people, not ads',
      body: 'Attendee photos carry your brand to their own followers — the format audiences trust most.',
      stats: [
        { value: '83%', label: 'trust recommendations from people they know', source: SRC_NIELSEN },
        { value: '70%', label: 'trust branded websites', source: SRC_NIELSEN },
      ],
      image: 'booth-phone',
      notes:
        'Be honest: the Nielsen figures are about trust in recommendations, not a Beamwall result. Our own proof is the live booth slide; we have no case studies yet.',
    },
    {
      id: 'offer',
      kind: 'offer',
      eyebrow: 'Packages',
      title: 'Self-serve or fully built for you',
      body: 'Run it yourself from $99, or let our team design and build it, ready to share.',
      offerIds: ['premium', 'deluxe', 'signature-400', 'signature-custom'],
      notes:
        'Most marketing teams with a small event go Premium. Busy teams or big rooms want Signature ($795 up to 400 guests, from $1,495 above) — take guest count and date, then book a scoping call.',
    },
    {
      id: 'roi',
      kind: 'roi',
      eyebrow: 'Illustrative maths',
      title: 'Content for under a dollar a shot',
      body: 'Example only. Swap in your own attendance and take-up.',
      bullets: [
        'Assumption: 200 attendees, half take a photo',
        'That is 100 branded shots',
        'Premium at $99: about $0.99 per shot',
        'Versus a $899 median booth booking',
      ],
      stats: [
        { value: '$99', label: 'Beamwall Premium, per event', source: SRC_BEAMWALL },
        { value: '$899', label: 'median corporate booth booking', source: SRC_CHECKCHERRY },
      ],
      notes:
        'Illustrative only — the 200 attendees and 50% take-up are assumptions, say so. Premium includes unlimited photos and video, so more take-up only lowers the per-shot cost.',
    },
    {
      id: 'quote',
      video: 'sizzle',
      kind: 'quote',
      title: 'The stand everyone films',
      image: 'event-conference',
      notes:
        'Let it sit. The goal is to be the booth people point their phones at, then post.',
    },
    {
      id: 'cta',
      kind: 'cta',
      eyebrow: 'Next step',
      title: 'Let’s brand your next event',
      body: 'Tell us the date. We’ll mock up your branded frame and show it live on a short call.',
      image: 'beamy-wave',
      notes:
        'The ask: a 20-minute call where you show their logo in a frame. Get the event date and decision-maker before you hang up.',
    },
  ],
};

const NA_CREATORS_DECK: Deck = {
  id: 'creators',
  market: 'na',
  slug: 'creators',
  name: 'Creators & community hosts',
  audience:
    'Individual creators with roughly 10k–250k followers who host meetups, launch parties, fan events or brand collabs.',
  oneLiner: 'Your meetup becomes a wall of content your fans made for you.',
  rgb: '34, 211, 238',
  slides: [
    {
      id: 'cover',
      kind: 'cover',
      eyebrow: 'For creators',
      title: 'Your fans make the content',
      body: 'Fans scan a QR, snap AR photos in your style, and watch them beam onto a live wall.',
      image: 'event-birthday',
      notes:
        'Creators think in content. Start with what they get to post after the event, then show the experience that makes it.',
    },
    {
      id: 'problem',
      kind: 'problem',
      eyebrow: 'Fan events today',
      title: 'Meetups are fun, then scattered',
      bullets: [
        'You can’t take a photo with everyone',
        'Fan photos vanish into camera rolls',
        'Sponsors want more than a logo slide',
        'Booth hire eats the whole budget',
      ],
      image: 'booth-guy',
      notes:
        'Ask about their last meetup: how many fans came, what they posted afterwards, whether a sponsor was involved.',
    },
    {
      id: 'solution',
      video: 'wall',
      kind: 'solution',
      eyebrow: 'Beamwall',
      title: 'Every fan gets a moment',
      body: 'Your custom AR frame on every fan’s phone, every shot live on the wall, every photo kept.',
      image: 'booth-phone',
      notes:
        'The emotional hook: every fan feels seen on the big screen, even when the creator cannot reach everyone.',
    },
    {
      id: 'how',
      kind: 'how',
      eyebrow: 'How it works',
      title: 'Set it up tonight',
      items: [
        { title: 'Design your frame', body: 'Your look, or describe it to the AI.', icon: 'Wand2' },
        { title: 'Share the QR', body: 'On the door, the screen, or your story.', icon: 'QrCode' },
        { title: 'Fans fill the wall', body: 'Every shot beams live to the room.', icon: 'MonitorPlay' },
      ],
      image: 'step-qr',
      notes:
        'Free tier is enough to test it with friends tonight. Push them to try it before the call ends.',
    },
    {
      id: 'demo',
      kind: 'demo',
      eyebrow: 'Try it now',
      title: 'Your fans’ view, in ten seconds',
      body: 'Pick a frame, add a prop, take a photo and beam it to the wall. This is what your fans see.',
      demoKit: 'party',
      notes:
        'Let them try it: tap Start the camera here, or scan the QR on their own phone. Nothing is uploaded; photos stay on their device. It is a sample kit: their event gets their own look and name on every frame.',
    },
    {
      id: 'features',
      kind: 'features',
      eyebrow: 'Creator toolkit',
      title: 'Built for a content flywheel',
      items: [
        { title: 'Your AR frame', body: 'On-brand, on every fan photo.', icon: 'Frame', showcase: 'frames' },
        { title: 'Fan challenges', body: 'Missions and a leaderboard for the room.', icon: 'Trophy', showcase: 'challenges' },
        { title: 'Sponsor-ready frames', body: 'Put a partner’s brand in every shot.', icon: 'Handshake', showcase: 'frames' },
        { title: 'Keepsake highlight film', body: 'A highlight film of the night, on Deluxe.', icon: 'Film', showcase: 'keepsake' },
      ],
      image: 'frames',
      notes:
        'The sponsor angle is the money angle: a partner frame on every fan photo is a deliverable they can sell. The highlight film is Deluxe only.',
    },
    {
      id: 'offer',
      kind: 'offer',
      eyebrow: 'Pick a plan',
      title: 'Start free, upgrade per event',
      body: 'Real prices, per event. No subscription needed.',
      offerIds: ['free', 'essentials', 'premium', 'deluxe'],
      notes:
        'Creators buy self-serve. Free to test, Premium for the full night, Deluxe if they want the highlight film. Offer to set up the first event with them on a call.',
    },
    {
      id: 'roi',
      kind: 'roi',
      eyebrow: 'Illustrative maths',
      title: 'One sponsor covers the night',
      body: 'Example only. Any sponsor paying more than the plan covers it.',
      bullets: [
        'Premium: $99 for the whole event',
        'Deluxe with highlight film: $169',
        'Assumption: one sponsor frame on every photo',
        'Break-even: a sponsor fee above your plan',
      ],
      stats: [
        { value: '$99', label: 'Beamwall Premium, per event', source: SRC_BEAMWALL },
        { value: '$169', label: 'Beamwall Deluxe, per event', source: SRC_BEAMWALL },
      ],
      notes:
        'Illustrative — we do not know their sponsor rates, so never name one. Ask what they charge for an integration, then show the plan is a fraction of it.',
    },
    {
      id: 'cta',
      kind: 'cta',
      eyebrow: 'Let’s build it',
      title: 'Plan your next fan night',
      body: 'Send the date. We’ll design your first frame with you, live, in fifteen minutes.',
      image: 'beamy-wave',
      notes:
        'The ask: a 15-minute screen-share to design their frame. Leave with a date and a free event created.',
    },
  ],
};

// ── Nigeria decks (primary market; invoiced, never self-serve) ─────────────

const SRC_NG_360 = 'ElitePlanners.ng 2026 360 booth rental guide (approximate)';
const SRC_NG_PACKAGE = 'The Guardian Nigeria, Lagos wedding vendor packages';
const SRC_NG_WEDDING = 'The Guardian Nigeria, Oct 2025 (average wedding cost report)';
const SRC_DETTY = 'MO Africa Detty December 2025 report, via BusinessDay';

const NG_PLANNERS_DECK: Deck = {
  id: 'planners',
  market: 'ng',
  slug: 'ng-planners',
  name: 'Event & wedding planners (Nigeria)',
  audience:
    'Owners and lead planners at Nigerian wedding and event companies running many celebrations a year — sold as a volume channel, invoiced.',
  oneLiner: 'More than a 360 booth, for less than a 360 booth.',
  rgb: '232, 121, 249',
  slides: [
    {
      id: 'cover',
      kind: 'cover',
      eyebrow: 'For event & wedding planners',
      title: 'Every guest becomes the booth',
      body: 'AR photos on every guest’s own phone, beaming live onto the big screen. No machine to hire, no app.',
      image: 'hero-wall',
      notes:
        'Open on the hall: hundreds of guests in their aso-ebi, all on the big screen at once. Ask how many weddings and events they run this season before going further.',
    },
    {
      id: 'problem',
      kind: 'problem',
      eyebrow: 'The 360 booth today',
      title: 'One machine, one queue, one corner',
      bullets: [
        'A 360 booth serves a few guests at a time',
        'Hire, transport, power and an attendant to manage',
        'Most guests never get their turn',
        'The same look at every party this season',
      ],
      stats: [
        { value: '₦200k–₦400k', label: 'typical 360 booth rental, Lagos/Abuja weddings (approx.)', source: SRC_NG_360 },
        { value: '₦1.4m', label: 'premium photo-video package that includes a 360 booth', source: SRC_NG_PACKAGE },
      ],
      image: 'booth-guy',
      notes:
        'Do not knock their 360 vendor — clients love it. The point is reach: at a 500-guest owambe, most guests never touch the booth. The ₦200k–₦400k range is approximate (ElitePlanners.ng guide, consistent with Jiji listings from ₦200k–₦250k); our Signature starts at ₦200,000 for 300 guests. The ₦1.4m is a reported premium package (with drone and shower coverage), not a standalone booth price; say so if asked.',
    },
    {
      id: 'solution',
      video: 'wall',
      kind: 'solution',
      eyebrow: 'Beamwall',
      title: 'The whole hall on the wall',
      body: 'Guests scan one QR code, pose in custom AR frames on their own phones, and every shot lands on the live wall.',
      image: 'booth-phone',
      notes:
        'Every guest is a booth, so there is no queue and nothing to transport. The couple and families see every guest on the screen — that is the moment that gets posted.',
    },
    {
      id: 'how',
      kind: 'how',
      eyebrow: 'How it works',
      title: 'Built in under twenty minutes',
      items: [
        { title: 'We design the frames', body: 'In the couple’s colours, names and monogram.', icon: 'Sparkles' },
        { title: 'Guests scan one QR', body: 'On tables, the screen or the IV.', icon: 'QrCode' },
        { title: 'The hall lights up', body: 'Every photo beams onto the wall live.', icon: 'MonitorPlay' },
      ],
      image: 'step-qr',
      notes:
        'The next slide is the live booth: do it there, or have them scan its QR. A build really takes under 20 minutes, which is why we can price for volume.',
    },
    {
      id: 'demo',
      kind: 'demo',
      eyebrow: 'Try it now',
      title: 'Be a guest for ten seconds',
      body: 'Pick a frame, add a tiara, take a photo and beam it to the wall. This is what your clients’ guests see.',
      demoKit: 'wedding',
      notes:
        'Hand them the booth: tap Start the camera here, or let them scan the QR on their own phone. Nothing is uploaded and photos stay on their device. Say clearly it is a sample kit: every event gets its own frames in the couple’s names, colours and monogram.',
    },
    {
      id: 'features',
      kind: 'features',
      eyebrow: 'What your clients get',
      title: 'More than a booth, for every guest',
      items: [
        { title: 'Custom AR frames', body: 'Names, monograms and colours on every shot.', icon: 'Frame', showcase: 'frames' },
        { title: 'AI-designed in minutes', body: 'Describe the theme; get frames fast.', icon: 'Wand2', showcase: 'ai' },
        { title: 'Live photo wall', body: 'Every guest on the big screen.', icon: 'MonitorPlay', showcase: 'wall' },
        { title: 'Challenges & leaderboard', body: 'Photo missions that get the hall moving.', icon: 'Trophy', showcase: 'challenges' },
        { title: 'Keepsake cards & film', body: 'Guest moments compiled for the couple.', icon: 'Film', showcase: 'keepsake' },
        { title: 'Moderation built in', body: 'Approve photos before they hit the wall.', icon: 'ShieldCheck', showcase: 'moderation' },
      ],
      image: 'frames',
      notes:
        'Weddings: monograms, keepsake cards and the highlight film. Corporate clients: branded frames and challenges. On Signature our team designs and builds all of it remotely; the client gets the links and runs the day.',
    },
    {
      id: 'offer',
      kind: 'offer',
      eyebrow: 'Two ways to work with us',
      title: 'We build it, or you do',
      body: 'Signature: we design and build it for your client, then hand over the links. Partner: add it to every event, at your own price.',
      offerIds: ['ng-signature-300', 'ng-signature-700', 'ng-signature-custom', 'ng-partner'],
      notes:
        'Signature is done-for-you (₦200,000 up to 300 guests, ₦350,000 up to 700, from ₦600,000 above or for brand activations), and planners get five events for the price of four. Signature is fully remote: we build everything on the platform and hand over the links, Signage Kit and a one-page setup guide 7 days out — we never attend, check the venue, set up a screen, or run or monitor the wall; the client runs the day. Partner (₦670,000/month) is a licence to build and run Beamwall experiences for their clients at their own price — no white-label or partner branding yet. Paid in full to book, fully refundable until designs are approved; invoiced via PayPal or bank transfer, never card checkout. Quotes valid 14 days.',
    },
    {
      id: 'roi',
      kind: 'roi',
      eyebrow: 'Illustrative maths',
      title: 'Add it to every package',
      body: 'Example only. You set your client price; your margin is what sits above your Beamwall cost.',
      bullets: [
        'Assumption: you charge your client ₦300,000',
        'Assumption: 30 events this season',
        'Signature pack: five events for the price of four',
      ],
      stats: [
        { value: '₦200k–₦400k', label: 'typical 360 booth rental, Lagos/Abuja wedding (approx.)', source: SRC_NG_360 },
        { value: '₦160,000', label: 'your cost per event: Signature (300 guests) on the 5-for-4 pack', source: SRC_BEAMWALL },
        { value: '₦140,000', label: 'your margin per event at ₦300,000', source: 'Illustrative: ₦300,000 − ₦160,000' },
        { value: '₦4.2m', label: 'your margin across 30 events', source: 'Illustrative: 30 × ₦140,000' },
      ],
      notes:
        'ILLUSTRATIVE — say it out loud. ₦300,000 and 30 events are assumptions; ask for their real client price and event count and redo the sum live. The 360 range is approximate (published guides only) — swap in the real quotes you collect in week 1. Only the ₦200,000 Signature price and the 5-for-4 pack are ours. Context line if useful: the average Nigerian wedding is reported at about ₦13m, so this is a small line in a big budget.',
    },
    {
      id: 'quote',
      video: 'sizzle',
      kind: 'quote',
      title: 'More than a 360 booth, for less',
      image: 'event-wedding',
      notes:
        'The line: "More than a 360 booth, for less than a 360 booth." Every guest is the booth, and it costs less than hiring one. Let it land, then move to the quote.',
    },
    {
      id: 'cta',
      kind: 'cta',
      eyebrow: 'Founding partners',
      title: 'Become a founding planner partner',
      body: 'Launch with us as a founding partner. Send your next date and guest count for a quote.',
      image: 'beamy-wave',
      notes:
        'The ask: next event date + guest count → a quote on WhatsApp within a day. Founding partner is honest — we are launching. Book a 20-minute call to build their first frame.',
    },
  ],
};

const NG_BRANDS_DECK: Deck = {
  id: 'brands',
  market: 'ng',
  slug: 'ng-brands',
  name: 'Brands & corporate events (Nigeria)',
  audience:
    'Marketing, brand and events leads at Nigerian companies and agencies running launches, activations, conferences and festive-season events.',
  oneLiner: 'Your brand on every guest’s photo, live on the big screen.',
  rgb: '91, 140, 255',
  slides: [
    {
      id: 'cover',
      kind: 'cover',
      eyebrow: 'For brands & corporate events',
      title: 'Every guest becomes your content crew',
      body: 'Branded AR photos on guests’ own phones, beaming live onto your screen. No machine, no app.',
      image: 'event-activation',
      notes:
        'Lead with content and reach. Ask about their next launch, activation or end-of-year event.',
    },
    {
      id: 'problem',
      kind: 'problem',
      eyebrow: 'The usual activation',
      title: 'Big crowd, few branded moments',
      bullets: [
        'A booth serves a handful of guests at once',
        'Photos stay on phones, unbranded',
        'Equipment hire, transport and power to sort',
        'Hard to show what the night delivered',
      ],
      image: 'event-tradeshow',
      notes:
        'Let them name their metric: reach, content, buzz on the night. Do not promise lead capture or analytics — we do not have them.',
    },
    {
      id: 'solution',
      video: 'wall',
      kind: 'solution',
      eyebrow: 'Beamwall',
      title: 'Your brand on every shot',
      body: 'Guests scan a QR, pose in your branded AR frame, and watch their photo land on your live wall.',
      image: 'hero-wall',
      notes:
        'The wall pulls the crowd; the branded frame travels when guests share their photos.',
    },
    {
      id: 'how',
      kind: 'how',
      eyebrow: 'How it works',
      title: 'Live in three steps',
      items: [
        { title: 'We brand the booth', body: 'Your logo, colours and campaign frames.', icon: 'Palette' },
        { title: 'Put up one QR', body: 'Signage, screens, tickets or tables.', icon: 'QrCode' },
        { title: 'Watch the wall fill', body: 'Every shot beams live to your screen.', icon: 'MonitorPlay' },
      ],
      image: 'step-create',
      notes:
        'The kit is a screen and a QR sign. Demo it live on the call.',
    },
    {
      id: 'demo',
      kind: 'demo',
      eyebrow: 'Try it now',
      title: 'Your Christmas party, on their phone',
      body: 'Pick a frame, add a prop, take a photo and beam it to the wall. This is what your guests see.',
      demoKit: 'christmas',
      notes:
        'Let them try it: tap Start the camera here, or scan the QR on their own phone. Nothing is uploaded; photos stay on their device. It is a sample kit: their event gets frames in their brand, campaign and colours.',
    },
    {
      id: 'features',
      kind: 'features',
      eyebrow: 'Built for brand events',
      title: 'Made to draw a crowd',
      items: [
        { title: 'Branded AR frames', body: 'Face-tracked and on-brand in every photo.', icon: 'Frame', showcase: 'frames' },
        { title: 'Photo challenges', body: 'Missions and a leaderboard to keep guests playing.', icon: 'Trophy', showcase: 'challenges' },
        { title: 'Live wall', body: 'A moving screen that pulls people over.', icon: 'MonitorPlay', showcase: 'wall' },
        { title: 'Moderation', body: 'Approve photos before they hit the wall.', icon: 'ShieldCheck', showcase: 'moderation' },
        { title: 'Gallery link', body: 'Every shot in one gallery afterwards.', icon: 'Images', showcase: 'gallery' },
      ],
      image: 'trophy',
      notes:
        'Get written permission before reusing any guest photo in ads. No lead forms, CRM sync or dashboards — do not promise them.',
    },
    {
      id: 'proof',
      kind: 'proof',
      eyebrow: 'The season is huge',
      title: 'December crowds are ready to post',
      body: 'Festive-season events draw big, social crowds. Put your brand in their photos.',
      stats: [
        { value: '₦396.5bn', label: 'reported consumer spending, Lagos Detty December 2025', source: SRC_DETTY },
        { value: '83%', label: 'trust recommendations from people they know', source: SRC_NIELSEN },
      ],
      image: 'booth-phone',
      notes:
        'The ₦396.5bn is one report’s estimate for Lagos festive-season spending — context for why brands activate then, not a Beamwall result. We have no case studies yet.',
    },
    {
      id: 'offer',
      kind: 'offer',
      eyebrow: 'Packages',
      title: 'Fully built for you',
      body: 'Our team designs your frames, challenges and wall, then sends the links. Quoted per event, invoiced.',
      offerIds: ['ng-signature-700', 'ng-signature-custom'],
      notes:
        'Most brand events fall in the 700+ / activation tier. Quote only after you have guest count, date and venue. Invoiced via PayPal or bank transfer; no prices until the offers thread confirms naira.',
    },
    {
      id: 'roi',
      kind: 'roi',
      eyebrow: 'Illustrative maths',
      title: 'Count the branded shots',
      body: 'Example only. Swap in your own guest count and take-up.',
      bullets: [
        'Assumption: 500 guests at your launch',
        'Assumption: half take at least one photo',
        'That is 250 branded shots, minimum',
        'Cost per shot: your quote divided by 250',
      ],
      notes:
        'Illustrative — guest count and take-up are assumptions. Run the division live once they have a quote.',
    },
    {
      id: 'cta',
      kind: 'cta',
      eyebrow: 'Next step',
      title: 'Let’s brand your next event',
      body: 'Send your date and guest count. We’ll mock up your branded frame and quote within a day.',
      image: 'beamy-wave',
      notes:
        'The ask: date, guest count, decision-maker, then a 20-minute call where they see their logo in a frame.',
    },
  ],
};

const NG_CREATORS_DECK: Deck = {
  id: 'creators',
  market: 'ng',
  slug: 'ng-creators',
  name: 'Creators & event hosts (Nigeria)',
  audience:
    'Nigerian creators, influencers and hosts (roughly 10k–250k followers) running fan hangouts, launches, parties and brand collabs.',
  oneLiner: 'Your fans make the content — live on the wall, in your own frame.',
  rgb: '34, 211, 238',
  slides: [
    {
      id: 'cover',
      kind: 'cover',
      eyebrow: 'For creators',
      title: 'Your fans make the content',
      body: 'Fans scan a QR, snap AR photos in your style, and watch them beam onto a live wall.',
      image: 'event-birthday',
      notes:
        'Start with what they get to post after: hundreds of fan photos in their own frame.',
    },
    {
      id: 'problem',
      kind: 'problem',
      eyebrow: 'Fan events today',
      title: 'Big turnout, scattered photos',
      bullets: [
        'You can’t take a photo with everyone',
        'Fan photos vanish into camera rolls',
        'Sponsors want more than a logo mention',
        'Booth hire eats the budget',
      ],
      image: 'booth-guy',
      notes:
        'Ask about their last hangout or launch: turnout, sponsors, what they posted afterwards.',
    },
    {
      id: 'solution',
      video: 'wall',
      kind: 'solution',
      eyebrow: 'Beamwall',
      title: 'Every fan gets a moment',
      body: 'Your AR frame on every fan’s phone, every shot live on the wall, every photo kept.',
      image: 'booth-phone',
      notes:
        'Every fan feels seen on the big screen, even when the creator cannot reach everyone.',
    },
    {
      id: 'demo',
      kind: 'demo',
      eyebrow: 'Try it now',
      title: 'Your fans’ view, in ten seconds',
      body: 'Pick a frame, add a prop, take a photo and beam it to the wall. This is what your fans see.',
      demoKit: 'party',
      notes:
        'Let them try it: tap Start the camera here, or scan the QR on their own phone. Nothing is uploaded; photos stay on their device. It is a sample kit: their event gets their own look and name on every frame.',
    },
    {
      id: 'features',
      kind: 'features',
      eyebrow: 'Creator toolkit',
      title: 'Built for a content flywheel',
      items: [
        { title: 'Your AR frame', body: 'On-brand, on every fan photo.', icon: 'Frame', showcase: 'frames' },
        { title: 'Fan challenges', body: 'Missions and a leaderboard for the room.', icon: 'Trophy', showcase: 'challenges' },
        { title: 'Sponsor-ready frames', body: 'Put a partner’s brand in every shot.', icon: 'Handshake', showcase: 'frames' },
        { title: 'Keepsake highlight film', body: 'A highlight film of the night.', icon: 'Film', showcase: 'keepsake' },
      ],
      image: 'frames',
      notes:
        'The sponsor frame is the money angle: a deliverable they can sell to a brand partner.',
    },
    {
      id: 'offer',
      kind: 'offer',
      eyebrow: 'Done for you',
      title: 'We build it, you host',
      body: 'Our team designs your frame and wall, then sends the links. Quoted per event, invoiced.',
      offerIds: ['ng-signature-300', 'ng-signature-700'],
      notes:
        'Creators in Nigeria buy Signature, invoiced — never push the USD self-serve checkout. Take date and expected turnout, then quote.',
    },
    {
      id: 'roi',
      kind: 'roi',
      eyebrow: 'Illustrative maths',
      title: 'One sponsor can cover the night',
      body: 'Example only. A sponsor frame on every fan photo is a deliverable you can sell.',
      bullets: [
        'Assumption: one sponsor frame on every photo',
        'Assumption: 200 fans, most post a shot',
        'Break-even: sponsor fee above your Beamwall quote',
      ],
      notes:
        'Illustrative — never name a sponsor rate. Ask what they charge for an integration, then compare it to the quote.',
    },
    {
      id: 'cta',
      kind: 'cta',
      eyebrow: 'Let’s build it',
      title: 'Plan your next fan night',
      body: 'Send the date and expected turnout. We’ll design your first frame with you, live.',
      image: 'beamy-wave',
      notes:
        'The ask: a 15-minute screen-share to design their frame, then a quote on WhatsApp.',
    },
  ],
};

export const DECKS: Deck[] = [
  NG_PLANNERS_DECK,
  NG_BRANDS_DECK,
  NG_CREATORS_DECK,
  NA_PLANNERS_DECK,
  NA_BRANDS_DECK,
  NA_CREATORS_DECK,
];

export function getDeck(slug: string): Deck | undefined {
  return DECKS.find((d) => d.slug === slug);
}

/** The ONE gate between the hub and the prospect-facing /pitch pages: a deep
 *  copy with every speaker note removed and the internal audience blanked.
 *  Never mutates its input. */
export function publicDeck(deck: Deck): Deck {
  return {
    id: deck.id,
    market: deck.market,
    slug: deck.slug,
    name: deck.name,
    audience: '',
    oneLiner: deck.oneLiner,
    rgb: deck.rgb,
    slides: deck.slides.map((s) => {
      const { notes: _notes, ...rest } = s;
      void _notes;
      return {
        ...rest,
        ...(s.bullets ? { bullets: [...s.bullets] } : {}),
        ...(s.items ? { items: s.items.map((i) => ({ ...i })) } : {}),
        ...(s.stats ? { stats: s.stats.map((st) => ({ ...st })) } : {}),
        ...(s.offerIds ? { offerIds: [...s.offerIds] } : {}),
      };
    }),
  };
}

/** What a prospect sees as an offer's price: an unconfirmed (placeholder)
 *  price is never shown — its fallback copy is. */
export function publicOfferPrice(offer: Offer): string {
  return offer.placeholder ? offer.fallbackPrice : offer.price;
}


// ── Cheat sheet (hub only) ─────────────────────────────────────────────────

export const CHEAT_SHEET: CheatSheetSection[] = [
  {
    id: 'positioning',
    title: 'Positioning in one sentence',
    points: [
      'Beamwall turns every guest’s phone into an AR photo booth and beams every shot live onto the event’s big screen — no hardware, no app.',
      'Nigeria line: “More than a 360 booth, for less than a 360 booth.”',
    ],
  },
  {
    id: 'elevator',
    title: 'The 30-second pitch',
    points: [
      'You know how a booth serves one guest at a time? We put the booth in every guest’s pocket.',
      'Guests scan one QR code, take branded AR photos and videos in their browser, and watch them land on a live wall in real time.',
      'Hosts get AI-designed frames in minutes, photo challenges with a leaderboard, moderation, a gallery link, and keepsake cards or a highlight film afterwards.',
      'North America: starts free, $49–$169 per event self-serve, or Signature from $495 and we build it for you. Nigeria: Signature from ₦200,000, invoiced.',
    ],
  },
  {
    id: 'hooks',
    title: 'Hooks by customer type',
    points: [
      'Planners: a wow moment at every event, nothing to hire or transport, and a service you can add to every package.',
      'Planners: five Signature events for the price of four — or the Partner licence to build and run Beamwall for clients at your own price.',
      'Brands: your logo on every guest photo, a live wall that pulls the crowd, challenges that keep people engaged.',
      'Creators: fans make the content, every fan gets a moment on the big screen, and a sponsor frame you can sell.',
      'Nigeria: think big weddings in aso-ebi, festive-season parties and launches — the whole hall on the wall, not a queue at one machine.',
    ],
  },
  {
    id: 'different',
    title: 'What makes us different',
    points: [
      'No hardware: nothing to hire, transport, power or staff.',
      'Guests use their own phones in the browser — no app download, no queue.',
      'Live wall + keepsakes: shots beam onto the big screen, then become cards or a highlight film.',
      'AI-designed frames in minutes; a full build takes under 20 minutes, so every event looks custom.',
    ],
  },
  {
    id: 'markets',
    title: 'Market rules (hub only)',
    points: [
      'Nigeria is the primary market; North America second. Use the matching deck: /pitch/ng-* for Nigeria, /pitch/* for North America.',
      'Nigeria: no self-serve checkout. Never send the USD price list or /signup as a way to pay — clients are invoiced via PayPal or bank transfer.',
      'Nigeria: naira quotes are valid for 14 days and invoiced in USD at about ₦1,340 per $1. Never put the rate in prospect copy.',
      'Both markets: paid in full to book, fully refundable until the designs are approved. No deposit.',
      'Both markets: five Signature events for the price of four.',
      'No scarcity or “limited slots” language — there is no capacity cap.',
      'Prices (approved by Dapo as the starting point, shown to prospects): NA Signature $495 / $795 / from $1,495, Partner $499/mo or $4,990/yr; NG Signature ₦200,000 / ₦350,000 / from ₦600,000, Partner ₦670,000/mo.',
    ],
  },
  {
    id: 'delivery-rules',
    title: 'Delivery rules',
    points: [
      'Dapo reviews James’s first three events before anything goes to the client.',
      'Every bespoke asset goes into the shared library unless the client paid for exclusivity.',
      'Follow DELIVERY_SOP for every Signature event: all remote, about 2.5h hands-on in North America, ~1h in Nigeria, and nothing from us on the day.',
    ],
  },
  {
    id: 'guarantees',
    title: 'Guarantees — PENDING Dapo’s confirmation (do not promise yet)',
    points: [
      'Design guarantee: full refund if you’re not happy with the designs before you approve them.',
      'Rehearsal guarantee: a rehearsal link 7 days before the event, or 20% off.',
      'Uptime guarantee: full refund if our platform stops photo capture for more than 15 minutes during the event.',
      'Until confirmed, these stay off every slide, proposal and message.',
    ],
  },
  {
    id: 'qualify',
    title: 'Qualify — and when to walk away',
    points: [
      'Good fit: real events with 50+ guests, a screen or projector, and a host who wants guests engaged and content afterwards.',
      'Good fit: planners with 10+ events a year — Partner or the 5-for-4 Signature pack pays there.',
      'Walk away: needs printed photos on the spot (we do not print).',
      'Walk away: venue bans phones, or no screen and no mobile signal at all.',
      'Walk away: needs lead-capture forms, CRM sync or a white-label domain today.',
      'Park it: event is days away and they want custom Signature work with no time to approve designs.',
    ],
  },
  {
    id: 'demo',
    title: 'Demo flow (10 minutes)',
    points: [
      '1. Open the deck’s live booth slide on a shared screen (or the /try link full screen).',
      '2. Have them scan the code and beam their own phone onto the wall.',
      '3. Show the AI frame studio: describe their theme, watch frames appear.',
      '4. Show challenges + leaderboard, then a keepsake card.',
      '5. Ask: “Which of your upcoming events would this fit?” — then book it.',
    ],
  },
  {
    id: 'closing',
    title: 'Closing moves',
    points: [
      'Always close for a dated next step: a pilot event, a quote, or a design call.',
      'Pilot close: “Let’s pick one event and make it the one everyone posts about.”',
      'Founding-partner close: “Launch with us and help shape what we build next.” (True — we are early. No “limited spots”.)',
      'NA self-serve close: create their free event with them on the call.',
      'NG close: get date + guest count + venue, send the quote on WhatsApp the same day.',
      'Quote the list price; any discount or custom scope goes to Dapo before it is sent.',
    ],
  },
  {
    id: 'follow-up',
    title: 'Follow-up cadence rules',
    points: [
      'Day 0 opener → day 3 follow-up → day 7 value follow-up → day 14 breakup. Then stop.',
      'Max three follow-ups: unsubscribes climb after the third (Hunter, 2025).',
      'Every follow-up adds something new: a frame mock-up, the deck link, a relevant demo.',
      'After a call, send the after-call note the same day with the agreed next step.',
      'Log every touch and reply in the CRM the same day.',
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance — do and don’t',
    points: [
      'Nigeria (NDPA 2023): applies to anyone processing data of people in Nigeria. Legitimate interest is a lawful basis, but the NDPC’s 2025 GAID reportedly requires consent for direct marketing — so start conversations by DM and reply, not bulk email.',
      'Nigeria: an objection to marketing is absolute — stop the same day.',
      'WhatsApp: Meta requires opt-in before a business messages someone. Message only business numbers published for enquiries or people who shared their number; never add people to broadcast lists without consent.',
      'CASL (Canada): cold email only to an address the person or their company published themselves, with no “no solicitations” note, and only about their role.',
      'CASL: never email addresses mined from third-party directories; screenshot where you found each address (URL + date).',
      'CASL: every email names Rethink Reality / Beamwall, a mailing address and a contact, plus a working unsubscribe; honour opt-outs within 10 business days.',
      'CAN-SPAM (US): honest subject line, valid postal address, clear opt-out, honoured within 10 business days.',
      'UK/EU (PECR + GDPR): corporate addresses need no consent but need identification + opt-out; sole traders need consent; keep a legitimate-interest note.',
      'Don’t: buy lists, run automation bots on LinkedIn/Instagram/WhatsApp, or attach files to a first touch.',
    ],
  },
  {
    id: 'dont-promise',
    title: 'What NOT to promise',
    points: [
      'No discounts or custom scope beyond the list prices without Dapo.',
      'No guarantees until Dapo confirms them.',
      'No separate reseller margin, resale tier, partner branding, white-label or referral-commission tracking — Partner is a licence to build and run Beamwall for clients at their own price.',
      'No “Event Recap” page — offer the keepsake film and the gallery link instead.',
      'No on-site setup, staffing, event-day support or printing; no lead-capture forms, CRM sync, analytics dashboards or white-label domains.',
      'No offline mode — guests need mobile data or venue Wi-Fi.',
      'No case studies, client logos or testimonials — we do not have them yet.',
      'No discounts, card checkout in Nigeria, or free Signature work without Dapo’s sign-off.',
    ],
  },
];

// ── Objections ─────────────────────────────────────────────────────────────

export const OBJECTIONS: Objection[] = [
  {
    objection: 'We already hire a 360 booth / photo booth.',
    answer:
      'Keep it if clients love it — Beamwall works alongside it. The difference is every guest becomes a booth, so no queue, and every shot lands on the live wall for the whole hall.',
  },
  {
    objection: 'Guests won’t bother scanning a QR code.',
    answer:
      'They already scan codes for menus and payments. The wall does the selling: once the first photos appear on the big screen, everyone wants theirs up there. Put the code on tables and the screen.',
  },
  {
    objection: 'What if someone posts something inappropriate?',
    answer:
      'Moderation is built in: the event can hold every photo for approval before it hits the wall, and the host or day-of staff can remove any post from the studio or the manager console on a phone.',
  },
  {
    objection: 'It’s too expensive.',
    answer:
      'In North America self-serve starts free and a full Premium event is $99; done-for-you Signature starts at $495. In Nigeria, Signature starts at ₦200,000 — and planners get five events for the price of four.',
  },
  {
    objection: 'The venue network is bad.',
    answer:
      'Guests use their own phones, so most are on their own mobile data, not the venue Wi-Fi. The wall just needs any screen with internet. A week before, we send a rehearsal link and a one-page setup guide so the client can test their phone and their screen at the venue.',
  },
  {
    objection: 'Just send me some info.',
    answer:
      'Happy to — what would you want it to answer? The fastest way is two minutes on the live demo, beaming your own phone onto the wall. Can I send the link and grab ten minutes this week?',
  },
  {
    objection: 'Can I pay a deposit and balance later?',
    answer:
      'Booking is paid in full, and it’s fully refundable until you approve the designs — so you carry no risk until you love what we’ve made.',
  },
  {
    objection: 'My clients are older — they won’t manage the tech.',
    answer:
      'There’s no app and no sign-up: point the camera at the code and it opens. Younger guests start it, and the wall pulls everyone else in.',
    icp: 'planners',
  },
  {
    objection: 'What’s in it for me as a planner?',
    answer:
      'Two routes: book Signature for clients with five events for the price of four, or take the Partner licence to build and run Beamwall experiences for your clients and set your own price.',
    icp: 'planners',
  },
  {
    objection: 'Can it be fully white-labelled with our name?',
    answer:
      'Paid events have no Beamwall watermark, and the frames carry your client’s names, colours and logo. Partner branding and full white-label aren’t available today — I’ll log it as a request.',
    icp: 'planners',
  },
  {
    objection: 'We need leads, not photos.',
    answer:
      'Honestly, Beamwall doesn’t capture lead forms today. It drives people to your stand and puts your brand on every photo they share. Pair it with your existing sign-up process.',
    icp: 'brands',
  },
  {
    objection: 'Legal / privacy will block it.',
    answer:
      'Guests choose to take and post their own photos, nothing is installed, and hosts can approve photos before they hit the wall. Photos are kept for a set period. Happy to answer your privacy team directly.',
    icp: 'brands',
  },
  {
    objection: 'My audience is online, not in a room.',
    answer:
      'Start with your next hangout or launch party, even a small one. The photos fans take become content you can repost, so the event feeds your online audience too.',
    icp: 'creators',
  },
];

// ── Discovery ──────────────────────────────────────────────────────────────

export const DISCOVERY_QUESTIONS: DiscoveryQuestion[] = [
  {
    question: 'How many events do you run a year, and what kinds?',
    why: 'Sizes the opportunity. Planners with 10+ events are Partner or 5-for-4 Signature candidates.',
  },
  {
    question: 'What’s your next event, and when is it?',
    why: 'A real date turns interest into a pilot, and leaves time to approve designs.',
  },
  {
    question: 'How do you handle photos or guest entertainment today — 360 booth, photographer, nothing?',
    why: 'Reveals the incumbent and what they already spend.',
  },
  {
    question: 'What do you wish guests did more of at your events?',
    why: 'Their words become your pitch: mingling, posting, staying longer, visiting the stand.',
  },
  {
    question: 'How many guests usually attend, and is there a screen or projector?',
    why: 'Guest count maps to Signature tiers; a screen is required for the live wall.',
  },
  {
    question: 'Who else needs to say yes, and how do you usually pay vendors?',
    why: 'Finds the decision-maker early; in Nigeria confirms PayPal or bank transfer works.',
  },
  {
    question: 'Would you rather build it yourselves or have us build it?',
    why: 'Partner (or NA self-serve) versus Signature in one question.',
  },
  {
    question: 'What would make this a clear win for you after the event?',
    why: 'Defines success (content, client praise, crowd at the stand) so the follow-up can prove it.',
  },
  {
    question: 'For brands and creators: who are your sponsors or partners?',
    why: 'A sponsor frame can pay for the event.',
  },
];

// ── 30-day plan ────────────────────────────────────────────────────────────

export const THIRTY_DAY_PLAN: PlanWeek[] = [
  {
    week: 1,
    theme: 'Learn it, live it',
    goal: 'Run 1 test event yourself, demo in under 10 minutes, build a 100-prospect list, and collect 10 real 360-booth quotes.',
    tasks: [
      { id: 'w1-test-event', title: 'Run a test event end to end', detail: 'Create the event, design an AI frame, scan the QR, post to the wall, try a challenge, moderate a post.' },
      { id: 'w1-demo', title: 'Practise the demo flow 5 times', detail: 'Record yourself once; time it under 10 minutes.' },
      { id: 'w1-list', title: 'Build a 100-prospect list', detail: '70 Nigeria (mostly planners), 30 North America — note where you found each contact.' },
      { id: 'w1-benchmarks', title: 'Collect 10 real 360-booth rental quotes', detail: 'Ask Lagos and Abuja vendors on WhatsApp for their rate card (hours, attendant, branding included?). Send the results to Dapo and log them in the CRM notes. Published rates are approximate (₦200k–₦400k typical).' },
      { id: 'w1-profiles', title: 'Set up LinkedIn, Instagram and WhatsApp Business', detail: 'Clear headline (Director of Partnerships, Beamwall), a post showing the live wall, a WhatsApp Business profile.' },
      { id: 'w1-study', title: 'Learn the cheat sheet, objections and compliance', detail: 'NDPA, WhatsApp opt-in, CASL and CAN-SPAM basics before the first message.' },
      { id: 'w1-sync', title: '30-minute sync with Dapo', detail: 'Confirm guarantees and what can be promised; agree the first events Dapo will review.' },
    ],
  },
  {
    week: 2,
    theme: 'Start the conversations',
    goal: '50 personalised first touches, 5+ replies, 2 discovery calls booked.',
    tasks: [
      { id: 'w2-outreach', title: 'Send ~10 personalised openers a day', detail: 'Mostly Nigerian planners on Instagram. Engage with their posts first.' },
      { id: 'w2-follow', title: 'Work every due follow-up daily', detail: 'Day 3 and day 7 touches from the cadence.' },
      { id: 'w2-content', title: 'Post one demo clip or story', detail: 'Your phone beaming onto the wall works well.' },
      { id: 'w2-log', title: 'Log every touch and objection in the CRM' },
      { id: 'w2-sync', title: '30-minute sync with Dapo', detail: 'Share top objections and which openers got replies.' },
    ],
  },
  {
    week: 3,
    theme: 'Ramp and demo',
    goal: '75 new touches, 8+ replies, 4 calls held, 2 quotes sent, 1 pilot agreed.',
    tasks: [
      { id: 'w3-outreach', title: 'Ramp to ~15 openers a day', detail: 'Keep LinkedIn requests near 6–10 a day — well under the ~100/week limit.' },
      { id: 'w3-demos', title: 'Run live demos on every call', detail: 'Get each prospect to beam their own phone onto the wall.' },
      { id: 'w3-quotes', title: 'Send same-day quotes', detail: 'Date + guest count + venue → quote on WhatsApp, approved by Dapo.' },
      { id: 'w3-referral', title: 'Ask every warm contact for one referral' },
      { id: 'w3-sync', title: '30-minute sync with Dapo', detail: 'Review pipeline and the quotes sent.' },
    ],
  },
  {
    week: 4,
    theme: 'Close the first partner',
    goal: '~100 new touches, 6 calls held, first paid event or partner signed, and a month-2 plan.',
    tasks: [
      { id: 'w4-outreach', title: 'Hold ~20 openers a day', detail: 'Only if quality holds — personalisation beats volume.' },
      { id: 'w4-close', title: 'Close one paid event or founding partner', detail: 'A real date, paid in full, designs in progress.' },
      { id: 'w4-breakups', title: 'Send breakup notes to silent week-1 prospects' },
      { id: 'w4-review', title: 'Write a one-page month-1 review', detail: 'Touches, reply rate by channel, calls, objections heard, what to change.' },
      { id: 'w4-sync', title: '30-minute sync with Dapo', detail: 'Agree month-2 targets and the channel mix that worked.' },
    ],
  },
];

// ── Daily targets & routine ────────────────────────────────────────────────

export const DAILY_TARGETS: DailyTarget[] = [
  {
    id: 'instagram-dms',
    label: 'Personalised Instagram DMs',
    count: 8,
    channel: 'instagram',
    note: 'Nigerian planners and creators are Instagram-first. Engage with a post first; no link in the first DM — links to non-followers get filtered.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp messages to published business lines',
    count: 4,
    channel: 'whatsapp',
    note: 'WhatsApp is the main business channel in Nigeria, but Meta requires opt-in: only business numbers published for enquiries, or people who shared their number.',
  },
  {
    id: 'linkedin-requests',
    label: 'Personalised LinkedIn connection requests',
    count: 6,
    channel: 'linkedin',
    note: 'Brands and agencies. LinkedIn caps invitations at roughly 100 a week; 6 a day keeps the account safe. Personal notes lift replies.',
  },
  {
    id: 'emails',
    label: 'Personalised cold emails',
    count: 2,
    channel: 'email',
    note: 'Mostly North America, only to addresses published for the person’s role (CASL). Small hand-written batches reply better than bulk.',
  },
  {
    id: 'follow-ups',
    label: 'Due follow-ups sent (all of them)',
    count: 10,
    note: 'Follow-ups lift reply rates, but stop after the third. Clear every one that is due before new openers.',
  },
  {
    id: 'conversations',
    label: 'Warm conversations moved forward',
    count: 3,
    note: 'Replies, calls, quotes. A booked call or a sent quote is the metric that matters, not the reply.',
  },
  {
    id: 'engagement',
    label: 'Genuine comments on prospects’ posts',
    count: 5,
    note: 'Warms up tomorrow’s openers and gives you a real personal hook.',
  },
  {
    id: 'content',
    label: 'Piece of content posted',
    count: 1,
    note: 'A demo clip, a story of the live wall, or a short tip. Makes cold profiles look warm.',
  },
];

export const DAILY_ROUTINE: DailyRoutineBlock[] = [
  {
    time: 'Before you start',
    title: 'Set blocks to the prospect’s time zone',
    detail: 'Nigeria runs on WAT; North America on ET/PT. WAT is 5–6 hours ahead of ET. Nigerian mornings for Nigeria, then North American afternoons later in your day.',
  },
  {
    time: 'First 30 min',
    title: 'Inbox and follow-ups',
    detail: 'Answer every reply across WhatsApp, Instagram, LinkedIn and email, then send every follow-up due today. Log them in the CRM.',
  },
  {
    time: 'Next 30 min',
    title: 'Research and engage',
    detail: 'Look up today’s 20 prospects, note one real personal hook each, and leave genuine comments.',
  },
  {
    time: '90 min',
    title: 'New personalised openers',
    detail: '8 Instagram, 4 WhatsApp, 6 LinkedIn, 2 email. Quality first — skip anyone you can’t personalise.',
  },
  {
    time: '60 min',
    title: 'Calls and demos',
    detail: 'Discovery calls and live demos, booked in the prospect’s working hours.',
  },
  {
    time: '30 min',
    title: 'Quotes, after-call notes',
    detail: 'Send same-day after-call notes with the agreed next step; send quotes at list price (custom scope via Dapo).',
  },
  {
    time: 'Last 15 min',
    title: 'Content and CRM tidy',
    detail: 'Post one piece of content, update the pipeline, and plan tomorrow’s list.',
  },
];

// ── Signature delivery SOP (hub only) ──────────────────────────────────────
// Hands-on budget ≈ 2h per event in North America, ≈ 1h in Nigeria (the NG
// consult is an intake form, not a call).

export const DELIVERY_SOP: SopStep[] = [
  {
    id: 'payment',
    when: 'Booking',
    title: 'Payment in full received',
    detail: 'Nothing starts until payment lands (card in NA; PayPal or bank transfer in NG). Fully refundable until designs are approved.',
  },
  {
    id: 'day-0-welcome',
    when: 'Day 0',
    title: 'Welcome and set up',
    minutes: 15,
    detail: 'Send the welcome email with the intake form and consult booking link. Create the event in Beamwall. Log the client in the CRM.',
  },
  {
    id: 'day-1-consult',
    when: 'Day 1–2',
    title: 'Consult and brief',
    minutes: 30,
    detail: '20-minute call on the event, mood, must-have shots and the screen they will open the wall on (Nigeria: the intake form replaces the call). Send a written brief the same day for one-word approval.',
  },
  {
    id: 'day-2-build',
    when: 'Day 2–5',
    title: 'Build',
    minutes: 20,
    detail: 'All remote, on the platform. Start from the closest library experience and frame set; generate new 2D frames, 3D AR assets or filters only where nothing fits. Add a challenge pack, the live photo feed and wall settings, and the keepsake card.',
  },
  {
    id: 'day-5-review',
    when: 'Day 5',
    title: 'First review',
    detail: 'Send a private preview link and a 60-second screen recording. Ask for all feedback in one reply.',
  },
  {
    id: 'day-5-revisions',
    when: 'Day 5–8',
    title: 'Revisions and approval',
    minutes: 30,
    detail: 'Two rounds maximum. Client approval closes the design refund window.',
  },
  {
    id: 'rehearsal',
    when: '7 days before',
    title: 'Rehearsal and handover',
    minutes: 20,
    detail: 'Run the full checklist ourselves on an iPhone AND an Android: camera permission, filter tracking, capture, send, wall arrival, moderation, gallery. Then hand over: the rehearsal link, the Signage Kit and the one-page setup guide (guest QR, wall link for their screen or projector, host console).',
  },
  {
    id: 'freeze',
    when: '72 hours before',
    title: 'Design freeze',
    detail: 'The client runs the setup guide’s test at the venue: wall link on their screen or projector, a test shot from their own phone, Wi-Fi or mobile coverage. Text changes only from here.',
  },
  {
    id: 'event-day',
    when: 'Event day',
    title: 'Nothing from us',
    detail: 'The client runs the day from the links: they open the wall on their screen before doors and guests scan the QR. We do not attend, set up, run or monitor the wall.',
  },
  {
    id: 'after-48h',
    when: 'Within 48 hours',
    title: 'Keepsakes and asks',
    minutes: 30,
    detail: 'Send the keepsake film and gallery link. Ask for a review, a referral and their next date.',
  },
  {
    id: 'retro',
    when: 'Within a week',
    title: 'Retro',
    minutes: 15,
    detail: 'Log hours and issues, and add any new assets to the shared library.',
  },
];

// ── Templates ──────────────────────────────────────────────────────────────

const CASL_FOOTER =
  'Send only to an address they published for their role. Your signature must name Rethink Reality / Beamwall, a mailing address and a contact, plus an unsubscribe line (CASL / CAN-SPAM).';
const NDPA_EMAIL =
  'Nigeria: prefer a DM first; email only an address published for enquiries, include an opt-out line, and stop on any objection (NDPA).';
const WA_RULE =
  'Only to a business number published for enquiries or someone who shared their number (Meta opt-in rule). Stop if they say no.';

export const TEMPLATES: MessageTemplate[] = [
  // Instagram
  {
    id: 'ig-opener-planners-ng',
    title: 'Planner opener — Nigeria (no link)',
    channel: 'instagram',
    stage: 'opener',
    icp: 'planners',
    market: 'ng',
    body:
      'Hi {{firstName}}! {{personalHook}}. Quick one: we built a photo booth that runs on every guest’s phone and beams every shot onto the big screen — more than a 360 booth, for less. Would it fit the {{eventType}} events {{company}} plans?',
    when: 'First DM after liking or commenting on a recent post. No link — wait for a reply.',
  },
  {
    id: 'ig-opener-planners-na',
    title: 'Planner opener — North America (no link)',
    channel: 'instagram',
    stage: 'opener',
    icp: 'planners',
    market: 'na',
    body:
      'Hi {{firstName}} — {{personalHook}}. We built a photo booth that runs on every guest’s phone and beams shots live onto a big screen, no hardware. Would that fit the {{eventType}} events {{company}} runs?',
    when: 'First DM after liking or commenting on a recent post. No link — wait for a reply.',
  },
  {
    id: 'ig-opener-creators',
    title: 'Creator opener (no link)',
    channel: 'instagram',
    stage: 'opener',
    icp: 'creators',
    market: 'any',
    body:
      'Hey {{firstName}}! {{personalHook}}. Ever thought about a fan hangout where every fan’s photo lands on a live wall in your own AR frame? Happy to show you — takes two minutes.',
    when: 'First DM to a creator who hosts or teases in-person events.',
  },
  {
    id: 'ig-opener-brands',
    title: 'Brand opener (no link)',
    channel: 'instagram',
    stage: 'opener',
    icp: 'brands',
    market: 'any',
    body:
      'Hi {{firstName}} — {{personalHook}}. We put a brand’s logo on every guest photo at launches and activations, beamed live onto a screen. Worth a quick look for {{company}}’s next {{eventType}}?',
    when: 'First DM to a brand account that runs pop-ups or activations.',
  },
  {
    id: 'ig-follow-up-any',
    title: 'Follow-up with the deck',
    channel: 'instagram',
    stage: 'follow-up',
    icp: 'any',
    market: 'any',
    body:
      'Thanks {{firstName}}! Here’s a two-minute look: {{deckLink}}\n\nBest bit is the live demo — scan it and your own photo beams onto the wall. Want to try it for your next {{eventType}}?',
    when: 'Only after they reply to the opener. Use the deck for their market (ng-* for Nigeria).',
  },
  {
    id: 'ig-breakup-any',
    title: 'Polite breakup',
    channel: 'instagram',
    stage: 'breakup',
    icp: 'any',
    market: 'any',
    body:
      'Hi {{firstName}}, I won’t keep nudging. If a {{eventType}} ever needs a wow moment, I’m here. Wishing {{company}} a great season! — {{senderName}}',
    when: 'Day 14 with no reply. Then stop.',
  },
  // WhatsApp (Nigeria's main business channel)
  {
    id: 'wa-opener-planners-ng',
    title: 'Planner WhatsApp opener',
    channel: 'whatsapp',
    stage: 'opener',
    icp: 'planners',
    market: 'ng',
    body:
      'Good afternoon {{firstName}}, I’m {{senderName}} from Beamwall. {{personalHook}}. We turn every guest’s phone into a photo booth and beam every shot onto the big screen — more than a 360 booth, for less. Can I send you a 2-minute look?',
    when: `Ask before sending a link. ${WA_RULE}`,
  },
  {
    id: 'wa-opener-brands-ng',
    title: 'Brand WhatsApp opener',
    channel: 'whatsapp',
    stage: 'opener',
    icp: 'brands',
    market: 'ng',
    body:
      'Good morning {{firstName}}, {{senderName}} from Beamwall here. {{personalHook}}. For {{company}}’s next {{eventType}}, we can put your logo on every guest’s photo and beam them live onto your screen. Can I share a short deck?',
    when: `To a brand or agency events line. ${WA_RULE}`,
  },
  {
    id: 'wa-follow-up-deck-ng',
    title: 'WhatsApp deck + demo',
    channel: 'whatsapp',
    stage: 'follow-up',
    icp: 'any',
    market: 'ng',
    body:
      'Thank you {{firstName}}! Here it is: {{deckLink}}\n\nOpen the live demo and your own photo beams onto the wall. If you share your next date and guest count, I’ll send a quote today.',
    when: 'After they say yes to the opener. Use the ng-* deck link.',
  },
  {
    id: 'wa-quote-ng',
    title: 'Quote sent',
    channel: 'whatsapp',
    stage: 'after-call',
    icp: 'any',
    market: 'ng',
    body:
      'Hi {{firstName}}, as promised — your quote for the {{eventType}} is attached. It’s paid in full to book and fully refundable until you approve the designs. Happy to adjust anything. — {{senderName}}',
    when: 'Quote list prices; custom scope via Dapo. Quotes are valid 14 days (say so in the quote, not here).',
  },
  {
    id: 'wa-breakup-ng',
    title: 'WhatsApp breakup',
    channel: 'whatsapp',
    stage: 'breakup',
    icp: 'any',
    market: 'ng',
    body:
      'Hi {{firstName}}, I won’t keep messaging. Whenever a {{eventType}} needs the whole hall on the big screen, just send a message. Wishing {{company}} a great season. — {{senderName}}',
    when: 'Day 14 with no reply. Then stop.',
  },
  {
    id: 'wa-referral-ng',
    title: 'WhatsApp referral ask',
    channel: 'whatsapp',
    stage: 'referral',
    icp: 'any',
    market: 'ng',
    body:
      'Thank you again {{firstName}}! Do you know one planner or brand manager who would enjoy this? A name is enough — I’ll mention you sent me. — {{senderName}}',
    when: 'After a good call or a happy event, even if they did not buy.',
  },
  // LinkedIn
  {
    id: 'li-connect-planners',
    title: 'Planner connection note',
    channel: 'linkedin',
    stage: 'opener',
    icp: 'planners',
    market: 'any',
    body:
      'Hi {{firstName}} — {{personalHook}}. I work with event planners on a phone-based AR photo booth and live wall. Would love to connect.',
    when: 'Connection request note. Pitch nothing more yet.',
  },
  {
    id: 'li-connect-brands',
    title: 'Brand connection note',
    channel: 'linkedin',
    stage: 'opener',
    icp: 'brands',
    market: 'any',
    body:
      'Hi {{firstName}} — {{personalHook}}. I help event and brand teams turn guests’ phones into branded photo booths. Would be glad to connect.',
    when: 'Connection request to marketing or events leads.',
  },
  {
    id: 'li-follow-up-planners',
    title: 'Planner message after connecting',
    channel: 'linkedin',
    stage: 'follow-up',
    icp: 'planners',
    market: 'any',
    body:
      'Thanks for connecting, {{firstName}}. Guests scan one QR, take AR photos on their own phones, and every shot beams onto a big screen — nothing to hire or transport. Two-minute look: {{deckLink}}\n\nWorth a chat about {{company}}’s next {{eventType}}?',
    when: 'Within a day of them accepting. Use the deck for their market.',
  },
  {
    id: 'li-follow-up-brands',
    title: 'Brand message after connecting',
    channel: 'linkedin',
    stage: 'follow-up',
    icp: 'brands',
    market: 'any',
    body:
      'Thanks for connecting, {{firstName}}. For {{company}}’s next {{eventType}}: your logo on every guest photo, beamed live to your screen, no hardware. Quick overview: {{deckLink}}\n\nOpen to a 20-minute look?',
    when: 'Within a day of them accepting. Use the deck for their market.',
  },
  {
    id: 'li-referral-any',
    title: 'Referral ask',
    channel: 'linkedin',
    stage: 'referral',
    icp: 'any',
    market: 'any',
    body:
      'Hi {{firstName}}, thanks again for your time. Do you know one planner or events lead who’d enjoy seeing this? A name is plenty — I’ll mention you sent me. — {{senderName}}',
    when: 'After a good call or event, even if they did not buy.',
  },
  // Email
  {
    id: 'email-opener-planners-na',
    title: 'Planner cold email — North America',
    channel: 'email',
    stage: 'opener',
    icp: 'planners',
    market: 'na',
    subject: 'A photo booth with no hardware',
    body:
      'Hi {{firstName}},\n\n{{personalHook}}.\n\nBeamwall turns every guest’s phone into an AR photo booth, and every shot beams live onto a big screen. Nothing to ship, set up or staff.\n\nPlanners either book us to build it for their clients or take a licence to build and run it for their clients at their own price.\n\nWould a 20-minute look be useful before your next {{eventType}}?\n\n{{senderName}}\nBeamwall',
    when: CASL_FOOTER,
  },
  {
    id: 'email-opener-brands',
    title: 'Brand cold email',
    channel: 'email',
    stage: 'opener',
    icp: 'brands',
    market: 'any',
    subject: 'Your logo on every guest photo',
    body:
      'Hi {{firstName}},\n\n{{personalHook}}.\n\nAt your next {{eventType}}, guests could scan one QR code, take photos in a {{company}}-branded AR frame on their own phones, and watch them land on a live wall.\n\nNo hardware, live in minutes. Short overview: {{deckLink}}\n\nOpen to a quick call?\n\n{{senderName}}\nBeamwall',
    when: `${CASL_FOOTER} ${NDPA_EMAIL}`,
  },
  {
    id: 'email-follow-up-any',
    title: 'Value follow-up',
    channel: 'email',
    stage: 'follow-up',
    icp: 'any',
    market: 'any',
    subject: 'A quick look for {{company}}',
    body:
      'Hi {{firstName}},\n\nFollowing up with something useful: a two-minute deck with a live demo — scan it and your own photo lands on the wall.\n\n{{deckLink}}\n\nIf your next {{eventType}} could use it, grab a time here: {{bookingLink}}\n\n{{senderName}}',
    when: `Day 3 or day 7. ${CASL_FOOTER} ${NDPA_EMAIL}`,
  },
  {
    id: 'email-breakup-any',
    title: 'Breakup email',
    channel: 'email',
    stage: 'breakup',
    icp: 'any',
    market: 'any',
    subject: 'Closing the loop',
    body:
      'Hi {{firstName}},\n\nI don’t want to clutter your inbox, so this is my last note. If a future {{eventType}} needs a wow moment, just reply and I’ll pick it up.\n\nAll the best to the {{company}} team.\n\n{{senderName}}',
    when: `Day 14 with no reply. Then stop. ${CASL_FOOTER}`,
  },
  {
    id: 'email-after-call-any',
    title: 'After-call recap',
    channel: 'email',
    stage: 'after-call',
    icp: 'any',
    market: 'any',
    subject: 'Recap and next step',
    body:
      'Hi {{firstName}},\n\nThanks for today. As promised, here’s the deck: {{deckLink}}\n\nWhat we agreed: try Beamwall at your {{eventType}}. Next step is a short design call — pick a time here: {{bookingLink}}\n\nAny questions, just reply.\n\n{{senderName}}',
    when: `Same day as the call. Restate only what was agreed. ${CASL_FOOTER}`,
  },
  // SMS
  {
    id: 'sms-after-call-na',
    title: 'Post-call text',
    channel: 'sms',
    stage: 'after-call',
    icp: 'any',
    market: 'na',
    body:
      'Hi {{firstName}}, {{senderName}} from Beamwall — great chatting! Here’s the deck: {{deckLink}}\n\nReply STOP and I won’t text again.',
    when: 'Only if they gave you their number on the call and agreed to a text. In Nigeria use WhatsApp instead.',
  },
  // Call
  {
    id: 'call-opener-any',
    title: 'Phone call opener',
    channel: 'call',
    stage: 'opener',
    icp: 'any',
    market: 'any',
    body:
      'Hi {{firstName}}, it’s {{senderName}} from Beamwall — have I caught you at a bad time? … Thanks. I’ll be quick: {{personalHook}}. We put the photo booth on every guest’s phone and beam the shots live onto a big screen, no hardware. How are you handling photos at your {{eventType}} events today?',
    when: 'Ask permission, give one line, then ask a discovery question and listen.',
  },
  {
    id: 'call-voicemail-any',
    title: 'Voicemail',
    channel: 'call',
    stage: 'follow-up',
    icp: 'any',
    market: 'any',
    body:
      'Hi {{firstName}}, {{senderName}} from Beamwall. We turn guests’ phones into an AR photo booth that beams onto a live wall — thought of {{company}} because {{personalHook}}. I’ll send a short note; no need to call back.',
    when: 'Under 25 seconds. Follow with a message on the channel they use most.',
  },
  {
    id: 'call-after-call-planners',
    title: 'Planner pilot wrap-up (on the call)',
    channel: 'call',
    stage: 'after-call',
    icp: 'planners',
    market: 'any',
    body:
      'So {{firstName}}, to recap: we’ll pick your {{eventType}} as the first one, I’ll send the quote today, and you’ll approve the designs before the day. Does that work? Great — I’ll send the deck and a calendar invite now.',
    when: 'The last two minutes of a good planner call. Confirm the next step out loud.',
  },
];

/** Fill `{{token}}`s. A known token with a non-empty (trimmed) value is
 *  replaced; an unknown or empty token becomes `[token]` so a half-filled
 *  message is obvious before it is sent. Pure. */
export function fillTemplate(
  body: string,
  vars: Partial<Record<TemplateToken, string>>,
): string {
  const known = new Set<string>(TEMPLATE_TOKENS);
  return body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, token: string) => {
    if (!known.has(token)) return `[${token}]`;
    const raw = vars[token as TemplateToken];
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value !== '' ? value : `[${token}]`;
  });
}

// ── Sourcing ───────────────────────────────────────────────────────────────

export const SOURCING: SourcingChannel[] = [
  {
    icp: 'planners',
    market: 'ng',
    where: 'Instagram — Lagos and Abuja wedding & event scene',
    how: 'Search hashtags like #NaijaWedding and #LagosWedding; planners and vendors are tagged on big weddings. Engage with two posts, then DM. Many list a business WhatsApp in their bio.',
  },
  {
    icp: 'planners',
    market: 'ng',
    where: 'BellaNaija Weddings and Nigerian wedding blogs',
    how: 'Featured weddings credit the planner and vendors. Note the planner’s Instagram, engage, then open a conversation.',
  },
  {
    icp: 'planners',
    market: 'ng',
    where: 'Vendor referrals: decorators, photographers, MCs',
    how: 'Vendors who share weddings with planners can introduce you. Ask every vendor contact for one planner name.',
  },
  {
    icp: 'brands',
    market: 'ng',
    where: 'LinkedIn — brand, marketing and events managers',
    how: 'Search consumer brands, banks, telcos and experiential agencies running activations and end-of-year events. Start on LinkedIn, not cold email lists (NDPA).',
  },
  {
    icp: 'brands',
    market: 'ng',
    where: 'Festive-season and concert line-ups',
    how: 'December event line-ups list sponsors; find their brand or events lead on LinkedIn or Instagram.',
  },
  {
    icp: 'creators',
    market: 'ng',
    where: 'Instagram and TikTok creators who host hangouts and launches',
    how: 'Look for 10k–250k accounts announcing hangouts, album or product launches. Pitch the sponsor frame — brand collabs are common.',
  },
  {
    icp: 'planners',
    market: 'na',
    where: 'The Knot and WeddingWire planner listings',
    how: 'Use listings to FIND planners, then contact them via Instagram or the email on their own website. Never copy emails from the directory (CASL).',
  },
  {
    icp: 'planners',
    market: 'na',
    where: 'ILEA and MPI chapters; local hashtags and venue tags',
    how: 'Attend chapter meetups; search local wedding hashtags and venue tags where planners are credited. Engage before you DM.',
  },
  {
    icp: 'brands',
    market: 'na',
    where: 'LinkedIn Sales Navigator',
    how: 'Search Event Marketing Manager, Brand Manager, Field Marketing at 11–500 staff companies; filter by recent posts about events.',
  },
  {
    icp: 'brands',
    market: 'na',
    where: 'Trade-show exhibitor lists and Eventbrite organisers',
    how: 'Exhibitor pages list companies; find the events lead on LinkedIn. Eventbrite organiser pages show who runs launches and meetups.',
  },
  {
    icp: 'creators',
    market: 'na',
    where: 'Instagram/TikTok creators plus Eventbrite, Meetup and Luma',
    how: 'Find 10k–250k creators announcing meetups or pop-ups; organiser profiles often link the creator’s socials.',
  },
];

// ── Research notes ─────────────────────────────────────────────────────────

export const RESEARCH_NOTES: ResearchNote[] = [
  // Nigeria pricing benchmarks
  {
    claim: 'Approximate: 360 photo booth rental in Nigeria runs ₦150,000–₦600,000 per event; most Lagos/Abuja weddings pay ₦200,000–₦400,000 (2026 guide; seen as a search summary via the offers thread).',
    source: 'ElitePlanners.ng (approximate)',
    url: 'https://eliteplanners.ng/blog/360-photo-booth-rental-nigeria-2026',
  },
  {
    claim: 'Approximate: Jiji Lagos 360 booth rental listings from about ₦200,000–₦250,000 (search summary via the offers thread).',
    source: 'Jiji.ng (approximate)',
    url: 'https://jiji.ng/lagos/394-360-photo-booth-rental',
  },
  {
    claim: 'Approximate, older page: G6 Image lists 360 booth rental in Lagos at ₦150,000 (2h), ₦200,000 (4h), ₦350,000 (full day).',
    source: 'G6 Image (approximate)',
    url: 'https://g6image.com/360-photo-booth-for-rent-in-lagos-nigeria/',
  },
  {
    claim: 'Lagos vendor packages: basic from about ₦550,000; a premium package with bridal shower, drone coverage and a 360-degree video booth about ₦1.4 million (a bundle, not a standalone booth price).',
    source: 'The Guardian Nigeria',
    url: 'https://guardian.ng/?p=2902425',
  },
  {
    claim: 'Average Nigerian wedding reported at about ₦13 million (Oct 2025).',
    source: 'The Guardian Nigeria',
    url: 'https://guardian.ng/?p=2705516',
  },
  {
    claim: 'Buying a 360 photo booth machine in Nigeria costs roughly ₦1.05m–₦1.5m on Jiji listings (Ojo) — purchase, not rental.',
    source: 'Jiji.ng',
    url: 'https://jiji.ng/ha/ojo/349-photo-booths',
  },
  {
    claim: 'A Nigerian retailer lists a 100cm 360 photo booth machine at ₦1,430,000 (purchase).',
    source: 'SmartGadgetShop Nigeria',
    url: 'https://smartgadgetshop.com.ng/products/360-photo-booth-machine-100cm',
  },
  {
    claim: 'Lagos photo booth vendors sell by 4-hour and 6-hour packages with hourly extras and do not publish naira prices online — quotes come by WhatsApp.',
    source: 'My Afro Caribbean Wedding (Nyota Photobooth listing)',
    url: 'https://myafrocaribbeanwedding.com/?p=11005',
  },
  {
    claim: 'Lagos Detty December 2025: reported consumer spending of ₦396.54bn, 55% from diaspora visitors (MO Africa report).',
    source: 'BusinessDay',
    url: 'https://businessday.ng/business-economy/article/us-uk-top-lagos-detty-december-arrivals-as-diaspora-spending-hits-n396bn/',
  },
  {
    claim: 'WhatsApp is installed on about 95% of Nigerian smartphones (2026 study).',
    source: 'Brandspur Nigeria',
    url: 'https://brandspurng.com/2026/09/26/whatsapp-installed-on-95-of-nigerian-smartphones-study-finds/',
  },
  {
    claim: 'Meta requires businesses to obtain opt-in before messaging people on WhatsApp; a customer’s first message is not opt-in.',
    source: 'Meta WhatsApp Business Platform docs',
    url: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in',
  },
  // Nigeria compliance
  {
    claim: 'Nigeria Data Protection Act 2023: six lawful bases incl. legitimate interest (s.25), NDPC regulator, applies to processing data of people in Nigeria, right to object to direct marketing; fines up to 2% of revenue.',
    source: 'Future of Privacy Forum',
    url: 'https://fpf.org/?p=234739',
  },
  {
    claim: 'NDPC GAID 2025 Article 18(1)(a) reportedly requires consent for direct marketing (commentary; primary text not verified).',
    source: 'The Nigeria Lawyer',
    url: 'https://thenigerialawyer.com/data-protection-consent-and-direct-marketing-in-nigeria-legal-implications-of-sharing-members-telephone-numbers-with-telecommunications-companies-for-promotional-purposes/',
  },
  // North America pricing
  {
    claim: 'Median photo booth rental about $681 (average ~$867; middle half $452–$1,022) across ~118,000 bookings since Jan 2024. Wedding median $886; corporate median $899.',
    source: 'Check Cherry',
    url: 'https://www.checkcherry.com/articles/235-how-much-does-photo-booth-rental-c',
  },
  {
    claim: 'Bark’s US guide puts average photo booth hire at $250–$550 per event, around $150–$200 per hour.',
    source: 'Bark',
    url: 'https://bark.com/en/us/photo-booth-hire/photo-booth-rental-cost-guide',
  },
  {
    claim: 'Vendors commonly pay wedding planners 10–15% referral commissions (15–20% luxury); transparency with clients is now best practice.',
    source: 'Dojo Business (blog estimate)',
    url: 'https://dojobusiness.com/blogs/news/wedding-planner-vendor-commission',
  },
  {
    claim: 'The Knot 2026 Real Weddings Study (10,474 couples married in 2025): average 117 guests, $34,200 total.',
    source: 'The Knot',
    url: 'https://www.theknot.com/content/what-does-the-average-wedding-cost',
  },
  // Trust
  {
    claim: '83% of online respondents in 60 countries trust recommendations from friends and family; 70% trust branded websites.',
    source: 'Nielsen Global Trust in Advertising 2015',
    url: 'https://www.nielsen.com/insights/2015/global-trust-in-advertising-2015/',
  },
  // Outreach benchmarks
  {
    claim: 'LinkedIn limits invitations to roughly 100 per week on a rolling window; LinkedIn does not publish the exact number.',
    source: 'Hublead',
    url: 'https://www.hublead.io/linkedin-invitation-limit',
  },
  {
    claim: 'Across 13.2M LinkedIn requests (May 2025–Apr 2026): 28.5% accepted, 10.4% of messages replied, 3.0% reply to connection notes.',
    source: 'Expandi',
    url: 'https://expandi.io/industry-benchmarks/industry-benchmarks/',
  },
  {
    claim: 'Personalised connection notes: 8.2% reply rate vs 5.3% without a note.',
    source: 'Belkins LinkedIn outreach study',
    url: 'https://belkins.io/blog/linkedin-outreach-study',
  },
  {
    claim: 'Average cold email campaign reply rate 4.1%; follow-ups lift it to 4.9% vs 3%; campaigns of ≤50 recipients reply at 5.8% vs 2.1% for 1,000+; unsubscribes rise after the third follow-up; 71% of decision-makers ignore irrelevant emails.',
    source: 'Hunter, The State of Cold Email 2025',
    url: 'https://hunter.io/the-state-of-cold-email-2025',
  },
  {
    claim: 'Bulk cold email averaged ~0.45% reply rate across 7.5M sends in 2025.',
    source: 'Belkins',
    url: 'https://belkins.io/blog/cold-email-response-rates',
  },
  {
    claim: 'Directional cold Instagram DM reply rates sit around 5–15% for B2B (not a controlled study).',
    source: 'DM Champ',
    url: 'https://dmchamp.com/resources/cold-dm-reply-rate-audit/',
  },
  {
    claim: 'DMs to non-followers land in Requests; links in first messages are more likely to be filtered — send links after a reply.',
    source: 'Inro',
    url: 'https://www.inro.social/blog/instagram-dm-deliverability',
  },
  // North America / UK compliance
  {
    claim: 'CASL: messages must identify the sender with a mailing address and a phone, email or web contact valid for 60 days; unsubscribes honoured within 10 business days at no cost; conspicuous-publication implied consent needs no opt-out statement and relevance to the person’s role.',
    source: 'Government of Canada (ISED), CASL',
    url: 'https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/node/7',
  },
  {
    claim: 'CRTC (Blackstone, 2016): conspicuous publication is a higher bar than public availability; the sender must prove consent; penalty $50,000 after a $640,000 proposal.',
    source: 'Bennett Jones',
    url: 'https://www.bennettjones.com/insights/blogs/2016/11/crtc-assesses-conspicuous-publication-basis-of-implied-consent-in-casl-enforcement-decision',
  },
  {
    claim: 'Federal Court of Appeal (CompuFinder, 2020): a job title alone is not the person’s role; implied consent does not cover addresses mined from third-party directories.',
    source: 'BLG',
    url: 'https://www.blg.com/en/insights/2020/07/federal-court-of-appeal-rules-casl-constitutionally-valid-and-provides-interpretive-guidance',
  },
  {
    claim: 'CAN-SPAM: honest subject lines, ad disclosure, valid postal address, clear opt-out honoured within 10 business days; penalties up to $53,088 per email.',
    source: 'US Federal Trade Commission',
    url: 'https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business',
  },
  {
    claim: 'UK PECR email rule does not apply to corporate subscribers (sole traders need consent); senders must identify themselves and give a valid opt-out; legitimate interests is the likely UK GDPR basis.',
    source: 'UK Information Commissioner’s Office',
    url: 'https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/',
  },
];

// ── Contact ────────────────────────────────────────────────────────────────

/** Empty strings = not provided yet; the UI falls back. */
export const SALES_CONTACT = {
  name: 'James Asumah',
  title: 'Director of Partnerships',
  email: '',
  bookingUrl: '',
};
