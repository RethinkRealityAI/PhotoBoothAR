/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Face Paint painter: one spec → one texture, drawn into ANY 2D context in
 * the face mesh's UV space. The booth's FacePaintLayer, the studio builder's
 * live preview and its design-grid thumbnails all call this same function, so
 * a thumbnail is never a picture of something else.
 *
 * The texture is transparent except where there is paint; FacePaintLayer maps
 * it onto the tracked mesh, so a stroke on the cheek stretches when the cheek
 * does.
 */
import { FACE_PAINT_DESIGN_MAP } from './designs';
import { lerpPt, type FaceFrame, type Pt } from './features';
import { hard, rng, type PaintContext } from './shapes';
import type { FacePaintLogo, FacePaintPlacement, FacePaintSpec } from './spec';

/** A decoded logo the painter can stamp. */
export interface LogoImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** Centre + natural width (texture px) of each stamp position. */
export function logoSlots(f: FaceFrame, placement: FacePaintPlacement): { at: Pt; width: number }[] {
  const E = f.eyeSpan;
  const cheek = (s: 'L' | 'R') => ({
    at: lerpPt(s === 'L' ? f.cheekL : f.cheekR, s === 'L' ? f.underEyeL : f.underEyeR, 0.3),
    width: E * 0.34,
  });
  switch (placement) {
    case 'leftCheek': return [cheek('L')];
    case 'rightCheek': return [cheek('R')];
    case 'bothCheeks': return [cheek('L'), cheek('R')];
    case 'forehead': return [{ at: lerpPt(f.browMid, f.foreheadMid, 0.55), width: E * 0.5 }];
  }
}

/**
 * Stamp the logo, UPRIGHT and UN-FLIPPED: canvas x grows with u, and
 * FacePaintLayer renders small u on the screen's left in both the mirrored
 * preview and an unmirrored camera, so the image reads exactly as uploaded —
 * on screen and in the saved photo. Aspect is preserved; a tall logo is held to
 * 0.9× its slot width in height so it cannot climb into the eye.
 */
export function stampLogo(ctx: PaintContext, f: FaceFrame, logo: FacePaintLogo, img: LogoImage): void {
  if (!(img.width > 0) || !(img.height > 0)) return;
  const aspect = img.width / img.height;
  hard(ctx);
  for (const slot of logoSlots(f, logo.placement)) {
    let w = slot.width * logo.size;
    let h = w / aspect;
    const maxH = slot.width * logo.size * 0.9;
    if (h > maxH) { h = maxH; w = h * aspect; }
    ctx.save();
    ctx.globalAlpha = 0.96;
    ctx.drawImage(img.image, slot.at.x - w / 2, slot.at.y - h / 2, w, h);
    ctx.restore();
  }
}

/**
 * Pigment, not vinyl: knock seeded pin-holes out of the paint so a flat fill
 * picks up the slightly broken coverage of a sponge on skin. Only removes
 * alpha (destination-out), so it can never add paint where there was none.
 */
export function pigmentGrain(ctx: PaintContext, size: number, seed = 0x9a1f): void {
  const rand = rng(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  const n = Math.round(size * 1.6);
  for (let i = 0; i < n; i++) {
    const r = size * (0.0012 + rand() * 0.0022);
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Paint `spec` into `ctx` (square, `frame.size` px). Clears first. An unknown
 * design paints nothing (a newer config on an older client), and a logo whose
 * image is not decoded yet is simply skipped — the caller repaints when it is.
 * Returns whether anything was drawn.
 */
export function paintFacePaint(
  ctx: PaintContext,
  frame: FaceFrame,
  spec: FacePaintSpec,
  opts: { logo?: LogoImage | null; grain?: boolean } = {},
): boolean {
  ctx.clearRect(0, 0, frame.size, frame.size);
  const design = FACE_PAINT_DESIGN_MAP[spec.design];
  let drew = false;
  if (design) {
    ctx.save();
    design.draw(ctx, frame, spec.colors);
    ctx.restore();
    drew = true;
    if (opts.grain !== false) pigmentGrain(ctx, frame.size);
  }
  if (spec.logo && opts.logo) {
    stampLogo(ctx, frame, spec.logo, opts.logo);
    drew = true;
  }
  return drew;
}

/**
 * A flat stand-in face for thumbnails: the mesh's own triangles filled in UV
 * space (the standard layout is close to a frontal projection, so it reads as a
 * face), with the eye and mouth holes left dark.
 */
export function drawFaceBase(
  ctx: PaintContext,
  uvs: ArrayLike<number>,
  indices: ArrayLike<number>,
  size: number,
  skin = '#c99a7a',
): void {
  hard(ctx);
  ctx.fillStyle = skin;
  ctx.strokeStyle = skin;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = 0; k + 2 < indices.length; k += 3) {
    const a = indices[k], b = indices[k + 1], c = indices[k + 2];
    ctx.moveTo(uvs[a * 2] * size, (1 - uvs[a * 2 + 1]) * size);
    ctx.lineTo(uvs[b * 2] * size, (1 - uvs[b * 2 + 1]) * size);
    ctx.lineTo(uvs[c * 2] * size, (1 - uvs[c * 2 + 1]) * size);
    ctx.closePath();
  }
  // Stroke too, so the hairline seams between triangles do not show.
  ctx.fill();
  ctx.stroke();
}
