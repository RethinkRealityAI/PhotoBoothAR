/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FrameTruthPreview — the frame as a guest will actually see it: inside a
 * phone, contain-fit on the booth's 9:16 stage, with stand-in guests where
 * the faces go and the areas the booth's own buttons cover outlined.
 *
 * Every number comes from the shared tables in src/lib/assetPrompt.ts —
 * BOOTH_SAFE_ZONE (measured from the real BoothTopBar / BoothControlDeck) and
 * FRAME_GEOMETRY (the windows the prompt asks for and the gate checks) — so
 * the outline the host sees, the words the model reads and the check the
 * pixels pass are one set of numbers. Purely presentational.
 */
import { BOOTH_SAFE_ZONE, FRAME_GEOMETRY, type FrameLayout } from '../../lib/assetPrompt';

/** Phone body in SVG user units; the screen is a 9:16 rectangle inside it. */
const BODY_W = 108;
const BODY_H = 196;
const SCREEN = { x: 4, y: 9, w: 100, h: (100 * 16) / 9 };
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** Where the stand-in guests stand: in the windows, or one centred guest. */
function standIns(layout: FrameLayout): { cx: number; cy: number; r: number }[] {
  const wins = FRAME_GEOMETRY[layout].windows;
  if (layout === 'classic-border' || wins.length === 0) return [{ cx: 0.5, cy: 0.42, r: 0.15 }];
  return wins.map((w) => ({ cx: w.cx, cy: w.cy, r: Math.min(w.rx, w.ry * (9 / 16)) * 0.8 }));
}

export default function FrameTruthPreview({
  assetUrl,
  layout,
  guides = true,
  alt = 'Your frame, as guests will see it',
  className = '',
}: {
  assetUrl: string | null;
  layout: FrameLayout;
  /** Outline the areas the booth's buttons cover. */
  guides?: boolean;
  alt?: string;
  className?: string;
}) {
  const sw = SCREEN.w;
  const sh = SCREEN.h;
  const topH = BOOTH_SAFE_ZONE.top * sh;
  const deckH = BOOTH_SAFE_ZONE.bottom * sh;
  return (
    <figure className={`relative ${className}`} style={{ aspectRatio: `${BODY_W} / ${BODY_H}` }}>
      {/* Phone body — decorative. */}
      <svg viewBox={`0 0 ${BODY_W} ${BODY_H}`} className="absolute inset-0 w-full h-full" aria-hidden="true">
        <rect x="0.75" y="0.75" width={BODY_W - 1.5} height={BODY_H - 1.5} rx="14" fill="#0b0b0f" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
        <rect x={BODY_W / 2 - 12} y="3.2" width="24" height="3.2" rx="1.6" fill="rgba(255,255,255,0.14)" />
      </svg>

      {/* Screen: stand-in guests → the frame → the button outlines. */}
      <div
        className="absolute overflow-hidden rounded-[6px] bg-[#2a2630]"
        style={{ left: pct(SCREEN.x, BODY_W), top: pct(SCREEN.y, BODY_H), width: pct(sw, BODY_W), height: pct(sh, BODY_H) }}
      >
        <svg viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <defs>
            <linearGradient id="ftp-room" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3b3542" />
              <stop offset="1" stopColor="#1f1c24" />
            </linearGradient>
          </defs>
          <rect width={sw} height={sh} fill="url(#ftp-room)" />
          {standIns(layout).map((g, i) => (
            <g key={i} fill="rgba(236,226,214,0.55)">
              <ellipse cx={g.cx * sw} cy={g.cy * sh} rx={g.r * sw} ry={g.r * sw * 1.22} />
              <ellipse cx={g.cx * sw} cy={g.cy * sh + g.r * sw * 3} rx={g.r * sw * 2.1} ry={g.r * sw * 1.6} />
            </g>
          ))}
        </svg>

        {assetUrl && (
          <img src={assetUrl} alt={alt} draggable={false} className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" />
        )}

        {guides && (
          <svg viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
            <rect x="1" y="1" width={sw - 2} height={topH - 1} fill="rgba(0,0,0,0.28)" stroke="rgba(255,255,255,0.7)" strokeWidth="0.6" strokeDasharray="2.2 1.6" vectorEffect="non-scaling-stroke" />
            <rect x="1" y={sh - deckH} width={sw - 2} height={deckH - 1} fill="rgba(0,0,0,0.28)" stroke="rgba(255,255,255,0.7)" strokeWidth="0.6" strokeDasharray="2.2 1.6" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      {guides && (
        <figcaption className="sr-only">
          The dashed areas at the top and bottom sit under the booth’s own buttons on most phones.
        </figcaption>
      )}
    </figure>
  );
}
