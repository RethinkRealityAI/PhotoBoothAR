/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyBox — pure geometry for the glass box Beamy stands in on /beamy.
 *
 * The stage is orthographic (1 unit = 1 CSS px) so every DOM-anchored
 * position (beam endpoints, cards, wall tiles) stays exact. The box's depth
 * is therefore DRAWN in one-point perspective in screen space: a front face
 * (the open front pane, around Beamy), a back face that is the front face
 * scaled toward a vanishing point, and the floor between them. Moving the
 * vanishing point with the pointer is what makes the volume visibly turn.
 *
 * DOM-free and deterministic, so the maths is unit-tested in node.
 */

export interface Pt { x: number; y: number; }
/** Viewport-px bounds the box must stay inside (null = unbounded). */
export interface BoxRoom { left: number; top: number; right: number; bottom: number; }
/** tl, tr, br, bl. */
export type Quad = [Pt, Pt, Pt, Pt];

export interface BoxInput {
  /** Beamy's home (feet point) and home height, viewport px. */
  home: Pt;
  heightPx: number;
  room: BoxRoom | null;
  /** Lerped pointer, −1..1 on each axis (0,0 = straight on; reduced motion keeps it 0). */
  par: Pt;
  phone: boolean;
}

export interface Box {
  front: Quad;
  back: Quad;
  vp: Pt;
  /** Back-face scale (0..1): how deep the box reads. */
  k: number;
}

export const BOX = {
  /** Front-face width per unit of Beamy's height (before the room clamps it). */
  widthPerH: 1.5,
  heightPerH: 1.42,
  /** How far the front floor edge sits below his feet. */
  dropPerH: 0.14,
  /** Back-face scale: desktop deeper, phones shallower. */
  k: 0.68,
  kPhone: 0.76,
  /** Vanishing point: above the face centre, then moved by the pointer. */
  vpRise: 0.12,
  parX: 0.32,
  parY: 0.14,
  /** Narrower than this (× height) and the box is not drawn at all. */
  minHalfW: 0.42,
} as const;

/** The box around Beamy's home, or null when there is no room for a box. */
export function boxGeometry(i: BoxInput): Box | null {
  const H = i.heightPx;
  if (!(H >= 40)) return null;
  const r = i.room ?? { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  // Symmetric about Beamy, so he always stands in the middle of his room.
  const halfW = Math.min((H * BOX.widthPerH) / 2, i.home.x - r.left, r.right - i.home.x);
  if (!(halfW >= H * BOX.minHalfW)) return null;
  const bottom = Math.min(i.home.y + H * BOX.dropPerH, r.bottom);
  const top = Math.max(bottom - H * BOX.heightPerH, r.top);
  if (bottom - top < H * 0.6) return null;
  const left = i.home.x - halfW;
  const right = i.home.x + halfW;
  const front: Quad = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  const k = i.phone ? BOX.kPhone : BOX.k;
  const cy = (top + bottom) / 2;
  // Pointer to the right = we look from the right = the back face slides left.
  const vp = {
    x: i.home.x - i.par.x * halfW * 2 * BOX.parX,
    y: cy - H * BOX.vpRise - i.par.y * (bottom - top) * BOX.parY,
  };
  const back = front.map((p) => ({ x: vp.x + (p.x - vp.x) * k, y: vp.y + (p.y - vp.y) * k })) as Quad;
  return { front, back, vp, k };
}

const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * A point on the box floor: u −1 (left wall) … 1 (right wall), v 0 (back
 * wall) … 1 (front edge). `scale` is the perspective size factor there
 * (k at the back, 1 at the front) for things standing on the floor.
 */
export function floorAt(box: Box, u: number, v: number): { p: Pt; scale: number } {
  const t = (u + 1) / 2;
  const backEdge = mix(box.back[3], box.back[2], t);
  const frontEdge = mix(box.front[3], box.front[2], t);
  return { p: mix(backEdge, frontEdge, v), scale: box.k + (1 - box.k) * v };
}
