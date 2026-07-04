/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /demo — the interactive demo hub. A single page that shows every guest-facing
 * feature as a clickable card, each linking into the live "demo" sandbox event
 * (no sign-in required) so anyone can experience the platform exactly as a guest
 * would: the AR photo booth, the live wall, a finished greeting card, and the
 * contribute-to-a-card flow.
 *
 * The targets are the seeded demo records (event slug `demo` + its two cards).
 * They're exported so the marketing Landing page can deep-link to the same flows.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Camera, MonitorPlay, BookHeart, PenLine, type LucideIcon } from 'lucide-react';

/** Live demo sandbox targets (seeded records — no auth needed to view). */
export const DEMO = {
  booth: '/e/demo',
  wall: '/e/demo/wall',
  finishedCard: '/c/479ee7c5-9feb-4729-aeb0-eae253bcdc4c',
  contribute:
    '/c/a4cf1e6a-4368-48f0-ae5b-17b15e29b12c/contribute?t=0be4524d-b011-4919-9052-658f8fd601f6',
} as const;

interface DemoCard {
  to: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  copy: string;
  cta: string;
}

const CARDS: DemoCard[] = [
  {
    to: DEMO.booth,
    icon: Camera,
    eyebrow: 'For your guests',
    title: 'The AR photo booth',
    copy: 'Step into the browser photo booth — pick a frame or 3D effect, snap a shot, and send it flying to the wall. No app to download.',
    cta: 'Open the booth',
  },
  {
    to: DEMO.wall,
    icon: MonitorPlay,
    eyebrow: 'On the big screen',
    title: 'The live wall',
    copy: 'Watch every capture beam in and drift across the cinematic live wall the whole room shares — gallery, slideshow and projection modes.',
    cta: 'View the wall',
  },
  {
    to: DEMO.finishedCard,
    icon: BookHeart,
    eyebrow: 'The keepsake',
    title: 'A finished greeting card',
    copy: 'Flip through a published greeting card — a storybook of messages, photos and video from everyone, ready the morning after.',
    cta: 'Open the card',
  },
  {
    to: DEMO.contribute,
    icon: PenLine,
    eyebrow: 'From anywhere',
    title: 'Contribute to a card',
    copy: 'Add your own photo, a short video or a heartfelt note to a card that friends near and far are filling in together.',
    cta: 'Leave a message',
  },
];

function FeatureCard({ card }: { card: DemoCard }) {
  const Icon = card.icon;
  return (
    <Link
      to={card.to}
      className="group relative flex flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-7 text-left transition duration-300 hover:-translate-y-1 hover:border-[color:var(--color-accent)]/40 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/50 sm:p-8"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foil text-noir-900 glow-accent transition group-hover:scale-105">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowUpRight className="h-5 w-5 text-brand-muted/30 transition group-hover:text-[color:var(--color-accent)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <p className="mt-6 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">{card.eyebrow}</p>
      <h2 className="mt-1.5 font-serif text-2xl text-accent">{card.title}</h2>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-muted/80">{card.copy}</p>
      <span className="mt-6 inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg">
        {card.cta}
        <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </span>
    </Link>
  );
}

export default function Demo() {
  return (
    <div className="min-h-[100dvh] w-full app-bg text-brand-fg">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-8 sm:px-8 sm:py-10">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </Link>
          <span className="font-serif text-xl font-semibold tracking-wide text-foil-static sm:text-2xl">Beamwall</span>
          <Link
            to="/signup"
            className="hidden rounded-full bg-foil px-5 py-2 font-label uppercase tracking-luxe text-[10px] font-bold text-noir-900 glow-accent transition hover:brightness-110 sm:inline-block"
          >
            Create your event
          </Link>
        </header>

        {/* Intro */}
        <div className="mx-auto mt-10 max-w-2xl text-center sm:mt-14">
          <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/55">Interactive demo · no sign-in</p>
          <h1 className="mt-3 font-serif text-4xl leading-tight text-shadow-lux sm:text-5xl">
            See it the way your <span className="text-foil-static">guests</span> will.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-brand-muted/80 sm:text-base">
            Pick a card below to try a real, live example of each feature — the AR booth, the shared
            live wall, and the greeting cards you keep forever.
          </p>
        </div>

        {/* Feature cards — 2×2 on tablet+, single column on phones */}
        <div className="mx-auto mt-10 grid w-full max-w-4xl flex-1 grid-cols-1 content-start gap-5 sm:mt-12 sm:grid-cols-2">
          {CARDS.map((c) => (
            <FeatureCard key={c.to} card={c} />
          ))}
        </div>

        {/* Footer CTA */}
        <footer className="mt-12 flex flex-col items-center gap-4 pb-4 text-center">
          <p className="font-serif text-lg text-brand-fg/90 sm:text-xl">Ready to make your own?</p>
          <Link
            to="/signup"
            className="rounded-full bg-foil px-8 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-noir-900 glow-accent transition hover:brightness-110 active:scale-[0.98]"
          >
            Create your event
          </Link>
        </footer>
      </div>
    </div>
  );
}
