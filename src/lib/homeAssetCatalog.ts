/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * homeAssetCatalog — EVERYTHING /admin/home-assets' asset picker can offer,
 * as one list: the homepage's built-in props, frames, filters and effects;
 * every shared-library row in every state (live, hidden from hosts,
 * withdrawn, host-only) and the bulk-import drafts; every 3D prop and scene
 * made inside an event; and the files uploaded for the landing pages.
 * Pure, DOM-free, tested in node.
 *
 * Only admin read paths feed it (admin-api list_library_items /
 * list_library_drafts / list_event_models / list_library_categories, and the
 * platform-admin storage listing of `_platform/landing/`), so nothing here
 * widens who can read what. Every entry is judged against the SLOT it is
 * offered for: `pick` is set only when the slot can render it (a .glb for a
 * prop, a frame picture for a frame, a picture or clip for a filter or
 * effect), otherwise `reason` says why in a few words. Every pick is still
 * re-checked by lib/homeAssets (resolveAssetUrl / lookUrlKind) when it lands.
 */
import { CMS_STATE_LABEL, cmsTypeOfKind } from './libraryCms';
import { categoryPath, keywordLabel, type LibraryCategory } from './libraryTaxonomy';
import type { LibraryState } from './libraryPublish';
import {
  lookUrlKind, resolveAssetUrl,
  type AssetKind, type HomeLook, type LookCategory, type LookUrlKind,
} from './homeAssets';
import { BUILTIN_ASSETS, BUILTIN_EFFECT_LOOKS, fitForProp, lookFromBuiltin, lookFromLibraryItem } from './homeAssetSources';

/** One choosable asset: always a URL; a ready look when it is for a look slot. */
export interface PickedAsset {
  url: string;
  /** 'builtin' = a file-less `tint:` / `fx:` look. */
  kind: LookUrlKind;
  name: string;
  thumb?: string;
  look?: HomeLook;
}

/** What a slot takes: its file kinds, and for a look slot the category picks are filed under. */
export interface CatalogSlot {
  accept: AssetKind[];
  category?: LookCategory;
}

export type CatalogSource = 'builtin' | 'library' | 'draft' | 'event' | 'upload';
/** The picker's source tabs (drafts sit under Library). */
export type CatalogSourceFilter = 'all' | 'builtin' | 'library' | 'event' | 'upload';
export const CATALOG_SOURCES: readonly CatalogSourceFilter[] = ['all', 'builtin', 'library', 'event', 'upload'];
export const CATALOG_SOURCE_LABEL: Record<CatalogSourceFilter, string> = {
  all: 'Everything', builtin: 'Built-in', library: 'Library', event: 'From events', upload: 'Uploaded',
};

export type CatalogType = '3d' | 'scene' | 'frame' | 'sticker' | 'filter' | 'effect' | 'photo' | 'video';
export const CATALOG_TYPES: readonly CatalogType[] = ['3d', 'scene', 'frame', 'sticker', 'filter', 'effect', 'photo', 'video'];
export const CATALOG_TYPE_LABEL: Record<CatalogType, string> = {
  '3d': '3D props', scene: 'Scenes', frame: 'Frames', sticker: 'Stickers', filter: 'Filters', effect: 'Effects', photo: 'Pictures', video: 'Clips',
};

export interface CatalogEntry {
  /** Unique across sources. */
  key: string;
  source: CatalogSource;
  name: string;
  type: CatalogType;
  thumb?: string;
  /** Short facts shown on the tile: its state, who may use it, where it came from. */
  badges: string[];
  /** A caution that does not stop the pick (an event's file can go when the event is deleted). */
  warn?: string;
  /** Set when this slot can render it. */
  pick: PickedAsset | null;
  /** Why not, when `pick` is null. */
  reason: string | null;
  /** Lower-case words a search can hit. */
  text: string;
  /** An event piece already copied into the library: Everything lists its library row instead. */
  copied?: boolean;
}

/* ── The sources, as admin-api returns them (only the fields read here) ─ */

export interface LibraryRowLike {
  id: string;
  name: string;
  kind: string;
  assetUrl: string | null;
  thumbnailUrl: string | null;
  modelUrl?: string | null;
  state: LibraryState;
  access?: 'everyone' | 'orgs';
  keywords?: string[];
  categoryId?: string | null;
  collection?: string | null;
}

export interface DraftRowLike {
  id: string;
  name: string;
  assetUrl: string;
  thumbnailUrl: string | null;
  keywords?: string[];
  categoryId?: string | null;
}

export interface EventModelLike {
  id: string;
  name: string;
  kind: string;
  assetUrl: string | null;
  thumbnailUrl: string | null;
  config: { layers: Array<{ kind: string; asset_url: string | null }> };
  eventName: string;
  eventArchived: boolean;
  /** Already copied into the library (its library row stands for it in Everything). */
  inLibrary: boolean;
}

export interface UploadLike {
  url: string;
  name: string;
}

export interface CatalogInput {
  library?: readonly LibraryRowLike[] | null;
  drafts?: readonly DraftRowLike[] | null;
  events?: readonly EventModelLike[] | null;
  uploads?: readonly UploadLike[] | null;
  categories?: readonly LibraryCategory[];
}

/* ── Judging one asset against one slot ─────────────────────────────── */

const GLTF = /\.gltf(\?|#|$)/i;
const SVG = /\.svg(\?|#|$)/i;

/** The first scene layer that is a 3D model file (admin-api previewModelUrl's rule). */
export function sceneModelUrl(layers: ReadonlyArray<{ kind: string; asset_url: string | null }>): string | null {
  for (const l of layers) {
    const u = l.asset_url;
    if (typeof u === 'string' && u !== '' && (/\.(glb|gltf)(\?|#|$)/i.test(u) || l.kind === '3d_attachment')) return u;
  }
  return null;
}

/** The type an uploaded / plain file is, by its extension. */
function fileType(url: string): CatalogType {
  if (resolveAssetUrl(url, 'model') !== undefined || GLTF.test(url)) return '3d';
  if (resolveAssetUrl(url, 'video') !== undefined) return 'video';
  return 'photo';
}

const NOT_FOR: Record<CatalogType, string> = {
  '3d': 'A 3D model. Add it under 3D props.',
  scene: 'A 3D scene. Add it under 3D props.',
  frame: 'A frame. Add it under Frames.',
  sticker: 'A sticker, not a full frame.',
  filter: 'A filter. Add it under Filters.',
  effect: 'An effect. Add it under Effects.',
  photo: 'A picture, not a 3D model.',
  video: 'A clip, not a 3D model.',
};

/** Which types each look category takes (filters and effects share pictures and clips, as before). */
const TAKES: Record<LookCategory, readonly CatalogType[]> = {
  prop: ['3d', 'scene'],
  frame: ['frame', 'photo'],
  filter: ['filter', 'sticker', 'effect', 'scene', 'photo', 'video'],
  effect: ['filter', 'sticker', 'effect', 'scene', 'photo', 'video'],
};

interface Candidate {
  key: string;
  source: CatalogSource;
  name: string;
  type: CatalogType;
  /** The files it has, best first, per role. */
  model: string | null;
  asset: string | null;
  thumb: string | null;
  badges: string[];
  warn?: string;
  words: string[];
  copied?: boolean;
  /** A ready look for a built-in (its measured fit, its frame window). */
  builtinLook?: (cat: LookCategory) => HomeLook | null;
}

/** Why a slot cannot take `c` when no file of its kind is found. */
function missingReason(c: Candidate, slot: CatalogSlot): string {
  const urls = [c.model, c.asset].filter((u): u is string => u !== null);
  const wantsModel = slot.category === 'prop' || (slot.category === undefined && slot.accept.includes('model'));
  if (wantsModel) {
    if (urls.some((u) => GLTF.test(u))) return 'A .gltf model can\'t load here. It needs a single .glb file.';
    return c.type === '3d' || c.type === 'scene' ? 'No .glb model file in it.' : NOT_FOR[c.type];
  }
  if (urls.some((u) => SVG.test(u))) return 'SVG isn\'t supported here. Use a PNG or WebP.';
  if (slot.category === 'frame') return c.type === 'frame' ? 'No frame picture in it.' : NOT_FOR[c.type];
  if (slot.category === 'filter' || slot.category === 'effect') return 'No picture or clip in it.';
  if (slot.accept.includes('image')) return c.type === 'video' ? 'A clip. This slot takes pictures.' : 'No picture in it.';
  return 'This slot can\'t show it.';
}

/** `c` judged for `slot`: a pick, or the reason there is none. */
function judge(c: Candidate, slot: CatalogSlot): { pick: PickedAsset | null; reason: string | null } {
  const thumb = c.thumb ?? undefined;
  if (slot.category !== undefined) {
    const cat = slot.category;
    if (!TAKES[cat].includes(c.type)) return { pick: null, reason: NOT_FOR[c.type] };
    const look = c.builtinLook !== undefined
      ? c.builtinLook(cat)
      : lookFromLibraryItem({ id: c.key.replace(/^[a-z]+:/, ''), name: c.name, kind: '', assetUrl: c.asset, thumbnailUrl: c.thumb, modelUrl: c.model }, cat);
    const k = look === null ? undefined : lookUrlKind(look.url, cat);
    if (look === null || k === undefined) return { pick: null, reason: missingReason(c, slot) };
    // A file with no picture of its own: an uploaded image is its own thumb.
    const t = look.thumb ?? (k === 'image' ? look.url : undefined);
    const withThumb: HomeLook = t !== undefined ? { ...look, thumb: t } : look;
    return { pick: { url: look.url, kind: k, name: c.name, thumb: t, look: { ...withThumb, category: cat } }, reason: null };
  }
  // A plain slot (wall photos, scene props) takes the file itself.
  const url = [c.model, c.asset, c.thumb].find((u) => u !== null && slot.accept.some((k) => resolveAssetUrl(u, k) !== undefined)) ?? null;
  if (url === null) return { pick: null, reason: missingReason(c, slot) };
  const kind = slot.accept.find((k) => resolveAssetUrl(url, k) !== undefined)!;
  return { pick: { url, kind, name: c.name, thumb: resolveAssetUrl(c.thumb, 'image') ?? (kind === 'image' ? url : undefined) }, reason: null };
}

/* ── Building the list ──────────────────────────────────────────────── */

function libraryBadges(state: LibraryState, access: 'everyone' | 'orgs' | undefined): string[] {
  const out: string[] = [];
  if (state !== 'listed') out.push(CMS_STATE_LABEL[state]);
  if (access === 'orgs') out.push('Host-only');
  return out;
}

/** A file name without the upload's uuid prefix and its extension. */
export function uploadName(name: string): string {
  const base = name.replace(/^[0-9a-f-]{36}-/i, '');
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}

function candidates(input: CatalogInput): Candidate[] {
  const cats = input.categories ?? [];
  const out: Candidate[] = [];

  for (const a of BUILTIN_ASSETS) {
    out.push({
      key: `builtin:${a.url}`, source: 'builtin', name: a.name, type: a.category === 'prop' ? '3d' : 'frame',
      model: a.category === 'prop' ? a.url : null, asset: a.category === 'frame' ? a.url : null, thumb: a.thumb,
      badges: [], words: ['built-in'],
      builtinLook: (cat) => (cat === a.category ? lookFromBuiltin(a) : null),
    });
  }
  for (const l of BUILTIN_EFFECT_LOOKS) {
    out.push({
      key: `builtin:${l.url}`, source: 'builtin', name: l.name, type: l.category === 'filter' ? 'filter' : 'effect',
      model: null, asset: null, thumb: null, badges: [], words: ['built-in', l.url],
      builtinLook: (cat) => (cat === l.category ? l : null),
    });
  }

  for (const r of input.library ?? []) {
    const type = cmsTypeOfKind(r.kind) as CatalogType;
    out.push({
      key: `library:${r.id}`, source: 'library', name: r.name, type,
      model: r.modelUrl ?? (r.kind === '3d_attachment' ? r.assetUrl : null), asset: r.assetUrl, thumb: r.thumbnailUrl,
      badges: libraryBadges(r.state, r.access),
      words: [...(r.keywords ?? []).map(keywordLabel), categoryPath(r.categoryId ?? null, cats) ?? '', r.collection ?? '', 'library'],
    });
  }
  for (const d of input.drafts ?? []) {
    out.push({
      key: `draft:${d.id}`, source: 'draft', name: d.name, type: '3d',
      model: d.assetUrl, asset: d.assetUrl, thumb: d.thumbnailUrl, badges: ['Draft'],
      words: [...(d.keywords ?? []).map(keywordLabel), categoryPath(d.categoryId ?? null, cats) ?? '', 'library draft'],
    });
  }
  for (const e of input.events ?? []) {
    const type = cmsTypeOfKind(e.kind) as CatalogType;
    const model = e.kind === '3d_attachment' ? e.assetUrl : sceneModelUrl(e.config.layers);
    out.push({
      key: `event:${e.id}`, source: 'event', name: e.name, type, model, asset: e.assetUrl, thumb: e.thumbnailUrl,
      badges: [e.inLibrary ? 'In the library too' : `From ${e.eventName}`, ...(e.eventArchived ? ['Archived event'] : [])],
      warn: `Its file lives in the event "${e.eventName}": deleting that event removes it. Copy it into the library to keep it.`,
      words: [e.eventName, 'event'],
      copied: e.inLibrary,
    });
  }
  for (const u of input.uploads ?? []) {
    const type = fileType(u.url);
    out.push({
      key: `upload:${u.url}`, source: 'upload', name: uploadName(u.name), type,
      model: type === '3d' ? u.url : null, asset: u.url, thumb: type === 'photo' && resolveAssetUrl(u.url, 'image') !== undefined ? u.url : null,
      badges: [], words: ['uploaded'],
    });
  }
  return out;
}

const SOURCE_ORDER: Record<CatalogSource, number> = { builtin: 0, library: 1, draft: 2, event: 3, upload: 4 };

/**
 * Everything, judged for `slot`: the entries it can take first (built-in,
 * library, drafts, events, uploads), then the rest with their reasons. A
 * scene offered as a prop says it wears the scene's 3D piece.
 */
export function buildCatalog(input: CatalogInput, slot: CatalogSlot): CatalogEntry[] {
  const seen = new Set<string>();
  const list: CatalogEntry[] = [];
  for (const c of candidates(input)) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    const { pick, reason } = judge(c, slot);
    const badges = c.type === 'scene' && pick !== null && slot.category === 'prop' ? [...c.badges, 'Wears its 3D piece'] : c.badges;
    list.push({
      key: c.key, source: c.source, name: c.name, type: c.type,
      thumb: resolveAssetUrl(c.thumb, 'image') ?? pick?.thumb,
      badges, ...(c.warn !== undefined ? { warn: c.warn } : {}), ...(c.copied === true ? { copied: true } : {}), pick, reason,
      text: [c.name, ...c.words, ...badges, CATALOG_TYPE_LABEL[c.type]].join(' ').toLowerCase(),
    });
  }
  return list
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Number(a.e.pick === null) - Number(b.e.pick === null) || SOURCE_ORDER[a.e.source] - SOURCE_ORDER[b.e.source] || a.i - b.i)
    .map(({ e }) => e);
}

/* ── Filtering ──────────────────────────────────────────────────────── */

export interface CatalogQuery {
  source: CatalogSourceFilter;
  type: CatalogType | 'all';
  text: string;
  /** Hide what this slot can't take. */
  fitsOnly: boolean;
}

export function inCatalogSource(e: CatalogEntry, source: CatalogSourceFilter): boolean {
  if (source === 'all') return e.copied !== true;
  if (source === 'library') return e.source === 'library' || e.source === 'draft';
  return e.source === source;
}

/** Every search word must appear (in any order). */
export function matchesSearch(e: CatalogEntry, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w !== '');
  return words.every((w) => e.text.includes(w));
}

export function filterCatalog(entries: readonly CatalogEntry[], q: CatalogQuery): CatalogEntry[] {
  return entries.filter((e) => inCatalogSource(e, q.source) && (q.type === 'all' || e.type === q.type) && (!q.fitsOnly || e.pick !== null) && matchesSearch(e, q.text));
}

/** How many entries each type chip would show under the rest of the query. */
export function typeCounts(entries: readonly CatalogEntry[], q: CatalogQuery): Record<CatalogType | 'all', number> {
  const out = Object.fromEntries([...CATALOG_TYPES, 'all'].map((t) => [t, 0])) as Record<CatalogType | 'all', number>;
  for (const e of filterCatalog(entries, { ...q, type: 'all' })) { out[e.type]++; out.all++; }
  return out;
}

/** The pick for a fresh upload (a look when the slot is a look slot). */
export function uploadPick(url: string, kind: AssetKind, name: string, category: LookCategory | undefined): PickedAsset {
  const thumb = kind === 'image' ? url : undefined;
  if (category === undefined) return { url, kind, name, thumb };
  const look: HomeLook = { id: '', name, category, url, ...(thumb !== undefined ? { thumb } : {}), ...(category === 'prop' ? { fit: fitForProp(url, name) } : {}) };
  return { url, kind, name, thumb, look };
}
