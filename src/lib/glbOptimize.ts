/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-browser 3D model optimizer for the admin's bulk import
 * (/admin/library/import). BROWSER ONLY and LAZY: callers reach it through
 * `await import('./glbOptimize')`, so glTF-Transform and the meshoptimizer
 * wasm never enter the guest or host bundles. The rules it applies (presets,
 * budgets, "is this saving worth it") are pure in lib/glbOptimizePlan.ts.
 *
 * Pipeline: dedup → prune → weld → resample (animations) → simplify (only
 * above the triangle budget) → textures resized + re-encoded to WebP by the
 * browser's own canvas encoder → EXT_meshopt_compression. Meshopt, not Draco:
 * it decodes faster and glbCache already registers MeshoptDecoder. Never
 * KTX2/Basis — the booth's loader has no KTX2 transcoder.
 *
 * Never throws: every failure is `{ ok: false, reason }` in plain words.
 */
import { Logger, WebIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import {
  glbExtensionsUsed,
  keepEncodedTexture,
  planTexture,
  simplifyRatio,
  type OptimizeOptions,
  type OptimizeStats,
} from './glbOptimizePlan';

export type OptimizeResult =
  | { ok: true; bytes: Uint8Array; stats: OptimizeStats; notes: string[]; reason?: undefined }
  | { ok: false; reason: string; bytes?: undefined; stats?: undefined; notes?: undefined };

const DRACO = 'KHR_draco_mesh_compression';
/** Where scripts/copy-three-decoders.mjs self-hosts the Draco runtime (= glbCache's DRACO_PATH). */
const DRACO_PATH = `${import.meta.env.BASE_URL ?? '/'}three/draco/`.replace(/\/{2,}/g, '/');
const DRACO_INIT_TIMEOUT_MS = 20_000;

/* ── Draco decoder (only for a Draco-compressed INPUT) ───────────────────── */

type DracoFactory = (config: { wasmBinary: ArrayBuffer; onModuleLoaded: (m: unknown) => void }) => unknown;
let _draco: Promise<unknown> | null = null;

/**
 * The same Emscripten decoder three's DRACOLoader runs in its workers, loaded
 * once on the main thread from our own /three/draco/. Resolved through a
 * wrapper object: the Emscripten module is itself a thenable, and resolving
 * a promise WITH it recurses forever (DRACOLoader wraps it for the same reason).
 */
function loadDracoDecoder(): Promise<unknown> {
  if (_draco) return _draco;
  _draco = (async () => {
    const g = globalThis as { DracoDecoderModule?: DracoFactory };
    if (typeof g.DracoDecoderModule !== 'function') {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${DRACO_PATH}draco_wasm_wrapper.js`;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('draco wrapper failed to load'));
        document.head.appendChild(s);
      });
    }
    // A missing file under public/ is answered with index.html at 200
    // (CLAUDE.md watchout) — check the wasm magic, not res.ok alone.
    const res = await fetch(`${DRACO_PATH}draco_decoder.wasm`);
    const wasmBinary = await res.arrayBuffer();
    const magic = new Uint8Array(wasmBinary, 0, Math.min(4, wasmBinary.byteLength));
    if (!res.ok || magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
      throw new Error('draco decoder missing');
    }
    const factory = g.DracoDecoderModule;
    if (typeof factory !== 'function') throw new Error('draco wrapper did not define DracoDecoderModule');
    const boxed = await new Promise<{ module: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('draco init timeout')), DRACO_INIT_TIMEOUT_MS);
      factory({ wasmBinary, onModuleLoaded: (m) => { clearTimeout(timer); resolve({ module: m }); } });
    });
    return boxed.module;
  })();
  _draco.catch(() => { _draco = null; });
  return _draco;
}

/* ── Measuring ───────────────────────────────────────────────────────────── */

function primitiveTriangles(p: Primitive): number {
  const count = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
  const mode = p.getMode();
  if (mode === 4) return Math.floor(count / 3); // TRIANGLES
  if (mode === 5 || mode === 6) return Math.max(0, count - 2); // STRIP / FAN
  return 0; // points and lines draw no triangles
}

/** Triangles as drawn: per node that references a mesh (instances count), like prepareModel's three.js count. */
function countTriangles(doc: Document): number {
  let n = 0;
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      for (const p of mesh.listPrimitives()) n += primitiveTriangles(p);
    });
  }
  return n;
}

function textureMaxEdge(doc: Document): number {
  let edge = 0;
  for (const t of doc.getRoot().listTextures()) {
    const size = t.getSize();
    if (size) edge = Math.max(edge, size[0], size[1]);
  }
  return edge;
}

/* ── Texture re-encode (the browser's own canvas encoder) ────────────────── */

async function canvasBlob(bitmap: ImageBitmap, w: number, h: number, type: string, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return c.convertToBlob({ type, quality });
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

/**
 * One texture, resized to `size` and encoded as WebP. A browser without a
 * WebP ENCODER (canvas silently hands back a PNG instead — Safari) keeps the
 * source format, resized; the blob's own type is checked, never assumed.
 * `colorSpaceConversion: 'none'` keeps normal / ORM maps numerically intact.
 */
async function encodeTexture(
  src: Uint8Array,
  mime: string,
  size: [number, number],
  quality: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const bitmap = await createImageBitmap(new Blob([src as BlobPart], { type: mime }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const [w, h] = size;
    const webp = await canvasBlob(bitmap, w, h, 'image/webp', quality);
    if (webp && webp.type === 'image/webp') return { bytes: new Uint8Array(await webp.arrayBuffer()), mime: 'image/webp' };
    const fallback = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasBlob(bitmap, w, h, fallback, quality);
    if (blob && blob.type === fallback) return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: fallback };
    return null;
  } finally {
    bitmap.close();
  }
}

const EXT_FOR: Record<string, string> = { 'image/webp': '.webp', 'image/png': '.png', 'image/jpeg': '.jpg' };

async function compressTextures(doc: Document, opts: OptimizeOptions, notes: string[]): Promise<void> {
  let unreadable = 0;
  let noWebp = false;
  for (const tex of doc.getRoot().listTextures()) {
    const src = tex.getImage();
    const size = tex.getSize();
    if (!src || !size) continue;
    const plan = planTexture(tex.getMimeType(), size[0], size[1], opts.maxTextureEdge);
    if (plan.action === 'skip') continue;
    let out: { bytes: Uint8Array; mime: string } | null = null;
    try {
      out = await encodeTexture(src, tex.getMimeType(), plan.size, opts.webpQuality);
    } catch {
      out = null;
    }
    if (!out) { unreadable += 1; continue; }
    const resized = plan.size[0] !== size[0] || plan.size[1] !== size[1];
    if (out.mime !== 'image/webp') noWebp = true;
    if (!keepEncodedTexture(src.byteLength, out.bytes.byteLength, resized)) continue;
    const prevMime = tex.getMimeType();
    tex.setImage(out.bytes).setMimeType(out.mime);
    const uri = tex.getURI();
    if (uri && out.mime !== prevMime) tex.setURI(uri.replace(/\.(png|jpe?g|webp)$/i, '') + EXT_FOR[out.mime]);
  }
  // EXT_texture_webp with no fallback image: REQUIRED, so a viewer that cannot
  // read WebP refuses the file instead of drawing it untextured.
  if (doc.getRoot().listTextures().some((t) => t.getMimeType() === 'image/webp')) {
    doc.createExtension(EXTTextureWebP).setRequired(true);
  }
  if (unreadable > 0) notes.push(`${unreadable} texture${unreadable === 1 ? '' : 's'} could not be read here and ${unreadable === 1 ? 'was' : 'were'} kept as-is.`);
  if (noWebp) notes.push('This browser cannot write WebP, so textures were resized but kept as PNG/JPEG. Chrome or Edge shrinks them further.');
}

/* ── The pipeline ────────────────────────────────────────────────────────── */

function reasonFor(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/draco/i.test(msg)) return 'This model is Draco-compressed and the Draco decoder could not start here. Try again, or re-export it without Draco.';
  if (/memory|allocation|Array buffer/i.test(msg)) return 'The browser ran out of memory optimizing this model. Try the Smallest preset, or a desktop browser.';
  return `The optimizer could not process this model (${msg.slice(0, 160)}).`;
}

/**
 * Optimize one GLB. Returns the new bytes plus before/after stats, or a plain
 * reason. The input array is never mutated.
 */
export async function optimizeGlb(bytes: Uint8Array, opts: OptimizeOptions): Promise<OptimizeResult> {
  const started = performance.now();
  try {
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
    const hasDraco = glbExtensionsUsed(bytes).includes(DRACO);
    const io = new WebIO()
      .setLogger(new Logger(Logger.Verbosity.WARN))
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
        ...(hasDraco ? { 'draco3d.decoder': await loadDracoDecoder() } : {}),
      });

    const doc = await io.readBinary(bytes);
    doc.setLogger(new Logger(Logger.Verbosity.WARN));
    const trianglesBefore = countTriangles(doc);
    const textureMaxEdgeBefore = textureMaxEdge(doc);
    const notes: string[] = [];

    // Geometry was decoded on read; the output is meshopt, so Draco must go
    // (writing it again would need the ENCODER, which is not loaded).
    doc.disposeExtension(DRACO);

    await doc.transform(dedup(), prune({ keepExtras: true }), weld());
    if (doc.getRoot().listAnimations().length > 0) await doc.transform(resample());

    const ratio = simplifyRatio(trianglesBefore, opts.triangleBudget);
    if (ratio !== null) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: opts.simplifyError }));
      // simplify can leave unused accessors behind.
      await doc.transform(prune({ keepExtras: true }));
    }

    await compressTextures(doc, opts, notes);
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: opts.meshoptLevel }));

    const out = await io.writeBinary(doc);
    const trianglesAfter = countTriangles(doc);
    if (trianglesAfter === 0 && trianglesBefore > 0) {
      return { ok: false, reason: 'Optimizing removed every triangle. Keep the original.' };
    }
    if (ratio !== null && trianglesAfter > trianglesBefore * 0.95) {
      notes.push('The mesh could not be simplified much without changing its shape, so most triangles were kept.');
    }
    return {
      ok: true,
      bytes: out,
      notes,
      stats: {
        bytesBefore: bytes.byteLength,
        bytesAfter: out.byteLength,
        trianglesBefore,
        trianglesAfter,
        textureMaxEdgeBefore,
        textureMaxEdgeAfter: textureMaxEdge(doc),
        seconds: Math.round((performance.now() - started) / 100) / 10,
      },
    };
  } catch (e) {
    console.error('[glbOptimize] failed', e);
    return { ok: false, reason: reasonFor(e) };
  }
}
