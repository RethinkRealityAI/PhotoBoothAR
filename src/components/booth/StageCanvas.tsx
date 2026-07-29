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
import {
  ShaderRunner, createShadeGate, canReuseShade, markShaded, invalidateShadeGate,
  type ShadeGate,
} from '../../lib/shaders';
import { drawScagoMark } from '../../lib/scagoMark';
import { Transform2D, LayerAnimation, GuestLetteringConfig } from '../../types';
import { fitLettering, regionForPlacement, MIN_FONT_PX, type GuestLetteringStyle } from '../../lib/letteringFit';
import type { EventConfig } from '../../events/types';
import { useOptionalEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import { animateTransform2D } from '../../lib/studio/animation';

export interface StageCanvasHandle {
  canvas: HTMLCanvasElement | null;
  runner: ShaderRunner | null;
  /** Snap a full-res 1080×1920 JPEG data-URL from the current frame. */
  capturePhoto: () => Promise<string>;
}

/** One layer of a multi-object 2D scene (studio `config.layers`). */
export interface StageOverlaySpec {
  url: string;
  transform: Transform2D;
  opacity?: number;
  animation?: LayerAnimation;
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
  /**
   * Multi-object 2D scene (studio `config.layers`). When provided (non-null),
   * step 4 draws EACH overlay in array order (index 0 = bottom) instead of the
   * single overlayUrl/overlayTransform above — the two are mutually exclusive.
   * Undefined/null -> exactly today's single-overlay path.
   */
  overlays?: StageOverlaySpec[] | null;
  /** If present, drawn between shader and 2D overlay */
  threeCanvasId?: string | null; // DOM id of R3F canvas (inside #booth-3d-layer)
  active?: boolean;
  /**
   * Bake the event signature into captures (default true). Threaded from
   * useEntitlements().watermark by the Booth — legacy coded events always
   * pass true (LEGACY_ENTITLEMENTS keeps their watermark unconditional).
   */
  watermark?: boolean;
  /**
   * Optional face-trigger particle canvas (src/components/booth/TriggerEffects).
   * Drawn as ONE additive final layer (like `sparkles`), scaled to the frame, so
   * a burst on screen at the shutter also lands in the capture. Absent/null ->
   * the step is skipped and output is byte-identical to before this prop existed.
   */
  effectsCanvas?: HTMLCanvasElement | null;
  /**
   * Live lettering drawn OVER the frame — the guest's own name (or one fixed
   * line), from the frame experience's `config.lettering`. `name` is what to
   * draw for a 'guestName' token; empty means the guest has no stored name yet,
   * and nothing is drawn.
   *
   * ABSENT (or null) ⇒ drawFrame is byte-identical to before this prop existed:
   * step 5c is skipped entirely, no font is requested, and no canvas state is
   * touched. That is the legacy-event guarantee — coded events never carry a
   * `config.lettering` key, so Booth passes null and their output is unchanged.
   */
  lettering?: { spec: GuestLetteringConfig; name: string } | null;
  /**
   * Bake the event signature into the LIVE PREVIEW pass too (default false).
   *
   * A recorded video is `captureStream()` of the preview canvas, and the
   * preview pass draws with `withSignature=false` — so every clip shipped
   * UNSIGNED while photos shipped signed, an entitlement hole on free-tier
   * events. Booth turns this on only for the duration of a recording, which
   * keeps the viewfinder clean the rest of the time and makes what the guest
   * sees while recording exactly what the clip will contain.
   *
   * Still ANDed with `watermark`, so a paid tier stays unsigned. Absent/false ⇒
   * the preview pass is byte-identical to before this prop existed, and a still
   * photo is unaffected either way (its own pass always passes true).
   */
  burnSignature?: boolean;
}

/** Live preview / record buffer. Exported so callers reporting a recording's
 *  true pixel dimensions do not have to re-declare them. */
export const PREVIEW_W = 720;
export const PREVIEW_H = 1280;
/** Still-photo buffer. */
export const CAPTURE_W = 1080;
export const CAPTURE_H = 1920;

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

/** Event signature watermark: event-coloured emblem (gala only) + event name. */
function drawSignature(ctx: CanvasRenderingContext2D, w: number, h: number, event: EventConfig) {
  const copy = useStore.getState().copy;
  const baseY = h - 58;
  const markSize = Math.round(w * 0.075);
  const hex = event.accentHexes;
  const c0 = hex[0];
  const c1 = hex[1] ?? c0;
  const c2 = hex[2] ?? c0;
  const c3 = hex[3] ?? c0;
  // The SCAGO crescent emblem is gala-specific; other events show text only.
  const showEmblem = event.id === 'hope-gala';

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const title = copy.eventName;
  const titleSize = Math.round(w * 0.040);
  const eyebrowSize = Math.round(w * 0.020);
  ctx.font = `italic 600 ${titleSize}px Georgia, "Times New Roman", serif`;
  const titleW = ctx.measureText(title).width;

  // centre the [emblem + gap + text] lockup as a group
  const gap = w * 0.022;
  const groupW = showEmblem ? markSize + gap + titleW : titleW;
  const startX = (w - groupW) / 2;

  if (showEmblem) {
    const grad = ctx.createLinearGradient(startX, baseY - markSize / 2, startX + markSize, baseY + markSize / 2);
    grad.addColorStop(0, c3);
    grad.addColorStop(0.5, c2);
    grad.addColorStop(1, c0);
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 12;
    drawScagoMark(ctx, startX + markSize / 2, baseY, markSize, { fill: grad, alpha: 0.97 });
  }

  // text block — event eyebrow ABOVE the event name
  const textX = showEmblem ? startX + markSize + gap : startX;

  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = c1;
  ctx.globalAlpha = 0.9;
  ctx.font = `${eyebrowSize}px Georgia, serif`;
  drawTracked(ctx, copy.eyebrow, textX + 2, baseY - titleSize * 0.5, eyebrowSize * 0.18);

  const textGrad = ctx.createLinearGradient(textX, 0, textX + titleW, 0);
  textGrad.addColorStop(0, c1);
  textGrad.addColorStop(0.5, c2);
  textGrad.addColorStop(1, c0);
  ctx.fillStyle = textGrad;
  ctx.globalAlpha = 0.97;
  ctx.shadowBlur = 12;
  ctx.font = `italic 600 ${titleSize}px Georgia, "Times New Roman", serif`;
  ctx.fillText(title, textX, baseY + eyebrowSize * 0.7);

  ctx.restore();
}

/* ── Guest lettering (step 5c) ───────────────────────────────────────────
 * The guest's own name, drawn over the frame. Every number below is a FRACTION
 * of w/h because this runs at 720×1280 for the preview and 1080×1920 for the
 * capture — a constant would put the name in two different places. The faces
 * are the ones the app already loads (src/index.css:67-70). */

const LETTERING_FONT: Record<GuestLetteringStyle, (px: number) => string> = {
  script: (px) => `${px}px "Pinyon Script", cursive`,
  serif: (px) => `italic 600 ${px}px "Cormorant Garamond", Georgia, serif`,
  block: (px) => `800 ${px}px "Inter", sans-serif`,
  label: (px) => `600 ${px}px "Jost", sans-serif`,
};

/** The families to warm up before the first draw — same list, one per style. */
const LETTERING_FONT_PROBES = [
  '32px "Pinyon Script"',
  'italic 600 32px "Cormorant Garamond"',
  '800 32px "Inter"',
  '600 32px "Jost"',
];

function drawGuestLettering(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  spec: GuestLetteringConfig,
  name: string,
) {
  const raw = spec.token === 'fixed' ? (spec.text ?? '') : name;
  if (!raw.trim()) return; // no name yet (guest skipped) → draw nothing
  // 'label' is tracked-out uppercase, so the case change happens BEFORE fitting
  // — uppercase is wider, and fitting the lowercase form would overflow.
  const isLabel = spec.style === 'label';
  const region = regionForPlacement(spec.placement, w, h);
  const { fontPx, text } = fitLettering(
    isLabel ? raw.toUpperCase() : raw,
    region.w, region.h, spec.style,
    // The legibility floor is defined at the 1080 capture width; scaling it
    // keeps the preview and the photo showing the SAME truncation.
    MIN_FONT_PX * (w / 1080),
  );
  if (fontPx <= 0 || !text) return;

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = LETTERING_FONT[spec.style](fontPx);
  ctx.fillStyle = spec.color;
  // Same lift the signature uses — a name over busy frame art is unreadable
  // without it (drawSignature: rgba(0,0,0,0.55), blur 12 at 1080).
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = w * 0.011;
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  if (isLabel) {
    // Manual tracking means manual centring: measure the tracked run first.
    const spacing = fontPx * 0.18;
    ctx.textAlign = 'left';
    let total = -spacing;
    for (const ch of text) total += ctx.measureText(ch).width + spacing;
    drawTracked(ctx, text, cx - total / 2, cy, spacing);
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, cy);
  }
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

/**
 * One pre-rendered radial-gradient sprite per sparkle colour.
 *
 * The soft core used to be a `createRadialGradient` built per particle per
 * frame — 46 gradient objects (plus 3 colour-stop strings each) allocated 60
 * times a second, for the whole session, in the same loop that must not drop a
 * frame. The gradient's shape is identical for every particle; only its alpha
 * and radius differ, and both are reproducible with `globalAlpha` + a scaled
 * `drawImage`. Built lazily on first use and cached forever (2 canvases total).
 */
const SPARKLE_SPRITE_R = 32;
const sparkleSprites = new Map<string, HTMLCanvasElement | null>();

function sparkleSprite(col: string): HTMLCanvasElement | null {
  const hit = sparkleSprites.get(col);
  if (hit !== undefined) return hit;
  let sprite: HTMLCanvasElement | null = null;
  const size = SPARKLE_SPRITE_R * 2;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g2 = c.getContext('2d');
  if (g2) {
    // Same stops as the per-particle gradient, at alpha 1 — the caller scales
    // the whole sprite with globalAlpha, which multiplies through identically.
    const g = g2.createRadialGradient(SPARKLE_SPRITE_R, SPARKLE_SPRITE_R, 0, SPARKLE_SPRITE_R, SPARKLE_SPRITE_R, SPARKLE_SPRITE_R);
    g.addColorStop(0, `rgba(${col},1)`);
    g.addColorStop(0.4, `rgba(${col},0.35)`);
    g.addColorStop(1, `rgba(${col},0)`);
    g2.fillStyle = g;
    g2.fillRect(0, 0, size, size);
    sprite = c;
  }
  sparkleSprites.set(col, sprite);
  return sprite;
}

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
    // soft core — the sprite's alpha ramp reaches 0 at its edge, so filling the
    // sprite's full square is visually the same as the old clipped arc.
    const sprite = sparkleSprite(col);
    if (sprite) {
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, px - r, py - r, r * 2, r * 2);
      ctx.globalAlpha = 1; // the glint below bakes its own alpha into the stroke
    }
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
    overlayUrl, overlayTransform, overlayOpacity, overlays,
    threeCanvasId, active = true, watermark = true, effectsCanvas, lettering,
    burnSignature = false,
  },
  ref,
) {
  // Null on platform surfaces (Landing demo booth) — watermark needs an event.
  const eventConfig = useOptionalEvent()?.config ?? null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runnerRef = useRef<ShaderRunner | null>(null);
  /** Full-res runner for stills — built on the first capture, kept until unmount. */
  const captureRunnerRef = useRef<ShaderRunner | null>(null);
  const rafRef = useRef<number>(0);
  const overlayImgRef = useRef<HTMLImageElement | null>(null);
  const eventConfigRef = useRef(eventConfig);
  eventConfigRef.current = eventConfig;

  // Keep fast refs so rAF reads current values without deps
  const effectIdRef = useRef(effectId);
  const mirrorRef = useRef(mirror);
  const sparklesRef = useRef(sparkles);
  const overlayUrlRef = useRef(overlayUrl);
  const overlayTransformRef = useRef(overlayTransform);
  const overlayOpacityRef = useRef(overlayOpacity ?? 1);
  const threeCanvasIdRef = useRef(threeCanvasId);
  const activeRef = useRef(active);
  const watermarkRef = useRef(watermark);
  const effectsCanvasRef = useRef<HTMLCanvasElement | null>(effectsCanvas ?? null);
  const letteringRef = useRef<Props['lettering']>(lettering ?? null);
  const burnSignatureRef = useRef(burnSignature ?? false);
  /** Which video frame the PREVIEW runner's buffer holds (see D5/ShadeGate). */
  const shadeGateRef = useRef<ShadeGate>(createShadeGate());
  /** Cached `#<id> canvas` node — `document.querySelector` per frame is a full
   *  selector parse + tree walk for a node that changes at most on remount. */
  const threeElRef = useRef<{ id: string; el: HTMLCanvasElement | null }>({ id: '', el: null });
  /** Latch so the webfont warm-up runs at most once, and ONLY for a booth that
   *  actually draws lettering (a legacy event requests no extra fonts). */
  const letteringFontsRef = useRef(false);
  // Multi-layer path: the overlays spec array + a per-url image cache.
  const overlaysRef = useRef<StageOverlaySpec[] | null>(overlays ?? null);
  const overlayImgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

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
  useEffect(() => { watermarkRef.current = watermark; }, [watermark]);
  useEffect(() => { effectsCanvasRef.current = effectsCanvas ?? null; }, [effectsCanvas]);
  useEffect(() => { burnSignatureRef.current = burnSignature ?? false; }, [burnSignature]);
  useEffect(() => {
    letteringRef.current = lettering ?? null;
    // Canvas text does NOT trigger a webfont fetch — an unloaded family silently
    // falls back to the generic. Warm them once, best-effort: a failure (or an
    // environment with no FontFaceSet) just means the fallback face is used.
    if (!lettering || letteringFontsRef.current) return;
    letteringFontsRef.current = true;
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.load) return;
    for (const probe of LETTERING_FONT_PROBES) {
      try { void fonts.load(probe).catch(() => { /* fallback face is fine */ }); }
      catch { /* older engines throw on an unparsed shorthand */ }
    }
  }, [lettering]);
  useEffect(() => {
    overlaysRef.current = overlays ?? null;
    // Preload any not-yet-cached overlay images (cache persists across renders
    // so re-selecting a previously-used layer is instant).
    const cache = overlayImgCacheRef.current;
    for (const spec of overlays ?? []) {
      if (cache.has(spec.url)) continue;
      loadImage(spec.url)
        .then((img) => { cache.set(spec.url, img); })
        .catch(() => { /* skip drawing this layer until it loads/retries */ });
    }
  }, [overlays]);

  // Draw one frame onto `ctx` at given dimensions
  // `_canvas` is retained in signature for symmetry with capturePhoto
  const drawFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    _canvas: HTMLCanvasElement,
    runner: ShaderRunner,
    w: number, h: number,
    withSignature: boolean,
    /**
     * Pass a gate to let step 2 reuse the runner's existing drawing buffer when
     * the video clock has not advanced (the live preview). Null ⇒ always shade,
     * which is what a one-shot capture needs.
     */
    shadeGate: ShadeGate | null = null,
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
      // Draw unflipped video into runner, then mirror result onto composite.
      runner.resize(w, h);
      // The rAF loop runs at display rate while the camera yields ~30fps, so
      // half of these passes used to re-upload and re-shade a byte-identical
      // frame. `preserveDrawingBuffer: true` means the previous output is still
      // in the runner canvas, so the skip costs nothing and the composite below
      // is unchanged — only the shade is skipped, never the frame.
      const vt = video.currentTime;
      let shaded: HTMLCanvasElement | null;
      if (shadeGate && canReuseShade(shadeGate, vt, eid, w, h)) {
        shaded = runner.canvas;
      } else {
        // Omitting the params argument uses the shader's shared frozen defaults
        // — identical values to the `defaultParams(eid)` object this allocated
        // on every single frame.
        shaded = runner.draw(video, eid);
        if (shadeGate) {
          if (shaded) markShaded(shadeGate, vt, eid, w, h);
          else invalidateShadeGate(shadeGate);
        }
      }
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
      // Re-query only when the id changes or the cached node left the document
      // (R3F remount) — otherwise this was a selector parse + tree walk per frame.
      const cached = threeElRef.current;
      if (cached.id !== threeId || !cached.el || !cached.el.isConnected) {
        cached.id = threeId;
        cached.el = document.querySelector<HTMLCanvasElement>(`#${threeId} canvas`);
      }
      const threeEl = cached.el;
      if (threeEl && threeEl.width > 0) {
        try { ctx.drawImage(threeEl, 0, 0, w, h); } catch { /* tainted */ }
      }
    }

    // Step 4: 2D overlay(s)
    const overlaySpecs = overlaysRef.current;
    if (overlaySpecs) {
      // Multi-layer path: draw each layer in array order (index 0 = bottom),
      // applying its animation preset. Mutually exclusive with the single
      // overlayUrl/overlayTransform path below.
      const tSec = performance.now() / 1000;
      const cache = overlayImgCacheRef.current;
      for (const spec of overlaySpecs) {
        const img = cache.get(spec.url);
        if (!img) continue;
        const at = animateTransform2D(spec.transform, spec.animation ?? 'none', tSec);
        ctx.save();
        ctx.globalAlpha = spec.opacity ?? 1;
        const cx = w / 2 + (at.x / 100) * w;
        const cy = h / 2 + (at.y / 100) * h;
        ctx.translate(cx, cy);
        ctx.rotate((at.rotation * Math.PI) / 180);
        ctx.scale(at.scale, at.scale);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    } else {
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
    }

    // Step 5: Sparkles (independent additive layer — stacks with everything)
    if (sparklesRef.current) {
      drawSparkles(ctx, w, h, performance.now() / 1000);
    }

    // Step 5b: Face-trigger particles (TriggerEffects). Additive optional layer,
    // scaled from its own 9:16 buffer to w×h. Absent/empty -> skipped, so the
    // legacy/no-triggers path is byte-identical to before this step existed.
    const fx = effectsCanvasRef.current;
    if (fx && fx.width > 0) {
      try { ctx.drawImage(fx, 0, 0, w, h); } catch { /* tainted / not ready */ }
    }

    // Step 5c: Guest lettering (the guest's own name over the frame).
    // Deliberately NOT gated on `withSignature`: the preview must show the name
    // the guest is about to get, the recorded video is a capture of THIS canvas
    // (preview pass), and the photo re-renders with withSignature=true — the
    // name has to land in all three. Absent prop -> skipped entirely, so a
    // legacy/coded event's frame is byte-identical to before this step existed.
    const letteringSpec = letteringRef.current;
    if (letteringSpec) {
      drawGuestLettering(ctx, w, h, letteringSpec.spec, letteringSpec.name);
    }

    // Step 6: Signature (only for capture, not preview — keeps preview fast).
    // Entitlement-gated: paid tiers capture without the watermark. No event
    // context (platform demo booth) -> nothing to sign.
    const signatureConfig = eventConfigRef.current;
    if (withSignature && watermarkRef.current && signatureConfig) {
      drawSignature(ctx, w, h, signatureConfig);
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
      drawFrame(
        ctx!, canvas!, runner, PREVIEW_W, PREVIEW_H,
        // Step 6 on ONLY while recording: this canvas IS the recorded stream.
        burnSignatureRef.current,
        shadeGateRef.current,
      );
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      runner.dispose();
      runnerRef.current = null;
      // The capture runner is created lazily and kept for the session (see
      // capturePhoto) — this is the only place that owns its teardown.
      captureRunnerRef.current?.dispose();
      captureRunnerRef.current = null;
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
    // Multi-layer path: same guarantee, for every layer not yet cached.
    const overlaySpecs = overlaysRef.current;
    if (overlaySpecs) {
      const cache = overlayImgCacheRef.current;
      await Promise.all(overlaySpecs.map(async (spec) => {
        if (cache.has(spec.url)) return;
        try {
          cache.set(spec.url, await loadImage(spec.url));
        } catch {
          /* layer failed to load — capture without it */
        }
      }));
    }
    const offscreen = document.createElement('canvas');
    offscreen.width = CAPTURE_W;
    offscreen.height = CAPTURE_H;
    const ctx = offscreen.getContext('2d')!;
    // ONE full-res capture runner for the session. This used to construct and
    // dispose a ShaderRunner per shutter press, and the old dispose() never
    // released the WebGL context — so a guest taking a dozen shots quietly
    // stacked a dozen live contexts against mobile Safari's per-page cap and
    // the browser force-lost the preview's. resetClock keeps the observable
    // behaviour of a fresh runner: uTime starts at ~0 for every capture, so an
    // animated filter bakes the same phase into every shot exactly as before.
    let captureRunner = captureRunnerRef.current;
    if (!captureRunner) {
      captureRunner = new ShaderRunner(CAPTURE_W, CAPTURE_H);
      captureRunnerRef.current = captureRunner;
    }
    captureRunner.resetClock();
    // No shade gate: a capture must always shade the frame in front of it.
    drawFrame(ctx, offscreen, captureRunner, CAPTURE_W, CAPTURE_H, true, null);
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
