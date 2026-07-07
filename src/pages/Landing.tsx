/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beamwall marketing landing page — hero, a live themed showcase, feature
 * cards, transparent per-event pricing, and clear CTAs. Honest and
 * dark-pattern-free: real prices, no fake urgency, every CTA leads to sign-up.
 */
import { Link } from 'react-router-dom';
import { Camera, Sparkles, Video, Check } from 'lucide-react';
import { EVENT_TEMPLATES } from '../lib/eventTemplates';
import TemplatePreview from '../components/ui/TemplatePreview';
import SpectrumField from '../components/ui/SpectrumField';
import FrameShowcase from '../components/ui/FrameShowcase';

const FEATURES = [
  {
    icon: Camera,
    title: 'AR booth + live wall',
    copy:
      'Guests scan a QR code and step into an AR photo booth in their browser — no app to download. Every shot beams onto a cinematic live wall the whole room watches.',
  },
  {
    icon: Sparkles,
    title: 'Themed in seconds',
    copy:
      'Pick a style — wedding, gala, birthday, corporate or party — and your booth, frames and wall are instantly on-brand. Fine-tune colours, frames and 3D props anytime.',
  },
  {
    icon: Video,
    title: 'Video guestbook & cards',
    copy:
      'Guests leave short video messages and signed greeting cards you keep forever — a keepsake film, ready the morning after.',
  },
];

interface Tier {
  name: string;
  price: string;
  unit: string;
  blurb: string;
  features: string[];
  popular?: boolean;
}

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    unit: 'to try it',
    blurb: 'Spin up a booth and see the magic.',
    features: ['1 live event', 'Up to 25 photos', 'AR booth + live wall', 'A subtle Beamwall credit'],
  },
  {
    name: 'Essentials',
    price: '$49',
    unit: 'per event',
    blurb: 'Everything a small celebration needs.',
    features: ['Up to 500 photos', 'Video guestbook', 'No watermark', 'Every frame & effect'],
  },
  {
    name: 'Premium',
    price: '$99',
    unit: 'per event',
    blurb: 'The full experience, most hosts pick this.',
    features: ['Unlimited photos & video', 'AI event studio', 'Greeting cards', 'Priority support'],
    popular: true,
  },
  {
    name: 'Deluxe',
    price: '$169',
    unit: 'per event',
    blurb: 'A keepsake film and white-glove polish.',
    features: ['Everything in Premium', 'Keepsake highlight film', 'Premium card renders', 'White-glove setup'],
  },
];

const SHOWCASE = ['wedding', 'party', 'gala'];

export default function Landing() {
  const showcase = SHOWCASE.map((id) => EVENT_TEMPLATES.find((t) => t.id === id)!).filter(Boolean);

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto app-bg text-brand-fg">
      <SpectrumField className="z-0" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
        {/* Top bar */}
        <header className="flex items-center justify-between">
          <span className="font-serif text-2xl font-semibold tracking-wide text-foil-static">Beamwall</span>
          <nav className="flex items-center gap-2.5">
            <a href="#pricing" className="hidden sm:inline rounded-full px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 hover:text-brand-fg transition-colors">
              Pricing
            </a>
            <Link
              to="/login"
              className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
            >
              Sign in
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center py-14 text-center sm:py-16">
          <span className="mb-5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">
            AR photo booth &amp; live wall for events
          </span>
          <h1 className="max-w-3xl font-serif text-5xl leading-[1.05] text-shadow-lux sm:text-6xl">
            Your event, in <span className="text-foil-static">augmented reality</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-brand-muted/85 sm:text-lg">
            Give every guest a magical AR photo booth in their pocket — no app to download. Photos beam
            onto a live wall styled with frames and 3D magic you set up in minutes.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              to="/signup"
              className="rounded-full bg-foil px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
            >
              Create your event
            </Link>
            <a
              href="#pricing"
              className="rounded-full border border-white/15 bg-white/[0.04] px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08] active:scale-[0.98]"
            >
              See pricing
            </a>
          </div>
          <p className="mt-4 font-sans text-xs text-brand-muted/50">Free to start · no credit card to create your event.</p>

          {/* Focal visual — the beam wall itself: every pillar of the product,
              beaming in as glowing frames the moment the page loads. */}
          <FrameShowcase className="mt-16 w-full max-w-4xl" />

          {/* Live themed showcase */}
          <h2 className="mt-20 font-serif text-2xl text-foil-static sm:text-3xl">Pick a style, in one tap</h2>
          <div className="mt-8 grid w-full max-w-3xl grid-cols-3 gap-4 sm:gap-6">
            {showcase.map((t, i) => (
              <div key={t.id} className={`flex flex-col items-center gap-2.5 ${i === 1 ? 'sm:-translate-y-4' : ''}`}>
                <div className="w-full">
                  <TemplatePreview template={t} />
                </div>
                <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60">
                  {t.emoji} {t.label}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-5 font-sans text-sm text-brand-muted/55">One tap picks a look — booth, frames and wall, instantly on-brand.</p>

          {/* Feature cards */}
          <div className="mt-20 grid w-full gap-5 sm:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="liquid-glass rounded-2xl px-6 py-8 text-left shadow-[0_16px_60px_rgba(0,0,0,0.4)]">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--color-accent)]/12 text-accent">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-xl text-accent">{f.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-brand-muted/80">{f.copy}</p>
              </div>
            ))}
          </div>

          {/* Pricing */}
          <section id="pricing" className="mt-24 w-full scroll-mt-6">
            <h2 className="font-serif text-3xl text-foil-static sm:text-4xl">Simple pricing, per event</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-muted/70">
              Pay only for the events you host — no subscription required. Start free, upgrade an event
              whenever you like. Frequent host? Beamwall Pro is <span className="text-brand-fg">$79/month</span> for
              premium features across every event.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {TIERS.map((t) => (
                <div
                  key={t.name}
                  className={`relative flex flex-col rounded-2xl border p-6 text-left transition ${
                    t.popular
                      ? 'border-[color:var(--color-accent)]/50 bg-[color:var(--color-accent)]/[0.06] shadow-[0_20px_70px_-20px_rgba(0,0,0,0.6)]'
                      : 'border-white/10 bg-white/[0.02]'
                  }`}
                >
                  {t.popular && (
                    <span className="absolute -top-2.5 left-6 rounded-full bg-foil px-3 py-1 font-label uppercase tracking-luxe text-[8px] font-bold text-white">
                      Most popular
                    </span>
                  )}
                  <h3 className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/70">{t.name}</h3>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="font-serif text-4xl text-foil-static">{t.price}</span>
                    <span className="font-sans text-xs text-brand-muted/50">{t.unit}</span>
                  </div>
                  <p className="mt-2 font-sans text-[12px] leading-relaxed text-brand-muted/60">{t.blurb}</p>
                  <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-brand-fg/90">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/signup"
                    className={`mt-6 rounded-full px-5 py-3 text-center font-label uppercase tracking-luxe text-[10px] font-bold transition active:scale-[0.98] ${
                      t.popular
                        ? 'bg-foil text-white glow-accent'
                        : 'border border-white/15 bg-white/[0.04] text-brand-fg hover:bg-white/[0.08]'
                    }`}
                  >
                    {t.name === 'Free' ? 'Start free' : 'Get started'}
                  </Link>
                </div>
              ))}
            </div>
          </section>

          {/* Closing CTA */}
          <div className="mt-24 flex w-full max-w-2xl flex-col items-center rounded-3xl liquid-glass px-8 py-12 text-center">
            <h2 className="font-serif text-3xl text-foil-static">Ready in minutes.</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-brand-muted/75">
              Create your event, pick a style, and share the QR code. Your guests bring the moments; the
              wall brings the magic.
            </p>
            <Link
              to="/signup"
              className="mt-7 rounded-full bg-foil px-9 py-4 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98]"
            >
              Create your event
            </Link>
          </div>
        </main>

        {/* Footer */}
        <footer className="flex flex-col items-center gap-2 pb-4 pt-16 text-center">
          <span className="font-serif text-lg text-foil-static">Beamwall</span>
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50">
            Loved at weddings, galas &amp; milestone birthdays.
          </p>
        </footer>
      </div>
    </div>
  );
}
