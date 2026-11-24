/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BoothTopBar — the booth's floating top chrome.
 *
 * The old header was a wrapping row of five labelled glass pills (Wall ·
 * Photos · Upload · Share · Hide) plus the challenge selector and the emblem,
 * stacked above the viewfinder. On a phone it wrapped to two rows and ate the
 * top of the frame — the single most overwhelming thing on the guest's screen,
 * and the reason the frame they were choosing was half-hidden.
 *
 * Now: the emblem floats top-left, and a small cluster of glass circles floats
 * top-right, with the four destinations collapsed behind one "more" circle
 * that opens a floating menu. Same reachability, a fraction of the noise, and
 * the viewfinder is unobstructed.
 *
 * Links are react-router <Link>s, not raw anchors: a full page load in the
 * booth costs the guest a fresh camera-permission round-trip on venue wifi.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Eye, EyeOff, MoreHorizontal, ScrollText, SwitchCamera, UploadCloud } from 'lucide-react';
import { GalleryIcon, MediaStackIcon } from '../ui/MediaIcons';
import ShareButton from '../ui/ShareButton';
import ReportIssueButton from '../support/ReportIssueButton';
import { haptic } from '../../lib/haptics';

/** `/e/<slug>` (or `''` in a legacy single-event build) → the slug, or null. */
function slugFromBasePath(basePath: string): string | null {
  const m = /^\/e\/([^/]+)/.exec(basePath);
  return m ? m[1] : null;
}

/** Menu row in the compact (platform) bar: sentence case, readable size. */
const COMPACT_ITEM = 'pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-3 font-sans text-[14px] text-brand-fg/90 hover:bg-white/[0.06]';

/** A floating glass circle — the booth's only chrome shape. */
export function GlassCircle({
  onClick, label, children, active = false,
}: {
  onClick?: () => void;
  label: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="pressable liquid-glass-raised flex h-11 w-11 items-center justify-center rounded-full"
      style={active ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : undefined}
    >
      {children}
    </button>
  );
}

export interface BoothTopBarProps {
  basePath: string;
  uiHidden: boolean;
  onToggleUi: () => void;
  /** Rendered inline before the cluster (the emblem + challenge selector). */
  leading?: ReactNode;
  recording: boolean;
  recordingMs: number;
  /** Front/back camera. Hidden when the device has only one. */
  canFlip: boolean;
  onFlip: () => void;
  /**
   * Platform booths only: the minimal bar — a back circle on the left, then
   * (right) an optional extra circle (the self-timer), flip and "more", with
   * "Hide controls" tucked into the more menu. Absent ⇒ exactly today's bar,
   * which is what the legacy single-event sites keep.
   */
  compact?: { backTo: string; extra?: ReactNode };
  /** World mode (8th Wall world engine): a "Licences" item in the menu, as its licence asks. */
  licencesHref?: string;
}

export default function BoothTopBar({
  basePath, uiHidden, onToggleUi, leading, recording, recordingMs, canFlip, onFlip, compact, licencesHref,
}: BoothTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const boothSlug = slugFromBasePath(basePath);

  // Close on outside press or Escape — a menu that can only be dismissed by
  // hitting its own trigger is a trap on a touch screen.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const DESTS = [
    { to: `${basePath}/wall`, label: 'Live wall', Icon: GalleryIcon },
    { to: `${basePath}/me`, label: 'My photos', Icon: MediaStackIcon },
    { to: `${basePath}/upload`, label: 'Upload', Icon: UploadCloud },
  ];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 px-3 pt-safe-top [--safe-top:0.75rem]">
      <div className="pointer-events-auto flex items-center gap-2">
        {compact && !recording && (
          <Link
            to={compact.backTo}
            aria-label="Back to the event"
            title="Back to the event"
            onClick={() => haptic('tap')}
            className="pressable liquid-glass-raised flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
        )}
        {leading}
      </div>

      <div ref={wrapRef} className="pointer-events-auto relative flex items-center gap-2">
        {recording ? (
          // Recording collapses the chrome to one unmistakable indicator —
          // nothing else matters while the camera is rolling.
          <div className="liquid-glass-raised flex items-center gap-2 rounded-full px-3.5 py-2.5">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-label text-[10px] uppercase tracking-wide text-red-300">
              {Math.floor(recordingMs / 1000)}s
            </span>
          </div>
        ) : (
          <>
            {compact?.extra}
            {canFlip && (
              <GlassCircle label="Switch camera (front / back)" onClick={() => { haptic('toggle'); onFlip(); }}>
                <SwitchCamera className="h-[18px] w-[18px]" />
              </GlassCircle>
            )}

            {!compact && (
              <GlassCircle
                label={uiHidden ? 'Show controls' : 'Hide controls — see the full frame'}
                onClick={() => { haptic('toggle'); onToggleUi(); }}
              >
                {uiHidden ? <Eye className="h-[18px] w-[18px]" /> : <EyeOff className="h-[18px] w-[18px]" />}
              </GlassCircle>
            )}

            <GlassCircle
              label="More"
              active={menuOpen}
              onClick={() => { haptic('tap'); setMenuOpen((o) => !o); }}
            >
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </GlassCircle>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className={compact
                    ? 'liquid-glass-raised absolute right-0 top-14 z-40 flex w-52 flex-col gap-0.5 rounded-2xl p-1.5'
                    : 'liquid-glass-raised absolute right-0 top-14 z-40 flex w-44 flex-col gap-0.5 rounded-2xl p-1.5'}
                  // `.liquid-glass-raised` sets `position: relative` in the same
                  // utilities layer and out-orders `absolute`, so the open menu
                  // dropped into the row and shoved the circles sideways.
                  style={compact ? { position: 'absolute' } : undefined}
                >
                  {compact && (
                    <button
                      type="button"
                      onClick={() => { haptic('toggle'); setMenuOpen(false); onToggleUi(); }}
                      className={COMPACT_ITEM}
                    >
                      {uiHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      {uiHidden ? 'Show controls' : 'Hide controls'}
                    </button>
                  )}
                  {DESTS.map((d) => (
                    <Link
                      key={d.to}
                      to={d.to}
                      onClick={() => { haptic('tap'); setMenuOpen(false); }}
                      className={compact ? COMPACT_ITEM : 'pressable flex min-h-11 items-center gap-3 rounded-xl px-3 font-label text-[10px] uppercase tracking-luxe text-brand-fg/85 hover:bg-white/[0.06]'}
                    >
                      <d.Icon size={16} />
                      {d.label}
                    </Link>
                  ))}
                  <ShareButton
                    label="Share"
                    iconSize={16}
                    className={compact ? COMPACT_ITEM : 'pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-3 font-label text-[10px] uppercase tracking-luxe text-brand-fg/85 hover:bg-white/[0.06]'}
                  />
                  {/* A guest whose booth just broke is the highest-value report
                      we can get, and they have no account to file it from.
                      Only when the path carries a real event slug: in a legacy
                      VITE_EVENT build basePath is '', and those three frozen
                      single-event sites get no new chrome — nor would a ticket
                      from one have an org to route to. */}
                  {licencesHref && (
                    <a
                      href={licencesHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => { haptic('tap'); setMenuOpen(false); }}
                      className={compact ? COMPACT_ITEM : 'pressable flex min-h-11 items-center gap-3 rounded-xl px-3 font-label text-[10px] uppercase tracking-luxe text-brand-fg/85 hover:bg-white/[0.06]'}
                    >
                      <ScrollText size={16} />
                      Licences
                    </a>
                  )}
                  {boothSlug !== null && (
                    <ReportIssueButton
                      label="Report a problem"
                      iconSize={16}
                      prefill={{ source: 'guest_booth', eventSlug: boothSlug }}
                      className={compact ? COMPACT_ITEM : 'pressable flex min-h-11 w-full items-center gap-3 rounded-xl px-3 font-label text-[10px] uppercase tracking-luxe text-brand-fg/85 hover:bg-white/[0.06]'}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
