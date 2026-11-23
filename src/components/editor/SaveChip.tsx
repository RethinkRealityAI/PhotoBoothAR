/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The editor's save status: Saving / Saved / Couldn't save (with Retry).
 * Same look as the setup wizard's chip; the failed state can be acted on.
 */
import { Check, CloudOff, Loader2, RotateCw } from 'lucide-react';

export type EditorSaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function SaveChip({ state, onRetry, compact = false }: {
  state: EditorSaveState;
  onRetry?: () => void;
  /** Phone header: icon + a short word. */
  compact?: boolean;
}) {
  if (state === 'idle') return null;
  if (state === 'error') {
    return (
      <span role="status" className="inline-flex items-center gap-1 rounded-full bg-[rgba(255,120,140,0.22)] pl-3 pr-1 min-h-11 text-[12.5px] text-white">
        <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">{compact ? 'Not saved' : 'Couldn’t save'}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="pressable inline-flex items-center gap-1 rounded-full px-3 min-h-9 text-[12.5px] font-semibold bg-white/15 hover:bg-white/25"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        )}
      </span>
    );
  }
  return (
    <span role="status" className="inline-flex items-center gap-1.5 rounded-full px-2 sm:px-3 py-1 text-[12.5px] text-white/80 whitespace-nowrap">
      {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>{state === 'saving' ? 'Saving…' : 'Saved'}</span>
    </span>
  );
}
