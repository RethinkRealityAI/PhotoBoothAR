/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GuestNav — the single, shared cross-page navigation on every guest screen
 * (Wall, Challenges, Upload, My Photos, and reachable from the Booth). Every
 * destination is one tap away from anywhere.
 *
 * Responsive shape:
 *   • Desktop (sm+): a centered pill in the page header — never pushed to one
 *     side, shrinks to fit, scrolls rather than clipping.
 *   • Mobile (< sm): a fixed, bottom-center tab bar with a premium liquid-glass
 *     finish, rendered through a portal so it floats above everything and isn't
 *     trapped by an animated/transformed header — like a native app.
 *
 * Links are always prefixed with the event basePath (useEvent), so it works at
 * `/e/<slug>/*` runtime and on legacy root builds. The Challenges tab only
 * appears when the event actually has active challenges.
 *
 * Pass `bottomOnMobile={false}` on task screens whose own controls live at the
 * bottom (e.g. the Upload wizard) so the tab bar never covers them.
 */
import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { UploadCloud, Trophy } from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import { CameraIcon, GalleryIcon, MediaStackIcon, IconProps } from './MediaIcons';
import { keyForPath, type NavKey } from './navRouting';

export type { NavKey };

interface Dest {
  key: NavKey;
  to: string;
  label: string;
  Icon: (p: IconProps) => ReactNode;
}

/** Order: Booth · Wall · Challenges · Photos · Upload. */
const DESTS: Dest[] = [
  { key: 'booth', to: '/booth', label: 'Booth', Icon: CameraIcon },
  { key: 'wall', to: '/wall', label: 'Wall', Icon: GalleryIcon },
  { key: 'challenges', to: '/challenges', label: 'Challenges', Icon: (p) => <Trophy width={p.size} height={p.size} strokeWidth={1.7} /> },
  { key: 'photos', to: '/me', label: 'Photos', Icon: MediaStackIcon },
  { key: 'upload', to: '/upload', label: 'Upload', Icon: (p) => <UploadCloud width={p.size} height={p.size} strokeWidth={1.7} /> },
];

interface Props {
  /** Force the active destination; otherwise inferred from the route. */
  current?: NavKey;
  /** Page-specific controls rendered on the same centered row (desktop). */
  extras?: ReactNode;
  /** When true (default), mobile shows a fixed bottom tab bar instead of the
   *  inline pill. Set false on screens with their own bottom controls. */
  bottomOnMobile?: boolean;
  className?: string;
}

export default function GuestNav({ current, extras, bottomOnMobile = true, className = '' }: Props) {
  const { pathname } = useLocation();
  const { basePath } = useEvent();

  // Challenges tab only shows when the event has them enabled + authored.
  const showChallengesSetting = useStore((s) => s.wallSettings.showChallenges);
  const challenges = useStore((s) => s.challenges);
  const challengesLoaded = useStore((s) => s.challengesLoaded);
  const fetchChallenges = useStore((s) => s.fetchChallenges);
  useEffect(() => {
    if (!challengesLoaded) fetchChallenges(true);
  }, [challengesLoaded, fetchChallenges]);
  const hasChallenges = showChallengesSetting !== false && challenges.some((c) => c.active);

  const active = current ?? keyForPath(pathname, basePath);
  const dests = DESTS.filter((d) => d.key !== 'challenges' || hasChallenges || active === 'challenges');

  const inlinePill = (
    <nav
      className="liquid-glass rounded-full p-1 flex items-center gap-0.5 max-w-full overflow-x-auto hide-scrollbar"
      aria-label="Primary"
    >
      {dests.map((d) => {
        const on = active === d.key;
        return (
          <Link
            key={d.key}
            to={`${basePath}${d.to}`}
            aria-current={on ? 'page' : undefined}
            title={d.label}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 shrink-0 font-label uppercase tracking-luxe text-[10px] transition-all active:scale-95 ${
              on ? 'bg-foil text-noir-900 glow-accent' : 'text-champagne/70 hover:text-gold-300'
            }`}
          >
            <d.Icon size={15} />
            <span className="hidden sm:inline">{d.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Inline pill — desktop always; also mobile when bottom bar is disabled. */}
      <div
        className={`${bottomOnMobile ? 'hidden sm:flex' : 'flex'} flex-wrap items-center justify-center gap-2 max-w-full ${className}`}
      >
        {inlinePill}
        {extras}
      </div>

      {/* Mobile bottom tab bar — liquid glass, portalled to <body>. */}
      {bottomOnMobile && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="sm:hidden fixed left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-1.25rem)] max-w-md flex justify-center pointer-events-none"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.6rem)' }}
          >
            <nav
              className="liquid-glass rounded-2xl px-1.5 py-1.5 flex items-stretch justify-between gap-0.5 w-full pointer-events-auto"
              aria-label="Primary"
            >
              {dests.map((d) => {
                const on = active === d.key;
                return (
                  <Link
                    key={d.key}
                    to={`${basePath}${d.to}`}
                    aria-current={on ? 'page' : undefined}
                    className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 rounded-xl py-2 px-0.5 transition-all active:scale-95 ${
                      on ? 'bg-foil text-noir-900 glow-accent' : 'text-champagne/65 hover:text-gold-300'
                    }`}
                  >
                    <d.Icon size={19} />
                    <span className="font-label uppercase tracking-wide text-[7.5px] leading-none w-full text-center truncate">{d.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>,
          document.body,
        )}
    </>
  );
}
