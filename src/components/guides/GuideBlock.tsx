/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The block dispatcher: one GuideBlock in, one section out.
 *
 * The five simple renderers (prose, steps, film, callout, cta) live here rather
 * than in five 30-line files — they are variations on "a heading and some text
 * in a glass panel", and splitting them would scatter one idea across a
 * directory. The four that carry real behaviour (prompts, downloads, tools,
 * hotspots) are their own modules.
 *
 * EVERY root element carries `data-guide-block="<kind>"`, so a layout sweep can
 * find and measure every block on the page without knowing the content.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Clapperboard, Lightbulb } from 'lucide-react';
import FilmEmbed from '../ui/FilmEmbed';
import type { GuideBlock as Block } from '../../lib/guidesContent';
import { GUIDE_VIDEO } from '../../lib/guidesMedia';
import DownloadGallery from './DownloadGallery';
import HotspotShot from './HotspotShot';
import PromptLibrary from './PromptLibrary';
import SectionHead from './SectionHead';
import SpecTable from './SpecTable';
import ToolCards from './ToolCards';

function Prose({ title, body }: { title?: string; body: string[] }) {
  return (
    // Full width so the heading rule lines up with every other block, with the
    // reading column held at one measure inside it — the mismatch between a
    // max-w-2xl prose section and full-width cards is what made the page look
    // ragged down the left of the scroll.
    <section data-guide-block="prose" data-reveal="up" className="w-full">
      {title !== undefined && <SectionHead title={title} />}
      <div className="max-w-2xl space-y-4">
        {body.map((p) => (
          <p key={p.slice(0, 40)} className="text-[15px] leading-relaxed text-brand-muted">
            {p}
          </p>
        ))}
      </div>
    </section>
  );
}

function Steps({ title, steps }: { title: string; steps: { title: string; body: string; tip?: string }[] }) {
  return (
    <section data-guide-block="steps" data-reveal="up" className="w-full">
      <SectionHead title={title} />
      <ol data-reveal-stagger className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="liquid-glass rounded-2xl p-5">
            <div className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] font-label text-[12px] font-bold text-brand-fg">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h4 className="mb-1.5 font-serif text-lg leading-tight text-brand-fg">{s.title}</h4>
                <p className="text-sm leading-relaxed text-brand-muted">{s.body}</p>
                {s.tip !== undefined && (
                  <p className="mt-3 flex gap-2 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-brand-muted/90">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-accent)]" aria-hidden />
                    <span>{s.tip}</span>
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A film, or an honest placeholder.
 *
 * GUIDE_VIDEO carries null until the renders land. A <video> pointed at a
 * missing file would not even 404 here — vite preview and Netlify both answer
 * an unknown path under public/ with index.html at 200 — so the element would
 * sit on a frozen black poster forever. Say what is happening instead.
 */
function Film({ videoKey, title, caption }: { videoKey: keyof typeof GUIDE_VIDEO; title: string; caption: string }) {
  const media = GUIDE_VIDEO[videoKey];
  return (
    <section data-guide-block="film" data-reveal="up" className="w-full">
      <SectionHead title={title} blurb={caption} />
      {media === null ? (
        // The caption already sits directly above this panel — repeating it
        // inside was the first thing that read as a bug in review.
        <div className="liquid-glass flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center">
          <Clapperboard className="h-7 w-7 text-brand-muted/50" aria-hidden />
          <p className="font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/60">
            Film coming with the next update
          </p>
        </div>
      ) : (
        <div style={{ perspective: '1200px' }}>
          <div data-screen-tilt className="liquid-glass overflow-hidden rounded-2xl">
            <FilmEmbed src={media.src} poster={media.poster} label={`${title} — guide film`} />
          </div>
        </div>
      )}
    </section>
  );
}

function Callout({ tone, title, body }: { tone: 'tip' | 'watch'; title: string; body: string }) {
  const watch = tone === 'watch';
  const Icon = watch ? AlertTriangle : Lightbulb;
  return (
    <section
      data-guide-block="callout"
      data-reveal="up"
      className={`glass w-full rounded-2xl border-l-2 p-5 ${
        watch ? 'border-l-amber-400/70' : 'border-l-emerald-400/70'
      }`}
    >
      <p
        className={`mb-2 flex items-center gap-2 font-label uppercase tracking-luxe text-[10px] font-semibold ${
          watch ? 'text-amber-300/90' : 'text-emerald-300/90'
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {watch ? 'Watch out' : 'Tip'}
      </p>
      <h4 className="mb-2 font-serif text-lg text-brand-fg">{title}</h4>
      <p className="max-w-2xl text-sm leading-relaxed text-brand-muted">{body}</p>
    </section>
  );
}

function Cta({ label, to, blurb }: { label: string; to: string; blurb: string }) {
  return (
    <section
      data-guide-block="cta"
      data-reveal="up"
      className="liquid-glass flex w-full flex-col items-start gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="max-w-md text-sm leading-relaxed text-brand-muted">{blurb}</p>
      <Link
        to={to}
        className="pressable inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-[color:var(--on-accent)] glow-accent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
      >
        {label}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}

export default function GuideBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'prose':
      return <Prose title={block.title} body={block.body} />;
    case 'steps':
      return <Steps title={block.title} steps={block.steps} />;
    case 'film':
      return <Film videoKey={block.videoKey} title={block.title} caption={block.caption} />;
    case 'prompts':
      return <PromptLibrary title={block.title} blurb={block.blurb} cardIds={block.cardIds} />;
    case 'downloads':
      return <DownloadGallery title={block.title} blurb={block.blurb} entryIds={block.entryIds} />;
    case 'tools':
      return <ToolCards title={block.title} blurb={block.blurb} toolNames={block.toolNames} />;
    case 'hotspots':
      return <HotspotShot shot={block.shot} title={block.title} blurb={block.blurb} />;
    case 'spec':
      return <SpecTable title={block.title} rows={block.rows} />;
    case 'callout':
      return <Callout tone={block.tone} title={block.title} body={block.body} />;
    case 'cta':
      return <Cta label={block.label} to={block.to} blurb={block.blurb} />;
  }
}
