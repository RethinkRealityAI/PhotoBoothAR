/**
 * Capture + compositing logic.
 * Composites at 1080×1920 following FOUNDATION order:
 *  1. Mirrored video (cover-fit)
 *  2. Shader canvas (via ShaderRunner at full res)
 *  3. Three.js (R3F) canvas if present
 *  4. 2D overlay/border with its Transform2D
 *
 * Returns a JPEG dataURL.
 */
import { ShaderRunner, defaultParams } from '../../lib/shaders';
import { Transform2D } from '../../types';

const TARGET_W = 1080;
const TARGET_H = 1920;

export interface CaptureInput {
  video: HTMLVideoElement;
  shaderId: string;
  shaderAvailable: boolean;
  /** The R3F canvas element (if a 3D experience is active) */
  threeCanvas?: HTMLCanvasElement | null;
  /** 2D overlay asset URL and its transform */
  overlay?: { url: string; transform: Transform2D; opacity?: number } | null;
}

/**
 * Cover-fit drawImage: fills dest canvas with src maintaining aspect ratio (centered).
 */
export function coverFit(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
) {
  const srcAspect = srcW / srcH;
  const destAspect = destW / destH;

  let sw = srcW, sh = srcH, sx = 0, sy = 0;
  if (srcAspect > destAspect) {
    // src wider than dest → crop sides
    sw = srcH * destAspect;
    sx = (srcW - sw) / 2;
  } else {
    // src taller → crop top/bottom
    sh = srcW / destAspect;
    sy = (srcH - sh) / 2;
  }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, destW, destH);
}

export async function compositeCapture(input: CaptureInput): Promise<string> {
  const { video, shaderId, shaderAvailable, threeCanvas, overlay } = input;

  const canvas = document.createElement('canvas');
  canvas.width = TARGET_W;
  canvas.height = TARGET_H;
  const ctx = canvas.getContext('2d')!;

  const vw = video.videoWidth || TARGET_W;
  const vh = video.videoHeight || TARGET_H;

  // ── Step 1: Mirrored video ──────────────────────────────────────────
  ctx.save();
  ctx.translate(TARGET_W, 0);
  ctx.scale(-1, 1);
  coverFit(ctx, video, vw, vh, TARGET_W, TARGET_H);
  ctx.restore();

  // ── Step 2: Shader ──────────────────────────────────────────────────
  if (shaderAvailable && shaderId !== 'none') {
    try {
      const runner = new ShaderRunner(TARGET_W, TARGET_H);
      if (runner.available) {
        const params = defaultParams(shaderId);
        // Draw unflipped video into runner (we'll mirror when drawing to composite)
        const result = runner.draw(video, shaderId, params, false);
        if (result) {
          // Draw shaded output (mirrored) over the raw video
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.translate(TARGET_W, 0);
          ctx.scale(-1, 1);
          coverFit(ctx, result, TARGET_W, TARGET_H, TARGET_W, TARGET_H);
          ctx.restore();
        }
        runner.dispose();
      }
    } catch (e) {
      console.warn('[capture] shader step failed', e);
    }
  }

  // ── Step 3: 3D (Three.js) canvas ────────────────────────────────────
  if (threeCanvas && threeCanvas.width > 0) {
    try {
      ctx.drawImage(threeCanvas, 0, 0, TARGET_W, TARGET_H);
    } catch (e) {
      console.warn('[capture] 3D canvas step failed', e);
    }
  }

  // ── Step 4: 2D overlay / border ──────────────────────────────────────
  if (overlay?.url) {
    try {
      const img = await loadImage(overlay.url);
      const { scale, x, y, rotation } = overlay.transform;
      const opacity = overlay.opacity ?? 1;
      ctx.save();
      ctx.globalAlpha = opacity;
      // x,y are % of frame; center, then offset
      const cx = TARGET_W / 2 + (x / 100) * TARGET_W;
      const cy = TARGET_H / 2 + (y / 100) * TARGET_H;
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -TARGET_W / 2, -TARGET_H / 2, TARGET_W, TARGET_H);
      ctx.restore();
    } catch (e) {
      console.warn('[capture] overlay step failed', e);
    }
  }

  // ── Step 5: Branded gold signature (every photo carries the gala mark) ──
  drawSignature(ctx, TARGET_W, TARGET_H);

  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Elegant gold "Hope Gala 2026" signature centered near the bottom edge. */
export function drawSignature(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const y = h - 52;
  ctx.font = 'italic 600 42px Georgia, "Times New Roman", serif';
  const grad = ctx.createLinearGradient(w / 2 - 240, 0, w / 2 + 240, 0);
  grad.addColorStop(0, '#B8860B');
  grad.addColorStop(0.5, '#FBF3D9');
  grad.addColorStop(1, '#B8860B');
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.95;
  ctx.fillText('Hope Gala 2026', w / 2, y);
  // small flanking flourishes
  ctx.font = '24px Georgia, serif';
  ctx.fillText('✦', w / 2 - 180, y - 4);
  ctx.fillText('✦', w / 2 + 180, y - 4);
  ctx.restore();
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)![1];
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ------------------------------------------------------------------ */
/* Static-image upload compositing (guest "Upload to Wall" flow)       */
/* ------------------------------------------------------------------ */

/** Pan/zoom crop of an uploaded image inside a fixed frame. */
export interface UploadCrop {
  zoom: number;     // 1 = cover-fit, >1 zooms in
  offsetX: number;  // pan, fraction of frame width  (-1..1)
  offsetY: number;  // pan, fraction of frame height (-1..1)
  rotation: number; // degrees
}

export const DEFAULT_CROP: UploadCrop = { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 };

export interface Rect { x: number; y: number; w: number; h: number; }

/**
 * Pure crop-rect math (no canvas) so it can be unit-tested. Returns the dest
 * rectangle to draw the source image into, starting from a cover-fit then
 * applying zoom (about centre) and a fractional pan. Centred + cover-fit at
 * zoom=1, offset=0 → exactly fills destW×destH.
 *
 * `rotation` (degrees) is rotation-aware for quarter turns: at 90°/270° the
 * image's footprint is its own dimensions swapped, so the cover scale is
 * computed from the swapped dims — a rotated photo still fills the frame with
 * no blank wedges. The returned rect stays in the image's own (unrotated)
 * coordinate space; callers rotate about its centre.
 */
export function computeCropRect(
  imgW: number,
  imgH: number,
  destW: number,
  destH: number,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
  rotation = 0,
): Rect {
  // Footprint dims after rotation (only quarter turns change the cover fit).
  const quarterTurned = ((Math.round(rotation / 90) % 2) + 2) % 2 === 1;
  const coverW = quarterTurned ? imgH : imgW;
  const coverH = quarterTurned ? imgW : imgH;
  const base = Math.max(destW / coverW, destH / coverH); // cover (rotation-aware)
  const scale = base * Math.max(zoom, 0.01);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = (destW - w) / 2 + offsetX * destW;
  const y = (destH - h) / 2 + offsetY * destH;
  return { x, y, w, h };
}

/** Frame compositing target — matches booth capture + frame SVG viewBox. */
export const FRAME_W = 1080;
export const FRAME_H = 1920;

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob(
        (b) => resolve(b ?? dataUrlToBlob(canvas.toDataURL(type, quality))),
        type,
        quality,
      );
    } else {
      resolve(dataUrlToBlob(canvas.toDataURL(type, quality)));
    }
  });
}

export interface CompositeUploadInput {
  srcUrl: string;
  /** Frame overlay (SVG/PNG data or public URL). Null/omitted → no frame. */
  frameUrl?: string | null;
  crop?: UploadCrop;
  /** Bake the gold gala signature (default: only when a frame is applied). */
  applySignature?: boolean;
  /** Source MIME type — lets no-frame PNGs keep transparency (else JPEG). */
  srcType?: string;
}

export interface CompositeUploadResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Composite an uploaded still image for the wall.
 *  • With a frame → 1080×1920, image cover-fit + pan/zoom crop, frame overlaid,
 *    gold signature baked in (consistent with booth captures).
 *  • Without a frame → keep the image's native aspect (longest side capped),
 *    no crop, no signature (a clean upload).
 */
export async function compositeUpload(input: CompositeUploadInput): Promise<CompositeUploadResult> {
  const img = await loadImage(input.srcUrl);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  if (input.frameUrl) {
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext('2d')!;
    const crop = input.crop ?? DEFAULT_CROP;

    const r = computeCropRect(iw, ih, FRAME_W, FRAME_H, crop.zoom, crop.offsetX, crop.offsetY, crop.rotation);
    ctx.save();
    // Rotate about the image's own centre so this matches a CSS `rotate` preview.
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.translate(cx, cy);
    if (crop.rotation) ctx.rotate((crop.rotation * Math.PI) / 180);
    ctx.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h);
    ctx.restore();

    try {
      const frame = await loadImage(input.frameUrl);
      ctx.drawImage(frame, 0, 0, FRAME_W, FRAME_H);
    } catch (e) {
      console.warn('[compositeUpload] frame overlay failed', e);
    }

    if (input.applySignature !== false) drawSignature(ctx, FRAME_W, FRAME_H);

    const blob = await canvasToBlob(canvas);
    return { blob, width: FRAME_W, height: FRAME_H };
  }

  // No frame → preserve aspect ratio, cap the longest side.
  const MAX = 1600;
  let w = iw;
  let h = ih;
  const longest = Math.max(w, h);
  if (longest > MAX) {
    const s = MAX / longest;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w || FRAME_W;
  canvas.height = h || FRAME_H;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (input.applySignature === true) drawSignature(ctx, canvas.width, canvas.height);
  // Keep PNGs as PNG so transparent uploads don't get a black background.
  const isPng = /png/i.test(input.srcType ?? '');
  const blob = await canvasToBlob(canvas, isPng ? 'image/png' : 'image/jpeg');
  return { blob, width: canvas.width, height: canvas.height };
}
