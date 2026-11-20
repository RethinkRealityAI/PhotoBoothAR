/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The setup wizard's reads and writes — thin glue over the stores the host
 * already uses (host.ts / db.ts). Every write is checked and reported; the
 * wizard never says "Saved" for a write that did not land.
 */
import { supabase } from '../supabase';
import type { Experience } from '../../types';
import { updateEventConfig } from '../host';
import {
  createExperience, deleteExperience, fetchExperiences, fetchLibraryForEventResult, linkCatalogItem, unlinkCatalogItem,
} from '../db';
import { BUNDLED_PROP_MAP } from '../studio/bundledProps';
import { classicRow, diffPicks, picksConfigPatch, picksFromEvent, wizardRefOf, type LookPicks } from './looks';
import type { WizardProgress } from './wizardModel';

export interface WizardEvent {
  id: string;
  slug: string;
  name: string;
  status: string;
  event_type: string;
  starts_at: string | null;
  config: Record<string, unknown>;
}

/** The event the wizard is setting up (member RLS: drafts included). */
export async function fetchWizardEvent(eventUuid: string): Promise<WizardEvent | null | 'failed'> {
  const { data, error } = await supabase
    .from('events')
    .select('id, slug, name, status, event_type, starts_at, config')
    .eq('id', eventUuid)
    .maybeSingle();
  if (error) {
    console.error('[wizard] fetchWizardEvent', error);
    return 'failed';
  }
  if (!data) return null;
  return { ...(data as Omit<WizardEvent, 'config'>), config: ((data as { config?: unknown }).config ?? {}) as Record<string, unknown> };
}

/** Merge a config patch and the progress pointer in ONE write. */
export async function saveConfig(
  ev: WizardEvent,
  patch: Record<string, unknown>,
  progress?: WizardProgress,
): Promise<WizardEvent | null> {
  const full = progress ? { ...patch, wizard: progress } : patch;
  const ok = await updateEventConfig(ev.id, full);
  return ok ? { ...ev, config: { ...ev.config, ...full } } : null;
}

/* ── Looks ─────────────────────────────────────────────────────────── */

export interface LooksData {
  library: (Experience & { library_category_id?: string | null })[];
  categoryNames: Map<string, string>;
  linkedIds: string[];
  eventRows: Experience[];
  failed: boolean;
}

export async function fetchLooksData(slug: string): Promise<LooksData> {
  const [lib, cats, rows] = await Promise.all([
    fetchLibraryForEventResult(slug),
    supabase.from('library_categories').select('id, name').order('sort_order'),
    fetchExperiences(slug),
  ]);
  const categoryNames = new Map<string, string>(
    ((cats.data as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]),
  );
  return {
    library: lib.rows as LooksData['library'],
    categoryNames,
    linkedIds: lib.linkedIds,
    eventRows: rows,
    failed: lib.failed || cats.error !== null,
  };
}

export function currentPicks(ev: WizardEvent, data: LooksData): LookPicks {
  const kinds = new Map(data.library.map((r) => [r.id, r.kind as string]));
  return picksFromEvent(ev.config, data.linkedIds, data.eventRows, kinds);
}

export interface ApplyPicksResult {
  ev: WizardEvent;
  data: LooksData;
  /** How many individual writes failed (0 = all landed). */
  failures: number;
}

/**
 * Make the event offer exactly `after`. Links, classic rows and the allow-list
 * config are written independently; the result reports what did not land so
 * the step can say so instead of a blanket "Saved".
 */
export async function applyPicks(ev: WizardEvent, data: LooksData, after: LookPicks): Promise<ApplyPicksResult> {
  const before = currentPicks(ev, data);
  const d = diffPicks(before, after);
  let failures = 0;
  const linked = new Set(data.linkedIds);
  for (const id of d.link) {
    if (await linkCatalogItem(ev.slug, id)) linked.add(id);
    else failures++;
  }
  for (const id of d.unlink) {
    if (await unlinkCatalogItem(ev.slug, id)) linked.delete(id);
    else failures++;
  }
  let rows = data.eventRows;
  for (const propId of d.addClassics) {
    const prop = BUNDLED_PROP_MAP[propId];
    const draft = prop ? classicRow(prop) : null;
    const row = draft ? await createExperience(ev.slug, draft) : null;
    if (row) rows = [...rows, row];
    else failures++;
  }
  for (const propId of d.removeClassics) {
    const victims = rows.filter((r) => wizardRefOf(r) === `classic:${propId}`);
    for (const v of victims) {
      if (await deleteExperience(ev.slug, v.id)) rows = rows.filter((r) => r.id !== v.id);
      else failures++;
    }
  }
  let nextEv = ev;
  // Always written on the first save so an untouched "everything" allow-list
  // becomes the explicit list the host saw ticked.
  const patch = picksConfigPatch(ev.config, after);
  const saved = await saveConfig(ev, patch);
  if (saved) nextEv = saved;
  else failures++;
  return { ev: nextEv, data: { ...data, linkedIds: [...linked], eventRows: rows }, failures };
}

/* ── Filters ───────────────────────────────────────────────────────── */

export async function addFilterRow(slug: string, draft: Parameters<typeof createExperience>[1]): Promise<Experience | null> {
  return createExperience(slug, draft);
}

export async function removeFilterRow(slug: string, id: string): Promise<boolean> {
  return deleteExperience(slug, id);
}

/** Upload helper with the same name rule as the rest of the host app. */
export { uploadAsset } from '../db';
