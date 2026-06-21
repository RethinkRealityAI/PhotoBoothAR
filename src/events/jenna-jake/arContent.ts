/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Jenna & Jake AR manifest — which shared built-in effects this event exposes.
 * Reuses two vivid existing shaders (prismatic / kaleidoscope) plus the new
 * festival neon shaders, frames, and the neon-sunglasses head-piece.
 */
import type { EventARContent } from '../types';

export const jennaJakeAR: EventARContent = {
  shaderIds: ['prismatic-holo', 'crystalline-kaleidoscope', 'neon-pulse', 'holo-bloom', 'laser-sparkle'],
  borderIds: ['jj-neon-frame', 'jj-lower-third', 'jj-equalizer'],
  headPieceIds: ['neon-shades'],
};
