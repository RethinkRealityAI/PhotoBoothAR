/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bulk 3D import — the browser-only half (WebGL thumbnail, three.js measure,
 * storage upload). Never import this from a vitest file: it reaches
 * lib/supabase.ts and three's WebGLRenderer. The rules it applies live in the
 * pure lib/libraryImport.ts.
 */
import * as THREE from 'three';
import { supabase, ASSETS_BUCKET, publicUrl } from './supabase';
import { captureGlbThumbnail } from './studio/glbThumb';
import { evictModel, loadModel } from './glbCache';
import { describeGlbError } from './glbErrors';
import {
  DEFAULT_IMPORT_CATEGORY,
  IMPORT_MAX_BYTES,
  buildDraftRenderConfig,
  checkGlbFile,
  draftModelKey,
  draftOptimizedModelKey,
  draftThumbKey,
  formatBytes,
  type ImportMeta,
} from './libraryImport';
import {
  createLibraryDrafts,
  discardLibraryDrafts,
  libraryErrorText,
  replaceLibraryItemModel,
  type ReplaceModelResult,
} from './adminLibrary';
import { normalizeLibraryName } from './libraryPublish';
import { OPTIMIZE_INPUT_MAX_BYTES, worthKeeping, type OptimizeOptions, type OptimizeStats } from './glbOptimizePlan';
import type { OptimizeResult } from './glbOptimize';
import { STALE_APP_MESSAGE, isStaleChunkError } from './staleChunk';

export interface PreparedModel {
  id: string;
  file: File;
  thumb: Blob;
  /** Object URL of `thumb` for the review card until the server copy loads. */
  thumbPreviewUrl: string;
  triangles: number;
  maxDim: number;
  /** Set when the upload is an optimized copy: what the operator dropped. */
  original?: { bytes: number; triangles: number };
  /** Why "Optimize on upload" left this file as it was, for the queue line. */
  optimizeNote?: string;
}

export type PrepareResult = { ok: true; model: PreparedModel; reason?: undefined } | { ok: false; reason: string; model?: undefined };

/** Thumbnail edge in px — big enough for the AI to read, small enough (~100 KB). */
const THUMB_SIZE = 512;

function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry;
    const n = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
    tris += Math.floor(n / 3);
  });
  return tris;
}

/** The optimizer, loaded on first use only — never part of any other bundle. */
export async function runOptimizer(bytes: Uint8Array, opts: OptimizeOptions): Promise<OptimizeResult> {
  let optimizeGlb: typeof import('./glbOptimize').optimizeGlb;
  try {
    ({ optimizeGlb } = await import('./glbOptimize'));
  } catch (e) {
    console.error('[libraryImport] optimizer failed to load', e);
    // The usual cause: this tab predates a deploy, and the old chunk is gone.
    if (isStaleChunkError(e)) return { ok: false, stale: true, reason: STALE_APP_MESSAGE };
    return { ok: false, reason: 'The optimizer could not be loaded. Check the connection and try again.' };
  }
  try {
    return await optimizeGlb(bytes, opts);
  } catch (e) {
    // optimizeGlb reports its own failures; this is only a last resort.
    console.error('[libraryImport] optimizer crashed', e);
    return { ok: false, reason: 'The optimizer stopped unexpectedly on this model. The original is unchanged.' };
  }
}

/** Does three.js (the booth's own loader) open these bytes? Never throws. */
async function loadsInBooth(bytes: Uint8Array): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }));
  try {
    await loadModel(url);
    return true;
  } catch (e) {
    console.error('[libraryImport] optimized copy does not load', e);
    return false;
  } finally {
    evictModel(url);
    URL.revokeObjectURL(url);
  }
}

/**
 * "Optimize on upload": the optimized copy replaces the dropped file only
 * when it is a real saving, fits the bucket, and loads through the booth's
 * own loader; otherwise the original goes up and `note` says why.
 */
async function optimizeForUpload(
  file: File,
  opts: OptimizeOptions,
): Promise<{ file: File; stats: OptimizeStats | null; note?: string; error?: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await runOptimizer(bytes, opts);
  const tooBig = file.size > IMPORT_MAX_BYTES;
  if (!r.ok) {
    return tooBig ? { file, stats: null, error: r.reason } : { file, stats: null, note: `Uploaded as-is: ${r.reason}` };
  }
  if (!worthKeeping(r.stats)) {
    if (tooBig) return { file, stats: null, error: `Optimized it is still ${formatBytes(r.stats.bytesAfter)}; the limit is ${formatBytes(IMPORT_MAX_BYTES)}.` };
    return { file, stats: null, note: 'Already lean — uploaded as-is.' };
  }
  if (!(await loadsInBooth(r.bytes))) {
    return tooBig
      ? { file, stats: null, error: 'The optimized copy did not load, and the original is over the size limit.' }
      : { file, stats: null, note: 'Uploaded as-is: the optimized copy did not load.' };
  }
  return { file: new File([r.bytes as BlobPart], file.name, { type: 'model/gltf-binary' }), stats: r.stats };
}

/**
 * Check, parse, measure and thumbnail ONE dropped file — all locally, before a
 * byte is uploaded. Never throws. The parsed model goes through the shared
 * glbCache (so captureGlbThumbnail and the measure share one parse) and is
 * evicted at the end: an import of 40 models must not keep 40 parsed meshes in
 * memory for the rest of the session. With `optimize`, the file is shrunk
 * first (and may then start above IMPORT_MAX_BYTES), and everything after —
 * measure, thumbnail, upload — uses the optimized copy.
 */
export async function prepareModel(dropped: File, optimize: OptimizeOptions | null = null): Promise<PrepareResult> {
  const header = new Uint8Array(await dropped.slice(0, 12).arrayBuffer().catch(() => new ArrayBuffer(0)));
  const check = checkGlbFile(dropped.name, dropped.size, header, optimize ? OPTIMIZE_INPUT_MAX_BYTES : IMPORT_MAX_BYTES);
  if (!check.ok) return { ok: false, reason: check.reason as string };

  let file = dropped;
  let original: PreparedModel['original'];
  let optimizeNote: string | undefined;
  if (optimize) {
    const o = await optimizeForUpload(dropped, optimize);
    if (o.error !== undefined) return { ok: false, reason: o.error };
    file = o.file;
    optimizeNote = o.note;
    if (o.stats) original = { bytes: o.stats.bytesBefore, triangles: o.stats.trianglesBefore };
  }

  const url = URL.createObjectURL(file);
  try {
    let root: THREE.Group;
    try {
      root = await loadModel(url);
    } catch (e) {
      return { ok: false, reason: describeGlbError(e).message };
    }
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const triangles = countTriangles(root);
    if (triangles === 0) return { ok: false, reason: 'The file has no visible geometry.' };
    const thumb = await captureGlbThumbnail(url, THUMB_SIZE);
    if (!thumb) return { ok: false, reason: 'The model loaded but could not be drawn (no WebGL, or an empty scene).' };
    return {
      ok: true,
      model: {
        id: crypto.randomUUID(),
        file,
        thumb,
        thumbPreviewUrl: URL.createObjectURL(thumb),
        triangles,
        maxDim: Number.isFinite(maxDim) ? maxDim : 0,
        ...(original ? { original } : {}),
        ...(optimizeNote ? { optimizeNote } : {}),
      },
    };
  } finally {
    evictModel(url);
    URL.revokeObjectURL(url);
  }
}

/**
 * Upload the model and its thumbnail into the draft's own library folder.
 * Returns both public URLs, or null when either upload failed (the caller
 * reports the file as failed; a half-uploaded folder has no row and is only
 * orphaned bytes, which the next attempt — a new id — never collides with).
 */
export async function uploadPreparedModel(m: PreparedModel): Promise<{ assetUrl: string; thumbnailUrl: string } | null> {
  const bucket = supabase.storage.from(ASSETS_BUCKET);
  const modelKey = draftModelKey(m.id);
  const thumbKey = draftThumbKey(m.id);
  const up1 = await bucket.upload(modelKey, m.file, { contentType: 'model/gltf-binary', upsert: false });
  if (up1.error) {
    console.error('[libraryImport] model upload', up1.error);
    return null;
  }
  const up2 = await bucket.upload(thumbKey, m.thumb, { contentType: 'image/png', upsert: false });
  if (up2.error) {
    console.error('[libraryImport] thumbnail upload', up2.error);
    await bucket.remove([modelKey]).catch(() => undefined);
    return null;
  }
  return { assetUrl: publicUrl(ASSETS_BUCKET, modelKey), thumbnailUrl: publicUrl(ASSETS_BUCKET, thumbKey) };
}

/**
 * The bytes of a model file by URL — usually straight from the browser cache,
 * since the 3D view just loaded the same URL. Never throws.
 */
export async function fetchModelBytes(url: string): Promise<{ ok: true; bytes: Uint8Array; reason?: undefined } | { ok: false; reason: string; bytes?: undefined }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `The model could not be downloaded (${res.status}).` };
    return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch {
    return { ok: false, reason: 'The model could not be downloaded. Check the connection and try again.' };
  }
}

/**
 * Download a model (an import draft's, a library item's, an event's or a
 * built-in one) and optimize it, for the compare view. Never throws.
 */
export async function optimizeModelAt(url: string, opts: OptimizeOptions): Promise<OptimizeResult> {
  const got = await fetchModelBytes(url);
  if (!got.ok) return { ok: false, reason: got.reason };
  return runOptimizer(got.bytes, opts);
}

/**
 * Upload an optimized copy NEXT TO the draft's original (a new
 * model-opt-<n>.glb, never an overwrite — see draftOptimizedModelKey) and
 * return its public URL, or null. `remove` undoes it when the row update that
 * should follow fails, so a refused swap leaves no stray file.
 */
export async function uploadOptimizedModel(
  id: string,
  bytes: Uint8Array,
): Promise<{ assetUrl: string; remove: () => Promise<void> } | null> {
  const bucket = supabase.storage.from(ASSETS_BUCKET);
  const key = draftOptimizedModelKey(id, Date.now());
  const blob = new Blob([bytes as BlobPart], { type: 'model/gltf-binary' });
  const up = await bucket.upload(key, blob, { contentType: 'model/gltf-binary', upsert: false });
  if (up.error) {
    console.error('[libraryImport] optimized upload', up.error);
    return null;
  }
  return {
    assetUrl: publicUrl(ASSETS_BUCKET, key),
    remove: async () => { await bucket.remove([key]).then(() => undefined, () => undefined); },
  };
}

/* ── Replace a library item's model (Replace file · Optimize · bulk) ──── */

export type ReplaceStep = 'checking' | 'uploading' | 'replacing';

export type ReplaceRun =
  | {
    ok: true;
    result: ReplaceModelResult;
    /** Size and triangles of the file that went in. */
    bytes: number;
    triangles: number;
    /** What the operator's file weighed before "Optimize on upload" shrank it. */
    original?: { bytes: number; triangles: number };
    reason?: undefined;
  }
  | { ok: false; reason: string; result?: undefined };

/**
 * Give a published library prop a new model file, through the SAME pipeline
 * as an import: check, (optionally) optimize, measure and thumbnail in this
 * browser, upload as a hidden import draft, then admin-api's
 * replace_library_item_model, which swaps the file in place when no event
 * uses the item and makes a new version when one does (and consumes the
 * draft either way). A failure after the upload discards the draft again, so
 * Bulk import is never left with a stray copy. Never throws.
 *
 * `requireSmaller`: refuse (change nothing) when the optimizer could not make
 * a worthwhile saving — for "optimize this item", where swapping in the same
 * bytes would only churn the file.
 */
export async function replaceModelFile(
  target: { id: string; name: string },
  file: File,
  opts: { optimize: OptimizeOptions | null; requireSmaller?: boolean; onStep?: (s: ReplaceStep) => void },
): Promise<ReplaceRun> {
  opts.onStep?.('checking');
  const prepared = await prepareModel(file, opts.optimize);
  if (!prepared.ok) return { ok: false, reason: prepared.reason };
  const m = prepared.model;
  try {
    if (opts.requireSmaller === true && !m.original) {
      return { ok: false, reason: m.optimizeNote ?? 'It is already about as small as it gets, so nothing was changed.' };
    }
    opts.onStep?.('uploading');
    const urls = await uploadPreparedModel(m);
    if (!urls) return { ok: false, reason: 'The upload failed. Check the connection and try again.' };
    const name = normalizeLibraryName(target.name) ?? 'Replacement model';
    const importMeta: ImportMeta = {
      category: DEFAULT_IMPORT_CATEGORY,
      classifiedBy: 'none',
      fileName: file.name,
      bytes: m.file.size,
      triangles: m.triangles,
      maxDim: m.maxDim,
      ...(m.original ? { originalBytes: m.original.bytes, originalTriangles: m.original.triangles } : {}),
    };
    // The draft only carries the file: the target keeps its own placement, so
    // this config is never what a guest sees.
    const config = buildDraftRenderConfig({ assetUrl: urls.assetUrl, name, categoryId: DEFAULT_IMPORT_CATEGORY, maxDim: m.maxDim });
    const created = await createLibraryDrafts([{
      id: m.id, name, ...urls, config, tags: { occasions: [], colors: [], styles: [] }, importMeta,
    }]);
    const createErr = created.error ?? created.data?.failed[0]?.error ?? (created.data?.created.includes(m.id) ? null : 'internal');
    if (createErr !== null) {
      // No row points at the upload: remove it so it is not orphaned bytes.
      await supabase.storage.from(ASSETS_BUCKET).remove([draftModelKey(m.id), draftThumbKey(m.id)]).then(() => undefined, () => undefined);
      return { ok: false, reason: libraryErrorText(createErr) };
    }
    opts.onStep?.('replacing');
    const { data, error } = await replaceLibraryItemModel(target.id, m.id);
    if (error !== null || data === null) {
      // 'network' says nothing about whether the server finished: discarding
      // is still safe — a draft the server already consumed is skipped there.
      await discardLibraryDrafts([m.id]).catch(() => undefined);
      return { ok: false, reason: libraryErrorText(error ?? 'internal') };
    }
    return {
      ok: true, result: data, bytes: m.file.size, triangles: m.triangles, ...(m.original ? { original: m.original } : {}),
    };
  } finally {
    URL.revokeObjectURL(m.thumbPreviewUrl);
  }
}

/** A model file to upload from bytes the optimizer made. */
export function glbFile(bytes: Uint8Array, fileName: string): File {
  return new File([bytes as BlobPart], fileName, { type: 'model/gltf-binary' });
}

/** Download a model so it can go back through replaceModelFile (bulk optimize). */
export async function modelFileAt(url: string, fileName: string): Promise<{ ok: true; file: File; reason?: undefined } | { ok: false; reason: string; file?: undefined }> {
  const got = await fetchModelBytes(url);
  if (!got.ok) return { ok: false, reason: got.reason };
  return { ok: true, file: glbFile(got.bytes, fileName) };
}
