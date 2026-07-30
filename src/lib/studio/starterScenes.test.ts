/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { STARTER_SCENES, STARTER_SCENE_MAP, starterAssetIds, starterPropUrls, starterPropUrl, buildStarterDraft } from './starterScenes';
import { BUNDLED_PROP_MAP } from './bundledProps';
import { BORDER_MAP } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';
import { SHADER_MAP } from '../shaders';
import { MAX_OBJECTS, sceneCounts, deriveKind } from './state';

/** Words that identify one of the three frozen legacy events. */
const LEGACY_WORDS = ['scago', 'hope gala', 'gala', 'jenna', 'jake', 'detola', 'wuyi'];

describe('the shipped catalogue is real', () => {
  it('has several scenes with unique ids', () => {
    expect(STARTER_SCENES.length).toBeGreaterThanOrEqual(5);
    const ids = STARTER_SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every scene has a name, a blurb and two swatch colours', () => {
    for (const s of STARTER_SCENES) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(10);
      expect(s.swatch).toHaveLength(2);
      for (const c of s.swatch) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('the map mirrors the list', () => {
    expect(Object.keys(STARTER_SCENE_MAP)).toHaveLength(STARTER_SCENES.length);
    for (const s of STARTER_SCENES) expect(STARTER_SCENE_MAP[s.id]).toBe(s);
  });

  // The gallery card IS the preview image now, so a scene pointing at a file
  // that was never committed would render as a bare gradient with no way to
  // tell it apart from a slow network. Checked against the real public/ tree
  // (vitest runs in node), which is the only place a 404 can be caught before
  // a host sees it.
  it('every scene ships a preview image that exists in public/', () => {
    for (const s of STARTER_SCENES) {
      expect(s.preview, `${s.id} preview`).toMatch(/^\/starters\/[a-z0-9-]+\.webp$/);
      const onDisk = new URL(`../../../public${s.preview}`, import.meta.url);
      expect(existsSync(onDisk), `${s.id} preview missing on disk: ${s.preview}`).toBe(true);
    }
  });

  it('gives every scene its own preview', () => {
    const previews = STARTER_SCENES.map((s) => s.preview);
    expect(new Set(previews).size).toBe(previews.length);
  });

  // A scene names a prop by id, so the id has to resolve in the ONE shared
  // catalogue the studio library also renders from. This is the assertion that
  // would have caught the reported bug: a scene pointing at a prop the library
  // does not offer (or vice versa) is exactly how the cards ended up promising
  // a crown the library never handed out.
  it('resolves every propId in the shared bundled catalogue', () => {
    for (const s of STARTER_SCENES) {
      if (!s.propId) continue;
      expect(BUNDLED_PROP_MAP[s.propId], `${s.id} propId ${s.propId}`).toBeDefined();
    }
  });

  it('never carries both a procedural piece and a bundled prop', () => {
    for (const s of STARTER_SCENES) {
      expect(!!(s.propId && s.headPieceId), `${s.id} declares both`).toBe(false);
    }
  });

  it('lists every bundled prop once for preloading', () => {
    const urls = starterPropUrls();
    expect(new Set(urls).size).toBe(urls.length);
    for (const s of STARTER_SCENES) {
      const url = starterPropUrl(s);
      if (url) expect(urls).toContain(url);
    }
  });
});

describe('every referenced asset exists in the shipped catalogues (zero network, zero credits)', () => {
  it('resolves every border id, with the right kind', () => {
    for (const s of STARTER_SCENES) {
      if (s.frameId) {
        expect(BORDER_MAP[s.frameId], `${s.id} frame ${s.frameId}`).toBeDefined();
        expect(BORDER_MAP[s.frameId].kind).toBe('border');
      }
      for (const st of s.stickers ?? []) {
        expect(BORDER_MAP[st.borderId], `${s.id} sticker ${st.borderId}`).toBeDefined();
        expect(BORDER_MAP[st.borderId].kind).toBe('2d_filter');
      }
    }
  });

  it('resolves every head-piece id', () => {
    for (const s of STARTER_SCENES) {
      if (s.headPieceId) expect(HEAD_PIECE_MAP[s.headPieceId], `${s.id} piece`).toBeDefined();
    }
  });

  it('resolves every shader id, and never the "none" sentinel', () => {
    for (const s of STARTER_SCENES) {
      if (!s.shaderId) continue;
      expect(SHADER_MAP[s.shaderId], `${s.id} shader ${s.shaderId}`).toBeDefined();
      expect(s.shaderId).not.toBe('none');
    }
  });
});

describe('GENERIC ONLY — no legacy-event branding may reach the starter gallery', () => {
  it('uses no border flagged `legacy`', () => {
    for (const s of STARTER_SCENES) {
      for (const id of starterAssetIds(s).borders) {
        expect(BORDER_MAP[id].legacy, `${s.id} uses branded asset ${id}`).toBeUndefined();
      }
    }
  });

  it('never names a legacy event in a scene name or blurb', () => {
    for (const s of STARTER_SCENES) {
      const text = `${s.id} ${s.name} ${s.blurb}`.toLowerCase();
      for (const word of LEGACY_WORDS) {
        expect(text.includes(word), `${s.id} mentions "${word}"`).toBe(false);
      }
    }
  });

  it('never names a legacy event in any asset it pulls in', () => {
    for (const s of STARTER_SCENES) {
      const ids = starterAssetIds(s);
      const names = [
        ...ids.borders.map((id) => BORDER_MAP[id].name),
        // `pieces` now carries procedural head-piece IDS and, for scenes with a
        // bundled GLB, that prop's URL and label. Resolve what resolves and
        // check the rest as the literal strings they are — a branded file name
        // must fail this test just as loudly as a branded piece name.
        ...ids.pieces.map((id) => HEAD_PIECE_MAP[id]?.name ?? id),
      ].join(' ').toLowerCase();
      for (const word of LEGACY_WORDS) {
        expect(names.includes(word), `${s.id} pulls in an asset named for "${word}"`).toBe(false);
      }
    }
  });
});

describe('buildStarterDraft', () => {
  it('builds a loadable draft for every shipped scene', () => {
    for (const s of STARTER_SCENES) {
      const d = buildStarterDraft(s.id);
      expect(d, s.id).not.toBeNull();
      expect(d!.name).toBe(s.name);
      expect(d!.objects.length).toBeGreaterThan(0);
    }
  });

  it('never returns an id — a starter scene is new, unsaved work', () => {
    for (const s of STARTER_SCENES) expect(buildStarterDraft(s.id)!.id).toBeUndefined();
  });

  it('places at most one frame and stays inside the object cap', () => {
    for (const s of STARTER_SCENES) {
      const counts = sceneCounts(buildStarterDraft(s.id)!);
      expect(counts.frame).toBeLessThanOrEqual(1);
      expect(counts.capped).toBeLessThanOrEqual(MAX_OBJECTS);
    }
  });

  it('derives kind from the content it built, never guessing', () => {
    for (const s of STARTER_SCENES) {
      const d = buildStarterDraft(s.id)!;
      expect(d.kind).toBe(deriveKind(d));
    }
  });

  it('gives every layer a resolved data url and a real name', () => {
    for (const s of STARTER_SCENES) {
      for (const o of buildStarterDraft(s.id)!.objects) {
        expect(o.name.length).toBeGreaterThan(0);
        if (o.type === 'overlay') {
          expect(o.url?.startsWith('data:image/svg+xml')).toBe(true);
          expect(o.isBuiltin).toBe(true);
          expect(o.builtinId).toBeTruthy();
        } else if (o.type === 'headpiece') {
          expect(o.proceduralId).toBeTruthy();
        } else {
          // A bundled GLB prop: an app-absolute path under public/ (never a
          // third-party URL — that would put a venue's wifi on the booth's
          // critical path) and a finish, because these meshes ship with no
          // material of their own and would otherwise render as grey plastic.
          expect(o.assetUrl, `${s.id} prop url`).toMatch(/^\/models\/props\/[a-z0-9-]+\.glb$/);
          // The finish key is ABSENT when the catalogue asks for 'original',
          // and that is correct: createObject3D's finishKeys() omits the
          // default so an unstyled object round-trips byte-identically. Only
          // the textured shades want 'original' — the untextured meshes must
          // name a real finish or they render as grey plastic.
          const wanted = BUNDLED_PROP_MAP[s.propId!].finish;
          if (wanted === 'original') expect(o.finish, `${s.id} finish`).toBeUndefined();
          else expect(o.finish, `${s.id} finish`).toBe(wanted);
        }
      }
    }
  });

  it('selects the first layer so the properties dock opens on something', () => {
    for (const s of STARTER_SCENES) {
      const d = buildStarterDraft(s.id)!;
      expect(d.selectedId).toBe(d.objects[0].id);
    }
  });

  it('carries the scene filter through, or "none" when the preset has none', () => {
    const withFilter = buildStarterDraft('neon-night')!;
    expect(withFilter.shaderId).toBe('neon-pulse');
    expect(withFilter.shaderParams).toEqual({});
  });

  // Was asserted on deco-glam's crown sticker at { scale: 0.8, y: -30 }. That
  // sticker is gone: measured on a 540x960 render of its own art it covered
  // ZERO pixels, because -30 lifts the layer 30% of the card height and its
  // art only spans the top ~18%. The behaviour under test (a partial transform
  // merged over the default) is unchanged and still shipped by equalizer-live.
  it('applies a sticker composition transform', () => {
    const eq = buildStarterDraft('equalizer-live')!;
    const sticker = eq.objects.find((o) => o.type === 'overlay' && o.overlayKind === '2d_filter');
    expect(sticker && sticker.type === 'overlay' ? sticker.transform : null).toEqual({ scale: 0.9, x: 0, y: 0, rotation: 0 });
  });

  // Guard rail for the defect above. The art's own bounding box is only
  // knowable by rasterising (not available in the node test env), so this
  // bounds the COMPOSITION offset instead: a shipped starter layer may nudge,
  // but may not be flung far enough to leave the card on its own.
  it('never composes a layer far enough off-centre to leave the card', () => {
    for (const s of STARTER_SCENES) {
      for (const st of s.stickers ?? []) {
        const { x = 0, y = 0, scale = 1 } = st.transform ?? {};
        expect(Math.abs(x), `${s.id} sticker x`).toBeLessThanOrEqual(25);
        expect(Math.abs(y), `${s.id} sticker y`).toBeLessThanOrEqual(25);
        expect(scale, `${s.id} sticker scale`).toBeGreaterThan(0.1);
      }
    }
  });

  it('orders layers frame-first so stickers paint over the frame', () => {
    const d = buildStarterDraft('gold-classic')!;
    expect(d.objects[0].type).toBe('overlay');
    expect(d.objects[0].type === 'overlay' ? d.objects[0].overlayKind : null).toBe('border');
  });

  it('returns null for an unknown id instead of a blank scene', () => {
    expect(buildStarterDraft('does-not-exist')).toBeNull();
    expect(buildStarterDraft('')).toBeNull();
  });

  it('produces fresh object ids on each build (two loads never collide)', () => {
    const a = buildStarterDraft('gold-classic')!;
    const b = buildStarterDraft('gold-classic')!;
    const ids = new Set([...a.objects.map((o) => o.id), ...b.objects.map((o) => o.id)]);
    expect(ids.size).toBe(a.objects.length + b.objects.length);
  });

  it('starts every scene published and with no triggers', () => {
    for (const s of STARTER_SCENES) {
      const d = buildStarterDraft(s.id)!;
      expect(d.isPublished).toBe(true);
      expect(d.triggers).toEqual([]);
      expect(d.thumbBlob).toBeNull();
    }
  });
});
