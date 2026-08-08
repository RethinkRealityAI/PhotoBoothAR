/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copy-paste prompt cards, each shown WITH the frame it makes.
 *
 * A prompt is 400 characters of instructions to a machine; nobody can judge one
 * by reading it. Every card therefore leads with the real, shipped frame that
 * this brief produced — the same artwork the free pack hands out — so the
 * decision a host actually makes ("do I want that look?") is made on a picture,
 * and the words are just what they copy afterwards.
 *
 * The example is captioned as the frame it MADE rather than "run this and get
 * exactly this": a generator returns something new every time, and two of the
 * shipped designs moved an element between brief and render.
 *
 * GREEN_TAIL is explained ONCE above the grid, not on every card. It is the
 * same 40-word paragraph at the end of all fourteen prompts; repeating it as a
 * per-card explainer would triple the page height and train people to skip the
 * one part they most need to read.
 *
 * The prompt text is CLAMPED with an expander rather than put in a scroll box.
 * Fourteen nested scrollers on a phone means every other swipe moves the wrong
 * thing — and the copy button already gives you the whole prompt regardless of
 * how much of it is on screen.
 *
 * Copying goes through src/lib/clipboard.ts `copyText`, which resolves a
 * boolean and never rejects — the async Clipboard API is undefined outside a
 * secure context, and a host reading this on a venue's http:// wifi portal is
 * exactly the case that breaks.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import {
  FRAME_CATEGORY_LABELS,
  FRAME_PACK_BY_ID,
  GREEN_TAIL,
  PROMPT_CARD_BY_ID,
  type PromptCategory,
} from '../../lib/guidesContent';
import { copyText } from '../../lib/clipboard';
import FrameThumb from './FrameThumb';
import SectionHead, { CountChip } from './SectionHead';

type Filter = PromptCategory | 'all';

const BEST_WITH_LABELS: Record<string, string> = {
  higgsfield: 'Best on Higgsfield',
  gemini: 'Best on Gemini',
  chatgpt: 'Best on ChatGPT',
  any: 'Works anywhere',
};

export default function PromptLibrary({
  title,
  blurb,
  cardIds,
}: {
  title: string;
  blurb: string;
  cardIds: string[];
}) {
  const cards = cardIds.map((id) => PROMPT_CARD_BY_ID[id]).filter((c) => c !== undefined);
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The "Copied" state is a timeout; clear it on unmount so a filter change or
  // a route change can't set state on a gone component.
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  if (cards.length === 0) return null;

  const categories: PromptCategory[] = [];
  for (const c of cards) if (!categories.includes(c.category)) categories.push(c.category);

  const shown = filter === 'all' ? cards : cards.filter((c) => c.category === filter);

  const onCopy = async (id: string, prompt: string) => {
    const ok = await copyText(prompt);
    // On failure the text stays selectable in the card — say nothing rather
    // than claim a copy that did not happen.
    if (!ok) return;
    setCopied(id);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };

  const chip = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 font-label uppercase tracking-luxe text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
      active
        ? 'bg-white/[0.12] text-brand-fg'
        : 'text-brand-muted/70 hover:text-brand-fg hover:bg-white/[0.06]'
    }`;

  return (
    <section data-guide-block="prompts" data-reveal="up" className="w-full">
      <SectionHead
        title={title}
        blurb={blurb}
        meta={<CountChip>{cards.length} prompts</CountChip>}
      />

      {/* Explained once, above the grid — see the note at the top of the file. */}
      <div className="glass mb-6 rounded-2xl border-l-2 border-l-emerald-400/60 p-5">
        <p className="mb-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-emerald-300/90">
          Every prompt ends with this
        </p>
        <p className="mb-3 max-w-2xl text-sm leading-relaxed text-brand-muted">
          This is the part that turns a nice picture into a usable frame: it tells the generator to
          leave a flat green shape where a person goes, which is the bit we cut away to make the
          window. Keep it on the end of anything you write yourself.
        </p>
        <p className="rounded-xl bg-black/40 p-3.5 font-mono text-[11px] leading-relaxed text-brand-muted/90">
          {GREEN_TAIL}
        </p>
      </div>

      <div className="liquid-glass mb-5 flex flex-wrap items-center gap-1 rounded-full p-1.5">
        <button type="button" onClick={() => setFilter('all')} className={chip(filter === 'all')}>
          All {cards.length}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => setFilter(c)} className={chip(filter === c)}>
            {FRAME_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div data-reveal-stagger className="grid gap-3">
        {shown.map((c) => {
          const example = c.exampleId === undefined ? undefined : FRAME_PACK_BY_ID[c.exampleId];
          const isOpen = open[c.id] === true;
          return (
            <article
              key={c.id}
              // No example (the field is optional) collapses to a plain
              // column — a grid with an empty 84px gutter would read as a
              // missing image, which is exactly the bug it is not.
              // items-start: grid items stretch by default, and the thumbnail
              // spans all three rows, so without it the prompt's black box
              // grows to the picture's height and ends in a pool of empty
              // background under the text.
              className={`liquid-glass items-start rounded-2xl p-4 sm:p-5 ${
                example === undefined
                  ? 'flex flex-col gap-3'
                  : 'grid grid-cols-[84px_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[124px_minmax(0,1fr)] sm:gap-x-5'
              }`}
            >
              {/* The picture leads, and it is a rail rather than a stacked hero
                  — a 9:16 image at phone width would be 690px tall and you
                  would scroll past one card per screen. On a phone it holds
                  only the first grid row, so the prompt below it gets the full
                  card width instead of a 230px trench. */}
              {example !== undefined && c.exampleId !== undefined && (
                <div className="sm:row-span-3">
                  <FrameThumb
                    id={c.exampleId}
                    alt={`${example.title} — a frame made with this prompt`}
                    className="rounded-xl ring-1 ring-white/10"
                  />
                  {/* The pack title is hidden on a phone: under an 84px column
                      "Two Letters, One Night" wraps to three ragged lines and
                      the picture above it is already the point. */}
                  <p className="mt-2 text-center text-[10px] leading-tight text-brand-muted/60">
                    <span className="font-label uppercase tracking-luxe font-semibold">Made this</span>
                    <span className="mt-0.5 hidden text-brand-muted/45 sm:block">{example.title}</span>
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1.5 self-start">
                <h4 className="font-serif text-base leading-tight text-brand-fg sm:text-lg">
                  {c.label}
                </h4>
                <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-label uppercase tracking-luxe text-[9px] font-semibold text-brand-muted/75">
                  {BEST_WITH_LABELS[c.bestWith] ?? c.bestWith}
                </span>
              </div>

              {/* The padding is on the WRAPPER, never on the clamped element:
                  -webkit-line-clamp sizes the CONTENT box to five lines while
                  overflow:hidden clips at the PADDING box, so a padded clamp
                  paints most of a sixth line underneath its own ellipsis
                  (measured: clientHeight 117px = 5 × 17.875 + 28). */}
              <div className="col-span-2 rounded-xl bg-black/35 p-3.5 sm:col-span-1">
                <p
                  className={`font-mono text-[11px] leading-relaxed text-brand-muted/90 ${
                    isOpen ? '' : 'line-clamp-5'
                  }`}
                >
                  {c.prompt}
                </p>
              </div>

              <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
                <button
                  type="button"
                  onClick={() => void onCopy(c.id, c.prompt)}
                  className="pressable inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                >
                  {copied === c.id ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                      Copy prompt
                    </>
                  )}
                </button>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/70 transition hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
                >
                  {isOpen ? 'Less' : 'Read it all'}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
