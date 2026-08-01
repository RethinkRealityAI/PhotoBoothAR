/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * chromaKey — pure, DOM-free chroma-key + contain-fit for AI-generated frames
 * and stickers. Gemini paints the frame's centre and background a solid pure
 * green (#00FF00); these functions key that green out to transparency and pad
 * the art onto the booth's 1080×1920 portrait capture buffer.
 *
 * Everything here operates on plain {data, width, height} buffers (the shape of
 * a browser ImageData, but with no DOM types) so the whole module is unit-
 * testable in the vitest `node` env. The browser glue that loads the image,
 * runs these, and re-uploads the PNG lives in AiFramePanel.tsx.
 *
 * Distance metric — YCbCr *chroma* distance (Cb/Cr only), not RGB Euclidean:
 * chroma is luminance-invariant, so green highlights and green shadows on the
 * backdrop key out uniformly. RGB distance would leave a dark-green fringe
 * wherever the green was shaded. A soft band above the hard tolerance ramps
 * alpha linearly (anti-jag), and semi-transparent edge pixels are despilled
 * (green channel clamped to max(R,B)) to kill the green halo.
 */

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Pure chroma-key green — the colour the edge function tells Gemini to paint. */
export const DEFAULT_KEY: readonly [number, number, number] = [0, 255, 0];
/** Chroma distance at/under which a pixel is fully keyed (transparent). */
export const DEFAULT_TOLERANCE = 40;
/** Width of the soft ramp above the tolerance where alpha fades 0→255. */
export const DEFAULT_SOFTNESS = 25;

/** Booth capture size (StageCanvas CAPTURE_W × CAPTURE_H) — portrait 9:16. */
export const FRAME_W = 1080;
export const FRAME_H = 1920;

export interface KeyOutOptions {
  key?: readonly [number, number, number];
  tolerance?: number;
  softness?: number;
}

/**
 * Least fraction of a source image that must key out before the result is
 * believed. Under this, the key never matched the real backdrop and the asset is
 * still effectively the raw GREEN image.
 *
 * Trade-off (unchanged from the inline constant this replaces): thin-border /
 * sliver-green art keys out only a few percent, so 0.015 (was 0.03) avoids false
 * "unkeyed" rejects of legit frames; a real greenScreen output is
 * green-DOMINANT, so 1.5% still catches a total key miss.
 *
 * Exported so frameProcessing.ts uses THIS number rather than its own copy —
 * two thresholds for one decision drift the moment either is tuned.
 */
export const MIN_KEYED_FRACTION = 0.015;

/**
 * Does this generated asset still need chroma-keying at all?
 *
 * `hasAlpha` true short-circuits to false: a provider that returned GENUINE
 * transparency (a Higgsfield marketplace-app import, a remove_background
 * output) has already delivered the artefact the keyer exists to produce.
 * Running the keyer on it would punch holes wherever the art is green, and —
 * worse — the keyedFraction gate would REJECT it, because there is no green
 * backdrop left to remove. The best inputs would have been the ones thrown away.
 *
 * Otherwise the honesty gate applies: only a key that removed at least
 * MIN_KEYED_FRACTION of the image actually found a backdrop.
 */
export function needsChromaKey(hasAlpha: boolean, keyedFraction: number): boolean {
  if (hasAlpha) return false;
  return keyedFraction >= MIN_KEYED_FRACTION;
}

/**
 * Is this asset ALREADY the transparent artefact the keyer exists to produce?
 *
 * Three inputs, because the first two lie in opposite directions:
 *   • `transparentFlag` — `config.transparent`, an IHDR COLOUR-TYPE probe
 *     (ai-generate-image / import-asset, mirrored by {@link bytesLookAlpha}).
 *     It proves an alpha CHANNEL exists, never that one pixel is actually
 *     transparent — a fully-opaque RGBA PNG is legal, and encoders emit them.
 *   • `greenScreenFlag` — `config.greenScreen`, stamped when the asset was
 *     generated ONTO a chroma-key backdrop. Such an asset must ALWAYS be keyed
 *     whatever its colour type; skipping places raw green over the guest.
 *   • `img` — the decoded pixels, which are ground truth and outrank both
 *     flags, so even a mis-stamped row cannot get past this.
 *
 * All three must agree before keying is skipped. Erring towards keying is the
 * safe direction: the worst case is the honesty gate rejecting the asset and
 * offering a free retry, versus shipping a green box into a live booth.
 */
export function hasGenuineAlpha(
  transparentFlag: boolean,
  greenScreenFlag: boolean,
  img: RgbaImage,
): boolean {
  if (!transparentFlag || greenScreenFlag) return false;
  const { data } = img;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Probe PNG bytes for a colour type that CARRIES an alpha channel (4 =
 * grey+alpha, 6 = RGBA). Cheap and allocation-free: the answer is one byte of
 * the IHDR header, so nothing is decoded.
 *
 * MIRROR of `pngHasAlpha` in supabase/functions/ai-generate-image/index.ts —
 * same signature check, same offsets, same two colour types. Edge functions
 * cannot import from src/, so the maths is duplicated deliberately; change one,
 * change the other.
 *
 * "Look" is the honest verb: colour type 6 proves an alpha CHANNEL exists, not
 * that any pixel is actually transparent (a fully-opaque RGBA PNG is legal).
 * A false negative is the safe direction — it just means the keyer runs.
 */
export function bytesLookAlpha(png: Uint8Array | ArrayBuffer): boolean {
  const bytes = png instanceof Uint8Array ? png : new Uint8Array(png);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 26) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
  // First chunk must be IHDR ("IHDR" at offset 12); color type is IHDR byte 9
  // (offset 25 = 8 sig + 4 length + 4 type + 4 width + 4 height + 1 bit depth).
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return false;
  }
  const colorType = bytes[25];
  return colorType === 4 || colorType === 6;
}

/** Rec.601 chroma components (signed, centred on 0). Luminance is discarded. */
function chromaCbCr(r: number, g: number, b: number): [number, number] {
  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
  return [cb, cr];
}

export interface KeyOutStats {
  /** The keyed buffer (same shape as input; the input is never mutated). */
  image: RgbaImage;
  /**
   * Fraction of pixels driven to alpha 0 (keepFactor === 0 — the hard-keyed
   * backdrop) over the total pixel count. AiFramePanel uses this as an honesty
   * gate: a key that removed almost nothing never matched the real backdrop,
   * so the asset is still effectively the raw green image.
   */
  keyedFraction: number;
}

/**
 * Like {@link keyOutColor} but also reports what fraction of the image was
 * fully keyed. The pixel maths is identical — keyOutColor delegates here — so
 * the keyedFraction bookkeeping never changes an output pixel.
 */
export function keyOutColorWithStats(img: RgbaImage, opts: KeyOutOptions = {}): KeyOutStats {
  const key = opts.key ?? DEFAULT_KEY;
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  const softness = opts.softness ?? DEFAULT_SOFTNESS;
  const [kcb, kcr] = chromaCbCr(key[0], key[1], key[2]);

  const src = img.data;
  const out = new Uint8ClampedArray(src.length);
  out.set(src);

  const total = src.length / 4;
  let keyedCount = 0;

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    const a = src[i + 3];
    const [cb, cr] = chromaCbCr(r, g, b);
    const dist = Math.hypot(cb - kcb, cr - kcr);

    // 0 = fully keyed (transparent), 1 = fully kept (opaque).
    let keepFactor: number;
    if (dist <= tolerance) keepFactor = 0;
    else if (dist >= tolerance + softness) keepFactor = 1;
    else keepFactor = (dist - tolerance) / softness; // softness > 0 guaranteed here

    const newAlpha = Math.round(a * keepFactor);
    out[i + 3] = newAlpha;

    if (keepFactor === 0) {
      // Fully keyed: neutralize the RGB too. Leaving the original green behind
      // alpha 0 poisons any later straight-alpha resampling (the fit's bilinear
      // would blend it into edge pixels as an olive fringe).
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      keyedCount++;
    } else if (keepFactor < 1) {
      // Despill only pixels the KEY partially ate (soft band) — gating on the
      // key factor, not the final alpha, so pre-existing semi-transparent
      // green-ish content far from the key is never desaturated.
      const cap = Math.max(r, b);
      if (g > cap) out[i + 1] = cap;
    }
  }

  return {
    image: { data: out, width: img.width, height: img.height },
    keyedFraction: total > 0 ? keyedCount / total : 0,
  };
}

/**
 * Return a NEW same-shape buffer with pixels matching `key` made transparent.
 * Input is never mutated. Fully-keyed pixels get alpha 0; pixels in the soft
 * band get a partial alpha and are despilled; pixels far from the key are
 * untouched (rgb + original alpha preserved).
 */
export function keyOutColor(img: RgbaImage, opts: KeyOutOptions = {}): RgbaImage {
  return keyOutColorWithStats(img, opts).image;
}

/**
 * Centre `img` onto a transparent targetW×targetH buffer using CONTAIN scaling
 * (never crops — frame art at the edges must survive). Bilinear resampling
 * (straight alpha, edge-clamped); the padding around the scaled art stays fully
 * transparent (0,0,0,0). The sampling loop is inlined and allocation-free —
 * it runs over ~1M+ pixels per frame in the browser.
 */
export function fitOnCanvas(img: RgbaImage, targetW: number, targetH: number): RgbaImage {
  const out = new Uint8ClampedArray(targetW * targetH * 4); // zero-filled → transparent

  if (img.width <= 0 || img.height <= 0) {
    return { data: out, width: targetW, height: targetH };
  }

  const src = img.data;
  const sw = img.width;
  const sh = img.height;
  const sw1 = sw - 1;
  const sh1 = sh - 1;
  const scale = Math.min(targetW / sw, targetH / sh);
  const drawW = Math.max(1, Math.round(sw * scale));
  const drawH = Math.max(1, Math.round(sh * scale));
  const offX = Math.floor((targetW - drawW) / 2);
  const offY = Math.floor((targetH - drawH) / 2);

  for (let dy = 0; dy < drawH; dy++) {
    // Map dest-pixel centre back to source space, then edge-clamp.
    const sy = (dy + 0.5) / scale - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const cy0 = y0 < 0 ? 0 : y0 > sh1 ? sh1 : y0;
    const y1 = y0 + 1 < 0 ? 0 : y0 + 1 > sh1 ? sh1 : y0 + 1;
    const rowTop = cy0 * sw;
    const rowBot = y1 * sw;
    const destRow = (offY + dy) * targetW + offX;

    for (let dx = 0; dx < drawW; dx++) {
      const sx = (dx + 0.5) / scale - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const cx0 = x0 < 0 ? 0 : x0 > sw1 ? sw1 : x0;
      const x1 = x0 + 1 < 0 ? 0 : x0 + 1 > sw1 ? sw1 : x0 + 1;

      const i00 = (rowTop + cx0) * 4;
      const i10 = (rowTop + x1) * 4;
      const i01 = (rowBot + cx0) * 4;
      const i11 = (rowBot + x1) * 4;
      const di = (destRow + dx) * 4;

      // PREMULTIPLIED bilinear: weight each corner's color by its alpha, then
      // divide the blended alpha back out. Straight-alpha interpolation would
      // let transparent neighbours' RGB bleed into edge pixels (green fringe).
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const a00 = src[i00 + 3];
      const a10 = src[i10 + 3];
      const a01 = src[i01 + 3];
      const a11 = src[i11 + 3];
      const outA = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
      if (outA <= 0) {
        // Fully transparent — leave the zero-filled (0,0,0,0) pixel.
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const pm =
          src[i00 + c] * a00 * w00 +
          src[i10 + c] * a10 * w10 +
          src[i01 + c] * a01 * w01 +
          src[i11 + c] * a11 * w11;
        out[di + c] = pm / outA;
      }
      out[di + 3] = outA;
    }
  }

  return { data: out, width: targetW, height: targetH };
}

/**
 * Detect the dominant green backdrop hue in a generated frame/sticker so the
 * keyer can target the ACTUAL colour Gemini painted — image models rarely emit
 * exact #00FF00 (e.g. #00B140 sits ~64 chroma units from pure green and the
 * fixed key kept it, shipping green into the scene).
 *
 * The layouts the edge fn produces hide their backdrop in different places:
 *   • frames  (kind 'border')  — art hugs the edges; green fills the CENTRE + bg
 *   • stickers (2d_filter)     — the subject is centred; green SURROUNDS it
 *   • scene frames (FrameLayout full-scene / duo-scene) — art edge to edge with
 *     head cutouts punched ANYWHERE, including between those two regions
 * so we sample a centre patch (catches a frame's green) plus a perimeter ring
 * and the four corners (catch a sticker's green), UNIONED with a sparse
 * full-canvas grid (catches a cutout that sits in neither) at a sparse stride.
 * Green-family samples are histogrammed into coarse (Cb,Cr) bins; the densest
 * bin + its 8 neighbours give the mean RGB returned as the key.
 *
 * Returns null when green-family samples are under 1% of those visited — the
 * caller falls back to DEFAULT_KEY (and the keyedFraction gate downstream
 * catches a genuinely green-free image).
 */
export function detectKeyColor(
  img: RgbaImage,
): { key: [number, number, number]; samples: number } | null {
  const { data, width: w, height: h } = img;
  if (w <= 0 || h <= 0) return null;

  const STRIDE = 4; // sample every 4th px in x AND y → ~1/16 of pixels, O(n)
  const BIN = 6; // coarse (Cb,Cr) bin size, in chroma units
  // Sparse whole-canvas grid, UNIONED with the regions below. A multiple of
  // STRIDE on purpose: every grid point is already a point the loop visits, so
  // the union costs one modulo per sample and can never count a pixel twice
  // (double-counting would bias which (Cb,Cr) bin wins).
  const GRID_STRIDE = 8;

  // Region bounds (fractions of the image): a centre patch + an edge ring +
  // corner patches. Their union holds the backdrop in either layout.
  const cxLo = w * 0.35, cxHi = w * 0.65, cyLo = h * 0.35, cyHi = h * 0.65;
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.12));
  const corner = Math.max(1, Math.round(Math.min(w, h) * 0.15));

  // bk packs the (Cb,Cr) bins into one int; +64 keeps both bytes non-negative
  // (chroma bins span roughly ±22, so shifted values stay in [42,86] < 256).
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let visited = 0;
  let greenish = 0;

  for (let y = 0; y < h; y += STRIDE) {
    const inRingY = y < ring || y >= h - ring;
    const inCornerY = y < corner || y >= h - corner;
    const inCenterY = y >= cyLo && y < cyHi;
    const onGridY = y % GRID_STRIDE === 0;
    for (let x = 0; x < w; x += STRIDE) {
      const inRing = inRingY || x < ring || x >= w - ring;
      const inCorner = inCornerY && (x < corner || x >= w - corner);
      const inCenter = inCenterY && x >= cxLo && x < cxHi;
      const onGrid = onGridY && x % GRID_STRIDE === 0;
      if (!inRing && !inCorner && !inCenter && !onGrid) continue;

      visited++;
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Green-family = clearly green-dominant; skips greys and the subject.
      if (!(g > r + 20 && g > b + 20)) continue;
      greenish++;

      const [cb, cr] = chromaCbCr(r, g, b);
      const bk = (Math.floor(cb / BIN) + 64) * 256 + (Math.floor(cr / BIN) + 64);
      const cell = bins.get(bk);
      if (cell) { cell.n++; cell.r += r; cell.g += g; cell.b += b; }
      else bins.set(bk, { n: 1, r, g, b });
    }
  }

  // Too little green sampled → no detectable backdrop.
  if (visited === 0 || greenish < visited * 0.01) return null;

  let bestN = -1;
  let bestKey = -1;
  for (const [bk, cell] of bins) {
    if (cell.n > bestN) { bestN = cell.n; bestKey = bk; }
  }
  if (bestKey < 0) return null;

  // Mean RGB over the densest bin + its 8 (Cb,Cr) neighbours.
  const bCb = Math.floor(bestKey / 256);
  const bCr = bestKey % 256;
  let n = 0, sr = 0, sg = 0, sb = 0;
  for (let dCb = -1; dCb <= 1; dCb++) {
    for (let dCr = -1; dCr <= 1; dCr++) {
      const cell = bins.get((bCb + dCb) * 256 + (bCr + dCr));
      if (cell) { n += cell.n; sr += cell.r; sg += cell.g; sb += cell.b; }
    }
  }
  if (n === 0) return null;
  return { key: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)], samples: n };
}

export interface ProcessedFrame {
  /** Green keyed out + contain-fit onto the 1080×1920 portrait canvas. */
  image: RgbaImage;
  /** Fraction of the SOURCE image hard-keyed (see keyOutColorWithStats). */
  keyedFraction: number;
  /** The key colour actually used (detected, or DEFAULT_KEY on fallback). */
  keyColor: readonly [number, number, number];
}

/**
 * Full pipeline for an AI frame/sticker: detect the backdrop's green hue (fall
 * back to DEFAULT_KEY), key it out, then contain-fit onto the booth's
 * transparent 1080×1920 portrait canvas. `keyedFraction` lets the caller reject
 * a key that removed almost nothing — the backdrop hue was never matched, so
 * the image is still green. An explicit keyOpts.key overrides detection.
 */
export function processFrameImage(
  img: RgbaImage,
  targetW: number = FRAME_W,
  targetH: number = FRAME_H,
  keyOpts: KeyOutOptions = {},
): ProcessedFrame {
  const keyColor = keyOpts.key ?? detectKeyColor(img)?.key ?? DEFAULT_KEY;
  const { image, keyedFraction } = keyOutColorWithStats(img, { ...keyOpts, key: keyColor });
  return { image: fitOnCanvas(image, targetW, targetH), keyedFraction, keyColor };
}
