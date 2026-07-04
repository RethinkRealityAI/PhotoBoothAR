/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform marketing landing page. Clean, premium branding — "Beamwall"
 * wordmark, hero, and three feature cards that deep-link into the live,
 * no-sign-in demo (see /demo). Fully responsive; the page flows and the window
 * scrolls, so nothing is clipped on any viewport.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Camera, Sparkles, BookHeart, type LucideIcon } from 'lucide-react';
import { DEMO } from './Demo';

interface Feature {
  to: string;
  icon: LucideIcon;
  title: string;
  copy: string;
  cta: string;
}

const FEATURES: Feature[] = [
  {
    to: DEMO.booth,
    icon: Camera,
    title: 'AR Photo Booth + Live Wall',
    copy:
      'Guests scan a QR code and step into an AR photo booth in their browser — no app to download. Every shot beams onto a cinematic live wall the whole room watches.',
    cta: 'Try the booth',
  },
  {
    to: '/signup',
    icon: Sparkles,
    title: 'AI Event Studio',
    copy:
      'Describe your vibe and design frames, 3D props and wall styling in minutes. AI generates the magic; you approve what goes live.',
    cta: 'Start creating',
  },
  {
    to: DEMO.finishedCard,
    icon: BookHeart,
    title: 'Video Guestbook & Greeting Cards',
    copy:
      'Guests leave short video messages and signed greeting cards you keep forever — a keepsake film, ready the morning after.',
    cta: 'See a card',
  },
];

function FeatureCard({ f }: { f: Feature }) {
  const Icon = f.icon;
  return (
    <Link
      to={f.to}
      className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-8 text-left shadow-[0_16px_60px_rgba(0,0,0,0.4)] transition duration-300 hover:-translate-y-1 hover:border-[color:var(--color-accent)]/40 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/50"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-foil text-noir-900 glow-accent transition group-hover:scale-105">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-5 font-serif text-xl text-accent">{f.title}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-muted/80">{f.copy}</p>
      <span className="mt-6 inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg">
        {f.cta}
        <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="min-h-[100dvh] w-full app-bg text-brand-fg">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4">
          <span className="font-serif text-2xl font-semibold tracking-wide text-foil-static">Beamwall</span>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/demo"
              className="rounded-full px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/80 transition hover:text-brand-fg"
            >
              Live demo
            </Link>
            <Link
              to="/login"
              className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
            >
              Sign in
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center justify-center py-12 text-center sm:py-16">
          <h1 className="max-w-3xl font-serif text-5xl leading-tight text-shadow-lux sm:text-6xl">
            Your event, in <span className="text-foil-static">augmented reality</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-brand-muted/85 sm:text-lg">
            Give every guest a magical AR photo booth in their pocket — no app to download. Photos
            beam onto a live wall styled with frames and 3D magic you design in minutes with AI.
          </p>

          <div className="mt-10 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:gap-4">
            <Link
              to="/signup"
              className="w-full rounded-full bg-foil px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition hover:brightness-110 active:scale-[0.98] sm:w-auto"
            >
              Create your event
            </Link>
            <Link
              to="/demo"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08] active:scale-[0.98] sm:w-auto"
            >
              See the live demo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Feature cards */}
          <div className="mt-16 grid w-full gap-5 sm:mt-20 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} f={f} />
            ))}
          </div>
        </main>

        {/* Footer */}
        <footer className="pb-4 pt-10 text-center">
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
            Loved at weddings, galas &amp; milestone birthdays.
          </p>
        </footer>
      </div>
    </div>
  );
}
