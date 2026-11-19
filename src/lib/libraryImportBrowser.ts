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
import { checkGlbFile, draftModelKey, draftThumbKey } from './libraryImport';

export interface PreparedModel {
  id: string;
  file: File;
  thumb: Blob;
  /** Object URL of `thumb` for the review card until the server copy loads. */
  thumbPreviewUrl: string;
  triangles: number;
  maxDim: number;
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

/**
 * Check, parse, measure and thumbnail ONE dropped file — all locally, before a
 * byte is uploaded. Never throws. The parsed model goes through the shared
 * glbCache (so captureGlbThumbnail and the measure share one parse) and is
 * evicted at the end: an import of 40 models must not keep 40 parsed meshes in
 * memory for the rest of the session.
 */
export async function prepareModel(file: File): Promise<PrepareResult> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer().catch(() => new ArrayBuffer(0)));
  const check = checkGlbFile(file.name, file.size, header);
  if (!check.ok) return { ok: false, reason: check.reason as string };

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
