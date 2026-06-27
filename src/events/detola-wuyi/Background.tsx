/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detola & Wuyi ambient backdrop: deep-green bokeh wash + drifting gold dust +
 * twinkling sparkles. Pure CSS animation (reuses the global float-dust / twinkle
 * keyframes), GPU-friendly, pointer-events-none. Mirrors the gala backdrop's
 * shape but recoloured to the black/green/gold wedding palette.
 */
import { useMemo } from 'react';

interface Props {
  density?: number;
  sparkle?: number;
  className?: string;
}

export default function DetolaWuyiBackground({ density = 40, sparkle = 0.6, className = '' }: Props) {
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
        };
      }),
    [density, sparkle],
  );

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden gala-bg ${className}`} aria-hidden>
      {/* deep-green bokeh wash with warm gold highlights */}
      <div className="absolute -top-1/4 left-1/2 -translate-x-1/2 w-[90vw] h-[90vw] max-w-[1100px] max-h-[1100px] rounded-full blur-[140px]" style={{ background: 'rgba(31,74,52,0.30)' }} />
      <div className="absolute bottom-[-20%] left-[-10%] w-[60vw] h-[60vw] max-w-[700px] max-h-[700px] rounded-full blur-[130px]" style={{ background: 'rgba(212,175,55,0.14)' }} />
      <div className="absolute top-[20%] right-[-12%] w-[55vw] h-[55vw] max-w-[640px] max-h-[640px] rounded-full blur-[120px]" style={{ background: 'rgba(20,46,33,0.40)' }} />

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
            animation: `twinkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
