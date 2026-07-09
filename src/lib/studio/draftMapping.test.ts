import { describe, it, expect } from 'vitest';
import { experienceToDraft, draftToPayload, isStudioKind } from './draftMapping';
import { initialDraft } from './state';
import { defaultParams } from '../shaders';
import type { Experience } from '../../types';

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
    const payload = draftToPayload(draft, null, null);
    expect(payload.kind).toBe('shader');
    expect(payload.config?.shader).toEqual({ shaderId: 'champagne-sparkle', params: { uIntensity: 0.7 } });
    expect(payload.asset_url).toBeNull();
  });
  it('missing params fall back to registry defaults', () => {
    const exp = baseExp({ kind: 'shader', config: { shader: { shaderId: 'champagne-sparkle' } } });
    expect(experienceToDraft(exp)!.shaderParams).toEqual(defaultParams('champagne-sparkle'));
  });
});

describe('round-trip: border / sticker', () => {
  it('stored asset loads as custom (builtin sync must not overwrite it)', () => {
    const exp = baseExp({
      kind: 'border',
      asset_url: 'https://cdn/frame.png',
      config: { transform: { scale: 1.2, x: 5, y: -3, rotation: 10 }, opacity: 1 },
    });
    const draft = experienceToDraft(exp)!;
    expect(draft.overlayUrl).toBe('https://cdn/frame.png');
    expect(draft.overlayIsBuiltin).toBe(false);
    expect(draft.transform).toEqual({ scale: 1.2, x: 5, y: -3, rotation: 10 });
    const payload = draftToPayload(draft, 'https://cdn/frame.png', null);
    expect(payload.config?.transform).toEqual({ scale: 1.2, x: 5, y: -3, rotation: 10 });
    expect(payload.config?.opacity).toBe(1);
    expect(payload.asset_url).toBe('https://cdn/frame.png');
  });
});

describe('round-trip: 3d_attachment', () => {
  it('GLB attachment keeps anchor config', () => {
    const exp = baseExp({
      kind: '3d_attachment',
      asset_url: 'https://cdn/crown.glb',
      config: {
        anchor: { anchor: 'forehead', offset: { x: 0, y: 1, z: 2 }, rotation: { x: 0.1, y: 0, z: 0 }, scale: 3 },
      },
    });
    const draft = experienceToDraft(exp)!;
    expect(draft.anchor).toBe('forehead');
    expect(draft.anchorConfig.scale).toBe(3);
    const payload = draftToPayload(draft, 'https://cdn/crown.glb', null);
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
    expect(draft.proceduralId).toBe('hope-halo');
    const payload = draftToPayload(draft, 'https://ignored/upload.glb', null);
    expect(payload.asset_url).toBeNull();
    expect(payload.config?.procedural).toBe('hope-halo');
  });
});

describe('scene tag and occlusion (opt-in)', () => {
  it('scene tag round-trips; occlusion is never written on a 2D kind', () => {
    const draft = initialDraft('shader');
    draft.scene = 'Neon Nights';
    const payload = draftToPayload(draft, null, null);
    expect(payload.config?.scene).toBe('Neon Nights');
    expect(payload.config?.occlusion).toBeUndefined();
  });
  it('occlusion is opt-in: new pieces default OFF; enabling persists true', () => {
    // New 3D pieces default occlusion OFF so an asset is never surprise-hidden.
    const fresh = initialDraft('3d_attachment');
    expect(fresh.occlusion).toBe(false);
    expect(draftToPayload(fresh, 'x', null).config?.occlusion).toBeUndefined();

    const on = { ...fresh, occlusion: true };
    const onPayload = draftToPayload(on, 'x', null);
    expect(onPayload.config?.occlusion).toBe(true);
    expect(experienceToDraft(baseExp({ kind: '3d_attachment', config: onPayload.config! }))!.occlusion).toBe(true);
  });
  it('an existing experience with no occlusion flag loads as opt-in OFF (no silent change)', () => {
    const exp = baseExp({ kind: '3d_attachment', config: { anchor: { anchor: 'crown', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } } });
    expect(experienceToDraft(exp)!.occlusion).toBe(false);
  });
  it('composite kind refuses to load into the studio editor', () => {
    expect(experienceToDraft(baseExp({ kind: 'composite' }))).toBeNull();
  });
});
