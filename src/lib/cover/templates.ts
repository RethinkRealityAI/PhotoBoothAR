/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Magazine cover Frames: the template registry. One cover design per major
 * event type. PURE data (no React, no DOM), so it is unit-tested in node.
 *
 * A guest stands inside the cover. The selfie Frame is a 2D overlay with a
 * clear centre (render2d.ts); in AR mode the same cover stands up in the room
 * as a thick frame with a hanging 3D masthead, floating cover lines and 3D
 * garnishes (components/booth/CoverStage3D.tsx).
 *
 * Every masthead is our own invented title, never a real magazine's name or
 * logo styling, and the host can retitle it. Copy uses tokens filled per event
 * and per guest (spec.ts `fillCoverText`):
 *   {honorees}            "Ada & Tunde" (the host's up-to-3 names)
 *   {honoreesPossessive}  "Ada & Tunde's"
 *   {event}               the event name
 *   {date}                "June 14, 2027"
 *   {year}                "2027"
 * A line whose tokens come out empty uses its `alt` instead (or is dropped).
 */

export type CoverFontId = 'playfair' | 'abril' | 'anton' | 'cinzel' | 'creepster' | 'limelight' | 'fredoka';

export type CoverTemplateId =
  | 'wedding'
  | 'anniversary'
  | 'birthday'
  | 'retirement'
  | 'corporate'
  | 'launch'
  | 'christmas'
  | 'halloween'
  | 'graduation'
  | 'babyshower'
  | 'newyear'
  | 'gala';

/** The 3D garnish models (public/models/garnish/<id>.glb + .webp sprite). */
export type GarnishId =
  | 'rose-spray-white'
  | 'peony-blush'
  | 'balloons-gold'
  | 'balloons-party'
  | 'star-gold'
  | 'champagne'
  | 'gift-box'
  | 'pumpkin'
  | 'bat'
  | 'baubles'
  | 'trophy'
  | 'grad-cap'
  | 'disco-ball'
  | 'teddy'
  | 'rocket';

export const GARNISH_IDS: readonly GarnishId[] = [
  'rose-spray-white', 'peony-blush', 'balloons-gold', 'balloons-party', 'star-gold', 'champagne', 'gift-box',
  'pumpkin', 'bat', 'baubles', 'trophy', 'grad-cap', 'disco-ball', 'teddy', 'rocket',
];

/** What each garnish model is, for alt text and the host editor. */
export const GARNISH_LABEL: Record<GarnishId, string> = {
  'rose-spray-white': 'White roses',
  'peony-blush': 'Blush peonies',
  'balloons-gold': 'Gold balloons',
  'balloons-party': 'Party balloons',
  'star-gold': 'Gold star',
  champagne: 'Champagne',
  'gift-box': 'Gift box',
  pumpkin: 'Jack-o’-lantern',
  bat: 'Bat',
  baubles: 'Baubles',
  trophy: 'Trophy',
  'grad-cap': 'Graduation cap',
  'disco-ball': 'Disco ball',
  teddy: 'Teddy bear',
  rocket: 'Rocket',
};

/** A cover line: small kicker, big head, optional deck. */
export interface CoverLine {
  kicker?: string;
  head: string;
  deck?: string;
  /** Used instead when `head`/`deck` need a token this event has not got. */
  alt?: { kicker?: string; head: string; deck?: string };
}

/**
 * A garnish in AR, in metres from the frame's bottom-centre (x right, y up,
 * z towards the guest taking the photo). `size` is the model's longest side.
 */
export interface Garnish3D {
  id: GarnishId;
  x: number;
  y: number;
  z: number;
  size: number;
  /** Turn, degrees (x, y, z). */
  rot?: [number, number, number];
  /** Floats gently (balloons, stars) rather than resting. */
  float?: boolean;
}

/** A garnish sprite on the 2D cover, in canvas fractions (0..1, from top-left). */
export interface Garnish2D {
  id: GarnishId;
  /** Centre. */
  x: number;
  y: number;
  /** Width as a fraction of the canvas width. */
  w: number;
  rot?: number;
}

/** The AR frame's finish. */
export type CoverFrameFinish = 'white' | 'gold' | 'black' | 'blush' | 'navy' | 'red' | 'pastel';

export interface CoverTemplate {
  id: CoverTemplateId;
  /** Host-facing name of the occasion ("Wedding"). */
  label: string;
  /** What the host's names field is called ("The couple"). */
  honoreesLabel: string;
  /** Placeholder for the first name ("Ada & Tunde" is two names). */
  honoreesHint: string;
  masthead: {
    /** Default title; the host can change it. Never a real magazine's name. */
    text: string;
    font: CoverFontId;
    /** 0..1 letter spacing as a fraction of the font size. */
    tracking: number;
  };
  /** Colours (hex): ink = main type, accent = kickers and rules, glow = the
   *  soft halo that keeps type readable over any photo. */
  ink: string;
  accent: string;
  glow: string;
  /** The type that sets the cover lines. */
  lineFont: CoverFontId;
  /** The issue strap under the masthead ("THE WEDDING ISSUE"). */
  issue: string;
  /** The cover-star block: the GUESTS' names, big. */
  star: { kicker: string; fallback: string; deck: string; alt: string };
  left: CoverLine[];
  right: CoverLine[];
  /** Bottom banner: BIG small BIG ("WEDDING of the YEAR"). */
  banner: [string, string, string];
  frame: CoverFrameFinish;
  garnish3d: Garnish3D[];
  garnish2d: Garnish2D[];
  /** Show the barcode block (bottom-left) on the 2D cover. */
  barcode: boolean;
}

/* ── AR geometry the placements are authored against (metres) ─────────── */
/** Outer size of the standing frame. Wide and tall enough for 2-3 people. */
export const COVER_W = 1.7;
export const COVER_H = 2.4;
/** Width of the frame's bars, and its depth front to back. */
export const COVER_BAR = 0.1;
export const COVER_DEPTH = 0.08;

const L = -COVER_W / 2;
const R = COVER_W / 2;
const T = COVER_H;

export const COVER_TEMPLATES: readonly CoverTemplate[] = [
  {
    id: 'wedding',
    label: 'Wedding',
    honoreesLabel: 'The couple',
    honoreesHint: 'e.g. Ada',
    masthead: { text: 'AMOUR', font: 'playfair', tracking: 0.04 },
    ink: '#141414', accent: '#a8843a', glow: 'rgba(255,255,255,0.85)',
    lineFont: 'playfair',
    issue: 'The Wedding Issue',
    star: { kicker: 'Cover stars', fallback: 'The Guest List', deck: 'Guests of {honoreesPossessive} wedding', alt: 'Guests of {event}' },
    left: [
      { kicker: 'Exclusive', head: 'Inside the big day', deck: 'Every vow, every dance, every happy tear' },
      { kicker: 'Beauty countdown', head: 'Time to get aisle ready' },
    ],
    right: [
      { kicker: 'Top 10', head: 'Best dressed guests', deck: 'Who wore it best tonight' },
    ],
    banner: ['Wedding', 'of the', 'Year'],
    frame: 'white',
    garnish3d: [
      { id: 'rose-spray-white', x: L + 0.12, y: 0.22, z: 0.12, size: 0.62, rot: [0, 20, -12] },
      { id: 'peony-blush', x: R - 0.1, y: 0.2, z: 0.12, size: 0.5, rot: [0, -25, 10] },
      { id: 'rose-spray-white', x: R - 0.06, y: T - 0.08, z: 0.1, size: 0.5, rot: [0, -15, 160] },
    ],
    garnish2d: [
      { id: 'rose-spray-white', x: 0.08, y: 0.91, w: 0.3, rot: -8 },
      { id: 'peony-blush', x: 0.93, y: 0.9, w: 0.24, rot: 6 },
    ],
    barcode: false,
  },
  {
    id: 'anniversary',
    label: 'Anniversary',
    honoreesLabel: 'The couple',
    honoreesHint: 'e.g. Grace',
    masthead: { text: 'FOREVER', font: 'abril', tracking: 0.02 },
    ink: '#5a1630', accent: '#c58b5c', glow: 'rgba(255,245,240,0.85)',
    lineFont: 'playfair',
    issue: 'The Anniversary Issue',
    star: { kicker: 'Cover stars', fallback: 'The Inner Circle', deck: 'Celebrating {honorees}', alt: 'Celebrating with {event}' },
    left: [
      { kicker: 'Cover story', head: 'Still the one', deck: 'The love story of {honorees} continues', alt: { kicker: 'Cover story', head: 'Still the one', deck: 'A love story worth retelling' } },
      { kicker: 'Then & now', head: 'The photos you need to see' },
    ],
    right: [
      { kicker: 'Revealed', head: 'Secrets of a lasting love' },
    ],
    banner: ['Love', 'of a', 'Lifetime'],
    frame: 'blush',
    garnish3d: [
      { id: 'peony-blush', x: L + 0.1, y: 0.22, z: 0.12, size: 0.6, rot: [0, 20, -8] },
      { id: 'champagne', x: R - 0.12, y: 0.24, z: 0.16, size: 0.48, rot: [0, -20, 0] },
      { id: 'rose-spray-white', x: L + 0.06, y: T - 0.1, z: 0.1, size: 0.48, rot: [0, 15, -160] },
    ],
    garnish2d: [
      { id: 'peony-blush', x: 0.09, y: 0.91, w: 0.3, rot: -6 },
      { id: 'champagne', x: 0.9, y: 0.88, w: 0.2 },
    ],
    barcode: false,
  },
  {
    id: 'birthday',
    label: 'Birthday',
    honoreesLabel: 'Birthday star',
    honoreesHint: 'e.g. Zara',
    masthead: { text: 'LEGEND', font: 'abril', tracking: 0.03 },
    ink: '#ff3e8a', accent: '#ffcf3e', glow: 'rgba(20,10,40,0.6)',
    lineFont: 'anton',
    issue: 'The Birthday Issue',
    star: { kicker: 'Party people', fallback: 'The VIPs', deck: 'Celebrating {honorees}', alt: 'Live from {event}' },
    left: [
      { kicker: 'Exclusive', head: '{honoreesPossessive} big night', alt: { kicker: 'Exclusive', head: 'Another lap around the sun' } },
      { kicker: 'Make a wish', head: 'Cake, ranked' },
    ],
    right: [
      { kicker: 'Caught on camera', head: 'Who danced hardest' },
    ],
    banner: ['Party', 'of the', 'Year'],
    frame: 'black',
    garnish3d: [
      { id: 'balloons-party', x: L - 0.05, y: T - 0.15, z: 0.08, size: 0.85, rot: [0, 15, 8], float: true },
      { id: 'balloons-party', x: R + 0.05, y: T - 0.35, z: 0.06, size: 0.7, rot: [0, -40, -6], float: true },
      { id: 'gift-box', x: L + 0.18, y: 0.18, z: 0.18, size: 0.34, rot: [0, 25, 0] },
      { id: 'star-gold', x: R - 0.12, y: 0.32, z: 0.16, size: 0.3, rot: [0, -20, 12], float: true },
    ],
    garnish2d: [
      { id: 'balloons-party', x: 0.11, y: 0.56, w: 0.22, rot: -6 },
      { id: 'gift-box', x: 0.11, y: 0.92, w: 0.2 },
      { id: 'star-gold', x: 0.89, y: 0.47, w: 0.12, rot: 12 },
    ],
    barcode: false,
  },
  {
    id: 'retirement',
    label: 'Retirement',
    honoreesLabel: 'Guest of honour',
    honoreesHint: 'e.g. Margaret',
    masthead: { text: 'ENCORE', font: 'cinzel', tracking: 0.08 },
    ink: '#1d2a44', accent: '#b8913f', glow: 'rgba(255,255,255,0.85)',
    lineFont: 'playfair',
    issue: 'The Retirement Issue',
    star: { kicker: 'Well wishers', fallback: 'The Send-Off Crew', deck: 'Celebrating {honorees}', alt: 'Live from {event}' },
    left: [
      { kicker: 'The next chapter', head: 'Here’s to {honorees}', alt: { kicker: 'The next chapter', head: 'Out of office. Forever.' } },
      { kicker: 'Special report', head: 'A career to remember' },
    ],
    right: [
      { kicker: 'Revealed', head: 'Plans for every Monday from now on' },
    ],
    banner: ['Career', 'of a', 'Lifetime'],
    frame: 'navy',
    garnish3d: [
      { id: 'balloons-gold', x: L - 0.04, y: T - 0.2, z: 0.08, size: 0.8, rot: [0, 10, 6], float: true },
      { id: 'champagne', x: R - 0.12, y: 0.24, z: 0.16, size: 0.48, rot: [0, -20, 0] },
      { id: 'trophy', x: L + 0.16, y: 0.22, z: 0.16, size: 0.4, rot: [0, 20, 0] },
    ],
    garnish2d: [
      { id: 'balloons-gold', x: 0.1, y: 0.56, w: 0.2, rot: -5 },
      { id: 'champagne', x: 0.9, y: 0.88, w: 0.2 },
    ],
    barcode: true,
  },
  {
    id: 'corporate',
    label: 'Corporate',
    honoreesLabel: 'Company or team',
    honoreesHint: 'e.g. Northwind',
    masthead: { text: 'MOMENTUM', font: 'anton', tracking: 0.02 },
    ink: '#ffffff', accent: '#4f8bff', glow: 'rgba(6,12,30,0.7)',
    lineFont: 'anton',
    issue: 'The Leaders Issue',
    star: { kicker: 'Power list', fallback: 'Ones to Watch', deck: 'At {event}', alt: 'At {event}' },
    left: [
      { kicker: 'Inside story', head: '{honorees}: the year ahead', alt: { kicker: 'Inside story', head: 'The year ahead' } },
      { kicker: 'Big ideas', head: 'Power moves that pay off' },
    ],
    right: [
      { kicker: 'Awards', head: 'Team of the year' },
    ],
    banner: ['Team', 'of the', 'Year'],
    frame: 'black',
    garnish3d: [
      { id: 'trophy', x: R - 0.14, y: 0.24, z: 0.16, size: 0.45, rot: [0, -20, 0] },
      { id: 'star-gold', x: L + 0.05, y: T - 0.12, z: 0.1, size: 0.34, rot: [0, 15, -10], float: true },
      { id: 'star-gold', x: L + 0.24, y: T + 0.02, z: 0.06, size: 0.2, rot: [0, -10, 18], float: true },
    ],
    garnish2d: [
      { id: 'trophy', x: 0.9, y: 0.87, w: 0.18 },
    ],
    barcode: true,
  },
  {
    id: 'launch',
    label: 'Product launch',
    honoreesLabel: 'Product or brand',
    honoreesHint: 'e.g. Aurora X',
    masthead: { text: 'UNVEILED', font: 'anton', tracking: 0.03 },
    ink: '#ffffff', accent: '#ff7a3d', glow: 'rgba(10,8,20,0.7)',
    lineFont: 'anton',
    issue: 'The Launch Issue',
    star: { kicker: 'First to see it', fallback: 'Early Adopters', deck: 'At the {honorees} launch', alt: 'At {event}' },
    left: [
      { kicker: 'First look', head: '{honorees} is here', alt: { kicker: 'First look', head: 'It’s finally here' } },
      { kicker: 'Hype check', head: 'Why everyone is talking' },
    ],
    right: [
      { kicker: 'Behind the scenes', head: 'Meet the makers' },
    ],
    banner: ['Launch', 'of the', 'Year'],
    frame: 'black',
    garnish3d: [
      { id: 'rocket', x: R + 0.02, y: T - 0.25, z: 0.12, size: 0.6, rot: [0, -20, -18], float: true },
      { id: 'star-gold', x: L + 0.06, y: T - 0.1, z: 0.1, size: 0.3, rot: [0, 15, -10], float: true },
      { id: 'star-gold', x: L + 0.14, y: 0.26, z: 0.16, size: 0.26, rot: [0, 25, 14], float: true },
    ],
    garnish2d: [
      { id: 'rocket', x: 0.9, y: 0.47, w: 0.12, rot: 16 },
      { id: 'star-gold', x: 0.1, y: 0.88, w: 0.12, rot: -12 },
    ],
    barcode: true,
  },
  {
    id: 'christmas',
    label: 'Christmas',
    honoreesLabel: 'Hosted by',
    honoreesHint: 'e.g. The Okafors',
    masthead: { text: 'JOLLY', font: 'playfair', tracking: 0.06 },
    ink: '#b3122d', accent: '#c9a347', glow: 'rgba(255,250,240,0.85)',
    lineFont: 'playfair',
    issue: 'The Holiday Issue',
    star: { kicker: 'On the nice list', fallback: 'Merry & Bright', deck: 'At {event}', alt: 'At {event}' },
    left: [
      { kicker: 'Official', head: 'Naughty or nice: the list' },
      { kicker: 'Style file', head: 'Best dressed under the mistletoe' },
    ],
    right: [
      { kicker: 'Season’s best', head: 'Merriest moments of the year' },
    ],
    banner: ['Merry', '&', 'Bright'],
    frame: 'red',
    garnish3d: [
      { id: 'baubles', x: L + 0.06, y: T - 0.12, z: 0.1, size: 0.48, rot: [0, 15, -10] },
      { id: 'gift-box', x: R - 0.16, y: 0.18, z: 0.18, size: 0.36, rot: [0, -25, 0] },
      { id: 'baubles', x: L + 0.14, y: 0.24, z: 0.16, size: 0.42, rot: [0, 25, 8] },
      { id: 'star-gold', x: R - 0.02, y: T + 0.04, z: 0.08, size: 0.3, rot: [0, -10, 14], float: true },
    ],
    garnish2d: [
      { id: 'baubles', x: 0.1, y: 0.9, w: 0.24, rot: -6 },
      { id: 'gift-box', x: 0.9, y: 0.91, w: 0.18 },
    ],
    barcode: false,
  },
  {
    id: 'halloween',
    label: 'Halloween',
    honoreesLabel: 'Hosted by',
    honoreesHint: 'e.g. The Grim Crew',
    masthead: { text: 'FRIGHT', font: 'creepster', tracking: 0.04 },
    ink: '#ff7a18', accent: '#b56cff', glow: 'rgba(10,4,20,0.75)',
    lineFont: 'anton',
    issue: 'The Halloween Issue',
    star: { kicker: 'Scream team', fallback: 'Fiendishly Fabulous', deck: 'Haunting {event}', alt: 'Haunting {event}' },
    left: [
      { kicker: 'Spine-chilling', head: 'Costume of the year' },
      { kicker: 'Revealed', head: '13 spooky secrets' },
    ],
    right: [
      { kicker: 'Caught on camera', head: 'Who screamed loudest' },
    ],
    banner: ['Scream', 'of the', 'Year'],
    frame: 'black',
    garnish3d: [
      { id: 'pumpkin', x: L + 0.18, y: 0.2, z: 0.18, size: 0.42, rot: [0, 25, 0] },
      { id: 'pumpkin', x: R - 0.14, y: 0.16, z: 0.2, size: 0.32, rot: [0, -35, 0] },
      { id: 'bat', x: R + 0.05, y: T - 0.1, z: 0.12, size: 0.42, rot: [10, -20, 12], float: true },
      { id: 'bat', x: L + 0.1, y: T + 0.08, z: 0.08, size: 0.3, rot: [10, 25, -14], float: true },
    ],
    garnish2d: [
      { id: 'pumpkin', x: 0.11, y: 0.92, w: 0.22 },
      { id: 'bat', x: 0.88, y: 0.42, w: 0.2, rot: 12 },
    ],
    barcode: false,
  },
  {
    id: 'graduation',
    label: 'Graduation',
    honoreesLabel: 'The graduate',
    honoreesHint: 'e.g. Kemi',
    masthead: { text: 'CLASS ACT', font: 'cinzel', tracking: 0.05 },
    ink: '#121a33', accent: '#c9a347', glow: 'rgba(255,255,255,0.85)',
    lineFont: 'playfair',
    issue: 'The Graduation Issue',
    star: { kicker: 'Proud crew', fallback: 'Class of {year}', deck: 'Celebrating {honorees}', alt: 'Live from {event}' },
    left: [
      { kicker: 'Cover story', head: '{honorees}, class of {year}', alt: { kicker: 'Cover story', head: 'The class of {year}' } },
      { kicker: 'Survey says', head: 'Most likely to change the world' },
    ],
    right: [
      { kicker: 'Honours', head: 'Top of the class' },
    ],
    banner: ['Grad', 'of the', 'Year'],
    frame: 'navy',
    garnish3d: [
      { id: 'grad-cap', x: R - 0.04, y: T - 0.05, z: 0.12, size: 0.46, rot: [15, -25, 14] },
      { id: 'balloons-gold', x: L - 0.05, y: T - 0.25, z: 0.08, size: 0.78, rot: [0, 10, 6], float: true },
      { id: 'star-gold', x: R - 0.12, y: 0.3, z: 0.16, size: 0.28, rot: [0, -20, 12], float: true },
    ],
    garnish2d: [
      { id: 'grad-cap', x: 0.88, y: 0.9, w: 0.22, rot: 10 },
      { id: 'balloons-gold', x: 0.1, y: 0.56, w: 0.2, rot: -6 },
    ],
    barcode: true,
  },
  {
    id: 'babyshower',
    label: 'Baby shower',
    honoreesLabel: 'Parents to be',
    honoreesHint: 'e.g. Tolu',
    masthead: { text: 'BUNDLE', font: 'fredoka', tracking: 0.04 },
    ink: '#4f7fc9', accent: '#f28fb1', glow: 'rgba(255,255,255,0.9)',
    lineFont: 'fredoka',
    issue: 'The Baby Issue',
    star: { kicker: 'Aunties & uncles', fallback: 'The Village', deck: 'Showering {honorees}', alt: 'At {event}' },
    left: [
      { kicker: 'Oh baby!', head: 'Congrats, {honorees}!', alt: { kicker: 'Oh baby!', head: 'Little one on the way' } },
      { kicker: 'Guess who', head: 'Due date predictions' },
    ],
    right: [
      { kicker: 'Nursery goals', head: 'Tiny but mighty style' },
    ],
    banner: ['Baby', 'of the', 'Year'],
    frame: 'pastel',
    garnish3d: [
      { id: 'teddy', x: L + 0.2, y: 0.24, z: 0.18, size: 0.46, rot: [0, 25, 0] },
      { id: 'peony-blush', x: R - 0.1, y: 0.2, z: 0.12, size: 0.5, rot: [0, -25, 10] },
      { id: 'balloons-party', x: R + 0.05, y: T - 0.3, z: 0.06, size: 0.72, rot: [0, -40, -6], float: true },
    ],
    garnish2d: [
      { id: 'teddy', x: 0.11, y: 0.91, w: 0.22 },
      { id: 'peony-blush', x: 0.91, y: 0.9, w: 0.24, rot: 6 },
    ],
    barcode: false,
  },
  {
    id: 'newyear',
    label: 'New Year',
    honoreesLabel: 'Hosted by',
    honoreesHint: 'e.g. The Bello Family',
    masthead: { text: 'MIDNIGHT', font: 'limelight', tracking: 0.03 },
    ink: '#f2d27a', accent: '#ffffff', glow: 'rgba(8,8,16,0.75)',
    lineFont: 'anton',
    issue: 'The Countdown Issue',
    star: { kicker: 'On the guest list', fallback: 'Party People', deck: 'Ringing in the year at {event}', alt: 'At {event}' },
    left: [
      { kicker: 'Official', head: 'Resolutions we’ll actually keep' },
      { kicker: 'Style file', head: 'Sequins, ranked' },
    ],
    right: [
      { kicker: 'At the stroke of 12', head: 'Who got the midnight kiss' },
    ],
    banner: ['Party', 'of the', 'Year'],
    frame: 'gold',
    garnish3d: [
      { id: 'disco-ball', x: R - 0.22, y: T + 0.02, z: 0.12, size: 0.36, float: true },
      { id: 'champagne', x: L + 0.16, y: 0.24, z: 0.16, size: 0.48, rot: [0, 20, 0] },
      { id: 'balloons-gold', x: R + 0.05, y: T - 0.45, z: 0.06, size: 0.72, rot: [0, -30, -6], float: true },
    ],
    garnish2d: [
      { id: 'disco-ball', x: 0.88, y: 0.47, w: 0.14 },
      { id: 'champagne', x: 0.1, y: 0.88, w: 0.2 },
    ],
    barcode: true,
  },
  {
    id: 'gala',
    label: 'Gala',
    honoreesLabel: 'Hosted by',
    honoreesHint: 'e.g. The Hope Foundation',
    masthead: { text: 'SOIRÉE', font: 'playfair', tracking: 0.05 },
    ink: '#f6e7c1', accent: '#d4af37', glow: 'rgba(10,8,6,0.7)',
    lineFont: 'playfair',
    issue: 'The Gala Issue',
    star: { kicker: 'Red carpet', fallback: 'Best in Show', deck: 'At {event}', alt: 'At {event}' },
    left: [
      { kicker: 'Red carpet', head: 'Who wore it best' },
      { kicker: 'Exclusive', head: 'An evening to remember' },
    ],
    right: [
      { kicker: 'Style report', head: 'The night’s most stylish guests' },
    ],
    banner: ['Night', 'of the', 'Year'],
    frame: 'gold',
    garnish3d: [
      { id: 'rose-spray-white', x: L + 0.12, y: 0.22, z: 0.12, size: 0.6, rot: [0, 20, -12] },
      { id: 'champagne', x: R - 0.12, y: 0.24, z: 0.16, size: 0.48, rot: [0, -20, 0] },
      { id: 'star-gold', x: R - 0.02, y: T + 0.02, z: 0.08, size: 0.28, rot: [0, -10, 14], float: true },
    ],
    garnish2d: [
      { id: 'rose-spray-white', x: 0.08, y: 0.91, w: 0.28, rot: -8 },
      { id: 'champagne', x: 0.9, y: 0.88, w: 0.2 },
    ],
    barcode: true,
  },
];

export const COVER_TEMPLATE_MAP: Record<CoverTemplateId, CoverTemplate> = Object.fromEntries(
  COVER_TEMPLATES.map((t) => [t.id, t]),
) as Record<CoverTemplateId, CoverTemplate>;

export const COVER_TEMPLATE_IDS: readonly CoverTemplateId[] = COVER_TEMPLATES.map((t) => t.id);

export function isCoverTemplateId(v: unknown): v is CoverTemplateId {
  return typeof v === 'string' && (COVER_TEMPLATE_IDS as readonly string[]).includes(v);
}

/** The template a new event of this type starts with. */
export function defaultCoverTemplateFor(eventType: string | null | undefined): CoverTemplateId {
  switch (eventType) {
    case 'wedding': return 'wedding';
    case 'birthday': return 'birthday';
    case 'corporate': return 'corporate';
    case 'gala': return 'gala';
    case 'party': return 'birthday';
    default: return 'wedding';
  }
}

/* ── Fonts ────────────────────────────────────────────────────────────── */

/** CSS family + the self-hosted file(s) behind it (public/fonts/cover/). */
export interface CoverFontFace {
  family: string;
  weight: string;
  style: 'normal' | 'italic';
  file: string;
}

/** The faces each font id needs, loaded on demand (render2d.ts). */
export const COVER_FONT_FACES: Record<CoverFontId, CoverFontFace[]> = {
  playfair: [
    { family: 'Cover Playfair', weight: '900', style: 'normal', file: 'playfair-display-latin-900-normal.woff2' },
    { family: 'Cover Playfair', weight: '700', style: 'normal', file: 'playfair-display-latin-700-normal.woff2' },
    { family: 'Cover Playfair', weight: '400', style: 'italic', file: 'playfair-display-latin-400-italic.woff2' },
    { family: 'Cover Playfair', weight: '700', style: 'italic', file: 'playfair-display-latin-700-italic.woff2' },
  ],
  abril: [{ family: 'Cover Abril', weight: '400', style: 'normal', file: 'abril-fatface-latin-400-normal.woff2' }],
  anton: [{ family: 'Cover Anton', weight: '400', style: 'normal', file: 'anton-latin-400-normal.woff2' }],
  cinzel: [
    { family: 'Cover Cinzel', weight: '700', style: 'normal', file: 'cinzel-latin-700-normal.woff2' },
    { family: 'Cover Cinzel', weight: '600', style: 'normal', file: 'cinzel-latin-600-normal.woff2' },
  ],
  creepster: [{ family: 'Cover Creepster', weight: '400', style: 'normal', file: 'creepster-latin-400-normal.woff2' }],
  limelight: [{ family: 'Cover Limelight', weight: '400', style: 'normal', file: 'limelight-latin-400-normal.woff2' }],
  fredoka: [
    { family: 'Cover Fredoka', weight: '700', style: 'normal', file: 'fredoka-latin-700-normal.woff2' },
    { family: 'Cover Fredoka', weight: '500', style: 'normal', file: 'fredoka-latin-500-normal.woff2' },
  ],
};

/** The script face for "of the" in the bottom banner. */
export const COVER_SCRIPT_FACE: CoverFontFace = {
  family: 'Cover Script', weight: '400', style: 'normal', file: 'great-vibes-latin-400-normal.woff2',
};

/** CSS font shorthand for a font id at a size (the heaviest face first). */
export function coverFontCss(id: CoverFontId, px: number, opts: { italic?: boolean; light?: boolean } = {}): string {
  const faces = COVER_FONT_FACES[id];
  const face = opts.italic
    ? faces.find((f) => f.style === 'italic' && (opts.light ? f.weight === '400' : true)) ?? faces[0]
    : opts.light ? faces[faces.length - 1] : faces[0];
  return `${face.style === 'italic' ? 'italic ' : ''}${face.weight} ${Math.round(px)}px "${face.family}", Georgia, serif`;
}

/** The three.js typeface the AR masthead extrudes (public/fonts/cover/typeface/). */
export const COVER_TYPEFACE: Record<CoverFontId, string> = {
  playfair: 'playfair-900',
  abril: 'abril',
  anton: 'anton',
  cinzel: 'cinzel-700',
  creepster: 'creepster',
  limelight: 'limelight',
  fredoka: 'fredoka-700',
};
