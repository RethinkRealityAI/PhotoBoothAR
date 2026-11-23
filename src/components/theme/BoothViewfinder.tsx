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
  previewCrop,
  compact = false,
  onShutter,
  shutterLabel = 'Step into the booth',
  widthClass,
  linkState,
}: {
  /** Where the shutter goes (a link), unless `onShutter` is given. */
  to: string;
  /** The booth's opening frame art (a border experience), drawn over the screen. */
  frameUrl?: string;
  /** The newest guest photo; absent = the empty-state silhouette. */
  previewUrl?: string;
  previewAlt?: string;
  /** The preview is a photo strip: show only this panel (scenePage.stripPanelCrop). */
  previewCrop?: { cx: number; cy: number; scale: number };
  /** The host picker's miniature: small, still, and not a link (a click in
   *  the preview must never navigate the host into the booth). */
  compact?: boolean;
  /** The booth splash: the shutter is a button that starts the camera. */
  onShutter?: () => void;
  shutterLabel?: string;
  /** Overrides the device's default width. */
  widthClass?: string;
  /** Router state the shutter link navigates with (the welcome page tells
   *  the booth the guest already saw the camera line — lib/guestFlow.ts). */
  linkState?: unknown;
}) {
  const shutter = (
    <span className={`relative flex items-center justify-center ${compact ? 'h-7 w-7' : 'h-[72px] w-[72px]'}`}>
      <span className="vf-ring absolute inset-0 rounded-full" aria-hidden />
      <span className={`absolute inset-0 rounded-full border-white/90 ${compact ? 'border-[1.5px]' : 'border-[3px]'}`} aria-hidden />
      <span className={`flex items-center justify-center rounded-full bg-white text-[#1A1740] shadow-[0_0_24px_rgba(255,255,255,0.55)] transition-transform group-hover:scale-105 group-active:scale-95 ${compact ? 'h-[21px] w-[21px]' : 'h-[54px] w-[54px]'}`}>
        <Camera className={compact ? 'h-2.5 w-2.5' : 'h-6 w-6'} aria-hidden />
      </span>
    </span>
  );
  const pill = (
    <span className="rounded-full bg-white/90 px-4 py-1.5 font-sans text-[14px] font-semibold text-[#1A1740] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.6)]">
      {shutterLabel}
    </span>
  );
  return (
    <div
      data-compact={compact ? '' : undefined}
      className={`vf-device relative mx-auto ${widthClass ?? (compact ? 'w-[104px]' : 'w-[min(76vw,300px)] lg:w-[min(26vw,330px)]')}`}
    >
      <div className={`sc-glass-strong ${compact ? 'rounded-[18px] p-1' : 'rounded-[42px] p-2.5'}`}>
        <span className="sc-rim" aria-hidden><span /></span>
        <div className={`relative aspect-[9/16] overflow-hidden bg-[#0E0C2A] ${compact ? 'rounded-[14px]' : 'rounded-[34px]'}`}>
          {previewUrl ? (
            <div className="vf-drift absolute inset-0">
              <img
                src={previewUrl}
                alt={previewAlt ?? ''}
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
                style={previewCrop ? {
                  transformOrigin: `${previewCrop.cx * 100}% ${previewCrop.cy * 100}%`,
                  transform: `translate(${(0.5 - previewCrop.cx) * 100}%, ${(0.5 - previewCrop.cy) * 100}%) scale(${previewCrop.scale})`,
                } : undefined}
              />
            </div>
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
          {compact ? (
            <span aria-hidden className="absolute inset-x-0 bottom-2 mx-auto flex w-max flex-col items-center">
              {shutter}
            </span>
          ) : onShutter ? (
            <button
              type="button"
              onClick={onShutter}
              className="vf-shutter group absolute inset-x-0 bottom-4 mx-auto flex w-max flex-col items-center gap-2"
            >
              {shutter}
              {pill}
            </button>
          ) : (
            <Link
              to={to}
              state={linkState}
              aria-label={shutterLabel}
              className="vf-shutter group absolute inset-x-0 bottom-4 mx-auto flex w-max flex-col items-center gap-2"
            >
              {shutter}
              {pill}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
