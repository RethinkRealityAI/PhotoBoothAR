/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A picture for an event piece that has none, so it can be copied into the
 * shared library (publish_library_item refuses a 3D prop or scene without one:
 * the host picker would show a blank square). Browser-only — never import
 * from a vitest file. The choice of WHAT to draw is the pure
 * libraryCms.pictureSourceFor.
 *
 * The picture is staged under `_platform/library/_pictures/` (platform admins
 * may write anywhere in the bucket, migration 018); admin-api accepts a
 * thumbnail only from that prefix and copies it into the new item's folder.
 */
import { supabase, ASSETS_BUCKET, publicUrl } from './supabase';
import { captureGlbThumbnail } from './studio/glbThumb';
import { evictModel } from './glbCache';
import type { PictureSource } from './libraryCms';

const SIZE = 512;
export const PICTURE_STAGING_PREFIX = '_platform/library/_pictures/';

/** Draw an image (file or URL) centred, contained, on a transparent square. */
async function imageToPng(src: string): Promise<Blob | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  const loaded = new Promise<boolean>((res) => {
    img.onload = () => res(true);
    img.onerror = () => res(false);
  });
  img.src = src;
  if (!(await loaded)) return null;
  const w = img.naturalWidth || SIZE;
  const h = img.naturalHeight || SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const k = Math.min(SIZE / w, SIZE / h);
  ctx.drawImage(img, (SIZE - w * k) / 2, (SIZE - h * k) / 2, w * k, h * k);
  try {
    return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
  } catch {
    return null; // a tainted canvas (no CORS on that image) cannot be exported
  }
}

/** Render a picture from the piece's own files. null = could not draw one. */
export async function renderPicture(source: PictureSource): Promise<Blob | null> {
  if (source.kind === 'glb') {
    try {
      return await captureGlbThumbnail(source.url, SIZE);
    } catch {
      return null;
    } finally {
      // One-off render: do not keep 40 parsed meshes in memory after an "Add all".
      evictModel(source.url);
    }
  }
  if (source.kind === 'image') return imageToPng(source.url);
  return null;
}

/** A picture the operator chose from disk, normalised to the same square PNG. */
export async function pictureFromFile(file: File): Promise<Blob | null> {
  if (!/^image\//.test(file.type) || file.size > 12 * 1024 * 1024) return null;
  const url = URL.createObjectURL(file);
  try {
    return await imageToPng(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Upload to the staging prefix; the public URL, or null on failure. */
export async function stagePicture(blob: Blob): Promise<string | null> {
  const key = `${PICTURE_STAGING_PREFIX}${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(key, blob, { contentType: 'image/png', upsert: false });
  if (error) {
    console.error('[libraryPicture] upload', error);
    return null;
  }
  return publicUrl(ASSETS_BUCKET, key);
}
