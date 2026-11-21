/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bulk 3D import into the shared library (/admin/library/import) — the pure,
 * browser-side half. The vocabulary, caps, storage layout and classification
 * contract come from supabase/functions/admin-api/libraryImport.ts, which the
 * server runs too, so there is exactly one copy of each (no hand mirror).
 *
 * What lives HERE is what only the browser can do: read a dropped file's
 * header, turn a category + measured size into a Studio-shaped rendering config
 * (through the Studio's own draftToPayload, so an imported prop is
 * byte-for-byte what the Studio would have saved), and phrase warnings.
 * No DOM, no three.js, no supabase import — vitest runs it in node.
 */
import { createObject3D, initialDraft } from './studio/state';
import { draftToPayload } from './studio/draftMapping';
import { PROP_SCALE_MAX } from './studio/bustFit';
import {
  IMPORT_MAX_BYTES,
  IMPORT_WARN_BYTES,
  IMPORT_WARN_TRIANGLES,
  importCategory,
  type Classification,
  type ImportMeta,
} from '../../supabase/functions/admin-api/libraryImport.ts';
import { LIBRARY_NAME_MAX, type LibraryTags } from '../../supabase/functions/admin-api/library.ts';
import type { HeadAnchor } from '../types';

export {
  CLASSIFY_BATCH_MAX,
  DEFAULT_IMPORT_CATEGORY,
  IMPORT_BATCH_MAX,
  IMPORT_CATEGORIES,
  IMPORT_MAX_BYTES,
  IMPORT_WARN_BYTES,
  IMPORT_WARN_TRIANGLES,
  draftModelKey,
  draftOptimizedModelKey,
  draftThumbKey,
  importCategory,
  normalizeImportMeta,
  type Classification,
  type ImportCategory,
  type ImportMeta,
} from '../../supabase/functions/admin-api/libraryImport.ts';

/* ── File checks ────────────────────────────────────────────────────────── */

/** Both arms carry `reason` so callers narrow under the repo's non-strict tsconfig. */
export type FileCheck = { ok: true; reason?: undefined } | { ok: false; reason: string };

/**
 * Cheap checks before a byte is uploaded: extension, size, and the 12-byte
 * GLB header (magic "glTF", container version 2, declared length = file size).
 * A renamed .obj or a truncated download fails HERE with a sentence, instead
 * of as a GLTFLoader stack trace after a 40 MB upload. `maxBytes` is raised
 * only when the file will be optimized before upload (the RESULT must still
 * fit IMPORT_MAX_BYTES — the caller checks that).
 */
export function checkGlbFile(name: string, size: number, header: Uint8Array, maxBytes: number = IMPORT_MAX_BYTES): FileCheck {
  if (!/\.glb$/i.test(name)) {
    return /\.gltf$/i.test(name)
      ? { ok: false, reason: 'A .gltf file keeps its textures in separate files. Export it as a single .glb.' }
      : { ok: false, reason: 'Only .glb 3D models can be imported.' };
  }
  if (!(size > 0)) return { ok: false, reason: 'The file is empty.' };
  if (size > maxBytes) {
    return { ok: false, reason: `It is ${formatBytes(size)}; the limit is ${formatBytes(maxBytes)}. Compress it (Draco) and try again.` };
  }
  if (header.length < 12) return { ok: false, reason: 'The file is too short to be a 3D model.' };
  const magic = String.fromCharCode(header[0], header[1], header[2], header[3]);
  if (magic !== 'glTF') return { ok: false, reason: 'This is not a real .glb file (it may have been renamed).' };
  const view = new DataView(header.buffer, header.byteOffset, 12);
  const version = view.getUint32(4, true);
  if (version !== 2) return { ok: false, reason: `This is a glTF version ${version} file; only version 2 is supported.` };
  const declared = view.getUint32(8, true);
  if (declared !== size) return { ok: false, reason: 'The file looks cut off (its size does not match its header). Download it again.' };
  return { ok: true };
}

/** "gold_crown-v2 (1).glb" → "Gold crown v2". Never empty, never over the cap. */
export function nameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/\(\d+\)/g, ' ').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = base ? base.charAt(0).toUpperCase() + base.slice(1) : '3D prop';
  return name.slice(0, LIBRARY_NAME_MAX).trim();
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Plain-words warnings for the review card. Never blocks a publish. */
export function importWarnings(meta: Pick<ImportMeta, 'bytes' | 'triangles' | 'maxDim'>): string[] {
  const out: string[] = [];
  if (meta.bytes > IMPORT_WARN_BYTES) out.push(`Heavy file (${formatBytes(meta.bytes)}) — guests on slow wifi wait for it.`);
  if (meta.triangles > IMPORT_WARN_TRIANGLES) {
    out.push(`${Math.round(meta.triangles / 1000)}k triangles — may stutter on older phones.`);
  }
  if (!(meta.maxDim > 0)) out.push('Its size could not be measured, so it starts at a default size.');
  return out;
}

/* ── Rendering config ───────────────────────────────────────────────────── */

/** = bustFit's PROP_SCALE_MIN (not exported there); MAX is imported. Both
 *  mirror the booth's decompose clamp (faceRig.ts). */
const FIT_SCALE_MIN = 0.05;

/**
 * Scale that puts the model's largest dimension at its category's target size
 * (head-space centimetres), clamped like the Studio's auto-fit. An unmeasurable
 * model gets the target as-is — the Studio's own fallback for a ~1-unit model
 * (copilot.applyGeneratedPiece), never scale 1, which renders a ~1cm speck.
 */
export function fitScaleFor(categoryId: string, maxDim: number): number {
  const target = importCategory(categoryId).targetCm;
  if (!(Number.isFinite(maxDim) && maxDim > 0)) return target;
  return Math.min(PROP_SCALE_MAX, Math.max(FIT_SCALE_MIN, target / maxDim));
}

/**
 * The row's rendering `config` for one imported GLB, built by the Studio's own
 * draftToPayload from a one-object draft. Stamped anchorVersion 2 like every
 * other library add (faceRig ANCHOR_PRESETS_V2), which also forces the
 * `config.layers` path that a hand anchor needs anyway.
 */
export function buildDraftRenderConfig(args: {
  assetUrl: string;
  name: string;
  categoryId: string;
  maxDim: number;
}): Record<string, unknown> {
  const cat = importCategory(args.categoryId);
  const draft = initialDraft('3d_attachment');
  const obj = createObject3D('model', {
    assetUrl: args.assetUrl,
    name: args.name,
    anchor: cat.anchor as HeadAnchor,
    anchorConfig: {
      offset: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: fitScaleFor(cat.id, args.maxDim),
    },
    ...(cat.handAnchor ? { handAnchor: cat.handAnchor } : {}),
    anchorVersion: 2,
  });
  const payload = draftToPayload(
    { ...draft, name: args.name, objects: [obj] },
    new Map([[obj.id, args.assetUrl]]),
    null,
  );
  return payload.config as Record<string, unknown>;
}

/* ── Review ─────────────────────────────────────────────────────────────── */

/** Below this the AI's category guess gets a "Needs a look" badge. */
export const NEEDS_REVIEW_CONFIDENCE = 0.6;

/** True until a person has confirmed it, or the AI was confident. */
export function needsReview(meta: Pick<ImportMeta, 'classifiedBy' | 'confidence'>): boolean {
  if (meta.classifiedBy === 'human') return false;
  if (meta.classifiedBy === 'none') return true;
  return !(typeof meta.confidence === 'number' && meta.confidence >= NEEDS_REVIEW_CONFIDENCE);
}

/**
 * The draft edit an AI suggestion turns into. A name or category a PERSON
 * already set is never overwritten (classifiedBy 'human' keeps both, and only
 * a still-default name is replaced) — re-running the AI on a reviewed batch
 * must not undo the review. Tags always come from the suggestion unless a
 * person reviewed the item.
 */
export function applyClassification(
  draft: { name: string; assetUrl: string; tags: LibraryTags; importMeta: ImportMeta },
  c: Classification,
): { name: string; tags: LibraryTags; importMeta: ImportMeta; config: Record<string, unknown> | null } {
  const human = draft.importMeta.classifiedBy === 'human';
  const nameIsDefault = draft.name === nameFromFileName(draft.importMeta.fileName);
  const name = !human && nameIsDefault && c.name ? c.name : draft.name;
  const category = human ? draft.importMeta.category : c.category;
  const importMeta: ImportMeta = {
    ...draft.importMeta,
    category,
    classifiedBy: human ? 'human' : 'ai',
    confidence: c.confidence,
    ...(c.note ? { note: c.note } : {}),
  };
  const categoryChanged = category !== draft.importMeta.category;
  return {
    name,
    tags: human ? draft.tags : c.tags,
    importMeta,
    config: categoryChanged || name !== draft.name
      ? buildDraftRenderConfig({ assetUrl: draft.assetUrl, name, categoryId: category, maxDim: draft.importMeta.maxDim })
      : null,
  };
}
