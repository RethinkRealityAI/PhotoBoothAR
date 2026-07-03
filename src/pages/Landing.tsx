/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Platform marketing landing page (placeholder). Clean, static, neutral
 * premium branding — "Beamwall" wordmark, hero, three feature cards.
 */
import { Link } from 'react-router-dom';

const FEATURES = [
  {
    title: 'AR Photo Booth + Live Wall',
    copy:
      'Guests scan a QR code and step into an AR photo booth in their browser — no app to download. Every shot beams onto a cinematic live wall the whole room watches.',
  },
  {
    title: 'AI Event Studio',
    copy:
      'Describe your vibe and design frames, 3D props and wall styling in minutes. AI generates the magic; you approve what goes live.',
  },
  {
    title: 'Video Guestbook & Greeting Cards',
    copy:
      'Guests leave short video messages and signed greeting cards you keep forever — a keepsake film, ready the morning after.',
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen w-full app-bg text-brand-fg overflow-y-auto">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <span className="font-serif text-2xl font-semibold tracking-wide text-foil-static">
            Beamwall
          </span>
          <nav className="flex items-center gap-3">
            <Link
              to="/login"
              className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
            >
              Sign in
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <h1 className="max-w-3xl font-serif text-5xl leading-tight text-shadow-lux sm:text-6xl">
            Your event, in{' '}
            <span className="text-foil-static">augmented reality</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-brand-muted/85 sm:text-lg">
            Give every guest a magical AR photo booth in their pocket — no app to download. Photos
            beam onto a live wall styled with frames and 3D magic you design in minutes with AI.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <Link
              to="/signup"
              className="rounded-full bg-foil px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition active:scale-[0.98]"
            >
              Create your event
            </Link>
            <Link
              to="/login"
              className="rounded-full border border-white/15 bg-white/[0.04] px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08] active:scale-[0.98]"
            >
              Sign in
            </Link>
          </div>

          {/* Feature cards */}
          <div className="mt-20 grid w-full gap-5 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="glass rounded-2xl px-6 py-8 text-left shadow-[0_16px_60px_rgba(0,0,0,0.4)]"
              >
                <h3 className="font-serif text-xl text-accent">{f.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-brand-muted/80">{f.copy}</p>
              </div>
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
