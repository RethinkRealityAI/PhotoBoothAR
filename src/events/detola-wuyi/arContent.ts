/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detola & Wuyi AR catalog — elegant (non-neon) effects, the DW gold frames,
 * and tasteful head-pieces. Pinned by id so other events' AR effects in the
 * shared registries never leak into this booth.
 */
import type { EventARContent } from '../types';

export const detolaWuyiAR: EventARContent = {
  shaderIds: [
    'champagne-sparkle',
    'golden-hour-bloom',
    'velvet-film',
    'celestial-lens-flare',
    'aurora-lumina',
    'prismatic-holo',
  ],
  borderIds: [
    'dw-frame-monogram',
    'dw-banner',
    'dw-frame-classic',
    'dw-corners',
    'overlay-confetti',
  ],
  headPieceIds: ['royal-crown', 'queen-tiara', 'cheek-stars', 'hope-halo'],
};
