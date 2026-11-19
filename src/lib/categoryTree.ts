/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The category tree EDITOR's rules, pure (no React, no supabase import):
 * where a dragged category may land, what a move does to sibling order, the
 * keyboard "Move to…" list, and the checks a new name must pass.
 *
 * Two levels only. This mirrors library_categories_guard (migration 045),
 * which refuses a parent that is itself a child ('category_too_deep') and a
 * child that has children of its own ('category_has_children'). Checking here
 * first lets the editor say WHY before it spends a round trip on it.
 *
 * Sibling order is renumbered ×10 (10, 20, 30…) on every reorder, so two
 * equal sort orders can never stick and a later insert always has room.
 */
import {
  CATEGORY_NAME_MAX,
  buildCategoryTree,
  normalizeCategoryName,
  slugifyCategory,
  type LibraryCategory,
} from './libraryTaxonomy';

export const SORT_STEP = 10;

/** Where a category goes: under `parentId` (null = top level), at `index`
 *  among its NEW siblings, the moved category itself not counted. */
export interface Placement {
  parentId: string | null;
  index: number;
}

/** One save_library_category call. `parentId` is present only when the parent
 *  changes (absent = the server keeps it). `name` is always sent: the action
 *  requires it on every call. */
export interface CategorySave {
  id: string;
  name: string;
  sortOrder: number;
  parentId?: string | null;
}

export type PlaceCheck = { ok: true; reason?: undefined } | { ok: false; reason: string };

export type MovePlan =
  | { ok: true; next: LibraryCategory[]; saves: CategorySave[]; reason?: undefined }
  | { ok: false; reason: string; next?: undefined; saves?: undefined };

/** Top level in the tree's own sense: no parent, or a parent that is missing
 *  (buildCategoryTree promotes those rather than losing them). */
function isTop(c: LibraryCategory, categories: readonly LibraryCategory[]): boolean {
  return c.parentId === null || !categories.some((x) => x.id === c.parentId);
}

/** The ordered siblings under `parentId` (null = top level), minus `excludeId`. */
export function siblingsUnder(
  categories: readonly LibraryCategory[], parentId: string | null, excludeId?: string,
): LibraryCategory[] {
  const tree = buildCategoryTree(categories);
  const list = parentId === null
    ? tree.map((n) => n.category)
    : tree.find((n) => n.category.id === parentId)?.children ?? [];
  return excludeId === undefined ? list : list.filter((c) => c.id !== excludeId);
}

export function childCount(categories: readonly LibraryCategory[], id: string): number {
  return categories.filter((c) => c.parentId === id).length;
}

/** The category's current parent in tree terms (null for top level). */
function treeParent(c: LibraryCategory, categories: readonly LibraryCategory[]): string | null {
  return isTop(c, categories) ? null : c.parentId;
}

/** May `dragId` live under `parentId`? The reason is operator-facing copy. */
export function canPlace(
  categories: readonly LibraryCategory[], dragId: string, parentId: string | null,
): PlaceCheck {
  const drag = categories.find((c) => c.id === dragId);
  if (!drag) return { ok: false, reason: 'That category no longer exists. Refresh and try again.' };
  if (parentId === null) return { ok: true };
  if (parentId === dragId) return { ok: false, reason: 'A category cannot go inside itself.' };
  const parent = categories.find((c) => c.id === parentId);
  if (!parent) return { ok: false, reason: 'That category no longer exists. Refresh and try again.' };
  if (!isTop(parent, categories)) {
    return { ok: false, reason: `“${parent.name}” is already a subcategory. Categories go two levels deep.` };
  }
  const kids = childCount(categories, dragId);
  if (kids > 0) {
    return {
      ok: false,
      reason: `“${drag.name}” has ${kids} subcategor${kids === 1 ? 'y' : 'ies'}, so it cannot go inside another category. Move ${kids === 1 ? 'it' : 'them'} out first.`,
    };
  }
  return { ok: true };
}

/**
 * Move `dragId` to `place`. Returns the whole next category list (for the
 * optimistic paint) and the saves that persist it, the moved category FIRST
 * so a refused re-parent fails before any sibling is renumbered. Only rows
 * whose parent or sort order actually changes are saved. Dropping a category
 * back where it already was is a no-op (no saves), even when the existing
 * numbers are not multiples of ten.
 */
export function planMove(
  categories: readonly LibraryCategory[], dragId: string, place: Placement,
): MovePlan {
  const check = canPlace(categories, dragId, place.parentId);
  if (!check.ok) return { ok: false, reason: check.reason };
  const drag = categories.find((c) => c.id === dragId)!;
  const fromParent = treeParent(drag, categories);
  const parentChanges = fromParent !== place.parentId;

  const before = siblingsUnder(categories, place.parentId).map((c) => c.id);
  const rest = siblingsUnder(categories, place.parentId, dragId);
  const at = Math.max(0, Math.min(Number.isFinite(place.index) ? Math.trunc(place.index) : rest.length, rest.length));
  const order = [...rest.slice(0, at), drag, ...rest.slice(at)];

  if (!parentChanges && order.length === before.length && order.every((c, i) => c.id === before[i])) {
    return { ok: true, next: [...categories], saves: [] };
  }

  const saves: CategorySave[] = [];
  const updates = new Map<string, LibraryCategory>();
  order.forEach((c, k) => {
    const sortOrder = (k + 1) * SORT_STEP;
    const moved = c.id === dragId;
    if (!moved && c.sortOrder === sortOrder) return;
    if (moved && !parentChanges && c.sortOrder === sortOrder) return;
    const save: CategorySave = { id: c.id, name: c.name, sortOrder };
    if (moved && parentChanges) save.parentId = place.parentId;
    saves.push(save);
    updates.set(c.id, { ...c, sortOrder, parentId: moved && parentChanges ? place.parentId : c.parentId });
  });
  saves.sort((a, b) => (a.id === dragId ? -1 : b.id === dragId ? 1 : 0));
  return { ok: true, next: categories.map((c) => updates.get(c.id) ?? c), saves };
}

export type DropZone = 'before' | 'after' | 'into';

/**
 * The placement for hovering `overId` in `zone`. 'into' only means something
 * on a top-level row (become its last subcategory); on a subcategory it is
 * read as 'after'. Returns null when hovering the dragged row itself.
 */
export function placementFor(
  categories: readonly LibraryCategory[], dragId: string, overId: string, zone: DropZone,
): Placement | null {
  if (overId === dragId) return null;
  const over = categories.find((c) => c.id === overId);
  if (!over) return null;
  if (isTop(over, categories)) {
    if (zone === 'into') return { parentId: over.id, index: siblingsUnder(categories, over.id, dragId).length };
    const tops = siblingsUnder(categories, null, dragId);
    const i = tops.findIndex((c) => c.id === over.id);
    return { parentId: null, index: zone === 'before' ? i : i + 1 };
  }
  const sibs = siblingsUnder(categories, over.parentId, dragId);
  const i = sibs.findIndex((c) => c.id === over.id);
  return { parentId: over.parentId, index: zone === 'before' ? i : i + 1 };
}

/** The end of the top level, for the "make it top-level" drop strip. */
export function topLevelEnd(categories: readonly LibraryCategory[], dragId: string): Placement {
  return { parentId: null, index: siblingsUnder(categories, null, dragId).length };
}

export interface MoveOption {
  key: string;
  label: string;
  place: Placement;
  /** Set when the move is refused; the option is shown but not offered. */
  disabledReason?: string;
}

/**
 * The keyboard / screen-reader path for the same moves a drag makes: up,
 * down, make top-level, and "into" every other top-level category.
 */
export function moveOptions(categories: readonly LibraryCategory[], id: string): MoveOption[] {
  const c = categories.find((x) => x.id === id);
  if (!c) return [];
  const parentId = treeParent(c, categories);
  const sibs = siblingsUnder(categories, parentId);
  const i = sibs.findIndex((x) => x.id === id);
  const out: MoveOption[] = [];
  if (i > 0) out.push({ key: 'up', label: `Move up, above “${sibs[i - 1].name}”`, place: { parentId, index: i - 1 } });
  if (i < sibs.length - 1) out.push({ key: 'down', label: `Move down, below “${sibs[i + 1].name}”`, place: { parentId, index: i + 1 } });
  if (parentId !== null) {
    out.push({ key: 'top', label: 'Make it a top-level category', place: topLevelEnd(categories, id) });
  }
  for (const t of siblingsUnder(categories, null)) {
    if (t.id === id || t.id === parentId) continue;
    const check = canPlace(categories, id, t.id);
    out.push({
      key: `into:${t.id}`,
      label: `Move into “${t.name}”`,
      place: { parentId: t.id, index: siblingsUnder(categories, t.id, id).length },
      ...(check.ok ? {} : { disabledReason: check.reason }),
    });
  }
  return out;
}

/** The sort order for a new category at the END of its siblings. */
export function nextSortOrder(categories: readonly LibraryCategory[], parentId: string | null): number {
  return Math.max(0, ...categories.filter((c) => c.parentId === parentId).map((c) => c.sortOrder)) + SORT_STEP;
}

export type NameCheck =
  | { ok: true; name: string; slug: string; reason?: undefined }
  | { ok: false; reason: string; name?: undefined; slug?: undefined };

/**
 * A new category's name, checked the way the server will: a usable name, a
 * web name (slug) that is not empty, and not one another category already
 * holds — slugs are unique, so "Xmas!" and "xmas" collide.
 */
export function checkNewName(categories: readonly LibraryCategory[], raw: string): NameCheck {
  const name = normalizeCategoryName(raw);
  if (name === null) return { ok: false, reason: `Give it a name, up to ${CATEGORY_NAME_MAX} characters.` };
  const slug = slugifyCategory(name);
  if (slug === '') return { ok: false, reason: 'Use at least one letter or number.' };
  const clash = categories.find((c) => c.slug === slug);
  if (clash) return { ok: false, reason: `“${clash.name}” already has the web name “${slug}”. Pick another name.` };
  return { ok: true, name, slug };
}

/** A rename: the name only — the slug never changes after creation. */
export function checkRename(raw: string): { ok: true; name: string; reason?: undefined } | { ok: false; reason: string; name?: undefined } {
  const name = normalizeCategoryName(raw);
  if (name === null) return { ok: false, reason: `Give it a name, up to ${CATEGORY_NAME_MAX} characters.` };
  return { ok: true, name };
}

/**
 * What a partly-failed multi-save leaves behind: the snapshot from before the
 * move, with every save the server DID accept applied on top. That is the
 * honest state — rolling all the way back would show an order the server no
 * longer has.
 */
export function applySaved(snapshot: readonly LibraryCategory[], saved: readonly LibraryCategory[]): LibraryCategory[] {
  const byId = new Map(saved.map((c) => [c.id, c]));
  return snapshot.map((c) => byId.get(c.id) ?? c);
}
