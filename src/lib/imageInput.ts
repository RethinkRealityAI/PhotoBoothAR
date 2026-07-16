/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turn a host-picked photo (invitation / mood board / venue) into a small
 * base64 image part for Gemini vision. Downscales + re-encodes as JPEG so the
 * payload stays tiny (a 1024px JPEG ≈ a few hundred KB) — well under the edge
 * function's size cap and cheap to send inline. Browser-only (canvas), so it
 * lives outside the node-tested lib surface.
 */
export interface ImagePart {
  /** base64, no data: prefix */
  data: string;
  mimeType: string;
}

export async function fileToImagePart(
  file: Blob,
  maxDim = 1024,
  quality = 0.85,
): Promise<ImagePart | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    return { data: dataUrl.slice(comma + 1), mimeType: 'image/jpeg' };
  } catch {
    // HEIC or a decode failure on some browsers — caller falls back to text.
    return null;
  }
}
