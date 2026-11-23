/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guided sub-steps for a wizard step (rules: lib/wizard/subSteps). Gives the
 * step its bar (numbered with ticks while guided, free tabs once the step has
 * been finished before), its Back / "Next: …" row, and the props for the
 * panel the bar points at.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  initialSubStepSeen, markSubStepSeen, subStepForKey, subStepLabel, subStepMode, subStepNav, subStepPosition, subStepReachable,
  type SubStepDef,
} from '../../../lib/wizard/subSteps';
import type { WizardStepId } from '../../../lib/wizard/wizardModel';
import { StepBar, StepNav, focusStepPanel } from './StageCard';
import { useWizard } from './wizardContext';

export interface SubSteps<T extends string> {
  current: T;
  go: (id: T) => void;
  bar: ReactNode;
  nav: ReactNode;
  /** Spread onto the element holding the current sub-step's options. */
  panelProps: { id: string; role: 'tabpanel' | 'region'; 'aria-labelledby': string; tabIndex: number };
  hint: string;
}

export function useSubSteps<T extends string>(step: WizardStepId, defs: readonly SubStepDef<T>[], icons?: Partial<Record<T, LucideIcon>>): SubSteps<T> {
  const { progress } = useWizard();
  const ids = defs.map((d) => d.id);
  // The mode is fixed when the step opens, so the bar does not turn into tabs
  // under the host the moment they reach the last sub-step.
  const [mode] = useState(() => subStepMode(ids, progress?.done.includes(step) ?? false, []));
  const [seen, setSeen] = useState<readonly T[]>(() => initialSubStepSeen(ids, mode));
  const [current, setCurrent] = useState<T>(ids[0]);
  const refs = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const idBase = `wz-sub-${step}`;

  const go = (id: T, focus: 'tab' | 'panel' | null = null) => {
    setCurrent(id);
    setSeen((s) => markSubStepSeen(ids, s, id));
    if (focus === 'tab') requestAnimationFrame(() => refs.current[id]?.focus());
    if (focus === 'panel') focusStepPanel(`${idBase}-panel-${id}`);
  };

  const free = mode === 'free';
  const bar = (
    <StepBar<T>
      idBase={idBase}
      label={`${defs.length} parts of this step`}
      mode={free ? 'tabs' : 'steps'}
      current={current}
      refs={refs}
      doneText=", seen"
      keyFor={(cur, key) => subStepForKey(ids, cur, key)}
      items={defs.map((d) => ({
        id: d.id,
        label: d.label,
        Icon: icons?.[d.id],
        done: seen.includes(d.id),
        reachable: subStepReachable(d.id, seen, mode),
      }))}
      onPick={(id, via) => go(id, via === 'key' ? 'tab' : null)}
    />
  );
  const nav_ = subStepNav(ids, current);
  const pos = subStepPosition(ids, current);
  const nav = (
    <StepNav
      onBack={nav_.prev !== null ? () => go(nav_.prev as T) : null}
      next={nav_.next !== null ? subStepLabel(defs, nav_.next) : null}
      position={`Part ${pos.number} of ${pos.total}`}
      onNext={() => { if (nav_.next !== null) go(nav_.next, 'panel'); }}
    />
  );
  return {
    current,
    go: (id) => go(id),
    bar,
    nav,
    panelProps: { id: `${idBase}-panel-${current}`, role: free ? 'tabpanel' : 'region', 'aria-labelledby': `${idBase}-tab-${current}`, tabIndex: -1 },
    hint: defs.find((d) => d.id === current)?.hint ?? '',
  };
}
