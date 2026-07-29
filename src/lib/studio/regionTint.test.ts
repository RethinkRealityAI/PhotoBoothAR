/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_REGIONS,
  MAX_TINT_RATIO,
  MIN_REF_LUMINANCE,
  DEFAULT_REF_LUMINANCE,
  REGION_TINT_CACHE_KEY,
  REGION_ATTRIBUTE,
  srgbByteToLinear,
  linearLuminance,
  hexToLinearRgb,
  meanRegionLuminance,
  normalizeRefLuminance,
  tintRatio,
  applyRegionTintLinear,
  packRegionIds,
  unpackRegionIds,
  buildRegionUniforms,
  resolveRegionOverride,
  regionTintVertexPatch,
  regionTintFragmentPatch,
  regionOverridesKey,
} from './regionTint';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('srgbByteToLinear', () => {
  it('anchors the endpoints exactly', () => {
    expect(srgbByteToLinear(0)).toBe(0);
    expect(close(srgbByteToLinear(255), 1)).toBe(true);
  });

  it('uses the piecewise transfer, not pow(x, 2.2)', () => {
    // 128/255 = 0.50196 -> ((0.50196+0.055)/1.055)^2.4 = 0.21586
    expect(close(srgbByteToLinear(128), 0.2158605, 1e-6)).toBe(true);
    // The linear toe below 0.04045: byte 5 -> 5/255/12.92
    expect(close(srgbByteToLinear(5), 5 / 255 / 12.92)).toBe(true);
  });

  it('clamps out-of-range and rejects non-finite input', () => {
    expect(srgbByteToLinear(-40)).toBe(0);
    expect(close(srgbByteToLinear(9999), 1)).toBe(true);
    expect(srgbByteToLinear(NaN)).toBe(0);
    expect(srgbByteToLinear(Infinity)).toBe(0);
  });
});

describe('linearLuminance', () => {
  it('weights sum to 1, so white is 1', () => {
    expect(close(linearLuminance(1, 1, 1), 1)).toBe(true);
  });
  it('green dominates', () => {
    expect(linearLuminance(0, 1, 0)).toBeGreaterThan(linearLuminance(1, 0, 0));
    expect(linearLuminance(1, 0, 0)).toBeGreaterThan(linearLuminance(0, 0, 1));
  });
});

describe('hexToLinearRgb', () => {
  it('converts the endpoints and the shorthand form', () => {
    expect(hexToLinearRgb('#000000')).toEqual([0, 0, 0]);
    const white = hexToLinearRgb('#ffffff')!;
    expect(white.every((c) => close(c, 1))).toBe(true);
    // #f00 must expand to #ff0000, not parse as 0x0f00
    expect(hexToLinearRgb('#f00')).toEqual(hexToLinearRgb('#ff0000'));
  });

  it('is LINEAR, not the raw byte ratio — this is the bug that makes tints look washed out', () => {
    const mid = hexToLinearRgb('#808080')!;
    expect(close(mid[0], 0.2158605, 1e-6)).toBe(true);
    expect(mid[0]).not.toBeCloseTo(128 / 255, 3);
  });

  it('returns null for everything that is not a colour, and never throws', () => {
    for (const bad of [null, undefined, 42, {}, [], '', 'red', '#12345', '#gggggg', 'rgb(1,2,3)', '#ffffff  x']) {
      expect(hexToLinearRgb(bad)).toBeNull();
    }
  });
});

describe('meanRegionLuminance', () => {
  it('averages opaque texels', () => {
    const white = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(close(meanRegionLuminance(white), 1, 1e-6)).toBe(true);
  });

  it('SKIPS fully transparent atlas padding — counting it would drag the divisor down', () => {
    const half = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0]);
    // With padding counted the mean would be 0.5; skipped, it is 1.
    expect(close(meanRegionLuminance(half), 1, 1e-6)).toBe(true);
  });

  it('never returns 0 or NaN — the result is a divisor', () => {
    expect(meanRegionLuminance(new Uint8Array([]))).toBe(DEFAULT_REF_LUMINANCE);
    expect(meanRegionLuminance(new Uint8Array([0, 0, 0, 0]))).toBe(DEFAULT_REF_LUMINANCE);
    // A genuinely black but OPAQUE region floors at MIN, not 0.
    expect(meanRegionLuminance(new Uint8Array([0, 0, 0, 255]))).toBe(MIN_REF_LUMINANCE);
  });

  it('ignores a trailing partial pixel rather than reading past the buffer', () => {
    const ragged = new Uint8Array([255, 255, 255, 255, 255, 255]);
    expect(close(meanRegionLuminance(ragged), 1, 1e-6)).toBe(true);
  });
});

describe('normalizeRefLuminance', () => {
  it('clamps into the usable divisor range', () => {
    expect(normalizeRefLuminance(0)).toBe(MIN_REF_LUMINANCE);
    expect(normalizeRefLuminance(-5)).toBe(MIN_REF_LUMINANCE);
    expect(normalizeRefLuminance(7)).toBe(1);
    expect(normalizeRefLuminance(0.4)).toBe(0.4);
  });
  it('falls back for junk', () => {
    for (const bad of [null, undefined, NaN, 'abc', {}, []]) {
      expect(normalizeRefLuminance(bad)).toBe(DEFAULT_REF_LUMINANCE);
    }
  });
  it('accepts a numeric string, because jsonb round-trips are untyped', () => {
    expect(normalizeRefLuminance('0.25')).toBe(0.25);
  });
});

describe('tintRatio', () => {
  it('is exactly 1 at the region average — the whole premise', () => {
    expect(close(tintRatio(0.18, 0.18), 1)).toBe(true);
  });
  it('caps blown-out specular highlights', () => {
    expect(tintRatio(99, 0.18)).toBe(MAX_TINT_RATIO);
  });
  it('does not divide by zero', () => {
    expect(Number.isFinite(tintRatio(0.5, 0))).toBe(true);
    expect(tintRatio(0.5, 0)).toBe(MAX_TINT_RATIO);
  });
  it('rejects negative / non-finite samples', () => {
    expect(tintRatio(-1, 0.18)).toBe(0);
    expect(tintRatio(NaN, 0.18)).toBe(0);
  });
});

describe('applyRegionTintLinear — the muddy-tint fix', () => {
  const navy = hexToLinearRgb('#22304f')!;
  const crimson = hexToLinearRgb('#c81e3a')!;
  const navyRef = linearLuminance(navy[0], navy[1], navy[2]);

  it('lands the region average exactly on the requested swatch', () => {
    const out = applyRegionTintLinear(navy, crimson, navyRef, 1);
    expect(close(out[0], crimson[0], 1e-6)).toBe(true);
    expect(close(out[1], crimson[1], 1e-6)).toBe(true);
    expect(close(out[2], crimson[2], 1e-6)).toBe(true);
  });

  it('beats the naive multiply, which can only ever subtract light', () => {
    const naive: [number, number, number] = [navy[0] * crimson[0], navy[1] * crimson[1], navy[2] * crimson[2]];
    const naiveLum = linearLuminance(naive[0], naive[1], naive[2]);
    const wanted = linearLuminance(crimson[0], crimson[1], crimson[2]);
    const ours = applyRegionTintLinear(navy, crimson, navyRef, 1);
    const oursLum = linearLuminance(ours[0], ours[1], ours[2]);
    // The naive result is a fraction of the target's brightness: that is "muddy".
    expect(naiveLum).toBeLessThan(wanted * 0.1);
    expect(close(oursLum, wanted, 1e-6)).toBe(true);
  });

  it('PRESERVES the bake as relative shading — a 2:1 seam stays 2:1', () => {
    const dark: [number, number, number] = [navy[0] * 0.5, navy[1] * 0.5, navy[2] * 0.5];
    const lit = applyRegionTintLinear(navy, crimson, navyRef, 1);
    const shadow = applyRegionTintLinear(dark, crimson, navyRef, 1);
    const ratio = linearLuminance(lit[0], lit[1], lit[2]) / linearLuminance(shadow[0], shadow[1], shadow[2]);
    expect(close(ratio, 2, 1e-4)).toBe(true);
  });

  it('amount 0 is a byte-identical no-op — the legacy guarantee at the maths level', () => {
    expect(applyRegionTintLinear(navy, crimson, navyRef, 0)).toEqual([navy[0], navy[1], navy[2]]);
    expect(applyRegionTintLinear(navy, crimson, navyRef, NaN)).toEqual([navy[0], navy[1], navy[2]]);
  });

  it('blends linearly at partial amount', () => {
    const half = applyRegionTintLinear(navy, crimson, navyRef, 0.5);
    expect(close(half[0], (navy[0] + crimson[0]) / 2, 1e-6)).toBe(true);
  });

  it('clamps amount above 1 rather than overshooting past the swatch', () => {
    const over = applyRegionTintLinear(navy, crimson, navyRef, 4);
    expect(close(over[0], crimson[0], 1e-6)).toBe(true);
  });

  it('handles a flat, texture-less albedo (reference-head.glb has 0 textures)', () => {
    const flatWhite: [number, number, number] = [1, 1, 1];
    const out = applyRegionTintLinear(flatWhite, crimson, 1, 1);
    // ratio is exactly 1, so an untextured mesh takes the swatch directly.
    expect(close(out[0], crimson[0], 1e-6)).toBe(true);
  });
});

describe('packRegionIds / unpackRegionIds', () => {
  it('round-trips', () => {
    const ids = [0, 1, 2, 3, 255, 7, 0, 0];
    const back = unpackRegionIds(packRegionIds(ids))!;
    expect(Array.from(back)).toEqual(ids);
  });

  it('round-trips a mesh-sized buffer', () => {
    const ids = new Uint8Array(30109 * 3);
    for (let i = 0; i < ids.length; i++) ids[i] = i % MAX_REGIONS;
    const back = unpackRegionIds(packRegionIds(ids))!;
    expect(back.length).toBe(ids.length);
    expect(back[0]).toBe(0);
    expect(back[ids.length - 1]).toBe(ids[ids.length - 1]);
  });

  it('clamps hostile values to a region that exists', () => {
    const back = unpackRegionIds(packRegionIds([-5, 999, NaN, Infinity, 3.6]))!;
    expect(Array.from(back)).toEqual([0, 255, 0, 0, 4]);
  });

  it('returns null for anything that is not clean base64 — never throws', () => {
    for (const bad of [null, undefined, 42, {}, [], '', 'not base64!!', 'abc', '////x', '=====']) {
      expect(unpackRegionIds(bad)).toBeNull();
    }
  });

  it('rejects a sidecar URL rather than decoding it as garbage ids', () => {
    expect(unpackRegionIds('https://example.com/regions.bin')).toBeNull();
    expect(unpackRegionIds('/models/regions.bin')).toBeNull();
  });

  it('encodes an empty list without throwing', () => {
    expect(packRegionIds([])).toBe('');
    expect(unpackRegionIds('')).toBeNull();
  });
});

describe('resolveRegionOverride', () => {
  it('returns null when there is nothing to do — leave the bytes alone', () => {
    expect(resolveRegionOverride(undefined, undefined)).toBeNull();
    expect(resolveRegionOverride(null, 'original')).toBeNull();
    expect(resolveRegionOverride('', '')).toBeNull();
  });

  it('does not treat an UNKNOWN finish as a request', () => {
    // normalizeFinish maps every unknown string to 'original'; with no hex there
    // is still nothing to apply.
    expect(resolveRegionOverride(undefined, 'bogus-finish')).toBeNull();
  });

  it('takes the finish\'s own colour when no hex was picked', () => {
    const gold = resolveRegionOverride(undefined, 'gold')!;
    expect(gold.hex).toBe('#D4A017');
    expect(gold.metalness).toBe(1);
    expect(gold.roughness).toBe(0.24);
  });

  it('an explicit hex wins over the finish colour', () => {
    const r = resolveRegionOverride('#123456', 'gold')!;
    expect(r.hex).toBe('#123456');
    expect(r.metalness).toBe(1);
  });

  it('hex alone leaves metalness/roughness untouched (null, not 0)', () => {
    const r = resolveRegionOverride('#123456', undefined)!;
    expect(r.hex).toBe('#123456');
    expect(r.metalness).toBeNull();
    expect(r.roughness).toBeNull();
  });

  it('a finish with no colour of its own (matte) keeps the baked hue', () => {
    const r = resolveRegionOverride(undefined, 'matte')!;
    expect(r.hex).toBeNull();
    expect(r.roughness).toBe(0.92);
  });
});

describe('buildRegionUniforms', () => {
  const regions = [
    { id: 'crown', recolourable: true, refLuminance: 0.12 },
    { id: 'brim', recolourable: true, refLuminance: 0.4 },
    { id: 'badge', recolourable: false, refLuminance: 0.3 },
  ];

  it('is INACTIVE with no overrides — the caller must then skip the patch entirely', () => {
    expect(buildRegionUniforms(regions, null).active).toBe(false);
    expect(buildRegionUniforms(regions, undefined).active).toBe(false);
    expect(buildRegionUniforms(regions, {}).active).toBe(false);
  });

  it('is INACTIVE when every override is empty', () => {
    expect(buildRegionUniforms(regions, { crown: {} }).active).toBe(false);
    expect(buildRegionUniforms(regions, { crown: { finish: 'original' } }).active).toBe(false);
  });

  it('maps ids to slots and writes the linear tint at the right offset', () => {
    const u = buildRegionUniforms(regions, { brim: { hex: '#ffffff' } });
    expect(u.active).toBe(true);
    expect(u.indexOf).toEqual({ crown: 0, brim: 1, badge: 2 });
    expect(u.amount[0]).toBe(0);
    expect(u.amount[1]).toBe(1);
    expect(close(u.tint[3], 1, 1e-6)).toBe(true);
    expect(close(u.ref[1], 0.4, 1e-6)).toBe(true);
  });

  it('REFUSES a region the template marked not recolourable, even if state names it', () => {
    const u = buildRegionUniforms(regions, { badge: { hex: '#ff0000' } });
    expect(u.active).toBe(false);
    expect(u.amount[2]).toBe(0);
  });

  it('ignores an override naming a region that does not exist', () => {
    expect(buildRegionUniforms(regions, { nope: { hex: '#ff0000' } }).active).toBe(false);
  });

  it('applies a finish as metalness/roughness plus its colour', () => {
    const u = buildRegionUniforms(regions, { crown: { finish: 'gold' } });
    expect(u.matAmount[0]).toBe(1);
    expect(u.metalness[0]).toBe(1);
    expect(close(u.roughness[0], 0.24, 1e-6)).toBe(true);
    expect(u.amount[0]).toBe(1);
  });

  it('sizes every array to MAX_REGIONS and truncates a longer template', () => {
    const many = Array.from({ length: MAX_REGIONS + 4 }, (_, i) => ({
      id: `r${i}`, recolourable: true, refLuminance: 0.2,
    }));
    const u = buildRegionUniforms(many, { r0: { hex: '#ff0000' }, [`r${MAX_REGIONS + 1}`]: { hex: '#00ff00' } });
    expect(u.tint.length).toBe(MAX_REGIONS * 3);
    expect(u.amount.length).toBe(MAX_REGIONS);
    expect(Object.keys(u.indexOf).length).toBe(MAX_REGIONS);
    expect(u.amount[0]).toBe(1);
  });

  it('does not read inherited Object.prototype keys as overrides', () => {
    const hostile = Object.create({ crown: { hex: '#ff0000' } }) as Record<string, { hex?: string }>;
    expect(buildRegionUniforms(regions, hostile).active).toBe(false);
  });

  it('survives a null override value', () => {
    const u = buildRegionUniforms(regions, { crown: null as unknown as { hex?: string } });
    expect(u.active).toBe(false);
  });
});

describe('shader patches', () => {
  // Minimal stand-ins for three's generated sources: only the anchors matter.
  const VERT = '#include <common>\nvoid main() {\n#include <begin_vertex>\n}';
  const FRAG = [
    '#include <common>',
    'void main() {',
    'vec4 diffuseColor = vec4( diffuse, opacity );',
    '#include <map_fragment>',
    '#include <roughnessmap_fragment>',
    '#include <metalnessmap_fragment>',
    '}',
  ].join('\n');

  it('declares the attribute and forwards it', () => {
    const p = regionTintVertexPatch(VERT);
    expect(p.patched).toBe(true);
    expect(p.source).toContain(`attribute float ${REGION_ATTRIBUTE};`);
    expect(p.source).toContain('varying float vRegion;');
    expect(p.source).toContain(`vRegion = ${REGION_ATTRIBUTE};`);
  });

  it('refuses a HALF patch — a declared-but-unwritten varying tints everything as region 0', () => {
    const noBegin = '#include <common>\nvoid main() {}';
    const p = regionTintVertexPatch(noBegin);
    expect(p.patched).toBe(false);
    expect(p.source).toBe(noBegin);
  });

  it('injects the tint AFTER map_fragment, so diffuseColor already holds the bake', () => {
    const p = regionTintFragmentPatch(FRAG);
    expect(p.patched).toBe(true);
    const mapAt = p.source.indexOf('#include <map_fragment>');
    const tintAt = p.source.indexOf('uRegionTint[ri]');
    expect(mapAt).toBeGreaterThanOrEqual(0);
    expect(tintAt).toBeGreaterThan(mapAt);
  });

  it('declares every uniform at the MAX_REGIONS bound', () => {
    const { source } = regionTintFragmentPatch(FRAG);
    for (const name of ['uRegionTint', 'uRegionAmount', 'uRegionRef', 'uRegionRough', 'uRegionMetal', 'uRegionMatAmount']) {
      expect(source).toContain(`${name}[${MAX_REGIONS}]`);
    }
  });

  it('the GLSL uses the SAME constants as the TypeScript twin', () => {
    const { source } = regionTintFragmentPatch(FRAG);
    expect(source).toContain('vec3(0.2126, 0.7152, 0.0722)');
    expect(source).toContain(MAX_TINT_RATIO.toFixed(1));
    expect(source).toContain(MIN_REF_LUMINANCE.toExponential());
  });

  it('clamps the region index in GLSL — an out-of-range uniform read is undefined behaviour', () => {
    const { source } = regionTintFragmentPatch(FRAG);
    expect(source).toContain(`clamp(ri, 0, ${MAX_REGIONS - 1})`);
  });

  it('reports patched:false and returns the source untouched when an anchor is missing', () => {
    const stale = 'void main() {}';
    expect(regionTintVertexPatch(stale)).toEqual({ source: stale, patched: false });
    expect(regionTintFragmentPatch(stale).patched).toBe(false);
  });

  it('still reports patched for a material with no roughness/metalness chunks', () => {
    const basic = '#include <common>\n#include <map_fragment>';
    expect(regionTintFragmentPatch(basic).patched).toBe(true);
  });

  it('the cache key carries the array bound, so changing MAX_REGIONS cannot reuse an old program', () => {
    expect(REGION_TINT_CACHE_KEY).toContain(String(MAX_REGIONS));
  });
});

describe('regionOverridesKey', () => {
  it('is empty for absent overrides', () => {
    expect(regionOverridesKey(null)).toBe('');
    expect(regionOverridesKey(undefined)).toBe('');
    expect(regionOverridesKey({})).toBe('');
  });

  it('is order-independent, so a re-serialized config does not re-clone the model', () => {
    const a = regionOverridesKey({ crown: { hex: '#ff0000' }, brim: { hex: '#00ff00' } });
    const b = regionOverridesKey({ brim: { hex: '#00ff00' }, crown: { hex: '#ff0000' } });
    expect(a).toBe(b);
  });

  it('treats an explicit undefined field the same as an absent one', () => {
    expect(regionOverridesKey({ crown: { hex: '#ff0000', finish: undefined } }))
      .toBe(regionOverridesKey({ crown: { hex: '#ff0000' } }));
  });

  it('drops entries that say nothing, so adding an empty part is not a re-render', () => {
    expect(regionOverridesKey({ crown: {} })).toBe('');
  });

  it('changes when a value changes', () => {
    expect(regionOverridesKey({ crown: { hex: '#ff0000' } }))
      .not.toBe(regionOverridesKey({ crown: { hex: '#ff0001' } }));
  });
});
