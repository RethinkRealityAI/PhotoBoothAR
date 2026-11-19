/**
 * admin-api/libraryImport.ts — the pure half of BULK 3D IMPORT into the shared
 * library (/admin/library/import).
 *
 * SINGLE SOURCE, NOT A MIRROR. The browser imports this file directly
 * (src/lib/libraryImport.ts re-exports it — the agentEvals/harness.ts precedent
 * for reaching into a function dir from src), so the category list, the size
 * caps, the storage layout and the classification contract cannot drift
 * between the screen that uploads and the function that writes. Runtime-free
 * on purpose: no Deno globals, no jsr:/npm: imports, so vitest runs it too.
 *
 * THE DRAFT STATE. A bulk-imported model becomes a global `experiences` row
 * with `is_published = false` and `config.library.draft = true`. RLS
 * (experiences_public_read: `is_global and is_published`) already hides it
 * from every host and guest, so a half-labelled model can never reach a booth,
 * and no migration is needed. `list_library_items` leaves drafts out (they
 * belong to the import screen); `publish_library_drafts` is the only way out
 * of the state.
 *
 * DEPLOY NOTE: admin-api now deploys as FOUR files (index.ts, library.ts,
 * libraryImport.ts, deno.json). A deploy missing a sibling is an import error
 * at boot, i.e. EVERY admin-api request 500s.
 */
import {
  LIBRARY_COLORS,
  LIBRARY_OCCASIONS,
  LIBRARY_PREFIX,
  LIBRARY_STYLES,
  assetKey,
  isUuid,
  normalizeLibraryName,
  normalizeLibraryTags,
  type LibraryTags,
} from './library.ts';

/* ── Categories ─────────────────────────────────────────────────────────── */

/**
 * What a 3D prop IS decides where it rides and how big it starts. `anchor` is
 * a HeadAnchor (src/types.ts); `handAnchor` (lib/handPose HAND_ANCHORS) makes
 * the piece ride the tracked hand instead. `targetCm` is the largest dimension
 * the auto-fit aims for — the Studio's generic PROP_TARGET_CM (24) suits a hat
 * and blows a pair of glasses up to a visor, so it is per category here.
 */
export interface ImportCategory {
  id: string;
  label: string;
  /** One line an operator reads when choosing. */
  hint: string;
  anchor: string;
  handAnchor?: string;
  targetCm: number;
}

export const IMPORT_CATEGORIES: readonly ImportCategory[] = [
  { id: 'headwear', label: 'Headwear', hint: 'Hats, crowns, tiaras, horns, halos', anchor: 'crown', targetCm: 24 },
  { id: 'eyewear', label: 'Eyewear', hint: 'Glasses, shades, goggles, visors', anchor: 'noseBridge', targetCm: 16 },
  { id: 'face', label: 'Face', hint: 'Masks, face shields, beards', anchor: 'noseBridge', targetCm: 19 },
  { id: 'mouth', label: 'Mouth', hint: 'Moustaches, pipes, lollipops', anchor: 'mouth', targetCm: 9 },
  { id: 'ears', label: 'Ears', hint: 'Earrings, ear cuffs, headphones', anchor: 'leftEar', targetCm: 5 },
  { id: 'held', label: 'Held in hand', hint: 'Wands, swords, glasses of bubbly, mics', anchor: 'crown', handAnchor: 'grip', targetCm: 26 },
  { id: 'wrist', label: 'Wrist', hint: 'Watches, cuffs, bracelets, gauntlets', anchor: 'crown', handAnchor: 'wristBack', targetCm: 11 },
  { id: 'other', label: 'Floating', hint: 'Anything that hovers above the head', anchor: 'crown', targetCm: 24 },
];

export const IMPORT_CATEGORY_IDS: readonly string[] = IMPORT_CATEGORIES.map((c) => c.id);
export const DEFAULT_IMPORT_CATEGORY = 'headwear';

export function importCategory(id: unknown): ImportCategory {
  return IMPORT_CATEGORIES.find((c) => c.id === id) ?? IMPORT_CATEGORIES.find((c) => c.id === DEFAULT_IMPORT_CATEGORY)!;
}

/* ── Limits ─────────────────────────────────────────────────────────────── */

/** = the live `assets` bucket file_size_limit (52428800). Bigger is refused by
 *  storage anyway; checking first spares the operator a 50 MB upload. */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
/** Above this a guest on venue wifi waits noticeably for the prop. Warn only. */
export const IMPORT_WARN_BYTES = 15 * 1024 * 1024;
/** Above this a mid-range phone drops frames with the face tracker running. Warn only. */
export const IMPORT_WARN_TRIANGLES = 150_000;
/** Rows one create/publish/discard call may touch. */
export const IMPORT_BATCH_MAX = 25;
/** Thumbnails one classify call sends to Gemini (≈1-2s each, sequential). */
export const CLASSIFY_BATCH_MAX = 6;
/** Draft rows the import screen lists. */
export const DRAFT_LIST_MAX = 200;
/** A draft's rendering config (one 3D layer) is a few hundred bytes. */
export const DRAFT_CONFIG_MAX_BYTES = 16 * 1024;

/* ── Storage layout ─────────────────────────────────────────────────────── */

/** `_platform/library/<id>/` — the SAME folder publish_library_item copies
 *  into, so set_library_item_state's delete sweep and every existing rule
 *  about library media apply unchanged. */
export function draftFolder(id: string): string {
  return `${LIBRARY_PREFIX}/${id}/`;
}
export function draftModelKey(id: string): string {
  return `${draftFolder(id)}model.glb`;
}
export function draftThumbKey(id: string): string {
  return `${draftFolder(id)}thumb.png`;
}

/* ── Import metadata (config.library.import) ────────────────────────────── */

export type ClassifiedBy = 'none' | 'ai' | 'human';

export interface ImportMeta {
  category: string;
  classifiedBy: ClassifiedBy;
  /** 0..1 from the model; absent until classified by AI. */
  confidence?: number;
  /** The model's one-line reason, shown to the reviewer. */
  note?: string;
  fileName: string;
  bytes: number;
  triangles: number;
  /** Largest bounding-box dimension in the file's own units (drives the fit). */
  maxDim: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finiteNonNeg(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Total read: anything malformed degrades to a safe default, never throws. */
export function normalizeImportMeta(raw: unknown): ImportMeta {
  const src = isRecord(raw) ? raw : {};
  const by = src.classifiedBy === 'ai' || src.classifiedBy === 'human' ? src.classifiedBy : 'none';
  const out: ImportMeta = {
    category: IMPORT_CATEGORY_IDS.includes(src.category as string) ? (src.category as string) : DEFAULT_IMPORT_CATEGORY,
    classifiedBy: by,
    fileName: cleanText(src.fileName, 120),
    bytes: Math.round(finiteNonNeg(src.bytes)),
    triangles: Math.round(finiteNonNeg(src.triangles)),
    maxDim: finiteNonNeg(src.maxDim),
  };
  if (typeof src.confidence === 'number' && Number.isFinite(src.confidence)) {
    out.confidence = Math.min(1, Math.max(0, src.confidence));
  }
  const note = cleanText(src.note, 240);
  if (note) out.note = note;
  return out;
}

/** True for a bulk-import draft row's config. Only an exact `true` counts. */
export function isDraftConfig(config: unknown): boolean {
  return isRecord(config) && isRecord(config.library) && config.library.draft === true;
}

/* ── Create ─────────────────────────────────────────────────────────────── */

export interface DraftCreateInput {
  id: string;
  name: string;
  assetUrl: string;
  thumbnailUrl: string;
  config: Record<string, unknown>;
  tags: LibraryTags;
  importMeta: ImportMeta;
}

/** Both arms carry both keys so callers narrow the same way under the repo's
 *  non-strict tsconfig (the browser imports this file) and Deno's strict one. */
export type DraftCheck<T> = { ok: true; value: T; error?: undefined } | { ok: false; error: string; value?: undefined };

/**
 * Validate one create payload. The model and thumbnail must be the exact keys
 * this file assigns under the row's OWN folder, so a draft can never point at
 * another tenant's media (or at a URL outside our bucket). The rendering config
 * is built in the browser by the Studio's own draftToPayload, so it is checked
 * for shape and size here rather than re-derived — a second copy of that
 * mapper is the drift this repo keeps paying for.
 */
export function checkDraftCreate(raw: unknown, origin: string): DraftCheck<DraftCreateInput> {
  if (!isRecord(raw)) return { ok: false, error: 'invalid_args' };
  const id = raw.id;
  if (!isUuid(id)) return { ok: false, error: 'invalid_args' };
  const name = normalizeLibraryName(raw.name);
  if (name === null) return { ok: false, error: 'invalid_name' };
  if (assetKey(raw.assetUrl, origin) !== draftModelKey(id)) return { ok: false, error: 'invalid_asset' };
  if (assetKey(raw.thumbnailUrl, origin) !== draftThumbKey(id)) return { ok: false, error: 'invalid_asset' };
  const checked = checkDraftConfig(raw.config, raw.assetUrl as string);
  if (!checked.ok) return { ok: false, error: checked.error as string };
  const { tags, invalid } = normalizeLibraryTags(raw.tags);
  if (invalid.length > 0) return { ok: false, error: 'invalid_tags' };
  return {
    ok: true,
    value: {
      id,
      name,
      assetUrl: raw.assetUrl as string,
      thumbnailUrl: raw.thumbnailUrl as string,
      config: checked.value as Record<string, unknown>,
      tags,
      importMeta: normalizeImportMeta(raw.importMeta),
    },
  };
}

/**
 * A draft's rendering config: one object, small, a single 3D layer whose asset
 * is the draft's own model. Any `library` key the browser sent is dropped —
 * the server owns that block.
 */
export function checkDraftConfig(raw: unknown, assetUrl: string): DraftCheck<Record<string, unknown>> {
  if (!isRecord(raw)) return { ok: false, error: 'invalid_config' };
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { return { ok: false, error: 'invalid_config' }; }
  if (size > DRAFT_CONFIG_MAX_BYTES) return { ok: false, error: 'invalid_config' };
  const { library: _drop, ...rest } = raw;
  void _drop;
  if (!isRecord(rest.anchor)) return { ok: false, error: 'invalid_config' };
  if (rest.layers !== undefined) {
    if (!Array.isArray(rest.layers) || rest.layers.length !== 1 || !isRecord(rest.layers[0])) {
      return { ok: false, error: 'invalid_config' };
    }
    const layer = rest.layers[0];
    if (layer.kind !== '3d_attachment' || layer.asset_url !== assetUrl) return { ok: false, error: 'invalid_config' };
  }
  return { ok: true, value: rest };
}

/** The `experiences` insert for a new draft. */
export function buildDraftRow(input: DraftCreateInput, actorUserId: string, now: string): Record<string, unknown> {
  return {
    id: input.id,
    name: input.name,
    kind: '3d_attachment',
    asset_url: input.assetUrl,
    thumbnail_url: input.thumbnailUrl,
    config: {
      ...input.config,
      library: {
        version: 1,
        sourceExperienceId: '',
        publishedAt: '',
        publishedBy: actorUserId,
        importedAt: now,
        listed: false,
        draft: true,
        tags: input.tags,
        import: input.importMeta,
      },
    },
    source: 'upload',
    is_global: true,
    // EXPLICIT null is load-bearing: the live column DEFAULTS to 'hope-gala'
    // (see buildLibraryRow in library.ts).
    event_id: null,
    org_id: null,
    is_published: false,
    featured: false,
    sort_order: 0,
  };
}

/* ── Update (review edits) ──────────────────────────────────────────────── */

/**
 * The config after a review edit: new rendering config (rebuilt in the browser
 * when the category — and so the anchor and fit — changed), tags and import
 * metadata, with every other `library` key kept. Never touches `draft`.
 */
export function patchDraftConfig(
  current: unknown,
  patch: { config?: Record<string, unknown>; tags?: LibraryTags; importMeta?: ImportMeta },
): Record<string, unknown> {
  const cur = isRecord(current) ? current : {};
  const lib = isRecord(cur.library) ? cur.library : {};
  const base = patch.config ?? (() => {
    const { library: _drop, ...rest } = cur;
    void _drop;
    return rest;
  })();
  return {
    ...base,
    library: {
      ...lib,
      ...(patch.tags ? { tags: patch.tags } : {}),
      ...(patch.importMeta ? { import: patch.importMeta } : {}),
      draft: true,
      listed: false,
    },
  };
}

/* ── Publish ────────────────────────────────────────────────────────────── */

/** What a draft still needs before hosts may pick it, or null when ready. */
export function draftPublishBlocker(row: Record<string, unknown>): string | null {
  if (normalizeLibraryName(row.name) === null) return 'invalid_name';
  if (typeof row.thumbnail_url !== 'string' || row.thumbnail_url === '') return 'thumbnail_required';
  if (typeof row.asset_url !== 'string' || row.asset_url === '') return 'invalid_asset';
  return null;
}

/** A draft's config as a LISTED library item: the draft flag goes, the
 *  provenance stamps arrive, and everything that renders is untouched. */
export function publishedDraftConfig(current: unknown, actorUserId: string, now: string): Record<string, unknown> {
  const cur = isRecord(current) ? current : {};
  const lib = isRecord(cur.library) ? { ...cur.library } : {};
  delete lib.draft;
  return {
    ...cur,
    library: { ...lib, listed: true, publishedAt: now, publishedBy: actorUserId },
  };
}

/* ── AI classification (Gemini, one thumbnail per call) ─────────────────── */

export const CLASSIFY_SYSTEM_PROMPT = [
  'You label 3D props for an AR photo booth library. Guests wear or hold these props in a selfie camera.',
  'You see ONE rendered thumbnail of ONE model on a transparent background, and its original file name.',
  'The file name is a HINT only — it may be meaningless (e.g. "model_final2"). Trust the picture.',
  '',
  'Return:',
  '- name: a short, friendly product name a party host would recognise, Title Case, 2-4 words, no file extensions, no brand names.',
  `- category: exactly one of ${IMPORT_CATEGORIES.map((c) => `"${c.id}" (${c.hint})`).join(', ')}.`,
  `- occasions: comma-separated, zero or more of ${LIBRARY_OCCASIONS.join(', ')}. Only occasions the prop clearly suits; "party" for general fun props.`,
  `- colors: comma-separated, one to three of ${LIBRARY_COLORS.join(', ')} — the dominant visible colours.`,
  `- styles: comma-separated, zero to two of ${LIBRARY_STYLES.join(', ')}.`,
  '- confidence: 0 to 1, how sure you are of the CATEGORY.',
  '- note: one short sentence describing what you see, for the human reviewer.',
  '',
  'Never invent vocabulary outside these lists. If the thumbnail is blank or unreadable, say so in note and set confidence below 0.3.',
].join('\n');

/** STRING fields only for the lists — an ARRAY-of-OBJECT response schema hangs
 *  gemini-2.5-flash (CLAUDE.md), and comma lists keep the schema flat. */
export const CLASSIFY_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    category: { type: 'STRING', enum: [...IMPORT_CATEGORY_IDS] },
    occasions: { type: 'STRING' },
    colors: { type: 'STRING' },
    styles: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
    note: { type: 'STRING' },
  },
  required: ['name', 'category', 'occasions', 'colors', 'styles', 'confidence', 'note'],
} as const;

export interface Classification {
  name: string | null;
  category: string;
  tags: LibraryTags;
  confidence: number;
  note: string;
}

function commaList(v: unknown, vocab: readonly string[], max: number): string[] {
  if (typeof v !== 'string') return [];
  const picked = new Set(
    v.split(/[,;/]+/).map((s) => s.trim().toLowerCase()).filter((s) => vocab.includes(s)),
  );
  return vocab.filter((s) => picked.has(s)).slice(0, max);
}

/**
 * Total parse of the model's JSON. Out-of-vocabulary values are DROPPED here
 * (unlike operator input, which the server rejects): a model that says
 * "burgundy" should still hand back its valid picks, and the reviewer sees
 * the result before anything is published.
 */
export function normalizeClassification(raw: unknown): Classification {
  const src = isRecord(raw) ? raw : {};
  const name = normalizeLibraryName(
    typeof src.name === 'string' ? src.name.replace(/\.(glb|gltf)$/i, '') : src.name,
  );
  const confidence = typeof src.confidence === 'number' && Number.isFinite(src.confidence)
    ? Math.min(1, Math.max(0, src.confidence)) : 0;
  return {
    name,
    category: IMPORT_CATEGORY_IDS.includes(src.category as string) ? (src.category as string) : 'other',
    tags: {
      occasions: commaList(src.occasions, LIBRARY_OCCASIONS, LIBRARY_OCCASIONS.length),
      colors: commaList(src.colors, LIBRARY_COLORS, 3),
      styles: commaList(src.styles, LIBRARY_STYLES, 2),
    },
    confidence,
    note: cleanText(src.note, 240),
  };
}
