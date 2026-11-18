/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyLooks — the hero's filter demo ON Beamy. Pure, DOM-free, tested in node.
 *
 * After the intro, Beamy tries on real platform assets one after another
 * (library 3D props, a 2D frame from the guide pack), each with a short line
 * in his bubble; a tap on him moves to the next one. Props are fitted in his
 * `body` bone's space (metres, +y up, +z toward the viewer; the bone sits
 * 0.12m above his feet, his crown tip at 0.48 in this space), so every clip
 * (hop, dance, drag-spin) carries the prop with him.
 */

/** Where a prop's fitted box is pinned on him. */
export interface PropFit {
  /** The prop's box width (x) after fitting, metres. */
  width: number;
  /** The anchor point in the body bone's space, metres. */
  at: [number, number, number];
  /** Which point of the prop's box sits on `at`: its base (hats, crowns) or its centre (glasses, halo). */
  align: 'base' | 'centre';
  /** Forward tilt about x, radians (a hat sits back a little). */
  tilt?: number;
}

export interface BeamyLook {
  id: string;
  /** What he wears, for logs and assistive text. */
  name: string;
  kind: 'none' | 'prop' | 'frame';
  /** A library GLB (prop) or a transparent 9:16 frame PNG (frame). */
  url?: string;
  fit?: PropFit;
  /** His bubble line while he wears it. Short: it shares the hero with the headline. */
  line: string;
}

export const BEAMY_LOOKS: BeamyLook[] = [
  { id: 'hello', name: 'Nothing yet', kind: 'none', line: 'Hi, I’m Beamy. Check out what I can do!' },
  {
    id: 'crown', name: 'Royal crown', kind: 'prop', url: '/models/props/royal-crown.glb',
    fit: { width: 0.32, at: [0, 0.31, 0], align: 'base' },
    line: 'Real 3D filters, like this crown. Tap me for more!',
  },
  {
    id: 'hat', name: 'Santa hat', kind: 'prop', url: '/models/props/santa-hat.glb',
    fit: { width: 0.29, at: [0, 0.35, -0.01], align: 'base', tilt: -0.14 },
    line: 'Build your own filters, or customise any of ours.',
  },
  {
    id: 'glasses', name: 'Neon shades', kind: 'prop', url: '/models/props/neon-shades.glb',
    fit: { width: 0.4, at: [0, 0.225, 0.19], align: 'centre' },
    line: 'Got a design? Upload it, or ask us to make one.',
  },
  {
    id: 'frame', name: 'Gala cover frame', kind: 'frame', url: '/guides/frames/gala-magazine-cover.png',
    line: 'Frames too, made in your event’s colours.',
  },
  {
    id: 'antlers', name: 'Reindeer antlers', kind: 'prop', url: '/models/props/reindeer-antlers.glb',
    fit: { width: 0.58, at: [0, 0.33, -0.02], align: 'base' },
    line: 'A whole library of 3D props for your event.',
  },
  {
    id: 'tiara', name: 'Tiara', kind: 'prop', url: '/models/props/queens-tiara.glb',
    fit: { width: 0.34, at: [0, 0.31, 0.03], align: 'base' },
    line: 'Snapchat and Instagram in one, right in the browser.',
  },
];

/** How long each look holds before he tries on the next (ms). */
export const LOOK_HOLD_MS = 4600;
/** Reduced motion: the same tour, slower. */
export const LOOK_HOLD_REDUCED_MS = 7000;
/** In the story's AR step the tour runs quicker (the step is one scroll stretch). */
export const STORY_LOOK_HOLD_MS = 2600;
export const STORY_LOOK_HOLD_REDUCED_MS = 5000;

/**
 * The look after `i`. The greeting plays once: after the last look the
 * tour wraps to the first worn look, never back to "nothing".
 */
export function nextLook(i: number, n: number = BEAMY_LOOKS.length): number {
  if (n <= 1) return 0;
  const k = i + 1;
  return k >= n ? 1 : k;
}

/** The asset worth warming while `i` is up (the next look's file), or null. */
export function preloadUrl(i: number, looks: BeamyLook[] = BEAMY_LOOKS): string | null {
  const nx = looks[nextLook(i, looks.length)];
  return nx?.url ?? null;
}

/**
 * Where a prop's fitted box lands: the uniform scale that makes its box
 * `fit.width` wide, and the offset (applied AFTER that scale) that puts the
 * box's base-centre or centre on `fit.at`. `min`/`max` are the prop's box.
 */
export function fitProp(min: [number, number, number], max: [number, number, number], fit: PropFit): { scale: number; offset: [number, number, number] } {
  const w = Math.max(1e-6, max[0] - min[0]);
  const scale = fit.width / w;
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  const py = fit.align === 'base' ? min[1] : (min[1] + max[1]) / 2;
  return { scale, offset: [fit.at[0] - cx * scale, fit.at[1] - py * scale, fit.at[2] - cz * scale] };
}
