/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One guide: hero, blocks, and a way onward.
 *
 * The footer nav is prev/next through GUIDE_ORDER rather than "back to
 * guides", because somebody who just finished one of these is far more likely
 * to want the next one than the index — and the header already carries the way
 * back.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import { GUIDES, GUIDE_ORDER, type GuideDoc } from '../../lib/guidesContent';
import GuideBlock from './GuideBlock';

export default function GuideDetail({ doc }: { doc: GuideDoc }) {
  const i = GUIDE_ORDER.indexOf(doc.slug);
  const prev = i > 0 ? GUIDES[GUIDE_ORDER[i - 1]] : null;
  const next = i >= 0 && i < GUIDE_ORDER.length - 1 ? GUIDES[GUIDE_ORDER[i + 1]] : null;

  return (
    <article className="flex w-full flex-col items-center">
      <header data-reveal="up" className="relative w-full max-w-3xl pt-10 text-center sm:pt-14">
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-52 w-[36rem] max-w-full -translate-x-1/2 rounded-full opacity-[0.18] blur-3xl"
          style={{ background: doc.hue }}
        />
        <Link
          to="/guides"
          className="relative mb-6 inline-flex items-center gap-1.5 rounded-full font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 transition hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          All guides
        </Link>
        <p
          className="relative mb-3 font-label uppercase tracking-luxe text-[10px] font-semibold"
          style={{ color: doc.hue }}
        >
          {doc.eyebrow}
        </p>
        <h1 className="relative font-serif text-4xl leading-[1.08] text-shadow-lux sm:text-5xl">
          {doc.title}
        </h1>
        <p className="relative mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-brand-muted">
          {doc.hook}
        </p>
        <p className="relative mt-5 inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/60">
          <Clock className="h-3 w-3" aria-hidden />
          {doc.minutes} minute read
        </p>
      </header>

      <div className="mt-14 flex w-full max-w-3xl flex-col items-start gap-12 text-left sm:mt-16 sm:gap-14">
        {doc.blocks.map((block, bi) => (
          <GuideBlock key={`${block.kind}-${bi}`} block={block} />
        ))}
      </div>

      {(prev !== null || next !== null) && (
        <nav
          data-reveal="up"
          aria-label="More guides"
          className="mt-16 grid w-full max-w-3xl gap-3 sm:grid-cols-2"
        >
          {prev !== null ? (
            <Link
              to={`/guides/${prev.slug}`}
              className="liquid-glass pressable group flex flex-col gap-1.5 rounded-2xl p-5 text-left transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            >
              <span className="inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/60">
                <ArrowLeft className="h-3 w-3" aria-hidden />
                Previous
              </span>
              <span className="font-serif text-lg leading-tight text-brand-fg">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next !== null && (
            <Link
              to={`/guides/${next.slug}`}
              className="liquid-glass pressable group flex flex-col items-end gap-1.5 rounded-2xl p-5 text-right transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:col-start-2"
            >
              <span className="inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/60">
                Next
                <ArrowRight className="h-3 w-3" aria-hidden />
              </span>
              <span className="font-serif text-lg leading-tight text-brand-fg">{next.title}</span>
            </Link>
          )}
        </nav>
      )}
    </article>
  );
}
