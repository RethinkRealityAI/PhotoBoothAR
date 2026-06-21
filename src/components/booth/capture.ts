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
function coverFit(
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
function drawSignature(ctx: CanvasRenderingContext2D, w: number, h: number) {
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

function loadImage(url: string): Promise<HTMLImageElement> {
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
