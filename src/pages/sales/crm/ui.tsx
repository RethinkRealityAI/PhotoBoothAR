/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small shared pieces for the sales CRM. Kept local to crm/ — they are tuned
 * for a phone held one-handed between DMs (44px targets, bottom sheets), not
 * general-purpose platform components.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Facebook, Instagram, Linkedin, Music2, Twitter, X, Youtube, type LucideIcon } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../../lib/useDialog';
import type { SocialKey } from '../../../lib/crm';

export const SOCIAL_ICONS: Record<SocialKey, LucideIcon> = {
  instagram: Instagram, linkedin: Linkedin, tiktok: Music2, facebook: Facebook, youtube: Youtube, x: Twitter,
};

/** Chip classes (match the admin filter-chip idiom, 44px tall). */
export const chip =
  'pressable inline-flex items-center gap-1.5 shrink-0 rounded-full px-3.5 min-h-11 font-label uppercase tracking-[0.18em] text-[10px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/70';
export const chipOn = 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/55 text-brand-fg';
export const chipOff = 'bg-white/[0.03] border-white/10 text-brand-muted hover:text-brand-fg hover:bg-white/[0.06]';

export const btnPrimary =
  'pressable inline-flex items-center justify-center gap-2 min-h-11 rounded-xl px-5 bg-[color:var(--color-accent)] text-[color:var(--on-accent)] font-label uppercase tracking-[0.2em] text-[11px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-[color:var(--color-accent)]';
export const btnQuiet =
  'pressable inline-flex items-center justify-center gap-2 min-h-11 rounded-xl px-4 bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/85 font-label uppercase tracking-[0.18em] text-[10px] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/70';
export const iconBtn =
  'pressable inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-brand-muted hover:text-brand-fg transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/70';
export const inputCls =
  'w-full min-h-11 rounded-xl liquid-glass-inset px-3.5 text-[15px] sm:text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]/50 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-amber-400/60';
export const labelCls = 'block mb-1.5 font-label uppercase tracking-[0.2em] text-[10px] text-brand-muted/80';

/** Labelled input with an error line wired to aria-describedby. */
export function Field({
  label, error, hint, id: fixedId, children,
}: {
  label: string;
  error?: string;
  hint?: string;
  /** A stable id when the caller needs to focus the control. */
  id?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}) {
  const autoId = useId();
  const id = fixedId ?? autoId;
  const msgId = `${id}-msg`;
  const msg = error ?? hint;
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children({ id, 'aria-invalid': error !== undefined, 'aria-describedby': msg !== undefined ? msgId : undefined })}
      {msg !== undefined && (
        <p id={msgId} className={`mt-1 font-sans text-[11px] ${error !== undefined ? 'text-amber-300' : 'text-brand-muted/60'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

/** Textarea that grows with its content (notes can be long; a scroll-in-a-scroll is miserable on a phone). */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const { minRows = 3, className = '', value, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 640)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={`${inputCls} py-2.5 resize-none leading-relaxed ${className}`}
      {...rest}
    />
  );
}

/** Today's progress ring. */
export function ProgressRing({ value, target, size = 64 }: { value: number; target: number; size?: number }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  const done = value >= target;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={done ? 'rgb(110 231 183)' : 'var(--color-accent)'}
        strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700"
      />
    </svg>
  );
}

/**
 * Bottom sheet on a phone, centred dialog from `sm` up. Escape, focus trap
 * and focus restore come from useDialog (the same hook Modal uses).
 * `dismissOnScrim` defaults OFF: a sheet usually holds typed input.
 */
export function Sheet({
  title, onClose, children, footer, dismissOnScrim = false, wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dismissOnScrim?: boolean;
  wide?: boolean;
}) {
  // useDialog re-runs its focus effect whenever onClose's identity changes; a
  // parent re-rendering per keystroke would yank focus back to the first field.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const stableClose = useCallback(() => closeRef.current(), []);
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(stableClose, title);
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4"
      onClick={dismissOnScrim ? onClose : undefined}
    >
      <div
        ref={panelRef}
        {...dialogProps}
        onClick={(e) => e.stopPropagation()}
        className={`relative glass-strong w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92dvh] sm:max-h-[85vh] animate-rise-in`}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-white/[0.06]">
          <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 top-1.5 w-10 h-1 rounded-full bg-white/15 sm:hidden" />
          <h2 className="font-serif text-xl text-foil-static truncate">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={iconBtn}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 py-4 flex-1">{children}</div>
        {footer !== undefined && (
          <div className="px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/[0.06]">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Overlays must escape their ancestors: a `liquid-glass` (backdrop-filter) or
 * `animate-rise-in` (transform) parent becomes the containing block for
 * position:fixed, which trapped sheets under the hub's sticky nav. React
 * context (toasts) still flows through a portal.
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] motion-safe:animate-spin" />
  );
}

/** Pill for status / ICP / market. */
export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center shrink-0 px-2.5 py-0.5 rounded-full border text-[10px] font-label uppercase tracking-[0.16em] ${className}`}>
      {children}
    </span>
  );
}
