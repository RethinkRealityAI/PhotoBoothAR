/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SealedObject — what Beamy is guarding, filling the layout's slot:
 *
 *   blast              a glowing crystal mystery box (shards: FxCanvas)
 *   tap / turn / trace a sealed glass panel with an emblem: a padlock that
 *                      cracks with each tap, a vault door that turns with the
 *                      dial, a triangle that fills as it is traced
 *   melt / shine / rub the news card itself, under ice / darkness / frost:
 *                      IceCover melts with the hold charge (openingFx's frost
 *                      field), ShineCover lifts the dark, RubCover is a
 *                      scratch card the reader rubs clear (rubStroke)
 */
import { useEffect, useMemo, useRef, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { frostLevel, frostMeltAt, frostNoise, MELT_COLS, MELT_ROWS, MELT_S } from '../../lib/openingFx';
import { newRub, rubProgress, rubStroke, type RubGrid } from '../../lib/reveals/revealUnlock';
import type { RevealUnlock } from '../../lib/reveals/revealModel';

/* ------------------------------------------------------------------ */
/* Crystal box (blast)                                                 */
/* ------------------------------------------------------------------ */

export function CrystalBox({ charging, gone }: { charging: boolean; gone: boolean }) {
  return (
    <div className="rv-center">
      <svg className="rv-crystal" viewBox="0 0 100 110" data-charging={charging ? 'true' : undefined} data-gone={gone ? 'true' : undefined} aria-hidden style={{ width: '78%', height: '78%' }}>
        {/* A faceted gem box: top facets, two side faces, a band, the core inside. */}
        <path d="M50 4 L88 26 L88 80 L50 104 L12 80 L12 26 Z" fill="var(--rv-accent)" opacity="0.22" />
        <path d="M50 4 L88 26 L50 46 L12 26 Z" fill="var(--rv-accent)" opacity="0.55" />
        <path d="M12 26 L50 46 L50 104 L12 80 Z" fill="var(--rv-accent)" opacity="0.3" />
        <path d="M88 26 L50 46 L50 104 L88 80 Z" fill="var(--rv-accent)" opacity="0.16" />
        <circle className="rv-crystal-core" cx="50" cy="66" r="15" fill="var(--rv-core)" opacity="0.9" style={{ filter: 'blur(3px)' }} />
        <circle cx="50" cy="66" r="7" fill="#FFFFFF" opacity="0.9" />
        <path d="M50 4 L88 26 L88 80 L50 104 L12 80 L12 26 Z M50 46 L50 104 M12 26 L50 46 L88 26" fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M24 30 L44 41" stroke="#FFFFFF" strokeOpacity="0.9" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 55 L50 75 L88 55" fill="none" stroke="var(--rv-core)" strokeOpacity="0.7" strokeWidth="2.4" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sealed panel (tap, turn, trace)                                     */
/* ------------------------------------------------------------------ */

const CRACKS = [
  'M50 58 L44 66 L47 72 L40 80',
  'M50 58 L57 64 L55 71 L62 78',
  'M50 58 L49 50 L54 46',
  'M50 58 L41 57 L35 62',
  'M50 58 L60 56 L66 60 L70 57',
];

export function VaultPanel({ unlock, progress, angle, taps, burst }: { unlock: RevealUnlock; progress: number; angle: number; taps: number; burst: boolean }) {
  return (
    <div className="rv-panel" data-burst={burst ? 'true' : undefined}>
      {unlock === 'tap' && (
        <svg className="rv-emblem" viewBox="0 0 100 100" aria-hidden key={taps}>
          <g className={taps > 0 ? 'rv-shake' : undefined} style={{ transformOrigin: '50% 30%', transformBox: 'view-box' }}>
            <path d="M32 44 V32 a18 18 0 0 1 36 0 V44" fill="none" stroke="var(--rv-accent)" strokeWidth="7" strokeLinecap="round" />
            <rect x="20" y="42" width="60" height="48" rx="12" fill="var(--rv-accent)" opacity="0.28" />
            <rect x="20" y="42" width="60" height="48" rx="12" fill="none" stroke="#FFFFFF" strokeOpacity="0.8" strokeWidth="2" />
            <circle cx="50" cy="58" r="8" fill="var(--rv-core)" style={{ filter: `drop-shadow(0 0 ${4 + progress * 10}px var(--rv-core))` }} />
            {CRACKS.slice(0, Math.ceil(progress * CRACKS.length)).map((d) => (
              <path key={d} d={d} fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>
        </svg>
      )}
      {unlock === 'turn' && (
        <svg className="rv-emblem" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="44" fill="var(--rv-accent)" opacity="0.16" />
          <circle cx="50" cy="50" r="44" fill="none" stroke="#FFFFFF" strokeOpacity="0.7" strokeWidth="2" />
          {Array.from({ length: 12 }, (_, i) => (
            <circle key={i} cx={50 + Math.cos((i / 12) * Math.PI * 2) * 39} cy={50 + Math.sin((i / 12) * Math.PI * 2) * 39} r="2" fill="#FFFFFF" opacity="0.6" />
          ))}
          <g transform={`rotate(${(angle * 180) / Math.PI} 50 50)`}>
            <circle cx="50" cy="50" r="30" fill="var(--rv-panel)" stroke="var(--rv-accent)" strokeWidth="3" />
            {Array.from({ length: 6 }, (_, i) => {
              const a = (i / 6) * Math.PI * 2;
              return <line key={i} x1={50 + Math.cos(a) * 9} y1={50 + Math.sin(a) * 9} x2={50 + Math.cos(a) * 26} y2={50 + Math.sin(a) * 26} stroke="var(--rv-accent)" strokeWidth="4" strokeLinecap="round" />;
            })}
            <circle cx="50" cy="50" r="8" fill="var(--rv-core)" />
            <circle cx="50" cy="24" r="3" fill="#FFFFFF" />
          </g>
          <path d={describeArc(50, 50, 47, 0, progress * Math.PI * 2)} fill="none" stroke="var(--rv-core)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {unlock === 'trace' && (
        <svg className="rv-emblem" viewBox="0 0 100 100" aria-hidden>
          <path d="M50 10 L90 82 L10 82 Z" fill="var(--rv-core)" opacity={0.08 + progress * 0.7} strokeLinejoin="round" />
          <path className="rv-dash" d="M50 10 L90 82 L10 82 Z" fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="2.5" strokeDasharray="7 7" strokeLinejoin="round" />
          <circle cx="50" cy="60" r={6 + progress * 6} fill="var(--rv-core)" style={{ filter: 'blur(2px)' }} />
        </svg>
      )}
    </div>
  );
}

/** SVG arc path (angles in radians from 12 o'clock, clockwise). */
export function describeArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const span = Math.min(Math.PI * 2 - 0.0001, Math.max(0, a1 - a0));
  if (span <= 0) return '';
  const p = (a: number) => `${(cx + Math.sin(a) * r).toFixed(2)} ${(cy - Math.cos(a) * r).toFixed(2)}`;
  return `M${p(a0)} A${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${p(a0 + span)}`;
}

/* ------------------------------------------------------------------ */
/* Covers over the card                                                */
/* ------------------------------------------------------------------ */

function useCanvasSize(ref: RefObject<HTMLCanvasElement | null>, onSize: (w: number, h: number) => void) {
  const cb = useRef(onSize);
  cb.current = onSize;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const read = () => {
      const r = c.getBoundingClientRect();
      cb.current(Math.max(1, r.width), Math.max(1, r.height));
    };
    read();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(c);
    return () => ro?.disconnect();
  }, [ref]);
}

/** Ice over the card: the frost field melts as the hold charges (0..1). */
export function IceCover({ charge, fall, seed }: { charge: number; fall: boolean; seed: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const grid = useMemo(() => {
    const at: number[] = [];
    const tone: number[] = [];
    for (let r = 0; r < MELT_ROWS; r++) for (let c = 0; c < MELT_COLS; c++) { at.push(frostMeltAt(c, r, seed)); tone.push(frostNoise(c, r, seed + 7)); }
    return { at, tone };
  }, [seed]);
  const small = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = MELT_COLS;
    c.height = MELT_ROWS;
    return c;
  }, []);
  const size = useRef({ w: 1, h: 1 });
  const draw = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    const sctx = small.getContext('2d');
    if (!c || !ctx || !sctx) return;
    const img = sctx.createImageData(MELT_COLS, MELT_ROWS);
    const t = charge * MELT_S;
    for (let i = 0; i < grid.at.length; i++) {
      const lvl = charge >= 1 ? 0 : frostLevel(grid.at[i], t);
      const n = grid.tone[i];
      img.data[i * 4] = 214 + n * 36;
      img.data[i * 4 + 1] = 232 + n * 22;
      img.data[i * 4 + 2] = 248;
      img.data[i * 4 + 3] = Math.round(255 * lvl * (0.86 + n * 0.12));
    }
    sctx.putImageData(img, 0, 0);
    const { w, h } = size.current;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, w, h);
    // Cracks and a cold sheen, fading with the melt.
    const a = Math.max(0, 1 - charge * 1.4);
    if (a > 0) {
      ctx.save();
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(w * 0.12, h * 0.18); ctx.lineTo(w * 0.3, h * 0.34); ctx.lineTo(w * 0.26, h * 0.5);
      ctx.moveTo(w * 0.3, h * 0.34); ctx.lineTo(w * 0.46, h * 0.38);
      ctx.moveTo(w * 0.88, h * 0.7); ctx.lineTo(w * 0.7, h * 0.62); ctx.lineTo(w * 0.62, h * 0.8);
      ctx.moveTo(w * 0.7, h * 0.62); ctx.lineTo(w * 0.74, h * 0.46);
      ctx.stroke();
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(w * 0.08, 0); ctx.lineTo(w * 0.3, 0); ctx.lineTo(w * 0.04, h * 0.55); ctx.lineTo(0, h * 0.55); ctx.lineTo(0, h * 0.2);
      ctx.fill();
      ctx.restore();
    }
  };
  useCanvasSize(canvas, (w, h) => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    size.current = { w, h };
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  });
  useEffect(draw);
  return (
    <div className="rv-cover" data-fall={fall ? 'true' : undefined} aria-hidden>
      <div className="rv-cover-blur" style={{ opacity: Math.max(0, 1 - charge * 1.25) }} />
      <canvas ref={canvas} />
    </div>
  );
}

/** Darkness over the card: it lifts (and the card sharpens) as Beamy shines. */
export function ShineCover({ charge, flood }: { charge: number; flood: boolean }) {
  const dark = flood ? 0 : 0.9 * Math.pow(1 - charge, 0.6);
  return (
    <div className="rv-cover" style={{ overflow: 'visible' }} aria-hidden>
      <div className="rv-cover-blur" style={{ opacity: flood ? 0 : Math.max(0, 1 - charge * 1.1), borderRadius: 24 }} />
      <div className="rv-veil" style={{ opacity: dark, transition: flood ? 'opacity 500ms ease-out' : undefined }} />
      <div className="rv-flood" data-on={flood ? 'true' : undefined} />
    </div>
  );
}

/** Frost to rub away (a scratch card). Reports progress 0..1 (rubProgress). */
export function RubCover({ interactive, fade, onProgress, onFirstRub }: { interactive: boolean; fade: boolean; onProgress: (p: number) => void; onFirstRub: () => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const grid = useRef<RubGrid>(newRub());
  const size = useRef({ w: 1, h: 1 });
  const last = useRef<{ x: number; y: number } | null>(null);
  const rubbed = useRef(false);
  const paint = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { w, h } = size.current;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#D9E6F4';
    ctx.fillRect(0, 0, w, h);
    // Speckle and glints, seeded so a resize repaints the same frost.
    let s = 17;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(150,175,215,0.35)';
      const r = 0.8 + rand() * 2.4;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const l = 6 + rand() * 8;
      ctx.beginPath();
      ctx.moveTo(x - l, y); ctx.lineTo(x + l, y);
      ctx.moveTo(x, y - l); ctx.lineTo(x, y + l);
      ctx.stroke();
    }
    // Re-cut what has already been rubbed (a resize must not re-frost it).
    ctx.globalCompositeOperation = 'destination-out';
    const g = grid.current;
    const cw = w / g.cols;
    const ch = h / g.rows;
    for (let i = 0; i < g.cleared.length; i++) {
      if (!g.cleared[i]) continue;
      ctx.beginPath();
      ctx.arc(((i % g.cols) + 0.5) * cw, (Math.floor(i / g.cols) + 0.5) * ch, Math.max(cw, ch) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  useCanvasSize(canvas, (w, h) => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    size.current = { w, h };
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
  });

  const at = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const brush = () => Math.max(18, Math.min(size.current.w, size.current.h) * 0.075);
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const r = brush();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = r * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y);
    ctx.stroke();
    const next = rubStroke(grid.current, a, b, r, size.current.w, size.current.h);
    if (next !== grid.current) {
      grid.current = next;
      onProgress(rubProgress(next));
    }
    if (!rubbed.current) { rubbed.current = true; onFirstRub(); }
  };
  return (
    <div className="rv-cover" data-fade={fade ? 'true' : undefined} aria-hidden>
      <canvas
        ref={canvas}
        className={interactive ? 'rv-rub' : undefined}
        style={{ pointerEvents: interactive ? 'auto' : 'none' }}
        onPointerDown={(e) => {
          if (!interactive) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = at(e);
          last.current = p;
          stroke(p, p);
        }}
        onPointerMove={(e) => {
          if (!interactive || last.current === null) return;
          const p = at(e);
          stroke(last.current, p);
          last.current = p;
        }}
        onPointerUp={() => { last.current = null; }}
        onPointerCancel={() => { last.current = null; }}
      />
    </div>
  );
}
