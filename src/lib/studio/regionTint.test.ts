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
  softShoulder,
  TINT_SHOULDER_KNEE,
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

describe('softShoulder — the highlight rolloff', () => {
  it('is the IDENTITY below the knee, so dark and mid swatches are unchanged', () => {
    for (const x of [0, 0.01, 0.2158605, 0.5, TINT_SHOULDER_KNEE]) {
      expect(softShoulder(x)).toBe(x);
    }
  });

  it('never reaches 1, however hard it is pushed', () => {
    expect(softShoulder(1)).toBeLessThan(1);
    expect(softShoulder(3)).toBeLessThan(1);
    expect(softShoulder(1e6)).toBeLessThan(1);
    expect(softShoulder(1e6)).toBeGreaterThan(0.99);
  });

  it('is STRICTLY increasing across the whole range — this is the detail a clamp destroys', () => {
    let prev = -1;
    for (let x = 0; x <= 3; x += 0.001) {
      const y = softShoulder(x);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it('meets the identity segment with matching slope, so there is no crease at the knee', () => {
    const eps = 1e-5;
    const below = (softShoulder(TINT_SHOULDER_KNEE) - softShoulder(TINT_SHOULDER_KNEE - eps)) / eps;
    const above = (softShoulder(TINT_SHOULDER_KNEE + eps) - softShoulder(TINT_SHOULDER_KNEE)) / eps;
    expect(close(below, 1, 1e-3)).toBe(true);
    expect(close(above, 1, 1e-3)).toBe(true);
  });

  it('is defined for junk input rather than propagating NaN into a colour', () => {
    // 0, matching this module's existing convention for non-finite input
    // (srgbByteToLinear(Infinity), tintRatio(NaN)). Neither can occur in the
    // shader — tint is <= 1 and ratio is clamped — but a render loop gets a
    // defined colour rather than a NaN that paints the mesh black-on-some-GPUs.
    expect(softShoulder(NaN)).toBe(0);
    expect(softShoulder(-4)).toBe(0);
    expect(softShoulder(Infinity)).toBe(0);
  });
});

describe('applyRegionTintLinear preserves DETAIL at every swatch brightness', () => {
  /**
   * The Stage A defect, as an assertion. A cream brim came back near-white with
   * its topstitch gone: `swatch x ratio` ran past 1.0 for every texel above the
   * region mean, and 1.0 is the brightest thing a framebuffer holds — so texels
   * that differed in the bake all resolved to the same white.
   *
   * The test is the same at all three brightnesses on purpose. Dark and mid were
   * never broken; asserting them here is what proves the fix did not "fix" them
   * into something new.
   */
  const swatches: [string, string][] = [
    ['dark  (#22304f navy)', '#22304f'],
    ['mid   (#808080 grey)', '#808080'],
    ['light (#e8e2d6 cream)', '#e8e2d6'],
    ['white (#ffffff)', '#ffffff'],
  ];
  // A mid-luminance bake, the case the docblock names: the region mean is 0.18
  // and the two probe texels sit just above it — an ordinary weave highlight,
  // not a specular hotspot.
  const REF = 0.18;
  const probe = (l: number): [number, number, number] => [l, l, l];

  for (const [name, hex] of swatches) {
    it(`keeps two different bake luminances different — ${name}`, () => {
      const tint = hexToLinearRgb(hex)!;
      const dim = applyRegionTintLinear(probe(0.26), tint, REF, 1);
      const bright = applyRegionTintLinear(probe(0.34), tint, REF, 1);
      for (let c = 0; c < 3; c++) {
        expect(bright[c]).toBeGreaterThan(dim[c]);
        // And every channel is a colour a framebuffer can actually hold.
        expect(bright[c]).toBeLessThanOrEqual(1);
      }
    });
  }

  it('is exactly the case a hard clamp flattened: the raw product exceeds 1 for BOTH cream probes', () => {
    const cream = hexToLinearRgb('#e8e2d6')!;
    const rawDim = cream[0] * tintRatio(0.26, REF);
    const rawBright = cream[0] * tintRatio(0.34, REF);
    // Pre-fix both of these clipped to the same 1.0 — no topstitch, no weave.
    expect(rawDim).toBeGreaterThan(1);
    expect(rawBright).toBeGreaterThan(1);
    expect(Math.min(1, rawDim)).toBe(Math.min(1, rawBright));
    // Post-fix they are distinct and still inside range.
    const dim = applyRegionTintLinear([0.26, 0.26, 0.26], cream, REF, 1);
    const bright = applyRegionTintLinear([0.34, 0.34, 0.34], cream, REF, 1);
    expect(bright[0]).toBeGreaterThan(dim[0]);
    expect(bright[0]).toBeLessThan(1);
  });

  it('still lands the region AVERAGE exactly on a light swatch (cream is below the knee)', () => {
    // The knee exists to sit above real swatches. Cream's brightest channel is
    // 0.80695 — this assertion is why the knee is 0.9 and not 0.8.
    const cream = hexToLinearRgb('#e8e2d6')!;
    const out = applyRegionTintLinear([REF, REF, REF], cream, REF, 1); // ratio == 1
    for (let c = 0; c < 3; c++) {
      expect(cream[c]).toBeLessThan(TINT_SHOULDER_KNEE);
      expect(close(out[c], cream[c], 1e-9)).toBe(true);
    }
  });

  it('states white\'s cost out loud: the mean darkens to sRGB 249 to buy highlight range', () => {
    const white = hexToLinearRgb('#ffffff')!;
    const mean = applyRegionTintLinear([REF, REF, REF], white, REF, 1);
    expect(close(mean[0], 0.95, 1e-6)).toBe(true);
    // Which is what makes the highlights above it survive at all.
    const dim = applyRegionTintLinear([0.26, 0.26, 0.26], white, REF, 1);
    const bright = applyRegionTintLinear([0.34, 0.34, 0.34], white, REF, 1);
    expect(bright[0]).toBeGreaterThan(dim[0]);
    expect(dim[0]).toBeGreaterThan(mean[0]);
    expect(bright[0]).toBeLessThan(1);
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

  it('carries the finish emissive so a per-region neon can actually glow', () => {
    const neon = resolveRegionOverride(undefined, 'neon')!;
    expect(neon.emissive).toBe('#7DF9FF');
    expect(neon.emissiveIntensity).toBe(2.2);
  });

  it('a finish with NO emissive returns null, so it cannot black out the asset\'s own glow', () => {
    for (const id of ['gold', 'chrome', 'matte', 'glass']) {
      const r = resolveRegionOverride(undefined, id)!;
      expect(r.emissive).toBeNull();
      expect(r.emissiveIntensity).toBe(0);
    }
    expect(resolveRegionOverride('#112233', undefined)!.emissive).toBeNull();
  });
});

describe('buildRegionUniforms', () => {
  const regions = [
    { id: 'crown', recolourable: true, refLuminance: 0.12 },
    { id: 'brim', recolourable: true, refLuminance: 0.4 },
    { id: 'badge', recolourable: false, refLuminance: 0.3 },
  ];

  it('lights a neon region and leaves every other region\'s emissive alone', () => {
    const u = buildRegionUniforms(regions, { crown: { finish: 'neon' }, brim: { finish: 'gold' } });
    expect(u.emissiveAmount[0]).toBe(1);
    // #7DF9FF linear x 2.2 — non-zero on all three channels.
    for (let c = 0; c < 3; c++) expect(u.emissive[c]).toBeGreaterThan(0);
    // Gold declares no emissive, so the brim is NOT forced to black even though
    // its metalness/roughness are overridden.
    expect(u.matAmount[1]).toBe(1);
    expect(u.emissiveAmount[1]).toBe(0);
    expect(u.emissive[3]).toBe(0);
  });

  it('a colour-only override never touches the emissive arrays', () => {
    const u = buildRegionUniforms(regions, { crown: { hex: '#ff0000' } });
    expect(u.active).toBe(true);
    expect(Array.from(u.emissiveAmount)).toEqual(new Array(MAX_REGIONS).fill(0));
  });

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
    '#include <emissivemap_fragment>',
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
    for (const name of [
      'uRegionTint', 'uRegionAmount', 'uRegionRef', 'uRegionRough', 'uRegionMetal',
      'uRegionMatAmount', 'uRegionEmissive', 'uRegionEmissiveAmount',
    ]) {
      expect(source).toContain(`${name}[${MAX_REGIONS}]`);
    }
  });

  it('routes the tint through the shoulder, at the SAME knee as the TypeScript twin', () => {
    const { source } = regionTintFragmentPatch(FRAG);
    expect(source).toContain('beamwallShoulder(uRegionTint[ri] * ratio)');
    expect(source).toContain(TINT_SHOULDER_KNEE.toFixed(2));
    expect(source).toContain((1 - TINT_SHOULDER_KNEE).toFixed(2));
  });

  it('patches the emissive chunk AFTER totalEmissiveRadiance exists', () => {
    const { source } = regionTintFragmentPatch(FRAG);
    const chunkAt = source.indexOf('#include <emissivemap_fragment>');
    const writeAt = source.indexOf('totalEmissiveRadiance = mix(');
    expect(chunkAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(chunkAt);
  });

  it('still reports patched:true for a shader with NO emissive chunk (MeshBasicMaterial)', () => {
    const basic = ['#include <common>', 'void main() {', '#include <map_fragment>', '}'].join('\n');
    expect(regionTintFragmentPatch(basic).patched).toBe(true);
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
