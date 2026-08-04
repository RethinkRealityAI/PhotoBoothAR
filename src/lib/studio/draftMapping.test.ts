import { describe, it, expect } from 'vitest';
import { experienceToDraft, draftToPayload, existingUrlResolver, isStudioKind, layerToPiece, objectToPiece, type UrlResolver } from './draftMapping';
import { initialDraft, createOverlay, createObject3D, withCustomization, type Overlay2D, type Object3D, type StudioDraft } from './state';
import { normalizeTemplate } from './assetTemplate';
import { defaultParams } from '../shaders';
import type { AssetCustomization, Experience, ExperienceDraft } from '../../types';

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

describe('guest-name lettering (config-level, mirrored to the frame object)', () => {
  const lettering = { token: 'guestName', text: '', style: 'script', color: '#FFD700', placement: 'bottom' } as const;

  it('omits the key entirely when the scene has no lettering', () => {
    const o = createOverlay('border', { url: 'https://cdn/f.png', isBuiltin: false });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [o], selectedId: o.id, kind: 'border' };
    expect(draftToPayload(draft, resolver({ [o.id]: 'https://cdn/f.png' }), null).config?.lettering).toBeUndefined();
  });

  it('round-trips through config.lettering onto the frame object', () => {
    const o = createOverlay('border', { url: 'https://cdn/f.png', isBuiltin: false, lettering });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [o], selectedId: o.id, kind: 'border' };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/f.png' }), null);
    expect(payload.config?.lettering).toEqual(lettering);
    // …and still takes the byte-identical singular path (no layers key).
    expect(payload.config?.layers).toBeUndefined();

    const back = experienceToDraft(expFromPayload(payload))!;
    expect((back.objects[0] as Overlay2D).lettering).toEqual(lettering);
  });

  it('survives a composite scene (lands on the first overlay)', () => {
    const o = createOverlay('border', { url: 'https://cdn/f.png', isBuiltin: false, lettering });
    const p = createObject3D('headpiece', { proceduralId: 'royal-crown' });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [o, p], selectedId: o.id, kind: 'composite' };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/f.png' }), null);
    expect(payload.kind).toBe('composite');
    expect(payload.config?.lettering).toEqual(lettering);
    const back = experienceToDraft(expFromPayload(payload))!;
    expect((back.objects[0] as Overlay2D).lettering).toEqual(lettering);
  });

  it('drops a stored config that is junk rather than loading it', () => {
    // events.config is jsonb — a hand-edited row must not reach the canvas.
    const exp = baseExp({
      kind: 'border',
      asset_url: 'https://cdn/f.png',
      config: { transform: { scale: 1, x: 0, y: 0, rotation: 0 }, lettering: { token: 'guestName', style: 'comic', placement: 'bottom', color: '#fff' } as never },
    });
    expect((experienceToDraft(exp)!.objects[0] as Overlay2D).lettering).toBeUndefined();
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

/* ── Material finish (W6) ──────────────────────────────────────────────────
 * The whole feature persists inside the experience's jsonb `config.layers` —
 * no column, no migration — so these round-trips ARE the storage contract. */
describe('round-trip: material finish / tint', () => {
  it('carries finish, tint and strength through payload and back', () => {
    const o = createObject3D('model', { assetUrl: 'https://cdn/m.glb', finish: 'gold', tint: '#ff00aa', tintStrength: 0.4 });
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/m.glb' }), null);
    const layer = payload.config?.layers?.[0];
    expect(layer?.finish).toBe('gold');
    expect(layer?.tint).toBe('#ff00aa');
    expect(layer?.tintStrength).toBeCloseTo(0.4);

    const back = experienceToDraft(expFromPayload(payload))!.objects[0] as Object3D;
    expect(back.finish).toBe('gold');
    expect(back.tint).toBe('#ff00aa');
    expect(back.tintStrength).toBeCloseTo(0.4);
  });

  it('an UNSTYLED object writes no finish keys AND does not force the layers path', () => {
    const o = createObject3D('model', { assetUrl: 'https://cdn/m.glb' });
    expect('finish' in o).toBe(false);
    expect('tint' in o).toBe(false);
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/m.glb' }), null);
    // Pre-W6 single-object scenes keep saving through the singular mirror, with
    // no config.layers key at all — byte-identical rows.
    expect(payload.config?.layers).toBeUndefined();
  });

  it('a LONE finished object still forces config.layers — the singular mirror has no finish slot', () => {
    const o = createObject3D('model', { assetUrl: 'https://cdn/m.glb', finish: 'chrome' });
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/m.glb' }), null);
    expect(payload.config?.layers).toHaveLength(1);
    expect(payload.config?.layers?.[0].finish).toBe('chrome');
    expect((experienceToDraft(expFromPayload(payload))!.objects[0] as Object3D).finish).toBe('chrome');
  });

  it('a layer stored before this feature loads with the exporter material untouched', () => {
    const exp = baseExp({
      kind: '3d_attachment',
      config: { layers: [{ id: 'l1', kind: '3d_attachment', asset_url: 'https://cdn/a.glb', anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } }] },
    });
    const back = experienceToDraft(exp)!.objects[0] as Object3D;
    expect(back.finish).toBeUndefined();
    expect(back.tint).toBeUndefined();
  });

  it('full strength is the default and is never written', () => {
    const o = createObject3D('model', { assetUrl: 'https://cdn/m.glb', tint: '#00ff00', tintStrength: 1 });
    expect(o.tint).toBe('#00ff00');
    expect('tintStrength' in o).toBe(false);
  });

  it('a hostile finish/tint from the database cannot reach a THREE material', () => {
    const exp = baseExp({
      kind: '3d_attachment',
      config: { layers: [{ id: 'l1', kind: '3d_attachment', asset_url: 'https://cdn/a.glb', finish: 'javascript:alert(1)', tint: 'url(evil)', tintStrength: 99, anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } }] },
    });
    const back = experienceToDraft(exp)!.objects[0] as Object3D;
    expect(back.finish).toBeUndefined();
    expect(back.tint).toBeUndefined();
  });
});

/* ── Per-asset customization (Stage B) ─────────────────────────────────────
 * Regions + the engraved label live in the SAME jsonb `config.layers` — no
 * column, no migration — so, exactly like the finish block above, these
 * round-trips ARE the storage contract. */
const HAT = (over: Partial<AssetCustomization> = {}): AssetCustomization => ({
  parts: { band: { hex: '#d4a017' }, crown: { hex: '#101010', finish: 'matte' } },
  label: { slotId: 'front', token: 'guestName', style: 'script', hex: '#ffffff' },
  ...over,
});

describe('round-trip: asset customization', () => {
  it('B1 — a LONE customized object forces config.layers and reloads customized', () => {
    // THE TRAP: with one object, no animation, nothing hidden, no finish and no
    // reveal trigger, draftToPayload takes the LEGACY SINGULAR path, which has
    // slots for asset_url/anchor/procedural/occlusion and NOTHING else. Without
    // `anyCustom` in that predicate this scene saves and reloads with the hat's
    // colours and the guest's name silently gone.
    const o = createObject3D('model', { assetUrl: 'https://cdn/hat.glb', customization: HAT() });
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/hat.glb' }), null);

    expect(payload.config?.layers).toHaveLength(1);
    expect(payload.config?.layers?.[0].customization).toEqual(HAT());

    const back = experienceToDraft(expFromPayload(payload))!.objects[0] as Object3D;
    expect(back.customization).toEqual(HAT());
  });

  it('an UNCUSTOMIZED object writes no key AND keeps the byte-identical singular path', () => {
    const o = createObject3D('model', { assetUrl: 'https://cdn/m.glb' });
    expect('customization' in o).toBe(false);
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/m.glb' }), null);
    expect(payload.config?.layers).toBeUndefined();
    expect('customization' in (payload.config ?? {})).toBe(false);
  });

  it('customized → reset writes the same bytes as never customized', () => {
    const plain = createObject3D('model', { assetUrl: 'https://cdn/m.glb' });
    const styled = withCustomization(plain, { part: { id: 'band', hex: '#ff0000' } });
    const reset = withCustomization(styled, { part: { id: 'band', hex: null } });
    expect('customization' in reset).toBe(false);

    const pay = (o: Object3D) =>
      draftToPayload({ ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id }, resolver({ [o.id]: 'https://cdn/m.glb' }), null);
    expect(JSON.stringify(pay(reset))).toBe(JSON.stringify(pay(plain)));
  });

  it('survives a mixed (composite) scene alongside a frame', () => {
    const frame = createOverlay('border', { url: 'https://cdn/f.png', isBuiltin: false });
    const o = createObject3D('model', { assetUrl: 'https://cdn/hat.glb', customization: HAT() });
    const draft: StudioDraft = { ...initialDraft('border'), objects: [frame, o], selectedId: o.id };
    const payload = draftToPayload(draft, resolver({ [frame.id]: 'https://cdn/f.png', [o.id]: 'https://cdn/hat.glb' }), null);
    expect(payload.kind).toBe('composite');
    const back = experienceToDraft(expFromPayload(payload))!.objects[1] as Object3D;
    expect(back.customization).toEqual(HAT());
  });

  it('a layer stored before this feature loads with NO customization key', () => {
    const exp = baseExp({
      kind: '3d_attachment',
      config: { layers: [{ id: 'l1', kind: '3d_attachment', asset_url: 'https://cdn/a.glb', anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } }] },
    });
    const back = experienceToDraft(exp)!.objects[0] as Object3D;
    expect('customization' in back).toBe(false);
  });

  it('hostile customization from the database is normalized away, never rendered', () => {
    const exp = baseExp({
      kind: '3d_attachment',
      config: {
        layers: [{
          id: 'l1', kind: '3d_attachment', asset_url: 'https://cdn/a.glb',
          anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
          customization: {
            parts: { evil: { hex: 'url(javascript:alert(1))', finish: 'DROP TABLE' }, ok: { hex: '#ABCDEF' } },
            label: { slotId: 'front', token: 'nope', style: 'comic', hex: 'red' },
          } as unknown as AssetCustomization,
        }],
      },
    });
    const back = experienceToDraft(exp)!.objects[0] as Object3D;
    // The junk region is dropped whole (no hex, no finish left); the good one
    // survives lower-cased; the label's bad token kills the label outright.
    expect(back.customization).toEqual({ parts: { ok: { hex: '#abcdef' } } });
  });
});

/* ── The one 3D piece mapper (was three hand-written copies) ───────────────── */
describe('layerToPiece / objectToPiece', () => {
  const glb = 'https://cdn/hat.glb';
  const styled = () =>
    createObject3D('model', {
      assetUrl: glb, anchor: 'crown', animation: 'float', occlusion: true,
      finish: 'gold', tint: '#ff00aa', tintStrength: 0.4, customization: HAT(),
    });

  it('the STUDIO object and the SAVED layer produce an identical piece', () => {
    // This is the anti-drift assertion: the booth reads the layer, the studio
    // reads the object, and nothing used to compare the two.
    const o = styled();
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const layer = draftToPayload(draft, resolver({ [o.id]: glb }), null).config!.layers![0];
    const ctx = { guestName: 'Ada', occlusionEnabled: true };
    expect(layerToPiece(layer, ctx)).toEqual(objectToPiece(o, ctx));
  });

  it('carries every field the renderers need', () => {
    const p = objectToPiece(styled(), { guestName: 'Ada', occlusionEnabled: true });
    expect(p.assetUrl).toBe(glb);
    expect(p.proceduralId).toBeNull();
    expect(p.anchor.anchor).toBe('crown');
    expect(p.animation).toBe('float');
    expect(p.occlude).toBe(true);
    expect(p.finish).toBe('gold');
    expect(p.tint).toBe('#ff00aa');
    expect(p.tintStrength).toBeCloseTo(0.4);
    expect(p.customization?.parts).toEqual(HAT().parts);
  });

  it('a headpiece keeps its procedural id and no asset url', () => {
    const o = createObject3D('headpiece', { proceduralId: 'royal-crown' });
    const p = objectToPiece(o);
    expect(p.proceduralId).toBe('royal-crown');
    expect(p.assetUrl).toBeNull();
  });

  it('carries the fx emitter key — the object id, identically from both sides', () => {
    // A fired beam looks its emitter up under this key; if either mapper drops
    // it (or they disagree), the beam falls back to the generic origin and the
    // "blast from the asset" feature silently dies.
    const o = styled();
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const layer = draftToPayload(draft, resolver({ [o.id]: glb }), null).config!.layers![0];
    expect(objectToPiece(o).fxKey).toBe(o.id);
    expect(layerToPiece(layer).fxKey).toBe(o.id);
  });

  it('occlusion needs BOTH the master gate and the per-piece opt-in', () => {
    const on = createObject3D('model', { assetUrl: glb, occlusion: true });
    const off = createObject3D('model', { assetUrl: glb, occlusion: false });
    expect(objectToPiece(on, { occlusionEnabled: true }).occlude).toBe(true);
    expect(objectToPiece(on, { occlusionEnabled: false }).occlude).toBe(false);
    expect(objectToPiece(on).occlude).toBe(false);
    expect(objectToPiece(off, { occlusionEnabled: true }).occlude).toBe(false);
  });

  it('B4 — a guestName label resolves to THIS guest, and an empty name draws nothing', () => {
    const o = styled();
    const resolved = objectToPiece(o, { guestName: 'Ada Lovelace' }).customization?.label;
    expect(resolved?.text).toBe('Ada Lovelace');
    // Emitted as 'fixed' so a renderer that resolves the token itself and one
    // that just draws `text` engrave the same string.
    expect(resolved?.token).toBe('fixed');
    // No name (the guest skipped the prompt) → the label is dropped entirely,
    // matching StageCanvas.drawGuestLettering's early return.
    const none = objectToPiece(o, { guestName: '   ' }).customization;
    expect(none?.label).toBeUndefined();
    expect(none?.parts).toEqual(HAT().parts);
  });

  it('a guestName label with NO parts and no name leaves no customization at all', () => {
    const o = createObject3D('model', {
      assetUrl: glb,
      customization: { label: { slotId: 'front', token: 'guestName', style: 'block', hex: '#ffffff' } },
    });
    expect(objectToPiece(o, { guestName: '' }).customization).toBeUndefined();
    expect(objectToPiece(o, { guestName: 'Bo' }).customization?.label?.text).toBe('Bo');
  });

  it("a 'fixed' label ignores the guest name entirely", () => {
    const o = createObject3D('model', {
      assetUrl: glb,
      customization: { label: { slotId: 'front', token: 'fixed', text: 'Team Beam', style: 'serif', hex: '#ffffff' } },
    });
    expect(objectToPiece(o, { guestName: 'Ada' }).customization?.label?.text).toBe('Team Beam');
  });

  it('customizationEnabled:false (the booth\'s legacy gate) strips it, finish untouched', () => {
    const p = layerToPiece(
      { id: 'l1', kind: '3d_attachment', asset_url: glb, finish: 'gold', customization: HAT(),
        anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } },
      { customizationEnabled: false, guestName: 'Ada' },
    );
    expect(p.customization).toBeUndefined();
    expect(p.finish).toBe('gold');
  });

  it("a layer that omits animation ('none' is never stored) still maps to a concrete one", () => {
    const p = layerToPiece({
      id: 'l1', kind: '3d_attachment', asset_url: glb,
      anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
    });
    expect(p.animation).toBe('none');
  });

  it('a pre-existing layer maps to a piece with no customization key', () => {
    const p = layerToPiece({
      id: 'l1', kind: '3d_attachment', asset_url: glb,
      anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
    });
    expect('customization' in p).toBe(false);
  });
});

describe('round-trip: the configurator template rides with the layer', () => {
  const TPL = { id: 'hat', name: 'Hat', glbUrl: 'https://cdn/hat.glb', fitCm: 20, regions: [{ id: 'band' }], textSlots: [] };

  it('a lone TEMPLATED object forces config.layers even with nothing customized yet', () => {
    // Without this the booth would load the asset with no descriptor and could
    // not tint a region or engrave a name, however the host configured it.
    const o = createObject3D('model', { assetUrl: 'https://cdn/hat.glb', template: TPL });
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const payload = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/hat.glb' }), null);
    expect(payload.config?.layers?.[0].template).toEqual(TPL);
    expect((experienceToDraft(expFromPayload(payload))!.objects[0] as Object3D).template).toEqual(TPL);
  });

  it('reaches the render spec from BOTH sides, styled or not', () => {
    const o = createObject3D('model', { assetUrl: 'https://cdn/hat.glb', template: TPL, customization: HAT() });
    const draft: StudioDraft = { ...initialDraft('3d_attachment'), objects: [o], selectedId: o.id };
    const layer = draftToPayload(draft, resolver({ [o.id]: 'https://cdn/hat.glb' }), null).config!.layers![0];
    // The piece carries the VALIDATED descriptor (the mapper is the one place
    // untrusted jsonb becomes a render spec), not the raw jsonb.
    expect(objectToPiece(o, { guestName: 'Ada' }).template).toEqual(normalizeTemplate(TPL));
    expect(layerToPiece(layer, { guestName: 'Ada' })).toEqual(objectToPiece(o, { guestName: 'Ada' }));
  });

  it('a stale override for a region the template does not have never reaches the renderer', () => {
    // HAT() styles `band` (in TPL) and `crown` (NOT in TPL), and labels slot
    // `front` (TPL has no text slots at all) — exactly the shape a config takes
    // after the host swaps the asset or the library re-authors the descriptor.
    const o = createObject3D('model', { assetUrl: 'https://cdn/hat.glb', template: TPL, customization: HAT() });
    const p = objectToPiece(o, { guestName: 'Ada' });
    expect(p.customization).toEqual({ parts: { band: { hex: '#d4a017' } } });
    // The OBJECT keeps everything — scoping is a render-spec concern, so the
    // host does not silently lose their crown colour by opening the studio.
    expect(o.customization).toEqual(HAT());
  });

  it('an untemplated object carries no template key anywhere', () => {
    const o = createObject3D('model', { assetUrl: 'https://cdn/m.glb' });
    expect('template' in o).toBe(false);
    expect('template' in objectToPiece(o)).toBe(false);
  });
});
