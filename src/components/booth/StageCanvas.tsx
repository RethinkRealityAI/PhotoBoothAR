/**
 * Single composited "stage canvas" — the heart of the booth.
 *
 * Pipeline per frame (per FOUNDATION spec):
 *   1. Mirrored video (cover-fit) — mirror only for 'user' facing camera
 *   2. Effect shader via ShaderRunner (if effectId != 'none')
 *   3. R3F / Three.js canvas (3D attachments, if present)
 *   4. 2D border/overlay
 *   5. Gold "Hope Gala 2026" signature (always drawn at capture resolution)
 *
 * The same canvas is used for:
 *   • Live preview  (720×1280 @ rAF)
 *   • Photo capture (reads canvas → toDataURL at 1080×1920)
 *   • Video record  (canvas.captureStream)
 *
 * Exposed via ref:
 *   { canvas, capturePhoto, runner }
 */
import {
  useRef, useEffect, forwardRef, useImperativeHandle, useCallback,
} from 'react';
import { ShaderRunner, defaultParams } from '../../lib/shaders';
import { drawScagoMark } from '../../lib/scagoMark';
import { Transform2D } from '../../types';

export interface StageCanvasHandle {
  canvas: HTMLCanvasElement | null;
  runner: ShaderRunner | null;
  /** Snap a full-res 1080×1920 JPEG data-URL from the current frame. */
  capturePhoto: () => Promise<string>;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  effectId: string;           // shader id from FILTER_SHADERS or 'none'
  mirror: boolean;             // true for 'user' camera
  /** Independent additive sparkle layer — stacks with any effect + frame */
  sparkles?: boolean;
  /** Optional 2D overlay */
  overlayUrl?: string | null;
  overlayTransform?: Transform2D;
  overlayOpacity?: number;
  /** If present, drawn between shader and 2D overlay */
  threeCanvasId?: string | null; // DOM id of R3F canvas (inside #booth-3d-layer)
  active?: boolean;
}

const PREVIEW_W = 720;
const PREVIEW_H = 1280;
const CAPTURE_W = 1080;
const CAPTURE_H = 1920;

function coverFit(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcW: number, srcH: number,
  destW: number, destH: number,
) {
  const srcA = srcW / srcH;
  const dstA = destW / destH;
  let sw = srcW, sh = srcH, sx = 0, sy = 0;
  if (srcA > dstA) { sw = srcH * dstA; sx = (srcW - sw) / 2; }
  else { sh = srcW / dstA; sy = (srcH - sh) / 2; }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, destW, destH);
}

/** SCAGO-branded signature watermark: gold emblem + "Hope Gala & Awards 2026". */
function drawSignature(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const baseY = h - 58;
  const markSize = Math.round(w * 0.075);

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const title = 'Hope Gala & Awards';
  const titleSize = Math.round(w * 0.040);
  const eyebrowSize = Math.round(w * 0.020);
  ctx.font = `italic 600 ${titleSize}px Georgia, "Times New Roman", serif`;
  const titleW = ctx.measureText(title).width;

  // centre the [emblem + gap + text] lockup as a group
  const gap = w * 0.022;
  const groupW = markSize + gap + titleW;
  const startX = (w - groupW) / 2;

  // emblem
  const grad = ctx.createLinearGradient(startX, baseY - markSize / 2, startX + markSize, baseY + markSize / 2);
  grad.addColorStop(0, '#B8860B');
  grad.addColorStop(0.5, '#FBF3D9');
  grad.addColorStop(1, '#9A6F1C');
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 12;
  drawScagoMark(ctx, startX + markSize / 2, baseY, markSize, { fill: grad, alpha: 0.97 });

  // text block — SCAGO eyebrow ABOVE the Hope Gala & Awards title
  const textX = startX + markSize + gap;

  ctx.shadowBlur = 6;
  ctx.fillStyle = '#E9D9B8';
  ctx.globalAlpha = 0.9;
  ctx.font = `${eyebrowSize}px Georgia, serif`;
  drawTracked(ctx, 'SCAGO · 2026', textX + 2, baseY - titleSize * 0.5, eyebrowSize * 0.18);

  const textGrad = ctx.createLinearGradient(textX, 0, textX + titleW, 0);
  textGrad.addColorStop(0, '#E8C766');
  textGrad.addColorStop(0.5, '#FBF3D9');
  textGrad.addColorStop(1, '#C99A2E');
  ctx.fillStyle = textGrad;
  ctx.globalAlpha = 0.97;
  ctx.shadowBlur = 12;
  ctx.font = `italic 600 ${titleSize}px Georgia, "Times New Roman", serif`;
  ctx.fillText(title, textX, baseY + eyebrowSize * 0.7);

  ctx.restore();
}

/** Draws text with manual letter-spacing (for the small-caps eyebrow). */
function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

// Deterministic sparkle field (positions in 0..1 space) for the Sparkles effect.
const SPARKLES = (() => {
  let s = 1337;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: 46 }, () => ({
    x: rnd(), y: rnd(),
    size: 0.5 + rnd() * 1.0,
    speed: 0.6 + rnd() * 2.2,
    phase: rnd() * Math.PI * 2,
    warm: rnd(),
  }));
})();

/** Additive gold sparkle layer — independent of effects/frames so it stacks. */
function drawSparkles(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const unit = w / 1080;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const sp of SPARKLES) {
    const tw = 0.5 + 0.5 * Math.sin(t * sp.speed + sp.phase);
    const a = tw * tw; // sharper twinkle
    if (a < 0.04) continue;
    const px = sp.x * w;
    const py = sp.y * h;
    const r = sp.size * 9 * unit * (0.6 + tw * 0.6);
    const col = sp.warm > 0.5 ? '255,236,170' : '255,250,232';
    // soft core
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(0.4, `rgba(${col},${a * 0.35})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    // 4-point glint
    ctx.strokeStyle = `rgba(${col},${a * 0.9})`;
    ctx.lineWidth = 1.1 * unit;
    const gl = r * 2.1;
    ctx.beginPath();
    ctx.moveTo(px - gl, py); ctx.lineTo(px + gl, py);
    ctx.moveTo(px, py - gl); ctx.lineTo(px, py + gl);
    ctx.stroke();
  }
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

const StageCanvas = forwardRef<StageCanvasHandle, Props>(function StageCanvas(
  {
    videoRef, effectId, mirror, sparkles = false,
    overlayUrl, overlayTransform, overlayOpacity,
    threeCanvasId, active = true,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runnerRef = useRef<ShaderRunner | null>(null);
  const rafRef = useRef<number>(0);
  const overlayImgRef = useRef<HTMLImageElement | null>(null);

  // Keep fast refs so rAF reads current values without deps
  const effectIdRef = useRef(effectId);
  const mirrorRef = useRef(mirror);
  const sparklesRef = useRef(sparkles);
  const overlayUrlRef = useRef(overlayUrl);
  const overlayTransformRef = useRef(overlayTransform);
  const overlayOpacityRef = useRef(overlayOpacity ?? 1);
  const threeCanvasIdRef = useRef(threeCanvasId);
  const activeRef = useRef(active);

  useEffect(() => { effectIdRef.current = effectId; }, [effectId]);
  useEffect(() => { mirrorRef.current = mirror; }, [mirror]);
  useEffect(() => { sparklesRef.current = sparkles; }, [sparkles]);
  useEffect(() => {
    overlayUrlRef.current = overlayUrl ?? null;
    // Preload overlay image when URL changes
    if (overlayUrl) {
      loadImage(overlayUrl)
        .then((img) => { overlayImgRef.current = img; })
        .catch(() => { overlayImgRef.current = null; });
    } else {
      overlayImgRef.current = null;
    }
  }, [overlayUrl]);
  useEffect(() => { overlayTransformRef.current = overlayTransform; }, [overlayTransform]);
  useEffect(() => { overlayOpacityRef.current = overlayOpacity ?? 1; }, [overlayOpacity]);
  useEffect(() => { threeCanvasIdRef.current = threeCanvasId ?? null; }, [threeCanvasId]);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Draw one frame onto `ctx` at given dimensions
  // `_canvas` is retained in signature for symmetry with capturePhoto
  const drawFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    _canvas: HTMLCanvasElement,
    runner: ShaderRunner,
    w: number, h: number,
    withSignature: boolean,
  ) => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const eid = effectIdRef.current;
    const isMirror = mirrorRef.current;

    // Step 1: Mirrored (or not) video
    ctx.save();
    if (isMirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    coverFit(ctx, video, vw, vh, w, h);
    ctx.restore();

    // Step 2: Effect shader
    if (eid !== 'none' && runner.available) {
      // Draw unflipped video into runner, then mirror result onto composite
      runner.resize(w, h);
      const params = defaultParams(eid);
      const shaded = runner.draw(video, eid, params);
      if (shaded) {
        ctx.save();
        if (isMirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
        ctx.globalCompositeOperation = 'source-over';
        coverFit(ctx, shaded, w, h, w, h);
        ctx.restore();
      }
    }

    // Step 3: Three.js canvas
    const threeId = threeCanvasIdRef.current;
    if (threeId) {
      const threeEl = document.querySelector<HTMLCanvasElement>(`#${threeId} canvas`);
      if (threeEl && threeEl.width > 0) {
        try { ctx.drawImage(threeEl, 0, 0, w, h); } catch { /* tainted */ }
      }
    }

    // Step 4: 2D overlay
    const overlayImg = overlayImgRef.current;
    if (overlayImg) {
      const t = overlayTransformRef.current ?? { scale: 1, x: 0, y: 0, rotation: 0 };
      ctx.save();
      ctx.globalAlpha = overlayOpacityRef.current;
      const cx = w / 2 + (t.x / 100) * w;
      const cy = h / 2 + (t.y / 100) * h;
      ctx.translate(cx, cy);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.scale(t.scale, t.scale);
      ctx.drawImage(overlayImg, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    // Step 5: Sparkles (independent additive layer — stacks with everything)
    if (sparklesRef.current) {
      drawSparkles(ctx, w, h, performance.now() / 1000);
    }

    // Step 6: Signature (only for capture, not preview — keeps preview fast)
    if (withSignature) {
      drawSignature(ctx, w, h);
    }
  }, [videoRef]);

  useEffect(() => {
    const runner = new ShaderRunner(PREVIEW_W, PREVIEW_H);
    runnerRef.current = runner;

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      if (!activeRef.current) return;
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      drawFrame(ctx!, canvas!, runner, PREVIEW_W, PREVIEW_H, false);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      runner.dispose();
      runnerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // capturePhoto: renders at 1080×1920 to a fresh offscreen canvas
  const capturePhoto = useCallback(async (): Promise<string> => {
    const video = videoRef.current;
    if (!video) throw new Error('No video');
    // Ensure the chosen overlay/frame is loaded before compositing, so a quick
    // capture right after picking a frame never silently drops it.
    if (overlayUrlRef.current && !overlayImgRef.current) {
      try {
        overlayImgRef.current = await loadImage(overlayUrlRef.current);
      } catch {
        /* overlay failed to load — capture without it */
      }
    }
    const offscreen = document.createElement('canvas');
    offscreen.width = CAPTURE_W;
    offscreen.height = CAPTURE_H;
    const ctx = offscreen.getContext('2d')!;
    // Capture runner at full res (create temporary full-res runner)
    const captureRunner = new ShaderRunner(CAPTURE_W, CAPTURE_H);
    drawFrame(ctx, offscreen, captureRunner, CAPTURE_W, CAPTURE_H, true);
    captureRunner.dispose();
    return offscreen.toDataURL('image/jpeg', 0.9);
  }, [drawFrame, videoRef]);

  useImperativeHandle(ref, () => ({
    get canvas() { return canvasRef.current; },
    get runner() { return runnerRef.current; },
    capturePhoto,
  }), [capturePhoto]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      style={{ display: 'block' }}
    />
  );
});

export default StageCanvas;
