import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { geometryWords, glbDetailRows, imageSize, isGlbOptimized, readGlbInfo, sniffImageMime, textureFormats } from './glbInfo';

/* ── Fixture builders ─────────────────────────────────────────────────── */

function pad4(b: Uint8Array, fill: number): Uint8Array {
  const n = Math.ceil(b.length / 4) * 4;
  const out = new Uint8Array(n).fill(fill);
  out.set(b);
  return out;
}

function glb(json: unknown, bin?: Uint8Array): Uint8Array {
  const j = pad4(new TextEncoder().encode(JSON.stringify(json)), 0x20);
  const b = bin ? pad4(bin, 0) : null;
  const total = 12 + 8 + j.length + (b ? 8 + b.length : 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, j.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  if (b) {
    v.setUint32(20 + j.length, b.length, true);
    v.setUint32(24 + j.length, 0x004e4942, true);
    out.set(b, 28 + j.length);
  }
  return out;
}

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}

function jpeg(w: number, h: number): Uint8Array {
  // SOI · APP0 (len 16) · SOF0 (len 17: precision, height, width, …)
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03, ...new Array(9).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

function riff(chunk: string, data: number[]): Uint8Array {
  const b = new Uint8Array(20 + data.length);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8);
  b.set([...chunk].map((c) => c.charCodeAt(0)), 12);
  b.set(data, 20);
  return b;
}
function webpLossy(w: number, h: number) {
  return riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f]);
}
function webpLossless(w: number, h: number) {
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14);
  return riff('VP8L', [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff]);
}
function webpExtended(w: number, h: number) {
  const W = w - 1, H = h - 1;
  return riff('VP8X', [0, 0, 0, 0, W & 0xff, (W >> 8) & 0xff, (W >> 16) & 0xff, H & 0xff, (H >> 8) & 0xff, (H >> 16) & 0xff]);
}

/* ── Image headers ────────────────────────────────────────────────────── */

describe('image headers', () => {
  it('reads PNG, JPEG and all three WebP flavours', () => {
    expect(imageSize(png(2048, 1024))).toEqual({ width: 2048, height: 1024 });
    expect(imageSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(webpLossy(1000, 500))).toEqual({ width: 1000, height: 500 });
    expect(imageSize(webpLossless(4096, 3))).toEqual({ width: 4096, height: 3 });
    expect(imageSize(webpExtended(70000, 2))).toEqual({ width: 70000, height: 2 });
  });

  it('sniffs the type and refuses junk', () => {
    expect(sniffImageMime(png(1, 1))).toBe('image/png');
    expect(sniffImageMime(jpeg(1, 1))).toBe('image/jpeg');
    expect(sniffImageMime(webpLossy(1, 1))).toBe('image/webp');
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(png(0, 5))).toBeNull();
    expect(imageSize(png(8, 8).subarray(0, 20))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

/* ── GLB parse ────────────────────────────────────────────────────────── */

describe('readGlbInfo', () => {
  const image = png(1024, 512);
  const webp = webpLossy(256, 256);
  const bin = new Uint8Array([...image, ...pad4(new Uint8Array(0), 0), ...webp]);
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp'],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: image.length }, { buffer: 0, byteOffset: image.length, byteLength: webp.length }],
    images: [{ bufferView: 0, mimeType: 'image/png' }, { bufferView: 1 }],
    accessors: [{ count: 300 }, { count: 30 }, { count: 12 }, { count: 7 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }, // 100
      { primitives: [{ attributes: { POSITION: 2 } }, { attributes: { POSITION: 3 }, mode: 5 }, { attributes: { POSITION: 3 }, mode: 1 }] }, // 4 + 5 + 0
    ],
    // node 0 draws mesh 0; node 1 (a child) draws mesh 1; node 2 also draws mesh 0 (an instance)
    nodes: [{ mesh: 0, children: [1] }, { mesh: 1 }, { mesh: 0 }],
    scenes: [{ nodes: [0, 2] }],
  };

  it('counts triangles as drawn (indices, arrays, strips, instances; lines draw none)', () => {
    const info = readGlbInfo(glb(json, bin));
    expect(info?.triangles).toBe(100 + 9 + 100);
  });

  it('lists images with their type and size, and the largest edge', () => {
    const info = readGlbInfo(glb(json, bin))!;
    expect(info.images).toEqual([
      { mimeType: 'image/png', width: 1024, height: 512, bytes: image.length },
      { mimeType: 'image/webp', width: 256, height: 256, bytes: webp.length },
    ]);
    expect(info.textureMaxEdge).toBe(1024);
    expect(textureFormats(info.images)).toBe('PNG + WebP');
  });

  it('reports compression and whether it counts as optimized', () => {
    const info = readGlbInfo(glb(json, bin))!;
    expect(info).toMatchObject({ meshopt: true, draco: false, texturesCompressed: false });
    expect(isGlbOptimized(info)).toBe(false); // a PNG is still in there
    expect(geometryWords(info)).toBe('Compressed (meshopt)');
    expect(isGlbOptimized({ meshopt: true, draco: false, texturesCompressed: true })).toBe(true);
    expect(isGlbOptimized({ meshopt: false, draco: true, texturesCompressed: true })).toBe(true);
    expect(isGlbOptimized({ meshopt: false, draco: false, texturesCompressed: true })).toBe(false);
    const plain = readGlbInfo(glb({ asset: { version: '2.0' }, meshes: [{ primitives: [] }] }))!;
    expect(plain).toMatchObject({ triangles: 0, images: [], textureMaxEdge: 0, meshopt: false, texturesCompressed: true });
    expect(geometryWords(plain)).toBe('Not compressed');
  });

  it('counts each mesh once when the file has no scenes', () => {
    const info = readGlbInfo(glb({ ...json, scenes: undefined }, bin));
    expect(info?.triangles).toBe(109);
  });

  it('survives node cycles and dangling indices', () => {
    const bad = { ...json, nodes: [{ mesh: 0, children: [1] }, { mesh: 9, children: [0, 99] }], scenes: [{ nodes: [0, 'x'] }] };
    expect(readGlbInfo(glb(bad, bin))?.triangles).toBe(100);
  });

  it('is total: anything that is not a GLB is null', () => {
    const good = glb(json, bin);
    expect(readGlbInfo(new Uint8Array(0))).toBeNull();
    expect(readGlbInfo(new TextEncoder().encode('<!doctype html><html></html>'))).toBeNull();
    expect(readGlbInfo(good.subarray(0, 30))).toBeNull();
    const v1 = good.slice();
    new DataView(v1.buffer).setUint32(4, 1, true);
    expect(readGlbInfo(v1)).toBeNull();
    const notJson = good.slice();
    notJson[20] = 0x7b; notJson[21] = 0x7b;
    expect(readGlbInfo(notJson)).toBeNull();
    // A truncated BIN chunk keeps the JSON facts and drops the picture sizes.
    const cut = readGlbInfo(good.subarray(0, good.length - 40));
    expect(cut?.triangles).toBe(209);
    expect(cut?.images[0].width).toBeNull();
  });
});

/* ── Cross-check against glTF-Transform on the shipped props ─────────── */

describe('agrees with glTF-Transform on real models', () => {
  for (const name of ['halo-ring', 'elf-ears', 'neon-shades']) {
    it(name, async () => {
      const bytes = new Uint8Array(readFileSync(new URL(`../../public/models/props/${name}.glb`, import.meta.url)));
      await MeshoptDecoder.ready;
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
      const doc = await io.readBinary(bytes);
      let tris = 0;
      for (const scene of doc.getRoot().listScenes()) {
        scene.traverse((node) => {
          for (const p of node.getMesh()?.listPrimitives() ?? []) {
            const count = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
            const mode = p.getMode();
            tris += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
          }
        });
      }
      const edge = Math.max(0, ...doc.getRoot().listTextures().map((t) => Math.max(...(t.getSize() ?? [0, 0]))));
      const info = readGlbInfo(bytes)!;
      expect(info).not.toBeNull();
      expect(info.triangles).toBe(tris);
      expect(info.images.length).toBe(doc.getRoot().listTextures().length);
      expect(info.textureMaxEdge).toBe(edge);
      expect(info.bytes).toBe(bytes.byteLength);
    });
  }
});

describe('glbDetailRows (the side panel)', () => {
  const fmt = { bytes: (n: number) => `${n} B`, triangles: (n: number) => `${n} tris` };
  const base = { bytes: 1234, triangles: 99, extensionsUsed: [], meshopt: false, draco: false, texturesCompressed: true, textureMaxEdge: 0 };

  it('says None for a model with no textures', () => {
    expect(glbDetailRows({ ...base, images: [] }, fmt)).toEqual([
      { label: 'File size', value: '1234 B' },
      { label: 'Triangles', value: '99 tris' },
      { label: 'Textures', value: 'None' },
      { label: 'Shape data', value: 'Not compressed' },
    ]);
  });

  it('counts textures, names their formats and the biggest one by its longest edge', () => {
    const rows = glbDetailRows({
      ...base, meshopt: true, texturesCompressed: false, textureMaxEdge: 2048,
      images: [
        { mimeType: 'image/png', width: 1024, height: 1024, bytes: 9 },
        { mimeType: 'image/jpeg', width: 512, height: 2048, bytes: 9 },
        { mimeType: 'image/png', width: null, height: null, bytes: 0 },
      ],
    }, fmt);
    expect(rows[2]).toEqual({ label: 'Textures', value: '3 · PNG + JPEG · largest 512 × 2048' });
    expect(rows[3].value).toBe('Compressed (meshopt)');
  });

  it('leaves the size out when no picture could be measured', () => {
    const rows = glbDetailRows({ ...base, images: [{ mimeType: 'image/webp', width: null, height: null, bytes: 0 }] }, fmt);
    expect(rows[2].value).toBe('1 · WebP');
  });
});
