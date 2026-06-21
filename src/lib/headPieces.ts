/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Metadata for the built-in procedural AR head pieces (crowns, tiara, cheek
 * gems). Kept JSX-free so the catalog can import it without pulling in Three.js.
 * The actual R3F geometry lives in components/ar/HeadPieces.tsx.
 */
import { HeadAnchor, AnchorConfig } from '../types';

export interface HeadPieceDef {
  id: string;
  name: string;
  anchor: HeadAnchor;
  config: AnchorConfig;
}

const cfg = (
  anchor: HeadAnchor,
  offset: [number, number, number],
  scale: number,
  rotation: [number, number, number] = [0, 0, 0],
): AnchorConfig => ({
  anchor,
  offset: { x: offset[0], y: offset[1], z: offset[2] },
  rotation: { x: rotation[0], y: rotation[1], z: rotation[2] },
  scale,
});

// Offsets are CENTIMETRE nudges on top of the anchor base (faceRig.ts), tuned so
// each piece sits naturally out of the box; the studio gizmo fine-tunes further.
export const HEAD_PIECES: HeadPieceDef[] = [
  { id: 'royal-crown', name: 'Royal Crown', anchor: 'crown', config: cfg('crown', [0, -1.0, -0.6], 1) },
  { id: 'queen-tiara', name: "Queen's Tiara", anchor: 'forehead', config: cfg('forehead', [0, 0.4, 0], 1) },
  { id: 'cheek-stars', name: 'Cheek Sparkles', anchor: 'noseBridge', config: cfg('noseBridge', [0, 0, 0], 1) },
  { id: 'hope-halo', name: 'Halo of Hope', anchor: 'crown', config: cfg('crown', [0, 3.4, -1.0], 1) },
];

export const HEAD_PIECE_MAP: Record<string, HeadPieceDef> = Object.fromEntries(
  HEAD_PIECES.map((p) => [p.id, p]),
);
