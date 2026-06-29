/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GoldFrameCard — the ornate, animated gold-border card used for premium
 * "first impression" moments (booth entrance, the upload password gate).
 *
 * A rotating conic-gradient sheen sweeps light around a glowing ~2px gold ring,
 * with a static inner hairline double-rule and four corner flourishes. Pass the
 * card contents as children.
 */
import { ReactNode } from 'react';

/** Small ornate gold corner flourish. */
function Corner({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={`absolute w-8 h-8 text-gold-400/70 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 20 C3 10.6 10.6 3 20 3" />
      <path d="M3 13 C3 7.5 7.5 3 13 3" strokeWidth="0.7" />
      <circle cx="10" cy="10" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function GoldFrameCard({
  children,
  className = '',
  contentClassName = 'px-8 py-12',
}: {
  children: ReactNode;
  /** Applied to the outer positioned wrapper (e.g. width constraints). */
  className?: string;
  /** Applied to the inner content padding container. */
  contentClassName?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {/* soft outer glow */}
      <div className="absolute -inset-3 rounded-[2.6rem] bg-gold-400/10 blur-2xl pointer-events-none" />

      {/* animated gold-border card */}
      <div className="relative rounded-[2rem] overflow-hidden shadow-[0_24px_90px_rgba(0,0,0,0.62)]">
        {/* rotating conic sheen — the animated gold border */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[1200px]"
          style={{
            background:
              'conic-gradient(from 0deg, #9A6F1C 0deg, #B8860B 38deg, #FBF3D9 66deg, #E8C766 94deg, #B8860B 140deg, #8A6314 200deg, #D4AF37 248deg, #FBF3D9 286deg, #B8860B 322deg, #9A6F1C 360deg)',
            animation: 'slow-spin 9s linear infinite',
          }}
        />
        {/* inner fill leaves a glowing ~2px ring */}
        <div className="absolute inset-[2px] rounded-[1.9rem] bg-noir-900/82 backdrop-blur-sm" />
        {/* static inner hairline for an ornate double-rule */}
        <div className="absolute inset-[11px] rounded-[1.5rem] border border-gold-400/20 pointer-events-none" />

        {/* content */}
        <div className={`relative flex flex-col items-center text-center ${contentClassName}`}>
          <Corner className="top-3.5 left-3.5" />
          <Corner className="top-3.5 right-3.5 rotate-90" />
          <Corner className="bottom-3.5 right-3.5 rotate-180" />
          <Corner className="bottom-3.5 left-3.5 -rotate-90" />
          {children}
        </div>
      </div>
    </div>
  );
}
