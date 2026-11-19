/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Tag manager's PLANS, pure (no React, no supabase import): which library
 * items get which keyword add/remove for a rename, a merge, a delete, or a new
 * tag applied to a selection. "Tags" in the manager are the free keywords
 * (`experiences.library_keywords`), not the fixed occasion/colour/style
 * vocabulary the host matcher reads.
 *
 * Everything goes through ONE server action, bulk_update_library_items
 * {ids, addKeywords, removeKeywords}. On each row the server runs
 * `editKeywords(current, add, remove)`: remove first, then append adds, then
 * cut at KEYWORDS_PER_ITEM_MAX. So:
 *  - a rename/merge only ever ADDS the target to a row it also REMOVES a
 *    source from, which can never push a row past the cap;
 *  - a new tag on a row already at the cap would be cut off silently by that
 *    slice, so the plan reports those rows as `full` instead of sending them.
 * Rows needing the same edit share a call; each call carries at most
 * BULK_IDS_MAX ids (admin-api BULK_MAX = 200).
 */
import { KEYWORDS_PER_ITEM_MAX, normalizeKeyword } from './libraryTaxonomy';

/** admin-api `BULK_MAX` for bulk_update_library_items (ids per call). */
export const BULK_IDS_MAX = 200;

export interface TagRow {
  id: string;
  keywords?: readonly string[];
}

export interface TagUse {
  tag: string;
  count: number;
  ids: string[];
}

/** Every tag in use, most-used first, then A–Z. */
export function tagUsage(rows: readonly TagRow[]): TagUse[] {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    for (const k of new Set(r.keywords ?? [])) {
      const ids = map.get(k);
      if (ids) ids.push(r.id); else map.set(k, [r.id]);
    }
  }
  return [...map.entries()]
    .map(([tag, ids]) => ({ tag, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tags whose stored or spoken form contains the query ("santa h" finds santa-hat). */
export function filterTags(uses: readonly TagUse[], query: string): TagUse[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...uses];
  const asKey = normalizeKeyword(q);
  return uses.filter((u) => u.tag.includes(q) || u.tag.replace(/-/g, ' ').includes(q) || (asKey !== null && u.tag.includes(asKey)));
}

export interface TagCall {
  ids: string[];
  addKeywords?: string[];
  removeKeywords?: string[];
}

export interface TagPlan {
  calls: TagCall[];
  /** Distinct items the plan edits. */
  items: number;
  /** Items left alone because they already hold the per-item maximum. */
  full: string[];
}

export type TagPlanResult =
  | ({ ok: true; reason?: undefined } & TagPlan)
  | { ok: false; reason: string; calls?: undefined; items?: undefined; full?: undefined };

function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Group rows by an identical edit, then split each group by the id cap. */
function toCalls(edits: ReadonlyArray<{ id: string; add: string[]; remove: string[] }>): TagCall[] {
  const groups = new Map<string, { add: string[]; remove: string[]; ids: string[] }>();
  for (const e of edits) {
    const key = `${e.add.join(',')}|${e.remove.join(',')}`;
    const g = groups.get(key);
    if (g) g.ids.push(e.id); else groups.set(key, { add: e.add, remove: e.remove, ids: [e.id] });
  }
  const calls: TagCall[] = [];
  for (const g of groups.values()) {
    for (const ids of chunk(g.ids, BULK_IDS_MAX)) {
      calls.push({
        ids,
        ...(g.add.length > 0 ? { addKeywords: g.add } : {}),
        ...(g.remove.length > 0 ? { removeKeywords: g.remove } : {}),
      });
    }
  }
  return calls;
}

function plan(edits: ReadonlyArray<{ id: string; add: string[]; remove: string[] }>, full: string[] = []): TagPlanResult {
  return { ok: true, calls: toCalls(edits), items: edits.length, full };
}

/** Normalise a typed tag name, or explain why it is not one. */
export function checkTagName(raw: string): { ok: true; tag: string; reason?: undefined } | { ok: false; reason: string; tag?: undefined } {
  const tag = normalizeKeyword(raw);
  if (tag === null) {
    return { ok: false, reason: raw.trim() === '' ? 'Type a tag name.' : 'Tags are letters and numbers, up to 32 characters.' };
  }
  return { ok: true, tag };
}

/**
 * Merge `sources` into `target` (a rename is a merge of one). Every row that
 * holds a source loses it; rows that did not already hold the target gain it.
 * A target that is also a source is simply kept.
 */
export function planMerge(rows: readonly TagRow[], sources: readonly string[], rawTarget: string): TagPlanResult {
  const t = checkTagName(rawTarget);
  if (!t.ok) return { ok: false, reason: t.reason };
  const from = [...new Set(sources)].filter((s) => s !== t.tag);
  if (from.length === 0) return { ok: false, reason: 'That is the same tag. Nothing to change.' };
  const edits: Array<{ id: string; add: string[]; remove: string[] }> = [];
  for (const r of rows) {
    const ks = r.keywords ?? [];
    const remove = from.filter((s) => ks.includes(s));
    if (remove.length === 0) continue;
    edits.push({ id: r.id, add: ks.includes(t.tag) ? [] : [t.tag], remove });
  }
  return plan(edits);
}

/** Remove `tags` from every item that has any of them. */
export function planDelete(rows: readonly TagRow[], tags: readonly string[]): TagPlanResult {
  const kill = [...new Set(tags)];
  if (kill.length === 0) return { ok: false, reason: 'Pick a tag first.' };
  const edits = rows
    .map((r) => ({ id: r.id, add: [] as string[], remove: kill.filter((k) => (r.keywords ?? []).includes(k)) }))
    .filter((e) => e.remove.length > 0);
  return plan(edits);
}

/**
 * Put a (new or existing) tag on the selected items. Items that already have
 * it are skipped; items at the per-item maximum are reported in `full`
 * instead of sent, because the server would quietly cut the new tag off.
 */
export function planApply(rows: readonly TagRow[], selectedIds: readonly string[], rawTag: string): TagPlanResult {
  const t = checkTagName(rawTag);
  if (!t.ok) return { ok: false, reason: t.reason };
  const chosen = new Set(selectedIds);
  const edits: Array<{ id: string; add: string[]; remove: string[] }> = [];
  const full: string[] = [];
  for (const r of rows) {
    if (!chosen.has(r.id)) continue;
    const ks = r.keywords ?? [];
    if (ks.includes(t.tag)) continue;
    if (ks.length >= KEYWORDS_PER_ITEM_MAX) { full.push(r.id); continue; }
    edits.push({ id: r.id, add: [t.tag], remove: [] });
  }
  return plan(edits, full);
}

/**
 * The rows as they will look once `calls` land, mirroring the server's
 * editKeywords (remove, then append, then cap) — for the optimistic paint.
 */
export function applyTagCalls<R extends TagRow>(rows: readonly R[], calls: readonly TagCall[]): R[] {
  const byId = new Map<string, TagCall[]>();
  for (const c of calls) for (const id of c.ids) byId.set(id, [...(byId.get(id) ?? []), c]);
  return rows.map((r) => {
    const cs = byId.get(r.id);
    if (!cs) return r;
    let ks = [...(r.keywords ?? [])];
    for (const c of cs) {
      const remove = c.removeKeywords ?? [];
      ks = ks.filter((k) => !remove.includes(k));
      for (const a of c.addKeywords ?? []) if (!ks.includes(a) && !remove.includes(a)) ks.push(a);
      ks = ks.slice(0, KEYWORDS_PER_ITEM_MAX);
    }
    return { ...r, keywords: ks };
  });
}
