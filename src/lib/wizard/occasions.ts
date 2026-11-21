/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 1's occasion chips, and what each one seeds. Pure.
 */
import { templateById, templateConfigPatch, type TemplateId } from '../eventTemplates';
import { seededLooks } from '../themeMatch';
import { startProgress } from './wizardModel';
import { SLUG_RE, RESERVED_SLUGS } from '../slug';

export interface Occasion {
  id: TemplateId;
  label: string;
  /** Welcome-page template the occasion starts on (sceneThemes id). */
  sceneId: string;
}

export const OCCASIONS: readonly Occasion[] = [
  { id: 'wedding', label: 'Wedding', sceneId: 'blush-garden' },
  { id: 'birthday', label: 'Birthday', sceneId: 'aurora-glow' },
  { id: 'party', label: 'Party', sceneId: 'ember-lounge' },
  { id: 'gala', label: 'Gala or fundraiser', sceneId: 'midnight-club' },
  { id: 'corporate', label: 'Work event', sceneId: 'beamwall' },
] as const;

export function occasionById(id: string | null | undefined): Occasion {
  return OCCASIONS.find((o) => o.id === id) ?? OCCASIONS[2];
}

/**
 * Everything the new event starts with: the occasion's frames, effects and
 * copy, the brand look (no theme tokens), the occasion's welcome-page
 * template, the welcome page as the front door, and the wizard's progress.
 */
export function initialEventConfig(occasionId: TemplateId, eventName: string, nowIso: string): Record<string, unknown> {
  const t = templateById(occasionId) ?? templateById('party')!;
  const patch = templateConfigPatch(t, eventName);
  delete patch.themeVars;
  patch.look = 'beamwall';
  patch.arContent = seededLooks(t, null).arContent;
  patch.scene = { kind: 'template', id: occasionById(occasionId).sceneId };
  patch.landingRoute = '/welcome';
  patch.wizard = startProgress(nowIso);
  return patch;
}

/** Why a link cannot be used, or null. */
export function slugProblem(slug: string): string | null {
  if (slug === '') return 'Pick a link for your event.';
  if (!SLUG_RE.test(slug)) return 'Use lowercase letters, numbers and dashes.';
  if (RESERVED_SLUGS.has(slug)) return 'That link is reserved. Try another.';
  return null;
}

/** "2026-12-24" → "Thursday 24 December 2026" (local date, no timezone shift). */
export function formatEventDate(ymd: string | null | undefined): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** A timestamptz from the DB → the local "YYYY-MM-DD" a date input takes. */
export function ymdFromIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
