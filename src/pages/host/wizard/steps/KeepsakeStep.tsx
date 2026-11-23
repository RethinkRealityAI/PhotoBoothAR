/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 7 (optional) — the keepsake: the album every guest gets the morning
 * after. It mounts the SAME editor Share & Print uses (KeepsakeEditor, wizard
 * variant): always guided, ending on Review, on the same one-card shell as
 * every other step, so it reads as part of the wizard rather than a page
 * dropped into it.
 *
 * The editor saves explicitly (its own Save button and its Review). Continue
 * saves any unsaved changes first and stays on the step if that fails — the
 * editor says why.
 */
import { useCallback } from 'react';
import KeepsakeEditor from '../../keepsake/KeepsakeEditor';
import { useWizard } from '../wizardContext';

export default function KeepsakeStep() {
  const w = useWizard();
  const register = useCallback((fn: (() => Promise<boolean>) | null) => w.setBeforeContinue(fn), [w.setBeforeContinue]); // eslint-disable-line react-hooks/exhaustive-deps
  return <KeepsakeEditor variant="wizard" eventUuid={w.ev.id} eventName={w.ev.name} onRegisterSave={register} />;
}
