/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/png — stamps a resolution (pHYs chunk) into a PNG, so a print app
 * opens a 1500×2100 card as 5×7 in at 300 dpi instead of guessing 72 dpi and
 * calling it a 20-inch poster. canvas.toBlob never writes one. PURE.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Returns a copy with one pHYs chunk right after IHDR (any old pHYs dropped). Not a PNG? Returned unchanged. */
export function withPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));

  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let pos = 8;
  let inserted = false;
  while (pos + 12 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const end = pos + 12 + len;
    if (end > png.length) return png;
    if (type !== 'pHYs') parts.push(png.subarray(pos, end));
    if (type === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
    pos = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
