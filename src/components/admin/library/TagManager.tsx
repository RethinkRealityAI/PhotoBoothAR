/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Manage the library's free TAGS — the keywords on library items
 * (`experiences.library_keywords`). Not the fixed occasion / colour / style
 * vocabulary the host matcher reads; those are a closed list.
 *
 * A tag has no table of its own: it exists while at least one item carries
 * it. So every operation here is an edit of the ITEMS that carry it, planned
 * by src/lib/tagPlan.ts (pure, tested) and sent through
 * bulk_update_library_items in calls of at most 200 ids:
 *  - rename  = take the old tag off, put the new one on. Renaming onto a tag
 *              that already exists is a MERGE, and the editor says so first.
 *  - merge   = several tags into one.
 *  - delete  = take a tag off every item; the items stay.
 *  - create  = put a new tag on the items selected in the library.
 * Each change paints first; a failure puts the list back, and the parent
 * reloads (onChanged) either way so what you see is what the server holds.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, GitMerge, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/Toast';
import { bulkUpdateLibraryItems, libraryErrorText, type LibraryItemRow } from '../../../lib/adminLibrary';
import { KEYWORD_MAX_LEN, keywordLabel, normalizeKeyword } from '../../../lib/libraryTaxonomy';
import {
  applyTagCalls,
  checkTagName,
  filterTags,
  planApply,
  planDelete,
  planMerge,
  tagUsage,
  type TagPlanResult,
} from '../../../lib/tagPlan';

const FIELD =
  'w-full min-w-0 px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25';
const ICON_BTN =
  'pressable min-h-11 min-w-11 shrink-0 inline-flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.09] text-brand-muted/70 hover:text-brand-fg motion-safe:transition-colors disabled:opacity-30';
const TEXT_BTN =
  'pressable min-h-11 px-3 rounded-xl font-label uppercase tracking-luxe text-[10px] inline-flex items-center justify-center gap-1.5 disabled:opacity-40';
const PRIMARY = `${TEXT_BTN} bg-foil text-[color:var(--on-accent)] font-bold`;
const SOFT = `${TEXT_BTN} bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/85`;

const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
const quote = (tag: string) => `“${keywordLabel(tag)}”`;

type Panel =
  | { kind: 'rename'; tag: string; text: string; error: string | null }
  | { kind: 'delete'; tags: string[] }
  | { kind: 'merge'; text: string; error: string | null }
  | null;

export default function TagManager({
  rows,
  selectedIds,
  onChanged,
  onClose,
}: {
  /** Library items (the published rows; their `keywords` are the tags). */
  rows: LibraryItemRow[];
  /** Library item ids selected on the page, for "add a new tag to these". */
  selectedIds: string[];
  /** A change landed (or partly landed): the parent reloads the library. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const { push } = useToast();
  const [local, setLocal] = useState<LibraryItemRow[]>(rows);
  useEffect(() => { setLocal(rows); }, [rows]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [newTag, setNewTag] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');

  // Same reason as CategoryManager: a stable onClose keeps Modal's focus trap
  // from re-focusing its first control on every parent re-render.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  const stableClose = useCallback(() => closeRef.current(), []);

  const uses = useMemo(() => tagUsage(local), [local]);
  const countOf = useMemo(() => new Map(uses.map((u) => [u.tag, u.count])), [uses]);
  const shown = useMemo(() => filterTags(uses, query), [uses, query]);
  const rowIds = useMemo(() => new Set(local.map((r) => r.id)), [local]);
  const selection = useMemo(() => selectedIds.filter((id) => rowIds.has(id)), [selectedIds, rowIds]);

  // A picked tag that no longer exists (merged / deleted) drops out.
  useEffect(() => {
    setPicked((p) => {
      const next = new Set([...p].filter((t) => countOf.has(t)));
      return next.size === p.size ? p : next;
    });
  }, [countOf]);

  // Esc closes an open editor, not the whole dialog (window capture runs
  // before Modal's document-level handler).
  useEffect(() => {
    if (panel === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPanel(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel]);

  /** Send a plan; optimistic, with the list put back on any failure. */
  const run = async (plan: TagPlanResult, done: string): Promise<boolean> => {
    if (!plan.ok) { push(plan.reason, 'error'); return false; }
    if (plan.calls.length === 0) { push('No item carries that tag, so nothing changed.', 'info'); return true; }
    const snapshot = local;
    setLocal(applyTagCalls(local, plan.calls));
    setBusy(true);
    let failedItems = 0;
    let firstError: string | null = null;
    for (const c of plan.calls) {
      const edit = {
        ...(c.addKeywords ? { addKeywords: c.addKeywords } : {}),
        ...(c.removeKeywords ? { removeKeywords: c.removeKeywords } : {}),
      };
      const { data, error } = await bulkUpdateLibraryItems(c.ids, edit);
      if (error !== null || data === null) {
        failedItems += c.ids.length;
        firstError ??= error ?? 'internal';
        continue;
      }
      if (data.failed.length > 0) {
        failedItems += data.failed.length;
        firstError ??= data.failed[0].error;
      }
    }
    setBusy(false);
    if (failedItems > 0) {
      setLocal(snapshot);
      push(`${items(failedItems)} did not update. ${libraryErrorText(firstError ?? 'internal')}`, 'error');
      onChanged();
      return false;
    }
    push(done, 'success');
    setAnnounce(done);
    onChanged();
    return true;
  };

  const togglePick = (tag: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(tag)) n.delete(tag); else n.add(tag);
      return n;
    });

  /* ── Actions ─────────────────────────────────────────────────────────── */

  const submitRename = async () => {
    if (panel?.kind !== 'rename' || busy) return;
    const t = checkTagName(panel.text);
    if (!t.ok) { setPanel({ ...panel, error: t.reason }); return; }
    if (t.tag === panel.tag) { setPanel(null); return; }
    const from = panel.tag;
    const merging = countOf.has(t.tag);
    const plan = planMerge(local, [from], t.tag);
    setPanel(null);
    await run(plan, merging
      ? `Merged ${quote(from)} into ${quote(t.tag)} on ${items(plan.items ?? 0)}.`
      : `Renamed ${quote(from)} to ${quote(t.tag)} on ${items(plan.items ?? 0)}.`);
  };

  const submitMerge = async () => {
    if (panel?.kind !== 'merge' || busy) return;
    const t = checkTagName(panel.text);
    if (!t.ok) { setPanel({ ...panel, error: t.reason }); return; }
    const sources = [...picked];
    const plan = planMerge(local, sources, t.tag);
    if (!plan.ok) { setPanel({ ...panel, error: plan.reason }); return; }
    setPanel(null);
    const ok = await run(plan, `Merged ${sources.filter((s) => s !== t.tag).length} tags into ${quote(t.tag)} on ${items(plan.items)}.`);
    if (ok) setPicked(new Set());
  };

  const submitDelete = async () => {
    if (panel?.kind !== 'delete' || busy) return;
    const tags = panel.tags;
    const plan = planDelete(local, tags);
    setPanel(null);
    const ok = await run(plan, tags.length === 1
      ? `Removed ${quote(tags[0])} from ${items(plan.items ?? 0)}.`
      : `Removed ${tags.length} tags from ${items(plan.items ?? 0)}.`);
    if (ok) setPicked((p) => new Set([...p].filter((t) => !tags.includes(t))));
  };

  const submitNew = async () => {
    if (busy) return;
    const t = checkTagName(newTag);
    if (!t.ok) { setNewError(t.reason); return; }
    const plan = planApply(local, selection, t.tag);
    if (!plan.ok) { setNewError(plan.reason); return; }
    if (plan.calls.length === 0) {
      setNewError(plan.full.length > 0
        ? `The selected items already hold the most tags an item can have (${plan.full.length}).`
        : `The selected items already have ${quote(t.tag)}.`);
      return;
    }
    const skipped = plan.full.length > 0 ? ` ${items(plan.full.length)} skipped: already at the tag limit.` : '';
    const ok = await run(plan, `Added ${quote(t.tag)} to ${items(plan.items)}.${skipped}`);
    if (ok) { setNewTag(''); setNewError(null); }
  };

  const enter = (submit: () => void) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  };

  /* ── Rendering ───────────────────────────────────────────────────────── */

  const pickedList = [...picked];
  const pickedItems = useMemo(
    () => local.filter((r) => (r.keywords ?? []).some((k) => picked.has(k))).length,
    [local, picked],
  );

  const renameHint = (() => {
    if (panel?.kind !== 'rename') return null;
    if (panel.error !== null) return <span role="alert" className="text-rose-300">{panel.error}</span>;
    const k = normalizeKeyword(panel.text);
    if (k === null || k === panel.tag) return 'Enter to save, Esc to cancel';
    const existing = countOf.get(k);
    return existing !== undefined
      ? <span className="text-amber-200/90">{quote(k)} already exists on {items(existing)}. Saving merges the two into one tag.</span>
      : <>Saves as <span className="font-mono text-[10px]">{k}</span> · Enter to save, Esc to cancel</>;
  })();

  const mergeTarget = panel?.kind === 'merge' ? normalizeKeyword(panel.text) : null;

  return (
    <Modal title="Tags" onClose={stableClose} maxWidthClass="max-w-2xl" dismissOnScrim={!busy && panel === null && newTag === ''}>
      <p className="font-sans text-xs text-brand-muted/60 leading-relaxed mb-4">
        Tags are the free words on library items (the keywords on each item). Hosts can search by them, and they cut
        across categories, like colours or materials. A tag exists while at least one item has it, so renaming,
        merging or deleting one edits the items that carry it. The fixed occasion, colour and style tags are set on
        each item and are not listed here.
      </p>

      <p className="sr-only" aria-live="polite">{announce}</p>

      {/* New tag */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3 mb-4">
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 mb-2">New tag</p>
        {selection.length > 0 ? (
          <>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={newTag}
                maxLength={KEYWORD_MAX_LEN + 8}
                onChange={(e) => { setNewTag(e.target.value); setNewError(null); }}
                onKeyDown={enter(() => void submitNew())}
                placeholder="e.g. gold leaf"
                className={FIELD}
                aria-label="New tag name"
                aria-invalid={newError !== null}
              />
              <button type="button" onClick={() => void submitNew()} disabled={busy || newTag.trim() === ''} className={`${PRIMARY} shrink-0`}>
                <Plus className="w-3.5 h-3.5" aria-hidden /> Add to {items(selection.length)}
              </button>
            </div>
            <p className="mt-1.5 font-sans text-[11px] text-brand-muted/55 min-h-4" aria-live="polite">
              {newError !== null
                ? <span role="alert" className="text-rose-300">{newError}</span>
                : normalizeKeyword(newTag) !== null
                  ? <>Saves as <span className="font-mono text-[10px]">{normalizeKeyword(newTag)}</span>
                    {countOf.has(normalizeKeyword(newTag)!) ? ` — already on ${items(countOf.get(normalizeKeyword(newTag)!)!)}; this adds it to the selection too.` : ''}</>
                  : `Goes on the ${items(selection.length)} selected in the library.`}
            </p>
          </>
        ) : (
          <p className="font-sans text-xs text-brand-muted/70 leading-relaxed">
            A tag exists once it is on an item. Select one or more library items first (tick them on the library
            page), then open Tags again to add a new tag to all of them — or add tags on an item directly.
          </p>
        )}
      </div>

      {/* Search + bulk bar */}
      <div className="flex flex-col gap-2 mb-2">
        <label className="relative block">
          <span className="sr-only">Search tags</span>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/50" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${uses.length} tag${uses.length === 1 ? '' : 's'}`}
            className={`${FIELD} pl-9`}
            type="search"
          />
        </label>
        {picked.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.04] border border-white/10 p-2">
            <span className="font-sans text-xs text-brand-fg/85 px-1 mr-auto">
              {picked.size} tag{picked.size === 1 ? '' : 's'} · {items(pickedItems)}
            </span>
            <button
              type="button"
              onClick={() => setPanel({ kind: 'merge', text: pickedList.length > 0 ? keywordLabel(pickedList[0]) : '', error: null })}
              disabled={busy || picked.size < 2}
              title={picked.size < 2 ? 'Pick two or more tags to merge' : undefined}
              className={SOFT}
            >
              <GitMerge className="w-3.5 h-3.5" aria-hidden /> Merge into…
            </button>
            <button type="button" onClick={() => setPanel({ kind: 'delete', tags: pickedList })} disabled={busy} className={`${TEXT_BTN} bg-rose-500/15 hover:bg-rose-500/25 text-rose-200`}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden /> Delete
            </button>
            <button type="button" onClick={() => setPicked(new Set())} className={ICON_BTN} aria-label="Clear the picked tags"><X className="w-4 h-4" /></button>
          </div>
        )}

        {panel?.kind === 'merge' && (
          <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3" role="group" aria-label="Merge tags">
            <p className="font-sans text-xs text-brand-fg/85 leading-relaxed mb-2">
              Merge {pickedList.map(quote).join(', ')} into one tag. Pick one of them, or type a new name.
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {pickedList.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={mergeTarget === t}
                  onClick={() => setPanel({ ...panel, text: keywordLabel(t), error: null })}
                  className={`pressable min-h-11 px-3 rounded-full text-xs ${mergeTarget === t ? 'bg-white/[0.14] text-brand-fg ring-1 ring-white/25' : 'bg-white/[0.05] text-brand-fg/75 hover:bg-white/[0.09]'}`}
                >
                  {keywordLabel(t)}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={panel.text}
                onChange={(e) => setPanel({ ...panel, text: e.target.value, error: null })}
                onKeyDown={enter(() => void submitMerge())}
                className={FIELD}
                aria-label="Merge into"
                aria-invalid={panel.error !== null}
                autoFocus
              />
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setPanel(null)} className={SOFT}>Cancel</button>
                <button type="button" onClick={() => void submitMerge()} disabled={busy} className={PRIMARY}>
                  <GitMerge className="w-3.5 h-3.5" aria-hidden /> Merge
                </button>
              </div>
            </div>
            <p className="mt-1.5 font-sans text-[11px] text-brand-muted/55 min-h-4">
              {panel.error !== null
                ? <span role="alert" className="text-rose-300">{panel.error}</span>
                : mergeTarget !== null
                  ? `${items(pickedItems)} end up with ${quote(mergeTarget)}; the others are removed from them.`
                  : 'Type a tag name.'}
            </p>
          </div>
        )}

        {panel?.kind === 'delete' && (
          <div className="rounded-2xl bg-rose-500/[0.06] border border-rose-400/20 p-3" role="alertdialog" aria-label="Delete tags">
            <p className="font-sans text-xs text-brand-fg/85 leading-relaxed">
              {panel.tags.length === 1
                ? `Remove ${quote(panel.tags[0])} from ${items(countOf.get(panel.tags[0]) ?? 0)}?`
                : `Remove ${panel.tags.length} tags (${panel.tags.map(quote).join(', ')}) from ${items(local.filter((r) => (r.keywords ?? []).some((k) => panel.tags.includes(k))).length)}?`}{' '}
              The items stay; only the tag goes. This cannot be undone from here.
            </p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setPanel(null)} className={SOFT}>Keep</button>
              <button type="button" onClick={() => void submitDelete()} disabled={busy} className={`${TEXT_BTN} bg-rose-500/20 hover:bg-rose-500/30 text-rose-200`} autoFocus>
                <Trash2 className="w-3.5 h-3.5" aria-hidden /> Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The list */}
      <ul className="flex flex-col divide-y divide-white/[0.06]" aria-label="Tags">
        {shown.map((u) => {
          const on = picked.has(u.tag);
          const renamingThis = panel?.kind === 'rename' && panel.tag === u.tag;
          return (
            <li key={u.tag} className="py-1">
              <div className="flex items-center gap-1 sm:gap-2 min-h-12">
                <label className="min-h-11 min-w-11 shrink-0 inline-flex items-center justify-center rounded-xl hover:bg-white/[0.05] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => togglePick(u.tag)}
                    className="w-4 h-4 accent-[color:var(--color-accent)]"
                    aria-label={`Pick ${keywordLabel(u.tag)}`}
                  />
                </label>
                {renamingThis ? (
                  <div className="min-w-0 flex-1 flex items-center gap-1">
                    <input
                      value={panel.text}
                      onChange={(e) => setPanel({ ...panel, text: e.target.value, error: null })}
                      onKeyDown={enter(() => void submitRename())}
                      className={FIELD}
                      aria-label={`New name for ${keywordLabel(u.tag)}`}
                      aria-invalid={panel.error !== null}
                      autoFocus
                    />
                    <button type="button" onClick={() => void submitRename()} disabled={busy} className={ICON_BTN} aria-label="Save tag name"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setPanel(null)} className={ICON_BTN} aria-label="Cancel rename"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1 py-1" onDoubleClick={() => !busy && setPanel({ kind: 'rename', tag: u.tag, text: keywordLabel(u.tag), error: null })}>
                      <p className="font-sans text-sm text-brand-fg truncate select-none">{keywordLabel(u.tag)}</p>
                      <p className="font-sans text-[11px] text-brand-muted/55 tabular-nums">{items(u.count)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPanel({ kind: 'rename', tag: u.tag, text: keywordLabel(u.tag), error: null })}
                      disabled={busy}
                      className={ICON_BTN}
                      aria-label={`Rename ${keywordLabel(u.tag)}`}
                      title="Rename (or merge into another tag)"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanel({ kind: 'delete', tags: [u.tag] })}
                      disabled={busy}
                      className={ICON_BTN}
                      aria-label={`Delete ${keywordLabel(u.tag)}`}
                      title="Delete from every item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
              {renamingThis && <p className="pl-12 sm:pl-14 pb-1 font-sans text-[11px] text-brand-muted/55" aria-live="polite">{renameHint}</p>}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="py-6 text-center font-sans text-sm text-brand-muted/60">
          {uses.length === 0 ? 'No item has a tag yet.' : 'No tag matches that search.'}
        </p>
      )}

      {busy && (
        <p className="mt-3 inline-flex items-center gap-1.5 font-sans text-[11px] text-brand-muted/60" role="status">
          <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden /> Saving…
        </p>
      )}
    </Modal>
  );
}
