/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small shared pieces of the hub's visual language.
 */
import type { ReactNode } from 'react';
import type { IcpId } from '../../../lib/salesTypes';

export const ICP_LABEL: Record<IcpId, string> = {
  planners: 'Planners',
  brands: 'Brands',
  creators: 'Creators',
};

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] ${
        active
          ? 'border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/15 text-brand-fg'
          : 'border-white/10 bg-white/[0.03] text-brand-muted hover:text-brand-fg'
      }`}
    >
      {children}
    </button>
  );
}

/** A labelled, horizontally scrolling chip row (never wraps the page wider). */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="w-14 shrink-0 font-label text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-muted/70">{label}</span>
      <div className="hide-scrollbar -mr-4 flex min-w-0 flex-1 gap-2 overflow-x-auto pr-4 sm:mr-0 sm:flex-wrap sm:overflow-visible sm:pr-0">{children}</div>
    </div>
  );
}

export function SectionHead({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: ReactNode }) {
  return (
    <div className="mb-6">
      <p className="font-label text-[10.5px] font-semibold uppercase tracking-[0.28em] text-accent">{eyebrow}</p>
      <h2 className="mt-1.5 font-serif text-[32px] font-semibold leading-tight text-brand-fg sm:text-[40px]">{title}</h2>
      {intro !== undefined && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-brand-muted">{intro}</p>}
    </div>
  );
}

export function PlaceholderBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-300/10 px-2 py-0.5 font-label text-[9.5px] font-bold uppercase tracking-[0.16em] text-amber-200">
      Placeholder
    </span>
  );
}
