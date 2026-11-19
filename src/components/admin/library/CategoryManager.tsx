/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Add, rename, re-parent, reorder and delete library categories. Two levels
 * only (the database enforces it too). Deleting moves the category's items up
 * to its parent, or to "No category" — never deletes an item.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import Modal from '../../ui/Modal';
import { useToast } from '../../ui/Toast';
import { deleteLibraryCategory, libraryErrorText, saveLibraryCategory } from '../../../lib/adminLibrary';
import {
  CATEGORY_NAME_MAX,
  buildCategoryTree,
  normalizeCategoryName,
  slugifyCategory,
  type LibraryCategory,
} from '../../../lib/libraryTaxonomy';

const FIELD =
  'w-full px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25';
const ICON_BTN =
  'pressable min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.09] text-brand-muted/70 hover:text-brand-fg transition-colors disabled:opacity-30';

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
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<string>('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editParent, setEditParent] = useState<string>('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const tree = buildCategoryTree(categories);
  const tops = tree.map((n) => n.category);

  const replace = (c: LibraryCategory) =>
    onChange(categories.some((x) => x.id === c.id) ? categories.map((x) => (x.id === c.id ? c : x)) : [...categories, c]);

  const add = async () => {
    const name = normalizeCategoryName(newName);
    if (name === null) { push(`Give it a name (up to ${CATEGORY_NAME_MAX} characters).`, 'error'); return; }
    const parentId = newParent === '' ? null : newParent;
    const siblings = categories.filter((c) => c.parentId === parentId);
    setBusy(true);
    const { data, error } = await saveLibraryCategory({
      name, parentId, sortOrder: (Math.max(0, ...siblings.map((s) => s.sortOrder)) + 10),
    });
    setBusy(false);
    if (error !== null || data === null) { push(libraryErrorText(error ?? 'internal'), 'error'); return; }
    replace(data.category);
    setNewName('');
    push(`Added “${data.category.name}”.`, 'success');
  };

  const startEdit = (c: LibraryCategory) => {
    setEditing(c.id);
    setEditName(c.name);
    setEditParent(c.parentId ?? '');
    setConfirmDelete(null);
  };

  const saveEdit = async (c: LibraryCategory) => {
    const name = normalizeCategoryName(editName);
    if (name === null) { push(`Give it a name (up to ${CATEGORY_NAME_MAX} characters).`, 'error'); return; }
    setBusy(true);
    const { data, error } = await saveLibraryCategory({ id: c.id, name, parentId: editParent === '' ? null : editParent });
    setBusy(false);
    if (error !== null || data === null) { push(libraryErrorText(error ?? 'internal'), 'error'); return; }
    replace(data.category);
    setEditing(null);
  };

  const move = async (c: LibraryCategory, dir: -1 | 1) => {
    const siblings = categories
      .filter((x) => x.parentId === c.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const i = siblings.findIndex((x) => x.id === c.id);
    const other = siblings[i + dir];
    if (!other) return;
    // Renumber the whole sibling list so equal sort orders can never stick.
    const order = siblings.map((x) => x.id);
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    setBusy(true);
    const next = [...categories];
    for (let k = 0; k < order.length; k++) {
      const cat = next.find((x) => x.id === order[k])!;
      const sortOrder = (k + 1) * 10;
      if (cat.sortOrder === sortOrder) continue;
      const { data, error } = await saveLibraryCategory({ id: cat.id, name: cat.name, sortOrder });
      if (error !== null || data === null) { setBusy(false); push(libraryErrorText(error ?? 'internal'), 'error'); onChange(next); return; }
      next[next.findIndex((x) => x.id === cat.id)] = data.category;
    }
    setBusy(false);
    onChange(next);
  };

  const remove = async (c: LibraryCategory) => {
    setBusy(true);
    const { data, error } = await deleteLibraryCategory(c.id);
    setBusy(false);
    if (error !== null || data === null) { push(libraryErrorText(error ?? 'internal'), 'error'); return; }
    onChange(categories.filter((x) => x.id !== c.id));
    setConfirmDelete(null);
    push(
      data.moved > 0
        ? `Deleted “${c.name}”. ${data.moved} item${data.moved === 1 ? '' : 's'} moved to ${data.movedTo ? 'its parent' : 'No category'}.`
        : `Deleted “${c.name}”.`,
      'success',
    );
  };

  const row = (c: LibraryCategory, isChild: boolean, hasChildren: boolean) => {
    const n = counts[c.id] ?? 0;
    if (editing === c.id) {
      return (
        <div key={c.id} className={`flex flex-col sm:flex-row gap-2 py-2 ${isChild ? 'sm:pl-8' : ''}`}>
          <input value={editName} maxLength={CATEGORY_NAME_MAX} onChange={(e) => setEditName(e.target.value)} className={FIELD} aria-label="Category name" autoFocus />
          <select
            value={editParent}
            onChange={(e) => setEditParent(e.target.value)}
            disabled={hasChildren}
            className={`${FIELD} sm:w-56`}
            aria-label="Parent category"
          >
            <option value="">Top level</option>
            {tops.filter((t) => t.id !== c.id).map((t) => <option key={t.id} value={t.id}>Inside {t.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => void saveEdit(c)} disabled={busy} className={ICON_BTN} aria-label="Save"><Check className="w-4 h-4" /></button>
            <button onClick={() => setEditing(null)} disabled={busy} className={ICON_BTN} aria-label="Cancel"><X className="w-4 h-4" /></button>
          </div>
        </div>
      );
    }
    return (
      <div key={c.id} className={`flex items-center gap-2 py-1.5 ${isChild ? 'pl-6 sm:pl-8' : ''}`}>
        <div className="min-w-0 flex-1">
          <p className={`font-sans text-sm truncate ${isChild ? 'text-brand-fg/85' : 'text-brand-fg font-medium'}`}>{c.name}</p>
          <p className="font-mono text-[10px] text-brand-muted/50 truncate">{c.slug} · {n} item{n === 1 ? '' : 's'}</p>
        </div>
        {confirmDelete === c.id ? (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline font-sans text-xs text-brand-muted/70">
              {n > 0 ? `Its ${n} item${n === 1 ? '' : 's'} move to ${c.parentId ? 'the parent' : 'No category'}.` : 'Delete it?'}
            </span>
            <button onClick={() => void remove(c)} disabled={busy} className="pressable min-h-11 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-label uppercase tracking-luxe text-[10px]">Delete</button>
            <button onClick={() => setConfirmDelete(null)} disabled={busy} className={ICON_BTN} aria-label="Keep it"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button onClick={() => void move(c, -1)} disabled={busy} className={ICON_BTN} aria-label={`Move ${c.name} up`}><ArrowUp className="w-4 h-4" /></button>
            <button onClick={() => void move(c, 1)} disabled={busy} className={ICON_BTN} aria-label={`Move ${c.name} down`}><ArrowDown className="w-4 h-4" /></button>
            <button onClick={() => startEdit(c)} disabled={busy} className={ICON_BTN} aria-label={`Edit ${c.name}`}><Pencil className="w-4 h-4" /></button>
            <button
              onClick={() => setConfirmDelete(c.id)}
              disabled={busy || hasChildren}
              title={hasChildren ? 'Move or delete its subcategories first' : undefined}
              className={ICON_BTN}
              aria-label={`Delete ${c.name}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal title="Categories" onClose={onClose} maxWidthClass="max-w-2xl" dismissOnScrim={!busy && newName === '' && editing === null}>
      <p className="font-sans text-xs text-brand-muted/60 leading-relaxed mb-4">
        Two levels: a category, and subcategories inside it. Each item sits in one place. Use keywords for anything
        that cuts across shelves, like colours or materials. The small grey name under each one is its permanent web
        name, used by the API, and it never changes, even if you rename the category.
      </p>

      <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-3 mb-5">
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 mb-2">New category</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={newName}
            maxLength={CATEGORY_NAME_MAX}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            placeholder="e.g. Diwali"
            className={FIELD}
            aria-label="New category name"
          />
          <select value={newParent} onChange={(e) => setNewParent(e.target.value)} className={`${FIELD} sm:w-56`} aria-label="Where it goes">
            <option value="">Top level</option>
            {tops.map((t) => <option key={t.id} value={t.id}>Inside {t.name}</option>)}
          </select>
          <button
            onClick={() => void add()}
            disabled={busy || newName.trim() === ''}
            className="pressable min-h-11 px-4 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden /> Add
          </button>
        </div>
        {newName.trim() !== '' && slugifyCategory(newName) !== '' && (
          <p className="mt-2 font-mono text-[10px] text-brand-muted/50">Web name: {slugifyCategory(newName)}</p>
        )}
      </div>

      <div className="divide-y divide-white/[0.06]">
        {tree.map((node) => (
          <div key={node.category.id} className="py-1">
            {row(node.category, false, node.children.length > 0)}
            {node.children.map((c) => row(c, true, false))}
          </div>
        ))}
        {tree.length === 0 && <p className="py-6 text-center font-sans text-sm text-brand-muted/60">No categories yet.</p>}
      </div>
    </Modal>
  );
}
