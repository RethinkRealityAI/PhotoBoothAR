/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Themed "try it" kits for the sales decks' live demo (/try/:kit). Each kit is
 * a curated set of real platform assets: 2D frames from the public guide pack
 * (public/guides/frames, transparent 1080×1920), built-in shader effects and
 * procedural 3D head pieces. Pure data, so a test can check every id resolves.
 *
 * Nothing a prospect captures in a kit leaves their device: the demo never
 * posts, uploads or stores a photo.
 */

export interface DemoKitFrame {
  id: string;
  name: string;
  /** Orb accent. */
  hue: string;
  /** Full-size transparent overlay, same-origin. */
  src: string;
  /** Small preview for the orb / carousels. */
  thumb: string;
}

export interface DemoKitChoice {
  id: string;
  name: string;
  hue: string;
}

export interface DemoKit {
  id: string;
  /** "Wedding" — used in "Try the wedding booth". */
  label: string;
  /** Short line under the title. */
  blurb: string;
  frames: DemoKitFrame[];
  /** SHADER_MAP ids. */
  effects: DemoKitChoice[];
  /** HEAD_PIECE_MAP ids. */
  props: DemoKitChoice[];
}

const F = (id: string, name: string, hue: string): DemoKitFrame => ({
  id,
  name,
  hue,
  src: `/guides/frames/${id}.png`,
  thumb: `/guides/frames/thumb/${id}.webp`,
});

export const DEMO_KITS: Record<string, DemoKit> = {
  wedding: {
    id: 'wedding',
    label: 'Wedding',
    blurb: 'Monogram, owanbe arch, magazine cover. Pick a look and take a photo.',
    frames: [
      F('wedding-monogram-drop', 'Monogram', '#D4AF37'),
      F('cultural-asoebi-arch', 'Owanbe', '#2F5BD8'),
      F('wedding-magazine-cover', 'Cover', '#EEF3FF'),
      F('wedding-arch-mask', 'Roses', '#F2A7B8'),
    ],
    effects: [
      { id: 'champagne-sparkle', name: 'Sparkle', hue: '#E8C766' },
      { id: 'golden-hour-bloom', name: 'Golden', hue: '#FB923C' },
      { id: 'velvet-film', name: 'Film', hue: '#E879F9' },
    ],
    props: [
      { id: 'queen-tiara', name: 'Tiara', hue: '#38BDF8' },
      { id: 'royal-crown', name: 'Crown', hue: '#D4AF37' },
      { id: 'cheek-stars', name: 'Sparkle', hue: '#FB923C' },
    ],
  },
  christmas: {
    id: 'christmas',
    label: 'Christmas party',
    blurb: 'Office party, end-of-year dinner, Detty December. Pick a look and take a photo.',
    frames: [
      F('christmas-santa-cover', 'Santa', '#D7142F'),
      F('christmas-elf-hands', 'Elf', '#1F6B34'),
      F('corporate-badge-mask', 'Team', '#7C6CF7'),
      F('gala-magazine-cover', 'Gala', '#E8C766'),
    ],
    effects: [
      { id: 'snowfall-glow', name: 'Snow', hue: '#C8D7EA' },
      { id: 'champagne-sparkle', name: 'Sparkle', hue: '#E8C766' },
      { id: 'aurora-lumina', name: 'Aurora', hue: '#34D399' },
    ],
    props: [
      { id: 'royal-crown', name: 'Crown', hue: '#D4AF37' },
      { id: 'neon-shades', name: 'Shades', hue: '#7C6CF7' },
      { id: 'cheek-stars', name: 'Sparkle', hue: '#FB923C' },
    ],
  },
  party: {
    id: 'party',
    label: 'Birthday & launch',
    blurb: 'Birthdays, launches, countdowns. Pick a look and take a photo.',
    frames: [
      F('birthday-monogram-corner', 'Birthday', '#F2A7B8'),
      F('birthday-character-hands', 'Flamingo', '#FB7185'),
      F('launch-product-side', 'Launch', '#E8C766'),
      F('nye-countdown', 'Countdown', '#D4AF37'),
    ],
    effects: [
      { id: 'neon-pulse', name: 'Neon', hue: '#E879F9' },
      { id: 'prismatic-holo', name: 'Prismatic', hue: '#38BDF8' },
      { id: 'laser-sparkle', name: 'Laser', hue: '#22D3EE' },
    ],
    props: [
      { id: 'neon-shades', name: 'Shades', hue: '#7C6CF7' },
      { id: 'royal-crown', name: 'Crown', hue: '#D4AF37' },
      { id: 'cheek-stars', name: 'Sparkle', hue: '#FB923C' },
    ],
  },
};

export const DEMO_KIT_IDS = Object.keys(DEMO_KITS);

/** Unknown / missing ids fall back to the wedding kit. */
export function demoKit(id: string | null | undefined): DemoKit {
  if (id !== null && id !== undefined && Object.prototype.hasOwnProperty.call(DEMO_KITS, id)) return DEMO_KITS[id];
  return DEMO_KITS.wedding;
}

export const TRY_BASE = '/try';

export function tryPath(kit: string): string {
  return `${TRY_BASE}/${encodeURIComponent(kit)}`;
}

/** Every themed frame in the pack, grouped for the "Custom AR frames" showcase. */
export const FRAME_THEMES: { theme: string; frames: DemoKitFrame[] }[] = [
  { theme: 'Wedding', frames: [F('wedding-monogram-drop', 'Monogram drop', ''), F('wedding-magazine-cover', 'Wedding cover', ''), F('wedding-arch-mask', 'Rose arch', '')] },
  { theme: 'Owanbe & culture', frames: [F('cultural-asoebi-arch', 'Owanbe arch', ''), F('cultural-mehndi-arch', 'Sangeet night', '')] },
  { theme: 'Christmas', frames: [F('christmas-santa-cover', 'North Pole Times', ''), F('christmas-elf-hands', 'Nice list', '')] },
  { theme: 'Birthday', frames: [F('birthday-monogram-corner', 'Balloon 30', ''), F('birthday-character-hands', 'Main character', '')] },
  { theme: 'Gala & corporate', frames: [F('gala-magazine-cover', 'Gala night', ''), F('gala-artdeco-mask', 'Midnight & gold', ''), F('corporate-badge-mask', 'Team page', '')] },
  { theme: 'Launch & New Year', frames: [F('launch-product-side', 'The reveal', ''), F('nye-countdown', '2027 countdown', '')] },
];
