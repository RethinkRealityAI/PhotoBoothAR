/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared contract for the partnerships sales hub (src/pages/sales/**).
 *
 * Two audiences read the same content, and the split matters:
 *  - the HUB (hidden link, internal): James and the owner. Sees speaker notes,
 *    placeholder prices with a badge, scripts, targets.
 *  - the PITCH pages (/pitch/:slug, prospect-facing): a prospect a deck link
 *    was sent to. Must NEVER see speaker notes, internal targets, commission,
 *    or a price that has not been confirmed. `publicDeck()` in salesContent.ts
 *    is the one gate between the two and is unit tested.
 *
 * Pure types + constants only — no React, no supabase import, so every module
 * that builds on this stays importable from a node-env .test.ts.
 */

/** The ideal customer profiles we sell to. Order = priority. */
export type IcpId = 'planners' | 'brands' | 'creators';
export const ICP_IDS: readonly IcpId[] = ['planners', 'brands', 'creators'];

/** Launch markets. Owner (2026-11-17): Nigeria is James's primary focus;
 *  North America is the USD self-serve market. Nigerian clients are larger
 *  partners paid by INVOICE (PayPal / bank), never self-serve checkout, so NG
 *  decks must not push the USD self-serve tiers or "pay by card" flows. */
export type Market = 'na' | 'ng';
export const MARKETS: readonly { id: Market; label: string; currency: 'USD' | 'NGN'; symbol: string }[] = [
  { id: 'ng', label: 'Nigeria', currency: 'NGN', symbol: '₦' },
  { id: 'na', label: 'North America', currency: 'USD', symbol: '$' },
];

/** Hidden hub path. Obscurity only — the collateral behind it is not secret,
 *  and the CRM inside it has its own sign-in + RLS. Not linked anywhere, and
 *  served with X-Robots-Tag: noindex (netlify.toml). Rotate by changing it. */
export const SALES_HUB_PATH = '/hub/p7m2k9qx';
/** The CRM's own full page, under the hub path so the same noindex header and
 *  the same rotation cover it. Sign-in + RLS still decide who sees data. */
export const SALES_CRM_PATH = `${SALES_HUB_PATH}/crm`;
/** Prospect-facing deck route. `/pitch/<deck slug>?ref=<rep code>`. */
export const PITCH_BASE = '/pitch';

export type SlideKind =
  | 'cover'     // big title + one-liner + optional image
  | 'problem'   // the pain, in their words
  | 'solution'  // what Beamwall is, for them
  | 'how'       // 3 steps
  | 'features'  // grid of 3-6 feature tiles
  | 'proof'     // stats / social proof
  | 'offer'     // packages, rendered from salesOffers.ts via offerIds
  | 'roi'       // money maths for them
  | 'quote'     // a single big line
  | 'demo'      // hands-on booth (/try/:kit) embedded in the slide
  | 'looks'     // what a guest can try on: Frames · Props · Paint · Effects (lib/lookTerms)
  | 'cta';      // the ask + contact

/** What a feature tile opens (src/pages/sales/components/Showcase.tsx). */
export type ShowcaseId = 'frames' | 'ai' | 'wall' | '3d' | 'challenges' | 'keepsake' | 'moderation' | 'gallery';

export interface SlideStat {
  value: string;
  label: string;
  /** Where the number comes from. Required on any external statistic so the
   *  deck never carries an invented figure. */
  source?: string;
}

export interface SlideItem {
  title: string;
  body?: string;
  /** lucide-react icon name, e.g. 'Sparkles'. Renderer falls back safely. */
  icon?: string;
  /** Feature tiles only: tapping the tile opens this showcase. */
  showcase?: ShowcaseId;
}

export interface Slide {
  id: string;
  kind: SlideKind;
  eyebrow?: string;
  title: string;
  body?: string;
  /** cover slides: one short line set as a glass pill under the body
   *  (e.g. "Think Snapchat and Instagram…" — the it-is-virtual cue). */
  tagline?: string;
  bullets?: string[];
  items?: SlideItem[];
  stats?: SlideStat[];
  /** Key into SALES_IMAGES (src/pages/sales/salesImages.ts). */
  image?: string;
  /** Key into SALES_VIDEOS (src/pages/sales/salesVideos.ts); wins over image
   *  on solution and quote slides. Print/thumbnails show its poster. */
  video?: string;
  /** demo slides: which /try kit (src/lib/demoKits.ts) to embed. */
  demoKit?: string;
  /** offer slides: which offers (salesOffers.ts ids) to show. */
  offerIds?: string[];
  /** INTERNAL. Talk track for James. Stripped by publicDeck(). */
  notes?: string;
}

export interface Deck {
  /** The ICP. NOT unique on its own — (market, id) is. */
  id: IcpId;
  market: Market;
  /** URL slug under /pitch, unique: NA = 'planners', NG = 'ng-planners'. */
  slug: string;
  /** Hub label, e.g. "Event & wedding planners". */
  name: string;
  /** INTERNAL: who exactly this is for, one sentence. */
  audience: string;
  /** Prospect-facing promise, one line. */
  oneLiner: string;
  /** "r, g, b" accent for this deck, matching the landing palette. */
  rgb: string;
  slides: Slide[];
}

export interface Offer {
  id: string;
  name: string;
  /** e.g. "$99", "From $1,500". */
  price: string;
  unit: string;
  blurb: string;
  features: string[];
  /** true = not confirmed by the offers playbook yet. The hub shows it with a
   *  PLACEHOLDER badge; prospect pages replace the price with `fallbackPrice`. */
  placeholder: boolean;
  /** What a prospect sees instead of a placeholder price. */
  fallbackPrice: string;
  icp: IcpId[];
  market: Market;
}

export type TemplateChannel = 'whatsapp' | 'instagram' | 'linkedin' | 'email' | 'sms' | 'call';
export type TemplateStage = 'opener' | 'follow-up' | 'breakup' | 'after-call' | 'referral';

export interface MessageTemplate {
  id: string;
  title: string;
  channel: TemplateChannel;
  stage: TemplateStage;
  icp: IcpId | 'any';
  market: Market | 'any';
  /** email only */
  subject?: string;
  /** Body with {{tokens}} from TEMPLATE_TOKENS. */
  body: string;
  /** One line on when to use it. */
  when: string;
}

/** Every token a template may use. salesContent.test.ts asserts no template
 *  uses a token outside this list. fillTemplate leaves an unfilled token
 *  visible as [token] so a half-filled message is obvious before it is sent. */
export const TEMPLATE_TOKENS = [
  'firstName', 'company', 'senderName', 'deckLink', 'personalHook', 'eventType', 'bookingLink',
] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

/** Collateral a rep can tick off per prospect in the CRM. `path` is relative
 *  to the site origin; the CRM builds the shareable URL from it. */
export interface CollateralItem {
  id: string;
  label: string;
  path?: string;
  icp?: IcpId;
  market?: Market;
}

export const COLLATERAL: readonly CollateralItem[] = [
  { id: 'deck-ng-planners', label: 'Planner deck (Nigeria)', path: `${PITCH_BASE}/ng-planners`, icp: 'planners', market: 'ng' },
  { id: 'deck-ng-brands', label: 'Brands deck (Nigeria)', path: `${PITCH_BASE}/ng-brands`, icp: 'brands', market: 'ng' },
  { id: 'deck-ng-creators', label: 'Creators deck (Nigeria)', path: `${PITCH_BASE}/ng-creators`, icp: 'creators', market: 'ng' },
  { id: 'deck-planners', label: 'Planner deck (N. America)', path: `${PITCH_BASE}/planners`, icp: 'planners', market: 'na' },
  { id: 'deck-brands', label: 'Brands deck (N. America)', path: `${PITCH_BASE}/brands`, icp: 'brands', market: 'na' },
  { id: 'deck-creators', label: 'Creators deck (N. America)', path: `${PITCH_BASE}/creators`, icp: 'creators', market: 'na' },
  { id: 'live-demo', label: 'Live demo (landing page)', path: '/' },
  { id: 'guides', label: 'Host guides', path: '/guides' },
  { id: 'free-trial', label: 'Free account link', path: '/signup' },
  { id: 'proposal', label: 'Proposal / quote' },
  { id: 'call-booked', label: 'Discovery call' },
];

// ── Hub-only playbook content (never rendered on /pitch) ───────────────────

export interface CheatSheetSection {
  id: string;
  title: string;
  /** Short lines; the hub renders them as a scannable list. */
  points: string[];
}

export interface Objection {
  objection: string;
  /** What to say back, 1-3 sentences, conversational. */
  answer: string;
  icp?: IcpId;
}

export interface DiscoveryQuestion {
  question: string;
  /** Why we ask it / what to listen for. */
  why: string;
}

export interface PlanTask {
  id: string;
  title: string;
  detail?: string;
}

export interface PlanWeek {
  week: number;          // 1-4 (+ optional 5 for the tail of the month)
  theme: string;
  goal: string;          // the measurable outcome for the week
  tasks: PlanTask[];
}

export interface DailyTarget {
  id: string;
  label: string;         // e.g. "New personalised openers"
  count: number;         // per working day
  channel?: TemplateChannel;
  note?: string;
}

export interface DailyRoutineBlock {
  time: string;          // e.g. "9:00–10:00"
  title: string;
  detail: string;
}

/** A sourced fact used to justify the plan or a deck claim. */
export interface ResearchNote {
  claim: string;
  source: string;        // publication / org name
  url: string;
}

/** Prospect sourcing ideas: where to find each ICP. */
export interface SourcingChannel {
  icp: IcpId;
  market: Market;
  where: string;
  how: string;
}

/** One step of the Signature delivery SOP (from the offers playbook). James
 *  sells AND delivers, so the hub carries it next to the decks. */
export interface SopStep {
  id: string;
  when: string;          // e.g. "Day 0"
  title: string;
  minutes?: number;      // hands-on budget
  detail: string;
}
