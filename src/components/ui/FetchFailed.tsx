/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "We couldn't load this" — the honest counterpart to an empty state.
 *
 * The guest surfaces used to render their empty state whenever a fetch failed,
 * so a dropped connection read as "nobody has posted yet" or "you have no
 * photos". Anywhere a list can be empty *or* broken, this renders the broken
 * case with a way out.
 */
import { WifiOff, RotateCw } from 'lucide-react';

interface Props {
  /** What failed to load, in the guest's words: "the wall", "your moments". */
  what: string;
  onRetry: () => void;
  /** Set while a retry is in flight so the control can't be double-fired. */
  retrying?: boolean;
}

export default function FetchFailed({ what, onRetry, retrying = false }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-20 h-20 rounded-full liquid-glass flex items-center justify-center mb-6">
        <WifiOff className="w-8 h-8 text-[color:var(--color-accent)]" />
      </div>
      <p className="font-serif italic text-2xl text-foil-static mb-2">Couldn’t load {what}</p>
      <p className="font-sans text-brand-muted/70 text-sm max-w-xs leading-relaxed">
        This is usually the venue’s wifi rather than anything you did. Check your connection and try again.
      </p>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="mt-7 inline-flex items-center gap-2 min-h-11 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[11px] px-8 rounded-xl glow-accent disabled:opacity-60"
      >
        <RotateCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
        {retrying ? 'Trying…' : 'Try again'}
      </button>
    </div>
  );
}
