/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Textures for the carousel's cards — small, and video-capable.
 *
 * TWO PROBLEMS, ONE LOADER.
 *
 * SIZE. Every card on the ring is a GPU texture, and a booth capture is
 * 1080×1920 — which is 8.3 MB of VRAM decoded, ~11 MB with mipmaps. A ring
 * wide enough to fill a projector holds around thirty of them, so loading the
 * originals would ask a venue laptop for a third of a gigabyte to display
 * photos that are never more than ~400 px wide on screen. Downscaling on the
 * way in costs one draw call per photo and takes that to roughly 75 MB.
 *
 * VIDEO. A video post's `image_url` IS the clip; handing it to a texture
 * loader gets you nothing, which is why the ring used to drop videos entirely
 * — and a dropped video has no card, so the arrival beam had nowhere to land
 * and a guest's clip just vanished into the middle of the screen. Here a clip
 * is seeked a hair past zero and that frame becomes the card, exactly as
 * ArrivalBeam already does when it composes a ceremony. It is a still, on
 * purpose: a wall that ran thirty simultaneous decoders would not survive the
 * night, and the mosaic remains the mode that plays clips.
 *
 * Everything is cached by URL and evicted least-recently-used, because a
 * six-hour wall cycles through hundreds of photos and a Map that only grows is
 * the same leak in a slower disguise.
 */
import * as THREE from 'three';
import { transformedUrl } from '../../lib/mediaUrl';

/** Longest edge we upload. A hero card is ~400 css px; this covers 2× DPR. */
const MAX_TEXTURE_WIDTH = 512;
/** Give up rather than hold a ceremony's worth of memory on a stalled fetch. */
const LOAD_TIMEOUT_MS = 8000;
/** Roughly one ring's worth plus a margin for what just scrolled out of it. */
const CACHE_LIMIT = 48;

export type CardMedia = 'photo' | 'video';

const cache = new Map<string, Promise<THREE.Texture | null>>();

/** Evict oldest-first. Map preserves insertion order, which is the LRU list. */
function evictIfFull(): void {
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    // The texture may still be in flight; dispose whatever it settles into.
    void entry?.then((t) => t?.dispose());
  }
}

/** Fit into a box of MAX_TEXTURE_WIDTH on the long edge, never upscaling. */
function targetSize(w: number, h: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= MAX_TEXTURE_WIDTH || long === 0) return { w: Math.max(1, w), h: Math.max(1, h) };
  const k = MAX_TEXTURE_WIDTH / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Downscale anything drawable to a texture.
 *
 * `createImageBitmap` is preferred because the bitmap can be handed straight
 * to the GPU and closed, where a canvas stays resident in system memory for as
 * long as the texture references it. It is not universal, so the canvas is
 * kept as the fallback rather than the plan.
 */
async function toTexture(
  source: CanvasImageSource, width: number, height: number,
): Promise<THREE.Texture> {
  const size = targetSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size.w, size.h);

  let texture: THREE.Texture;
  if (typeof createImageBitmap === 'function') {
    // `imageOrientation: 'flipY'` is not decoration. three uploads ordinary
    // images with UNPACK_FLIP_Y_WEBGL so the first row lands at the TOP of the
    // texture, but that flag is ignored for an ImageBitmap — so a bitmap taken
    // as-is renders every photo upside down. Pre-flipping the bitmap puts the
    // rows where the rest of the pipeline already expects them.
    const bitmap = await createImageBitmap(canvas, { imageOrientation: 'flipY' });
    texture = new THREE.Texture(bitmap);
  } else {
    texture = new THREE.CanvasTexture(canvas);
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A play glyph drawn INTO the poster, not composited at render time.
 *
 * A still frame of a video is indistinguishable from a photo, and on a wall
 * that matters: a guest looking for the clip they just recorded should be able
 * to see which card is theirs. Baking it costs nothing per frame and needs no
 * second mesh inside the ring.
 */
function drawPlayGlyph(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = Math.max(14, Math.min(w, h) * 0.11);
  const cx = w / 2;
  const cy = h / 2;
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = 'rgba(8,6,12,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, cy - r * 0.45);
  ctx.lineTo(cx + r * 0.5, cy);
  ctx.lineTo(cx - r * 0.3, cy + r * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function loadPhoto(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    // Ask the storage layer for a small copy when it can serve one. It refuses
    // (returns null) for anything it does not recognise, and if the resize
    // endpoint is not enabled on the project the load simply fails and we
    // retry the original — being wrong costs one request, never a blank card.
    const small = transformedUrl(url, { width: MAX_TEXTURE_WIDTH, quality: 78 });
    let triedOriginal = small === null;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);

    img.onload = () => {
      clearTimeout(timer);
      void toTexture(img, img.naturalWidth, img.naturalHeight)
        .then(resolve)
        .catch(() => resolve(null));
    };
    img.onerror = () => {
      if (!triedOriginal) {
        triedOriginal = true;
        img.src = url;
        return;
      }
      clearTimeout(timer);
      resolve(null);
    };
    img.src = small ?? url;
  });
}

function loadVideoPoster(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let settled = false;
    const finish = (t: THREE.Texture | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Release the decoder as soon as we have the frame: a wall that leaves
      // one element per clip alive runs out of hardware decoders by midnight.
      video.removeAttribute('src');
      video.load();
      resolve(t);
    };
    const timer = setTimeout(() => finish(null), LOAD_TIMEOUT_MS);

    const grab = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w === 0 || h === 0) { finish(null); return; }
      const size = targetSize(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext('2d');
      if (ctx === null) { finish(null); return; }
      ctx.drawImage(video, 0, 0, size.w, size.h);
      drawPlayGlyph(ctx, size.w, size.h);
      void toTexture(canvas, size.w, size.h).then(finish).catch(() => finish(null));
    };

    video.onerror = () => finish(null);
    video.onseeked = grab;
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.1, (video.duration || 1) / 4);
      } catch {
        grab(); // seeking unsupported — frame 0 is already decoded
      }
    };
    video.src = url;
  });
}

/**
 * The texture for one card, cached. Null means "this one cannot be shown" —
 * callers render no card rather than a black rectangle.
 */
export function cardTexture(url: string, media: CardMedia): Promise<THREE.Texture | null> {
  const key = `${media}:${url}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Re-insert so the live ring stays at the young end of the LRU.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = (media === 'video' ? loadVideoPoster(url) : loadPhoto(url))
    .catch(() => null);
  cache.set(key, pending);
  evictIfFull();
  return pending;
}

/** Test seam: forget everything (and free it). */
export function clearCardTextureCache(): void {
  for (const entry of cache.values()) void entry.then((t) => t?.dispose());
  cache.clear();
}
