/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One heading for every block on a guide.
 *
 * Seven components were each writing their own `<h3>` + blurb pair, which is
 * how a page ends up with five slightly different heading treatments and no
 * rhythm down the scroll. This is that pair, once:
 *
 *  - a short rule in the guide's own spectrum hue, so the colour that names the
 *    guide on the hub keeps naming it as you read (--guide-hue is set on the
 *    blocks container by GuideDetail; the fallback keeps this usable anywhere);
 *  - the title, with room for a `meta` chip on the same baseline (counts:
 *    "14 frames", "14 prompts" — a host wants the size of a thing before they
 *    decide to scroll it);
 *  - the blurb at ONE measure across every block, because ragged intro widths
 *    are what made the page feel assembled rather than designed.
 */
import type { ReactNode } from 'react';

export default function SectionHead({
  title,
  blurb,
  meta,
}: {
  title: string;
  blurb?: string;
  meta?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <span
        aria-hidden
        className="mb-4 block h-px w-10 rounded-full opacity-80"
        style={{ background: 'var(--guide-hue, var(--color-accent))' }}
      />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h3 className="font-serif text-2xl leading-tight text-brand-fg sm:text-[26px]">{title}</h3>
        {meta}
      </div>
      {blurb !== undefined && (
        <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-brand-muted">{blurb}</p>
      )}
    </div>
  );
}

/** The count chip `meta` slot is built for — "14 frames", "3 tools". */
export function CountChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-label uppercase tracking-luxe text-[10px] font-semibold text-brand-muted/75">
      {children}
    </span>
  );
}
