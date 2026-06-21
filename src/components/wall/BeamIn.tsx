/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamIn — improved golden light-beam + bloom + settling gold particles.
 * Fires each time a new post arrives via realtime. ~1.4 s total, elegant.
 *
 * Usage:
 *   <BeamIn key={post.id} guestName={...} onDone={...} />
 */
import { useEffect } from 'react';
import { motion } from 'motion/react';

interface Props {
  guestName?: string | null;
  onDone?: () => void;
}

// Deterministic set of gold particle positions (no Math.random at render time —
// keeps SSR-safe and avoids flicker on React StrictMode double-mount).
const PARTICLES = [
  { angle: 0,   r: 90,  size: 5, delay: 0.20, dur: 0.75 },
  { angle: 52,  r: 115, size: 3, delay: 0.25, dur: 0.68 },
  { angle: 105, r: 78,  size: 6, delay: 0.18, dur: 0.80 },
  { angle: 160, r: 130, size: 4, delay: 0.30, dur: 0.72 },
  { angle: 210, r: 95,  size: 5, delay: 0.22, dur: 0.77 },
  { angle: 262, r: 108, size: 3, delay: 0.28, dur: 0.65 },
  { angle: 318, r: 85,  size: 7, delay: 0.15, dur: 0.85 },
  { angle: 10,  r: 145, size: 3, delay: 0.35, dur: 0.60 },
  { angle: 75,  r: 68,  size: 4, delay: 0.12, dur: 0.90 },
  { angle: 240, r: 122, size: 5, delay: 0.32, dur: 0.70 },
];

function toRad(deg: number) { return deg * (Math.PI / 180); }

export default function BeamIn({ guestName, onDone }: Props) {
  // Auto-dismiss after animation completes
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 1600);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      {/* ── Primary beam ── */}
      <motion.div
        className="absolute inset-x-1/2 -translate-x-1/2 top-0 bottom-0"
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: [0, 1, 1, 0], opacity: [0, 1, 0.85, 0] }}
        transition={{
          duration: 1.1,
          times: [0, 0.18, 0.65, 1],
          ease: [0.22, 1, 0.36, 1],
        }}
        style={{
          width: 4,
          transformOrigin: 'top center',
          background:
            'linear-gradient(to bottom, #FFFAEF 0%, #FBF3D9 8%, #E8C766 30%, #D4AF37 60%, rgba(212,175,55,0) 100%)',
          boxShadow:
            '0 0 22px 10px rgba(251,243,217,0.9), 0 0 60px 28px rgba(232,199,102,0.6), 0 0 120px 55px rgba(212,175,55,0.35), 0 0 220px 90px rgba(212,175,55,0.12)',
          filter: 'blur(0.5px)',
        }}
      />

      {/* ── Secondary wide bloom halo alongside beam ── */}
      <motion.div
        className="absolute inset-x-1/2 -translate-x-1/2 top-0 bottom-0"
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: [0, 1, 1, 0], opacity: [0, 0.55, 0.4, 0] }}
        transition={{
          duration: 1.1,
          times: [0, 0.22, 0.60, 1],
          ease: [0.16, 1, 0.3, 1],
        }}
        style={{
          width: 28,
          transformOrigin: 'top center',
          background:
            'linear-gradient(to bottom, rgba(251,243,217,0.45) 0%, rgba(232,199,102,0.25) 40%, rgba(212,175,55,0) 100%)',
          filter: 'blur(8px)',
        }}
      />

      {/* ── Floor bloom — warm radial glow at base of beam ── */}
      <motion.div
        className="absolute inset-x-0 bottom-0"
        initial={{ opacity: 0, scaleX: 0.4 }}
        animate={{ opacity: [0, 0.75, 0.5, 0], scaleX: [0.4, 1, 1.1, 1.2] }}
        transition={{
          duration: 1.0,
          times: [0, 0.28, 0.60, 1],
          ease: 'easeOut',
        }}
        style={{
          height: '45vh',
          background:
            'radial-gradient(ellipse 55% 100% at 50% 100%, rgba(232,199,102,0.55) 0%, rgba(212,175,55,0.25) 35%, rgba(212,175,55,0) 80%)',
          filter: 'blur(2px)',
          transformOrigin: 'bottom center',
        }}
      />

      {/* ── Top bloom — bright flash at ceiling ── */}
      <motion.div
        className="absolute inset-x-0 top-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.9, 0] }}
        transition={{ duration: 0.45, times: [0, 0.25, 1], ease: 'easeOut' }}
        style={{
          height: '28vh',
          background:
            'radial-gradient(ellipse 40% 100% at 50% 0%, rgba(251,243,217,0.65) 0%, rgba(232,199,102,0.3) 40%, rgba(212,175,55,0) 80%)',
          filter: 'blur(4px)',
        }}
      />

      {/* ── Expanding lens-flare ring at centre ── */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.8, 3.5], opacity: [0, 0.7, 0] }}
        transition={{ duration: 0.9, delay: 0.08, ease: [0.16, 1, 0.36, 1] }}
        style={{
          width: 200,
          height: 200,
          border: '2px solid rgba(232,199,102,0.5)',
          boxShadow: '0 0 0 1px rgba(251,243,217,0.2), 0 0 60px 20px rgba(212,175,55,0.25)',
          background:
            'radial-gradient(circle, rgba(251,243,217,0.22) 0%, rgba(212,175,55,0) 65%)',
        }}
      />

      {/* ── Second smaller inner ring ── */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.0, 2.2], opacity: [0, 0.85, 0] }}
        transition={{ duration: 0.75, delay: 0.18, ease: [0.16, 1, 0.36, 1] }}
        style={{
          width: 120,
          height: 120,
          border: '1.5px solid rgba(251,243,217,0.55)',
          background: 'transparent',
        }}
      />

      {/* ── Gold dust particles settling downward ── */}
      {PARTICLES.map((p, i) => {
        const rad = toRad(p.angle);
        const sx = Math.cos(rad) * p.r;
        const sy = Math.sin(rad) * p.r;
        // Settle: they drift outward and slightly down (gravity)
        const ex = sx * 1.55;
        const ey = sy * 1.55 + 40;
        return (
          <motion.div
            key={i}
            className="absolute top-1/2 left-1/2 rounded-full"
            initial={{ x: sx, y: sy, scale: 0, opacity: 0 }}
            animate={{
              x: [sx, ex],
              y: [sy, ey],
              scale: [0, 1.2, 0.3],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: p.dur,
              delay: p.delay,
              ease: [0.22, 1, 0.36, 1],
            }}
            style={{
              width: p.size,
              height: p.size,
              marginLeft: -(p.size / 2),
              marginTop: -(p.size / 2),
              background:
                i % 3 === 0
                  ? '#FBF3D9'
                  : i % 3 === 1
                  ? '#E8C766'
                  : '#D4AF37',
              boxShadow: `0 0 ${p.size * 2}px ${p.size}px rgba(232,199,102,0.7)`,
            }}
          />
        );
      })}

      {/* ── Toast notification ── */}
      <motion.div
        className="absolute bottom-16 left-1/2 -translate-x-1/2 glass-strong px-7 py-3.5 rounded-2xl text-center"
        initial={{ y: 24, opacity: 0, scale: 0.92 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -12, opacity: 0, scale: 0.95 }}
        transition={{ delay: 0.25, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        style={{
          border: '1px solid rgba(212,175,55,0.40)',
          boxShadow: '0 0 32px rgba(212,175,55,0.30), 0 8px 24px rgba(0,0,0,0.5)',
          whiteSpace: 'nowrap',
        }}
      >
        <span className="text-xl">✦</span>
        <span className="ml-2.5 font-serif italic text-ivory text-lg">
          {guestName ? (
            <>
              <span className="gold-foil-static">{guestName}</span>
              <span className="text-ivory/80"> just shared a moment</span>
            </>
          ) : (
            <span className="text-ivory/85">A new moment has arrived</span>
          )}
        </span>
      </motion.div>
    </motion.div>
  );
}
