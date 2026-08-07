/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The /guides index: a hero and five cards.
 *
 * Cards are ordered by GUIDE_ORDER — the sequence a new host should read them
 * in, not alphabetically. Each one is tinted with its guide's spectrum hue so
 * the colour on the hub matches the colour on the guide itself, which is what
 * makes "the green one" a usable way to remember where something was.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Clock } from 'lucide-react';
import { GUIDES, GUIDE_ORDER } from '../../lib/guidesContent';

export default function GuideHub({ notice }: { notice?: string }) {
  return (
    <div className="flex w-full flex-col items-center">
      <section data-reveal="up" className="flex w-full max-w-3xl flex-col items-center pt-10 text-center sm:pt-14">
        <p className="mb-4 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70">
          Guides
        </p>
        <h1 className="max-w-2xl font-serif text-4xl leading-[1.08] text-shadow-lux sm:text-5xl">
          Everything you need to throw the <span className="text-foil-static">best-looking</span> party
          in the room
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-brand-muted">
          Short, practical walkthroughs — how to design a frame people screenshot, how to put a prop
          on every guest, and how to run the night without touching a thing. Free frames and
          copy-paste prompts included.
        </p>
      </section>

      {notice !== undefined && (
        <div className="glass mt-8 w-full max-w-xl rounded-2xl px-5 py-4 text-center text-sm text-brand-muted">
          {notice}
        </div>
      )}

      <div data-reveal-stagger className="mt-12 grid w-full gap-4 sm:mt-16 sm:grid-cols-2">
        {GUIDE_ORDER.map((slug, i) => {
          const g = GUIDES[slug];
          // The first card takes the full width on ≥sm: it is the one a first
          // -time visitor should open, and a 2×3 grid with a hole reads worse.
          const wide = i === 0 ? 'sm:col-span-2' : '';
          return (
            <Link
              key={slug}
              to={`/guides/${slug}`}
              className={`liquid-glass pressable group relative flex flex-col gap-3 overflow-hidden rounded-3xl p-6 text-left transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${wide}`}
            >
              {/* The hue, as a soft wash in the corner rather than a hard bar —
                  five saturated bars stacked down a page fight each other. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.22] blur-2xl transition-opacity duration-500 group-hover:opacity-40"
                style={{ background: g.hue }}
              />
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-px"
                style={{ background: `linear-gradient(90deg, transparent, ${g.hue}80, transparent)` }}
              />
              <span className="relative flex items-center gap-3">
                <span
                  className="font-label uppercase tracking-luxe text-[10px] font-semibold"
                  style={{ color: g.hue }}
                >
                  {g.eyebrow}
                </span>
                <span className="flex items-center gap-1 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/60">
                  <Clock className="h-3 w-3" aria-hidden />
                  {g.minutes} min
                </span>
              </span>
              <h2 className="relative font-serif text-2xl leading-tight text-brand-fg">{g.title}</h2>
              <p className="relative max-w-lg text-sm leading-relaxed text-brand-muted">{g.hook}</p>
              <span className="relative mt-auto inline-flex items-center gap-1.5 pt-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 transition group-hover:text-brand-fg">
                Read it
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
