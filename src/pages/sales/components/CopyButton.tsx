/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-tap copy with visible + announced feedback. Built on copyText(), which
 * never throws and works on a plain-HTTP LAN preview where the async
 * Clipboard API is missing.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { copyText } from '../../../lib/clipboard';

type State = 'idle' | 'ok' | 'fail';

export default function CopyButton({
  text,
  label = 'Copy',
  ariaLabel,
  variant = 'solid',
  className = '',
  onCopied,
}: {
  text: string;
  label?: string;
  ariaLabel?: string;
  variant?: 'solid' | 'ghost' | 'icon';
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<State>('idle');
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const run = async () => {
    const ok = await copyText(text);
    setState(ok ? 'ok' : 'fail');
    if (ok) onCopied?.();
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };

  const Icon = state === 'ok' ? Check : state === 'fail' ? X : Copy;
  const shown = state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed' : label;

  const base =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full font-label text-[11px] font-semibold uppercase tracking-[0.16em] transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] disabled:opacity-40';
  const look =
    variant === 'solid'
      ? state === 'ok'
        ? 'bg-emerald-400/90 px-5 text-[#04140c]'
        : 'bg-foil px-5 text-white glow-accent'
      : variant === 'ghost'
        ? `border px-4 ${state === 'ok' ? 'border-emerald-400/50 text-emerald-300' : 'border-white/15 bg-white/[0.04] text-brand-fg hover:bg-white/[0.08]'}`
        : `w-11 border ${state === 'ok' ? 'border-emerald-400/50 text-emerald-300' : 'border-white/15 bg-white/[0.04] text-brand-fg hover:bg-white/[0.08]'}`;

  return (
    <button
      type="button"
      onClick={run}
      disabled={text === ''}
      aria-label={variant === 'icon' ? (ariaLabel ?? label) : ariaLabel}
      className={`${base} ${look} ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {variant !== 'icon' && <span>{shown}</span>}
      <span className="sr-only" aria-live="polite">
        {state === 'ok' ? 'Copied to clipboard' : state === 'fail' ? 'Copy failed' : ''}
      </span>
    </button>
  );
}
