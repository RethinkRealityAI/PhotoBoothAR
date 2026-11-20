import { describe, it, expect } from 'vitest';
import { CONTACT_OPACITY, CONTACT_SIZE, contactsKey, normalizeContacts } from './spec';
import {
  CONTACT_MIN_POINTS, CONTACT_STYLES, CONTACT_STYLE_MAP, EYES, EYE_FAN_SHRINK, EYE_FAN_VERTS, IRIS_RADIUS_CM, LENS_SPAN,
  defaultContactColors, eyeFanIndices, hexToRgb, lensTexel, paintLensTexture, pupilMask, writeEyeFan, type IrisSample,
} from './lens';
import { hasFacePaintPigment, normalizeFacePaint } from '../facePaint/spec';
import { ADD_ONS } from '../studio/addOns';

describe('normalizeContacts (untrusted jsonb)', () => {
  it('keeps a valid spec and clamps the numbers', () => {
    expect(normalizeContacts({ style: 'cat', colors: ['#D9A514'], opacity: 0.9, size: 1.1 })).toEqual({ style: 'cat', colors: ['#d9a514'], opacity: 0.9, size: 1.1 });
    expect(normalizeContacts({ style: 'glow', colors: [], opacity: 9, size: -3 })).toEqual({ style: 'glow', colors: [], opacity: CONTACT_OPACITY.max, size: CONTACT_SIZE.min });
  });
  it('defaults missing numbers, drops junk colours and caps them at two', () => {
    expect(normalizeContacts({ style: 'natural', colors: ['red', '#111111', 7, '#222222', '#333333'] })).toEqual({
      style: 'natural', colors: ['#111111', '#222222'], opacity: CONTACT_OPACITY.default, size: CONTACT_SIZE.default,
    });
  });
  it('is null for anything without a usable style, and never throws', () => {
    for (const raw of [null, undefined, 3, 'x', [], {}, { style: 5 }, { style: 'Bad Id!' }, { style: '' }]) expect(normalizeContacts(raw)).toBeNull();
  });
  it('an unknown style id survives the shape gate (it draws nothing later)', () => {
    expect(normalizeContacts({ style: 'from-the-future' })?.style).toBe('from-the-future');
    expect(lensTexel('from-the-future', [], 0.6, 0)).toEqual([0, 0, 0, 0]);
  });
  it('contactsKey changes with every visible field', () => {
    const base = { style: 'natural', colors: ['#111111'], opacity: 0.8, size: 1 };
    const k = contactsKey(base);
    expect(contactsKey({ ...base, style: 'vivid' })).not.toBe(k);
    expect(contactsKey({ ...base, colors: ['#111112'] })).not.toBe(k);
    expect(contactsKey({ ...base, opacity: 0.81 })).not.toBe(k);
    expect(contactsKey({ ...base, size: 1.01 })).not.toBe(k);
    expect(contactsKey(null)).toBe('');
  });
});

describe('contacts on the face-paint layer', () => {
  it('a look without contacts normalizes to exactly its old keys', () => {
    const out = normalizeFacePaint({ design: 'game-day', colors: ['#1d4ed8'], opacity: 0.9 });
    expect(JSON.stringify(out)).toBe('{"design":"game-day","colors":["#1d4ed8"],"opacity":0.9}');
  });
  it('a contacts-only layer is valid, and reports no pigment', () => {
    const out = normalizeFacePaint({ design: 'none', colors: [], opacity: 0.9, eyes: { style: 'natural', colors: ['#3f7fd0'], opacity: 0.85, size: 1 } })!;
    expect(out.eyes).toEqual({ style: 'natural', colors: ['#3f7fd0'], opacity: 0.85, size: 1 });
    expect(hasFacePaintPigment(out)).toBe(false);
  });
  it('junk contacts are dropped; nothing at all is still null', () => {
    expect(normalizeFacePaint({ design: 'tiger', colors: [], opacity: 1, eyes: { style: 9 } })).toEqual({ design: 'tiger', colors: [], opacity: 1 });
    expect(normalizeFacePaint({ design: 'none', eyes: 'x' })).toBeNull();
  });
});

describe('style registry', () => {
  it('has unique ids, a Power-Up entry, and valid default colours for every slot', () => {
    expect(new Set(CONTACT_STYLES.map((s) => s.id)).size).toBe(CONTACT_STYLES.length);
    expect(ADD_ONS.some((a) => a.id === 'contacts')).toBe(true);
    for (const s of CONTACT_STYLES) {
      expect(s.slots.length).toBeGreaterThanOrEqual(1);
      expect(s.slots.length).toBeLessThanOrEqual(2);
      for (const c of defaultContactColors(s.id)) expect(hexToRgb(c)).not.toBeNull();
      expect(normalizeContacts({ style: s.id, colors: defaultContactColors(s.id) })).not.toBeNull();
    }
    expect(defaultContactColors('nope')).toEqual([]);
  });
});

describe('lensTexel', () => {
  it('is transparent past the iris edge for every iris lens, opaque everywhere for Full Eye', () => {
    for (const s of CONTACT_STYLES) {
      const out = lensTexel(s.id, defaultContactColors(s.id), LENS_SPAN * 0.99, 0);
      if (s.fullEye) expect(out[3]).toBe(1);
      else expect(out[3]).toBeLessThan(0.02);
    }
  });
  it('open-pupil lenses leave the real pupil showing; shaped pupils cover it with a dark shape', () => {
    expect(lensTexel('natural', ['#3f7fd0'], 0, 0)[3]).toBe(0);
    expect(lensTexel('vivid', ['#18b08a'], 0.1, 0.1)[3]).toBe(0);
    expect(lensTexel('natural', ['#3f7fd0'], 0.7, 0)[3]).toBeGreaterThan(0.7);
    for (const id of ['cat', 'heart', 'star']) {
      const centre = lensTexel(id, defaultContactColors(id), 0, 0.02);
      expect(centre[3]).toBeGreaterThan(0.95);
      expect(Math.max(centre[0], centre[1], centre[2])).toBeLessThan(0.1);
      const iris = lensTexel(id, defaultContactColors(id), 0.75, 0.3);
      expect(Math.max(iris[0], iris[1], iris[2])).toBeGreaterThan(0.3);
    }
  });
  it('takes its colour from the spec (a blue lens is blue, a red one red)', () => {
    const blue = lensTexel('vivid', ['#0000ff'], 0.6, 0.1);
    expect(blue[2]).toBeGreaterThan(blue[0] + 0.3);
    const red = lensTexel('vivid', ['#ff0000'], 0.6, 0.1);
    expect(red[0]).toBeGreaterThan(red[2] + 0.3);
  });
  it('starburst runs from the burst colour at the pupil to the outer colour at the rim', () => {
    const inner = lensTexel('starburst', ['#0000ff', '#ff0000'], 0.33, 0);
    const outer = lensTexel('starburst', ['#0000ff', '#ff0000'], 0.9, 0);
    expect(inner[0]).toBeGreaterThan(inner[2]);
    expect(outer[2]).toBeGreaterThan(outer[0]);
  });
  it('a light Full Eye gets a small pupil, a dark one stays flat', () => {
    expect(lensTexel('full-eye', ['#f4f4f4'], 0, 0)[0]).toBeLessThan(0.1);
    expect(lensTexel('full-eye', ['#f4f4f4'], 0.5, 0)[0]).toBeGreaterThan(0.9);
    expect(lensTexel('full-eye', ['#060608'], 0, 0)[0]).toBeLessThan(0.1);
  });
  it('the slit is tall and narrow; the heart is wider at the top than the bottom', () => {
    expect(pupilMask('slit', 0, 0.6)).toBeGreaterThan(0.9);
    expect(pupilMask('slit', 0.3, 0)).toBe(0);
    expect(pupilMask('heart', 0.25, 0.12)).toBeGreaterThan(0.9);
    expect(pupilMask('heart', 0.25, -0.25)).toBe(0);
    expect(pupilMask('star', 0, 0.45)).toBeGreaterThan(0.9); // the top point
    expect(pupilMask('star', 0, -0.4)).toBe(0); // a valley, straight down
  });
  it('paintLensTexture fills straight-alpha bytes, top row first', () => {
    const size = 16;
    const data = new Uint8ClampedArray(size * size * 4);
    paintLensTexture(data, size, { style: 'cat', colors: ['#d9a514'] });
    const at = (i: number, j: number) => Array.from(data.slice((j * size + i) * 4, (j * size + i) * 4 + 4));
    expect(at(0, 0)[3]).toBe(0); // corner: outside the lens
    expect(at(8, 8)[3]).toBe(255); // centre: covered
    expect(at(8, 8)[0]).toBeLessThan(40); // …by the dark slit
    expect(at(12, 8)[0]).toBeGreaterThan(120); // iris colour beside it
    // An unknown style paints nothing.
    const blank = new Uint8ClampedArray(size * size * 4);
    paintLensTexture(blank, size, { style: 'nope', colors: [] });
    expect(blank.every((v) => v === 0)).toBe(true);
  });
});

describe('eye geometry', () => {
  /** A synthetic 478-point mesh: each eye an ellipse of 16 contour points with an iris inside. */
  function mesh(irisR = 0.6, irisDx = 0.2): Float32Array {
    const v = new Float32Array(CONTACT_MIN_POINTS * 3);
    for (const [eye, cx] of [[EYES.right, -3.2], [EYES.left, 3.2]] as const) {
      eye.contour.forEach((i, k) => {
        const a = (k / eye.contour.length) * Math.PI * 2;
        v[i * 3] = cx + 1.4 * Math.cos(a); v[i * 3 + 1] = 3 + 0.5 * Math.sin(a); v[i * 3 + 2] = 5;
      });
      v[eye.iris * 3] = cx + irisDx; v[eye.iris * 3 + 1] = 3.05; v[eye.iris * 3 + 2] = 4.8;
      eye.ring.forEach((i, k) => {
        const a = (k / 4) * Math.PI * 2;
        v[i * 3] = cx + irisDx + irisR * Math.cos(a); v[i * 3 + 1] = 3.05 + irisR * Math.sin(a); v[i * 3 + 2] = 4.8;
      });
    }
    return v;
  }
  const iris: IrisSample = { x: 0, y: 0, z: 0, r: 0 };

  it('the two eyes use disjoint landmarks and 16-point contours', () => {
    expect(EYES.right.contour).toHaveLength(EYE_FAN_VERTS - 1);
    expect(EYES.left.contour).toHaveLength(EYE_FAN_VERTS - 1);
    const all = [...EYES.right.contour, ...EYES.left.contour, EYES.right.iris, EYES.left.iris, ...EYES.right.ring, ...EYES.left.ring];
    expect(new Set(all).size).toBe(all.length);
    expect(Math.max(...all)).toBe(CONTACT_MIN_POINTS - 1);
  });
  it('fan indices cover every rim edge once and close the loop', () => {
    const idx = eyeFanIndices(17);
    expect(idx).toHaveLength(48);
    expect(idx.slice(0, 3)).toEqual([17, 18, 19]);
    expect(idx.slice(-3)).toEqual([17, 33, 18]);
  });
  it('writes the centre, a rim pulled in by the shrink, and the iris centre + radius', () => {
    const out = new Float32Array(EYE_FAN_VERTS * 3);
    expect(writeEyeFan(mesh(), EYES.right, false, out, 0, iris)).toBe(true);
    expect(out[0]).toBeCloseTo(-3.2, 4);
    expect(out[1]).toBeCloseTo(3, 4);
    // first rim point: (cx + 1.4, 3) pulled 10% toward the centre
    expect(out[3]).toBeCloseTo(-3.2 + 1.4 * (1 - EYE_FAN_SHRINK), 4);
    expect(iris.x).toBeCloseTo(-3.0, 4);
    expect(iris.r).toBeCloseTo(0.6, 4);
  });
  it('mirror reflects x for the rim and the iris alike', () => {
    const out = new Float32Array(EYE_FAN_VERTS * 3);
    writeEyeFan(mesh(), EYES.left, true, out, 0, iris);
    expect(out[0]).toBeCloseTo(-3.2, 4);
    expect(iris.x).toBeCloseTo(-3.4, 4);
  });
  it('clamps a noisy iris radius to the human band', () => {
    const out = new Float32Array(EYE_FAN_VERTS * 3);
    writeEyeFan(mesh(2), EYES.right, false, out, 0, iris);
    expect(iris.r).toBe(IRIS_RADIUS_CM.max);
    writeEyeFan(mesh(0.05), EYES.right, false, out, 0, iris);
    expect(iris.r).toBe(IRIS_RADIUS_CM.min);
  });
  it('refuses a mesh without iris points, or with a non-finite value', () => {
    const out = new Float32Array(EYE_FAN_VERTS * 3);
    expect(writeEyeFan(new Float32Array(468 * 3), EYES.right, false, out, 0, iris)).toBe(false);
    const bad = mesh();
    bad[EYES.right.iris * 3] = NaN;
    expect(writeEyeFan(bad, EYES.right, false, out, 0, iris)).toBe(false);
    const bad2 = mesh();
    bad2[EYES.left.contour[3] * 3 + 1] = Infinity;
    expect(writeEyeFan(bad2, EYES.left, false, out, 0, iris)).toBe(false);
  });
  it('every style in the map is the registry entry', () => {
    for (const s of CONTACT_STYLES) expect(CONTACT_STYLE_MAP[s.id]).toBe(s);
  });
});
