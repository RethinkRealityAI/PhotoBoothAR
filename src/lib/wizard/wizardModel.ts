/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The event setup wizard's step model — pure (no React, no supabase), so the
 * step order, the progress maths and the "where do I pick up?" answer are
 * unit-tested and shared by the wizard and the dashboard's "Continue setup".
 *
 * Progress is stored on the event itself, in `events.config.wizard` (jsonb that
 * already exists — no migration): the event is created as a draft at the end
 * of step 1, so every later step autosaves to the real event and a host who
 * leaves can come back to exactly the step they left.
 *
 *   { v: 1, step: 'looks', done: ['basics','invite','booth'], startedAt, completedAt? }
 *
 * Untrusted on read (any host could have hand-edited config through the API),
 * so `normalizeWizardProgress` is total: anything malformed is dropped, never
 * thrown.
 */

export type WizardStepId = 'basics' | 'invite' | 'booth' | 'looks' | 'powerups' | 'challenges' | 'launch';

export interface WizardStepDef {
  id: WizardStepId;
  /** Short rail label. */
  label: string;
  /** The step's heading, in the host's words. */
  title: string;
  /** One line under the heading — what this step is for. */
  blurb: string;
  /** May the host skip it and come back later? */
  optional: boolean;
}

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: 'basics', label: 'Basics', title: 'What are we celebrating?', blurb: 'A name and a date. You can change both later.', optional: false },
  { id: 'invite', label: 'Welcome page', title: 'Design your welcome page', blurb: 'What guests see when they scan your QR, and what you put on the big screen.', optional: false },
  { id: 'booth', label: 'Booth & screen', title: 'Set up your booth', blurb: 'The booth guests open on their phones, and the live photo wall on the big screen.', optional: false },
  { id: 'looks', label: 'Looks', title: 'Pick the looks', blurb: 'Choose the frames, 3D props and effects guests can try on, and bundle your favourites into filters.', optional: false },
  { id: 'powerups', label: 'Power-ups', title: 'Add a little magic', blurb: 'Surprises that fire when guests smile or gesture.', optional: true },
  { id: 'challenges', label: 'Challenges', title: 'Give guests a mission', blurb: 'Photo challenges keep the booth busy all night.', optional: true },
  { id: 'launch', label: 'Launch', title: 'Ready when you are', blurb: 'Check everything over, then go live and share your QR.', optional: false },
] as const;

export const WIZARD_STEP_IDS: readonly WizardStepId[] = WIZARD_STEPS.map((s) => s.id);

/** The steps that count towards "N of M done" (launch is the finish line). */
export const COUNTED_STEPS: readonly WizardStepId[] = WIZARD_STEP_IDS.filter((id) => id !== 'launch');

export interface WizardProgress {
  v: 1;
  /** The step the host was last on. */
  step: WizardStepId;
  /** Steps finished, in the order they were finished (no duplicates). */
  done: WizardStepId[];
  startedAt?: string;
  /** Set once the host finishes the launch step. */
  completedAt?: string;
}

export function isWizardStepId(v: unknown): v is WizardStepId {
  return typeof v === 'string' && (WIZARD_STEP_IDS as readonly string[]).includes(v);
}

export function stepDef(id: WizardStepId): WizardStepDef {
  return WIZARD_STEPS.find((s) => s.id === id) ?? WIZARD_STEPS[0];
}

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEP_IDS.indexOf(id);
}

export function nextStepId(id: WizardStepId): WizardStepId | null {
  const i = stepIndex(id);
  return i >= 0 && i < WIZARD_STEP_IDS.length - 1 ? WIZARD_STEP_IDS[i + 1] : null;
}

export function prevStepId(id: WizardStepId): WizardStepId | null {
  const i = stepIndex(id);
  return i > 0 ? WIZARD_STEP_IDS[i - 1] : null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

/** Total coercion of `events.config.wizard`. Null = no wizard on this event. */
export function normalizeWizardProgress(raw: unknown): WizardProgress | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const done: WizardStepId[] = [];
  if (Array.isArray(r.done)) {
    for (const d of r.done) if (isWizardStepId(d) && !done.includes(d)) done.push(d);
  }
  const out: WizardProgress = { v: 1, step: isWizardStepId(r.step) ? r.step : 'basics', done };
  if (typeof r.startedAt === 'string' && ISO_RE.test(r.startedAt)) out.startedAt = r.startedAt;
  if (typeof r.completedAt === 'string' && ISO_RE.test(r.completedAt)) out.completedAt = r.completedAt;
  return out;
}

/** A fresh progress record, written when the event is created (step 1 done). */
export function startProgress(nowIso: string): WizardProgress {
  return { v: 1, step: 'invite', done: ['basics'], startedAt: nowIso };
}

/**
 * Record that the host finished (or skipped past) `id` and moved on. The step
 * pointer moves to the next step; finishing `launch` stamps completedAt. A
 * repeat finish of the same step changes nothing but the pointer.
 */
export function completeStep(p: WizardProgress | null, id: WizardStepId, nowIso: string): WizardProgress {
  const base = p ?? { v: 1 as const, step: id, done: [], startedAt: nowIso };
  const done = base.done.includes(id) ? [...base.done] : [...base.done, id];
  const out: WizardProgress = { ...base, done, step: nextStepId(id) ?? id };
  if (id === 'launch') out.completedAt = base.completedAt ?? nowIso;
  return out;
}

/** Move the pointer without finishing anything (the host jumped via the rail). */
export function visitStep(p: WizardProgress | null, id: WizardStepId, nowIso: string): WizardProgress {
  const base = p ?? { v: 1 as const, step: id, done: [], startedAt: nowIso };
  return { ...base, step: id };
}

/** Where to pick up: the saved step, unless it is already done — then the
 *  first step that is not. A finished wizard opens on launch. */
export function resumeStep(p: WizardProgress | null): WizardStepId {
  if (!p) return 'basics';
  if (p.completedAt) return 'launch';
  if (!p.done.includes(p.step)) return p.step;
  return WIZARD_STEP_IDS.find((id) => !p.done.includes(id)) ?? 'launch';
}

/** "3 of 6" — counted steps finished. */
export function countDone(p: WizardProgress | null): { done: number; total: number } {
  const total = COUNTED_STEPS.length;
  if (!p) return { done: 0, total };
  return { done: COUNTED_STEPS.filter((id) => p.done.includes(id)).length, total };
}

/** 0…1 for a progress ring. */
export function progressFraction(p: WizardProgress | null): number {
  if (p?.completedAt) return 1;
  const { done, total } = countDone(p);
  return total === 0 ? 0 : done / total;
}

/** True while an event's setup was started in the wizard and not finished —
 *  the dashboard shows "Continue setup" for exactly these. */
export function setupInProgress(config: unknown): boolean {
  const cfg = config !== null && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  const p = normalizeWizardProgress(cfg.wizard);
  return p !== null && p.completedAt === undefined;
}

/** The dashboard chip: "Continue setup · Looks (3 of 6)". Null when not in progress. */
export function setupChip(config: unknown): { label: string; step: WizardStepId; done: number; total: number } | null {
  if (!setupInProgress(config)) return null;
  const cfg = config as Record<string, unknown>;
  const p = normalizeWizardProgress(cfg.wizard);
  const step = resumeStep(p);
  const { done, total } = countDone(p);
  return { label: stepDef(step).label, step, done, total };
}

/** The wizard route for an event, optionally at a step. */
export function setupPath(eventUuid: string, step?: WizardStepId): string {
  return step ? `/host/setup/${eventUuid}/${step}` : `/host/setup/${eventUuid}`;
}
