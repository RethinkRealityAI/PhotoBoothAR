/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cardDesigns — the illustrated SCENE library for keepsake cards.
 *
 * A design is a whole occasion look: a hand-cut paper "gateway" the recipient
 * taps open (garden gates, deco doors, a balloon wall, a moon-gate cut-out…),
 * the layered scene behind it that the camera glides into, a foreground
 * cut-out that drifts at its own depth, a particle motif and a palette. After
 * the opening, the same scene stays behind the card as a parallax backdrop,
 * so the card reads as one designed object from the first tap to the last
 * message.
 *
 * Three readers share this module:
 *   • the card viewer (SceneOpener + SceneBackdrop) on /c/:publicId,
 *   • the host's design gallery (CardPresentationPicker) and preview,
 *   • the keepsake-film intro (hyperframes/card-scene-intro), which runs the
 *     SAME `sceneFrame` maths bundled by scripts/build-scene-intro.mjs, so a
 *     film intro and the live card open identically.
 *
 * PURE: no React, no DOM, no supabase. Everything is a function of its inputs
 * (no Math.random, no clock), so a frame renderer asking for the same t gets
 * the same picture every time.
 *
 * Art: public/card-designs/<id>/{gate,back,mid}.webp + thumb.webp. Original
 * paper-cut illustrations generated for Beamwall; no third-party artwork.
 */

/* ------------------------------------------------------------------ */
/* The closed set                                                      */
/* ------------------------------------------------------------------ */

export type CardDesignId =
  | 'garden-gate'
  | 'gala-night'
  | 'balloon-bash'
  | 'moon-gate'
  | 'owambe'
  | 'city-lights'
  | 'winter-glow'
  | 'cloud-nine'
  | 'grand-hall'
  | 'island-sunset'
  | 'jungle-party'
  | 'love-notes'
  | 'festival-of-lights'
  | 'crescent-night';

/** Hosts see them in this order (broadest occasions first). */
export const CARD_DESIGN_IDS = [
  'garden-gate',
  'balloon-bash',
  'gala-night',
  'owambe',
  'city-lights',
  'moon-gate',
  'cloud-nine',
  'grand-hall',
  'island-sunset',
  'love-notes',
  'festival-of-lights',
  'crescent-night',
  'jungle-party',
  'winter-glow',
] as const satisfies readonly CardDesignId[];

/** 'none' = no illustrated design: the card uses its reveal + look as before. */
export type CardDesignChoice = CardDesignId | 'none';

/**
 * How the gateway opens.
 *   doors — two halves swing away in 3D, like a pair of doors or shutters.
 *   iris  — a shape is cut out of the gateway (SVG mask) and grows until the
 *           scene behind fills the screen.
 *   slide — two halves glide apart sideways (fabric, clouds, leaves).
 *   rise  — the gateway lifts away in staggered strips (a balloon wall).
 */
export type GatewayKind = 'doors' | 'iris' | 'slide' | 'rise';
export type IrisShape = 'circle' | 'arch' | 'heart';

/** Particles that drift over the scene. Drawn procedurally (no images). */
export type MotifKind = 'petals' | 'sparkle' | 'confetti' | 'lanterns' | 'snow' | 'stars' | 'fireflies';

export interface DesignPalette {
  /** Page colour behind everything (and the backdrop's scrim). */
  bg: string;
  /** Text on the scene. */
  fg: string;
  /** Selected state, rims, buttons. */
  accent: string;
  /** "r, g, b" of accent. */
  accentRgb: string;
  /** The warm light that pours through the gateway as it opens. */
  glow: string;
}

export interface CardDesign {
  id: CardDesignId;
  label: string;
  /** One line a host can decide from. */
  description: string;
  /** Occasions it suits — a hint shown on the tile, never a restriction. */
  goodFor: string;
  gateway: { kind: GatewayKind; shape?: IrisShape };
  /** Where the foreground cut-out sits: a mirrored pair in the bottom or top corners. */
  mid: { placement: 'bottom' | 'top'; /** width as a fraction of the stage */ size: number };
  motif: { kind: MotifKind; colors: readonly string[] };
  palette: DesignPalette;
}

const pal = (bg: string, accent: string, glow: string, fg = '#FFFFFF'): DesignPalette => ({
  bg,
  fg,
  accent,
  accentRgb: hexTriplet(accent),
  glow,
});

export const CARD_DESIGNS: readonly CardDesign[] = [
  {
    id: 'garden-gate',
    label: 'Garden gate',
    description: 'Wisteria-wrapped garden gates open onto a lantern-lit aisle at dusk.',
    goodFor: 'Weddings, anniversaries, engagements',
    gateway: { kind: 'doors' },
    mid: { placement: 'bottom', size: 0.5 },
    motif: { kind: 'petals', colors: ['#FFFFFF', '#F6D6E6', '#D9C8FF'] },
    palette: pal('#3B3A7A', '#E4D8FF', '#FFE6B8'),
  },
  {
    id: 'balloon-bash',
    label: 'Balloon bash',
    description: 'A wall of paper balloons floats up and away to reveal the party.',
    goodFor: 'Birthdays, kids, surprise parties',
    gateway: { kind: 'rise' },
    mid: { placement: 'top', size: 0.42 },
    motif: { kind: 'confetti', colors: ['#FFD36B', '#FF8F7A', '#9AA4FF', '#C9A8FF', '#FFFFFF'] },
    palette: pal('#4B4FA8', '#FFE29A', '#FFF1C9'),
  },
  {
    id: 'gala-night',
    label: 'Gala night',
    description: 'Black and gold deco doors part onto a ballroom under a crystal chandelier.',
    goodFor: 'Galas, awards, company parties',
    gateway: { kind: 'doors' },
    mid: { placement: 'bottom', size: 0.36 },
    motif: { kind: 'sparkle', colors: ['#F3D58C', '#FFFFFF', '#E8C77A'] },
    palette: pal('#111733', '#E8C77A', '#FFD98A'),
  },
  {
    id: 'owambe',
    label: 'Owambe',
    description: 'Indigo adire and gold aso-oke drapes sweep aside onto a hall dressed for the party.',
    goodFor: 'Nigerian weddings, milestone birthdays, family celebrations',
    gateway: { kind: 'slide' },
    mid: { placement: 'bottom', size: 0.44 },
    motif: { kind: 'confetti', colors: ['#F0B54A', '#FF8A6B', '#3FBF9A', '#FFFFFF'] },
    palette: pal('#1E2457', '#F0B54A', '#FFD38A'),
  },
  {
    id: 'city-lights',
    label: 'City lights',
    description: 'Shutters swing open onto a rooftop of string lights over the skyline.',
    goodFor: 'Milestone birthdays, New Year, after-parties',
    gateway: { kind: 'doors' },
    mid: { placement: 'bottom', size: 0.4 },
    motif: { kind: 'fireflies', colors: ['#FFD9A0', '#FFF2CF'] },
    palette: pal('#25265E', '#FFD9A0', '#FFC56B'),
  },
  {
    id: 'moon-gate',
    label: 'Moon gate',
    description: 'A round moon gate opens in a lacquered wall onto a courtyard of lanterns.',
    goodFor: 'Lunar New Year, dinners, elegant evenings',
    gateway: { kind: 'iris', shape: 'circle' },
    mid: { placement: 'top', size: 0.46 },
    motif: { kind: 'lanterns', colors: ['#FF6B4A', '#F2B65A'] },
    palette: pal('#1B1A4A', '#F2B65A', '#FFD08A'),
  },
  {
    id: 'cloud-nine',
    label: 'Cloud nine',
    description: 'Soft paper clouds drift apart onto a pastel sky full of tiny balloons.',
    goodFor: 'Baby showers, christenings, first birthdays',
    gateway: { kind: 'slide' },
    mid: { placement: 'top', size: 0.4 },
    motif: { kind: 'stars', colors: ['#FFFFFF', '#FFE3A8', '#FFD7E6'] },
    palette: pal('#5E5AA0', '#FFD7E6', '#FFF0D6'),
  },
  {
    id: 'grand-hall',
    label: 'Grand hall',
    description: 'Carved oak doors open into a sunlit hall as caps fly overhead.',
    goodFor: 'Graduations, retirements, achievements',
    gateway: { kind: 'doors' },
    mid: { placement: 'bottom', size: 0.42 },
    motif: { kind: 'confetti', colors: ['#E3C27A', '#FFFFFF', '#8FA4E8'] },
    palette: pal('#1C2448', '#E3C27A', '#FFDFA0'),
  },
  {
    id: 'island-sunset',
    label: 'Island sunset',
    description: 'Tropical leaves part onto a coral sun setting over the sea.',
    goodFor: 'Destination weddings, beach parties, honeymoons',
    gateway: { kind: 'slide' },
    mid: { placement: 'bottom', size: 0.46 },
    motif: { kind: 'petals', colors: ['#FF8A7A', '#FFC1A8', '#FFFFFF'] },
    palette: pal('#3A2C5E', '#FFB38A', '#FFD2A6'),
  },
  {
    id: 'love-notes',
    label: 'Love notes',
    description: 'A heart opens in a wall of roses onto a moonlit garden with a bench for two.',
    goodFor: 'Anniversaries, proposals, Valentine’s, vow renewals',
    gateway: { kind: 'iris', shape: 'heart' },
    mid: { placement: 'bottom', size: 0.42 },
    motif: { kind: 'petals', colors: ['#E0566E', '#F08AA0', '#FFE1D6'] },
    palette: pal('#3A1F4A', '#F08AA0', '#FFD9C4'),
  },
  {
    id: 'festival-of-lights',
    label: 'Festival of lights',
    description: 'Carved doors hung with marigolds open onto a lamp-lit courtyard under fireworks.',
    goodFor: 'Diwali, family celebrations, any night lit by lamps',
    gateway: { kind: 'doors' },
    mid: { placement: 'top', size: 0.42 },
    motif: { kind: 'sparkle', colors: ['#FFC93C', '#FFB347', '#FFF4D6'] },
    palette: pal('#2D1458', '#FFB627', '#FFC93C'),
  },
  {
    id: 'crescent-night',
    label: 'Crescent night',
    description: 'An arch opens in a carved lattice onto a courtyard of lanterns under a new moon.',
    goodFor: 'Eid, Ramadan iftars, evening gatherings',
    gateway: { kind: 'iris', shape: 'arch' },
    mid: { placement: 'top', size: 0.34 },
    motif: { kind: 'stars', colors: ['#FFE6A8', '#FFFFFF', '#7FD1C4'] },
    palette: pal('#0E1A3D', '#E8C77A', '#FFC36B'),
  },
  {
    id: 'jungle-party',
    label: 'Jungle party',
    description: 'A wall of jungle leaves slides apart onto a sunny clearing with cake, balloons and a toucan.',
    goodFor: 'Kids’ birthdays, first birthdays, summer parties',
    gateway: { kind: 'slide' },
    mid: { placement: 'bottom', size: 0.44 },
    motif: { kind: 'confetti', colors: ['#FFD23F', '#FF6B6B', '#5ED1C6', '#A98BFF', '#FFFFFF'] },
    palette: pal('#1F5E45', '#FFD23F', '#FFE7A6'),
  },
  {
    id: 'winter-glow',
    label: 'Winter glow',
    description: 'An arch melts open in a frosted window onto a snowy village at night.',
    goodFor: 'Holiday parties, winter weddings, Christmas',
    gateway: { kind: 'iris', shape: 'arch' },
    mid: { placement: 'bottom', size: 0.36 },
    motif: { kind: 'snow', colors: ['#FFFFFF', '#E3EEFF'] },
    palette: pal('#1B2B5A', '#DCEBFF', '#FFE6B8'),
  },
];

export function isCardDesignId(raw: unknown): raw is CardDesignId {
  return typeof raw === 'string' && (CARD_DESIGN_IDS as readonly string[]).includes(raw);
}

/** Any stored/typed value → a design this build has, or 'none'. */
export function normalizeCardDesign(raw: unknown): CardDesignChoice {
  return isCardDesignId(raw) ? raw : 'none';
}

export function cardDesign(id: CardDesignId): CardDesign {
  // CARD_DESIGNS covers every id (asserted in the test), so the fallback is
  // only reachable through a cast.
  return CARD_DESIGNS.find((d) => d.id === id) ?? CARD_DESIGNS[0];
}

/** Public URLs of a design's art. Served same-origin from /public. */
export interface DesignAssets {
  gate: string;
  back: string;
  mid: string;
  thumb: string;
}

export function designAssets(id: CardDesignId, base = '/card-designs'): DesignAssets {
  const dir = `${base}/${id}`;
  return { gate: `${dir}/gate.webp`, back: `${dir}/back.webp`, mid: `${dir}/mid.webp`, thumb: `${dir}/thumb.webp` };
}

/* ------------------------------------------------------------------ */
/* Colour helpers                                                      */
/* ------------------------------------------------------------------ */

function hexTriplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * The CSS custom properties a design paints on the card root, so every card
 * template (which reads the semantic tokens) wears the design's colours.
 */
export function designCssVars(design: CardDesign): Record<string, string> {
  const p = design.palette;
  return {
    '--color-brand-bg': p.bg,
    '--color-brand-fg': p.fg,
    '--color-brand-muted': 'rgba(255,255,255,0.78)',
    '--color-accent': p.accent,
    '--accent-rgb': p.accentRgb,
    '--on-accent': '#1A1740',
    // Brand v2 glass reads these: the card's veil and lit rim take the
    // scene's colours instead of the platform periwinkle.
    '--pf-bg': p.bg,
    '--pf-veil': `rgba(${hexTriplet(p.bg)}, 0.46)`,
    '--pf-veil-strong': `rgba(${hexTriplet(p.bg)}, 0.7)`,
    '--pf-accent': p.accent,
    '--pf-accent-rgb': p.accentRgb,
  };
}

/* ------------------------------------------------------------------ */
/* The opening timeline — one pure function of t                       */
/* ------------------------------------------------------------------ */

/** Length of the opening after the tap, ms. Within the reveal contract's 2.5–6 s. */
export const SCENE_OPEN_MS = 4600;
/** Reduced motion: shorter, no camera push, gentler moves. */
export const SCENE_OPEN_MS_REDUCED = 3000;

/** Everything the opener draws at one instant. Units are noted per field. */
export interface SceneFrame {
  /** doors: rotateY of the left/right half, degrees (left negative). */
  doorDeg: number;
  /** slide: how far each half has travelled outward, % of its own width. */
  slidePct: number;
  /** iris: the cut-out's radius as a fraction of the stage diagonal. */
  irisR: number;
  /** rise: upward travel of the middle strip, % of stage height (outer strips lag). */
  risePct: number;
  /** Extra lag for the outer strips of `rise`, % of stage height. */
  riseLagPct: number;
  /** The gateway as a whole: scale (the camera passing through) and opacity. */
  gateScale: number;
  gateOpacity: number;
  /** The scene behind: scale (camera glide in) and a small upward drift, %. */
  backScale: number;
  backY: number;
  /** The foreground cut-out: scale and vertical drift (moves faster = closer). */
  midScale: number;
  midY: number;
  midOpacity: number;
  /** The light that pours through the opening, 0..1. */
  glow: number;
  /** The title plate that lands at the end. */
  plateOpacity: number;
  /** Plate vertical offset, px. */
  plateY: number;
  plateScale: number;
}

const clamp01 = (n: number) => (n <= 0 ? 0 : n >= 1 ? 1 : n);
/** Map t into a sub-range [a, b] → 0..1. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeIn = (x: number) => x * x * x;
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
/** 3dp, and never -0 (adding +0 turns -0 into 0), so frames compare cleanly. */
const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/**
 * The opener at progress `t` (0 = the closed gateway the recipient tapped,
 * 1 = the scene with the title plate settled). Deterministic and total:
 * non-finite t settles at 1, out-of-range t clamps.
 *
 * Beats (full motion):
 *   0.00–0.55  the gateway opens (eased), light pours through, peaking ~0.3
 *   0.08–0.85  the camera glides in: scene 1.18→1, foreground 1.55→1
 *   0.35–0.70  the gateway passes the camera (scales up, fades out)
 *   0.62–0.92  the title plate lands
 */
export function sceneFrame(kind: GatewayKind, t: number, reducedMotion = false): SceneFrame {
  const x = Number.isFinite(t) ? clamp01(t) : 1;
  const open = easeInOut(seg(x, 0, 0.55));
  const glide = easeOut(seg(x, 0.08, 0.85));
  const pass = easeIn(seg(x, 0.35, 0.7));
  const plate = easeOut(seg(x, 0.62, 0.92));
  const glowUp = seg(x, 0.05, 0.3);
  const glowDown = seg(x, 0.3, 0.75);
  const glow = clamp01(glowUp - glowDown);

  // Reduced motion keeps every beat but shrinks the travel: no camera push
  // through the gateway, no big scales, the gateway simply fades.
  const backFrom = reducedMotion ? 1.04 : 1.18;
  const midFrom = reducedMotion ? 1.08 : 1.55;
  const passScale = reducedMotion ? 1 : 1.35;
  const swing = reducedMotion ? 70 : 108;

  return {
    doorDeg: round3(kind === 'doors' ? open * swing : 0),
    slidePct: round3(kind === 'slide' ? open * 104 : 0),
    irisR: round3(kind === 'iris' ? lerp(0, 0.62, open) : 0),
    risePct: round3(kind === 'rise' ? open * 118 : 0),
    riseLagPct: round3(kind === 'rise' ? (1 - open) * open * 30 : 0),
    gateScale: round3(lerp(1, passScale, pass)),
    gateOpacity: round3(1 - (reducedMotion ? seg(x, 0.3, 0.6) : pass)),
    backScale: round3(lerp(backFrom, 1, glide)),
    backY: round3(lerp(reducedMotion ? 1 : 3, 0, glide)),
    midScale: round3(lerp(midFrom, 1, glide)),
    midY: round3(lerp(reducedMotion ? 4 : 18, 0, glide)),
    midOpacity: round3(easeOut(seg(x, 0.2, 0.6))),
    glow: round3(reducedMotion ? glow * 0.6 : glow),
    plateOpacity: round3(plate),
    plateY: round3((1 - plate) * (reducedMotion ? 6 : 18)),
    plateScale: round3(lerp(reducedMotion ? 0.99 : 0.96, 1, plate)),
  };
}

/* ------------------------------------------------------------------ */
/* Parallax behind the card                                            */
/* ------------------------------------------------------------------ */

export interface ParallaxOffsets {
  /** Scene layer: translate in % of the stage. */
  backX: number;
  backY: number;
  /** Foreground cut-outs: travel further (they are closer). */
  midX: number;
  midY: number;
}

/**
 * Layer offsets for the backdrop behind a reading card. `scroll` is how far
 * the reader is through the card (0..1, from whatever scrolls inside it);
 * `px`/`py` is the pointer (or a slow idle drift) in -1..1. Deeper layers
 * move less — that difference IS the depth. Reduced motion: scroll parallax
 * only, at half travel, and no pointer sway.
 */
export function sceneParallax(scroll: number, px: number, py: number, reducedMotion = false): ParallaxOffsets {
  const s = Number.isFinite(scroll) ? clamp01(scroll) : 0;
  const k = reducedMotion ? 0.5 : 1;
  const ix = reducedMotion || !Number.isFinite(px) ? 0 : Math.max(-1, Math.min(1, px));
  const iy = reducedMotion || !Number.isFinite(py) ? 0 : Math.max(-1, Math.min(1, py));
  return {
    backX: round3(ix * -1.2),
    backY: round3((-s * 5 + iy * -1) * k),
    midX: round3(ix * -3.2),
    midY: round3((-s * 14 + iy * -2.4) * k),
  };
}

/* ------------------------------------------------------------------ */
/* The iris cut-out shape                                              */
/* ------------------------------------------------------------------ */

/** The cut-out's centre in the 900x1600 stage space (a little above middle). */
const CX = 450;
const CY = 760;
const DIAG = Math.hypot(900, 1600);
const HEART_STEPS = 64;

/**
 * SVG path of the iris cut-out at radius `r` (a fraction of the stage
 * diagonal). circle = a moon gate; arch = a tall window with a round top;
 * heart = a heart. All fully cover the stage by r ≈ 0.6.
 */
export function irisPath(shape: IrisShape, r: number): string {
  const R = Math.max(0, r) * DIAG;
  if (R < 0.5) return 'M0 0';
  if (shape === 'heart') {
    // The classic heart curve (x = 16 sin^3, y = 13 cos - 5 cos 2 - 2 cos 3 - cos 4).
    // A heart covers less of a rectangle than a circle does, so it grows a little
    // faster as it opens: small enough closed that the whole heart shows on a phone,
    // big enough at the opener's widest to cover every corner of the stage.
    const open = Math.max(0, Math.min(1, (Math.max(0, r) - 0.16) / 0.46));
    const k = R * (0.05 + 0.03 * open);
    let d = '';
    for (let i = 0; i < HEART_STEPS; i++) {
      const a = (i / HEART_STEPS) * Math.PI * 2;
      const x = CX + 16 * Math.sin(a) ** 3 * k;
      const y = CY - (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * k;
      d += `${i ? 'L' : 'M'}${Math.round(x * 10) / 10 + 0} ${Math.round(y * 10) / 10 + 0} `;
    }
    return `${d}Z`;
  }
  if (shape === 'arch') {
    const hw = R * 0.66; // half width
    const h = R * 2.05;
    const top = CY - h / 2 + hw;
    const bottom = CY + h / 2;
    return `M${CX - hw} ${bottom} L${CX - hw} ${top} A${hw} ${hw} 0 0 1 ${CX + hw} ${top} L${CX + hw} ${bottom} Z`;
  }
  return `M${CX - R} ${CY} A${R} ${R} 0 1 0 ${CX + R} ${CY} A${R} ${R} 0 1 0 ${CX - R} ${CY} Z`;
}
