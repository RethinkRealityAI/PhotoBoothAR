/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What a .glb weighs, read straight from its bytes — for the size details in
 * /admin/library's side panel. PURE: no DOM, no three.js, no glTF-Transform,
 * so vitest runs it in node and the panel never has to parse a scene to say
 * how heavy a model is.
 *
 * Reads the 12-byte header, the JSON chunk and (for picture sizes) the first
 * bytes of each embedded image. Triangles are counted the way
 * glbOptimize.countTriangles counts them — per node that draws a mesh, so an
 * instanced mesh counts every time it is drawn — so the panel and the
 * optimizer's before/after agree. Total: malformed input returns null, never
 * throws.
 */

export interface GlbImageInfo {
  mimeType: string;
  /** Pixel size from the image's own header; null when unreadable or external. */
  width: number | null;
  height: number | null;
  /** Bytes of the embedded image, 0 when it is an external file. */
  bytes: number;
}

export interface GlbInfo {
  bytes: number;
  triangles: number;
  images: GlbImageInfo[];
  /** Longest edge across all images, 0 when none could be measured. */
  textureMaxEdge: number;
  extensionsUsed: string[];
  meshopt: boolean;
  draco: boolean;
  /** Every image is WebP (or KTX2) — or there are none. */
  texturesCompressed: boolean;
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const MESHOPT = ['EXT_meshopt_compression', 'KHR_meshopt_compression'];
const DRACO = 'KHR_draco_mesh_compression';
const COMPRESSED_IMAGES = new Set(['image/webp', 'image/ktx2']);
/** Scene graphs deeper than this are malformed (or hostile): stop walking. */
const MAX_NODE_DEPTH = 64;

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

/* ── Image headers ─────────────────────────────────────────────────────── */

function u16be(b: Uint8Array, o: number): number { return (b[o] << 8) | b[o + 1]; }
function u16le(b: Uint8Array, o: number): number { return b[o] | (b[o + 1] << 8); }
function u24le(b: Uint8Array, o: number): number { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }
function u32be(b: Uint8Array, o: number): number { return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
}

/** The image type from its first bytes, or null. */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b[0] === 0xab && ascii(b, 1, 6) === 'KTX 20') return 'image/ktx2';
  return null;
}

/** Pixel size of a PNG, JPEG or WebP from its header bytes, or null. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const mime = sniffImageMime(b);
  if (mime === 'image/png') {
    // Signature (8) · IHDR length (4) · "IHDR" (4) · width (4 BE) · height (4 BE)
    if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
    return positive(u32be(b, 16), u32be(b, 20));
  }
  if (mime === 'image/jpeg') {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      if (marker === 0xff) { o += 1; continue; } // fill byte
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = u16be(b, o + 2);
      // Start-of-frame markers carry the size; C4/C8/CC are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return positive(u16be(b, o + 7), u16be(b, o + 5));
      }
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  }
  if (mime === 'image/webp') {
    const chunk = ascii(b, 12, 4);
    const d = 20;
    if (chunk === 'VP8 ' && b.length >= d + 10) {
      if (b[d + 3] !== 0x9d || b[d + 4] !== 0x01 || b[d + 5] !== 0x2a) return null;
      return positive(u16le(b, d + 6) & 0x3fff, u16le(b, d + 8) & 0x3fff);
    }
    if (chunk === 'VP8L' && b.length >= d + 5) {
      if (b[d] !== 0x2f) return null;
      const bits = (b[d + 1] | (b[d + 2] << 8) | (b[d + 3] << 16) | (b[d + 4] << 24)) >>> 0;
      return positive((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X' && b.length >= d + 10) {
      return positive(u24le(b, d + 4) + 1, u24le(b, d + 7) + 1);
    }
    return null;
  }
  return null;
}

function positive(width: number, height: number): { width: number; height: number } | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

/* ── Triangles ─────────────────────────────────────────────────────────── */

function primitiveTriangles(p: unknown, accessors: unknown[]): number {
  if (!isRecord(p)) return 0;
  const idx = int(p.indices);
  const pos = isRecord(p.attributes) ? int(p.attributes.POSITION) : null;
  const acc = idx !== null ? accessors[idx] : pos !== null ? accessors[pos] : null;
  const count = isRecord(acc) ? int(acc.count) ?? 0 : 0;
  const mode = p.mode === undefined ? 4 : p.mode;
  if (mode === 4) return Math.floor(count / 3); // TRIANGLES
  if (mode === 5 || mode === 6) return Math.max(0, count - 2); // STRIP / FAN
  return 0; // points and lines draw no triangles
}

function meshTriangles(mesh: unknown, accessors: unknown[]): number {
  if (!isRecord(mesh)) return 0;
  let n = 0;
  for (const p of arr(mesh.primitives)) n += primitiveTriangles(p, accessors);
  return n;
}

/** Triangles as drawn: once per node that references a mesh, walking every scene. */
function countTriangles(json: Json): number {
  const nodes = arr(json.nodes);
  const meshes = arr(json.meshes);
  const accessors = arr(json.accessors);
  const scenes = arr(json.scenes);
  const perMesh = meshes.map((m) => meshTriangles(m, accessors));
  if (scenes.length === 0) return perMesh.reduce((a, b) => a + b, 0);
  let total = 0;
  const walk = (i: unknown, depth: number, path: Set<number>) => {
    const n = int(i);
    if (n === null || depth > MAX_NODE_DEPTH || path.has(n)) return;
    const node = nodes[n];
    if (!isRecord(node)) return;
    const m = int(node.mesh);
    if (m !== null) total += perMesh[m] ?? 0;
    path.add(n);
    for (const c of arr(node.children)) walk(c, depth + 1, path);
    path.delete(n);
  };
  for (const s of scenes) {
    if (!isRecord(s)) continue;
    for (const root of arr(s.nodes)) walk(root, 0, new Set());
  }
  return total;
}

/* ── The parse ─────────────────────────────────────────────────────────── */

/**
 * Size details for one .glb. null when the bytes are not a GLB container
 * (a .gltf JSON file, an HTML page served for a missing file, a truncated
 * download).
 */
export function readGlbInfo(bytes: Uint8Array): GlbInfo | null {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) return null;
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength > bytes.length) return null;
  let json: Json;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as unknown;
    if (!isRecord(parsed)) return null;
    json = parsed;
  } catch {
    return null;
  }

  // The BIN chunk (buffer 0 of a GLB), when present.
  let bin: Uint8Array | null = null;
  const binAt = 20 + jsonLength;
  if (binAt + 8 <= bytes.length && view.getUint32(binAt + 4, true) === CHUNK_BIN) {
    const binLength = view.getUint32(binAt, true);
    if (binAt + 8 + binLength <= bytes.length) bin = bytes.subarray(binAt + 8, binAt + 8 + binLength);
  }

  const bufferViews = arr(json.bufferViews);
  const buffers = arr(json.buffers);
  const glbBufferIsBin = isRecord(buffers[0]) && buffers[0].uri === undefined;
  const images: GlbImageInfo[] = arr(json.images).map((img) => {
    const o = isRecord(img) ? img : {};
    const declared = typeof o.mimeType === 'string' ? o.mimeType : null;
    const bv = int(o.bufferView);
    const view0 = bv !== null ? bufferViews[bv] : null;
    let data: Uint8Array | null = null;
    if (bin && glbBufferIsBin && isRecord(view0) && (view0.buffer ?? 0) === 0) {
      const off = int(view0.byteOffset) ?? 0;
      const len = int(view0.byteLength) ?? 0;
      if (len > 0 && off + len <= bin.length) data = bin.subarray(off, off + len);
    }
    const mimeType = declared ?? (data ? sniffImageMime(data) : null)
      ?? (typeof o.uri === 'string' ? (/\.webp$/i.test(o.uri) ? 'image/webp' : /\.png$/i.test(o.uri) ? 'image/png' : /\.jpe?g$/i.test(o.uri) ? 'image/jpeg' : 'unknown') : 'unknown');
    const size = data ? imageSize(data) : null;
    return { mimeType, width: size?.width ?? null, height: size?.height ?? null, bytes: data?.length ?? 0 };
  });

  const extensionsUsed = arr(json.extensionsUsed).filter((e): e is string => typeof e === 'string');
  const textureMaxEdge = images.reduce((m, i) => Math.max(m, i.width ?? 0, i.height ?? 0), 0);
  return {
    bytes: bytes.byteLength,
    triangles: countTriangles(json),
    images,
    textureMaxEdge,
    extensionsUsed,
    meshopt: extensionsUsed.some((e) => MESHOPT.includes(e)),
    draco: extensionsUsed.includes(DRACO),
    texturesCompressed: images.every((i) => COMPRESSED_IMAGES.has(i.mimeType)),
  };
}

/** Optimized = compressed geometry AND compressed (or no) textures. */
export function isGlbOptimized(info: Pick<GlbInfo, 'meshopt' | 'draco' | 'texturesCompressed'>): boolean {
  return (info.meshopt || info.draco) && info.texturesCompressed;
}

const MIME_WORD: Record<string, string> = {
  'image/webp': 'WebP', 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/ktx2': 'KTX2',
};

/** "WebP" / "PNG + JPEG" — the distinct picture formats, in operator words. */
export function textureFormats(images: readonly GlbImageInfo[]): string {
  const words = [...new Set(images.map((i) => MIME_WORD[i.mimeType] ?? 'Other'))];
  return words.join(' + ');
}

/** "Compressed (meshopt)" / "Compressed (Draco)" / "Not compressed". */
export function geometryWords(info: Pick<GlbInfo, 'meshopt' | 'draco'>): string {
  if (info.meshopt) return 'Compressed (meshopt)';
  if (info.draco) return 'Compressed (Draco)';
  return 'Not compressed';
}

/** "2048 × 1024" — the size of the biggest picture, or null. */
function largestImage(images: readonly GlbImageInfo[]): string | null {
  let best: GlbImageInfo | null = null;
  for (const i of images) {
    if (i.width === null || i.height === null) continue;
    if (!best || Math.max(i.width, i.height) > Math.max(best.width ?? 0, best.height ?? 0)) best = i;
  }
  return best ? `${best.width} × ${best.height}` : null;
}

/**
 * The side panel's size details, in operator words. `formatBytes` and
 * `formatTriangles` are passed in so this module stays dependency-free.
 */
export function glbDetailRows(
  info: GlbInfo,
  fmt: { bytes: (n: number) => string; triangles: (n: number) => string },
): Array<{ label: string; value: string }> {
  const n = info.images.length;
  const largest = largestImage(info.images);
  const textures = n === 0
    ? 'None'
    : `${n} · ${textureFormats(info.images)}${largest ? ` · largest ${largest}` : ''}`;
  return [
    { label: 'File size', value: fmt.bytes(info.bytes) },
    { label: 'Triangles', value: fmt.triangles(info.triangles) },
    { label: 'Textures', value: textures },
    { label: 'Shape data', value: geometryWords(info) },
  ];
}
