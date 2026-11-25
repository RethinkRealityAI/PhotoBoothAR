/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A preview of the event's booth on the welcome page and the booth splash: a
 * modern phone (metal band, black bezel, Dynamic Island, edge-to-edge screen)
 * whose 9:16 booth view shows the event's booth screen (slow drift) — or a
 * softly shimmering silhouette — under the booth's own opening frame. The
 * app's bottom bar carries the way in ("Step into the booth"), centred.
 *
 * Motion is CSS only (platform.css `.vf-*`) and stops under
 * prefers-reduced-motion.
 */
import { Link } from 'react-router-dom';
import { Camera } from 'lucide-react';

/** The device's outer height per unit of width (band + bezel + a 9:20
 *  screen; platform.css `.vf-*` draws it in container units). Pages that size
 *  the phone from a height divide by this. */
export const VF_HEIGHT_PER_WIDTH = 2.124;

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
    <span className="relative flex h-7 w-7 items-center justify-center">
      <span className="vf-ring absolute inset-0 rounded-full" aria-hidden />
      <span className="absolute inset-0 rounded-full border-[1.5px] border-white/90" aria-hidden />
      <span className="flex h-[21px] w-[21px] items-center justify-center rounded-full bg-white text-[#1A1740] shadow-[0_0_24px_rgba(255,255,255,0.55)]">
        <Camera className="h-2.5 w-2.5" aria-hidden />
      </span>
    </span>
  );
  // The way in: one CTA in the event's own accent (.vf-cta), centred in the
  // app's bottom bar under the booth view, never over the frame art.
  const pill = (
    <span className="vf-cta inline-flex min-h-12 items-center gap-2 rounded-full px-6 font-sans text-[16px] font-bold">
      <span className="sc-rim" aria-hidden><span /></span>
      <Camera className="relative h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="relative whitespace-nowrap">{shutterLabel}</span>
    </span>
  );
  return (
    <div
      data-compact={compact ? '' : undefined}
      className={`vf-device relative mx-auto ${widthClass ?? (compact ? 'w-[104px]' : 'w-[min(64vw,250px)] lg:w-[min(22vw,280px)]')}`}
    >
      {/* Hardware: a brushed-metal band, side keys and a black glass bezel
          round an edge-to-edge screen (platform.css `.vf-*`). Theme-neutral:
          only the halo and the CTA pick up the event's colours. */}
      {!compact && (
        <span aria-hidden>
          <span className="vf-key vf-key-action" />
          <span className="vf-key vf-key-vol-up" />
          <span className="vf-key vf-key-vol-down" />
          <span className="vf-key vf-key-power" />
        </span>
      )}
      <div className="vf-band">
        <div className="vf-bezel">
          <div className="vf-screen">
            {/* Status bar + Dynamic Island: their own strip above the booth
                view, so the island never covers the host's frame art. */}
            <div className="vf-status" aria-hidden>
              {!compact && <span className="vf-time">9:41</span>}
              <span className="vf-island" />
              {!compact && (
                <span className="vf-sysicons">
                  <svg viewBox="0 0 18 12" className="vf-icon"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
                  <svg viewBox="0 0 16 12" className="vf-icon"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .4 10.4 10.4 0 0 0 .8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4a6.7 6.7 0 0 0-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Zm0 3.6c-.4 0-.8.2-1.1.4L8 11.6l1.1-1.8c-.3-.2-.7-.4-1.1-.4Z" /></svg>
                  <span className="vf-battery"><span /></span>
                </span>
              )}
            </div>
            {/* The booth view itself, 9:16 like the real booth canvas. */}
            <div className="vf-view relative overflow-hidden">
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
              {/* Focus brackets (the miniature only: the full phone stays clean). */}
              {compact && (
                <div className="vf-brackets absolute inset-[14%]" aria-hidden>
                  <span /><span /><span /><span />
                </div>
              )}
            </div>
            {/* The app's bottom bar: the CTA, centred, over the home indicator. */}
            <div className="vf-dock">
              {compact ? (
                <span aria-hidden className="flex items-center justify-center">{shutter}</span>
              ) : onShutter ? (
                <button type="button" onClick={onShutter} className="vf-shutter group">
                  {pill}
                </button>
              ) : (
                <Link to={to} state={linkState} aria-label={shutterLabel} className="vf-shutter group">
                  {pill}
                </Link>
              )}
              <span className="vf-home" aria-hidden />
            </div>
            {/* Cover-glass reflection over the whole display. */}
            <span className="vf-sheen" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}
