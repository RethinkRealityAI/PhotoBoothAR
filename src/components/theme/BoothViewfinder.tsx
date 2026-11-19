/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A preview of the event's booth on the welcome page: a glass phone whose
 * screen shows the newest guest photo (slow drift) — or, before anyone has
 * snapped, a softly shimmering silhouette — under the booth's own opening
 * frame. Its shutter IS the "Step into the booth" button.
 *
 * Motion is CSS only (platform.css `.vf-*`) and stops under
 * prefers-reduced-motion.
 */
import { Link } from 'react-router-dom';
import { Camera } from 'lucide-react';

export default function BoothViewfinder({
  to,
  frameUrl,
  previewUrl,
  previewAlt,
}: {
  to: string;
  /** The booth's opening frame art (a border experience), drawn over the screen. */
  frameUrl?: string;
  /** The newest guest photo; absent = the empty-state silhouette. */
  previewUrl?: string;
  previewAlt?: string;
}) {
  return (
    <div className="vf-device relative mx-auto w-[min(76vw,300px)] lg:w-[min(26vw,330px)]">
      <div className="sc-glass-strong rounded-[42px] p-2.5">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[34px] bg-[#0E0C2A]">
          {previewUrl ? (
            <img src={previewUrl} alt={previewAlt ?? ''} decoding="async" className="vf-drift absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0" aria-hidden>
              <div className="vf-empty absolute inset-0" />
              <svg viewBox="0 0 90 160" className="absolute inset-x-0 bottom-0 h-[78%] w-full" preserveAspectRatio="xMidYMax meet">
                <defs>
                  <linearGradient id="vf-sil" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.30" />
                    <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.06" />
                  </linearGradient>
                </defs>
                <ellipse cx="45" cy="62" rx="17" ry="21" fill="url(#vf-sil)" />
                <path d="M8 160 C10 120 24 98 45 98 C66 98 80 120 82 160 Z" fill="url(#vf-sil)" />
              </svg>
              <div className="vf-shimmer absolute inset-0" />
            </div>
          )}
          {frameUrl && (
            <img src={frameUrl} alt="" decoding="async" className="absolute inset-0 h-full w-full object-fill" />
          )}
          {/* Focus brackets: this is a camera. */}
          <div className="vf-brackets absolute inset-[14%]" aria-hidden>
            <span /><span /><span /><span />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" aria-hidden />
          <Link
            to={to}
            aria-label="Step into the booth"
            className="vf-shutter group absolute inset-x-0 bottom-4 mx-auto flex w-max flex-col items-center gap-2"
          >
            <span className="relative flex h-[72px] w-[72px] items-center justify-center">
              <span className="vf-ring absolute inset-0 rounded-full" aria-hidden />
              <span className="absolute inset-0 rounded-full border-[3px] border-white/90" aria-hidden />
              <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-white text-[#1A1740] shadow-[0_0_24px_rgba(255,255,255,0.55)] transition-transform group-hover:scale-105 group-active:scale-95">
                <Camera className="h-6 w-6" aria-hidden />
              </span>
            </span>
            <span className="rounded-full bg-white/90 px-4 py-1.5 font-sans text-[14px] font-semibold text-[#1A1740] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.6)]">
              Step into the booth
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
