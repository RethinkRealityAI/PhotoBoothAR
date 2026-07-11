import { describe, it, expect } from 'vitest';
import { experienceToDraft, draftToPayload, existingUrlResolver, isStudioKind, type UrlResolver } from './draftMapping';
import { initialDraft, createOverlay, createObject3D, type Overlay2D, type Object3D, type StudioDraft } from './state';
import { defaultParams } from '../shaders';
import type { Experience, ExperienceDraft } from '../../types';

const baseExp = (over: Partial<Experience>): Experience => ({
  id: 'e1',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  name: 'Test',
  kind: 'shader',
  asset_url: null,
  thumbnail_url: null,
  config: {},
  is_published: true,
  featured: false,
  sort_order: 0,
  ...over,
});

/** A resolver that returns each object's own id mapped through `map` (or null). */
const resolver = (map: Record<string, string | null>): UrlResolver => (id) => map[id] ?? null;
/** Re-hydrate a saved payload into an Experience for a full round-trip. */
const expFromPayload = (p: ExperienceDraft): Experience =>
  baseExp({ kind: p.kind, asset_url: p.asset_url ?? null, config: p.config! });

describe('isStudioKind', () => {
  it('accepts the four editable kinds, rejects composite/junk', () => {
    for (const k of ['shader', 'border', '2d_filter', '3d_attachment']) expect(isStudioKind(k)).toBe(true);
    expect(isStudioKind('composite')).toBe(false);
    expect(isStudioKind('')).toBe(false);
  });
});

describe('round-trip: shader', () => {
  it('load → payload preserves shader config', () => {
    const exp = baseExp({ kind: 'shader', config: { shader: { shaderId: 'champagne-sparkle', params: { uIntensity: 0.7 } } } });
    const draft = experienceToDraft(exp)!;
    expect(draft.shaderId).toBe('champagne-sparkle');
    expect(draft.shaderParams).toEqual({ uIntensity: 0.7 });
    const payload = draftToPayload(draft, resolver({}), null);
    expect(payload.kind).toBe('shader');
    expect(payload.config?.shader).toEqual({ shaderId: 'champagne-sparkle', params: { uIntensity: 0.7 } });
    expect(payload.asset_url).toBeNull();
    expect(payload.config?.layers).toBeUndefined();
  });
  it('missing params fall back to registry defaults', () => {
    const exp = baseExp({ kind: 'shader', config: { shader: { shaderId: 'champagne-sparkle' } } });
    expect(experienceToDraft(exp)!.shaderParams).toEqual(defaultParams('champagne-sparkle'));
  });
});

describe('round-trip: single 2D (byte-identical legacy shape — no layers)', () => {
  it('stored asset loads as custom, saves with NO layers key', () => {
    const exp = baseExp({
      kind: 'border',
      asset_url: 'https://cdn/frame.png',
      config: { transform: { scale: 1.2, x: 5, y: -3, rotation: 10 }, opacity: 1 },
    });
    const draft = experienceToDraft(exp)!;
    const o = draft.objects[0] as Overlay2D;
    expect(draft.objects).toHaveLength(1);
    expect(o.url).toBe('https://cdn/frame.png');
    expect(o.isBuiltin).toBe(false);
    expect(o.transform).toEqual({ scale: 1.2, x: 5, y: -3, rotation: 10 });

    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/frame.png' }), null);
    expect(payload.config?.layers).toBeUndefined(); // byte-identical to today
    expect(payload.config?.transform).toEqual({ scale: 1.2, x: 5, y: -3, rotation: 10 });
    expect(payload.config?.opacity).toBe(1);
    expect(payload.asset_url).toBe('https://cdn/frame.png');
  });
});

describe('animation on a single object forces layers', () => {
  it('a lone animated overlay writes config.layers (len 1) plus the legacy mirror', () => {
    const o = createOverlay('2d_filter', { url: 'blob:s', isBuiltin: false, name: 'Sticker', animation: 'float', transform: { scale: 1, x: 2, y: 2, rotation: 0 } });
    const draft: StudioDraft = { ...initialDraft('2d_filter'), objects: [o], selectedId: o.id, kind: '2d_filter' };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/s.png' }), null);
    expect(payload.config?.layers).toHaveLength(1);
    expect(payload.config?.layers?.[0].animation).toBe('float');
    // legacy mirror still present
    expect(payload.config?.transform).toEqual({ scale: 1, x: 2, y: 2, rotation: 0 });
    expect(payload.asset_url).toBe('https://cdn/s.png');
  });
});

describe('round-trip: multi 2D (mixed border + sticker)', () => {
  it('writes an ordered layers list, mirrors layer 0, and reloads as N objects', () => {
    const border = createOverlay('border', { url: 'data:border', isBuiltin: true, builtinId: 'frame-classic', name: 'Frame', transform: { scale: 1, x: 0, y: 0, rotation: 0 } });
    const sticker = createOverlay('2d_filter', { url: 'blob:s', isBuiltin: false, name: 'Sticker', transform: { scale: 0.5, x: 10, y: 20, rotation: 5 } });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [border, sticker], selectedId: border.id, kind: 'border' };
    const urls = { [border.id]: 'https://cdn/border.png', [sticker.id]: 'https://cdn/sticker.png' };
    const payload = draftToPayload(draft, resolver(urls), null);

    expect(payload.config?.layers).toHaveLength(2);
    expect(payload.config?.layers?.map((l) => l.kind)).toEqual(['border', '2d_filter']);
    // layer-0 mirror
    expect(payload.asset_url).toBe('https://cdn/border.png');
    expect(payload.config?.transform).toEqual(border.transform);
    expect(payload.config?.layers?.[1].asset_url).toBe('https://cdn/sticker.png');
    expect(payload.config?.layers?.[1].transform).toEqual(sticker.transform);

    const reloaded = experienceToDraft(expFromPayload(payload))!;
    expect(reloaded.objects).toHaveLength(2);
    expect(reloaded.objects.map((o) => (o as Overlay2D).overlayKind)).toEqual(['border', '2d_filter']);
  });
});

describe('round-trip: single 3D', () => {
  it('GLB attachment keeps anchor config, no layers key', () => {
    const exp = baseExp({
      kind: '3d_attachment',
      asset_url: 'https://cdn/crown.glb',
      config: { anchor: { anchor: 'forehead', offset: { x: 0, y: 1, z: 2 }, rotation: { x: 0.1, y: 0, z: 0 }, scale: 3 } },
    });
    const draft = experienceToDraft(exp)!;
    const o = draft.objects[0] as Object3D;
    expect(o.type).toBe('model');
    expect(o.anchor).toBe('forehead');
    expect(o.anchorConfig.scale).toBe(3);
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/crown.glb' }), null);
    expect(payload.config?.layers).toBeUndefined();
    expect(payload.config?.anchor).toEqual(exp.config.anchor);
    expect(payload.config?.procedural).toBeUndefined();
    expect(payload.asset_url).toBe('https://cdn/crown.glb');
  });
  it('procedural piece round-trips with a null asset_url', () => {
    const exp = baseExp({
      kind: '3d_attachment',
      config: {
        procedural: 'hope-halo',
        anchor: { anchor: 'crown', offset: { x: 0, y: 3.4, z: -1 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
      },
    });
    const draft = experienceToDraft(exp)!;
    const o = draft.objects[0] as Object3D;
    expect(o.type).toBe('headpiece');
    expect(o.proceduralId).toBe('hope-halo');
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://ignored/upload.glb' }), null);
    expect(payload.asset_url).toBeNull();
    expect(payload.config?.procedural).toBe('hope-halo');
  });
});

describe('round-trip: multi 3D (model + head piece, per-layer occlusion/animation)', () => {
  it('mirrors layer 0 and preserves per-layer occlusion + animation', () => {
    const piece = createObject3D('headpiece', {
      proceduralId: 'royal-crown',
      name: 'Crown',
      anchor: 'crown',
      anchorConfig: { offset: { x: 0, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
      occlusion: true,
      animation: 'spin',
    });
    const model = createObject3D('model', { assetUrl: 'blob:m', name: 'Model', animation: 'pulse' });
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [piece, model], selectedId: piece.id, kind: '3d_attachment' };
    const urls = { [model.id]: 'https://cdn/model.glb' };
    const payload = draftToPayload(draft, resolver(urls), 'thumb');

    // layer-0 mirror (the procedural head piece)
    expect(payload.asset_url).toBeNull();
    expect(payload.config?.anchor?.anchor).toBe('crown');
    expect(payload.config?.procedural).toBe('royal-crown');
    expect(payload.config?.occlusion).toBe(true);
    expect(payload.thumbnail_url).toBe('thumb');

    const layers = payload.config?.layers!;
    expect(layers).toHaveLength(2);
    expect(layers[0].occlusion).toBe(true);
    expect(layers[0].animation).toBe('spin');
    expect(layers[0].asset_url).toBeNull();
    expect(layers[0].procedural).toBe('royal-crown');
    expect(layers[1].asset_url).toBe('https://cdn/model.glb');
    expect(layers[1].animation).toBe('pulse');
    expect(layers[1].procedural).toBeUndefined();
    expect(layers[1].occlusion).toBeUndefined();

    const reloaded = experienceToDraft(expFromPayload(payload))!;
    expect(reloaded.objects).toHaveLength(2);
    expect((reloaded.objects[0] as Object3D).occlusion).toBe(true);
    expect((reloaded.objects[1] as Object3D).type).toBe('model');
  });
});

describe('legacy experience with no layers loads as one object', () => {
  it('an old single-object row rebuilds a one-object scene', () => {
    const exp = baseExp({ kind: 'border', asset_url: 'https://cdn/f.png', config: { transform: { scale: 1, x: 0, y: 0, rotation: 0 } } });
    const draft = experienceToDraft(exp)!;
    expect(draft.objects).toHaveLength(1);
    expect((draft.objects[0] as Overlay2D).url).toBe('https://cdn/f.png');
  });
});

describe('scene tag and occlusion (opt-in)', () => {
  it('scene tag round-trips; occlusion is never written on a 2D kind', () => {
    const border = createOverlay('border', { url: 'data:b', isBuiltin: true });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [border], selectedId: border.id, kind: 'border', scene: 'Neon Nights' };
    const payload = draftToPayload(draft, resolver({ [border.id]: 'https://cdn/b.png' }), null);
    expect(payload.config?.scene).toBe('Neon Nights');
    expect(payload.config?.occlusion).toBeUndefined();
  });
  it('occlusion is opt-in: new pieces default OFF; enabling persists true', () => {
    const off = createObject3D('headpiece', { proceduralId: 'royal-crown' });
    expect(off.occlusion).toBe(false);
    const offDraft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [off], selectedId: off.id, kind: '3d_attachment' };
    expect(draftToPayload(offDraft, resolver({}), null).config?.occlusion).toBeUndefined();

    const on = createObject3D('headpiece', { proceduralId: 'royal-crown', occlusion: true });
    const onDraft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [on], selectedId: on.id, kind: '3d_attachment' };
    const onPayload = draftToPayload(onDraft, resolver({}), null);
    expect(onPayload.config?.occlusion).toBe(true);
    expect((experienceToDraft(expFromPayload(onPayload))!.objects[0] as Object3D).occlusion).toBe(true);
  });
  it('an existing experience with no occlusion flag loads as opt-in OFF (no silent change)', () => {
    const exp = baseExp({ kind: '3d_attachment', asset_url: 'https://cdn/x.glb', config: { anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } } });
    expect((experienceToDraft(exp)!.objects[0] as Object3D).occlusion).toBe(false);
  });
  it('composite kind with no layers loads as an empty scene (W4-B: composite now loads)', () => {
    const draft = experienceToDraft(baseExp({ kind: 'composite' }));
    expect(draft).not.toBeNull();
    expect(draft!.objects).toHaveLength(0);
  });
});

describe('round-trip: composite (mixed 2D + 3D + filter slot)', () => {
  it('frame + 2 stickers + 2 head pieces + filter slot round-trips as one scene', () => {
    const frame = createOverlay('border', { url: 'data:frame', isBuiltin: true, builtinId: 'frame-classic', name: 'Frame', transform: { scale: 1, x: 0, y: 0, rotation: 0 } });
    const sticker1 = createOverlay('2d_filter', { url: 'blob:s1', isBuiltin: false, name: 'Sticker One', transform: { scale: 0.6, x: 12, y: -8, rotation: 0 } });
    const sticker2 = createOverlay('2d_filter', { url: 'blob:s2', isBuiltin: false, name: 'Sticker Two', transform: { scale: 0.4, x: -12, y: 8, rotation: 15 } });
    const head1 = createObject3D('headpiece', { proceduralId: 'royal-crown', name: 'Crown', anchor: 'crown', anchorConfig: { offset: { x: 0, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } });
    const head2 = createObject3D('headpiece', { proceduralId: 'hope-halo', name: 'Halo', anchor: 'forehead', anchorConfig: { offset: { x: 0, y: 1, z: 0.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: 0.8 } });

    const draft: StudioDraft = {
      ...initialDraft('border'),
      objects: [frame, sticker1, sticker2, head1, head2],
      selectedId: frame.id,
      kind: 'composite',
      shaderId: 'golden-hour-bloom',
      shaderParams: { uIntensity: 0.5 },
    };
    const urls = {
      [frame.id]: 'https://cdn/frame.png',
      [sticker1.id]: 'https://cdn/sticker1.png',
      [sticker2.id]: 'https://cdn/sticker2.png',
    };
    const payload = draftToPayload(draft, resolver(urls), 'thumb-url');

    expect(payload.kind).toBe('composite');
    expect(payload.config?.layers).toHaveLength(5);
    expect(payload.config?.layers?.map((l) => l.kind)).toEqual(['border', '2d_filter', '2d_filter', '3d_attachment', '3d_attachment']);
    expect(payload.config?.ambientShader).toEqual({ shaderId: 'golden-hour-bloom', params: { uIntensity: 0.5 } });
    // Legacy mirror: the first 2D overlay claims asset_url/transform, the first 3D object claims anchor/procedural.
    expect(payload.asset_url).toBe('https://cdn/frame.png');
    expect(payload.config?.transform).toEqual(frame.transform);
    expect(payload.config?.anchor?.anchor).toBe('crown');
    expect(payload.config?.procedural).toBe('royal-crown');
    expect(payload.thumbnail_url).toBe('thumb-url');

    const reloaded = experienceToDraft(expFromPayload(payload))!;
    expect(reloaded.kind).toBe('composite');
    expect(reloaded.objects).toHaveLength(5);
    expect(reloaded.objects.map((o) => (o.type === 'overlay' ? o.overlayKind : o.type))).toEqual(['border', '2d_filter', '2d_filter', 'headpiece', 'headpiece']);
    expect(reloaded.shaderId).toBe('golden-hour-bloom');
    expect(reloaded.shaderParams).toEqual({ uIntensity: 0.5 });
    expect((reloaded.objects[3] as Object3D).proceduralId).toBe('royal-crown');
    expect((reloaded.objects[4] as Object3D).proceduralId).toBe('hope-halo');
  });

  it('hidden layers persist through save AND reload (kept in the scene, rendered nowhere)', () => {
    // W4-D H1: a hidden sticker must neither ship visible to guests (the booth
    // skips hidden layers) nor vanish from the scene on reload.
    const frame = createOverlay('border', { url: 'data:f', isBuiltin: true, name: 'Frame' });
    const sticker = createOverlay('2d_filter', { url: 'blob:s', isBuiltin: false, name: 'S' });
    sticker.hidden = true;
    const draft: StudioDraft = { ...initialDraft('border'), objects: [frame, sticker], selectedId: frame.id, kind: 'composite' };
    const payload = draftToPayload(draft, resolver({ [frame.id]: 'https://cdn/f.png', [sticker.id]: 'https://cdn/s.png' }), null);
    expect(payload.config?.layers?.map((l) => l.hidden)).toEqual([undefined, true]);
    const reloaded = experienceToDraft(expFromPayload(payload))!;
    expect(reloaded.objects.map((o) => o.hidden)).toEqual([undefined, true]);
  });

  it('a single hidden object forces the layers path (the singular mirror alone would render it)', () => {
    const sticker = createOverlay('2d_filter', { url: 'blob:s', isBuiltin: false, name: 'S' });
    sticker.hidden = true;
    const draft: StudioDraft = { ...initialDraft('2d_filter'), objects: [sticker], selectedId: sticker.id };
    const payload = draftToPayload(draft, resolver({ [sticker.id]: 'https://cdn/s.png' }), null);
    expect(payload.config?.layers).toHaveLength(1);
    expect(payload.config?.layers?.[0].hidden).toBe(true);
  });

  it('ambientShader is omitted entirely when the filter slot is empty', () => {
    const frame = createOverlay('border', { url: 'data:f', isBuiltin: true });
    const model = createObject3D('model', { assetUrl: 'blob:m', name: 'Model' });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [frame, model], selectedId: frame.id, kind: 'composite' };
    const payload = draftToPayload(draft, resolver({ [frame.id]: 'https://cdn/f.png', [model.id]: 'https://cdn/m.glb' }), null);
    expect(payload.kind).toBe('composite');
    expect(payload.config?.ambientShader).toBeUndefined();
  });

  it('the filter slot also rides a single-family (non-composite) scene: written to ambientShader, not config.shader', () => {
    const border = createOverlay('border', { url: 'data:b', isBuiltin: true });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [border], selectedId: border.id, kind: 'border', shaderId: 'champagne-sparkle', shaderParams: { uIntensity: 0.3 } };
    const payload = draftToPayload(draft, resolver({ [border.id]: 'https://cdn/b.png' }), null);
    expect(payload.kind).toBe('border');
    expect(payload.config?.shader).toBeUndefined();
    expect(payload.config?.ambientShader).toEqual({ shaderId: 'champagne-sparkle', params: { uIntensity: 0.3 } });

    const reloaded = experienceToDraft(expFromPayload(payload))!;
    expect(reloaded.shaderId).toBe('champagne-sparkle');
    expect(reloaded.shaderParams).toEqual({ uIntensity: 0.3 });
    expect(reloaded.kind).toBe('border');
  });

  it('a filter-only ("shader" kind) scene keeps writing config.shader, never config.ambientShader (byte-identical)', () => {
    const draft: StudioDraft = { ...initialDraft('shader'), shaderId: 'champagne-sparkle', shaderParams: { uIntensity: 0.7 } };
    const payload = draftToPayload(draft, resolver({}), null);
    expect(payload.kind).toBe('shader');
    expect(payload.config?.shader).toEqual({ shaderId: 'champagne-sparkle', params: { uIntensity: 0.7 } });
    expect(payload.config?.ambientShader).toBeUndefined();
  });
});

describe('existingUrlResolver (W6-C: Save as template — no re-upload)', () => {
  it('resolves an overlay to its existing url (builtin data: url or a previously-uploaded http url)', () => {
    const border = createOverlay('border', { url: 'data:border-svg', isBuiltin: true });
    const sticker = createOverlay('2d_filter', { url: 'https://cdn/sticker.png', isBuiltin: false });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [border, sticker], selectedId: border.id, kind: 'border' };
    const r = existingUrlResolver(draft);
    expect(r).not.toBeNull();
    expect((r as Map<string, string | null>).get(border.id)).toBe('data:border-svg');
    expect((r as Map<string, string | null>).get(sticker.id)).toBe('https://cdn/sticker.png');
  });

  it('resolves a 3D model to its assetUrl and a procedural head piece to null', () => {
    const model = createObject3D('model', { assetUrl: 'https://cdn/crown.glb', name: 'Model' });
    const piece = createObject3D('headpiece', { proceduralId: 'royal-crown', name: 'Piece' });
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [model, piece], selectedId: model.id, kind: '3d_attachment' };
    const r = existingUrlResolver(draft);
    expect(r).not.toBeNull();
    expect((r as Map<string, string | null>).get(model.id)).toBe('https://cdn/crown.glb');
    expect((r as Map<string, string | null>).get(piece.id)).toBeNull();
  });

  it('returns null when any overlay carries a pending, un-uploaded blob', () => {
    const sticker = createOverlay('2d_filter', { url: 'blob:pending', blob: new Blob(['x']), isBuiltin: false });
    const draft: StudioDraft = { ...initialDraft('2d_filter'), objects: [sticker], selectedId: sticker.id, kind: '2d_filter' };
    expect(existingUrlResolver(draft)).toBeNull();
  });

  it('feeds straight into draftToPayload (round-trips as a normal save would, without uploading)', () => {
    const border = createOverlay('border', { url: 'data:border-svg', isBuiltin: true, transform: { scale: 1.1, x: 0, y: 0, rotation: 0 } });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [border], selectedId: border.id, kind: 'border' };
    const r = existingUrlResolver(draft)!;
    const payload = draftToPayload(draft, r, null);
    expect(payload.asset_url).toBe('data:border-svg');
    expect(payload.config?.transform).toEqual(border.transform);
  });
});

describe('face-triggered effects (W7-D)', () => {
  it('a scene with no triggers writes NO config.triggers key (byte-identical)', () => {
    const border = createOverlay('border', { url: 'data:b', isBuiltin: true });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [border], selectedId: border.id, kind: 'border' };
    const payload = draftToPayload(draft, resolver({ [border.id]: 'https://cdn/b.png' }), null);
    expect(payload.config?.triggers).toBeUndefined();
    expect(payload.config?.layers).toBeUndefined(); // still the singular path
  });

  it('writes config.triggers and round-trips a reveal target through regenerated object ids', () => {
    const frame = createOverlay('border', { url: 'data:f', isBuiltin: true, name: 'Frame' });
    const sticker = createOverlay('2d_filter', { url: 'blob:s', isBuiltin: false, name: 'S' });
    const draft: StudioDraft = {
      ...initialDraft('border'),
      objects: [frame, sticker],
      selectedId: frame.id,
      kind: 'border',
      triggers: [
        { id: 'r1', source: 'smile', action: { type: 'reveal', objectId: sticker.id } },
        { id: 'b1', source: 'wink', action: { type: 'burst', style: 'hearts' } },
      ],
    };
    const payload = draftToPayload(draft, resolver({ [frame.id]: 'https://cdn/f.png', [sticker.id]: 'https://cdn/s.png' }), null);
    expect(payload.config?.triggers).toHaveLength(2);
    expect(payload.config?.layers).toHaveLength(2); // reveal forces the layers path

    const reloaded = experienceToDraft(expFromPayload(payload))!;
    expect(reloaded.triggers).toHaveLength(2);
    const reveal = reloaded.triggers.find((t) => t.action.type === 'reveal')!;
    // objectId remapped to the freshly-created sticker object (index 1)
    expect((reveal.action as { objectId: string }).objectId).toBe(reloaded.objects[1].id);
    expect(reloaded.triggers.some((t) => t.action.type === 'burst')).toBe(true);
  });

  it('drops a reveal whose target object no longer exists; keeps burst/filterPulse', () => {
    const exp = baseExp({
      kind: '2d_filter',
      asset_url: 'https://cdn/s.png',
      config: {
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        triggers: [
          { id: 'gone', source: 'smile', action: { type: 'reveal', objectId: 'obj-does-not-exist' } },
          { id: 'keep', source: 'browRaise', action: { type: 'filterPulse', shaderId: 'vhs' } },
        ],
      },
    });
    const draft = experienceToDraft(exp)!;
    expect(draft.triggers.map((t) => t.id)).toEqual(['keep']);
  });

  it('a single-object scene with a reveal forces config.layers so the target id is stable', () => {
    const sticker = createOverlay('2d_filter', { url: 'blob:s', isBuiltin: false, name: 'S' });
    const draft: StudioDraft = {
      ...initialDraft('2d_filter'),
      objects: [sticker],
      selectedId: sticker.id,
      triggers: [{ id: 'r', source: 'smile', action: { type: 'reveal', objectId: sticker.id } }],
    };
    const payload = draftToPayload(draft, resolver({ [sticker.id]: 'https://cdn/s.png' }), null);
    expect(payload.config?.layers).toHaveLength(1);
    expect(payload.config?.layers?.[0].id).toBe(sticker.id);
  });

  it('garbage in config.triggers is ignored (parseTriggers guard)', () => {
    const exp = baseExp({ kind: 'shader', config: { shader: { shaderId: 'vhs' }, triggers: 'not-an-array' as unknown } });
    expect(experienceToDraft(exp)!.triggers).toEqual([]);
  });
});
