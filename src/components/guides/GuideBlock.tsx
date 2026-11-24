/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The block dispatcher: one GuideBlock in, one section out.
 *
 * The simple renderers (prose, steps, screens, film, callout, cta) live here rather
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
import { GUIDE_SCREENS, type GuideBlock as Block, type GuideScreenId } from '../../lib/guidesContent';
import { GUIDE_VIDEO } from '../../lib/guidesMedia';
import DeviceShot from './DeviceShot';
import DownloadGallery from './DownloadGallery';
import HotspotShot from './HotspotShot';
import PromptLibrary from './PromptLibrary';
import SectionHead from './SectionHead';
import SpecTable from './SpecTable';
import ToolCards from './ToolCards';

/**
 * "Name — what it does" paragraphs, every one of them, read as a glossary, so
 * they render as a grid of small cards with the name as a heading instead of
 * a run of look-alike paragraphs. The dash must come early (a name, not a
 * sentence that happens to contain one).
 */
const TERM = /^([^—.]{2,40}) — (.+)$/s;

function proseTerms(body: string[]): { term: string; text: string }[] | null {
  if (body.length < 3) return null;
  const out: { term: string; text: string }[] = [];
  for (const p of body) {
    const m = TERM.exec(p);
    if (m === null) return null;
    out.push({ term: m[1], text: m[2] });
  }
  return out;
}

function ProseText({ body }: { body: string[] }) {
  const terms = proseTerms(body);
  if (terms !== null) {
    return (
      <dl data-reveal-stagger className="grid gap-3 sm:grid-cols-2">
        {terms.map((t) => (
          <div key={t.term} className="liquid-glass rounded-2xl p-4">
            <dt className="mb-1 font-serif text-base leading-tight text-brand-fg">{t.term}</dt>
            <dd className="text-sm leading-relaxed text-brand-muted">{t.text}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="max-w-2xl space-y-4">
      {body.map((p) => (
        <p key={p.slice(0, 40)} className="text-[15px] leading-relaxed text-brand-muted">
          {p}
        </p>
      ))}
    </div>
  );
}

function Prose({ title, body, screen }: { title?: string; body: string[]; screen?: GuideScreenId }) {
  const shot = screen === undefined ? null : GUIDE_SCREENS[screen];
  return (
    // Full width so the heading rule lines up with every other block, with the
    // reading column held at one measure inside it — the mismatch between a
    // max-w-2xl prose section and full-width cards is what made the page look
    // ragged down the left of the scroll.
    <section data-guide-block="prose" data-reveal="up" className="w-full">
      {title !== undefined && <SectionHead title={title} />}
      {shot === null ? (
        <ProseText body={body} />
      ) : shot.device === 'phone' ? (
        // A phone screen stands beside the words on wider screens and under
        // them on a phone, where two columns would leave each one too narrow.
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <ProseText body={body} />
          </div>
          <DeviceShot screen={shot.id} className="w-52 shrink-0 sm:w-56" />
        </div>
      ) : (
        <div className="space-y-6">
          <ProseText body={body} />
          <DeviceShot screen={shot.id} />
        </div>
      )}
    </section>
  );
}

type Step = { title: string; body: string; tip?: string; screen?: GuideScreenId };

function StepText({ step, n }: { step: Step; n: number }) {
  return (
    <div className="flex gap-4">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] font-label text-[12px] font-bold text-brand-fg"
        // The guide's hue on the number, so the steps read as one sequence in
        // the same colour as the section rule above them.
        style={{ borderColor: 'color-mix(in srgb, var(--guide-hue, white) 45%, transparent)' }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="mb-1.5 font-serif text-lg leading-tight text-brand-fg">{step.title}</h4>
        <p className="text-sm leading-relaxed text-brand-muted">{step.body}</p>
        {step.tip !== undefined && (
          <p className="mt-3 flex gap-2 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-brand-muted/90">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-accent)]" aria-hidden />
            <span>{step.tip}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function Steps({ title, steps }: { title: string; steps: Step[] }) {
  return (
    <section data-guide-block="steps" data-reveal="up" className="w-full">
      <SectionHead title={title} />
      <ol data-reveal-stagger className="space-y-3">
        {steps.map((s, i) => {
          const shot = s.screen === undefined ? null : GUIDE_SCREENS[s.screen];
          if (shot === null) {
            return (
              <li key={s.title} className="liquid-glass rounded-2xl p-5">
                <StepText step={s} n={i + 1} />
              </li>
            );
          }
          // A step with a picture: a phone screen sits beside the words (under
          // them on a phone), a desktop screen runs the full width of the card
          // under them, where a 1440-wide screen still has room to be read.
          return (
            <li key={s.title} className="liquid-glass rounded-3xl p-5 sm:p-6">
              {shot.device === 'phone' ? (
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
                  <div className="min-w-0 flex-1">
                    <StepText step={s} n={i + 1} />
                  </div>
                  <DeviceShot screen={shot.id} className="mx-auto w-48 shrink-0 sm:mx-0 sm:w-52" />
                </div>
              ) : (
                <div className="space-y-5">
                  <StepText step={s} n={i + 1} />
                  <DeviceShot screen={shot.id} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A row of guest phone screens, in order, each with a numbered caption.
 *
 * It scrolls sideways (snapping a screen at a time) rather than shrinking four
 * phones into one row: at 390px wide four phones would be 80px each and
 * unreadable. The scroller is the only thing that moves sideways — the page
 * itself never gets wider — and it bleeds to the page edge on a phone so the
 * next screen peeks in, which is what tells a reader there are more.
 */
function Screens({ title, blurb, items }: { title: string; blurb: string; items: { screen: GuideScreenId; caption: string }[] }) {
  return (
    <section data-guide-block="screens" data-reveal="up" className="w-full">
      <SectionHead title={title} blurb={blurb} />
      <ol
        aria-label={title}
        className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-3 [scrollbar-width:thin] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0"
      >
        {items.map((it, i) => (
          <li key={it.screen} className="w-44 shrink-0 snap-center sm:w-auto">
            <DeviceShot screen={it.screen} />
            <p className="mt-3 flex gap-2 text-[13px] leading-snug text-brand-muted">
              <span
                className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] font-label text-[10px] font-bold text-brand-fg"
                aria-hidden
              >
                {i + 1}
              </span>
              <span>{it.caption}</span>
            </p>
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
      return <Prose title={block.title} body={block.body} screen={block.screen} />;
    case 'steps':
      return <Steps title={block.title} steps={block.steps} />;
    case 'screens':
      return <Screens title={block.title} blurb={block.blurb} items={block.items} />;
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
