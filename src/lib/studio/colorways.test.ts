/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  COLORWAYS,
  COLORWAY_MAP,
  COLORWAY_ROLES,
  OUTFIT_COLORWAY_ID,
  colorwayParts,
  complementFor,
  dominantOutfitColor,
  hslToHex,
  outfitColorway,
  rgbToHsl,
  roleForRegionIndex,
} from './colorways';
import { assetTemplateOf, findLibraryAsset } from './assetLibrary';
import { normalizeTemplate, scopeCustomizationToTemplate, type AssetTemplate } from './assetTemplate';
import { FINISH_IDS, DEFAULT_FINISH, normalizeFinish } from './finish';

const HEX6 = /^#[0-9a-f]{6}$/;

/* ── frame fixtures ───────────────────────────────────────────────────────── */

type Px = [number, number, number, number];

function frame(w: number, h: number, paint: (x: number, y: number) => Px): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y);
      const i = (y * w + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
    }
  }
  return out;
}

function solid(w: number, h: number, px: Px): Uint8ClampedArray {
  return frame(w, h, () => px);
}

function channelsOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hueOf(hex: string): number {
  const [r, g, b] = channelsOf(hex);
  return rgbToHsl(r, g, b)[0];
}

function lightnessOf(hex: string): number {
  const [r, g, b] = channelsOf(hex);
  return rgbToHsl(r, g, b)[2];
}

/** Shortest angular distance between two hues, in degrees (0..180). */
function hueGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Deterministic pseudo-noise — a seeded LCG, so this suite never flakes. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SHIRT_RED: Px = [192, 57, 43, 255];
const SHIRT_RED_HEX = '#c0392b';

/* ── the shipped schemes ──────────────────────────────────────────────────── */

describe('the colorway shelf a host actually taps', () => {
  it('ships between 6 and 8 schemes, all with unique ids', () => {
    expect(COLORWAYS.length).toBeGreaterThanOrEqual(6);
    expect(COLORWAYS.length).toBeLessThanOrEqual(8);
    const ids = COLORWAYS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every role of every scheme a valid 6-digit lowercase hex', () => {
    for (const cw of COLORWAYS) {
      for (const role of COLORWAY_ROLES) {
        expect(cw.styles[role]).toBeDefined();
        expect(cw.styles[role].hex).toMatch(HEX6);
      }
    }
  });

  it('names each scheme in words, and keys COLORWAY_MAP by id', () => {
    for (const cw of COLORWAYS) {
      expect(cw.name.trim().length).toBeGreaterThan(2);
      expect(COLORWAY_MAP[cw.id]).toBe(cw);
    }
  });

  it('only ever names a finish that finish.ts actually defines, and never the default', () => {
    for (const cw of COLORWAYS) {
      for (const role of COLORWAY_ROLES) {
        const finish = cw.styles[role].finish;
        if (finish === undefined) continue;
        // normalizeFinish silently falls back to DEFAULT_FINISH for anything it
        // does not know, so an invented id would vanish rather than fail — this
        // is the assertion that catches a typo instead of shipping it.
        expect(normalizeFinish(finish)).toBe(finish);
        expect(FINISH_IDS).toContain(finish);
        expect(finish).not.toBe(DEFAULT_FINISH);
      }
    }
  });

  it('includes at least one finish combo, and puts gold on an accent', () => {
    const withFinish = COLORWAYS.filter((c) =>
      COLORWAY_ROLES.some((r) => c.styles[r].finish !== undefined));
    expect(withFinish.length).toBeGreaterThanOrEqual(2);
    expect(COLORWAYS.some((c) => c.styles.accent.finish === 'gold')).toBe(true);
  });
});

describe('GENERIC BY MANDATE — no legacy-event branding may reach the colorways', () => {
  // The same deny-list assetLibrary.test.ts enforces, for the same owner
  // instruction: the template library is generic content every host shares.
  const BRANDED = [
    'scago', 'hope gala', 'hope-gala', 'hopegala', 'galabooth',
    'jenna', 'jake', 'jennajake', 'jenna-jake',
    'detola', 'wuyi', 'adetoyi', 'theadetoyis',
  ];

  it('has no branded token in any id, name or style', () => {
    for (const cw of COLORWAYS) {
      const haystack = `${cw.id} ${cw.name} ${JSON.stringify(cw.styles)}`.toLowerCase();
      for (const token of BRANDED) expect(haystack).not.toContain(token);
    }
  });
});

/* ── the role contract ────────────────────────────────────────────────────── */

describe('roles map onto authored region order, body-first', () => {
  it('assigns primary / secondary / accent by index', () => {
    expect(roleForRegionIndex(0)).toBe('primary');
    expect(roleForRegionIndex(1)).toBe('secondary');
    expect(roleForRegionIndex(2)).toBe('accent');
    expect(roleForRegionIndex(9)).toBe('accent');
  });

  const cap = (): AssetTemplate => assetTemplateOf(findLibraryAsset('baseball-cap')!)!;

  it('lands crown / brim / button on primary / secondary / accent', () => {
    // The cap is the shipped proof that the contract matches real authored data.
    expect(cap().regions.map((r) => r.id)).toEqual(['crown', 'brim', 'button']);
    const parts = colorwayParts(COLORWAY_MAP['midnight-gold'], cap());
    expect(Object.keys(parts).sort()).toEqual(['brim', 'button', 'crown']);
    expect(parts.crown).toEqual({ hex: '#141a2b' });
    expect(parts.brim).toEqual({ hex: '#20293f' });
    expect(parts.button).toEqual({ hex: '#d4a017', finish: 'gold' });
  });

  it('omits `finish` entirely for a scheme that names none — never stores the default', () => {
    const parts = colorwayParts(COLORWAY_MAP['coastal-blue'], cap());
    for (const id of Object.keys(parts)) {
      expect(parts[id].finish).toBeUndefined();
      expect(parts[id].hex).toMatch(HEX6);
    }
  });

  it('produces parts the REAL validator keeps, unchanged', () => {
    for (const cw of COLORWAYS) {
      const parts = colorwayParts(cw, cap());
      // scopeCustomizationToTemplate is what the render path actually runs; a
      // scheme it rewrote would mean the chip and the render disagree.
      expect(scopeCustomizationToTemplate({ parts }, cap())).toEqual({ parts });
    }
  });

  it('returns an empty map for a missing template rather than throwing', () => {
    expect(colorwayParts(COLORWAYS[0], null)).toEqual({});
    expect(colorwayParts(COLORWAYS[0], undefined)).toEqual({});
  });
});

describe('a LOCKED region is skipped — and never promotes the region after it', () => {
  const fixture = normalizeTemplate({
    id: 'fixture-locked',
    glbUrl: '/models/fixture.glb',
    fitCm: 20,
    regions: [
      { id: 'body', label: 'Body', recolourable: true, defaultHex: '#ffffff', refLuminance: 0.3 },
      { id: 'badge', label: 'Badge', recolourable: false, defaultHex: '#ffffff', refLuminance: 0.3 },
      { id: 'trim', label: 'Trim', recolourable: true, defaultHex: '#ffffff', refLuminance: 0.3 },
      { id: 'stud', label: 'Stud', recolourable: true, defaultHex: '#ffffff', refLuminance: 0.3 },
    ],
    textSlots: [],
    preparedBy: 'human',
  })!;

  it('emits no part for the locked region', () => {
    expect(fixture.regions[1].recolourable).toBe(false);
    const parts = colorwayParts(COLORWAY_MAP['forest-bone'], fixture);
    expect(parts.badge).toBeUndefined();
    expect(Object.keys(parts).sort()).toEqual(['body', 'stud', 'trim']);
  });

  it('keeps every other region on the role its AUTHORED index gives it', () => {
    // The whole point: locking `badge` (index 1) must NOT slide `trim` up into
    // the secondary role. A licensed badge going read-only cannot be allowed to
    // repaint the rest of the piece.
    const cw = COLORWAY_MAP['forest-bone'];
    const parts = colorwayParts(cw, fixture);
    expect(parts.body.hex).toBe(cw.styles.primary.hex);
    expect(parts.trim.hex).toBe(cw.styles.accent.hex);
    expect(parts.stud.hex).toBe(cw.styles.accent.hex);
    expect(parts.trim.hex).not.toBe(cw.styles.secondary.hex);
  });
});

/* ── match my outfit ──────────────────────────────────────────────────────── */

describe('dominantOutfitColor — reading the garment off a camera frame', () => {
  it('returns the colour of a solid frame exactly', () => {
    expect(dominantOutfitColor(solid(60, 60, SHIRT_RED), 60, 60)).toBe(SHIRT_RED_HEX);
  });

  it('IGNORES the top of the frame — that is the guest, not the garment', () => {
    const px = frame(60, 60, (_x, y) => (y < 40 ? [45, 95, 138, 255] : SHIRT_RED));
    expect(dominantOutfitColor(px, 60, 60)).toBe(SHIRT_RED_HEX);
  });

  it('IGNORES the outer bands — that is the room behind them', () => {
    // Deliberately rigged so the crop is the ONLY thing that decides: green
    // owns 65 of the 100 columns and would win outright on the full width, but
    // inside the sampled middle 60% (columns 20..79) red leads 35 to 25.
    // Red-proofed: widen CENTRE_WIDTH to 1 and this test elects the green room.
    const GREEN: Px = [30, 200, 60, 255];
    const px = frame(100, 60, (x, y) =>
      (y < 40 ? [20, 20, 20, 255] : x >= 20 && x < 55 ? SHIRT_RED : GREEN));
    expect(dominantOutfitColor(px, 100, 60)).toBe(SHIRT_RED_HEX);
  });

  it('finds a red shirt inside a noisy frame', () => {
    const rand = lcg(20260729);
    const px = frame(90, 90, (_x, y) => {
      if (y < 60) return [rand() * 255, rand() * 255, rand() * 255, 255];
      // A real garment is not one byte value: jitter every channel, and let a
      // fifth of the region be something else entirely (folds, a lanyard, arms).
      if (rand() < 0.2) return [rand() * 255, rand() * 255, rand() * 255, 255];
      return [
        SHIRT_RED[0] + (rand() - 0.5) * 36,
        SHIRT_RED[1] + (rand() - 0.5) * 36,
        SHIRT_RED[2] + (rand() - 0.5) * 36,
        255,
      ];
    });
    const hex = dominantOutfitColor(px, 90, 90);
    expect(hex).toMatch(HEX6);
    expect(hueGap(hueOf(hex!), hueOf(SHIRT_RED_HEX))).toBeLessThanOrEqual(20);
  });

  it('does not split red across the hue seam — bins are offset by half a bin', () => {
    // hue 350 and hue 10 are the same red garment to a human, and sit in bins
    // 11 and 0 to a naive histogram — 30% each. The green minority is 40%, so
    // a SPLIT histogram elects green and the guest gets a green cap for a red
    // shirt. The half-bin offset puts both reds in bin 0 (60%) and red wins.
    // Red-proofed: remove the offset and this test fails on the green.
    const swatch = (h: number): Px => {
      const [r, g, b] = channelsOf(hslToHex(h, 0.6, 0.5));
      return [r, g, b, 255];
    };
    const reds = [swatch(350), swatch(10)];
    const green = swatch(100);
    // Sampled columns are 20..79 — exactly six periods of 10, so the 30/30/40
    // split holds inside the sampled region, not just across the whole frame.
    const px = frame(100, 60, (x) => (x % 10 < 3 ? reds[0] : x % 10 < 6 ? reds[1] : green));
    const hex = dominantOutfitColor(px, 100, 60);
    expect(hex).toMatch(HEX6);
    expect(hueGap(hueOf(hex!), 0)).toBeLessThanOrEqual(15);
    expect(hueGap(hueOf(hex!), 100)).toBeGreaterThan(40);
  });

  it('returns the dominant NEUTRAL when most of the garment has no hue', () => {
    // 80% mid-grey hoodie, 20% something red. Grey wins, and it is the grey
    // that was actually there — not a mud average with the red.
    const px = frame(100, 60, (x, y) => (y >= 40 && x % 5 === 0 ? SHIRT_RED : [154, 154, 154, 255]));
    expect(dominantOutfitColor(px, 100, 60)).toBe('#9a9a9a');
  });

  it('still prefers a real colour when neutrals are only a minority', () => {
    const px = frame(100, 60, (x, y) => (y >= 40 && x % 5 === 0 ? [154, 154, 154, 255] : SHIRT_RED));
    expect(dominantOutfitColor(px, 100, 60)).toBe(SHIRT_RED_HEX);
  });

  it('returns null for a black frame — there is no colour to read', () => {
    expect(dominantOutfitColor(solid(40, 40, [0, 0, 0, 255]), 40, 40)).toBeNull();
  });

  it('returns null for a fully transparent frame', () => {
    expect(dominantOutfitColor(solid(40, 40, [192, 57, 43, 0]), 40, 40)).toBeNull();
  });

  it('returns null for a zero-size or absurd frame instead of throwing', () => {
    expect(dominantOutfitColor(new Uint8ClampedArray(0), 0, 0)).toBeNull();
    expect(dominantOutfitColor(solid(4, 4, SHIRT_RED), 0, 4)).toBeNull();
    expect(dominantOutfitColor(solid(4, 4, SHIRT_RED), 4, 0)).toBeNull();
    expect(dominantOutfitColor(solid(4, 4, SHIRT_RED), Number.NaN, 4)).toBeNull();
  });

  it('returns null rather than reading past the end of a short buffer', () => {
    expect(dominantOutfitColor(new Uint8ClampedArray(16), 40, 40)).toBeNull();
  });

  it('is deterministic — the same pixels always give the same answer', () => {
    const px = frame(80, 80, (x, y) => [(x * 7) % 256, (y * 11) % 256, (x + y) % 256, 255]);
    const first = dominantOutfitColor(px, 80, 80);
    for (let i = 0; i < 5; i++) expect(dominantOutfitColor(px, 80, 80)).toBe(first);
  });
});

describe('complementFor — the companion colour that keeps the piece visible', () => {
  const SAMPLES = ['#c0392b', '#2d5f8a', '#ffffff', '#000000', '#9a9a9a', '#efe7d8', '#21453a'];

  it('always returns an in-gamut 6-digit hex', () => {
    for (const hex of SAMPLES) expect(complementFor(hex)).toMatch(HEX6);
    for (const cw of COLORWAYS) {
      for (const role of COLORWAY_ROLES) expect(complementFor(cw.styles[role].hex)).toMatch(HEX6);
    }
  });

  it('never returns the colour it was given', () => {
    for (const hex of SAMPLES) expect(complementFor(hex)).not.toBe(hex);
  });

  it('darkens a light garment and lightens a dark one, crossing mid-tone either way', () => {
    for (const hex of SAMPLES) {
      const l = lightnessOf(hex);
      const out = lightnessOf(complementFor(hex));
      if (l > 0.5) expect(out).toBeLessThanOrEqual(0.5);
      else expect(out).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('shifts the hue rather than opposing it — a companion, not a costume', () => {
    // Analogous by design: a strict +180 complement of a red shirt is a green
    // cap. Anything under a quarter turn reads as "chosen to go with that".
    for (const hex of ['#c0392b', '#2d5f8a', '#21453a']) {
      expect(hueGap(hueOf(complementFor(hex)), hueOf(hex))).toBeLessThan(90);
    }
  });

  it('gives a neutral a hint of colour instead of another dead grey', () => {
    const out = complementFor('#9a9a9a');
    const [, sat] = rgbToHsl(...channelsOf(out));
    expect(sat).toBeGreaterThan(0.05);
  });

  it('never throws on junk, and still returns a usable hex', () => {
    for (const junk of ['', 'nope', '#12', '#gggggg', 'rgb(1,2,3)']) {
      expect(complementFor(junk)).toMatch(HEX6);
    }
  });
});

describe('outfitColorway — the scheme built from one sampled garment colour', () => {
  it('puts the COMPANION on the body and the garment colour on trim and details', () => {
    // The deliberate choice: a cap in the exact colour of the shirt behind it
    // has no silhouette in the guest's own photo.
    const cw = outfitColorway(SHIRT_RED_HEX);
    expect(cw.id).toBe(OUTFIT_COLORWAY_ID);
    expect(cw.styles.primary.hex).toBe(complementFor(SHIRT_RED_HEX));
    expect(cw.styles.secondary.hex).toBe(SHIRT_RED_HEX);
    expect(cw.styles.accent.hex).toBe(SHIRT_RED_HEX);
    expect(cw.styles.primary.hex).not.toBe(SHIRT_RED_HEX);
  });

  it('is not one of the shipped schemes, so a chip can never look selected by it', () => {
    expect(COLORWAY_MAP[OUTFIT_COLORWAY_ID]).toBeUndefined();
  });

  it('maps onto the cap through the same role contract', () => {
    const cap = assetTemplateOf(findLibraryAsset('baseball-cap')!)!;
    const parts = colorwayParts(outfitColorway(SHIRT_RED_HEX), cap);
    expect(parts.crown.hex).toBe(complementFor(SHIRT_RED_HEX));
    expect(parts.brim.hex).toBe(SHIRT_RED_HEX);
    expect(parts.button.hex).toBe(SHIRT_RED_HEX);
  });

  it('falls back to a usable scheme for junk input rather than throwing', () => {
    const cw = outfitColorway('not a colour');
    for (const role of COLORWAY_ROLES) expect(cw.styles[role].hex).toMatch(HEX6);
  });
});
