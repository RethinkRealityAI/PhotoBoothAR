/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The library's category TREE editor. Two levels only (the database enforces
 * it too): top-level categories and the subcategories inside them.
 *
 *  - Drag a row by its grip to reorder, move a subcategory under another
 *    parent, promote it to top level, or drop a childless top-level category
 *    onto another to make it a subcategory. Pointer events, so mouse and touch
 *    work the same; a drop that would make three levels is refused and the
 *    reason is shown while you hover, not after.
 *  - Tap (or press Enter on) the same grip for the "Move to…" menu: the
 *    keyboard / screen-reader path to every move a drag can make.
 *  - "+" on a top-level row adds a subcategory inline; "+ New category" adds a
 *    top-level one. Double-click a name (or the pencil) to rename. Enter saves,
 *    Esc cancels — Esc is caught at the WINDOW in the capture phase, before the
 *    Modal's document-level handler, so it cancels the edit instead of closing
 *    the whole dialog.
 *  - Deleting moves the category's items up to its parent, or to "No
 *    category" — never deletes an item. A category with children is refused
 *    until they are moved.
 *
 * Every change paints first and saves after; a failure puts back what the
 * server did not accept (see categoryTree.applySaved) and says so in a toast.
 * The rules live in src/lib/categoryTree.ts (pure, tested).
 */
import {
  useCallback, useEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, GripVertical, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/Toast';
import { deleteLibraryCategory, libraryErrorText, saveLibraryCategory } from '../../../lib/adminLibrary';
import {
  CATEGORY_NAME_MAX,
  buildCategoryTree,
  slugifyCategory,
  type LibraryCategory,
} from '../../../lib/libraryTaxonomy';
import {
  applySaved,
  canPlace,
  checkNewName,
  checkRename,
  moveOptions,
  nextSortOrder,
  placementFor,
  planMove,
  topLevelEnd,
  type DropZone,
  type Placement,
} from '../../../lib/categoryTree';

const FIELD =
  'w-full min-w-0 px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25';
const ICON_BTN =
  'pressable min-h-11 min-w-11 shrink-0 inline-flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.09] text-brand-muted/70 hover:text-brand-fg motion-safe:transition-colors disabled:opacity-30';
const TEXT_BTN =
  'pressable min-h-11 px-3 rounded-xl font-label uppercase tracking-luxe text-[10px] inline-flex items-center justify-center gap-1.5 disabled:opacity-40';

/** Movement (px) before a press on the grip becomes a drag rather than a tap. */
const DRAG_SLOP = 6;
/** Distance (px) from the dialog's edge that scrolls it during a drag. */
const EDGE = 56;

const PENDING = 'pending-';

type Over = { id: string; zone: DropZone } | 'end' | null;

interface DragState {
  id: string;
  x: number;
  y: number;
  over: Over;
  place: Placement | null;
  refusal: string | null;
}

interface Editor {
  text: string;
  error: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function CategoryManager({
  categories,
  counts,
  onChange,
  onClose,
}: {
  categories: LibraryCategory[];
  /** Items per category id, this category's own items only. */
  counts: Record<string, number>;
  onChange: (next: LibraryCategory[]) => void;
  onClose: () => void;
}) {
  const { push } = useToast();
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<(Editor & { parentId: string | null }) | null>(null);
  const [renaming, setRenaming] = useState<(Editor & { id: string }) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announce, setAnnounce] = useState('');

  // The parent passes a fresh onClose arrow every render, and Modal's focus
  // trap re-runs (and re-focuses its first control) whenever that identity
  // changes — which every optimistic onChange causes. A stable wrapper keeps
  // focus in the inline editor the operator is typing in.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  const stableClose = useCallback(() => closeRef.current(), []);

  const press = useRef<{ id: string; x: number; y: number; pointerId: number; started: boolean } | null>(null);
  // A mouse drag ends with a click on the grip; a TOUCH drag does not (the
  // browser drops it once the finger moved). So the click after a drag is
  // ignored only inside a short window — a sticky flag would swallow the next
  // real tap or Enter instead.
  const suppressClickUntil = useRef(0);
  const suppressClick = () => { suppressClickUntil.current = performance.now() + 400; };
  const dragRef = useRef<DragState | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRaf = useRef<number | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const tree = buildCategoryTree(categories);
  const nameOf = (id: string | null) => (id === null ? null : categories.find((c) => c.id === id)?.name ?? null);
  const kidsOf = (id: string) => categories.filter((c) => c.parentId === id).length;

  const rememberFocus = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const restoreFocus = () => {
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el && el.isConnected) requestAnimationFrame(() => el.focus());
  };

  /* ── Persistence ────────────────────────────────────────────────────── */

  const doMove = async (id: string, place: Placement): Promise<void> => {
    if (saving) return;
    const name = nameOf(id) ?? 'It';
    const plan = planMove(categories, id, place);
    if (!plan.ok) { push(plan.reason, 'error'); setAnnounce(plan.reason); return; }
    if (plan.saves.length === 0) return;
    const snapshot = categories;
    onChange(plan.next);
    const where = place.parentId === null ? 'the top level' : `“${nameOf(place.parentId)}”`;
    setAnnounce(`Moved “${name}” to ${where}.`);
    setSaving(true);
    const saved: LibraryCategory[] = [];
    for (const s of plan.saves) {
      const { data, error } = await saveLibraryCategory(s);
      if (error !== null || data === null) {
        setSaving(false);
        onChange(applySaved(snapshot, saved));
        push(
          saved.length === 0
            ? `${libraryErrorText(error ?? 'internal')} “${name}” was put back.`
            : `${libraryErrorText(error ?? 'internal')} Part of the new order was saved; the rest was put back.`,
          'error',
        );
        return;
      }
      saved.push(data.category);
    }
    setSaving(false);
    onChange(applySaved(plan.next, saved));
  };

  const startAdd = (parentId: string | null) => {
    if (adding?.parentId !== parentId) rememberFocus();
    setAdding({ parentId, text: '', error: null });
    setRenaming(null);
    setConfirmDelete(null);
    setMenuFor(null);
  };
  const cancelAdd = () => { setAdding(null); restoreFocus(); };

  const submitAdd = async () => {
    if (adding === null || saving) return;
    const check = checkNewName(categories, adding.text);
    if (!check.ok) { setAdding({ ...adding, error: check.reason }); return; }
    const parentId = adding.parentId;
    const sortOrder = nextSortOrder(categories, parentId);
    const temp: LibraryCategory = {
      id: `${PENDING}${Date.now()}`, slug: check.slug, name: check.name, description: '', parentId, sortOrder,
    };
    const snapshot = categories;
    onChange([...snapshot, temp]);
    // Stays open, emptied, for the next one: adding several subcategories in
    // a row is the common case. Esc (or the X) finishes.
    setAdding({ parentId, text: '', error: null });
    setSaving(true);
    const { data, error } = await saveLibraryCategory({ name: check.name, parentId, sortOrder });
    setSaving(false);
    if (error !== null || data === null) {
      onChange(snapshot);
      const msg = libraryErrorText(error ?? 'internal');
      push(`“${check.name}” was not added. ${msg}`, 'error');
      setAdding((a) => (a !== null && a.parentId === parentId && a.text === '' ? { parentId, text: check.name, error: msg } : a));
      return;
    }
    onChange([...snapshot, data.category]);
    setAnnounce(`Added “${data.category.name}”${parentId === null ? '' : ` inside “${nameOf(parentId)}”`}.`);
  };

  const startRename = (c: LibraryCategory) => {
    if (saving || c.id.startsWith(PENDING)) return;
    rememberFocus();
    setRenaming({ id: c.id, text: c.name, error: null });
    setAdding(null);
    setConfirmDelete(null);
    setMenuFor(null);
  };
  const cancelRename = () => { setRenaming(null); restoreFocus(); };

  const submitRename = async () => {
    if (renaming === null || saving) return;
    const c = categories.find((x) => x.id === renaming.id);
    if (!c) { setRenaming(null); return; }
    const check = checkRename(renaming.text);
    if (!check.ok) { setRenaming({ ...renaming, error: check.reason }); return; }
    setRenaming(null);
    restoreFocus();
    if (check.name === c.name) return;
    const snapshot = categories;
    onChange(snapshot.map((x) => (x.id === c.id ? { ...x, name: check.name } : x)));
    setSaving(true);
    const { data, error } = await saveLibraryCategory({ id: c.id, name: check.name });
    setSaving(false);
    if (error !== null || data === null) {
      onChange(snapshot);
      push(`Still called “${c.name}”. ${libraryErrorText(error ?? 'internal')}`, 'error');
      return;
    }
    onChange(snapshot.map((x) => (x.id === c.id ? data.category : x)));
    setAnnounce(`Renamed to “${data.category.name}”.`);
  };

  const remove = async (c: LibraryCategory) => {
    if (saving) return;
    const snapshot = categories;
    const parentName = nameOf(c.parentId);
    onChange(snapshot.filter((x) => x.id !== c.id));
    setConfirmDelete(null);
    setSaving(true);
    const { data, error } = await deleteLibraryCategory(c.id);
    setSaving(false);
    if (error !== null || data === null) {
      onChange(snapshot);
      push(`“${c.name}” was not deleted. ${libraryErrorText(error ?? 'internal')}`, 'error');
      return;
    }
    push(
      data.moved > 0
        ? `Deleted “${c.name}”. ${plural(data.moved, 'item')} moved to ${data.movedTo !== null ? (parentName !== null ? `“${parentName}”` : 'its parent') : 'No category'}.`
        : `Deleted “${c.name}”.`,
      'success',
    );
  };

  /* ── Drag ───────────────────────────────────────────────────────────── */

  const hoverAt = (x: number, y: number, dragId: string): Pick<DragState, 'over' | 'place' | 'refusal'> => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
    if (!el) return { over: null, place: null, refusal: null };
    if (el.dataset.drop === 'end') return { over: 'end', place: topLevelEnd(categories, dragId), refusal: null };
    const id = el.dataset.id ?? '';
    const r = el.getBoundingClientRect();
    const f = r.height > 0 ? (y - r.top) / r.height : 0.5;
    let zone: DropZone;
    if (el.dataset.top === '1') zone = f < 0.3 ? 'before' : el.dataset.kids !== '1' && f > 0.75 ? 'after' : 'into';
    else zone = f < 0.5 ? 'before' : 'after';
    const place = placementFor(categories, dragId, id, zone);
    if (place === null) return { over: null, place: null, refusal: null };
    const check = canPlace(categories, dragId, place.parentId);
    return { over: { id, zone }, place, refusal: check.ok ? null : check.reason };
  };

  const setDragState = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const stopScroll = () => {
    if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = null;
  };

  // While dragging near the dialog's top or bottom edge, scroll it — a long
  // tree does not fit a phone screen and the finger cannot scroll mid-drag.
  const edgeScroll = () => {
    const d = dragRef.current;
    const panel = panelRef.current;
    if (!d || !panel) { scrollRaf.current = null; return; }
    const r = panel.getBoundingClientRect();
    const dy = d.y < r.top + EDGE ? -10 : d.y > r.bottom - EDGE ? 10 : 0;
    if (dy !== 0) {
      const before = panel.scrollTop;
      panel.scrollTop += dy;
      if (panel.scrollTop !== before) setDragState({ ...d, ...hoverAt(d.x, d.y, d.id) });
    }
    scrollRaf.current = requestAnimationFrame(edgeScroll);
  };

  const cancelDrag = () => {
    press.current = null;
    stopScroll();
    setDragState(null);
  };

  const onGripDown = (e: ReactPointerEvent<HTMLButtonElement>, c: LibraryCategory) => {
    if (saving || e.button !== 0 || c.id.startsWith(PENDING)) return;
    panelRef.current = e.currentTarget.closest<HTMLElement>('[role="dialog"]');
    press.current = { id: c.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, started: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const onGripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.started) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_SLOP) return;
      p.started = true;
      setMenuFor(null);
      setConfirmDelete(null);
      if (scrollRaf.current === null) scrollRaf.current = requestAnimationFrame(edgeScroll);
    }
    e.preventDefault();
    setDragState({ id: p.id, x: e.clientX, y: e.clientY, ...hoverAt(e.clientX, e.clientY, p.id) });
  };

  const onGripUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const d = dragRef.current;
    const started = p.started;
    cancelDrag();
    if (!started) return; // a tap: the click handler opens the menu
    suppressClick();
    if (!d || d.place === null) return;
    if (d.refusal !== null) { push(d.refusal, 'error'); setAnnounce(d.refusal); return; }
    void doMove(d.id, d.place);
  };

  const onGripClick = (c: LibraryCategory) => {
    if (performance.now() < suppressClickUntil.current) return;
    if (c.id.startsWith(PENDING)) return;
    setMenuFor((m) => (m === c.id ? null : c.id));
    setConfirmDelete(null);
  };

  useEffect(() => () => stopScroll(), []);

  // Focus the first offered move when the menu opens.
  useEffect(() => {
    if (menuFor === null) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [menuFor]);

  // Esc cancels the innermost thing in progress, never the whole dialog.
  useEffect(() => {
    const active = drag !== null || renaming !== null || adding !== null || menuFor !== null || confirmDelete !== null;
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (dragRef.current !== null) { cancelDrag(); suppressClick(); return; }
      if (renaming !== null) { cancelRename(); return; }
      if (adding !== null) { cancelAdd(); return; }
      if (menuFor !== null) {
        const id = menuFor;
        setMenuFor(null);
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`)?.focus());
        return;
      }
      setConfirmDelete(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  /* ── Rendering ──────────────────────────────────────────────────────── */

  const editorKeys = (submit: () => void) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  };

  const menuKeys = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  const dropLine = (edge: 'before' | 'after', refused: boolean) => (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full ${edge === 'before' ? '-top-px' : '-bottom-px'} ${
        refused ? 'bg-rose-400/70' : 'bg-[color:var(--color-accent)]'
      }`}
    />
  );

  const row = (c: LibraryCategory, isChild: boolean) => {
    const n = counts[c.id] ?? 0;
    const kids = isChild ? 0 : kidsOf(c.id);
    const pending = c.id.startsWith(PENDING);
    const dragging = drag?.id === c.id;
    const over = drag !== null && drag.over !== 'end' && drag.over !== null && drag.over.id === c.id ? drag.over : null;
    const refused = over !== null && drag?.refusal !== null;
    const locked = saving || pending;
    const editingThis = renaming?.id === c.id;

    return (
      <div key={c.id}>
        <div
          data-drop="row"
          data-id={c.id}
          data-top={isChild ? '0' : '1'}
          data-kids={kids > 0 ? '1' : '0'}
          className={`relative flex items-center gap-1 sm:gap-2 min-h-12 rounded-xl ${isChild ? 'pl-5 sm:pl-8' : ''} ${
            dragging ? 'opacity-40' : ''
          } ${
            over?.zone === 'into'
              ? refused
                ? 'bg-rose-500/[0.08] ring-1 ring-rose-400/50'
                : 'bg-white/[0.07] ring-1 ring-[color:var(--color-accent)]'
              : ''
          }`}
        >
          {over !== null && over.zone !== 'into' && dropLine(over.zone, refused)}

          <button
            type="button"
            data-grip={c.id}
            onPointerDown={(e) => onGripDown(e, c)}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={cancelDrag}
            onClick={() => onGripClick(c)}
            disabled={pending}
            aria-haspopup="menu"
            aria-expanded={menuFor === c.id}
            aria-label={`Move ${c.name}. Drag, or press to choose where`}
            title="Drag to move, or tap for options"
            className={`${ICON_BTN} touch-none select-none cursor-grab active:cursor-grabbing bg-transparent`}
          >
            <GripVertical className="w-4 h-4" aria-hidden />
          </button>

          {editingThis ? (
            <div className="min-w-0 flex-1 flex items-center gap-1">
              <input
                value={renaming.text}
                maxLength={CATEGORY_NAME_MAX}
                onChange={(e) => setRenaming({ ...renaming, text: e.target.value, error: null })}
                onKeyDown={editorKeys(() => void submitRename())}
                className={FIELD}
                aria-label={`New name for ${c.name}`}
                aria-invalid={renaming.error !== null}
                autoFocus
              />
              <button type="button" onClick={() => void submitRename()} className={ICON_BTN} aria-label="Save name"><Check className="w-4 h-4" /></button>
              <button type="button" onClick={cancelRename} className={ICON_BTN} aria-label="Cancel rename"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="min-w-0 flex-1 py-1" onDoubleClick={() => startRename(c)}>
              <p className={`font-sans text-sm truncate select-none ${isChild ? 'text-brand-fg/85' : 'text-brand-fg font-medium'}`}>
                {c.name}
              </p>
              <p className="font-sans text-[11px] text-brand-muted/55 truncate">
                {pending ? 'Saving…' : (
                  <>
                    <span className="tabular-nums">{plural(n, 'item')}</span>
                    {!isChild && kids > 0 && <> · {plural(kids, 'subcategory', 'subcategories')}</>}
                    <span className="font-mono text-[10px] text-brand-muted/35"> · {c.slug}</span>
                  </>
                )}
              </p>
            </div>
          )}

          {!editingThis && (
            <div className="flex items-center gap-1 shrink-0">
              {!isChild && (
                <button type="button" onClick={() => startAdd(c.id)} disabled={locked} className={ICON_BTN} aria-label={`Add a subcategory inside ${c.name}`} title="Add a subcategory">
                  <Plus className="w-4 h-4" />
                </button>
              )}
              <button type="button" onClick={() => startRename(c)} disabled={locked} className={ICON_BTN} aria-label={`Rename ${c.name}`} title="Rename">
                <Pencil className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDelete((d) => (d === c.id ? null : c.id)); setMenuFor(null); }}
                disabled={locked}
                className={ICON_BTN}
                aria-label={`Delete ${c.name}`}
                aria-expanded={confirmDelete === c.id}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {editingThis && renaming.error !== null && (
          <p role="alert" className={`mt-1 mb-2 font-sans text-xs text-rose-300 ${isChild ? 'pl-16 sm:pl-20' : 'pl-12'}`}>{renaming.error}</p>
        )}

        {menuFor === c.id && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Move ${c.name}`}
            onKeyDown={menuKeys}
            className={`mt-1 mb-2 rounded-2xl bg-black/30 border border-white/10 p-1 flex flex-col ${isChild ? 'ml-5 sm:ml-8' : ''}`}
          >
            <p className="px-3 pt-2 pb-1 font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Move “{c.name}”</p>
            {moveOptions(categories, c.id).map((o) => (
              <button
                key={o.key}
                type="button"
                role="menuitem"
                disabled={o.disabledReason !== undefined || saving}
                onClick={() => { setMenuFor(null); void doMove(c.id, o.place); }}
                className="pressable min-h-11 px-3 py-2 rounded-xl text-left font-sans text-sm text-brand-fg/85 hover:bg-white/[0.07] disabled:opacity-100 disabled:text-brand-muted/45 disabled:hover:bg-transparent"
              >
                {o.label}
                {o.disabledReason !== undefined && <span className="block text-[11px] text-brand-muted/55 leading-snug">{o.disabledReason}</span>}
              </button>
            ))}
            <button type="button" onClick={() => setMenuFor(null)} className="pressable min-h-11 px-3 rounded-xl text-left font-sans text-sm text-brand-muted/70 hover:bg-white/[0.07]">
              Cancel
            </button>
          </div>
        )}

        {confirmDelete === c.id && (
          <div className={`mt-1 mb-2 rounded-2xl bg-rose-500/[0.06] border border-rose-400/20 p-3 ${isChild ? 'ml-5 sm:ml-8' : ''}`} role="alertdialog" aria-label={`Delete ${c.name}`}>
            {kids > 0 ? (
              <>
                <p className="font-sans text-xs text-brand-fg/85 leading-relaxed">
                  “{c.name}” has {plural(kids, 'subcategory', 'subcategories')}, so it cannot be deleted yet. Drag
                  {kids === 1 ? ' it' : ' them'} out (or use Move on each), or delete {kids === 1 ? 'it' : 'them'} first.
                </p>
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => setConfirmDelete(null)} className={`${TEXT_BTN} bg-white/[0.06] text-brand-fg/80`} autoFocus>OK</button>
                </div>
              </>
            ) : (
              <>
                <p className="font-sans text-xs text-brand-fg/85 leading-relaxed">
                  Delete “{c.name}”?{' '}
                  {n > 0
                    ? `Its ${plural(n, 'item')} move to ${c.parentId !== null ? `“${nameOf(c.parentId) ?? 'its parent'}”` : 'No category'}.`
                    : 'Nothing is filed in it.'}{' '}
                  Items are never deleted.
                </p>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setConfirmDelete(null)} className={`${TEXT_BTN} bg-white/[0.06] text-brand-fg/80`}>Keep it</button>
                  <button type="button" onClick={() => void remove(c)} disabled={saving} className={`${TEXT_BTN} bg-rose-500/20 hover:bg-rose-500/30 text-rose-200`} autoFocus>
                    <Trash2 className="w-3.5 h-3.5" aria-hidden /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const addRow = (parentId: string | null) => {
    if (adding === null || adding.parentId !== parentId) return null;
    const slug = slugifyCategory(adding.text);
    const where = parentId === null ? 'New top-level category' : `New subcategory in ${nameOf(parentId) ?? 'this category'}`;
    return (
      <div className={`py-1 ${parentId === null ? '' : 'pl-5 sm:pl-8'}`}>
        <div className="flex items-center gap-1">
          <span className="min-w-11 shrink-0 inline-flex justify-center text-brand-muted/50" aria-hidden><Plus className="w-4 h-4" /></span>
          <input
            value={adding.text}
            maxLength={CATEGORY_NAME_MAX}
            onChange={(e) => setAdding({ ...adding, text: e.target.value, error: null })}
            onKeyDown={editorKeys(() => void submitAdd())}
            placeholder={parentId === null ? 'e.g. Diwali' : 'e.g. Ugly sweaters'}
            className={FIELD}
            aria-label={where}
            aria-invalid={adding.error !== null}
            autoFocus
          />
          <button type="button" onClick={() => void submitAdd()} disabled={saving || adding.text.trim() === ''} className={ICON_BTN} aria-label="Add it">
            {saving ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : <Check className="w-4 h-4" />}
          </button>
          <button type="button" onClick={cancelAdd} className={ICON_BTN} aria-label="Stop adding"><X className="w-4 h-4" /></button>
        </div>
        <p className="pl-12 mt-1 font-sans text-[11px] text-brand-muted/50 min-h-4" aria-live="polite">
          {adding.error !== null
            ? <span role="alert" className="text-rose-300">{adding.error}</span>
            : slug !== ''
              ? <>Web name <span className="font-mono text-[10px]">{slug}</span> · Enter to add, Esc to finish</>
              : 'Enter to add, Esc to finish'}
        </p>
      </div>
    );
  };

  const ghostLabel = (() => {
    if (drag === null) return null;
    if (drag.refusal !== null) return drag.refusal;
    if (drag.place === null) return 'Drag onto a row';
    return drag.place.parentId === null ? 'Top level' : `Inside “${nameOf(drag.place.parentId)}”`;
  })();

  return (
    <Modal
      title="Categories"
      onClose={stableClose}
      maxWidthClass="max-w-2xl"
      dismissOnScrim={!saving && adding === null && renaming === null && drag === null}
    >
      <p className="font-sans text-xs text-brand-muted/60 leading-relaxed mb-4">
        Two levels: a category, and subcategories inside it. Drag the grip to reorder or move one; tap it for the
        same moves as a list. Each item sits in one place — use tags for anything that cuts across shelves, like
        colours or materials. The small grey name is the permanent web name the API uses; it never changes, even
        if you rename the category.
      </p>

      <p className="sr-only" aria-live="polite">{announce}</p>

      <div className={`flex flex-col gap-1 ${drag !== null ? 'select-none' : ''}`}>
        {tree.map((node) => (
          <div key={node.category.id} className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-1">
            {row(node.category, false)}
            {node.children.map((c) => row(c, true))}
            {addRow(node.category.id)}
          </div>
        ))}
        {tree.length === 0 && adding === null && (
          <p className="py-6 text-center font-sans text-sm text-brand-muted/60">No categories yet. Add the first one below.</p>
        )}

        {drag !== null && (
          <div
            data-drop="end"
            className={`mt-1 min-h-12 rounded-2xl border border-dashed flex items-center justify-center px-3 text-center font-sans text-xs ${
              drag.over === 'end' ? 'border-[color:var(--color-accent)] bg-white/[0.06] text-brand-fg' : 'border-white/15 text-brand-muted/60'
            }`}
          >
            Drop here to make it a top-level category
          </div>
        )}

        {addRow(null)}
        {(adding === null || adding.parentId !== null) && drag === null && (
          <button
            type="button"
            onClick={() => startAdd(null)}
            disabled={saving}
            className="pressable mt-1 min-h-12 rounded-2xl border border-dashed border-white/15 hover:border-white/30 hover:bg-white/[0.03] inline-flex items-center justify-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/80 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> New category
          </button>
        )}
      </div>

      {saving && (
        <p className="mt-3 inline-flex items-center gap-1.5 font-sans text-[11px] text-brand-muted/60" role="status">
          <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden /> Saving…
        </p>
      )}

      {drag !== null && ghostLabel !== null && createPortal(
        <div
          aria-hidden
          className="pointer-events-none fixed z-[60] max-w-[260px] rounded-xl glass-strong border border-white/15 px-3 py-2 shadow-lg"
          style={{ left: Math.max(8, Math.min(drag.x - 24, window.innerWidth - 268)), top: Math.max(8, drag.y - 64) }}
        >
          <p className="font-sans text-sm text-brand-fg truncate">{nameOf(drag.id)}</p>
          <p className={`font-sans text-[11px] leading-snug ${drag.refusal !== null ? 'text-rose-300' : 'text-brand-muted/70'}`}>{ghostLabel}</p>
        </div>,
        document.body,
      )}
    </Modal>
  );
}
