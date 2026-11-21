/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What every wizard step gets from the shell.
 */
import { createContext, useContext } from 'react';
import type { WizardEvent } from '../../../lib/wizard/wizardApi';
import type { WizardProgress, WizardStepId } from '../../../lib/wizard/wizardModel';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface WizardCtx {
  ev: WizardEvent;
  progress: WizardProgress | null;
  /** Merge a config patch into the event (one checked write). Resolves to
   *  whether it landed; the shell shows Saving… / Saved / Couldn't save. */
  saveConfig: (patch: Record<string, unknown>) => Promise<boolean>;
  /** Replace the event after a write the step did itself (name, date, rows). */
  setEv: (ev: WizardEvent) => void;
  /** Report a save the step ran itself, so the shell's indicator is honest. */
  reportSave: (state: SaveState) => void;
  /** A step can hold Continue until its own batch write lands. Return false
   *  to stay on the step (the step shows why). */
  setBeforeContinue: (fn: (() => Promise<boolean>) | null) => void;
  /** Disable Continue with a reason (e.g. a required field). */
  setBlocked: (reason: string | null) => void;
  goTo: (step: WizardStepId) => void;
}

export const WizardContext = createContext<WizardCtx | null>(null);

export function useWizard(): WizardCtx {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard outside EventWizard');
  return ctx;
}
