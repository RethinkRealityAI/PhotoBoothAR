/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unknown platform address. Used to redirect silently to "/", which told a
 * visitor nothing — a mistyped event link looked like the event did not exist
 * and a guessed "/pricing" dropped them at the top of the homepage. Plausible
 * guesses now go straight to the real page (lib/notFound.ts); everything else
 * gets this page: what happened, the likely fix, and the ways on.
 *
 * Runtime (platform) builds only — legacy single-event builds keep their
 * redirect to "/". Netlify still answers 200 for SPA routes, so the page marks
 * itself noindex instead.
 */
import { Link, Navigate, useLocation } from 'react-router-dom';
import { BookOpen, Home, LogIn } from 'lucide-react';
import { notFoundAlias } from '../lib/notFound';
import { usePageTitle } from '../lib/usePageTitle';
import { useNoIndex } from './sales/components/pageMeta';

const primary =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foil px-6 py-3 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98]';
const secondary =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08]';

export default function NotFound() {
  const { pathname } = useLocation();
  const alias = notFoundAlias(pathname);
  if (alias !== null) return <Navigate to={alias} replace />;
  return <NotFoundPage pathname={pathname} />;
}

function NotFoundPage({ pathname }: { pathname: string }) {
  usePageTitle('Page not found — Beamwall');
  useNoIndex();
  return (
    <main className="h-full w-full app-bg flex items-center justify-center px-4 py-12 overflow-y-auto">
      <div className="w-full max-w-sm animate-rise-in">
        <div className="liquid-glass rounded-3xl px-7 py-10 text-center shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
          <Link to="/" className="block font-serif text-4xl font-semibold tracking-wide text-foil-static">
            Beamwall
          </Link>
          <p className="mt-6 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70">Error 404</p>
          <h1 className="mt-2 font-serif text-2xl text-brand-fg">We can’t find that page</h1>
          <p className="mt-3 break-words text-sm leading-relaxed text-brand-muted/80">
            Nothing lives at <span className="font-mono text-[12px] text-brand-fg/90">{pathname}</span>. It may have
            moved, or the address has a typo.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-brand-muted/80">
            Looking for an event’s photo booth? Scan its QR code again, or ask the host for the link.
          </p>
          <nav aria-label="Ways on" className="mt-8 flex flex-col gap-3">
            <Link to="/" className={primary}>
              <Home className="h-4 w-4" aria-hidden />
              Go to the homepage
            </Link>
            <Link to="/guides" className={secondary}>
              <BookOpen className="h-4 w-4" aria-hidden />
              Browse the guides
            </Link>
            <Link to="/login" className={secondary}>
              <LogIn className="h-4 w-4" aria-hidden />
              Sign in
            </Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
