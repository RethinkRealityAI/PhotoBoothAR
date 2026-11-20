/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/library as a CMS — the pure view model: one item shape for the three
 * places a library-worthy piece can live, and the search / filter / sort /
 * count rules the page renders from. No React, no network.
 *
 *  - 'library'  shared-library rows (global experiences; editable here)
 *  - 'builtin'  props and customisable models shipped in the app's code
 *               (read-only: they are not rows, so nothing here can change them)
 *  - 'event'    3D props and scenes made inside an event. Every host so far is
 *               the platform owner's own test account, so the admin may copy
 *               any of them into the library; the event keeps its original.
 */
import { LIBRARY_KIND_LABEL, type LibraryState, type LibraryTags } from './libraryPublish';
import { categoryScope, keywordLabel, type LibraryCategory } from './libraryTaxonomy';

export type CmsSource = 'library' | 'builtin' | 'event';
/** The source filter: one home, or 'all' (every home in one view). */
export type CmsSourceFilter = CmsSource | 'all';
export type CmsType = 'frame' | 'sticker' | 'filter' | '3d' | 'scene';

export const CMS_TYPES: readonly CmsType[] = ['3d', 'scene', 'frame', 'sticker', 'filter'];
export const CMS_TYPE_LABEL: Record<CmsType, string> = {
  '3d': '3D props',
  scene: 'Scenes',
  frame: 'Frames',
  sticker: 'Stickers',
  filter: 'Filters',
};
export const CMS_SOURCE_LABEL: Record<CmsSourceFilter, string> = {
  all: 'Everything',
  library: 'Library',
  builtin: 'Built into the app',
  event: 'From events',
};
/** Operator words for a library state (the lifecycle verbs stay in libraryPublish). */
export const CMS_STATE_LABEL: Record<LibraryState, string> = {
  listed: 'Live for hosts',
  retired: 'Hidden from hosts',
  withdrawn: 'Withdrawn',
};

export function cmsTypeOfKind(kind: string): CmsType {
  switch (kind) {
    case 'border': return 'frame';
    case '2d_filter': return 'sticker';
    case 'shader': return 'filter';
    case 'composite': return 'scene';
    default: return '3d';
  }
}

export function kindLabel(kind: string): string {
  return LIBRARY_KIND_LABEL[kind] ?? kind;
}

export interface CmsItem {
  /** `${source}:${id}` — unique across sources (a library row and the event
   *  scene it was copied from share nothing but provenance). */
  key: string;
  id: string;
  source: CmsSource;
  name: string;
  kind: string;
  type: CmsType;
  thumb: string | null;
  swatch: [string, string] | null;
  /** Library rows only. */
  state: LibraryState | null;
  /** Library rows: the stored category. Built-in / event: a SUGGESTION
   *  (see `categorySuggested`) — nothing is stored for them. */
  categoryId: string | null;
  categorySuggested: boolean;
  keywords: string[];
  tags: LibraryTags;
  createdAt: string | null;
  linkCount: number;
  /** Where it came from, in words: an event's name, "Built into the app". */
  origin: string | null;
  /** Library rows: its version. */
  version: number | null;
  /** 3D model to preview, when there is one. */
  modelUrl: string | null;
  /** Event items: already copied into the library (by provenance). */
  inLibrary: boolean;
  /** Library rows (migration 048): 'orgs' = only the chosen customers may use it. */
  access?: 'everyone' | 'orgs';
  accessOrgs?: ReadonlyArray<{ id: string; name: string }>;
}

export type CmsSort = 'newest' | 'oldest' | 'name' | 'most-used';
export const CMS_SORT_LABEL: Record<CmsSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name A–Z',
  'most-used': 'Most used',
};

/** 'all', 'none' (uncategorised) or a category id (includes its children). */
export type CmsCategoryFilter = 'all' | 'none' | string;

export interface CmsQuery {
  source: CmsSourceFilter;
  text: string;
  types: readonly CmsType[];
  category: CmsCategoryFilter;
  states: readonly LibraryState[];
  keyword: string | null;
  sort: CmsSort;
  /** Only pieces limited to chosen customers. */
  hostOnly?: boolean;
}

export function defaultCmsQuery(): CmsQuery {
  return { source: 'all', text: '', types: [], category: 'all', states: [], keyword: null, sort: 'newest' };
}

/**
 * Is the item in the chosen source? 'all' shows every home together, except an
 * event piece that has already been copied into the library: its library copy
 * stands for it there, so it is not listed twice.
 */
export function inSourceFilter(item: CmsItem, source: CmsSourceFilter): boolean {
  if (source === 'all') return !(item.source === 'event' && item.inLibrary);
  return item.source === source;
}

function categoryName(id: string | null, categories: readonly LibraryCategory[]): string {
  if (id === null) return '';
  const c = categories.find((x) => x.id === id);
  if (!c) return '';
  const p = c.parentId === null ? undefined : categories.find((x) => x.id === c.parentId);
  return `${p?.name ?? ''} ${c.name}`;
}

/** Every word a search can hit: name, keywords, category path, tags, origin, kind. */
export function searchText(item: CmsItem, categories: readonly LibraryCategory[]): string {
  return [
    item.name,
    ...item.keywords.map(keywordLabel),
    categoryName(item.categoryId, categories),
    ...item.tags.occasions,
    ...item.tags.colors,
    ...item.tags.styles,
    item.origin ?? '',
    kindLabel(item.kind),
  ]
    .join(' ')
    .toLowerCase();
}

/** True when every word of `text` appears somewhere in the item ("gold crown"). */
export function matchesText(item: CmsItem, text: string, categories: readonly LibraryCategory[]): boolean {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const hay = searchText(item, categories);
  return words.every((w) => hay.includes(w));
}

function inCategory(item: CmsItem, filter: CmsCategoryFilter, categories: readonly LibraryCategory[]): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return item.categoryId === null;
  return item.categoryId !== null && categoryScope(filter, categories).has(item.categoryId);
}

function time(s: string | null): number {
  const t = s === null ? NaN : Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/**
 * The items the page shows, in order. Facets are AND-ed; values inside one
 * facet (two types, two states) are OR-ed. State only narrows library rows —
 * built-ins and event items have no state. Ties keep name order so a list
 * never reshuffles between renders.
 */
export function queryCms(items: readonly CmsItem[], q: CmsQuery, categories: readonly LibraryCategory[]): CmsItem[] {
  const out = items.filter((i) =>
    inSourceFilter(i, q.source) &&
    (q.types.length === 0 || q.types.includes(i.type)) &&
    (q.states.length === 0 || (i.state !== null && q.states.includes(i.state))) &&
    (q.keyword === null || i.keywords.includes(q.keyword)) &&
    (q.hostOnly !== true || i.access === 'orgs') &&
    inCategory(i, q.category, categories) &&
    matchesText(i, q.text, categories),
  );
  const byName = (a: CmsItem, b: CmsItem) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const cmp: Record<CmsSort, (a: CmsItem, b: CmsItem) => number> = {
    newest: (a, b) => time(b.createdAt) - time(a.createdAt) || byName(a, b),
    oldest: (a, b) => time(a.createdAt) - time(b.createdAt) || byName(a, b),
    name: byName,
    'most-used': (a, b) => b.linkCount - a.linkCount || byName(a, b),
  };
  return out.sort(cmp[q.sort]);
}

export interface CmsCounts {
  bySource: Record<CmsSourceFilter, number>;
  /** Per category id INCLUDING its subcategories' items, plus 'all' and 'none'. */
  byCategory: Record<string, number>;
  byType: Record<CmsType, number>;
  /** Keywords used in the current source, most used first. */
  keywords: Array<{ keyword: string; count: number }>;
}

/**
 * Sidebar / chip counts for the CURRENT source, ignoring the category and
 * keyword facets themselves (so a shelf's count does not drop to the one you
 * are standing on) but honouring type, state and text — the counts say "what
 * you would see if you clicked this".
 */
export function cmsCounts(items: readonly CmsItem[], q: CmsQuery, categories: readonly LibraryCategory[]): CmsCounts {
  const bySource: Record<CmsSourceFilter, number> = { all: 0, library: 0, builtin: 0, event: 0 };
  for (const i of items) {
    bySource[i.source] += 1;
    if (inSourceFilter(i, 'all')) bySource.all += 1;
  }

  const inSource = items.filter((i) => inSourceFilter(i, q.source));
  const base = inSource.filter((i) =>
    (q.states.length === 0 || (i.state !== null && q.states.includes(i.state))) && matchesText(i, q.text, categories),
  );
  const typed = base.filter((i) => q.types.length === 0 || q.types.includes(i.type));

  const byCategory: Record<string, number> = { all: typed.length, none: 0 };
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  for (const i of typed) {
    if (i.categoryId === null || !parentOf.has(i.categoryId)) { byCategory.none += 1; continue; }
    byCategory[i.categoryId] = (byCategory[i.categoryId] ?? 0) + 1;
    const parent = parentOf.get(i.categoryId);
    if (parent) byCategory[parent] = (byCategory[parent] ?? 0) + 1;
  }

  const byType: Record<CmsType, number> = { frame: 0, sticker: 0, filter: 0, '3d': 0, scene: 0 };
  for (const i of base.filter((x) => inCategory(x, q.category, categories))) byType[i.type] += 1;

  const kw = new Map<string, number>();
  for (const i of typed) for (const k of i.keywords) kw.set(k, (kw.get(k) ?? 0) + 1);
  const keywords = [...kw.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));

  return { bySource, byCategory, byType, keywords };
}

/* ── Event models: what it takes to copy one into the library ───────── */

export type PictureSource =
  | { kind: 'glb'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'none' };

const IMAGE_RE = /\.(png|jpe?g|webp|svg|gif)(\?|#|$)/i;
const GLB_RE = /\.(glb|gltf)(\?|#|$)/i;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Where a thumbnail for an event piece can come from, when it has none. A lone
 * 3D prop: its own model. A scene: its first 3D layer, else its first image
 * layer (a frame drawn flat is a fair picture of a scene). Procedural pieces
 * with no file at all: 'none' — the operator uploads a picture.
 * An asset URL with no extension (AI jobs store `<uuid>` keys) is treated as a
 * model for a 3D prop — that is what that column holds for that kind.
 */
export function pictureSourceFor(row: { kind: string; assetUrl: string | null; config: unknown }): PictureSource {
  const asset = str(row.assetUrl);
  if (row.kind === '3d_attachment') {
    if (asset && !IMAGE_RE.test(asset)) return { kind: 'glb', url: asset };
    return { kind: 'none' };
  }
  const cfg = row.config !== null && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {};
  const layers = Array.isArray(cfg.layers) ? (cfg.layers as unknown[]) : [];
  const urls = layers.map((l) => {
    const o = l !== null && typeof l === 'object' ? (l as Record<string, unknown>) : {};
    return { kind: str(o.kind) ?? '', url: str(o.asset_url) ?? str(o.assetUrl) ?? str(o.url) };
  });
  const model = urls.find((u) => u.url !== null && (GLB_RE.test(u.url) || u.kind === '3d_attachment' || u.kind === 'model'));
  if (model?.url) return { kind: 'glb', url: model.url };
  const image = urls.find((u) => u.url !== null && IMAGE_RE.test(u.url));
  if (image?.url) return { kind: 'image', url: image.url };
  if (asset && IMAGE_RE.test(asset)) return { kind: 'image', url: asset };
  return { kind: 'none' };
}

/** Event piece names are often the AI prompt ("A sleek, blue cycling helmet
 *  with a sub…"). A library name is 2-5 words a host would recognise. */
export function tidyEventName(name: string): string {
  const raw = name.replace(/[…]+$/u, '').replace(/\.\.\.$/, '').trim();
  if (raw === '' || /^untitled/i.test(raw)) return 'Untitled piece';
  let core = raw.replace(/^(a|an|the)\s+/i, '');
  // "helmet with a subtle stripe" / "hat in team colours" -> the noun phrase.
  const cut = core.search(/\s(with|in|of|featuring|that|made|for)\s/i);
  if (cut > 0) core = core.slice(0, cut);
  const words = core.replace(/[,;:]+/g, ' ').split(/\s+/).filter((w) => w !== '').slice(0, 5);
  const clean = words.join(' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
