import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HAND_ANCHOR_IDS,
  HEAD_ANCHOR_IDS,
  applySettings,
  coreWords,
  extractSettings,
  locatePiece,
  matchedScale,
  normalizeGroups,
  normalizeSettings,
  suggestVariants,
  variantScore,
} from '../../supabase/functions/admin-api/librarySettings';
import { HAND_ANCHORS } from './handPose';
import { FACE_TRACKING_MODES } from './faceEngine/engineSelect';

const anchor = (scale: number, extra: Record<string, unknown> = {}) => ({
  scale, anchor: 'noseBridge', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, ...extra,
});

/** A bulk-imported library prop, shaped like the live Gala mask rows. */
function prop(id: string, scale: number, maxDim: number, layer: Record<string, unknown> = {}) {
  return {
    anchor: anchor(scale),
    layers: [{ id, kind: '3d_attachment', name: id, anchor: anchor(scale), asset_url: `https://x/${id}.glb`, anchorVersion: 2, ...layer }],
    library: { version: 1, listed: true, import: { maxDim, fileName: `${id}.glb` } },
  };
}

describe('pinned vocabularies', () => {
  it('head anchors match src/types.ts HeadAnchor', () => {
    const src = readFileSync('src/types.ts', 'utf8');
    const block = src.slice(src.indexOf('export type HeadAnchor ='), src.indexOf(';', src.indexOf('export type HeadAnchor =')));
    const ids = [...block.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
    expect([...HEAD_ANCHOR_IDS]).toEqual(ids);
  });
  it('hand anchors match handPose.HAND_ANCHORS', () => {
    expect([...HAND_ANCHOR_IDS]).toEqual(HAND_ANCHORS.map((a) => a.id));
  });
  it('tracking modes match the face engine', () => {
    const src = readFileSync('supabase/functions/admin-api/librarySettings.ts', 'utf8');
    expect(src).toContain(`['${FACE_TRACKING_MODES.join("', '")}']`);
  });
});

describe('locatePiece', () => {
  it('finds the one 3D layer and ignores face paint', () => {
    expect(locatePiece(prop('a', 1, 1))).toEqual({ ok: true, index: 0 });
    expect(locatePiece({ layers: [{ id: 'p', kind: '3d_attachment', facePaint: {} }, { id: 'h', kind: '3d_attachment', anchor: anchor(1) }] }))
      .toEqual({ ok: true, index: 1 });
  });
  it('refuses a scene with several 3D pieces, and non-props', () => {
    expect(locatePiece({ layers: [{ kind: '3d_attachment' }, { kind: '3d_attachment' }] })).toEqual({ ok: false, reason: 'several_pieces' });
    expect(locatePiece({ layers: [{ kind: 'border' }] })).toEqual({ ok: false, reason: 'not_a_prop' });
    expect(locatePiece({ transform: {} })).toEqual({ ok: false, reason: 'not_a_prop' });
    expect(locatePiece(null)).toEqual({ ok: false, reason: 'not_a_prop' });
  });
  it('accepts a legacy singular row', () => {
    expect(locatePiece({ anchor: anchor(7.5) })).toEqual({ ok: true, index: -1 });
  });
});

describe('copying the fit between variants', () => {
  const blackFit = { offset: { x: 0, y: 1.1, z: -0.8 }, rotation: { z: 0, y: 0, x: 0 }, anchor: 'noseBridge', scale: 8.2 };
  const black = { ...prop('black', 8.2, 1.9008, { anchor: blackFit, occlusion: true }), anchor: blackFit, occlusion: true };
  const s = extractSettings(black)!;

  it('reads the fit', () => {
    expect(s.fit.anchor).toEqual({ anchor: 'noseBridge', scale: 8.2, offset: { x: 0, y: 1.1, z: -0.8 }, rotation: { x: 0, y: 0, z: 0 } });
    expect(s.fit.occlusion).toBe(true);
    expect(s.fit.anchorVersion).toBe(2);
    expect(s.modelSize).toBe(1.9008);
    expect(s.layerId).toBe('black');
  });

  it('writes layer AND the singular mirror, and leaves everything else alone', () => {
    const red = prop('red', 9.99, 1.9017);
    const r = applySettings(red, s, ['fit'], s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const layer = (r.config.layers as Record<string, unknown>[])[0];
    expect((layer.anchor as { offset: unknown }).offset).toEqual({ x: 0, y: 1.1, z: -0.8 });
    expect(r.config.anchor).toEqual(layer.anchor);
    expect(layer.occlusion).toBe(true);
    expect(r.config.occlusion).toBe(true);
    expect(layer.asset_url).toBe('https://x/red.glb');
    expect(r.config.library).toEqual(red.library);
    expect(r.changed).toBe(true);
    // Same-size variant (within 1%): exactly the same number.
    expect((layer.anchor as { scale: number }).scale).toBe(8.2);
  });

  it('never mutates its inputs', () => {
    const red = prop('red', 9.99, 1.9017);
    const snap = JSON.stringify(red);
    applySettings(red, s, ['fit', 'look', 'behaviour'], s);
    expect(JSON.stringify(red)).toBe(snap);
  });

  it('is a no-op when the target already matches, whatever the key order', () => {
    const again = applySettings(black, s, ['fit'], s);
    expect(again.ok && again.changed).toBe(false);
  });

  it('turning occlusion off removes the key (only exactly true occludes)', () => {
    const off = { ...s, fit: { ...s.fit, occlusion: false } };
    const r = applySettings(black, off, ['fit']);
    if (!r.ok) throw new Error('refused');
    expect((r.config.layers as Record<string, unknown>[])[0]).not.toHaveProperty('occlusion');
    expect(r.config).not.toHaveProperty('occlusion');
  });

  it('refuses a multi-piece target', () => {
    expect(applySettings({ layers: [{ kind: '3d_attachment' }, { kind: '3d_attachment' }] }, s, ['fit'])).toEqual({ ok: false, reason: 'several_pieces' });
  });

  it('does not touch the mirror when the piece is not layer 0', () => {
    const scene = { anchor: anchor(1), layers: [{ id: 'f', kind: 'border' }, { id: 'h', kind: '3d_attachment', anchor: anchor(3) }] };
    const r = applySettings(scene, s, ['fit']);
    if (!r.ok) throw new Error('refused');
    expect(r.config.anchor).toEqual(anchor(1));
    expect(((r.config.layers as Record<string, unknown>[])[1].anchor as { scale: number }).scale).toBe(8.2);
  });
});

describe('matchedScale', () => {
  it('keeps the on-face size when models were exported at different sizes', () => {
    expect(matchedScale(8, 2, 1)).toBe(16);
    expect(matchedScale(8, null, 1)).toBe(8);
    expect(matchedScale(8, 2, null)).toBe(8);
  });
  it('copies the plain number for wildly different models', () => {
    expect(matchedScale(8, 100, 1)).toBe(8);
  });
  it('treats under 1% as the same export', () => {
    expect(matchedScale(8.2, 1.9008, 1.8988)).toBe(8.2);
  });
});

describe('look and behaviour groups', () => {
  const src = prop('a', 5, 1, {
    finish: 'gold', tint: '#aa0000', tintStrength: 0.4, animation: 'float',
    template: { regions: ['crown'] }, customization: { parts: { crown: { hex: '#112233' } } },
  });
  (src as Record<string, unknown>).triggers = [{ source: 'smile', action: 'reveal', targetId: 'a' }];
  (src as Record<string, unknown>).tracking = 'hybrid';
  const s = extractSettings(src)!;

  it('copies only the chosen group', () => {
    const r = applySettings(prop('b', 2, 1), s, ['look']);
    if (!r.ok) throw new Error('refused');
    const layer = (r.config.layers as Record<string, unknown>[])[0];
    expect(layer.finish).toBe('gold');
    expect(layer.tint).toBe('#aa0000');
    expect((layer.anchor as { scale: number }).scale).toBe(2);
    expect(layer).not.toHaveProperty('animation');
    expect(r.config).not.toHaveProperty('triggers');
  });

  it('skips recoloured regions unless the templates match', () => {
    const other = applySettings(prop('b', 2, 1, { template: { regions: ['brim'] } }), s, ['look']);
    if (!other.ok) throw new Error('refused');
    expect((other.config.layers as Record<string, unknown>[])[0]).not.toHaveProperty('customization');
    expect(other.notes).toContain('colours_skipped');
    const same = applySettings(prop('b', 2, 1, { template: { regions: ['crown'] } }), s, ['look']);
    if (!same.ok) throw new Error('refused');
    expect((same.config.layers as Record<string, unknown>[])[0].customization).toEqual({ parts: { crown: { hex: '#112233' } } });
  });

  it('copies behaviour and re-points triggers at the target piece', () => {
    const r = applySettings(prop('b', 2, 1), s, ['behaviour'], s);
    if (!r.ok) throw new Error('refused');
    expect((r.config.layers as Record<string, unknown>[])[0].animation).toBe('float');
    expect(r.config.triggers).toEqual([{ source: 'smile', action: 'reveal', targetId: 'b' }]);
    expect(r.config.tracking).toBe('hybrid');
  });
});

describe('normalizeSettings (the editor save)', () => {
  const good = { fit: { anchor: anchor(8), occlusion: true }, look: {}, behaviour: { animation: 'none' } };
  it('accepts a valid payload and drops a none animation', () => {
    const r = normalizeSettings(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.behaviour).toEqual({});
  });
  it('rejects bad input instead of dropping it', () => {
    expect(normalizeSettings({ ...good, fit: { anchor: anchor(8, { anchor: 'elbow' }), occlusion: true } })).toEqual({ ok: false, error: 'invalid_anchor' });
    expect(normalizeSettings({ ...good, look: { tint: 'red' } }).ok).toBe(false);
    expect(normalizeSettings({ ...good, fit: { anchor: anchor(-1), occlusion: true } }).ok).toBe(false);
    expect(normalizeSettings({ ...good, fit: { anchor: anchor(1), occlusion: 'yes' } }).ok).toBe(false);
    expect(normalizeSettings({ ...good, behaviour: { tracking: 'arkit' } }).ok).toBe(false);
    expect(normalizeSettings(null).ok).toBe(false);
  });
  it('clamps absurd numbers', () => {
    const r = normalizeSettings({ ...good, fit: { anchor: anchor(8, { offset: { x: 1e9, y: 0, z: 0 } }), occlusion: false } });
    if (!r.ok) throw new Error('refused');
    expect(r.settings.fit.anchor.offset.x).toBe(200);
  });
  it('groups', () => {
    expect(normalizeGroups(['fit', 'fit', 'look'])).toEqual(['fit', 'look']);
    expect(normalizeGroups([])).toBeNull();
    expect(normalizeGroups(['colour'])).toBeNull();
  });
});

describe('variant suggestions', () => {
  const lib = [
    { id: 'black', name: 'Black Gold Gala Mask', kind: '3d_attachment', fileName: 'Gala_Mask_Black_Gold_.glb', modelSize: 1.9008 },
    { id: 'white', name: 'White Gold Mask', kind: '3d_attachment', fileName: 'Gala_Mask_White_Gold.glb', modelSize: 1.9030 },
    { id: 'red', name: 'Red Gala Mask', kind: '3d_attachment', fileName: 'Gala_Mask_Red_Royal_M.glb', modelSize: 1.9017 },
    { id: 'green', name: 'Emerald Gala Mask', kind: '3d_attachment', fileName: 'Gala_Mask_Green_Gold_.glb', modelSize: 1.9015 },
    { id: 'fedora', name: 'Detective Fedora', kind: '3d_attachment', modelSize: 1.2 },
    { id: 'kabuki', name: 'Kabuki Mask', kind: '3d_attachment', modelSize: 1.7 },
    { id: 'frame', name: 'Gala Mask Frame', kind: 'border' },
  ];
  it('finds every colourway of the Gala mask and nothing else', () => {
    expect(new Set(suggestVariants(lib[0], lib))).toEqual(new Set(['white', 'red', 'green']));
  });
  it('does not call every mask a variant of every other mask', () => {
    expect(suggestVariants(lib[5], lib)).toEqual([]);
    expect(variantScore(
      { id: 'k', name: 'Kabuki Mask', kind: '3d_attachment', fileName: 'Meshy_AI_Kabuki_Mask_1119232645_texture.glb' },
      { id: 't', name: 'Timberwood Mask', kind: '3d_attachment', fileName: 'Meshy_AI_Timberwood_Mask_1119232655_texture.glb' },
    )).toBe(0);
  });
  it('matches a name that extends another, and an optimized copy', () => {
    expect(variantScore({ id: 'a', name: 'Crimson Demon Mask', kind: 'k' }, { id: 'b', name: 'ZM Crimson Demon Mask', kind: 'k' })).toBe(0.7);
    expect(variantScore({ id: 'a', name: 'HODL Cyber Helmet', kind: 'k' }, { id: 'b', name: 'HODL Cyber Helmet-Optimized', kind: 'k' })).toBe(1);
  });
  it('strips colour words', () => {
    expect(coreWords('Emerald Gala Mask', 'Gala_Mask_Green_Gold_.glb')).toEqual(['gala', 'mask']);
  });
  it('never suggests the item itself or another kind', () => {
    expect(variantScore(lib[0], lib[0])).toBe(0);
    expect(variantScore(lib[0], lib[6])).toBe(0);
  });
});
