/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GateDissolve — the gateway turning into the occasion (lib/openingFx.ts
 * DESIGN_DISSOLVE): the garden gate breaks into petals, the balloon wall into
 * confetti, the hall doors into gold; the festival doors and the sunset drapes
 * burn away behind a glowing edge.
 *
 * It paints the gate itself onto a canvas over the DOM gate (same image, same
 * stretch), so while closed nothing changes on screen; while the recipient
 * holds the seal the gate trembles and warms from the middle (`chargeRef`);
 * once `playing`, the opener hides the DOM gate and this canvas carries it
 * away. All motion is the pure shatterPose / burnLevel; this only paints.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { CardDesign } from '../../../lib/cardDesigns';
import {
  burnAt,
  burnEdge,
  burnLevel,
  BURN_S,
  DESIGN_FX,
  FX_ORIGIN,
  MELT_COLS,
  MELT_ROWS,
  shatterPose,
  shatterTiles,
  SHATTER_COLS,
  SHATTER_LIFE_S,
  SHATTER_ROWS,
  SHATTER_SPREAD_S,
  type DesignDissolve,
  type FxParticle,
} from '../../../lib/openingFx';
import { drawParticle } from './OpeningFx';

export interface GateDissolveProps {
  design: CardDesign;
  dissolve: DesignDissolve;
  gateSrc: string;
  seed: string;
  /** 0..1 while the seal is held: the gate trembles and warms. */
  chargeRef: MutableRefObject<number>;
  playing: boolean;
  reducedMotion: boolean;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function GateDissolve({ design, dissolve, gateSrc, seed, chargeRef, playing, reducedMotion }: GateDissolveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colors = DESIGN_FX[design.id].colors;
  const tiles = useMemo(() => shatterTiles(seed, colors.length), [seed, colors.length]);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let alive = true;
    let raf = 0;
    const img = new Image();
    img.decoding = 'async';
    img.src = gateSrc;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // The burn's mask and edge, coarse grids scaled up smooth.
    const burn = dissolve.style === 'burn';
    const noiseSeed = seed.length * 11 + 5;
    const at: number[] = [];
    let mask: HTMLCanvasElement | null = null;
    let edge: HTMLCanvasElement | null = null;
    let mctx: CanvasRenderingContext2D | null = null;
    let ectx: CanvasRenderingContext2D | null = null;
    let mimg: ImageData | null = null;
    let eimg: ImageData | null = null;
    // An offscreen copy of the gate to cut the burn from (keeps the main canvas compositing simple).
    let paper: HTMLCanvasElement | null = null;
    let pctx: CanvasRenderingContext2D | null = null;
    if (burn) {
      for (let r = 0; r < MELT_ROWS; r++) for (let c = 0; c < MELT_COLS; c++) at.push(burnAt(c, r, noiseSeed));
      mask = document.createElement('canvas');
      edge = document.createElement('canvas');
      mask.width = edge.width = MELT_COLS;
      mask.height = edge.height = MELT_ROWS;
      mctx = mask.getContext('2d');
      ectx = edge.getContext('2d');
      mimg = mctx?.createImageData(MELT_COLS, MELT_ROWS) ?? null;
      eimg = ectx?.createImageData(MELT_COLS, MELT_ROWS) ?? null;
      paper = document.createElement('canvas');
      pctx = paper.getContext('2d');
    }
    const [er, eg, eb] = hexRgb(dissolve.edge ?? design.palette.glow.slice(0, 7));
    const glow = design.palette.glow;
    const into = dissolve.into ?? 'petals';
    const unit = () => Math.min(w, h) / 100;

    /** The closed gate, with the held seal's warmth (and a tremble for shatter). */
    let drawnStill = false;
    const drawClosed = (now: number) => {
      const k = chargeRef.current;
      // Nothing held: the still gate is already on the canvas, skip the frame.
      if (k <= 0.01 && drawnStill) return;
      drawnStill = k <= 0.01;
      ctx.clearRect(0, 0, w, h);
      if (dissolve.style === 'shatter' && k > 0.02 && !reducedMotion) {
        const tw = img.naturalWidth / SHATTER_COLS;
        const th = img.naturalHeight / SHATTER_ROWS;
        const cw = w / SHATTER_COLS;
        const ch = h / SHATTER_ROWS;
        for (const t of tiles) {
          const near = 1 - Math.min(1, Math.hypot(t.cx - FX_ORIGIN.x, (t.cy - FX_ORIGIN.y) * 1.78) / 0.9);
          const j = k * k * near * 2.2;
          const ox = Math.sin(now / 37 + t.col * 1.7 + t.row) * j;
          const oy = Math.cos(now / 41 + t.row * 1.3 + t.col) * j;
          ctx.drawImage(img, t.col * tw, t.row * th, tw, th, t.col * cw + ox, t.row * ch + oy, cw + 0.6, ch + 0.6);
        }
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
      if (k > 0.01) {
        const cx = FX_ORIGIN.x * w;
        const cy = FX_ORIGIN.y * h;
        const r = Math.max(w, h) * (0.08 + 0.32 * k);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, burn ? `rgba(${er},${eg},${eb},${0.85 * k})` : `${glow}`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = burn ? 1 : 0.7 * k;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    };

    const drawShatter = (s: number) => {
      ctx.clearRect(0, 0, w, h);
      const tw = img.naturalWidth / SHATTER_COLS;
      const th = img.naturalHeight / SHATTER_ROWS;
      const cw = w / SHATTER_COLS;
      const ch = h / SHATTER_ROWS;
      const u = unit();
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const q = shatterPose(t, s);
        if (!q || q.alpha <= 0.01) continue;
        const x = (t.cx + q.dx) * w;
        const y = (t.cy + q.dy) * h;
        if (q.morph < 1) {
          ctx.save();
          ctx.globalAlpha = q.alpha * (1 - q.morph);
          ctx.translate(x, y);
          ctx.rotate(q.rot);
          ctx.scale(q.scale, q.scale);
          ctx.drawImage(img, t.col * tw, t.row * th, tw, th, -cw / 2, -ch / 2, cw + 0.6, ch + 0.6);
          ctx.restore();
        }
        if (q.morph > 0) {
          const p: FxParticle = {
            x0: 0,
            y0: 0,
            vx: 0,
            vy: 0,
            rot: 0,
            spin: 0,
            size: into === 'golddust' ? 1.6 : 2,
            delay: 0,
            life: 1,
            color: t.color,
            phase: i,
          };
          drawParticle(
            ctx,
            into,
            { x: x / w, y: y / h, rot: q.rot, scale: 0.6 + 0.4 * q.morph, alpha: q.alpha * q.morph, heading: Math.atan2(t.vy, t.vx) },
            p,
            colors,
            w,
            h,
            u,
          );
        }
      }
    };

    const drawBurn = (s: number) => {
      if (!mctx || !ectx || !mimg || !eimg || !mask || !edge || !paper || !pctx) return;
      const md = mimg.data;
      const ed = eimg.data;
      for (let i = 0; i < at.length; i++) {
        const l = burnLevel(at[i], s);
        md[i * 4 + 3] = Math.round(l * 255);
        const e = burnEdge(l);
        ed[i * 4] = er;
        ed[i * 4 + 1] = eg;
        ed[i * 4 + 2] = eb;
        ed[i * 4 + 3] = Math.round(e * 255);
      }
      mctx.putImageData(mimg, 0, 0);
      ectx.putImageData(eimg, 0, 0);
      if (paper.width !== canvas.width || paper.height !== canvas.height) {
        paper.width = canvas.width;
        paper.height = canvas.height;
      }
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.globalCompositeOperation = 'source-over';
      pctx.clearRect(0, 0, paper.width, paper.height);
      pctx.drawImage(img, 0, 0, paper.width, paper.height);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.imageSmoothingEnabled = true;
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(mask, 0, 0, paper.width, paper.height);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(paper, 0, 0, w, h);
      // The burning edge: a hot rim and a wider soft glow.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = 0.85;
      ctx.drawImage(edge, 0, 0, w, h);
      ctx.filter = 'blur(10px)';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(edge, 0, 0, w, h);
      ctx.restore();
    };

    const total = dissolve.style === 'shatter' ? SHATTER_SPREAD_S + SHATTER_LIFE_S : BURN_S;
    let start = 0;
    const frame = (now: number) => {
      if (!alive) return;
      if (!playingRef.current) {
        drawClosed(now);
        raf = requestAnimationFrame(frame);
        return;
      }
      if (!start) start = now;
      const s = (now - start) / 1000;
      if (dissolve.style === 'shatter') drawShatter(s);
      else drawBurn(s);
      if (s < total) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };

    img
      .decode()
      .catch(() => undefined)
      .then(() => {
        if (!alive || !img.naturalWidth) return;
        size();
        raf = requestAnimationFrame(frame);
      });
    const ro = new ResizeObserver(() => {
      if (!img.naturalWidth) return;
      size();
      drawnStill = false;
    });
    ro.observe(canvas);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [gateSrc, dissolve, design.palette.glow, colors, tiles, seed, chargeRef, reducedMotion]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" data-gate-dissolve={dissolve.style} />;
}
