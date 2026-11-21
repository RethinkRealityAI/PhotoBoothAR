import { describe, expect, it } from 'vitest';
import {
  MIN_SAVINGS_RATIO,
  OPTIMIZE_PRESETS,
  fitTextureSize,
  formatSaving,
  formatTextureEdge,
  formatTriangles,
  glbExtensionsUsed,
  keepEncodedTexture,
  planTexture,
  savingsPercent,
  simplifyRatio,
  worthKeeping,
} from './glbOptimizePlan';
import { IMPORT_MAX_BYTES, IMPORT_WARN_TRIANGLES } from './libraryImport';

/** A minimal GLB: header + one JSON chunk (padded to 4 bytes like the spec). */
function glb(json: unknown, magic = 0x46546c67): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, magic, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, body.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

describe('presets', () => {
  it('balanced keeps 2048px textures and the import warning budget; small is strictly smaller', () => {
    expect(OPTIMIZE_PRESETS.balanced).toMatchObject({ maxTextureEdge: 2048, triangleBudget: IMPORT_WARN_TRIANGLES });
    const { balanced: b, small: s } = OPTIMIZE_PRESETS;
    expect(s.maxTextureEdge).toBeLessThan(b.maxTextureEdge);
    expect(s.triangleBudget).toBeLessThan(b.triangleBudget);
    expect(s.webpQuality).toBeLessThan(b.webpQuality);
    for (const p of [b, s]) {
      expect(p.webpQuality).toBeGreaterThan(0);
      expect(p.webpQuality).toBeLessThanOrEqual(1);
    }
  });
});

describe('simplifyRatio', () => {
  it('skips a model under or at the budget', () => {
    expect(simplifyRatio(100_000, 150_000)).toBeNull();
    expect(simplifyRatio(150_000, 150_000)).toBeNull();
  });
  it('aims at the budget above it, never below 5% of the original', () => {
    expect(simplifyRatio(300_000, 150_000)).toBeCloseTo(0.5);
    expect(simplifyRatio(100_000_000, 150_000)).toBe(0.05);
  });
  it('is total on garbage', () => {
    expect(simplifyRatio(Number.NaN, 1)).toBeNull();
    expect(simplifyRatio(10, 0)).toBeNull();
    expect(simplifyRatio(0, 10)).toBeNull();
  });
});

describe('textures', () => {
  it('fits the long edge and keeps the aspect', () => {
    expect(fitTextureSize(4096, 4096, 2048)).toEqual([2048, 2048]);
    expect(fitTextureSize(8192, 4096, 2048)).toEqual([2048, 1024]);
    expect(fitTextureSize(2048, 1024, 2048)).toBeNull();
    expect(fitTextureSize(9000, 1, 1024)).toEqual([1024, 1]);
    expect(fitTextureSize(0, 10, 10)).toBeNull();
  });
  it('converts PNG/JPEG to WebP, resizes only oversize WebP, passes KTX2 through', () => {
    expect(planTexture('image/png', 4096, 4096, 2048)).toEqual({ action: 'encode', size: [2048, 2048] });
    expect(planTexture('image/jpeg', 512, 512, 2048)).toEqual({ action: 'encode', size: [512, 512] });
    expect(planTexture('image/webp', 1024, 1024, 2048)).toEqual({ action: 'skip' });
    expect(planTexture('image/webp', 4096, 2048, 2048)).toEqual({ action: 'encode', size: [2048, 1024] });
    expect(planTexture('image/ktx2', 4096, 4096, 2048)).toEqual({ action: 'skip' });
    expect(planTexture('image/png', 0, 0, 2048)).toEqual({ action: 'skip' });
  });
  it('keeps a resized texture even if bigger, an unresized one only if smaller', () => {
    expect(keepEncodedTexture(100, 120, true)).toBe(true);
    expect(keepEncodedTexture(100, 120, false)).toBe(false);
    expect(keepEncodedTexture(100, 80, false)).toBe(true);
    expect(keepEncodedTexture(100, 0, true)).toBe(false);
  });
});

describe('savings', () => {
  it('rounds to whole percent and never goes negative', () => {
    expect(savingsPercent(40, 4)).toBe(90);
    expect(savingsPercent(40, 50)).toBe(0);
    expect(savingsPercent(0, 0)).toBe(0);
  });
  it('keeps the optimized copy only for a real saving that fits the bucket', () => {
    expect(worthKeeping({ bytesBefore: 1000, bytesAfter: 1000 * (1 - MIN_SAVINGS_RATIO) })).toBe(true);
    expect(worthKeeping({ bytesBefore: 1000, bytesAfter: 990 })).toBe(false);
    expect(worthKeeping({ bytesBefore: 1000, bytesAfter: 0 })).toBe(false);
    expect(worthKeeping({ bytesBefore: IMPORT_MAX_BYTES * 3, bytesAfter: IMPORT_MAX_BYTES + 1 })).toBe(false);
  });
  it('phrases the card line', () => {
    expect(formatSaving(38 * 1024 * 1024, 4.1 * 1024 * 1024)).toBe('38 MB → 4.1 MB (−89%)');
    expect(formatSaving(1024, 2048)).toBe('1 KB → 2 KB');
    expect(formatTriangles(41_141)).toBe('41k triangles');
    expect(formatTriangles(512)).toBe('512 triangles');
    expect(formatTextureEdge(0)).toBe('No textures');
    expect(formatTextureEdge(2048)).toBe('2048px textures');
  });
});

describe('glbExtensionsUsed', () => {
  it('reads extensionsUsed from the JSON chunk', () => {
    expect(glbExtensionsUsed(glb({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression', 7] })))
      .toEqual(['KHR_draco_mesh_compression']);
    expect(glbExtensionsUsed(glb({ asset: { version: '2.0' } }))).toEqual([]);
  });
  it('is total on a non-GLB, a truncated chunk or bad JSON', () => {
    expect(glbExtensionsUsed(glb({}, 0x12345678))).toEqual([]);
    expect(glbExtensionsUsed(glb({ extensionsUsed: ['x'] }).subarray(0, 24))).toEqual([]);
    const bad = glb({ a: 1 });
    bad[20] = 0x7b; bad[21] = 0x7b; // "{{"
    expect(glbExtensionsUsed(bad)).toEqual([]);
    expect(glbExtensionsUsed(new Uint8Array(3))).toEqual([]);
  });
});
