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
  /**
   * The piece wraps the head (a crown's back band, a halo's far arc, glasses
   * arms), so the booth hides whatever sits behind the real head. Only
   * platform (db) events honour it; legacy events render as they always have.
   * Absent for pieces that rest ON the face, where the occluder would clip them.
   */
  occlude?: boolean;
  /**
   * Offset (cm) used INSTEAD of `config.offset` on platform (db) events. The
   * base `config` is what the frozen legacy event sites render and must never
   * move, so a placement correction lands here.
   */
  platformOffset?: [number, number, number];
  /**
   * Below the quality bar for anything a host or prospect is OFFERED
   * (2026-11-23 showcase cleanup). Still renders wherever a legacy event or a
   * saved scene references it; the studio shelf and showcases skip it.
   */
  retired?: true;
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
  { id: 'royal-crown', name: 'Royal Crown', anchor: 'crown', config: cfg('crown', [0, -1.0, -0.6], 1), occlude: true, platformOffset: [0, 1.0, -0.6], retired: true },
  { id: 'queen-tiara', name: "Queen's Tiara", anchor: 'forehead', config: cfg('forehead', [0, 0.4, 0], 1), occlude: true, retired: true },
  { id: 'cheek-stars', name: 'Cheek Sparkles', anchor: 'noseBridge', config: cfg('noseBridge', [0, 0, 0], 1), retired: true },
  { id: 'hope-halo', name: 'Halo of Hope', anchor: 'crown', config: cfg('crown', [0, 3.4, -1.0], 1), occlude: true, retired: true },
  { id: 'neon-shades', name: 'Neon Shades', anchor: 'noseBridge', config: cfg('noseBridge', [0, 1.4, 1.2], 1), occlude: true, platformOffset: [0, 0.15, 1.2], retired: true },
  { id: 'cyclops-visor', name: 'Optic Visor', anchor: 'noseBridge', config: cfg('noseBridge', [0, 1.5, 1.0], 1), occlude: true, platformOffset: [0, 0.25, 1.0], retired: true },
];

export const HEAD_PIECE_MAP: Record<string, HeadPieceDef> = Object.fromEntries(
  HEAD_PIECES.map((p) => [p.id, p]),
);
