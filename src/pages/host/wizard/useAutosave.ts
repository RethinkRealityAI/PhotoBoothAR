/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Save a value a moment after the host stops changing it, and once more on
 * the way out (Continue waits for the pending write, so nothing is lost).
 */
import { useEffect, useRef } from 'react';
import { useWizard } from './wizardContext';

export function useAutosave<T>(value: T, toPatch: (v: T) => Record<string, unknown>, delayMs = 650): void {
  const w = useWizard();
  const first = useRef(true);
  const pending = useRef<T | null>(null);
  const toPatchRef = useRef(toPatch);
  toPatchRef.current = toPatch;
  const flush = useRef(async () => true);
  flush.current = async () => {
    if (pending.current === null) return true;
    const v = pending.current;
    pending.current = null;
    return w.saveConfig(toPatchRef.current(v));
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pending.current = value;
    const t = setTimeout(() => { void flush.current(); }, delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);

  useEffect(() => {
    w.setBeforeContinue(() => flush.current());
    return () => w.setBeforeContinue(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
