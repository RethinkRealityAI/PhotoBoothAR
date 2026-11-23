/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The platform's words for what a guest can try on — ONE source, so the booth,
 * the host setup wizard, the library, Studio and the guides can never call the
 * same thing two different names.
 *
 *   Looks   — the umbrella: anything a guest can put on in the booth.
 *   Frames  — 2D borders and overlays drawn over the photo.
 *   Props   — 3D pieces worn on the head, face or hand (shades, hats, crowns).
 *   Paint   — face paint, painted onto the tracked face (it sits on the skin,
 *             so it is not "worn" like a prop, and guests look for it by name).
 *   Effects — whole-screen glow, sparkle and colour grades.
 *
 * "Filters" is deliberately NOT one of them: people use it for every kind of
 * AR, so it would blur the four apart. Dapo approved these terms 2026-11-23.
 */

export type LookTab = 'frames' | 'props' | 'paint' | 'effects';

export interface LookTabTerm {
  id: LookTab;
  /** The tab label — short enough that all four fit one phone row. */
  short: string;
  /** The longer name for headings and the setup wizard. */
  label: string;
  /** Singular, lower case, for sentences ("Pick a frame"). */
  noun: string;
}

/** Tab order everywhere: the host-made looks lead, generic effects come last. */
export const LOOK_TABS: readonly LookTabTerm[] = [
  { id: 'frames', short: 'Frames', label: 'Frames', noun: 'frame' },
  { id: 'props', short: 'Props', label: '3D props', noun: 'prop' },
  { id: 'paint', short: 'Paint', label: 'Face paint', noun: 'face paint' },
  { id: 'effects', short: 'Effects', label: 'Effects', noun: 'effect' },
];

export const LOOK_TAB_SHORT = Object.fromEntries(LOOK_TABS.map((t) => [t.id, t.short])) as Record<LookTab, string>;
