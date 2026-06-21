/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ambient gala backdrop: warm bokeh wash + drifting gold dust + twinkling
 * sparkles. Pure CSS animation, GPU-friendly, pointer-events-none so it never
 * blocks UI. Slightly more prominent now for a magical first impression.
 */
import { useMemo } from 'react';

interface Props {
  /** rising-dust particle count — lower on mobile/booth, higher on the wall */
  density?: number;
  /** scales the twinkle-sparkle count relative to density (0 = none) */
  sparkle?: number;
  className?: string;
}

export default function GalaBackground({ density = 40, sparkle = 0.6, className = '' }: Props) {
  const particles = useMemo(
    () =>
      Array.from({ length: density }).map((_, i) => {
        const size = 1.5 + Math.random() * 4;
        return {
          id: i,
          left: Math.random() * 100,
          size,
          delay: Math.random() * 16,
          duration: 12 + Math.random() * 16,
          opacity: 0.3 + Math.random() * 0.6,
          drift: (Math.random() * 2 - 1) * 40,
        };
      }),
    [density],
  );

  const sparkles = useMemo(
    () =>
      Array.from({ length: Math.round(density * sparkle) }).map((_, i) => {
        const size = 2 + Math.random() * 3;
        return {
          id: i,
          left: Math.random() * 100,
          top: Math.random() * 100,
          size,
          delay: Math.random() * 6,
          duration: 2.6 + Math.random() * 3.4,
          peak: (0.6 + Math.random() * 0.4).toFixed(2),
        };
      }),
    [density, sparkle],
  );

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden gala-bg ${className}`} aria-hidden>
      {/* soft golden bokeh orbs */}
      <div className="absolute -top-1/4 left-1/2 -translate-x-1/2 w-[90vw] h-[90vw] max-w-[1100px] max-h-[1100px] rounded-full bg-gold-400/12 blur-[140px]" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[60vw] h-[60vw] max-w-[700px] max-h-[700px] rounded-full bg-gold-600/14 blur-[130px]" />
      <div className="absolute top-[20%] right-[-12%] w-[55vw] h-[55vw] max-w-[640px] max-h-[640px] rounded-full bg-gold-200/10 blur-[120px]" />

      {/* drifting gold dust (rises bottom → top) */}
      {particles.map((p) => (
        <span
          key={`d${p.id}`}
          className="absolute bottom-[-12px] rounded-full"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            background: 'radial-gradient(circle, #FBF3D9 0%, #E8C766 45%, rgba(212,175,55,0) 70%)',
            boxShadow: '0 0 8px rgba(232,199,102,0.85)',
            // CSS var consumed by the float-dust keyframe's horizontal drift fallback
            ['--drift' as string]: `${p.drift}px`,
            animation: `float-dust ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}

      {/* twinkling sparkles (stationary, pulse in place) */}
      {sparkles.map((s) => (
        <span
          key={`s${s.id}`}
          className="absolute rounded-full"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            background: 'radial-gradient(circle, #FFFDF2 0%, #F0DC9A 55%, rgba(212,175,55,0) 72%)',
            boxShadow: '0 0 10px rgba(251,243,217,0.9)',
            ['--tw-peak' as string]: s.peak,
            animation: `twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
