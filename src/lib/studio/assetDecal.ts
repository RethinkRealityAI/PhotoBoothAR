/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ASSET DECAL — a guest's name engraved onto a template's text slot.
 *
 * A name on a cap is not a texture swap. The asset ships with ONE baked albedo
 * atlas whose UV layout we did not author and cannot re-pack at runtime, so
 * there is nowhere to "paint" the text. The answer is a DECAL: a small mesh
 * carved out of the host mesh's own triangles inside a projector box, drawn on
 * top with its own albedo and normal map.
 *
 * BROWSER ONLY (three.js, canvas, document.fonts). NEVER import this from a
 * test — the same rule ./text3dBuild.ts carries, for the same reason. The pure
 * halves it stands on (`resolveLabelText`, `LABEL_FONT_CSS`, the slot
 * descriptor) live in ./assetTemplate.ts and ARE tested.
 *
 * ── Three things about DecalGeometry that will bite ───────────────────────
 *
 * 1. It reads `mesh.matrixWorld` DIRECTLY. Built against a head rig that moves
 *    every frame, the decal is carved in whatever pose the head happened to be
 *    in. It must be built ONCE against the REST pose and then parented to the
 *    mesh so it rides along. drei's own `<Decal>` (Decal.js) does exactly this:
 *    it clones the parent's matrixWorld, identities it, builds, and restores.
 *    `withRestPose` below is that discipline, and it restores in a `finally` so
 *    a throw mid-build cannot leave the model's world matrix wiped.
 *
 * 2. It clips by BOX and by box alone. It has no notion of "the same surface",
 *    so a projector deep enough to reach the brim engraves the brim as well —
 *    panel C of the research render. `slot.decalDepth` is the only defence, and
 *    it is per-slot because the right depth on a flat panel is wrong on a dome.
 *
 * 3. It is O(triangles) with no acceleration structure. On Meshy's 30k default
 *    that is roughly 100-250 ms of blocking main thread per rebuild. Callers
 *    MUST debounce live typing; this module reports its own `buildMs` so a
 *    caller can see the cost rather than guess it. Below ~2-3k triangles the
 *    projection also shears visibly (panel F) — a decal is not a fallback for a
 *    low-poly proxy.
 */
import * as THREE from 'three';
import { DecalGeometry } from 'three-stdlib';
import type { AssetLabelConfig, AssetCustomization } from '../../types';
import type { GuestLetteringStyle } from '../letteringFit';
import { fitScaleToWidth } from './text3d';
import {
  LABEL_FONT_CSS,
  resolveLabelText,
  type AssetTemplate,
  type AssetTextSlot,
} from './assetTemplate';
import { normalizeTint } from './finish';

/* ── canvas artwork ───────────────────────────────────────────────────────── */

/** Albedo canvas size. Wide and short: a name is a line, not a block. */
const LABEL_TEX_W = 1024;
const LABEL_TEX_H = 256;
/** Horizontal breathing room so a glyph's overhang is never clipped by the edge. */
const LABEL_PAD_X = 48;
/** Cap height as a fraction of the canvas height before any shrink-to-fit. */
const LABEL_CAP_FRACTION = 0.6;
/** Extra advance per glyph for the tracked-out `label` style, as a fraction of
 *  the font size — the same 0.18 StageCanvas.drawGuestLettering uses. */
const LABEL_TRACKING = 0.18;

/**
 * Warm one lettering face before drawing.
 *
 * Canvas text silently falls back to the generic family when the webfont has
 * not loaded — you get Times where you asked for Pinyon Script, and because the
 * result is baked into a texture the mistake is permanent for that decal rather
 * than repainting on the next frame. Mirrors the probe StageCanvas already runs.
 * Resolves (never rejects) so a font-service hiccup degrades to the CSS fallback
 * family instead of failing the whole build.
 */
export async function warmLabelFont(style: GuestLetteringStyle): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return;
  try {
    await fonts.load(LABEL_FONT_CSS[style](64));
  } catch {
    /* the CSS fallback family is a perfectly good outcome */
  }
}

/** Draw `text` centred, with manual tracking for the `label` style. */
function drawLabelLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: GuestLetteringStyle,
  fontPx: number,
  cx: number,
  cy: number,
) {
  ctx.font = LABEL_FONT_CSS[style](fontPx);
  ctx.textBaseline = 'middle';
  if (style !== 'label') {
    ctx.textAlign = 'center';
    ctx.strokeText(text, cx, cy);
    ctx.fillText(text, cx, cy);
    return;
  }
  // Manual letter-spacing means manual centring: measure the tracked run first.
  const spacing = fontPx * LABEL_TRACKING;
  ctx.textAlign = 'left';
  let total = -spacing;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  let x = cx - total / 2;
  for (const ch of text) {
    ctx.strokeText(ch, x, cy);
    ctx.fillText(ch, x, cy);
    x += ctx.measureText(ch).width + spacing;
  }
}

/** Total advance of a line at a given size, tracking included. */
function measureLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: GuestLetteringStyle,
  fontPx: number,
): number {
  ctx.font = LABEL_FONT_CSS[style](fontPx);
  if (style !== 'label') return ctx.measureText(text).width;
  const spacing = fontPx * LABEL_TRACKING;
  let total = -spacing;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  return total;
}

export interface LabelTextures {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  /** width / height of the drawn artwork — drives the decal box's proportions. */
  aspect: number;
  dispose: () => void;
}

/**
 * Render the name to an albedo canvas plus a sobel-derived normal map.
 *
 * The normal map is what makes this read as EMBROIDERY rather than a sticker.
 * A flat albedo decal lights identically to the fabric under it, so the eye
 * reads "printed on the photo"; a thread-height ridge catches the key light
 * along one edge and shadows on the other, and the brain reads "stitched into
 * the cap". Sobel over the ALPHA channel (not luminance) puts the ridge exactly
 * on the glyph outline, so a light name on light fabric still has relief.
 */
export function makeLabelTextures(
  text: string,
  style: GuestLetteringStyle,
  hex: string,
): LabelTextures | null {
  if (!text) return null;
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_TEX_W;
  canvas.height = LABEL_TEX_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const fill = normalizeTint(hex) ?? '#ffffff';
  ctx.clearRect(0, 0, LABEL_TEX_W, LABEL_TEX_H);

  // Shrink-to-fit through the repo's own helper, which never UPSCALES: a short
  // name keeps the designed cap height instead of being stretched to the edges.
  const baseFontPx = LABEL_TEX_H * LABEL_CAP_FRACTION;
  const usable = LABEL_TEX_W - LABEL_PAD_X * 2;
  const measured = measureLine(ctx, text, style, baseFontPx);
  const fontPx = baseFontPx * fitScaleToWidth(measured, usable);

  ctx.fillStyle = fill;
  // A darker draw of the same hue outlines the thread. Composited under the
  // fill (strokeText first inside drawLabelLine) so it reads as the shaded side
  // of a raised stitch rather than as an outline typeface.
  ctx.strokeStyle = shade(fill, 0.45);
  ctx.lineWidth = Math.max(2, fontPx * 0.055);
  ctx.lineJoin = 'round';
  drawLabelLine(ctx, text, style, fontPx, LABEL_TEX_W / 2, LABEL_TEX_H / 2);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const normalCanvas = sobelNormalFromAlpha(ctx, LABEL_TEX_W, LABEL_TEX_H);
  const normalMap = normalCanvas ? new THREE.CanvasTexture(normalCanvas) : new THREE.CanvasTexture(canvas);

  // The drawn extent, not the canvas extent: a 3-letter name in a 1024-wide
  // canvas must not be stretched across a 1024-wide box of cap.
  const drawnWidth = Math.min(usable, measureLine(ctx, text, style, fontPx));
  const aspect = Math.max(0.05, drawnWidth / (fontPx * 1.35));

  return {
    map,
    normalMap,
    aspect,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
    },
  };
}

/** Darken a `#rrggbb` toward black by `t`. Used for the stitch shadow. */
function shade(hex: string, t: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - t)))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Sobel the alpha channel into a tangent-space normal map. */
function sobelNormalFromAlpha(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): HTMLCanvasElement | null {
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return null;
  const img = octx.createImageData(w, h);
  const alphaAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : src[(y * w + x) * 4 + 3] / 255;

  // Ridge steepness. Higher reads as thicker thread; past ~4 the glyph edges
  // start to sparkle under a moving key light.
  const RELIEF = 2.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (alphaAt(x + 1, y) - alphaAt(x - 1, y)) * RELIEF;
      const dy = (alphaAt(x, y + 1) - alphaAt(x, y - 1)) * RELIEF;
      const len = Math.hypot(-dx, -dy, 1);
      const o = (y * w + x) * 4;
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/* ── geometry ─────────────────────────────────────────────────────────────── */

/**
 * Run `fn` with `mesh.matrixWorld` forced to identity, then restore it.
 *
 * DecalGeometry bakes `mesh.matrixWorld` into the carved vertices. We want the
 * decal expressed in the MESH'S OWN local space so it can be added as a child
 * and inherit every later transform — the head rig's per-frame pose, the
 * gizmo's offset, the fit scale. Building against the live world matrix instead
 * bakes today's pose in permanently, and the name slides off the cap the moment
 * the guest turns their head.
 *
 * `finally` is load-bearing: DecalGeometry throws on degenerate input, and a
 * model left with an identity world matrix is an asset that has silently jumped
 * to the world origin.
 */
function withRestPose<T>(mesh: THREE.Mesh, fn: () => T): T {
  const saved = mesh.matrixWorld.clone();
  const savedAuto = mesh.matrixWorldAutoUpdate;
  mesh.matrixWorld.identity();
  mesh.matrixWorldAutoUpdate = false;
  try {
    return fn();
  } finally {
    mesh.matrixWorld.copy(saved);
    mesh.matrixWorldAutoUpdate = savedAuto;
  }
}

/**
 * Euler orientation for a projector whose +Z looks ALONG the surface normal and
 * whose +Y is the text's up.
 *
 * Built from an explicit orthonormal basis rather than `Object3D.lookAt`, which
 * silently uses its own up vector and has no way to express "this text is
 * rotated 30 degrees around the surface normal" — a slot on the side of a cap
 * needs exactly that.
 */
function projectorEuler(normal: THREE.Vector3, up: THREE.Vector3): THREE.Euler {
  const z = normal.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-12) {
    // Parallel up and normal. assetTemplate.orthogonalUp already prevents this
    // for a validated template; a caller passing raw vectors still gets a basis
    // instead of a NaN matrix that produces zero triangles and no error.
    x.set(1, 0, 0).cross(z);
    if (x.lengthSq() < 1e-12) x.set(0, 1, 0).cross(z);
  }
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export interface BuiltLabelDecal {
  mesh: THREE.Mesh;
  /** Triangles the projector carved. 0 means the box missed the surface. */
  triangles: number;
  /** Wall-clock cost of the DecalGeometry carve, milliseconds. */
  buildMs: number;
  /** Frees geometry, material and both textures. Nothing else owns them. */
  dispose: () => void;
}

export interface LabelDecalOptions {
  text: string;
  style: GuestLetteringStyle;
  hex: string;
  /** Local model units per real-world centimetre, so `slot.maxWidthCm` lands at
   *  the size the author meant regardless of the GLB's export scale. */
  unitsPerCm: number;
}

/**
 * Carve one decal for `slot` out of `target` and return it, PARENTED to nothing
 * — the caller adds it to the mesh so it inherits the rig's transform.
 *
 * Returns null (never throws, never a half-built mesh) when there is nothing to
 * engrave or when the projector missed the surface entirely, which is the honest
 * outcome for a slot whose position no longer matches a re-exported model.
 */
export function buildLabelDecal(
  target: THREE.Mesh,
  slot: AssetTextSlot,
  opts: LabelDecalOptions,
): BuiltLabelDecal | null {
  if (!opts.text) return null;
  const textures = makeLabelTextures(opts.text, opts.style, opts.hex);
  if (!textures) return null;

  const position = new THREE.Vector3(...slot.position);
  const normal = new THREE.Vector3(...slot.normal);
  const up = new THREE.Vector3(...slot.up);
  const orientation = projectorEuler(normal, up);

  const unitsPerCm = Number.isFinite(opts.unitsPerCm) && opts.unitsPerCm > 0 ? opts.unitsPerCm : 1;
  const width = slot.maxWidthCm * unitsPerCm;
  const size = new THREE.Vector3(width, width / textures.aspect, slot.decalDepth);

  let geometry: THREE.BufferGeometry;
  const started = performance.now();
  try {
    geometry = withRestPose(target, () => new DecalGeometry(target, position, orientation, size));
  } catch (e) {
    console.warn('[assetDecal] projection failed', e);
    textures.dispose();
    return null;
  }
  const buildMs = performance.now() - started;

  const triangles = (geometry.attributes.position?.count ?? 0) / 3;
  if (triangles < 1) {
    // The box did not intersect the mesh. A zero-triangle decal draws nothing
    // but still costs a material, a draw call and two textures.
    geometry.dispose();
    textures.dispose();
    return null;
  }

  const material = new THREE.MeshStandardMaterial({
    map: textures.map,
    normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(1.4, 1.4),
    transparent: true,
    // The decal shares a surface with the mesh it was carved from, so its
    // fragments are at EXACTLY the host's depth. Without the offset the two
    // fight for the depth test and the name flickers as the camera moves;
    // without depthWrite:false the transparent margin punches a hole in
    // anything drawn after it.
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -1,
    roughness: 0.62,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'beamwall-label-decal';
  // Renders after the opaque body it sits on, whatever order the graph is
  // traversed in.
  mesh.renderOrder = 1;
  mesh.userData.beamwallDecal = { slotId: slot.id, text: opts.text };

  return {
    mesh,
    triangles,
    buildMs,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      textures.dispose();
    },
  };
}

/* ── model-level convenience ──────────────────────────────────────────────── */

/** The biggest mesh in a loaded scene — the body, not a stray helper. */
export function largestMesh(root: THREE.Object3D): THREE.Mesh | null {
  let best: THREE.Mesh | null = null;
  let bestCount = -1;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const count = obj.geometry?.attributes?.position?.count ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = obj;
    }
  });
  return best;
}

/**
 * MESH-LOCAL model units per centimetre, derived from the target mesh's own
 * geometry and the template's authored real-world size.
 *
 * A GLB may be exported in metres, centimetres or "whatever Blender had open",
 * so a slot width authored as "9 cm" means nothing until it is measured against
 * the asset itself. Falls back to 1 rather than 0 or Infinity for a degenerate
 * box — a wrongly-sized name is recoverable, a NaN transform is not.
 *
 * Measured from `geometry.boundingBox`, NOT `Box3.setFromObject`, and the
 * difference is the whole bug it fixes: `setFromObject` reads `matrixWorld`,
 * which in the booth carries the head rig's centimetre scale (and, before the
 * first render, no scale at all — a race). The decal is carved in the MESH'S
 * OWN rest-pose space (`withRestPose` identities the world matrix), so the
 * conversion must be measured in that same space. With the world box, an "8 cm"
 * line computed against a head-rig-scaled cap landed at several times the size
 * of the whole model — giant sheared letter fragments instead of a name.
 * Because the finished decal is PARENTED to the mesh, it inherits the fit
 * scale, the gizmo and the per-frame pose with no further conversion: the
 * engraving stays the same fraction of the piece at every host scale.
 */
export function unitsPerCm(mesh: THREE.Mesh, fitCm: number): number {
  const geometry = mesh.geometry;
  if (!geometry) return 1;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) return 1;
  const size = box.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest <= 0 || !Number.isFinite(fitCm) || fitCm <= 0) return 1;
  return largest / fitCm;
}

/**
 * Resolve a customization's label against a template and attach the decal to
 * the model's main mesh.
 *
 * Every "nothing to do" path returns null BEFORE any allocation: no label, an
 * empty guest name, a slot id that no longer exists, no mesh. That is the
 * legacy guarantee at this layer — an asset with no label is not merely drawn
 * the same, it allocates nothing and adds no child to the scene graph.
 */
export async function attachLabelDecal(
  root: THREE.Object3D,
  template: AssetTemplate,
  customization: AssetCustomization | null | undefined,
  guestName: string,
): Promise<BuiltLabelDecal | null> {
  const label: AssetLabelConfig | undefined = customization?.label;
  if (!label) return null;
  const text = resolveLabelText(label, guestName);
  if (!text) return null;
  const slot = template.textSlots.find((s) => s.id === label.slotId);
  if (!slot) return null;
  const target = largestMesh(root);
  if (!target) return null;

  await warmLabelFont(label.style);

  const built = buildLabelDecal(target, slot, {
    text,
    style: label.style,
    hex: label.hex,
    unitsPerCm: unitsPerCm(target, template.fitCm),
  });
  if (!built) return null;
  // Parented to the MESH the decal was carved from, in that mesh's own local
  // space (see withRestPose), so it inherits every transform above it forever.
  target.add(built.mesh);
  return {
    ...built,
    dispose: () => {
      built.mesh.removeFromParent();
      built.dispose();
    },
  };
}
