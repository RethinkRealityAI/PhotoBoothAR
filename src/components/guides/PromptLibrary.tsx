/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copy-paste prompt cards.
 *
 * GREEN_TAIL is explained ONCE above the grid, not on every card. It is the
 * same 40-word paragraph at the end of all fifteen prompts; repeating it as a
 * per-card explainer would triple the page height and train people to skip the
 * one part they most need to read.
 *
 * Copying goes through src/lib/clipboard.ts `copyText`, which resolves a
 * boolean and never rejects — the async Clipboard API is undefined outside a
 * secure context, and a host reading this on a venue's http:// wifi portal is
 * exactly the case that breaks.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import {
  FRAME_CATEGORY_LABELS,
  GREEN_TAIL,
  PROMPT_CARD_BY_ID,
  type PromptCategory,
} from '../../lib/guidesContent';
import { copyText } from '../../lib/clipboard';

type Filter = PromptCategory | 'all';

const CATEGORY_LABELS: Record<PromptCategory, string> = {
  ...FRAME_CATEGORY_LABELS,
  technique: 'Fix-its',
};

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
      <h3 className="mb-2 font-serif text-2xl text-brand-fg">{title}</h3>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-brand-muted">{blurb}</p>

      {/* Explained once, above the grid — see the note at the top of the file. */}
      <div className="glass mb-6 rounded-2xl border-l-2 border-l-emerald-400/60 p-5">
        <p className="mb-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-emerald-300/90">
          Every prompt ends with this
        </p>
        <p className="mb-3 text-sm leading-relaxed text-brand-muted">
          This is the part that turns a nice picture into a usable frame: it tells the generator to
          leave a flat green shape where a person goes, which is the bit we cut away to make the
          window. Keep it on the end of anything you write yourself.
        </p>
        <p className="rounded-xl bg-black/40 p-3.5 font-mono text-[11px] leading-relaxed text-brand-muted/90">
          {GREEN_TAIL}
        </p>
      </div>

      <div className="liquid-glass mb-6 flex flex-wrap items-center gap-1 rounded-full p-1.5">
        <button type="button" onClick={() => setFilter('all')} className={chip(filter === 'all')}>
          All {cards.length}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" onClick={() => setFilter(c)} className={chip(filter === c)}>
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((c) => (
          <article key={c.id} className="liquid-glass flex flex-col gap-3 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <h4 className="font-serif text-base leading-tight text-brand-fg">{c.label}</h4>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-label uppercase tracking-luxe text-[9px] font-semibold text-brand-muted/75">
                {BEST_WITH_LABELS[c.bestWith] ?? c.bestWith}
              </span>
            </div>
            <p className="max-h-56 overflow-y-auto rounded-xl bg-black/35 p-3.5 font-mono text-[11px] leading-relaxed text-brand-muted/90">
              {c.prompt}
            </p>
            <button
              type="button"
              onClick={() => void onCopy(c.id, c.prompt)}
              className="pressable inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-fg transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
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
          </article>
        ))}
      </div>
    </section>
  );
}
