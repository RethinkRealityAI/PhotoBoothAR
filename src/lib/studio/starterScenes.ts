/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shipped starter scenes — a first-run gallery of complete, good-looking scenes
 * a host can load in one click.
 *
 * Before this, a brand-new draft opened onto an empty canvas whose only guidance
 * was "Add a frame or sticker", and the only "templates" in the dock were ones
 * the host had already made themselves. So the fastest route to something that
 * looked designed was the AI Director — i.e. spending credits before seeing a
 * single result.
 *
 * These presets still cost ZERO CREDITS, and every asset ships WITH THE APP:
 * BUILTIN_BORDERS SVGs and the shader catalogue are inlined, and the three
 * Meshy-modelled props are same-origin files under public/models/props.
 * "Zero network" is no longer literally true for those three — a GLB is a real
 * fetch — so `starterPropUrls()` exists to warm them through the shared GLB
 * cache before the piece is needed. Same-origin is the load-bearing part: a
 * third-party CDN on the booth's critical path is exactly what cost the AR
 * layer on bad venue wifi once already (see face_landmarker in CLAUDE.md).
 *
 * GENERIC BY MANDATE (owner, verbatim): "make sure we remove all the hard-coded
 * templates, like the SCAGO gala or any that have specific branding for any of
 * the legacy events. We're just on generic frames and assets that will be part
 * of the template library that all users will have access to." Every id below is
 * checked against BuiltinBorder.legacy in the colocated test, so a branded asset
 * can never sneak into a starter scene.
 *
 * Pure data + a pure builder: no React, no DOM, no network, so vitest exercises
 * the whole thing.
 */
import { BORDER_MAP, toDataUrl } from '../borders';
import { HEAD_PIECE_MAP } from '../headPieces';
import { ANCHOR_VERSION_LATEST, migrateOffsetToV2 } from '../faceRig';
import { BUNDLED_PROP_MAP, isRetiredProp, propAnchorConfig, type BundledProp } from './bundledProps';
import { findLibraryAsset, assetTemplateOf } from './assetLibrary';
import {
  createObject3D,
  createOverlay,
  deriveKind,
  initialDraft,
  type Object3D,
  type StudioDraft,
  type StudioObject,
} from './state';
import type { TriggerConfig } from './triggers';
import { FACE_PAINT_PROCEDURAL_ID, normalizeFacePaint, type FacePaintSpec } from '../facePaint/spec';
import type { HeadAnchor, Transform2D } from '../../types';

/** A sticker placed within a starter scene, with its composed position. */
export interface StarterSticker {
  /** BUILTIN_BORDERS id with kind '2d_filter'. */
  borderId: string;
  /** Partial transform merged over the default — composition, not decoration. */
  transform?: Partial<Transform2D>;
}

export interface StarterScene {
  id: string;
  name: string;
  /**
   * Retired from every host pick list (owner, 2026-11-23: low-fidelity looks
   * leave public surfaces). Kept here so an event already built from it
   * still resolves and renders. Hide, never delete.
   */
  retired?: true;
  /** One line the host reads before clicking — what this scene feels like. */
  blurb: string;
  /**
   * Bundled sample of what this scene actually produces: a photographic booth
   * shot graded like the scene's filter and wearing its 3D piece, with the
   * scene's OWN frame and sticker layers composited over it at the exact
   * transforms `buildStarterDraft` produces. Two gradient swatches could say
   * "gold" or "neon" but never which frame, which filter or which prop was
   * coming — so the card showed a colour where the host needed a picture.
   *
   * App-absolute so it resolves identically on the platform build and the
   * legacy single-event builds. The colocated test asserts the file exists in
   * public/, so a scene can never ship pointing at a 404.
   */
  preview: string;
  /** Two swatch colours, still used as the card's fallback tint while the
   *  preview decodes and if it ever fails to load. */
  swatch: [string, string];
  /** BUILTIN_BORDERS id with kind 'border'. Optional — a scene may be frameless. */
  frameId?: string;
  stickers?: StarterSticker[];
  /** Shader catalogue id, or omitted for no scene filter. */
  shaderId?: string;
  /** HEAD_PIECES id — a procedural piece, used only when `propId` is absent. */
  headPieceId?: string;
  /**
   * BUNDLED_PROPS id (bundledProps.ts), used INSTEAD of `headPieceId`.
   *
   * Referenced by id rather than inlined so the studio library and the starter
   * scenes serve the SAME prop. Inlining it here first time round is what let
   * the library keep handing out the old procedural crown while the cards
   * promised the new one.
   */
  propId?: string;
  /**
   * More BUNDLED_PROPS ids, for looks that need several pieces at once (the
   * Santa hat AND beard; elf hat AND ears; antlers AND a red nose). Added
   * after `propId` in order. Any prop flagged `occlude` turns the head
   * occluder on for the scene (occlusion is scene-level: one occluder serves
   * the whole canvas).
   */
  props?: string[];
  /**
   * LIBRARY_ASSETS id (assetLibrary.ts) with an AUTHORED scale, used instead
   * of propId/headPieceId. The scale is fitCm / the GLB's measured largest
   * dimension — authored here because buildStarterDraft is pure/sync and the
   * dock's async measureGlbFitScale cannot run inside it. The entry's own
   * anchor/handAnchor/nudge/template all ride along, so the piece lands
   * exactly as if added from the Personalise shelf.
   */
  library?: { id: string; scale: number };
  /**
   * Magic Triggers this scene ships with (ids generated at build time). The
   * flagship Power-Ups scenes pair a FACE cue and a HAND cue on purpose —
   * combinability demonstrated in the shipped default, not just documented.
   */
  triggers?: Omit<TriggerConfig, 'id'>[];
  /**
   * Living Face Paint look (lib/facePaint/spec.ts), painted on the tracked
   * face mesh. Colours are AUTHORED here rather than read from the event
   * theme: buildStarterDraft is pure, and a starter must look the same on the
   * card as on the booth.
   */
  facePaint?: FacePaintSpec;
}

/**
 * The shipped gallery. Ordered most-broadly-appealing first — the first card is
 * the one a host in a hurry clicks.
 */
export const STARTER_SCENES: StarterScene[] = [
  {
    id: 'gold-classic',
    name: 'Gold Classic',
    blurb: 'A warm gold border with corner flourishes and a soft golden glow.',
    preview: '/starters/gold-classic.webp',
    swatch: ['#E8C766', '#7A5A18'],
    frameId: 'frame-classic-gold',
    stickers: [{ borderId: 'dw-corners' }],
    shaderId: 'golden-hour-bloom',
  },
  {
    id: 'neon-night',
    name: 'Neon Night',
    blurb: 'Neon tube frame, pulsing colour and a pair of glowing shades.',
    preview: '/starters/neon-night.webp',
    swatch: ['#FF3DDA', '#22E7FF'],
    frameId: 'jj-neon-frame',
    shaderId: 'neon-pulse',
    propId: 'prop-neon-shades',
  },
  {
    id: 'confetti-party',
    name: 'Confetti Party',
    blurb: 'Clean inset frame, falling gold confetti and a crown on every guest.',
    preview: '/starters/confetti-party.webp',
    swatch: ['#FFD966', '#2A2033'],
    frameId: 'frame-minimal-plain',
    stickers: [{ borderId: 'overlay-confetti' }],
    shaderId: 'champagne-sparkle',
    propId: 'prop-royal-crown',
  },
  {
    id: 'deco-glam',
    name: 'Deco Glam',
    blurb: 'Art-deco lines, a holographic shimmer and a tiara.',
    preview: '/starters/deco-glam.webp',
    swatch: ['#C9A227', '#1B2A4A'],
    frameId: 'frame-deco-plain',
    // The Golden Crown sticker that used to sit here drew ZERO pixels: its
    // art occupies y 40-177 of a 960-tall card, and `y: -30` lifts it 30% of
    // the card height (288px) — entirely off the top edge. Measured, not
    // guessed. It was an invisible layer that still took a slot in the
    // 20-object scene cap and a row in Scene layers, and the blurb never
    // promised a crown anyway (the tiara below is the scene's head piece).
    shaderId: 'prismatic-holo',
    propId: 'prop-queens-tiara',
  },
  {
    id: 'soft-portrait',
    name: 'Soft Portrait',
    blurb: 'A quiet hexagon frame with cinematic film grain — flattering on everyone.',
    preview: '/starters/soft-portrait.webp',
    swatch: ['#D8C7A8', '#3A3630'],
    frameId: 'frame-hexagon-plain',
    shaderId: 'velvet-film',
  },
  {
    id: 'halo-light',
    name: 'Halo Light',
    blurb: 'Golden light shafts, a simple gold border and a glowing halo.',
    preview: '/starters/halo-light.webp',
    swatch: ['#FFE9A8', '#4A3A12'],
    frameId: 'dw-frame-classic',
    shaderId: 'aureate-god-rays',
    propId: 'prop-halo-ring',
  },
  {
    id: 'equalizer-live',
    name: 'Equalizer',
    blurb: 'A music-bar frame with a laser sparkle — made for a dance floor.',
    preview: '/starters/equalizer-live.webp',
    swatch: ['#5BFF9A', '#12203A'],
    frameId: 'jj-equalizer',
    stickers: [{ borderId: 'overlay-confetti', transform: { scale: 0.9 } }],
    shaderId: 'laser-sparkle',
  },
  /* — Power-Ups scenes: gear + gesture ceremonies, zero credits. Authored
     scales = fitCm / the GLB's measured largest local dimension (see the
     `library` field note). */
  {
    id: 'hero-visor',
    name: 'Hero Visor',
    blurb: 'A one-lens visor — touch your temple to fire an optic blast; smile for sparkles.',
    preview: '/starters/hero-visor.webp',
    swatch: ['#23262e', '#ff2b4a'],
    shaderId: 'neon-pulse',
    library: { id: 'cyclops-visor', scale: 7.9 },
    triggers: [
      { source: 'handToTemple', action: { type: 'beam', style: 'optic', color: 'auto' } },
      { source: 'smile', action: { type: 'burst', style: 'sparkles' } },
    ],
  },
  {
    id: 'wizard-duel',
    name: 'Wizard Duel',
    retired: true,
    blurb: 'A carved wand in your hand — pinch to stream sparkles from the gem.',
    preview: '/starters/wizard-duel.webp',
    swatch: ['#4a2c17', '#b388ff'],
    shaderId: 'holo-bloom',
    library: { id: 'wizard-wand', scale: 12.7 },
    triggers: [
      { source: 'pinch', action: { type: 'beam', style: 'sparkle', color: 'auto' } },
      { source: 'browRaise', action: { type: 'burst', style: 'sparkles' } },
    ],
  },
  {
    id: 'power-surge',
    name: 'Power Surge',
    blurb: 'An armored gauntlet — open your palm to blast; clench a fist for fireworks.',
    preview: '/starters/power-surge.webp',
    swatch: ['#2b2e35', '#18ffff'],
    shaderId: 'neon-pulse',
    library: { id: 'power-gauntlet', scale: 15.8 },
    triggers: [
      { source: 'palmOpen', action: { type: 'beam', style: 'energy', color: 'auto' } },
      { source: 'fistClench', action: { type: 'burst', style: 'fireworks' } },
    ],
  },
  /* — Living Face Paint scenes: paint on the tracked face mesh, zero credits. */
  {
    id: 'game-day',
    name: 'Game Day',
    blurb: 'Team stripes painted under the eyes — they stretch with every cheer.',
    preview: '/starters/game-day.webp',
    swatch: ['#1d4ed8', '#ffffff'],
    facePaint: { design: 'game-day', colors: ['#1d4ed8', '#ffffff'], opacity: 0.9 },
  },
  {
    id: 'fiesta',
    name: 'Fiesta',
    blurb: 'A painted sugar-skull calavera with marigold petals and confetti.',
    preview: '/starters/fiesta.webp',
    swatch: ['#f4f0e8', '#f28c28'],
    stickers: [{ borderId: 'overlay-confetti' }],
    facePaint: { design: 'sugar-skull', colors: ['#f4f0e8', '#f28c28', '#161616'], opacity: 0.9 },
  },
  /* — CHRISTMAS (2026-11-17): the holiday collection's ready-made looks. Every
     head-wrapping prop turns on the head occluder, so the back of a hat or
     the far antler disappears behind the guest's own head. */
  {
    id: 'santa-claus',
    name: 'Santa Claus',
    blurb: 'A plush velvet Santa hat and a full snowy beard — instant Father Christmas.',
    preview: '/starters/santa-claus.webp',
    swatch: ['#c8102e', '#f6f1e7'],
    frameId: 'xmas-holly',
    stickers: [{ borderId: 'xmas-snowfall' }],
    props: ['prop-santa-hat', 'prop-santa-beard'],
    shaderId: 'golden-hour-bloom',
  },
  {
    id: 'santas-elf',
    name: "Santa's Elf",
    blurb: 'A candy-stripe elf hat with a jingle bell and pointed elf ears.',
    preview: '/starters/santas-elf.webp',
    swatch: ['#1f8a3b', '#c8102e'],
    frameId: 'xmas-candy-cane',
    props: ['prop-elf-hat', 'prop-elf-ears'],
    facePaint: { design: 'candy-cane', colors: ['#d4141f', '#fbf8f3'], opacity: 0.9 },
  },
  {
    id: 'rudolph',
    name: 'Rudolph',
    blurb: 'Velvet reindeer antlers with holly, and a glowing red nose.',
    preview: '/starters/rudolph.webp',
    swatch: ['#7a4a2a', '#e01b24'],
    frameId: 'xmas-lights',
    props: ['prop-reindeer-antlers', 'prop-rudolph-nose'],
    facePaint: { design: 'rudolph', colors: ['#d0101c', '#e5566b', '#7b4a2f'], opacity: 0.85 },
  },
  {
    id: 'snow-queen',
    name: 'Snow Queen',
    blurb: 'A crystal snowflake tiara, icy frost paint and falling snow.',
    preview: '/starters/snow-queen.webp',
    swatch: ['#dfeefc', '#7fb4e6'],
    stickers: [{ borderId: 'xmas-snowfall' }],
    props: ['prop-snowflake-tiara'],
    shaderId: 'snowfall-glow',
    facePaint: { design: 'frost-queen', colors: ['#5fb8f0', '#ffffff', '#bfe8ff'], opacity: 0.9 },
  },
  {
    id: 'deck-the-halls',
    name: 'Deck the Halls',
    blurb: 'A holly-and-berry crown with little gold bells.',
    preview: '/starters/deck-the-halls.webp',
    swatch: ['#1d5c34', '#d4af37'],
    stickers: [{ borderId: 'xmas-pine-garland' }],
    props: ['prop-holly-crown'],
    shaderId: 'champagne-sparkle',
  },
  {
    id: 'oh-christmas-tree',
    name: 'Oh Christmas Tree',
    blurb: 'Wear the tree: baubles, a garland and a gold star on top.',
    preview: '/starters/oh-christmas-tree.webp',
    swatch: ['#2f6b3a', '#f2c94c'],
    frameId: 'xmas-lights',
    stickers: [{ borderId: 'xmas-banner-merry' }],
    props: ['prop-tree-hat'],
  },
  {
    id: 'gingerbread',
    name: 'Gingerbread',
    blurb: 'A full gingerbread face with piped icing, candy-cane frame and a holiday banner.',
    preview: '/starters/gingerbread.webp',
    swatch: ['#b4692e', '#fffaf2'],
    frameId: 'xmas-candy-cane',
    stickers: [{ borderId: 'xmas-banner-holidays' }],
    facePaint: { design: 'gingerbread', colors: ['#b4692e', '#fffaf2', '#d4141f'], opacity: 0.92 },
  },
];

export const STARTER_SCENE_MAP: Record<string, StarterScene> = Object.fromEntries(
  STARTER_SCENES.map((s) => [s.id, s]),
);

/** Every asset id a starter scene references, for the "is it shippable" check. */
export function starterAssetIds(scene: StarterScene): { borders: string[]; pieces: string[]; shaders: string[] } {
  return {
    borders: [...(scene.frameId ? [scene.frameId] : []), ...(scene.stickers ?? []).map((s) => s.borderId)],
    // Bundled props are named here too, so the colocated "never names a legacy
    // event" check inspects their file names and labels as well — otherwise a
    // branded prop could enter the library through a door the test does not
    // watch.
    pieces: [
      ...(scene.headPieceId ? [scene.headPieceId] : []),
      ...scenePropIds(scene).flatMap((id) =>
        BUNDLED_PROP_MAP[id] ? [BUNDLED_PROP_MAP[id].url, BUNDLED_PROP_MAP[id].name] : []),
    ],
    shaders: scene.shaderId ? [scene.shaderId] : [],
  };
}

/** Every bundled prop id a scene places, `propId` first then `props`. */
export function scenePropIds(scene: StarterScene): string[] {
  return [...(scene.propId ? [scene.propId] : []), ...(scene.props ?? [])];
}

/**
 * The scenes a host is OFFERED: a retired scene, or one wearing a retired prop
 * (bundledProps `retired`), leaves the gallery, since its preview photo shows
 * that prop. It stays in STARTER_SCENES so a scene already built from it still
 * resolves.
 */
export function offeredStarterScenes(): StarterScene[] {
  return STARTER_SCENES.filter((s) => s.retired !== true && !scenePropIds(s).some(isRetiredProp));
}

/** Every bundled prop GLB a starter scene can pull in — the preload list. */
export function starterPropUrls(): string[] {
  return Array.from(new Set(
    STARTER_SCENES.flatMap((s) =>
      scenePropIds(s).flatMap((id) => (BUNDLED_PROP_MAP[id] ? [BUNDLED_PROP_MAP[id].url] : []))),
  ));
}

/** The prop URL a scene loads, or null when it uses a procedural piece. */
export function starterPropUrl(scene: StarterScene): string | null {
  const first = scenePropIds(scene)[0];
  const p = first ? BUNDLED_PROP_MAP[first] : undefined;
  return p ? p.url : null;
}

/**
 * Build a complete, loadable draft from a preset.
 *
 * Every referenced asset is resolved through the SAME catalog maps the dock
 * uses, so a preset can never conjure an id the library does not have; a missing
 * id is skipped rather than producing a broken layer, and a preset that resolves
 * to nothing at all returns null (the caller keeps the empty editor instead of
 * loading a scene that would render as blank).
 *
 * The returned draft has NO `id` — loading a starter scene creates new,
 * unsaved work, exactly like duplicating.
 */
/** A Living Face Paint layer as a studio object (also used by the setup wizard). */
export function facePaintObject(facePaint: FacePaintSpec): Object3D {
  return createObject3D('headpiece', {
    proceduralId: FACE_PAINT_PROCEDURAL_ID,
    name: 'Face Paint',
    // Ignored by the paint layer (the mesh IS the face); a valid anchor keeps
    // every legacy reader of the layer happy.
    anchor: 'noseTip',
    facePaint,
  });
}

/**
 * One bundled prop as a studio object, placed exactly as a shelf add places it.
 * Shared by the starter scenes and the host setup wizard (which saves a lone
 * prop or a custom filter from the same objects), so the two can never place
 * the same hat differently.
 */
export function bundledPropObject(bundled: BundledProp, occlude: boolean): StudioObject {
  return createObject3D('model', {
    assetUrl: bundled.url,
    name: bundled.name,
    anchor: bundled.anchor,
    finish: bundled.finish,
    // Ride the v2 anchors exactly as a shelf add does (AssetsDock): the
    // placement was tuned against v1, so it is converted to render at the
    // same point. A v1 hat carrying the occluder hid the v2-less second
    // piece in the live studio (elf ears vanished under the elf hat), so a
    // starter and a shelf add must not differ here.
    anchorConfig: (() => {
      const cfg = propAnchorConfig(bundled);
      return { ...cfg, offset: migrateOffsetToV2(bundled.anchor, cfg.offset, 1) };
    })(),
    anchorVersion: ANCHOR_VERSION_LATEST,
    ...(occlude ? { occlusion: true } : {}),
  });
}

export function buildStarterDraft(sceneId: string): StudioDraft | null {
  const preset = STARTER_SCENE_MAP[sceneId];
  if (!preset) return null;

  const objects: StudioObject[] = [];

  if (preset.frameId) {
    const b = BORDER_MAP[preset.frameId];
    if (b && b.kind === 'border') {
      objects.push(createOverlay('border', {
        url: toDataUrl(b.svg),
        isBuiltin: true,
        builtinId: b.id,
        name: b.name,
      }));
    }
  }

  for (const sticker of preset.stickers ?? []) {
    const b = BORDER_MAP[sticker.borderId];
    if (!b || b.kind !== '2d_filter') continue;
    objects.push(createOverlay('2d_filter', {
      url: toDataUrl(b.svg),
      isBuiltin: true,
      builtinId: b.id,
      name: b.name,
      transform: { scale: 1, x: 0, y: 0, rotation: 0, ...sticker.transform },
    }));
  }

  const libraryAsset = preset.library ? findLibraryAsset(preset.library.id) : null;
  const libraryTemplate = libraryAsset ? assetTemplateOf(libraryAsset) : null;
  if (libraryAsset && libraryTemplate && preset.library) {
    objects.push(createObject3D('model', {
      assetUrl: libraryTemplate.glbUrl,
      name: libraryAsset.name,
      // The entry's natural mount, exactly as the Personalise shelf adds it.
      anchor: typeof libraryAsset.anchor === 'string' ? (libraryAsset.anchor as HeadAnchor) : undefined,
      handAnchor: libraryAsset.handAnchor,
      template: libraryAsset.template,
      anchorConfig: {
        offset: { ...(libraryAsset.defaultNudgeCm ?? { x: 0, y: 0, z: 0 }) },
        rotation: { x: 0, y: 0, z: 0 },
        scale: preset.library.scale,
      },
    }));
  }

  const bundledProps = scenePropIds(preset).flatMap((id) => (BUNDLED_PROP_MAP[id] ? [BUNDLED_PROP_MAP[id]] : []));
  // Scene-level occlusion (see state.ts sceneOcclusion): when ANY placed prop
  // wraps the head, every 3D piece carries the flag so the one occluder mounts.
  const occludeScene = bundledProps.some((b) => b.occlude === true);
  for (const bundled of bundledProps) {
    objects.push(bundledPropObject(bundled, occludeScene));
  }
  if (bundledProps.length === 0 && preset.headPieceId) {
    const p = HEAD_PIECE_MAP[preset.headPieceId];
    if (p) {
      objects.push(createObject3D('headpiece', {
        proceduralId: p.id,
        name: p.name,
        anchor: p.config.anchor,
        anchorConfig: {
          offset: { ...p.config.offset },
          rotation: { ...p.config.rotation },
          scale: p.config.scale,
        },
      }));
    }
  }

  const facePaint = preset.facePaint ? normalizeFacePaint(preset.facePaint) : null;
  if (facePaint) objects.push(facePaintObject(facePaint));

  const shaderId = preset.shaderId ?? 'none';
  if (objects.length === 0 && shaderId === 'none') return null;

  const base = initialDraft('shader');
  const draft: StudioDraft = {
    ...base,
    name: preset.name,
    objects,
    // Select the frame (or the first layer) so the properties dock opens on
    // something the host can immediately adjust.
    selectedId: objects[0]?.id ?? null,
    shaderId,
    shaderParams: {},
    kind: 'shader',
  };
  draft.kind = deriveKind(draft);
  // Shipped triggers, ids generated here (the same shape ADD_TRIGGER stores).
  if (preset.triggers && preset.triggers.length > 0) {
    draft.triggers = preset.triggers.map((t, i) => ({ ...t, id: `trg-${preset.id}-${i}` }));
  }
  return draft;
}
