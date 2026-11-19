/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Replacing and optimizing EXISTING library models (/admin/library and
 * /admin/library/import) — the pure half: which item a new upload replaces,
 * what the confirm says will happen, how the toast reports what did, and the
 * bulk-optimize table's rows. No DOM, no supabase import — vitest runs it.
 *
 * The rule itself (in place with no event links, else a new version) lives
 * ONCE, in supabase/functions/admin-api/libraryImport.ts replacePathFor, which
 * the server runs too; the words here only describe it.
 */
import { replacePathFor, type ReplacePath } from '../../supabase/functions/admin-api/libraryImport.ts';
import { modelNameKey } from './platformModels';
import { formatSaving, formatTriangles, savingsPercent, worthKeeping, type OptimizeStats } from './glbOptimizePlan';

export type { ReplacePath };

type State = 'listed' | 'retired' | 'withdrawn' | null;

/** A library prop whose file can be replaced: a lone 3D model that is still published. */
export function canReplaceFile(i: { source?: string; kind: string; state: State; modelUrl?: string | null }): boolean {
  if (i.source !== undefined && i.source !== 'library') return false;
  if (i.modelUrl !== undefined && !i.modelUrl) return false;
  return i.kind === '3d_attachment' && (i.state === 'listed' || i.state === 'retired');
}

/**
 * The library item a new upload called `name` would replace, or null. Two
 * versions of one piece share a name, so the one hosts see wins (listed over
 * retired), then the newest version.
 */
export function replaceTargetFor<T extends { name: string; kind: string; state: State; version: number | null }>(
  name: string,
  items: readonly T[],
): T | null {
  const key = modelNameKey(name);
  if (key === '') return null;
  const hits = items.filter((i) => canReplaceFile(i) && modelNameKey(i.name) === key);
  hits.sort((a, b) => (a.state === b.state ? (b.version ?? 0) - (a.version ?? 0) : a.state === 'listed' ? -1 : 1));
  return hits[0] ?? null;
}

export interface ReplaceSubject {
  name: string;
  linkCount: number;
  state: State;
}

/** What replacing the file will do, in the words of the confirm dialog. */
export function replaceConsequence(t: ReplaceSubject, capped: boolean): { path: ReplacePath; lines: string[] } {
  const path = replacePathFor(t.linkCount);
  if (path === 'in_place') {
    return {
      path,
      lines: [
        `No event uses “${t.name}” yet, so its file is swapped in place.`,
        'It keeps its name, category, tags, who can use it and where it sits on a guest.',
        'Its picture is redrawn from the new file. The old file stays in storage for anyone who copied it into their own event.',
      ],
    };
  }
  const n = `${t.linkCount}${capped ? '+' : ''}`;
  return {
    path,
    lines: [
      `${n} event${t.linkCount === 1 && !capped ? ' uses' : 's use'} “${t.name}”, so they keep the file they have now.`,
      'The new file goes in as a new version with the same name, category, tags and who can use it.',
      t.state === 'listed'
        ? 'Hosts see the new version from now on, and the current one is hidden from hosts.'
        : 'Like the current one, the new version stays hidden from hosts until you show it.',
    ],
  };
}

export interface ReplaceOutcome {
  path: ReplacePath;
  version: number;
  retireFailed: readonly string[];
  accessCopyFailed: boolean;
  draftRemoved: boolean;
}

/** The toast for what the server actually did — including the parts that did not go through. */
export function replaceOutcomeText(name: string, r: ReplaceOutcome, saving?: string): { text: string; tone: 'success' | 'error' } {
  const head = r.path === 'in_place'
    ? `Replaced the file of “${name}”${saving ? ` (${saving})` : ''}. Same item, new file.`
    : `“${name}” now has version ${r.version}${saving ? ` (${saving})` : ''}. Events using the old version keep it.`;
  const problems: string[] = [];
  if (r.retireFailed.length > 0) problems.push('The old version could not be hidden from hosts, so hide it by hand.');
  if (r.accessCopyFailed) problems.push('Its customer list did not copy, so no host can use the new version until you set who can use it.');
  if (!r.draftRemoved) problems.push('The uploaded copy is still in Bulk import; discard it there.');
  return { text: [head, ...problems].join(' '), tone: problems.length > 0 ? 'error' : 'success' };
}

/** A file name for bytes that came from the optimizer: "Gold Crown" → "gold-crown.glb". */
export function glbFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || 'model'}.glb`;
}

/* ── Bulk optimize ─────────────────────────────────────────────────────── */

export type BulkOptStatus = 'waiting' | 'running' | 'done' | 'failed';

export interface BulkOptRow {
  id: string;
  name: string;
  modelUrl: string;
  linkCount: number;
  state: State;
  status: BulkOptStatus;
  stats: OptimizeStats | null;
  reason: string | null;
  /** Apply this one. Default on only when the saving is worth it. */
  checked: boolean;
  /** Set once its file was replaced in this session. */
  applied: ReplacePath | null;
  applyError: string | null;
}

/**
 * Most models one bulk optimize takes. The bytes are never held (each run
 * keeps only its numbers, and Apply optimizes again as it uploads), so the
 * cap is about time: a dense model can take a minute in the browser.
 */
export const BULK_OPTIMIZE_MAX = 20;

/** Rows for the selected items that can actually be replaced (others are left
 *  out), at most BULK_OPTIMIZE_MAX, in the order given. */
export function bulkOptRows(
  items: ReadonlyArray<{ id: string; name: string; kind: string; state: State; modelUrl: string | null; linkCount: number; source?: string }>,
): BulkOptRow[] {
  return items.filter((i) => canReplaceFile(i)).slice(0, BULK_OPTIMIZE_MAX).map((i) => ({
    id: i.id, name: i.name, modelUrl: i.modelUrl as string, linkCount: i.linkCount, state: i.state,
    status: 'waiting', stats: null, reason: null, checked: false, applied: null, applyError: null,
  }));
}

/** A row after its optimizer run. Only the numbers are kept — never the bytes. */
export function withRunResult(
  row: BulkOptRow,
  r: { ok: true; stats: OptimizeStats; reason?: undefined } | { ok: false; reason: string; stats?: undefined },
): BulkOptRow {
  if (!r.ok) return { ...row, status: 'failed', stats: null, reason: r.reason, checked: false };
  return { ...row, status: 'done', stats: r.stats, reason: null, checked: worthKeeping(r.stats) };
}

/** The four facts one summary row shows. */
export function bulkRowFacts(row: BulkOptRow): { size: string; triangles: string; saved: string; worth: boolean } | null {
  const s = row.stats;
  if (!s) return null;
  return {
    size: formatSaving(s.bytesBefore, s.bytesAfter),
    triangles: s.trianglesAfter === s.trianglesBefore
      ? formatTriangles(s.trianglesBefore)
      : `${formatTriangles(s.trianglesBefore)} → ${formatTriangles(s.trianglesAfter)}`,
    saved: `${savingsPercent(s.bytesBefore, s.bytesAfter)}%`,
    worth: worthKeeping(s),
  };
}

/** The rows Apply would replace, and how many take each path. */
export function bulkApplyPlan(rows: readonly BulkOptRow[]): { ids: string[]; inPlace: number; newVersion: number } {
  const go = rows.filter((r) => r.checked && r.status === 'done' && r.applied === null);
  return {
    ids: go.map((r) => r.id),
    inPlace: go.filter((r) => replacePathFor(r.linkCount) === 'in_place').length,
    newVersion: go.filter((r) => replacePathFor(r.linkCount) === 'new_version').length,
  };
}

/** The toast after Apply, from the rows' real outcomes. */
export function bulkApplySummary(rows: readonly BulkOptRow[], attempted: readonly string[]): { text: string; tone: 'success' | 'error' } {
  const tried = rows.filter((r) => attempted.includes(r.id));
  const ok = tried.filter((r) => r.applied !== null && r.applyError === null);
  const warned = tried.filter((r) => r.applied !== null && r.applyError !== null);
  const failed = tried.filter((r) => r.applied === null);
  const parts = [`Optimized ${ok.length + warned.length} of ${tried.length}`];
  if (warned.length > 0) parts.push(`${warned.length} need a follow-up (see each row)`);
  if (failed.length > 0) parts.push(`${failed.length} failed: ${failed.map((r) => `${r.name} — ${r.applyError ?? 'not replaced'}`).join('; ')}`);
  return { text: `${parts.join('. ')}.`, tone: failed.length > 0 || warned.length > 0 ? 'error' : 'success' };
}
