/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * recapReveal — the album's TAP-TO-OPEN moment on /r/:slug, the part that has
 * to be RIGHT rather than pretty.
 *
 * The host picks `keepsakes.reveal` (lib/keepsakeSettings.ts): 'beam' is
 * Beamwall's own (src/pages/recap/BeamReveal.tsx), 'none' goes straight to
 * the album, and every other id is a CARD reveal
 * (src/components/cards/reveals/*) played through a thin adapter that dresses
 * the album up as the card those components expect. This module decides:
 *
 *   • WHETHER a reveal plays on this visit, and which one (a deep link wins,
 *     the once-per-visit flag wins, a WebGL reveal on a device without WebGL
 *     plays the card fallback, never nothing);
 *   • what plays AFTER it: the keepsake theme's own character (petals,
 *     confetti, a warm curtain of light…) as a light, non-blocking settle —
 *     the theme's `intro` kind, which used to be a second auto-playing
 *     overlay and is now never a second opening moment;
 *   • the beam reveal's choreography (normal + reduced motion), held by tests
 *     to the card contract's 2.5–6 s after the tap;
 *   • the adapter: album data → CardRevealProps' `card` + `contributions` +
 *     `palette`, with nobody addressed by name.
 *
 * PURE: no React, no DOM, no supabase (type imports only) — vitest node env.
 */
import type { CardViewContribution, CardViewData } from './cards';
import { playableReveal, type CardPalette, type CardRevealId } from './cardPresentation';
import { beatsEnd, type RevealBeat } from './cardReveal';
import type { KeepsakeRevealId, KeepsakeThemeOption } from './keepsakeSettings';
import type { Post } from '../types';

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

/** The page cross-fades the reveal layer out over this long after onDone
 *  (the same value as the card experience's REVEAL_HANDOFF_MS). */
export const RECAP_REVEAL_HANDOFF_MS = 700;
/** Inside the hand-off: how long the layer itself takes to fade. */
export const RECAP_REVEAL_FADE_MS = 450;
/** A reveal that has been tapped but has not called onDone by now is broken:
 *  the album shows anyway. The contract's longest reveal is 6 s. */
export const RECAP_REVEAL_DONE_DEADLINE_MS = 8000;
/** A reveal chunk that has not loaded by now (blackhole venue wifi) is given
 *  up on: the album shows. A chunk that FAILS is given up on at once. */
export const RECAP_REVEAL_LOAD_DEADLINE_MS = 8000;
/** The theme settle never holds the page for longer than this. */
export const RECAP_SETTLE_FAILSAFE_MS = 3200;

/* ------------------------------------------------------------------ */
/* Which opening plays                                                 */
/* ------------------------------------------------------------------ */

/** The sections a link may jump straight to. `#film` is the keepsake email's
 *  link; `#photos` is the album grid. */
export type RecapDeepLink = 'film' | 'photos';

export function recapDeepLink(hash: string | null | undefined): RecapDeepLink | null {
  const h = (hash ?? '').replace(/^#/, '').trim().toLowerCase();
  return h === 'film' || h === 'photos' ? h : null;
}

/** A reveal this device can actually play: 'beam', or a card reveal id. */
export type RecapPlayableReveal = 'beam' | Exclude<CardRevealId, 'none'>;

/**
 * The configured reveal as THIS device plays it, ignoring visit state:
 * null = no opening moment ('none'). A WebGL card reveal without WebGL plays
 * the card fallback (cardPresentation REVEAL_WEBGL_FALLBACK). Used for the
 * first visit and for "Replay the opening".
 */
export function playableRecapReveal(reveal: KeepsakeRevealId, webgl: boolean): RecapPlayableReveal | null {
  if (reveal === 'none') return null;
  if (reveal === 'beam') return 'beam';
  const id = playableReveal(reveal, webgl);
  return id === 'none' ? null : id;
}

export interface RecapOpeningInput {
  reveal: KeepsakeRevealId;
  webgl: boolean;
  /** `window.location.hash`. */
  hash: string;
  /** This album's opening already ran in this tab (sessionStorage). */
  seen: boolean;
}

export interface RecapOpening {
  /** The reveal to play now; null = the album straight away. */
  reveal: RecapPlayableReveal | null;
  /** A section to land on instead of the top. */
  deepLink: RecapDeepLink | null;
  /** Play the theme's settle once the album is showing. */
  settle: boolean;
}

/**
 * Precedence, highest first:
 *   1. a deep link — the guest came for the film or the photos; no ceremony;
 *   2. seen this visit — a reload or a back-navigation is not a new opening;
 *   3. 'none' — straight to the album, with the theme's settle as its only
 *      flourish (it is then the ONE opening moment, never a second);
 *   4. the configured reveal (with the WebGL fallback).
 * Reduced motion never removes the reveal: it plays gentler (reveals/types.ts).
 */
export function resolveRecapOpening(input: RecapOpeningInput): RecapOpening {
  const deepLink = recapDeepLink(input.hash);
  if (deepLink !== null) return { reveal: null, deepLink, settle: false };
  if (input.seen) return { reveal: null, deepLink: null, settle: false };
  return { reveal: playableRecapReveal(input.reveal, input.webgl), deepLink: null, settle: true };
}

/* ------------------------------------------------------------------ */
/* The theme settle                                                     */
/* ------------------------------------------------------------------ */

export type SettleKind = KeepsakeThemeOption['intro'];

/**
 * What the theme adds as the album settles in, or null for nothing.
 *   • after the beam reveal a 'beam' settle would be the same sweep twice —
 *     the reveal already IS that theme's character;
 *   • reduced motion: falling petals, confetti and moving panels are motion
 *     the guest asked to avoid; a soft glow ('fade') stays.
 */
export function settleKind(themeIntro: SettleKind, played: RecapPlayableReveal | null, reducedMotion: boolean): SettleKind | null {
  if (themeIntro === 'beam' && played === 'beam') return null;
  if (reducedMotion) return 'fade';
  return themeIntro;
}

/* ------------------------------------------------------------------ */
/* The beam reveal's choreography                                      */
/* ------------------------------------------------------------------ */

export interface BeamBeats {
  /** The Open button and the hint leave; the stack draws a breath. */
  arm: RevealBeat;
  /** A shaft of light drops from above onto the seal. */
  strike: RevealBeat;
  /** The seal flares white. */
  flash: RevealBeat;
  /** The seal splits in two and the band of light slides off both sides. */
  seal: RevealBeat;
  /** One wide beam sweeps across the whole screen. */
  sweep: RevealBeat;
  /** The prints fan out of the stack onto the album's hero (staggered inside). */
  fan: RevealBeat;
  /** The event's name and date glide to where the album's heading sits. */
  title: RevealBeat;
  /** The stage light eases to the album page's own light. */
  calm: RevealBeat;
  /** A held beat on the landed album, then onDone. */
  hold: RevealBeat;
}

const BEAM_NORMAL: BeamBeats = {
  arm: { at: 0, dur: 0.25 },
  strike: { at: 0.1, dur: 0.42 },
  flash: { at: 0.46, dur: 0.55 },
  seal: { at: 0.5, dur: 0.6 },
  sweep: { at: 0.62, dur: 1.3 },
  fan: { at: 0.9, dur: 1.45 },
  title: { at: 1.0, dur: 1.2 },
  calm: { at: 2.0, dur: 1.0 },
  hold: { at: 3.0, dur: 0.4 },
};

// Same story, gentler: the strike fades in instead of dropping, the seal's
// halves part a little instead of flying, the sweep is a wash that does not
// travel, the prints glide with no overshoot. Never skipped (types.ts).
const BEAM_REDUCED: BeamBeats = {
  arm: { at: 0, dur: 0.35 },
  strike: { at: 0.1, dur: 0.6 },
  flash: { at: 0.6, dur: 0.6 },
  seal: { at: 0.65, dur: 0.7 },
  sweep: { at: 0.8, dur: 1.6 },
  fan: { at: 1.0, dur: 1.6 },
  title: { at: 1.1, dur: 1.4 },
  calm: { at: 2.3, dur: 1.0 },
  hold: { at: 3.3, dur: 0.4 },
};

export function beamBeats(reducedMotion: boolean): BeamBeats {
  return reducedMotion ? BEAM_REDUCED : BEAM_NORMAL;
}

/** Seconds from the tap to onDone. */
export function beamRevealLength(reducedMotion: boolean): number {
  return beatsEnd(beamBeats(reducedMotion));
}

/** Per-print flight inside the fan beat: the stagger between prints and each
 *  print's own duration, so the LAST print lands exactly at the beat's end. */
export function fanTiming(fan: RevealBeat, n: number): { stagger: number; each: number } {
  const count = Math.max(1, Math.floor(n));
  const stagger = count === 1 ? 0 : Math.min(0.09, (fan.dur * 0.35) / (count - 1));
  return { stagger, each: Math.max(0.2, fan.dur - stagger * (count - 1)) };
}

export interface BeamBudget {
  /** Drifting motes in the idle scene. */
  idleMotes: number;
  /** Motes the seal throws out when it breaks. */
  burstMotes: number;
}

/** Fewer particles on a phone, far fewer under reduced motion. */
export function beamBudget(reducedMotion: boolean, viewportW: number): BeamBudget {
  if (reducedMotion) return { idleMotes: 14, burstMotes: 8 };
  return viewportW < 640 ? { idleMotes: 34, burstMotes: 22 } : { idleMotes: 56, burstMotes: 30 };
}

/* ------------------------------------------------------------------ */
/* The hero the reveal lands on                                         */
/* ------------------------------------------------------------------ */

/** How many prints the album hero fans out (RecapHero). */
export const HERO_PRINTS = 5;

/** The hero's resting tilts, authored not generated — the fan has to look
 *  arranged. Shared with RecapHero so the beam's prints land on the same angles. */
export const HERO_PRINT_TILT_DEG: readonly number[] = [-9, 5.5, -2.5, 7, -6];

/** The hero's stacking: the middle print on top. */
export function heroPrintZ(i: number): number {
  return i === 2 ? 3 : 2 - Math.abs(i - 2);
}

export function heroPrintTilt(i: number): number {
  const n = HERO_PRINT_TILT_DEG.length;
  return HERO_PRINT_TILT_DEG[((i % n) + n) % n];
}

/** Where a print sits in the SEALED stack, relative to the stack's centre
 *  (px, degrees). The top print (highest heroPrintZ) is square; the rest peek
 *  out at alternating angles so it reads as a stack, not one photo. */
export function stackPose(i: number): { x: number; y: number; rot: number } {
  const z = heroPrintZ(i);
  const depth = 3 - z; // 0 = top of the stack
  const side = i % 2 === 0 ? -1 : 1;
  return { x: side * depth * 4, y: depth * 3, rot: depth === 0 ? 0 : side * (2.5 + depth * 2.2) };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The hero fan as the album lays it out, for when the album cannot be measured
 * (it is mounted but not yet laid out, or failed): a row of 3:4 prints
 * overlapping a little, centred, a third of the way down. Matches RecapHero's
 * sizes (w-[4.75rem] / sm:w-28 / md:w-32, -space-x-5 / sm:-space-x-7).
 */
export function fallbackHeroBoxes(vw: number, vh: number, n: number): Box[] {
  const count = Math.max(0, Math.min(HERO_PRINTS, Math.floor(n)));
  if (count === 0) return [];
  const w = vw >= 768 ? 128 : vw >= 640 ? 112 : 76;
  const overlap = vw >= 640 ? 28 : 20;
  const h = (w * 4) / 3;
  const total = count * w - (count - 1) * overlap;
  const x0 = (vw - total) / 2;
  const y = Math.round(Math.max(220, vh * 0.36));
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w - overlap), y, w, h }));
}

/** "24 moments inside" — the line under the sealed stack. Honest at zero. */
export function sealedLine(moments: number): string {
  if (!(moments > 0)) return 'Tap to open the album';
  const n = Math.floor(moments);
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'moment' : 'moments'} inside`;
}

/* ------------------------------------------------------------------ */
/* The card-reveal adapter                                             */
/* ------------------------------------------------------------------ */

/** How many album photos a card reveal is handed (the reveals use up to 4–6). */
export const CARD_REVEAL_PHOTOS = 6;

export interface RecapRevealCardInput {
  /** The album's title: the event's name. */
  title: string;
  /** `events.starts_at`, ISO, or null. */
  eventDate: string | null;
  /** The album, newest first. */
  posts: readonly Pick<Post, 'id' | 'image_url' | 'media_type'>[];
}

/**
 * The album dressed as the card a card reveal expects. Honest by construction:
 *   • title = the event's name; recipientName = null, so the envelope's seal
 *     takes the title's initial and "For …" lines simply do not render —
 *     nobody is addressed by name on a page every guest shares;
 *   • contributions = the album's STILLS as photo contributions with no
 *     contributor and no message (a reveal has no business inventing either);
 *     clips are left out because the reveals paint photos as textures;
 *   • template/theme are inert placeholders: no template is ever mounted
 *     after an album reveal, the album is.
 */
export function recapRevealCard(input: RecapRevealCardInput): { card: CardViewData; contributions: CardViewContribution[] } {
  const title = input.title.trim() || 'The event album';
  const contributions: CardViewContribution[] = [];
  for (const p of input.posts) {
    if (p.media_type === 'video' || typeof p.image_url !== 'string' || p.image_url === '') continue;
    contributions.push({
      id: p.id,
      contributorName: null,
      message: null,
      mediaType: 'photo',
      durationSeconds: null,
      url: p.image_url,
      sortOrder: contributions.length,
    });
    if (contributions.length >= CARD_REVEAL_PHOTOS) break;
  }
  return {
    card: {
      title,
      recipientName: null,
      template: 'storybook',
      theme: {},
      publishedAt: input.eventDate,
      eventName: title,
      filmUrl: null,
    },
    contributions,
  };
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

function triplet(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** The keepsake theme as the literal colours a card reveal paints with. */
export function recapRevealPalette(theme: KeepsakeThemeOption): CardPalette {
  const p = theme.palette;
  const hex = (v: string, fallback: string) => (HEX_RE.test(v) ? v : fallback);
  const accent = hex(p.accent, '#8b7dff');
  return { bg: hex(p.background, '#07060f'), fg: hex(p.ink, '#f5f3ff'), accent, accentRgb: triplet(accent) };
}
