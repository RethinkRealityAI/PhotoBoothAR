import { describe, it, expect } from 'vitest';
import {
  FINISHES,
  FINISH_MAP,
  FINISH_IDS,
  DEFAULT_FINISH,
  normalizeFinish,
  normalizeTint,
  normalizeTintStrength,
  mixHex,
  resolveFinish,
  hasFinish,
  resolveFinishForRegionTint,
} from './finish';
import { FINISH_TINT_STRENGTH } from './controlSpecs';

describe('finish table integrity', () => {
  it('ids are unique and the map matches the array', () => {
    expect(new Set(FINISH_IDS).size).toBe(FINISH_IDS.length);
    for (const f of FINISHES) expect(FINISH_MAP[f.id]).toBe(f);
  });

  it('every finish is inside physically sane bounds', () => {
    for (const f of FINISHES) {
      expect(f.metalness).toBeGreaterThanOrEqual(0);
      expect(f.metalness).toBeLessThanOrEqual(1);
      expect(f.roughness).toBeGreaterThanOrEqual(0);
      expect(f.roughness).toBeLessThanOrEqual(1);
      expect(f.transmission).toBeGreaterThanOrEqual(0);
      expect(f.transmission).toBeLessThanOrEqual(1);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(0);
    }
  });

  it('only glass needs the expensive MeshPhysicalMaterial path', () => {
    for (const f of FINISHES) expect(f.transmission > 0).toBe(f.id === 'glass');
  });

  it('the default is the untouched export', () => {
    expect(DEFAULT_FINISH).toBe('original');
    expect(FINISH_MAP.original.color).toBeNull();
    expect(FINISH_MAP.original.emissive).toBeNull();
  });
});

describe('normalizeFinish', () => {
  it('accepts every real id', () => {
    for (const id of FINISH_IDS) expect(normalizeFinish(id)).toBe(id);
  });
  it('falls back to original for anything else', () => {
    for (const junk of [undefined, null, '', 'Gold', 'plasma', 7, {}, []]) {
      expect(normalizeFinish(junk)).toBe('original');
    }
  });
});

describe('normalizeTint', () => {
  it('accepts #rrggbb, case-insensitively, and lowercases it', () => {
    expect(normalizeTint('#D4A017')).toBe('#d4a017');
    expect(normalizeTint('  #00ff00  ')).toBe('#00ff00');
  });
  it('expands the #rgb shorthand', () => {
    expect(normalizeTint('#f0a')).toBe('#ff00aa');
  });
  it('rejects everything else rather than throwing into a render loop', () => {
    for (const junk of [undefined, null, '', 'red', '#12345', '#1234567', 'rgb(1,2,3)', 0xff0000, {}]) {
      expect(normalizeTint(junk)).toBeNull();
    }
  });
});

describe('normalizeTintStrength', () => {
  it('clamps into the shared control spec, never declaring its own bounds', () => {
    expect(normalizeTintStrength(-3)).toBe(FINISH_TINT_STRENGTH.min);
    expect(normalizeTintStrength(9)).toBe(FINISH_TINT_STRENGTH.max);
    expect(normalizeTintStrength(0.4)).toBeCloseTo(0.4);
  });
  it('defaults to FULL strength for junk — a host who picks a colour sees it', () => {
    for (const junk of [undefined, null, NaN, 'x', {}]) {
      expect(normalizeTintStrength(junk)).toBe(FINISH_TINT_STRENGTH.max);
    }
  });
  it('reads 0 as a real value, never as missing', () => {
    expect(normalizeTintStrength(0)).toBe(0);
  });
});

describe('mixHex', () => {
  it('returns the endpoints exactly', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
  it('mixes each channel independently', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#ff0000', '#0000ff', 0.5)).toBe('#800080');
  });
  it('clamps t and survives junk without throwing', () => {
    expect(mixHex('#000000', '#ffffff', -5)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 99)).toBe('#ffffff');
    expect(mixHex('#123456', 'not-a-colour', 0.5)).toBe('#123456');
    expect(mixHex('#123456', '#ffffff', NaN)).toBe('#ffffff'); // non-finite = full
  });
});

describe('resolveFinish', () => {
  it('returns NULL for an untouched object — the caller must then not touch the material', () => {
    expect(resolveFinish(undefined, undefined, undefined, '#808080')).toBeNull();
    expect(resolveFinish('original', null, 1, '#808080')).toBeNull();
    // Junk that normalizes to the defaults is still "untouched".
    expect(resolveFinish('bogus', 'not-a-colour', 'x', '#808080')).toBeNull();
  });

  it('applies a finish without a tint, forcing that finish own colour', () => {
    const o = resolveFinish('gold', null, 1, '#808080')!;
    expect(o.color).toBe('#D4A017');
    expect(o.metalness).toBe(1);
    expect(o.physical).toBe(false);
  });

  it('leaves the model albedo alone for finishes that have no colour of their own', () => {
    const o = resolveFinish('matte', null, 1, '#808080')!;
    expect(o.color).toBeNull();
    expect(o.roughness).toBeGreaterThan(0.8);
  });

  it('a tint alone washes over the MESH colour, so it is a wash and not a repaint', () => {
    const o = resolveFinish('original', '#ffffff', 0.5, '#000000')!;
    expect(o.color).toBe('#808080');
  });

  it('the same tint on a different mesh colour gives a different result', () => {
    const a = resolveFinish('original', '#ff0000', 0.5, '#000000')!;
    const b = resolveFinish('original', '#ff0000', 0.5, '#ffffff')!;
    expect(a.color).not.toBe(b.color);
  });

  it('a tint over a finish washes the FINISH colour, not the model albedo', () => {
    const o = resolveFinish('gold', '#000000', 1, '#00ff00')!;
    expect(o.color).toBe('#000000'); // full-strength tint replaces gold
    const half = resolveFinish('gold', '#000000', 0.5, '#00ff00')!;
    expect(half.color).toBe(mixHex('#D4A017', '#000000', 0.5));
  });

  it('neon takes its GLOW from the tint — the body stays near-black', () => {
    const plain = resolveFinish('neon', null, 1, '#808080')!;
    expect(plain.emissive).toBe('#7DF9FF');
    expect(plain.emissiveIntensity).toBeGreaterThan(1);
    const pink = resolveFinish('neon', '#ff00aa', 1, '#808080')!;
    expect(pink.emissive).toBe('#ff00aa');
  });

  it('glass is the only finish that asks for the transmission pass', () => {
    const g = resolveFinish('glass', null, 1, '#808080')!;
    expect(g.physical).toBe(true);
    expect(g.transparent).toBe(true);
    expect(g.transmission).toBeGreaterThan(0.5);
    for (const id of ['chrome', 'gold', 'matte', 'neon'] as const) {
      expect(resolveFinish(id, null, 1, '#808080')!.physical).toBe(false);
    }
  });

  it('survives a mesh whose colour is unreadable', () => {
    const o = resolveFinish('original', '#ff0000', 1, 'not-a-colour')!;
    expect(o.color).toBe('#ff0000');
  });
});

describe('hasFinish', () => {
  it('is false only for a genuinely untouched object', () => {
    expect(hasFinish(undefined, undefined)).toBe(false);
    expect(hasFinish('original', null)).toBe(false);
    expect(hasFinish('gold', null)).toBe(true);
    expect(hasFinish('original', '#ff0000')).toBe(true);
  });
});

describe('resolveFinishForRegionTint', () => {
  it('surrenders the colour so the region patch is not multiplied into', () => {
    const g = resolveFinishForRegionTint('gold', null, 1, '#808080')!;
    expect(g.color).toBeNull();
    expect(g.metalness).toBe(FINISH_MAP.gold.metalness);
    expect(g.roughness).toBe(FINISH_MAP.gold.roughness);
  });

  it('keeps every non-colour property the plain resolution produces', () => {
    const plain = resolveFinish('glass', null, 1, '#808080')!;
    const region = resolveFinishForRegionTint('glass', null, 1, '#808080')!;
    expect({ ...region, color: plain.color }).toEqual(plain);
  });

  it('is null for `original` EVEN WITH a tint — writing its placeholder PBR values would flatten an imported material', () => {
    expect(resolveFinishForRegionTint('original', '#ff0000', 1, '#808080')).toBeNull();
    expect(resolveFinishForRegionTint('original', null, 1, '#808080')).toBeNull();
    expect(resolveFinishForRegionTint(undefined, undefined, undefined, '#808080')).toBeNull();
  });

  it('keeps neon\'s emissive, which is not the base colour and is not the region\'s to own', () => {
    const n = resolveFinishForRegionTint('neon', null, 1, '#808080')!;
    expect(n.color).toBeNull();
    expect(n.emissive).toBe(FINISH_MAP.neon.emissive);
    expect(n.emissiveIntensity).toBeGreaterThan(0);
  });
});
