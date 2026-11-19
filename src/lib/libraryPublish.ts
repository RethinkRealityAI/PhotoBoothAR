/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The shared library's PUBLISH side, pure (no React, no supabase import).
 *
 * A library item is an `experiences` row with `is_global = true`,
 * `event_id = null`, `org_id = null` and `is_published = true`, carrying the
 * same kind/source/rendering fields as the scene it was published from, plus
 * a `config.library` block (LibraryMeta below). The read side already exists
 * end to end (migrations 002/003/005, db.ts fetchGlobalExperiences,
 * catalog.ts buildCatalog); this module is what lets a platform admin MAKE one.
 *
 * Media is COPIED to `assets/_platform/library/<newId>/<basename>` rather than
 * referenced: the source belongs to some host's event, and deleting that event
 * sweeps its storage prefix (delete-event) — a library item pointing at it
 * would break in every event that linked it. `_platform` can never be an
 * event slug, and migration 018 already gives platform admins bucket-wide
 * write, so no storage policy changes.
 *
 * Rendered content is IMMUTABLE once published. "Editing" an item means
 * publishing a new version (version + 1) and retiring the old one, so an
 * event that linked v1 never changes in the middle of the party.
 *
 * MIRRORED — supabase/functions/admin-api/library.ts carries a hand copy of
 * everything the edge function needs (Deno cannot import from src/).
 * libraryPublish.test.ts runs the SAME fixture suite against both copies and
 * asserts the vocabularies are equal, so a one-sided change goes red.
 */
import { publicObjectPath } from './mediaUrl';

/** Storage prefix inside the public `assets` bucket. */
export const LIBRARY_PREFIX = '_platform/library';
export const ASSETS_BUCKET_NAME = 'assets';

/** = create-event's EVENT_TYPES (supabase/functions/create-event/index.ts);
 *  pinned by a test that reads that file. */
export const LIBRARY_OCCASIONS = ['wedding', 'gala', 'birthday', 'corporate', 'party', 'remote'] as const;
/** Hue families, not hex values: a theme colour is matched to a family. */
export const LIBRARY_COLORS = [
  'red', 'orange', 'yellow', 'gold', 'green', 'teal', 'blue', 'purple', 'pink',
  'neutral', 'black', 'white', 'silver',
] as const;
export const LIBRARY_STYLES = ['elegant', 'playful', 'neon', 'minimal', 'retro', 'floral'] as const;

export const LIBRARY_NAME_MAX = 80;

export interface LibraryTags {
  occasions: string[];
  colors: string[];
  styles: string[];
}

/** `config.library` on a global row. The host picker (libraryMatch.ts) reads
 *  `tags` and filters on `listed !== false`. */
export interface LibraryMeta {
  version: number;
  sourceExperienceId: string;
  publishedAt: string;
  publishedBy: string;
  listed: boolean;
  tags: LibraryTags;
  /** The version chain this row belongs to: every version of one piece shares
   *  it, whichever scene each was published from (a Studio workshop copy, the
   *  original host scene, a bulk import). Absent on rows published before
   *  lineage existed — always read it through lineageOf(), never directly. */
  lineageId?: string;
}

export type LibraryState = 'listed' | 'retired' | 'withdrawn';
export const LIBRARY_STATES: readonly LibraryState[] = ['listed', 'retired', 'withdrawn'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function emptyLibraryTags(): LibraryTags {
  return { occasions: [], colors: [], styles: [] };
}

const TAG_GROUPS: ReadonlyArray<[keyof LibraryTags, readonly string[]]> = [
  ['occasions', LIBRARY_OCCASIONS],
  ['colors', LIBRARY_COLORS],
  ['styles', LIBRARY_STYLES],
];

/**
 * Normalise a tags payload: lower-cased, trimmed, de-duplicated, in
 * VOCABULARY order (so the same choice always serialises the same way).
 * Anything outside the vocabulary is reported in `invalid` as `group:value`
 * rather than silently dropped — the server rejects a payload with any.
 * A missing or malformed group is an empty group, not an error.
 */
export function normalizeLibraryTags(raw: unknown): { tags: LibraryTags; invalid: string[] } {
  const tags = emptyLibraryTags();
  const invalid: string[] = [];
  const src = isRecord(raw) ? raw : {};
  for (const [group, vocab] of TAG_GROUPS) {
    const list = Array.isArray(src[group]) ? (src[group] as unknown[]) : [];
    const picked = new Set<string>();
    for (const item of list) {
      if (typeof item !== 'string') { invalid.push(`${group}:${String(item)}`); continue; }
      const v = item.trim().toLowerCase();
      if (v === '') continue;
      if (vocab.includes(v)) picked.add(v);
      else invalid.push(`${group}:${v}`);
    }
    tags[group] = vocab.filter((v) => picked.has(v));
  }
  return { tags, invalid };
}

/** Trimmed, whitespace-collapsed name, or null when empty / too long. */
export function normalizeLibraryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '' || name.length > LIBRARY_NAME_MAX) return null;
  return name;
}

/** Total read of `config.library` — null when absent or not an object. */
export function readLibraryMeta(config: unknown): LibraryMeta | null {
  if (!isRecord(config) || !isRecord(config.library)) return null;
  const lib = config.library;
  const version = typeof lib.version === 'number' && Number.isInteger(lib.version) && lib.version >= 1
    ? lib.version : 1;
  return {
    version,
    sourceExperienceId: typeof lib.sourceExperienceId === 'string' ? lib.sourceExperienceId : '',
    publishedAt: typeof lib.publishedAt === 'string' ? lib.publishedAt : '',
    publishedBy: typeof lib.publishedBy === 'string' ? lib.publishedBy : '',
    // Same reading as the host picker: only an explicit `false` unlists.
    listed: lib.listed !== false,
    tags: normalizeLibraryTags(lib.tags).tags,
    // Only a well-formed uuid: the value is matched in a PostgREST filter.
    ...(isUuid(lib.lineageId) ? { lineageId: lib.lineageId } : {}),
  };
}

/**
 * The version chain a library row belongs to. Rows written before lineage
 * existed fall back to the scene they were published from, and a row with
 * neither (a bulk import) is the root of its own chain. Always a uuid, so it is
 * safe to put in a filter.
 */
export function lineageOf(row: { id: string; config: unknown }): string {
  const lib: Record<string, unknown> = isRecord(row.config) && isRecord(row.config.library) ? row.config.library : {};
  if (isUuid(lib.lineageId)) return lib.lineageId;
  if (isUuid(lib.sourceExperienceId)) return lib.sourceExperienceId;
  return row.id;
}

/**
 * The lifecycle state of a global row.
 *  - withdrawn: `is_published = false` — RLS (experiences_public_read) hides it
 *    from everyone, including events that linked it. For takedowns.
 *  - retired:   published, `config.library.listed === false` — hosts can no
 *    longer pick it, but events that already linked it keep it.
 *  - listed:    published and pickable.
 */
export function libraryStateOf(row: { is_published: boolean; config: unknown }): LibraryState {
  if (row.is_published !== true) return 'withdrawn';
  return readLibraryMeta(row.config)?.listed === false ? 'retired' : 'listed';
}

export type StateChangeTarget = LibraryState | 'deleted';

export type StateChangePlan =
  | { ok: true; action: 'update'; isPublished: boolean; listed: boolean }
  | { ok: true; action: 'delete' }
  | { ok: false; reason: 'invalid_state' | 'same_state' | 'has_links' | 'unlist_first' };

/**
 * Every allowed transition. Any state may move to any other state; hard
 * delete is allowed only for an item that is already out of the picker
 * (retired or withdrawn) AND that no event links — event_catalog_links
 * cascades on delete, so deleting a linked item would silently strip it out
 * of a live event.
 */
export function planStateChange(from: LibraryState, to: unknown, linkCount: number): StateChangePlan {
  if (to === 'deleted') {
    if (from === 'listed') return { ok: false, reason: 'unlist_first' };
    if (!(Number.isFinite(linkCount) && linkCount === 0)) return { ok: false, reason: 'has_links' };
    return { ok: true, action: 'delete' };
  }
  if (to !== 'listed' && to !== 'retired' && to !== 'withdrawn') return { ok: false, reason: 'invalid_state' };
  if (to === from) return { ok: false, reason: 'same_state' };
  if (to === 'withdrawn') return { ok: true, action: 'update', isPublished: false, listed: false };
  return { ok: true, action: 'update', isPublished: true, listed: to === 'listed' };
}

/**
 * Must this item carry a thumbnail before it can be published? A 3D or
 * layered scene has no flat image the picker could fall back to (a 2D frame
 * or filter IS its asset), so a tile without a thumbnail is a blank square.
 */
export function needsThumbnail(row: { kind: string; config: unknown }): boolean {
  if (row.kind === '3d_attachment' || row.kind === 'composite') return true;
  return isRecord(row.config) && Array.isArray(row.config.layers) && row.config.layers.length > 0;
}

/** Copy of `config` without its `library` block (never mutates the input).
 *  Use when a library item is duplicated INTO a host event: the copy is the
 *  host's own scene, not a library item, and must not claim provenance. */
export function stripLibraryMeta<T>(config: T): T {
  if (!isRecord(config) || !('library' in config)) return config;
  const { library: _drop, ...rest } = config;
  void _drop;
  return rest as T;
}

/* ── Media: collect → plan → rewrite ─────────────────────────────────── */

const MAX_DEPTH = 32;

/** The assets-bucket object key for a public URL at `origin`, or null.
 *  Same three rules as mediaUrl.publicObjectPath (literal-prefix origin,
 *  query/fragment dropped, never percent-decoded, no traversal). */
export function assetKey(url: unknown, origin: string): string | null {
  return typeof url === 'string' ? publicObjectPath(url, ASSETS_BUCKET_NAME, origin) : null;
}

function walkStrings(value: unknown, visit: (s: string) => void, depth: number): void {
  if (depth > MAX_DEPTH) return;
  if (typeof value === 'string') { visit(value); return; }
  if (Array.isArray(value)) { for (const v of value) walkStrings(v, visit, depth + 1); return; }
  if (isRecord(value)) for (const v of Object.values(value)) walkStrings(v, visit, depth + 1);
}

/**
 * Every distinct assets-bucket object key referenced by the row: its
 * `asset_url`, its `thumbnail_url`, and any string anywhere inside `config`
 * (except `config.library`, which is ours). First-seen order.
 * Strings that are not public assets URLs at `origin` (data: URLs, built-in
 * ids, other origins) are left alone — they need no copy.
 */
export function collectAssetKeys(
  row: { asset_url: string | null; thumbnail_url: string | null; config: unknown },
  origin: string,
): string[] {
  const seen = new Set<string>();
  const visit = (s: string) => {
    const key = assetKey(s, origin);
    if (key !== null) seen.add(key);
  };
  if (typeof row.asset_url === 'string') visit(row.asset_url);
  if (typeof row.thumbnail_url === 'string') visit(row.thumbnail_url);
  walkStrings(stripLibraryMeta(row.config), visit, 0);
  return [...seen];
}

function safeBasename(key: string): string {
  const last = key.split('/').pop() ?? '';
  const cleaned = last.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned === '' ? 'file' : cleaned.slice(-120);
}

/** One copy per key, into `_platform/library/<newId>/`. Two sources with the
 *  same basename get an index prefix so neither overwrites the other. */
export function planLibraryCopies(keys: string[], newId: string): Array<{ from: string; to: string }> {
  const used = new Set<string>();
  return keys.map((from, i) => {
    let base = safeBasename(from);
    if (used.has(base)) base = `${i}-${base}`;
    used.add(base);
    return { from, to: `${LIBRARY_PREFIX}/${newId}/${base}` };
  });
}

/** The public URL for an assets key at `origin`. */
export function assetPublicUrl(key: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/storage/v1/object/public/${ASSETS_BUCKET_NAME}/${key}`;
}

/**
 * Deep copy of `value` where every string that is a public assets URL whose
 * key is in `mapping` (from → to) becomes the new public URL. Anything else
 * is copied unchanged. Never mutates the input.
 */
export function rewriteAssetUrls<T>(value: T, origin: string, mapping: ReadonlyMap<string, string>): T {
  const go = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) return v;
    if (typeof v === 'string') {
      const key = assetKey(v, origin);
      const to = key === null ? undefined : mapping.get(key);
      return to === undefined ? v : assetPublicUrl(to, origin);
    }
    if (Array.isArray(v)) return v.map((x) => go(x, depth + 1));
    if (isRecord(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = go(x, depth + 1);
      return out;
    }
    return v;
  };
  return go(value, 0) as T;
}

export interface LibrarySourceRow {
  kind: string;
  asset_url: string | null;
  thumbnail_url: string | null;
  config: unknown;
  source?: string | null;
  featured?: boolean | null;
}

/**
 * The global row to INSERT for a publish. Rendering fields come from the
 * source (URLs rewritten to the copies); tenancy fields are forced global.
 */
export function buildLibraryRow(
  source: LibrarySourceRow,
  opts: {
    newId: string;
    name: string;
    tags: LibraryTags;
    listed: boolean;
    version: number;
    sourceExperienceId: string;
    /** The chain this version joins (lineageOf the previous version, or the
     *  source scene for a first publish). Omitted = no lineage key written. */
    lineageId?: string;
    publishedBy: string;
    publishedAt: string;
    origin: string;
    mapping: ReadonlyMap<string, string>;
  },
): Record<string, unknown> {
  const rendering = rewriteAssetUrls(stripLibraryMeta(isRecord(source.config) ? source.config : {}), opts.origin, opts.mapping);
  const library: LibraryMeta = {
    version: opts.version,
    sourceExperienceId: opts.sourceExperienceId,
    publishedAt: opts.publishedAt,
    publishedBy: opts.publishedBy,
    listed: opts.listed,
    tags: opts.tags,
    ...(isUuid(opts.lineageId) ? { lineageId: opts.lineageId } : {}),
  };
  return {
    id: opts.newId,
    name: opts.name,
    kind: source.kind,
    asset_url: rewriteAssetUrls(source.asset_url, opts.origin, opts.mapping),
    thumbnail_url: rewriteAssetUrls(source.thumbnail_url, opts.origin, opts.mapping),
    config: { ...(rendering as Record<string, unknown>), library },
    source: typeof source.source === 'string' ? source.source : 'upload',
    is_global: true,
    // EXPLICIT null is load-bearing: the live column DEFAULTS to 'hope-gala'
    // (a single-tenant leftover), so omitting it would file the item under a
    // legacy event instead of the shared library.
    event_id: null,
    org_id: null,
    is_published: true,
    featured: false,
    sort_order: 0,
  };
}

/** `config` with `patch` merged into its `library` block — and NOTHING else
 *  touched, so a metadata edit can never change what a guest sees. */
export function patchLibraryMeta(config: unknown, patch: Partial<LibraryMeta>): Record<string, unknown> {
  const cfg = isRecord(config) ? config : {};
  const lib = isRecord(cfg.library) ? cfg.library : {};
  return { ...cfg, library: { ...lib, ...patch } };
}

/** Next version for a source: one past the highest existing version. */
export function nextLibraryVersion(existingConfigs: unknown[]): number {
  let max = 0;
  for (const c of existingConfigs) {
    const meta = readLibraryMeta(c);
    if (meta && meta.version > max) max = meta.version;
  }
  return max + 1;
}

/* ── Client-only copy (not mirrored: the server never shows it) ──────── */

/** What each state change does, in an operator's plain words. */
export const STATE_CONSEQUENCE: Record<StateChangeTarget, string> = {
  listed: 'Hosts can pick it from the library again.',
  retired: 'Hosts can no longer pick it. Events that already use it keep it, unchanged.',
  withdrawn: 'It disappears everywhere right now, including from events that already use it — even mid-event. Use this for takedowns.',
  deleted: 'The library row is removed for good. Its copied files stay in storage, because a host who duplicated it into their own event may still point at them.',
};

export const STATE_ACTION_LABEL: Record<StateChangeTarget, string> = {
  listed: 'Relist',
  retired: 'Retire',
  withdrawn: 'Withdraw',
  deleted: 'Delete',
};

export const TAG_GROUP_LABEL: Record<keyof LibraryTags, string> = {
  occasions: 'Occasions',
  colors: 'Colours',
  styles: 'Styles',
};

export const LIBRARY_TAG_GROUPS = TAG_GROUPS;

/** Plain words for an experience kind (the owner's vocabulary: Frames,
 *  Filters, 3D props — never "shader" / "GLB" / "experience"). */
export const LIBRARY_KIND_LABEL: Record<string, string> = {
  border: 'Frame',
  '2d_filter': 'Sticker',
  shader: 'Filter',
  '3d_attachment': '3D prop',
  composite: 'Scene',
};
