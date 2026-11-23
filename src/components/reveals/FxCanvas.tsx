/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FxCanvas — the reveal's one effects canvas over the page:
 *   shards     the blast's crystal flying apart (openingFx shatterTiles /
 *              shatterPose, mapped onto the crystal's rect)
 *   celebrate  confetti + sparks in the theme's accent and core light, from
 *              the card (openingFx fxParticles / fxPose, drawn by the cards'
 *              own drawParticle); reduced motion swaps them for still gold dust
 * All motion is the pure openingFx maths; this only paints, then stops.
 */
import { useEffect, useRef } from 'react';
import { FX_DURATION_S, FX_ORIGIN, fxParticles, fxPose, SHATTER_COLS, SHATTER_LIFE_S, SHATTER_ROWS, SHATTER_SPREAD_S, shatterPose, shatterTiles, type FxKind } from '../../lib/openingFx';
import { drawParticle } from '../cards/scenes/OpeningFx';
import type { Rect } from '../../lib/reveals/revealScene';

export interface FxShot {
  /** Bumps to fire again. */
  key: number;
  kind: 'shards' | 'celebrate';
  /** shards: the crystal's rect; celebrate: where the burst comes from (centre used). */
  rect: Rect;
}

interface Props {
  shots: readonly FxShot[];
  colors: readonly string[];
  reduced: boolean;
}

export default function FxCanvas({ shots, colors, reduced }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const latest = shots.length > 0 ? shots[shots.length - 1].key : 0;
  const shotsRef = useRef(shots);
  shotsRef.current = shots;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || shotsRef.current.length === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const unit = Math.min(w, h) / 100;
    const start = performance.now();
    const layers = shotsRef.current.map((s) => {
      if (s.kind === 'shards') return { s, tiles: reduced ? [] : shatterTiles(`rv${s.key}`, colors.length), parts: [] as { kind: FxKind; ps: ReturnType<typeof fxParticles> }[] };
      const parts = reduced
        ? [{ kind: 'golddust' as FxKind, ps: fxParticles('golddust', `rv${s.key}`, true, 1, colors.length) }]
        : [
            { kind: 'confetti' as FxKind, ps: fxParticles('confetti', `rv${s.key}`, false, 1.2, colors.length) },
            { kind: 'sparks' as FxKind, ps: fxParticles('sparks', `rvs${s.key}`, false, 0.8, colors.length) },
          ];
      return { s, tiles: [], parts };
    });
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      let live = false;
      for (const L of layers) {
        const r = L.s.rect;
        if (L.tiles.length > 0) {
          const tw = r.w / SHATTER_COLS;
          const th = r.h / SHATTER_ROWS;
          const ts = t * 1.6; // shards fly quick
          for (const tile of L.tiles) {
            const q = shatterPose(tile, ts);
            if (q === null) continue;
            live = true;
            const x = r.x + tile.cx * r.w + q.dx * r.w * 2.2;
            const y = r.y + tile.cy * r.h + q.dy * r.h * 1.6;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(q.rot);
            ctx.globalAlpha = q.alpha;
            ctx.fillStyle = colors[tile.color % colors.length] ?? '#FFFFFF';
            const s = Math.max(tw, th) * q.scale * 0.9;
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.7);
            ctx.lineTo(s * 0.6, s * 0.45);
            ctx.lineTo(-s * 0.55, s * 0.35);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
          if (ts < SHATTER_SPREAD_S + SHATTER_LIFE_S) live = true;
        }
        for (const part of L.parts) {
          const ox = (r.x + r.w / 2) / w;
          const oy = (r.y + r.h * 0.42) / h;
          for (const p of part.ps) {
            const q = fxPose(part.kind, p, t);
            if (q === null) continue;
            live = true;
            drawParticle(ctx, part.kind, { ...q, x: ox + (q.x - FX_ORIGIN.x), y: oy + (q.y - FX_ORIGIN.y) }, p, colors, w, h, unit);
          }
          if (t < FX_DURATION_S) live = true;
        }
      }
      if (live) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire per new shot
  }, [latest, reduced]);

  return <canvas ref={ref} className="rv-fx" aria-hidden />;
}
