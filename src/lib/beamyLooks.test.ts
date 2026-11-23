import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BEAMY_LOOKS, fitPair, fitProp, nextLook, preloadUrl, wornPlacement } from './beamyLooks';
import { EMOJI_RE } from './brandLanding';

describe('beamyLooks', () => {
  it('opens on the Christmas look (Holiday cover + antlers), then real platform assets that exist in public/', () => {
    // The owner (v9): he lands already dressed for Christmas, the frame around
    // him and the antlers on, and that is the selfie the wall receives.
    const first = BEAMY_LOOKS[0];
    expect(first.kind).toBe('frame');
    expect(first.url).toMatch(/christmas-santa-cover\.png$/);
    expect(first.prop?.url).toMatch(/reindeer-antlers\.glb$/);
    expect(first.opening).toBeDefined();
    expect(BEAMY_LOOKS.length).toBeGreaterThanOrEqual(4);
    for (const l of BEAMY_LOOKS) {
      expect(l.url, l.id).toBeDefined();
      expect(existsSync(resolve(__dirname, '../../public', `.${l.url}`)), l.url).toBe(true);
      if (l.prop !== undefined) expect(existsSync(resolve(__dirname, '../../public', `.${l.prop.url}`)), l.prop.url).toBe(true);
      if (l.kind === 'prop') expect(l.fit, l.id).toBeDefined();
    }
    // Kept by the owner: the antlers. Dropped (they read grey): the Santa hat,
    // the Royal crown, and the material-less tiara. The neon glasses were
    // retired from everything public on 2026-11-23 (owner: "tacky"); the gold
    // masquerade took their slot.
    const urls = BEAMY_LOOKS.flatMap((l) => [l.url, l.prop?.url]);
    for (const keep of ['beamy-masquerade.glb', 'reindeer-antlers.glb']) expect(urls.some((u) => u?.endsWith(keep)), keep).toBe(true);
    for (const gone of ['santa-hat.glb', 'royal-crown.glb', 'queens-tiara.glb', 'halo-ring.glb', 'neon-shades.glb']) expect(urls.some((u) => u?.endsWith(gone)), gone).toBe(false);
    expect(new Set(BEAMY_LOOKS.map((l) => l.id)).size).toBe(BEAMY_LOOKS.length);
  });

  it('keeps every line short and on-brand', () => {
    for (const l of BEAMY_LOOKS) {
      expect(l.line.length, l.line).toBeLessThanOrEqual(56);
      expect(l.line, l.line).not.toMatch(EMOJI_RE);
      expect(l.line, l.line).not.toMatch(/—|–/);
      expect(l.line, l.line).not.toMatch(/\bstudio\b/i);
      expect(l.line, l.line).not.toMatch(/on[- ]site|in person|at your venue|technician|attendant/i);
    }
    expect(BEAMY_LOOKS.some((l) => /Snapchat and Instagram/.test(l.line))).toBe(true);
    // The bubble invites a tap and a scroll, phone-safe ("Tap", never "Click").
    expect(BEAMY_LOOKS.some((l) => /^Tap me/.test(l.line))).toBe(true);
    expect(BEAMY_LOOKS.some((l) => /^Scroll/.test(l.line))).toBe(true);
    for (const l of BEAMY_LOOKS) expect(l.line, l.line).not.toMatch(/\bclick/i);
  });

  it('cycles through every look, the Christmas one included', () => {
    const n = BEAMY_LOOKS.length;
    const seen = [0];
    let i = 0;
    for (let k = 0; k < n * 2; k++) { i = nextLook(i, n); seen.push(i); }
    expect(seen.slice(0, n)).toEqual(Array.from({ length: n }, (_, k) => k));
    expect(seen[n]).toBe(0);
    expect(nextLook(n - 1, n)).toBe(0);
    expect(nextLook(0, 1)).toBe(0);
    expect(preloadUrl(0)).toBe(BEAMY_LOOKS[1].url);
  });

  it('fits a prop box by width and pins its base or centre on the anchor', () => {
    const base = fitProp([-1, 0, -0.5], [1, 0.5, 0.5], { width: 0.3, at: [0, 0.33, 0], align: 'base' });
    expect(base.scale).toBeCloseTo(0.15, 9);
    expect(base.offset).toEqual([0, 0.33, 0]);
    // Off-centre box: its centre lands on the anchor's x/z, its base on y.
    const off = fitProp([1, 2, 3], [3, 4, 5], { width: 1, at: [0.1, 0.2, 0.3], align: 'base' });
    expect(off.scale).toBeCloseTo(0.5, 9);
    expect(off.offset[0] + 2 * off.scale).toBeCloseTo(0.1, 9);
    expect(off.offset[1] + 2 * off.scale).toBeCloseTo(0.2, 9);
    expect(off.offset[2] + 4 * off.scale).toBeCloseTo(0.3, 9);
    const mid = fitProp([0, 0, 0], [2, 2, 2], { width: 1, at: [0, 0, 0], align: 'centre' });
    expect(mid.offset[1] + 1 * mid.scale).toBeCloseTo(0, 9);
  });

  it('lays a split earring pair out at his spacing, each earring at its own width', () => {
    // A library pair: near earring x 0..1.8 at the origin, its twin 15.8 away (x -15.8..-14).
    const min: [number, number, number] = [-15.8, -8, 0], max: [number, number, number] = [1.8, 0, 0.6];
    const fit = { width: 0.03, pair: 0.5, at: [0, 0.17, 0.08] as [number, number, number], align: 'centre' as const };
    const r = fitPair(min, max, [-15.8, 0, 0], fit);
    expect(r).not.toBeNull();
    if (r === null) return;
    // One earring is 1.8 wide -> 0.03 m; the hooks end up 0.5 m apart.
    expect(r.scale).toBeCloseTo(0.03 / 1.8, 9);
    const hookGap = (-15.8 + r.farShift[0]) * r.scale;
    expect(hookGap).toBeCloseTo(-0.5, 9);
    // The pair is centred on the anchor: near right edge and far left edge are symmetric.
    const near = 1.8 * r.scale + r.offset[0];
    const far = (-15.8 + r.farShift[0]) * r.scale + r.offset[0];
    expect(near + far).toBeCloseTo(0, 9);
    // A twin on the other side works the same way; a non-pair or a bad fit is refused.
    expect(fitPair([0, -8, 0], [17.6, 0, 0.6], [15.8, 0, 0], fit)?.scale).toBeCloseTo(0.03 / 1.8, 9);
    expect(fitPair(min, max, [-15.8, 0, 0], { ...fit, pair: undefined })).toBeNull();
    expect(fitPair(min, max, [0, 0, 0], fit)).toBeNull();
    expect(fitPair(min, max, [-20, 0, 0], fit)).toBeNull();
  });

  it('hangs a worn prop on a holder at its anchor: tilt and roll turn about the anchor', () => {
    const lo: [number, number, number] = [-1, 0, -0.5], hi: [number, number, number] = [1, 0.5, 0.5];
    const fit = { width: 0.3, at: [0.02, 0.33, -0.01] as [number, number, number], align: 'base' as const, tilt: -0.1, roll: 0.2 };
    const p = wornPlacement(lo, hi, fit, null);
    const f = fitProp(lo, hi, fit);
    expect(p.scale).toBe(f.scale);
    expect(p.holderPos).toEqual(fit.at);
    expect(p.holderRot).toEqual([-0.1, 0, 0.2]);
    expect(p.farShift).toBeNull();
    // Holder + model position = fitProp's offset: the box base-centre sits ON the anchor.
    for (const i of [0, 1, 2] as const) expect(p.holderPos[i] + p.objPos[i]).toBeCloseTo(f.offset[i], 12);
    expect(wornPlacement(lo, hi, { ...fit, tilt: undefined, roll: undefined }, null).holderRot).toEqual([0, 0, 0]);
    // A split pair is laid out by fitPair (same scale, its far shift).
    const pmin: [number, number, number] = [-15.8, -8, 0], pmax: [number, number, number] = [1.8, 0, 0.6];
    const ears = { width: 0.03, pair: 0.5, at: [0, 0.17, 0.08] as [number, number, number], align: 'centre' as const };
    const pp = wornPlacement(pmin, pmax, ears, [-15.8, 0, 0]);
    const laid = fitPair(pmin, pmax, [-15.8, 0, 0], ears);
    expect(pp.scale).toBe(laid?.scale);
    expect(pp.farShift).toEqual(laid?.farShift);
  });
});
