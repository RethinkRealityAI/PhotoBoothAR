import { describe, expect, it } from 'vitest';
import {
  currentFit, describeFit, nudgeFit, sameFit, tryOnScene, NUDGE_MOVE_CM, type TryOnRow,
} from './tryOn';
import { applyItemFit, fitTargetOf, normalizeItemFit, FIT_SCALE_MAX } from '../../supabase/functions/admin-api/libraryImport.ts';

const URL = 'https://x.supabase.co/storage/v1/object/public/assets/_platform/library/a/model.glb';
const anchor = (slot = 'crown', scale = 1) => ({
  scale, anchor: slot, offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
});
// Shape of a real bulk-imported library row (checked against the live DB).
const capRow = (): TryOnRow => ({
  id: 'a', kind: '3d_attachment', asset_url: URL,
  config: {
    anchor: anchor(),
    occlusion: true,
    layers: [{ id: 'obj-1', kind: '3d_attachment', name: 'Cap', anchor: anchor(), asset_url: URL, occlusion: true, anchorVersion: 2 }],
    library: { listed: true },
  },
});
const fit = (y: number, scale = 1) => ({ offset: { x: 0, y, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale });

describe('tryOnScene', () => {
  it('renders a library prop the way the booth does, occlusion on', () => {
    const s = tryOnScene(capRow());
    expect(s?.pieces).toHaveLength(1);
    expect(s?.pieces?.[0]).toMatchObject({ assetUrl: URL, occlude: true, anchorVersion: 2, fxKey: 'obj-1' });
    expect(s?.anchor.anchor).toBe('crown');
  });

  it('nothing to wear for a frame, a hidden-only scene, or no anchor', () => {
    expect(tryOnScene({ id: 'f', kind: 'border', asset_url: 'x.png', config: { anchor: anchor() } })).toBeNull();
    const hidden = capRow();
    (hidden.config!.layers as Record<string, unknown>[])[0].hidden = true;
    expect(tryOnScene(hidden)).toBeNull();
    expect(tryOnScene({ ...capRow(), config: { layers: [] } })).toBeNull();
  });

  it('previews a fit exactly as Save would write it', () => {
    const row = capRow();
    const f = fit(1.5, 1.2);
    const s = tryOnScene(row, f);
    expect(s?.pieces?.[0].anchor).toEqual(applyItemFit(row.config, f)!.layers && (applyItemFit(row.config, f)!.layers as { anchor: unknown }[])[0].anchor);
    expect(s?.pieces?.[0].anchor).toMatchObject({ anchor: 'crown', scale: 1.2, offset: { y: 1.5 } });
    // The row itself is never mutated.
    expect((row.config!.layers as { anchor: { scale: number } }[])[0].anchor.scale).toBe(1);
  });
});

describe('fit target + apply (the server writes through these)', () => {
  it('fits a lone worn piece and its singular mirror, nothing else', () => {
    const row = capRow();
    const out = applyItemFit(row.config, fit(2))!;
    expect((out.layers as { anchor: unknown }[])[0]).toMatchObject({ anchor: { offset: { y: 2 }, anchor: 'crown' }, asset_url: URL, anchorVersion: 2 });
    expect(out.anchor).toMatchObject({ offset: { y: 2 }, anchor: 'crown' });
    expect(out.library).toEqual({ listed: true });
    expect(out.occlusion).toBe(true);
  });

  it('a pre-layers row fits its singular anchor', () => {
    const cfg = { anchor: anchor('noseBridge', 3) };
    expect(fitTargetOf(cfg)).toBe(-1);
    expect(applyItemFit(cfg, fit(1, 2))).toEqual({ anchor: { ...anchor('noseBridge'), offset: { x: 0, y: 1, z: 0 }, scale: 2 } });
  });

  it('leaves a singular mirror on ANOTHER slot alone', () => {
    const row = capRow();
    row.config!.anchor = anchor('chin');
    expect(applyItemFit(row.config, fit(2))!.anchor).toEqual(anchor('chin'));
  });

  it('refuses scenes it cannot fit with one nudge', () => {
    const two = capRow();
    (two.config!.layers as unknown[]).push({ id: 'obj-2', kind: '3d_attachment', anchor: anchor('chin'), asset_url: URL });
    expect(fitTargetOf(two.config)).toBeNull();
    expect(applyItemFit(two.config, fit(1))).toBeNull();
    const hand = capRow();
    (hand.config!.layers as Record<string, unknown>[])[0].handAnchor = 'palm';
    expect(fitTargetOf(hand.config)).toBeNull();
    expect(fitTargetOf(null)).toBeNull();
    expect(fitTargetOf({})).toBeNull();
  });

  it('normalizeItemFit is total', () => {
    expect(normalizeItemFit(fit(1))).toEqual(fit(1));
    expect(normalizeItemFit(null)).toBeNull();
    expect(normalizeItemFit({ ...fit(1), scale: 0 })).toBeNull();
    expect(normalizeItemFit({ ...fit(1), scale: FIT_SCALE_MAX + 1 })).toBeNull();
    expect(normalizeItemFit({ ...fit(1), offset: { x: 0, y: Number.NaN, z: 0 } })).toBeNull();
    expect(normalizeItemFit({ ...fit(1), offset: { x: 0, y: 999, z: 0 } })).toBeNull();
    expect(normalizeItemFit({ ...fit(1), rotation: { x: 0, y: 0 } })).toBeNull();
  });
});

describe('nudges', () => {
  it('reads the stored fit, defaulting missing numbers', () => {
    expect(currentFit(capRow())).toEqual(fit(0));
    const odd = capRow();
    (odd.config!.layers as { anchor: Record<string, unknown> }[])[0].anchor.scale = 0;
    expect(currentFit(odd)?.scale).toBe(1);
  });

  it('steps without float dust and stays inside the server caps', () => {
    let f = fit(0);
    for (let i = 0; i < 3; i += 1) f = nudgeFit(f, { kind: 'move', axis: 'y', dir: 1 });
    expect(f.offset.y).toBe(0.75);
    expect(nudgeFit(fit(0), { kind: 'move', axis: 'z', dir: -1 }, true).offset.z).toBe(-4 * NUDGE_MOVE_CM);
    expect(nudgeFit(fit(0), { kind: 'scale', dir: 1 }).scale).toBe(1.03);
    let big = fit(0, FIT_SCALE_MAX);
    big = nudgeFit(big, { kind: 'scale', dir: 1 }, true);
    expect(big.scale).toBe(FIT_SCALE_MAX);
    expect(normalizeItemFit(big)).not.toBeNull();
    expect(nudgeFit(fit(0), { kind: 'tilt', axis: 'x', dir: 1 }).rotation.x).toBeCloseTo(Math.PI / 90, 4);
  });

  it('compares and describes', () => {
    expect(sameFit(fit(1), fit(1))).toBe(true);
    expect(sameFit(fit(1), fit(1.25))).toBe(false);
    expect(sameFit(null, null)).toBe(true);
    expect(describeFit(fit(0), fit(0))).toBe('As saved');
    expect(describeFit({ ...fit(0.5, 1.06), offset: { x: 0, y: 0.5, z: -0.25 } }, fit(0))).toBe('Up 0.5 cm · Back 0.25 cm · 106% size');
  });
});
