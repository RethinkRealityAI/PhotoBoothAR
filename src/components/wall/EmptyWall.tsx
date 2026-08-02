/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EmptyWall — shared no-posts-yet state for every wall mode. Keeps the classic
 * "Be the first…" copy and the join-booth QR so an empty projected wall still
 * tells guests how to get in (shown even in projection mode).
 *
 * This is the state the room stares at for the first half hour of an event —
 * doors open, nobody has posted yet, and until now it was two lines of static
 * text and a QR on black. It is now an ambient idle scene: three empty frames
 * waiting to be filled drift and breathe, a slow beam sweeps up from the booth
 * side, and the invitation pulses. Everything is CSS keyframes on a handful of
 * elements — no rAF, no WebGL, nothing that costs anything over six hours —
 * and the whole thing goes still under `prefers-reduced-motion: reduce`.
 */
import { QRPanel } from './WallQRCodes';

interface Props {
  /** Site origin + event base path, same value WallQRCodes receives. */
  origin: string;
  /** Full URL for the join QR. Defaults to `${origin}/` — today's target —
   *  so legacy callers are unchanged; platform walls pass the /welcome hub. */
  joinUrl?: string;
  /**
   * Render the join QR here. False when the wall footer is already showing
   * one — two identical QR panels stacked on top of each other is the one
   * thing an empty wall exists NOT to do. Projection mode has no footer, so
   * there it stays true and the empty wall can still be joined.
   */
  showOwnQR?: boolean;
}

/** Three waiting frames, hand-placed so the group reads as a composition. */
const FRAMES = [
  { x: -30, y: -4, rot: -7, w: 15, delay: 0 },
  { x: 0, y: 0, rot: 2, w: 18, delay: 2.4 },
  { x: 30, y: -2, rot: 8, w: 15, delay: 4.8 },
];

export default function EmptyWall({ origin, joinUrl, showOwnQR = true }: Props) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes wall-idle-float {
            0%, 100% { transform: translate3d(0, 0, 0) rotate(var(--f-rot)); }
            50%      { transform: translate3d(0, -14px, 0) rotate(calc(var(--f-rot) + 1.5deg)); }
          }
          @keyframes wall-idle-sheen {
            0%   { transform: translateY(40%); opacity: 0; }
            35%  { opacity: 0.85; }
            100% { transform: translateY(-140%); opacity: 0; }
          }
          @keyframes wall-idle-breathe {
            0%, 100% { opacity: 0.35; transform: scale(1); }
            50%      { opacity: 0.7;  transform: scale(1.06); }
          }
          @keyframes wall-idle-pulse {
            0%, 100% { opacity: 0.45; }
            50%      { opacity: 0.9; }
          }
          .wall-idle-frame { animation: wall-idle-float 11s ease-in-out infinite; }
          .wall-idle-sheen { animation: wall-idle-sheen 9s ease-in-out infinite; }
          .wall-idle-halo  { animation: wall-idle-breathe 7.5s ease-in-out infinite; }
          .wall-idle-hint  { animation: wall-idle-pulse 4.5s ease-in-out infinite; }
        }
      `}</style>

      {/* Breathing halo behind the whole composition */}
      <div
        className="wall-idle-halo pointer-events-none absolute"
        aria-hidden
        style={{
          width: '78vmin',
          height: '78vmin',
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(var(--accent-rgb),0.16) 0%, rgba(var(--accent-rgb),0.05) 42%, rgba(var(--accent-rgb),0) 70%)',
          filter: 'blur(24px)',
          opacity: 0.35,
        }}
      />

      {/* Slow beam sweeping up from the booth side of the room */}
      <div
        className="wall-idle-sheen pointer-events-none absolute inset-x-0 bottom-0"
        aria-hidden
        style={{
          height: '60vh',
          background:
            'radial-gradient(ellipse 34% 100% at 50% 100%, rgba(251,243,217,0.16) 0%, rgba(var(--accent-rgb),0.10) 38%, rgba(var(--accent-rgb),0) 76%)',
          filter: 'blur(10px)',
          opacity: 0,
        }}
      />

      <div
        className="relative text-center flex flex-col items-center px-6"
        // Clear of the footer band when the footer is present.
        style={{ paddingBottom: showOwnQR ? 0 : 'calc(90px * min(var(--wall-scale, 1), 1.6))' }}
      >
        {/* Frames waiting to be filled */}
        <div
          className="pointer-events-none relative mb-10 flex items-end justify-center"
          aria-hidden
          style={{ height: 'calc(150px * var(--wall-scale, 1))', width: '100%' }}
        >
          {FRAMES.map((f, i) => (
            <div
              key={i}
              className="wall-idle-frame absolute rounded-xl"
              style={{
                // @ts-expect-error — CSS custom property consumed by the keyframes above
                '--f-rot': `${f.rot}deg`,
                width: `calc(${f.w}vmin * min(var(--wall-scale, 1), 1.4))`,
                aspectRatio: '9 / 12',
                left: `calc(50% + ${f.x}% - ${f.w / 2}vmin)`,
                bottom: `${f.y}px`,
                transform: `rotate(${f.rot}deg)`,
                animationDelay: `${f.delay}s`,
                border: '1px solid rgba(var(--accent-rgb),0.28)',
                background:
                  'linear-gradient(160deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.012) 55%, rgba(var(--accent-rgb),0.05) 100%)',
                boxShadow:
                  '0 18px 44px rgba(0,0,0,0.5), inset 0 0 30px rgba(var(--accent-rgb),0.06)',
                backdropFilter: 'blur(2px)',
              }}
            />
          ))}
        </div>

        <p
          className="font-serif italic text-foil-static mb-4"
          style={{ fontSize: 'calc(36px * var(--wall-scale, 1))', lineHeight: 1.15 }}
        >
          Be the first to capture a moment…
        </p>
        <p
          className="font-label uppercase tracking-luxe text-champagne/50"
          style={{ fontSize: 'calc(12px * var(--wall-scale, 1))' }}
        >
          Step into the booth and share your story
        </p>

        <p
          className="wall-idle-hint font-label uppercase tracking-luxe text-champagne/40"
          style={{
            marginTop: 'calc(10px * var(--wall-scale, 1))',
            fontSize: 'calc(10px * var(--wall-scale, 1))',
            opacity: 0.45,
          }}
        >
          Your photo appears here the second you send it
        </p>

        {showOwnQR && (
          <div style={{ marginTop: 'calc(28px * var(--wall-scale, 1))' }}>
            <QRPanel url={joinUrl ?? `${origin}/`} label="Scan to join the booth" />
          </div>
        )}
      </div>
    </div>
  );
}
