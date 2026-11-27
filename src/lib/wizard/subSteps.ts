/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guided sub-steps inside a wizard step — pure, so the rules are tested.
 *
 * The owner's rule (2026-11-22): where a step's tabs hide SEPARATE decisions
 * (Welcome's background vs its border vs its words), the tabs become guided
 * sub-steps like the keepsake editor's: a numbered bar, a tick on each one
 * seen, Back / "Next: Words" at the bottom, and no skipping ahead the first
 * time. Tabs that only FILTER one choice (Looks' categories) stay tabs.
 *
 * "The first time" is the step itself: a step the host has already finished
 * (it is in `config.wizard.done`) opens with every sub-step free, so coming
 * back to change one thing never walks them through the lot again. Nothing
 * new is stored.
 */
import { tabIndexForKey } from './tabKeys';
import type { WizardStepId } from './wizardModel';

export interface SubStepDef<T extends string = string> {
  id: T;
  label: string;
  /** One line under the bar: what this sub-step decides. */
  hint: string;
}

export type WelcomeSubStep = 'background' | 'border' | 'words';
export type PowerUpsSubStep = 'gestures' | 'gear';
export type WallSubStep = 'style' | 'layout' | 'background' | 'photos' | 'arrival' | 'music' | 'screen';

export const WELCOME_SUBSTEPS: readonly SubStepDef<WelcomeSubStep>[] = [
  { id: 'background', label: 'Background', hint: 'A template, a colour or your own photo behind your welcome page.' },
  { id: 'border', label: 'Border', hint: 'An optional border around the page.' },
  { id: 'words', label: 'Words', hint: 'A line of welcome in your own words.' },
];

export const POWERUPS_SUBSTEPS: readonly SubStepDef<PowerUpsSubStep>[] = [
  { id: 'gestures', label: 'Gestures', hint: 'A smile or an open mouth sets off an effect, whatever look a guest has on.' },
  { id: 'gear', label: 'Power gear', hint: 'Superhero filters with their own blasts. They join your filters.' },
];

export const WALL_SUBSTEPS: readonly SubStepDef<WallSubStep>[] = [
  { id: 'style', label: 'Style', hint: 'Start from a finished style. The next steps fine-tune it.' },
  { id: 'layout', label: 'Layout', hint: 'How the photos are arranged on the screen.' },
  { id: 'background', label: 'Background', hint: 'What sits behind the photos.' },
  { id: 'photos', label: 'Photos', hint: 'How each photo card looks.' },
  { id: 'arrival', label: 'Arrival', hint: 'How a new photo lands on the wall.' },
  { id: 'music', label: 'Music', hint: 'Background music for the room, from a free library.' },
  { id: 'screen', label: 'Screen', hint: 'What else the wall shows beside the photos.' },
];

/**
 * How each wizard step organises what it asks. `guided` = separate decisions,
 * walked one after another; `filter-tabs` = tabs that narrow ONE choice (they
 * stay tabs); `single` = one screen, nothing to split; `own-guided` = the step
 * mounts an editor that brings its own guided steps (the keepsake editor).
 */
export type StepOrganisation = 'single' | 'filter-tabs' | 'guided' | 'own-guided';

export interface StepClassification {
  kind: StepOrganisation;
  /** The sub-steps, for `guided` steps. */
  subSteps?: readonly SubStepDef[];
  /** Why, in a line — the report and the tests read it. */
  why: string;
}

export const STEP_ORGANISATION: Record<WizardStepId, StepClassification> = {
  basics: { kind: 'single', why: 'Name, occasion and date are one short form.' },
  invite: {
    kind: 'guided',
    subSteps: WELCOME_SUBSTEPS,
    why: 'Background, border and the welcome line are three separate decisions. Templates / Colour / Photo stay tabs inside Background: they are three ways to make the ONE background choice.',
  },
  looks: {
    kind: 'filter-tabs',
    why: 'Frames, 3D props, Face paint, Effects and Filters all narrow one shelf of looks to offer; the Filters views (yours / ready-made / make one) narrow the same list.',
  },
  powerups: {
    kind: 'guided',
    subSteps: POWERUPS_SUBSTEPS,
    why: 'Gestures (event-wide effects) and Power gear (extra filters) are two independent sets, each with its own on/off choices.',
  },
  challenges: {
    kind: 'filter-tabs',
    why: 'Suggested and Write your own are two ways to fill the ONE challenge list.',
  },
  booth: {
    kind: 'guided',
    subSteps: WALL_SUBSTEPS,
    why: 'A style, then the layout, background, photo cards, arrival, music and screen extras are each their own decision about the live wall.',
  },
  keepsake: { kind: 'own-guided', why: 'The keepsake editor brings its own guided steps (Look, Greeting, Take-home, Music, Sending, Review).' },
  intro: { kind: 'single', why: 'One choice (Beamy’s intro, your own, or off), then the step chips pick which ONE step to edit; the preview follows the chip.' },
  launch: { kind: 'single', why: 'A checklist, Go live and the share kit on one screen.' },
};

export type SubStepMode = 'guided' | 'free';

/** Free once the step was finished before (or every sub-step was already seen). */
export function subStepMode(ids: readonly string[], stepDone: boolean, seenAtOpen: readonly string[]): SubStepMode {
  if (stepDone) return 'free';
  return ids.length > 0 && ids.every((id) => seenAtOpen.includes(id)) ? 'free' : 'guided';
}

/** What counts as seen when the step opens: everything when free, the first sub-step when guided. */
export function initialSubStepSeen<T extends string>(ids: readonly T[], mode: SubStepMode): readonly T[] {
  if (mode === 'free') return [...ids];
  return ids.length > 0 ? [ids[0]] : [];
}

/** Add a sub-step to the seen list in order, without duplicates. Returns the
 *  SAME array when nothing changed (no needless re-render). Unknown ids are ignored. */
export function markSubStepSeen<T extends string>(ids: readonly T[], seen: readonly T[], id: T): readonly T[] {
  if (seen.includes(id) || !ids.includes(id)) return seen;
  return ids.filter((s) => s === id || seen.includes(s));
}

/** Can the host click it in the bar? Guided: only sub-steps already seen. Free: any. */
export function subStepReachable<T extends string>(id: T, seen: readonly T[], mode: SubStepMode): boolean {
  return mode === 'free' || seen.includes(id);
}

/** Back / Next targets (no wrap). */
export function subStepNav<T extends string>(ids: readonly T[], id: T): { prev: T | null; next: T | null } {
  const i = ids.indexOf(id);
  if (i < 0) return { prev: null, next: ids[0] ?? null };
  return { prev: i > 0 ? ids[i - 1] : null, next: i < ids.length - 1 ? ids[i + 1] : null };
}

/** "Step 2 of 3". */
export function subStepPosition<T extends string>(ids: readonly T[], id: T): { number: number; total: number } {
  return { number: Math.max(0, ids.indexOf(id)) + 1, total: ids.length };
}

/** Arrow keys / Home / End across the free-mode tabs (the wizard's tablist rules). */
export function subStepForKey<T extends string>(ids: readonly T[], current: T, key: string): T | null {
  const i = tabIndexForKey(key, ids.indexOf(current), ids.length);
  return i === null ? null : ids[i];
}

export function subStepLabel(steps: readonly SubStepDef[], id: string): string {
  return steps.find((s) => s.id === id)?.label ?? '';
}
