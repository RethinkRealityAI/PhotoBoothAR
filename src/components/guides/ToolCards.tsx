/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Outbound tool cards — the one place the marketing site sends a visitor
 * somewhere else, so every link is target=_blank with rel="noopener
 * noreferrer" and its host is allowlisted in guidesContent (TOOL_HOST_ALLOWLIST,
 * asserted by guidesContent.test.ts).
 */
import { ArrowUpRight } from 'lucide-react';
import { TOOL_CARD_BY_NAME } from '../../lib/guidesContent';
import SectionHead from './SectionHead';

export default function ToolCards({
  title,
  blurb,
  toolNames,
}: {
  title: string;
  blurb: string;
  toolNames: string[];
}) {
  const tools = toolNames.map((n) => TOOL_CARD_BY_NAME[n]).filter((t) => t !== undefined);
  if (tools.length === 0) return null;

  return (
    <section data-guide-block="tools" data-reveal="up" className="w-full">
      <SectionHead title={title} blurb={blurb} />
      <div
        data-reveal-stagger
        className={`grid gap-3 ${tools.length > 1 ? 'sm:grid-cols-2' : 'sm:max-w-md'}`}
      >
        {tools.map((t) => (
          <a
            key={t.name}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            className="liquid-glass pressable group flex flex-col gap-3 rounded-2xl p-5 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-serif text-lg text-brand-fg">{t.name}</span>
              <span className="flex items-center gap-2">
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/80">
                  {t.cost}
                </span>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 text-brand-muted/60 transition group-hover:text-brand-fg"
                  aria-hidden
                />
              </span>
            </div>
            <p className="text-sm leading-relaxed text-brand-muted">{t.blurb}</p>
            <ul className="mt-auto flex flex-wrap gap-1.5">
              {t.goodFor.map((g) => (
                <li
                  key={g}
                  className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-brand-muted/85"
                >
                  {g}
                </li>
              ))}
            </ul>
          </a>
        ))}
      </div>
    </section>
  );
}
