/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RemovalUndoBar: "Removed 3 photos · Undo", then the outcome.
 *
 * Guest surfaces have no ToastProvider, so this is self-contained and reads the
 * shared removal queue directly. It sits above the phone tab bar and never
 * covers more than one line. Mounted on My Photos and on the platform wall.
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Undo2 } from 'lucide-react';
import { outcomeMessage, pendingLabel } from '../../lib/guestRemovals';
import { removals, useRemovals } from '../../lib/guestRemovalsStore';

export default function RemovalUndoBar({ eventId }: { eventId: string }) {
  const snap = useRemovals();
  const batch = [...snap.batches].reverse().find((b) => b.eventId === eventId) ?? null;
  const outcome = snap.outcome && snap.outcome.eventId === eventId ? snap.outcome : null;
  const msg = !batch && outcome ? outcomeMessage(outcome) : null;

  // Good news clears itself; a failure waits to be read.
  useEffect(() => {
    if (!msg || msg.tone === 'error') return;
    const t = setTimeout(() => removals.dismissOutcome(), 4000);
    return () => clearTimeout(t);
  }, [msg?.text, msg?.tone]);

  const remaining = batch && batch.phase === 'waiting' ? Math.max(0, batch.deadline - Date.now()) : 0;

  return (
    <div
      className="fixed inset-x-0 z-[70] flex justify-center px-4 pointer-events-none bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)] sm:bottom-6"
    >
      <AnimatePresence>
        {(batch || msg) && (
          <motion.div
            key={batch ? batch.batchId : `o-${outcome?.batchId}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto relative overflow-hidden w-full max-w-sm rounded-2xl liquid-glass flex items-center gap-3 pl-4 pr-1.5 py-1.5 shadow-2xl"
            style={{ background: 'rgba(12,10,16,0.88)' }}
          >
            {batch ? (
              <>
                <p className="flex-1 min-w-0 font-sans text-[13px] text-brand-fg">
                  {batch.phase === 'waiting' ? pendingLabel(batch.count) : 'Removing…'}
                </p>
                {batch.phase === 'waiting' ? (
                  <button
                    type="button"
                    onClick={() => removals.undo(batch.batchId)}
                    className="pressable shrink-0 inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl font-label uppercase tracking-luxe text-[11px] text-[color:var(--color-accent)] hover:bg-white/[0.08]"
                  >
                    <Undo2 className="w-4 h-4" aria-hidden />
                    Undo
                  </button>
                ) : (
                  <span className="shrink-0 mr-3 block w-4 h-4 rounded-full border-2 border-white/25 border-t-white/80 animate-spin" aria-hidden />
                )}
                {batch.phase === 'waiting' && (
                  // The undo window, drawn as a draining hairline.
                  <motion.span
                    key={batch.batchId}
                    aria-hidden
                    className="absolute left-0 bottom-0 h-[2px] bg-[color:var(--color-accent)]/70"
                    initial={{ width: '100%' }}
                    animate={{ width: '0%' }}
                    transition={{ duration: remaining / 1000, ease: 'linear' }}
                  />
                )}
              </>
            ) : msg ? (
              <>
                <p className={`flex-1 min-w-0 py-2 font-sans text-[13px] leading-snug ${msg.tone === 'error' ? 'text-amber-300' : 'text-brand-fg'}`}>
                  {msg.text}
                </p>
                <button
                  type="button"
                  onClick={() => removals.dismissOutcome()}
                  className="pressable shrink-0 min-h-11 px-4 rounded-xl font-label uppercase tracking-luxe text-[11px] text-brand-fg hover:bg-white/[0.08]"
                >
                  OK
                </button>
              </>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
