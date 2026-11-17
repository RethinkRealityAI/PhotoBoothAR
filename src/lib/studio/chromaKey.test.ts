import { describe, it, expect } from 'vitest';
import {
  keyOutColor,
  keyOutColorWithStats,
  detectKeyColor,
  fitOnCanvas,
  processFrameImage,
  needsChromaKey,
  hasGenuineAlpha,
  bytesLookAlpha,
  refineKeyedEdges,
  DEFAULT_KEY,
  GREEN_LEAD_RAMP,
  FRAME_W,
  FRAME_H,
  MIN_KEYED_FRACTION,
  type RgbaImage,
} from './chromaKey';

/** Build a solid-colour RGBA buffer. */
function solid(w: number, h: number, [r, g, b, a]: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width: w, height: h };
}

function px(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

const GREEN: [number, number, number, number] = [0, 255, 0, 255];

describe('keyOutColor', () => {
  it('makes a solid pure-green buffer fully transparent', () => {
    const out = keyOutColor(solid(4, 4, GREEN));
    for (let i = 3; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(0);
    }
  });

  it('keeps a red square on green fully opaque, keys the green', () => {
    // 3×3 green with a red centre pixel.
    const img = solid(3, 3, GREEN);
    const ci = (1 * 3 + 1) * 4;
    img.data[ci] = 255;
    img.data[ci + 1] = 0;
    img.data[ci + 2] = 0;
    const out = keyOutColor(img);
    expect(px(out, 1, 1)).toEqual([255, 0, 0, 255]); // red survives, alpha 255
    expect(px(out, 0, 0)[3]).toBe(0); // green corner keyed out
  });

  it('produces an intermediate alpha in the soft band', () => {
    // (100,255,100) sits at chroma distance ≈53 from #00FF00 → between the
    // default tolerance (40) and tolerance+softness (65).
    const img = solid(1, 1, [100, 255, 100, 255]);
    const out = keyOutColor(img);
    const a = px(out, 0, 0)[3];
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });

  it('despills — reduces the green channel on a semi-transparent edge pixel', () => {
    const img = solid(1, 1, [100, 255, 100, 255]);
    const out = keyOutColor(img);
    const [, g] = px(out, 0, 0);
    expect(g).toBeLessThan(255); // clamped down to max(R,B)=100
    expect(g).toBeLessThanOrEqual(100);
  });

  it('leaves non-green content untouched when nothing matches', () => {
    const img = solid(2, 2, [0, 0, 255, 255]); // pure blue
    const before = Uint8ClampedArray.from(img.data);
    const out = keyOutColor(img);
    expect(out.data).toEqual(before); // rgb + alpha all preserved
  });

  it('does not mutate the input buffer', () => {
    const img = solid(2, 2, GREEN);
    const snapshot = Uint8ClampedArray.from(img.data);
    keyOutColor(img);
    expect(img.data).toEqual(snapshot);
  });

  it('neutralizes the RGB of fully-keyed pixels (no green retained under alpha 0)', () => {
    // W5 audit HIGH#1: green left behind alpha 0 poisoned straight-alpha
    // resampling into an olive fringe. Keyed pixels must be (0,0,0,0).
    const out = keyOutColor(solid(2, 2, GREEN));
    expect(px(out, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('never despills pre-existing semi-transparent content far from the key', () => {
    // W5 audit #7: a kept teal (far from #00FF00) with inherited source alpha
    // must keep its green channel — despill gates on the KEY factor now.
    const img = solid(1, 1, [0, 200, 150, 128]);
    const out = keyOutColor(img);
    expect(px(out, 0, 0)).toEqual([0, 200, 150, 128]);
  });
});

/**
 * DARK/NEUTRAL ART UNDER A DESATURATED KEY (live 2026-11-17 "ghost" frame).
 * Gemini painted the backdrop sage (108,161,85) instead of #00FF00; detection
 * correctly keyed THAT colour — but its chroma sits only ~35 units from
 * neutral, inside the 40-unit tolerance, so chroma-only distance keyed every
 * near-neutral pixel of the art too (ink navy, black, cream): the whole
 * border shipped at alpha 6–40. A pixel whose green does not lead red AND
 * blue is never backdrop, whatever its chroma distance.
 */
describe('desaturated key: neutral and dark art survive', () => {
  const SAGE: [number, number, number] = [108, 161, 85];
  const art: [number, number, number][] = [
    [32, 32, 64],    // ink navy
    [20, 20, 24],    // near-black
    [0, 0, 0],       // black
    [224, 224, 196], // cream
    [160, 128, 64],  // antique gold
    [64, 40, 40],    // dark brown
    [70, 70, 70],    // charcoal
  ];
  for (const opts of [{}, { tolerance: 58, softness: 30 }]) {
    it(`keeps every art colour opaque (${JSON.stringify(opts)})`, () => {
      for (const c of art) {
        const out = keyOutColor(solid(2, 2, [...c, 255]), { key: SAGE, ...opts });
        expect(px(out, 0, 0)[3], `rgb(${c.join(',')})`).toBe(255);
      }
    });
  }

  it('still keys the sage backdrop itself and its shading', () => {
    for (const c of [SAGE, [96, 160, 64], [118, 170, 95], [80, 140, 60]] as [number, number, number][]) {
      const out = keyOutColor(solid(2, 2, [...c, 255]), { key: SAGE });
      expect(px(out, 0, 0)[3], `rgb(${c.join(',')})`).toBe(0);
    }
  });

  it('is a no-op for the pure-green key: every pixel the guard could act on was already kept', () => {
    // The guard only acts below GREEN_LEAD_RAMP of green lead; for #00FF00
    // every such colour is already outside tolerance+softness in chroma, so
    // pure-green keying is byte-identical. Exhaustive over a 5-step RGB grid,
    // at the default AND the re-key settings. (A darker detected key such as
    // (0,177,64) DID reach black under the re-key — alpha 218 — so there the
    // guard is a deliberate change.)
    const chroma = (r: number, g: number, b: number) => [
      -0.168736 * r - 0.331264 * g + 0.5 * b,
      0.5 * r - 0.418688 * g - 0.081312 * b,
    ];
    const [kcb, kcr] = chroma(...DEFAULT_KEY);
    for (let r = 0; r <= 255; r += 5) for (let g = 0; g <= 255; g += 5) for (let b = 0; b <= 255; b += 5) {
      if (g - Math.max(r, b) >= GREEN_LEAD_RAMP) continue; // the guard never touches these
      const [cb, cr] = chroma(r, g, b);
      const dist = Math.hypot(cb - kcb, cr - kcr);
      if (dist < 58 + 30) throw new Error(`#00FF00 reaches rgb(${r},${g},${b}) at chroma ${dist.toFixed(1)}`);
    }
  });
});

describe('fringe regression (audit HIGH#1 probe)', () => {
  it('scaling a keyed image never produces olive/green seam pixels', () => {
    // 4×4: left half red on right half green, keyed, then scaled ×1.5 (≠1 —
    // forces interpolation across the kept/keyed seam like real Gemini output).
    const img = solid(4, 4, GREEN);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      const i = (y * 4 + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 0;
    }
    const keyed = keyOutColor(img);
    const fitted = fitOnCanvas(keyed, 6, 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      const [r, g, , a] = px(fitted, x, y);
      if (a === 0) continue; // fully transparent — colour irrelevant
      // Any visible pixel must be red-dominant — never green-tinted (olive
      // was r≈g from blending retained green under alpha 0).
      expect(g).toBeLessThanOrEqual(r);
    }
  });
});

describe('fitOnCanvas', () => {
  it('contains + centres the art and keeps the padding transparent', () => {
    // 2×2 red source → 4×8 target. CONTAIN scale = 2, art = 4×4, offset y = 2.
    const out = fitOnCanvas(solid(2, 2, [255, 0, 0, 255]), 4, 8);
    expect(out.width).toBe(4);
    expect(out.height).toBe(8);
    // Top and bottom bands are transparent.
    expect(px(out, 0, 0)[3]).toBe(0);
    expect(px(out, 0, 7)[3]).toBe(0);
    // The centred 4×4 band is opaque red.
    expect(px(out, 2, 4)).toEqual([255, 0, 0, 255]);
    expect(px(out, 0, 2)[3]).toBe(255);
    expect(px(out, 3, 5)[3]).toBe(255);
  });

  it('preserves aspect ratio (never stretches a wide source to fill)', () => {
    // 4×1 wide source into a 4×4 square → scale 1, art height 1, centred at y=1.
    const out = fitOnCanvas(solid(4, 1, [255, 0, 0, 255]), 4, 4);
    expect(px(out, 0, 0)[3]).toBe(0); // row 0 padding
    expect(px(out, 0, 1)[3]).toBe(255); // the single art row
    expect(px(out, 0, 2)[3]).toBe(0); // padding below
  });
});

describe('processFrameImage', () => {
  it('keys green + fits onto the 1080×1920 booth canvas by default', () => {
    const { image: out } = processFrameImage(solid(10, 10, GREEN));
    expect(out.width).toBe(FRAME_W);
    expect(out.height).toBe(FRAME_H);
    // All-green source → the whole canvas ends up transparent. Scan into a
    // single boolean (2M+ expect() calls would take tens of seconds).
    let maxAlpha = 0;
    for (let i = 3; i < out.data.length; i += 4) {
      if (out.data[i] > maxAlpha) maxAlpha = out.data[i];
    }
    expect(maxAlpha).toBe(0);
  });
});

/** Build an RGBA buffer from a per-pixel colour function. */
function generate(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h };
}

describe('detectKeyColor + adaptive processFrameImage', () => {
  const OFF_GREEN: [number, number, number] = [0, 177, 64]; // #00B140

  it('(a) detects an off-green (#00B140) backdrop and keys it, art intact', () => {
    // Flat #00B140 backdrop, magenta art in the centre.
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [255, 0, 255, 255] : [...OFF_GREEN, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[0]).toBeLessThan(30); // ≈ #00B140
    expect(det!.key[1]).toBeGreaterThan(150);
    expect(det!.key[2]).toBeLessThan(100);
    const { image, keyedFraction } = keyOutColorWithStats(img, { key: det!.key });
    expect(keyedFraction).toBeGreaterThan(0.5); // most of the backdrop keyed
    expect(px(image, 20, 20)).toEqual([255, 0, 255, 255]); // magenta art survives
    expect(px(image, 0, 0)[3]).toBe(0); // #00B140 corner keyed out
  });

  it('(a2) the legacy fixed #00FF00 key barely touches #00B140 — the bug the fix closes', () => {
    // Proves the root cause: a flat off-shade green is < the 3% honesty gate
    // under the OLD fixed key, so the panel would have shipped it green.
    const { keyedFraction } = keyOutColorWithStats(solid(40, 40, [...OFF_GREEN, 255]));
    expect(keyedFraction).toBeLessThan(0.03);
  });

  it('(b) keys a constant-chroma green gradient uniformly (luminance-invariant)', () => {
    // Adding the same offset to R,G,B shifts luminance but keeps (Cb,Cr) fixed
    // — a true shaded green screen. The whole gradient must key uniformly.
    const img = generate(30, 30, (_x, y) => {
      const t = -25 + Math.round((y / 29) * 60); // luminance shift only
      return [30 + t, 180 + t, 30 + t, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[1]).toBeGreaterThan(det!.key[0]); // green-dominant
    const { keyedFraction } = keyOutColorWithStats(img, { key: det!.key });
    expect(keyedFraction).toBeGreaterThan(0.98); // top-to-bottom, not just one band
  });

  it('(c) exact #00FF00 backdrop keys identically to the legacy fixed-key path', () => {
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [255, 0, 0, 255] : [0, 255, 0, 255];
    });
    // Detection lands exactly on pure green, so the adaptive keyer feeds the
    // identical key to the identical pipeline as the old fixed-key path.
    const det = detectKeyColor(img);
    expect(det!.key).toEqual([0, 255, 0]);
    expect(processFrameImage(img).keyColor).toEqual([0, 255, 0]);
    // Compare the keyed buffers at SOURCE resolution (a 40×40 compare; a full
    // 1080×1920 toEqual is ~8M elements and takes a minute). fitOnCanvas is
    // deterministic, so identical keyed input ⇒ identical fitted output.
    const adaptiveKeyed = keyOutColor(img, { key: det!.key });
    const legacyKeyed = keyOutColor(img, { key: DEFAULT_KEY });
    expect(adaptiveKeyed.data).toEqual(legacyKeyed.data);
  });

  it('(d) reports keyedFraction ≈ 0 on a green-free image (honesty gate)', () => {
    // Blue art on white — nothing green. Detection returns null → DEFAULT_KEY →
    // the keyer removes ~nothing → below AiFramePanel's 3% threshold.
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [30, 60, 200, 255] : [255, 255, 255, 255];
    });
    expect(detectKeyColor(img)).toBeNull();
    const { keyedFraction } = processFrameImage(img);
    expect(keyedFraction).toBeLessThan(0.03);
  });

  it('(e) detects the key on a sticker layout (green surround, centred subject)', () => {
    // Skin-toned subject centred; #00C846-ish green surrounds it.
    const img = generate(40, 40, (x, y) => {
      const inSubject = x >= 12 && x < 28 && y >= 12 && y < 28;
      return inSubject ? [210, 170, 120, 255] : [0, 200, 70, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[1]).toBeGreaterThan(150); // green-channel dominant surround
    const { image, keyedFraction } = keyOutColorWithStats(img, { key: det!.key });
    expect(keyedFraction).toBeGreaterThan(0.4); // the surround keyed
    expect(px(image, 20, 20)[3]).toBe(255); // subject survives
  });

  /**
   * A duo-scene frame: illustrated art edge to edge with TWO head cutouts
   * punched out of it. Nothing about the cutouts touches the frame's centre or
   * its edges, so the centre/ring/corner regions alone can miss them entirely.
   */
  function duoScene(
    w: number,
    h: number,
    rxFrac: number,
    ryFrac: number,
  ): RgbaImage {
    const inEllipse = (x: number, y: number, cxFrac: number) =>
      ((x - w * cxFrac) / (w * rxFrac)) ** 2 + ((y - h * 0.38) / (h * ryFrac)) ** 2 <= 1;
    return generate(w, h, (x, y) => {
      if (inEllipse(x, y, 0.3) || inEllipse(x, y, 0.7)) return [...OFF_GREEN, 255];
      // Warm, varied, deliberately NOT green-family art in every other pixel.
      return [200 + ((x * 7 + y * 3) % 40), 60 + ((x * 3) % 40), 120 + ((y * 5) % 60), 255];
    });
  }

  it('(g) finds the off-green in a duo-scene layout (two head cutouts, art everywhere else)', () => {
    // Cutouts at 30%/70% width, 38% height — 26%×18% of the canvas, the
    // FRAME_LAYOUT_SPEC duo-scene geometry.
    const img = duoScene(180, 320, 0.13, 0.09);
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[0]).toBeLessThan(30); // ≈ #00B140, not the warm art
    expect(det!.key[1]).toBeGreaterThan(150);
    expect(det!.key[2]).toBeLessThan(100);
    const { image } = keyOutColorWithStats(img, { key: det!.key });
    expect(px(image, Math.round(180 * 0.3), Math.round(320 * 0.38))[3]).toBe(0); // cutout keyed
    expect(px(image, 2, 2)[3]).toBe(255); // corner art survives
  });

  it('(h) finds cutouts that fall BETWEEN the centre patch and the edge ring', () => {
    // Narrow cutouts at the same 30%/70% centres: they never reach the centre
    // patch (x ≥ 35% of width) nor the edge ring, so before the sparse
    // full-canvas grid pass every sample landed on art and detection returned
    // null — the panel would then have keyed with #00FF00 and shipped the
    // green holes into the booth.
    const img = duoScene(180, 320, 0.045, 0.14);
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[0]).toBeLessThan(30);
    expect(det!.key[1]).toBeGreaterThan(150);
    const { image } = keyOutColorWithStats(img, { key: det!.key });
    expect(px(image, Math.round(180 * 0.3), Math.round(320 * 0.38))[3]).toBe(0);
  });

  it('(f) locks onto the dominant backdrop hue over green-family art; distant art survives', () => {
    // Pure #00FF00 backdrop with dark forest-green art in the centre. Forest
    // green is green-family too, but the backdrop cluster is far denser so
    // detection locks onto #00FF00; forest green's chroma is distant enough
    // (far less saturated) to survive keying.
    // LIMITATION: art whose chroma lands within `tolerance` of the detected
    // backdrop hue IS eaten — this is the "avoid near-key art" UI tip.
    const FOREST: [number, number, number] = [20, 70, 30];
    const img = generate(40, 40, (x, y) => {
      const inArt = x >= 16 && x < 24 && y >= 16 && y < 24;
      return inArt ? [...FOREST, 255] : [0, 255, 0, 255];
    });
    const det = detectKeyColor(img);
    expect(det).not.toBeNull();
    expect(det!.key[0]).toBeLessThan(20); // ≈ pure green, not forest
    expect(det!.key[1]).toBeGreaterThan(240);
    const { image } = keyOutColorWithStats(img, { key: det!.key });
    expect(px(image, 20, 20)[3]).toBeGreaterThan(0); // forest art survives
    expect(px(image, 0, 0)[3]).toBe(0); // #00FF00 backdrop keyed
  });
});

describe('needsChromaKey', () => {
  it('never keys or rejects an asset that already has genuine alpha', () => {
    // A Higgsfield marketplace-app import / remove_background output. There is
    // no green to find, so keyedFraction is ~0 — the honesty gate would have
    // thrown away the BEST input the pipeline can get.
    expect(needsChromaKey(true, 0)).toBe(false);
    expect(needsChromaKey(true, 0.9)).toBe(false);
  });

  it('keeps the honesty gate for green-screen output, inclusive at the threshold', () => {
    expect(needsChromaKey(false, MIN_KEYED_FRACTION)).toBe(true);
    expect(needsChromaKey(false, 0.5)).toBe(true);
    expect(needsChromaKey(false, MIN_KEYED_FRACTION - 0.0001)).toBe(false);
    // Zero is DATA here, not "missing" — a total key miss.
    expect(needsChromaKey(false, 0)).toBe(false);
  });

  it('pins the shared threshold frameProcessing reads', () => {
    // frameProcessing.ts imports this constant instead of carrying its own 0.015
    // — one number, one decision. Changing it here is a deliberate retune.
    expect(MIN_KEYED_FRACTION).toBe(0.015);
  });
});

describe('hasGenuineAlpha', () => {
  /** A green-screen generation whose encoder emitted RGBA: config.transparent
   *  is true (the IHDR probe saw colour type 6) but every pixel is opaque. */
  const OPAQUE_GREEN_RGBA = solid(8, 8, GREEN);
  /** A real cutout — a transparent hole in the middle of opaque art. */
  const REAL_CUTOUT = (() => {
    const img = solid(8, 8, [255, 0, 0, 255]);
    img.data[(3 * 8 + 3) * 4 + 3] = 0;
    return img;
  })();

  it('keeps keying a green-screen asset that only has an alpha CHANNEL (audit F2)', () => {
    // THE BUG: `transparent` alone short-circuited keying here, so the booth got
    // a raw #00FF00 rectangle over the guest instead of a frame.
    expect(hasGenuineAlpha(true, true, OPAQUE_GREEN_RGBA)).toBe(false);
    // …and the pixel check alone would have caught it even unstamped.
    expect(hasGenuineAlpha(true, false, OPAQUE_GREEN_RGBA)).toBe(false);
  });

  it('vetoes the skip for a green-screen asset even when pixels ARE transparent', () => {
    // Belt-and-braces the other way: a green backdrop is keyed whatever the
    // encoder did, because keying is what makes the centre usable.
    expect(hasGenuineAlpha(true, true, REAL_CUTOUT)).toBe(false);
  });

  it('skips keying only when the flag, the veto and the pixels all agree', () => {
    expect(hasGenuineAlpha(true, false, REAL_CUTOUT)).toBe(true);
  });

  it('never skips when the asset does not even claim an alpha channel', () => {
    expect(hasGenuineAlpha(false, false, REAL_CUTOUT)).toBe(false);
    expect(hasGenuineAlpha(false, true, REAL_CUTOUT)).toBe(false);
  });

  it('counts a single semi-transparent pixel as genuine alpha', () => {
    // Soft-edged cutouts can be entirely partial alpha — `< 255`, not `=== 0`.
    const soft = solid(4, 4, [10, 20, 30, 255]);
    soft.data[3] = 254;
    expect(hasGenuineAlpha(true, false, soft)).toBe(true);
  });
});

describe('bytesLookAlpha', () => {
  /** Minimal 26-byte PNG prefix: signature + IHDR length/type/w/h/depth/colour. */
  function pngHeader(colorType: number): Uint8Array {
    const b = new Uint8Array(26);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // \x89PNG\r\n\x1a\n
    b.set([0, 0, 0, 13], 8); // IHDR chunk length = 13
    b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
    b.set([0, 0, 0x04, 0x38], 16); // width 1080
    b.set([0, 0, 0x07, 0x80], 20); // height 1920
    b[24] = 8; // bit depth
    b[25] = colorType;
    return b;
  }

  it('says yes for the two colour types that carry an alpha channel', () => {
    expect(bytesLookAlpha(pngHeader(4))).toBe(true); // greyscale + alpha
    expect(bytesLookAlpha(pngHeader(6))).toBe(true); // RGBA
  });

  it('says no for opaque colour types', () => {
    expect(bytesLookAlpha(pngHeader(2))).toBe(false); // truecolour, no alpha
    expect(bytesLookAlpha(pngHeader(0))).toBe(false); // greyscale
    expect(bytesLookAlpha(pngHeader(3))).toBe(false); // palette (tRNS is not probed)
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const buf = pngHeader(6).buffer;
    expect(bytesLookAlpha(buf)).toBe(true);
  });

  it('fails CLOSED on anything that is not a PNG whose first chunk is IHDR', () => {
    const notPng = pngHeader(6);
    notPng[0] = 0x88; // broken signature
    expect(bytesLookAlpha(notPng)).toBe(false);

    const notIhdr = pngHeader(6);
    notIhdr.set([0x69, 0x54, 0x58, 0x74], 12); // "iTXt" first — colour type unknown
    expect(bytesLookAlpha(notIhdr)).toBe(false);

    expect(bytesLookAlpha(new Uint8Array(25))).toBe(false); // truncated
    expect(bytesLookAlpha(new Uint8Array(0))).toBe(false);
  });
});

describe('refineEdges (opt-in) / refineKeyedEdges', () => {
  /** 8×8 green with a 4×4 olive-fringed gold block in the middle. */
  function framed(): RgbaImage {
    const img = solid(8, 8, GREEN);
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        const i = (y * 8 + x) * 4;
        const rim = x === 2 || x === 5 || y === 2 || y === 5;
        // The rim carries green spill (g > r,b) but is far enough from the key to be kept.
        img.data.set(rim ? [150, 190, 60, 255] : [212, 175, 55, 255], i);
      }
    }
    return img;
  }

  it('absent → byte-identical to the historical output (the guide pack depends on it)', () => {
    const img = framed();
    const a = keyOutColorWithStats(img);
    const b = keyOutColorWithStats(img, { refineEdges: false });
    expect(Array.from(b.image.data)).toEqual(Array.from(a.image.data));
    expect(Array.from(processFrameImage(img, 8, 8).image.data))
      .toEqual(Array.from(processFrameImage(img, 8, 8, { refineEdges: undefined }).image.data));
  });

  it('halves the alpha of the 1px rim touching the backdrop and despills it', () => {
    const plain = keyOutColorWithStats(framed());
    const refined = keyOutColorWithStats(framed(), { refineEdges: true });
    const [r, g, b, a] = px(refined.image, 2, 3);
    expect(px(plain.image, 2, 3)[3]).toBe(255);
    expect(a).toBe(128);
    expect(g).toBeLessThanOrEqual(Math.max(r, b));
  });

  it('leaves the interior untouched and keyedFraction unchanged', () => {
    const plain = keyOutColorWithStats(framed());
    const refined = keyOutColorWithStats(framed(), { refineEdges: true });
    expect(px(refined.image, 3, 3)).toEqual(px(plain.image, 3, 3));
    expect(refined.keyedFraction).toBe(plain.keyedFraction);
  });

  it('never mutates its input', () => {
    const keyed = keyOutColor(framed());
    const copy = Array.from(keyed.data);
    refineKeyedEdges(keyed);
    expect(Array.from(keyed.data)).toEqual(copy);
  });
});
