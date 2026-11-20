/**
 * Library workshop round trip (admin-api open_library_item_in_workshop).
 *
 * "Edit in Studio" copies a library row into the admin's workshop event as
 * `config = stripLibraryMeta(row.config)`; the Studio loads it through
 * experienceToDraft and saves it through draftToPayload, which REBUILDS config
 * from the draft — any key the draft does not model is dropped on save. These
 * tests pin that an untouched open → save keeps everything that renders, so
 * the next published version is the same piece unless the admin changed it.
 *
 * Layer ids are regenerated on every load (draftMapping finalizeTriggers), so
 * the comparison renames each layer to its position and remaps trigger
 * objectIds the same way.
 */
import { describe, expect, it } from 'vitest';
import type { Experience, ExperienceConfig } from '../../types';
import { stripLibraryMeta } from '../libraryPublish';
import { buildDraftRenderConfig } from '../libraryImport';
import { draftToPayload, existingUrlResolver, experienceToDraft } from './draftMapping';

const PUB = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets';
const ITEM = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const LIB = `${PUB}/_platform/library/${ITEM}`;

interface LibraryRowFixture {
  name: string;
  kind: Experience['kind'];
  asset_url: string | null;
  thumbnail_url: string | null;
  config: Record<string, unknown>;
}

/** What the workshop scene saves as after an untouched open in the Studio. */
function openAndSave(row: LibraryRowFixture) {
  const scene: Experience = {
    id: '11111111-2222-4333-8444-555555555555',
    created_at: '2026-11-19T00:00:00Z',
    updated_at: '2026-11-19T00:00:00Z',
    name: row.name,
    kind: row.kind,
    asset_url: row.asset_url,
    thumbnail_url: row.thumbnail_url,
    config: stripLibraryMeta(row.config) as ExperienceConfig,
    is_published: true,
    featured: true,
    sort_order: 0,
  };
  const draft = experienceToDraft(scene);
  expect(draft, 'the Studio refused to open the copy').not.toBeNull();
  // StudioShell.handleSave keeps stored http/data URLs as they are (no upload)
  // and keeps an http thumbnail — existingUrlResolver is the same rule.
  const urls = existingUrlResolver(draft!);
  expect(urls, 'a stored overlay came back as an un-uploaded blob').not.toBeNull();
  const thumb = draft!.thumbUrl !== null && draft!.thumbUrl.startsWith('http') ? draft!.thumbUrl : null;
  return draftToPayload(draft!, urls!, thumb);
}

/** Layer ids → positions, everywhere they are referenced. */
function byPosition(config: Record<string, unknown>): Record<string, unknown> {
  const layers = Array.isArray(config.layers) ? (config.layers as Array<Record<string, unknown>>) : null;
  const pos = new Map<string, string>();
  layers?.forEach((l, i) => pos.set(String(l.id), `L${i}`));
  const out: Record<string, unknown> = { ...config };
  if (layers) out.layers = layers.map((l, i) => ({ ...l, id: `L${i}` }));
  if (Array.isArray(config.triggers)) {
    out.triggers = (config.triggers as Array<{ action: Record<string, unknown> }>).map((t) => {
      const a = t.action;
      if (typeof a.objectId !== 'string') return t;
      return { ...t, action: { ...a, objectId: pos.get(a.objectId) ?? `stale:${a.objectId}` } };
    });
  }
  return out;
}

describe('library item → workshop → Studio save keeps what renders', () => {
  it('a bulk-imported 3D prop (buildDraftRenderConfig) survives byte-for-byte', () => {
    const asset = `${LIB}/model.glb`;
    const rendering = buildDraftRenderConfig({ assetUrl: asset, name: 'Gold crown', categoryId: 'headwear', maxDim: 0.4 });
    const row: LibraryRowFixture = {
      name: 'Gold crown',
      kind: '3d_attachment',
      asset_url: asset,
      thumbnail_url: `${LIB}/thumb.png`,
      config: {
        ...rendering,
        library: {
          version: 1, sourceExperienceId: '', publishedAt: 't', publishedBy: 'u', listed: true,
          tags: { occasions: [], colors: ['gold'], styles: [] }, collection: 'christmas', import: { bytes: 1 },
        },
      },
    };
    const saved = openAndSave(row);
    expect(saved.kind).toBe('3d_attachment');
    expect(saved.asset_url).toBe(asset);
    expect(saved.thumbnail_url).toBe(`${LIB}/thumb.png`);
    expect(byPosition(saved.config as Record<string, unknown>)).toEqual(byPosition(rendering));
    // The copy is a plain scene: no library provenance leaks into it.
    expect('library' in (saved.config as object)).toBe(false);
  });

  it('a held (hand-anchored) bulk import keeps its hand anchor and v2 calibration', () => {
    const asset = `${LIB}/wand.glb`;
    const rendering = buildDraftRenderConfig({ assetUrl: asset, name: 'Wand', categoryId: 'held', maxDim: 0.3 });
    const saved = openAndSave({ name: 'Wand', kind: '3d_attachment', asset_url: asset, thumbnail_url: null, config: rendering });
    expect(byPosition(saved.config as Record<string, unknown>)).toEqual(byPosition(rendering));
    const layer = saved.config?.layers?.[0];
    expect(layer?.handAnchor).toBe('grip');
    expect(layer?.anchorVersion).toBe(2);
  });

  // A layered scene as the Studio writes it: a frame, a hidden sticker, and two
  // 3D pieces (one occluding, finished, customised, animated) + scene-level
  // filter, guest lettering, triggers and a tracking engine.
  const composite: ExperienceConfig = {
    layers: [
      { id: 'frame-1', kind: 'border', asset_url: `${LIB}/frame.png`, transform: { scale: 1, x: 0, y: 0, rotation: 0 }, opacity: 1, name: 'Gold frame' },
      { id: 'sticker-1', kind: '2d_filter', asset_url: `${LIB}/star.png`, transform: { scale: 0.4, x: 0.2, y: -0.3, rotation: 15 }, opacity: 1, name: 'Star', animation: 'pulse', hidden: true },
      {
        id: 'crown-1', kind: '3d_attachment', asset_url: `${LIB}/crown.glb`, name: 'Crown',
        anchor: { anchor: 'crown', offset: { x: 0, y: 1.5, z: -0.5 }, rotation: { x: 0.1, y: 0, z: 0 }, scale: 1.2 },
        // Occlusion is ON unless a layer says `occlusion: false`, so an occluding layer has no key.
        finish: 'gold', tint: '#ffcc00', tintStrength: 0.5, animation: 'spin', anchorVersion: 2,
        customization: { parts: { band: { hex: '#aa1122' } }, label: { slotId: 'front', token: 'guestName', style: 'serif', hex: '#ffffff' } },
      },
      {
        id: 'glasses-1', kind: '3d_attachment', asset_url: `${LIB}/glasses.glb`, name: 'Glasses',
        anchor: { anchor: 'noseBridge', offset: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
        occlusion: false,
      },
    ],
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    opacity: 1,
    // letteringFit.normalizeGuestLettering always writes `text`, so a Studio-saved row has it.
    lettering: { token: 'guestName', text: '', style: 'script', color: '#FFFFFF', placement: 'bottom' },
    anchor: { anchor: 'crown', offset: { x: 0, y: 1.5, z: -0.5 }, rotation: { x: 0.1, y: 0, z: 0 }, scale: 1.2 },
    ambientShader: { shaderId: 'champagne-sparkle', params: {} },
    scene: 'royal-night',
    triggers: [
      { id: 't1', source: 'smile', action: { type: 'reveal', objectId: 'sticker-1' } },
      { id: 't2', source: 'mouthOpen', action: { type: 'burst', style: 'confetti' } },
    ],
    tracking: 'hybrid',
  };

  it('a composite (frame + occluding 3D + hidden sticker + triggers) keeps every rendering key', () => {
    const row: LibraryRowFixture = {
      name: 'Royal night', kind: 'composite', asset_url: `${LIB}/frame.png`, thumbnail_url: `${LIB}/thumb.png`,
      config: { ...composite, library: { version: 3, lineageId: ITEM, listed: true, tags: {} } },
    };
    const saved = openAndSave(row);
    expect(saved.kind).toBe('composite');
    expect(saved.asset_url).toBe(`${LIB}/frame.png`);
    const before = byPosition(composite as Record<string, unknown>);
    const after = byPosition(saved.config as Record<string, unknown>);
    // Field by field first, so a failure names the key that drifted.
    for (const key of Object.keys(before)) expect(after[key], `config.${key}`).toEqual(before[key]);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const layers = after.layers as Array<Record<string, unknown>>;
    // The occluding crown stays ON (no key) and the glasses' explicit OFF survives.
    expect(layers[2].occlusion).toBeUndefined();
    expect(layers[3].occlusion).toBe(false);
    expect(after.occlusion).toBeUndefined();
  });

  it('open → save → open → save is stable (no slow drift across versions)', () => {
    const once = openAndSave({ name: 'Royal night', kind: 'composite', asset_url: `${LIB}/frame.png`, thumbnail_url: null, config: composite as Record<string, unknown> });
    const twice = openAndSave({ name: 'Royal night', kind: 'composite', asset_url: once.asset_url ?? null, thumbnail_url: null, config: once.config as Record<string, unknown> });
    expect(byPosition(twice.config as Record<string, unknown>)).toEqual(byPosition(once.config as Record<string, unknown>));
  });
});
