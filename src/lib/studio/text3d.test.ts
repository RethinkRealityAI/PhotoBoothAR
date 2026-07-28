import { describe, it, expect } from 'vitest';
import {
  catenaryPoints,
  linkFrames,
  linkRadii,
  clampName,
  strippedChars,
  fitScaleToWidth,
  validateSpec,
  defaultSpecFor,
  materialWarning,
  kindHasChain,
  MATERIAL_MAP,
  MATERIAL_PRESETS,
  KIND_ANCHOR,
  KIND_DIMS,
  TEXT3D_KINDS,
  TEXT_CHARS,
  TEXT_HEIGHT_CM,
  DEPTH_CM,
  SAG_CM,
  CHAIN_LINKS,
  FONT_IDS,
  type Text3DSpec,
} from './text3d';

/** A stand-in for a typeface JSON's glyph map: latin letters, digits, space and
 *  a couple of punctuation marks. Values are objects, like the real `glyphs`. */
const GLYPHS: Record<string, unknown> = Object.fromEntries(
  [
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'0123456789',
    ' ',
    '-',
    "'",
  ].map((c) => [c, { ha: 100, o: '' }]),
);

/** Euclidean gaps between consecutive points. */
function gaps(pts: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    out.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return out;
}

describe('catenaryPoints', () => {
  it('pins both endpoints to y = 0 at ±width/2', () => {
    const pts = catenaryPoints(29, 15, 3);
    expect(pts).toHaveLength(29);
    expect(pts[0].x).toBeCloseTo(-7.5, 10);
    expect(pts[0].y).toBeCloseTo(0, 10);
    expect(pts[28].x).toBeCloseTo(7.5, 10);
    expect(pts[28].y).toBeCloseTo(0, 10);
  });

  it('dips to exactly -sag at the midpoint', () => {
    for (const sag of [1, 2, 3, 5]) {
      const pts = catenaryPoints(29, 15, sag);
      const mid = pts[14];
      expect(mid.x).toBeCloseTo(0, 6);
      expect(mid.y).toBeCloseTo(-sag, 3);
    }
  });

  it('never rises above the endpoints and never dips below the sag', () => {
    const pts = catenaryPoints(28, 15, 3);
    for (const p of pts) {
      expect(p.y).toBeLessThanOrEqual(1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-3 - 1e-6);
    }
  });

  it('is symmetric about x = 0', () => {
    const pts = catenaryPoints(29, 15, 3);
    for (let i = 0; i < pts.length; i++) {
      const mirror = pts[pts.length - 1 - i];
      expect(pts[i].x).toBeCloseTo(-mirror.x, 6);
      expect(pts[i].y).toBeCloseTo(mirror.y, 6);
    }
  });

  it('spaces points evenly by arc length, not by x', () => {
    // Even-x spacing on a sagging curve makes the end gaps far longer than the
    // middle ones — that is precisely the artefact the resample removes.
    for (const [n, sag] of [[28, 3], [16, 5], [48, 1]] as const) {
      const g = gaps(catenaryPoints(n, 15, sag));
      expect(Math.max(...g) / Math.min(...g)).toBeLessThan(1.15);
    }
  });

  it('degenerates to an evenly spaced straight line at zero sag', () => {
    const pts = catenaryPoints(5, 10, 0);
    expect(pts.map((p) => p.y)).toEqual([0, 0, 0, 0, 0]);
    expect(pts.map((p) => p.x)).toEqual([-5, -2.5, 0, 2.5, 5]);
  });

  it('clamps a degenerate point count to two', () => {
    expect(catenaryPoints(1, 15, 3)).toHaveLength(2);
    expect(catenaryPoints(0, 15, 3)).toHaveLength(2);
  });
});

describe('linkFrames', () => {
  const pts = catenaryPoints(28, 15, 3);
  const frames = linkFrames(pts, 0.88);

  it('emits one frame per point, at that point', () => {
    expect(frames).toHaveLength(pts.length);
    frames.forEach((f, i) => {
      expect(f.x).toBe(pts[i].x);
      expect(f.y).toBe(pts[i].y);
      expect(f.len).toBe(0.88);
    });
  });

  it('alternates roll 0 / 90° so neighbouring links interlock', () => {
    frames.forEach((f, i) => expect(f.roll).toBeCloseTo(i % 2 === 0 ? 0 : Math.PI / 2, 12));
    // Every adjacent pair differs — the property the alternation exists for.
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].roll).not.toBe(frames[i - 1].roll);
    }
  });

  it('reads the tangent as flat on a straight chain', () => {
    const straight = linkFrames(catenaryPoints(6, 10, 0), 0.5);
    for (const f of straight) expect(f.angle).toBeCloseTo(0, 12);
  });

  it('tilts down on the left of the dip and up on the right', () => {
    expect(frames[0].angle).toBeLessThan(0);
    expect(frames[frames.length - 1].angle).toBeGreaterThan(0);
    expect(frames[0].angle).toBeCloseTo(-frames[frames.length - 1].angle, 6);
  });

  it('handles empty, single-point and zero-length-window input', () => {
    expect(linkFrames([], 0.5)).toEqual([]);
    expect(linkFrames([{ x: 1, y: 2 }], 0.5)).toEqual([{ x: 1, y: 2, angle: 0, roll: 0, len: 0.5 }]);
    // A zero window must fall back to the neighbour difference, not atan2(0,0).
    const zeroWindow = linkFrames(catenaryPoints(5, 10, 3), 0);
    expect(zeroWindow[0].angle).toBeLessThan(0);
    expect(zeroWindow.every((f) => Number.isFinite(f.angle))).toBe(true);
  });
});

describe('linkRadii', () => {
  it('reproduces the necklace reference at its default spacing', () => {
    // 28 links across a 15cm / 3cm-sag catenary ≈ 0.59cm apart ⇒ R .35 / r .09.
    const spacing = gaps(catenaryPoints(28, 15, 3))[0];
    const { radius, tube } = linkRadii(spacing);
    expect(radius).toBeCloseTo(0.35, 2);
    expect(tube).toBeCloseTo(0.09, 2);
  });

  it('keeps every link wider than its spacing, at both link-count extremes', () => {
    for (const n of [16, 28, 48]) {
      const spacing = gaps(catenaryPoints(n, 15, 3))[0];
      const { radius, tube } = linkRadii(spacing);
      expect(2 * (radius + tube)).toBeGreaterThan(spacing);
    }
  });

  it('returns finite positive radii for degenerate spacing', () => {
    for (const s of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { radius, tube } = linkRadii(s);
      expect(radius).toBeGreaterThan(0);
      expect(tube).toBeGreaterThan(0);
      expect(Number.isFinite(radius)).toBe(true);
    }
  });
});

describe('clampName', () => {
  it('trims and keeps supported characters', () => {
    expect(clampName('  Jenna  ', GLYPHS)).toBe('Jenna');
    expect(clampName("Jenna-Jake's", GLYPHS)).toBe("Jenna-Jake's");
  });

  it('strips characters the typeface has no glyph for', () => {
    expect(clampName('Ja✨ke', GLYPHS)).toBe('Jake');
    expect(clampName('Zoë', GLYPHS)).toBe('Zo');
    expect(clampName('a\nb\tc', GLYPHS)).toBe('abc');
  });

  it('clamps to 14 characters, counting only supported ones', () => {
    expect(clampName('ABCDEFGHIJKLMNOPQRST', GLYPHS)).toHaveLength(TEXT_CHARS.max);
    // The stripped emoji must not eat into the 14-character budget.
    expect(clampName('🎉ABCDEFGHIJKLMN', GLYPHS)).toBe('ABCDEFGHIJKLMN');
  });

  it('never counts inherited Object properties as glyphs', () => {
    expect(clampName('constructor', {})).toBe('');
    expect(clampName('t', {})).toBe('');
  });

  it('returns a non-empty name for any input with a supported character', () => {
    for (const input of ['A', ' z ', '✨Q✨', '1']) {
      expect(clampName(input, GLYPHS).length).toBeGreaterThanOrEqual(TEXT_CHARS.min);
    }
  });

  it('returns empty only when nothing survives', () => {
    expect(clampName('', GLYPHS)).toBe('');
    expect(clampName('   ', GLYPHS)).toBe('');
    expect(clampName('✨🎉', GLYPHS)).toBe('');
  });
});

describe('strippedChars', () => {
  it('lists each unsupported character once, in order', () => {
    expect(strippedChars('Zoë ✨ Zoë', GLYPHS)).toEqual(['ë', '✨']);
    expect(strippedChars('Jenna', GLYPHS)).toEqual([]);
  });
});

describe('fitScaleToWidth', () => {
  it('shrinks an oversized measurement to fit', () => {
    expect(fitScaleToWidth(14, 7)).toBeCloseTo(0.5, 12);
  });

  it('never upscales', () => {
    expect(fitScaleToWidth(2, 7)).toBe(1);
    expect(fitScaleToWidth(7, 7)).toBe(1);
    expect(fitScaleToWidth(0.001, 14)).toBe(1);
  });

  it('leaves degenerate input alone rather than collapsing it', () => {
    expect(fitScaleToWidth(0, 7)).toBe(1);
    expect(fitScaleToWidth(-3, 7)).toBe(1);
    expect(fitScaleToWidth(Number.NaN, 7)).toBe(1);
    expect(fitScaleToWidth(5, 0)).toBe(1);
  });
});

describe('validateSpec', () => {
  const necklace = (patch: Partial<Text3DSpec> = {}): Text3DSpec => ({ ...defaultSpecFor('necklace'), ...patch });

  it('passes every default spec', () => {
    for (const kind of TEXT3D_KINDS) {
      const res = validateSpec(defaultSpecFor(kind));
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
    }
  });

  it('bounds the name length at both ends', () => {
    expect(validateSpec(necklace({ text: '' })).ok).toBe(false);
    expect(validateSpec(necklace({ text: 'A' })).ok).toBe(true);
    expect(validateSpec(necklace({ text: 'A'.repeat(TEXT_CHARS.max) })).ok).toBe(true);
    expect(validateSpec(necklace({ text: 'A'.repeat(TEXT_CHARS.max + 1) })).ok).toBe(false);
  });

  it('bounds text height per kind', () => {
    for (const kind of TEXT3D_KINDS) {
      const r = TEXT_HEIGHT_CM[kind];
      const spec = defaultSpecFor(kind);
      expect(validateSpec({ ...spec, textHeightCm: r.min }).ok).toBe(true);
      expect(validateSpec({ ...spec, textHeightCm: r.max }).ok).toBe(true);
      expect(validateSpec({ ...spec, textHeightCm: r.min - 0.01 }).ok).toBe(false);
      expect(validateSpec({ ...spec, textHeightCm: r.max + 0.01 }).ok).toBe(false);
    }
  });

  it('lets floating text go taller than a necklace pendant', () => {
    expect(TEXT_HEIGHT_CM.floating.max).toBeGreaterThan(TEXT_HEIGHT_CM.necklace.max);
    expect(validateSpec({ ...defaultSpecFor('floating'), textHeightCm: 3.6 }).ok).toBe(true);
    expect(validateSpec(necklace({ textHeightCm: 3.6 })).ok).toBe(false);
  });

  it('bounds thickness', () => {
    expect(validateSpec(necklace({ depthCm: DEPTH_CM.min })).ok).toBe(true);
    expect(validateSpec(necklace({ depthCm: DEPTH_CM.max })).ok).toBe(true);
    expect(validateSpec(necklace({ depthCm: DEPTH_CM.min - 0.05 })).ok).toBe(false);
    expect(validateSpec(necklace({ depthCm: DEPTH_CM.max + 0.05 })).ok).toBe(false);
  });

  it('bounds sag for the necklace and ignores it everywhere else', () => {
    expect(validateSpec(necklace({ sagCm: SAG_CM.min })).ok).toBe(true);
    expect(validateSpec(necklace({ sagCm: SAG_CM.max })).ok).toBe(true);
    expect(validateSpec(necklace({ sagCm: 0.5 })).ok).toBe(false);
    expect(validateSpec(necklace({ sagCm: 6 })).ok).toBe(false);
    // Kinds without a chain carry sag 0 and must not be failed for it.
    expect(validateSpec({ ...defaultSpecFor('nosering'), sagCm: 0 }).ok).toBe(true);
    expect(validateSpec({ ...defaultSpecFor('floating'), sagCm: 0 }).ok).toBe(true);
    expect(validateSpec({ ...defaultSpecFor('earrings'), sagCm: 0 }).ok).toBe(true);
  });

  it('bounds link counts per chained kind and ignores them elsewhere', () => {
    for (const kind of ['necklace', 'earrings'] as const) {
      const r = CHAIN_LINKS[kind]!;
      const spec = defaultSpecFor(kind);
      expect(validateSpec({ ...spec, chainLinks: r.min }).ok).toBe(true);
      expect(validateSpec({ ...spec, chainLinks: r.max }).ok).toBe(true);
      expect(validateSpec({ ...spec, chainLinks: r.min - 1 }).ok).toBe(false);
      expect(validateSpec({ ...spec, chainLinks: r.max + 1 }).ok).toBe(false);
    }
    expect(CHAIN_LINKS.nosering).toBeUndefined();
    expect(validateSpec({ ...defaultSpecFor('nosering'), chainLinks: 0 }).ok).toBe(true);
    expect(validateSpec({ ...defaultSpecFor('floating'), chainLinks: 999 }).ok).toBe(true);
  });

  it('rejects unknown fonts, materials and kinds', () => {
    expect(validateSpec(necklace({ fontId: 'comic' as never })).ok).toBe(false);
    expect(validateSpec(necklace({ material: 'plutonium' as never })).ok).toBe(false);
    const bad = validateSpec(necklace({ kind: 'anklet' as never }));
    expect(bad.ok).toBe(false);
    expect(bad.errors).toHaveLength(1); // an unknown kind short-circuits
  });

  it('reports every broken bound at once', () => {
    const res = validateSpec(necklace({ text: '', depthCm: 9, sagCm: 99, chainLinks: 1 }));
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects non-finite numbers', () => {
    expect(validateSpec(necklace({ textHeightCm: Number.NaN })).ok).toBe(false);
    expect(validateSpec(necklace({ depthCm: Number.POSITIVE_INFINITY })).ok).toBe(false);
  });
});

describe('kind metadata', () => {
  it('gives every kind dimensions, a label anchor and a default spec of that kind', () => {
    for (const kind of TEXT3D_KINDS) {
      expect(KIND_DIMS[kind]).toBeDefined();
      expect(KIND_ANCHOR[kind]).toBeDefined();
      expect(defaultSpecFor(kind).kind).toBe(kind);
      expect(KIND_DIMS[kind].maxTextWidthCm).toBeGreaterThan(0);
    }
  });

  it('anchors earrings to BOTH ears and everything else to one point', () => {
    expect(KIND_ANCHOR.earrings).toEqual(['leftEar', 'rightEar']);
    expect(KIND_ANCHOR.necklace).toBe('chin');
    expect(KIND_ANCHOR.nosering).toBe('noseTip');
    expect(KIND_ANCHOR.floating).toBe('crown');
  });

  it('marks exactly the chained kinds as chained', () => {
    expect(TEXT3D_KINDS.filter(kindHasChain)).toEqual(['necklace', 'earrings']);
    expect(Object.keys(CHAIN_LINKS).sort()).toEqual(['earrings', 'necklace']);
  });

  it('keeps default fonts and materials inside the offered sets', () => {
    for (const kind of TEXT3D_KINDS) {
      const spec = defaultSpecFor(kind);
      expect(FONT_IDS).toContain(spec.fontId);
      expect(MATERIAL_MAP[spec.material]).toBeDefined();
    }
  });
});

describe('materials', () => {
  it('maps every preset by id', () => {
    for (const p of MATERIAL_PRESETS) expect(MATERIAL_MAP[p.id]).toBe(p);
    expect(MATERIAL_PRESETS).toHaveLength(5);
  });

  it('warns only for the mirror finish the booth cannot light', () => {
    expect(materialWarning('chrome')).toBeTruthy();
    expect(materialWarning('gold')).toBeNull();
    expect(materialWarning('neon')).toBeNull();
  });
});
