/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shared frame of an /admin screen: page width and padding, the title
 * block, the refresh button and the search field. Each screen used to build
 * its own, so the title jumped sideways from page to page (four different
 * widths), half the refresh buttons had no name for a screen reader and were
 * 32px targets, and the search fields differed in size and focus style.
 */
import type { ReactNode } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';

/** Page shell. `wide` is for the two-pane screens (support inbox, features). */
export function AdminPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-full px-4 pt-5 md:px-8 md:pt-10 pb-safe-bottom [--safe-bottom:2.5rem]">
      <div className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-6xl'}`}>{children}</div>
    </div>
  );
}

export function AdminHeader({
  title,
  subtitle,
  note,
  actions,
  above,
}: {
  title: ReactNode;
  /** One line on what the screen is for. */
  subtitle?: ReactNode;
  /** The live count line ("12 events."), announced politely as it changes. */
  note?: ReactNode;
  /** Compact buttons on the right of the title (a refresh, one primary action). */
  actions?: ReactNode;
  /** A back link or breadcrumb over the title. */
  above?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        {above}
        <h1 className="font-serif text-2xl md:text-3xl text-foil-static break-words">{title}</h1>
        {subtitle && <p className="mt-1 font-sans text-sm text-brand-muted/75">{subtitle}</p>}
        {note && (
          <p className="mt-1 font-sans text-[11px] text-brand-muted/65" aria-live="polite">{note}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** One number with its label, as on Overview and Payments. */
export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="glass-strong rounded-2xl p-5 flex flex-col gap-1 min-w-0">
      <p className="font-sans text-[11px] text-brand-muted/75">{label}</p>
      <p className="mt-1 font-serif text-2xl sm:text-3xl text-foil-static leading-none tabular-nums break-words">{value}</p>
      {sub && <p className="mt-1 font-sans text-[11px] text-brand-muted/65">{sub}</p>}
    </div>
  );
}

/** A whole-screen "couldn't load" or "nothing yet" panel with an optional action. */
export function AdminNotice({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="liquid-glass rounded-3xl p-8 sm:p-12 text-center max-w-lg mx-auto">
      <h2 className="font-serif text-2xl text-foil-static mb-2">{title}</h2>
      {children && <div className="font-sans text-sm text-brand-muted/80 leading-relaxed">{children}</div>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="pressable mt-6 inline-flex items-center gap-2 min-h-11 rounded-full bg-foil px-6 font-sans text-sm font-semibold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98]"
        >
          <RefreshCw className="w-4 h-4" /> {action.label}
        </button>
      )}
    </div>
  );
}

export function RefreshButton({ onClick, busy = false, label = 'Refresh' }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="pressable grid place-items-center w-11 h-11 rounded-xl border border-white/10 bg-white/[0.05] text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.09] transition-colors disabled:opacity-40"
    >
      <RefreshCw className={`w-4 h-4 ${busy ? 'motion-safe:animate-spin' : ''}`} />
    </button>
  );
}

export function AdminSearch({
  value,
  onChange,
  placeholder,
  label,
  className = 'mb-4 max-w-sm',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** What the field searches, for a screen reader ("Search customers"). */
  label: string;
  className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden className="pointer-events-none w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted/60" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-11 min-h-11 rounded-xl bg-white/[0.06] border border-white/10 font-sans text-sm text-brand-fg placeholder:text-brand-muted/60 outline-none transition-colors hover:border-white/20 focus:border-[color:var(--color-accent)]/60 focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/30 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value !== '' && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-0 top-0 grid place-items-center w-11 h-11 rounded-xl text-brand-muted/70 hover:text-brand-fg"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </label>
  );
}
