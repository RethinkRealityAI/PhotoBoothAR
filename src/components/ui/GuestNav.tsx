/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * GuestNav — the single, shared cross-page navigation on every guest screen
 * (Wall, Upload, My Photos, and reachable from the Booth). Every destination is
 * one tap away from anywhere.
 *
 * Responsive shape:
 *   • Desktop (sm+): a centered pill in the page header — never pushed to one
 *     side, shrinks to fit, scrolls rather than clipping.
 *   • Mobile (< sm): a fixed, bottom-center tab bar (rendered through a portal
 *     so it floats above everything and isn't trapped by an animated/transformed
 *     header). This makes hopping Wall → Photos → Booth feel like a native app.
 *
 * Pass `bottomOnMobile={false}` on task screens whose own controls live at the
 * bottom (e.g. the Upload wizard) so the tab bar never covers them.
 */
import { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import { CameraIcon, GalleryIcon, MediaStackIcon, IconProps } from './MediaIcons';

export type NavKey = 'booth' | 'wall' | 'upload' | 'photos';

interface Dest {
  key: NavKey;
  to: string;
  label: string;
  Icon: (p: IconProps) => ReactNode;
}

const DESTS: Dest[] = [
  { key: 'booth', to: '/booth', label: 'Booth', Icon: CameraIcon },
  { key: 'wall', to: '/wall', label: 'Wall', Icon: GalleryIcon },
  { key: 'upload', to: '/upload', label: 'Upload', Icon: (p) => <UploadCloud width={p.size} height={p.size} strokeWidth={1.7} /> },
  { key: 'photos', to: '/me', label: 'Photos', Icon: MediaStackIcon },
];

function keyForPath(path: string, basePath: string): NavKey | null {
  // Strip the tenant prefix (/e/<slug>) so matching works at runtime and on
  // legacy root builds alike.
  const rel = basePath && path.startsWith(basePath) ? path.slice(basePath.length) : path;
  if (rel.startsWith('/wall')) return 'wall';
  if (rel.startsWith('/upload')) return 'upload';
  if (rel.startsWith('/me') || rel.startsWith('/gallery')) return 'photos';
  if (rel.startsWith('/booth') || rel.startsWith('/experience') || rel === '' || rel === '/') return 'booth';
  return null;
}

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
  const active = current ?? keyForPath(pathname, basePath);

  const inlinePill = (
    <nav
      className="glass rounded-full p-1 flex items-center gap-0.5 max-w-full overflow-x-auto hide-scrollbar"
      style={{ border: '1px solid rgba(var(--accent-rgb),0.2)' }}
      aria-label="Primary"
    >
      {DESTS.map((d) => {
        const on = active === d.key;
        return (
          <Link
            key={d.key}
            to={d.to}
            aria-current={on ? 'page' : undefined}
            title={d.label}
            className={`flex items-center gap-1.5 rounded-full px-3 py-2 shrink-0 font-label uppercase tracking-luxe text-[10px] transition-all active:scale-95 ${
              on ? 'bg-foil text-noir-900 glow-accent' : 'text-champagne/65 hover:text-gold-300'
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

      {/* Mobile bottom tab bar — portalled to <body> so it floats above chrome. */}
      {bottomOnMobile && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="sm:hidden fixed left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-1.5rem)] max-w-sm flex justify-center pointer-events-none"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
          >
            <nav
              className="glass-strong rounded-2xl px-1.5 py-1.5 flex items-stretch justify-between gap-1 w-full pointer-events-auto shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)]"
              style={{ border: '1px solid rgba(var(--accent-rgb),0.28)' }}
              aria-label="Primary"
            >
              {DESTS.map((d) => {
                const on = active === d.key;
                return (
                  <Link
                    key={d.key}
                    to={`${basePath}${d.to}`}
                    aria-current={on ? 'page' : undefined}
                    className={`flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-2 transition-all active:scale-95 ${
                      on ? 'bg-foil text-noir-900 glow-accent' : 'text-champagne/60 hover:text-gold-300'
                    }`}
                  >
                    <d.Icon size={19} />
                    <span className="font-label uppercase tracking-wide text-[8px] leading-none">{d.label}</span>
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
