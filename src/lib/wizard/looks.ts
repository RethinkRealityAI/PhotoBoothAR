/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The wizard's "Looks" step, as data — pure (no React, no supabase).
 *
 * Two things a host decides here, mapped onto stores that already exist:
 *
 *  1. PICK & CHOOSE — the frames, 3D props and effects a guest can try on one
 *     at a time in the booth's own picker:
 *       built-in frames   → events.config.arContent.borderIds   (allow-list)
 *       built-in effects  → events.config.arContent.shaderIds   (allow-list)
 *       shared library    → event_catalog_links                  (one row each)
 *       Beamwall classics → one `experiences` row per prop, tagged
 *                           config.wizardRef = 'classic:<bundled prop id>'
 *     An EMPTY allow-list means "everything" to the booth (catalog.pick), so
 *     "the host picked none" is written as the NO_LOOKS sentinel, which no id
 *     matches. The built-in procedural head pieces are switched off the same
 *     way (headPieceIds), because the classics supersede them — what the host
 *     picked is exactly what guests get.
 *
 *  2. FILTERS — one tap that puts on a whole look (frame + effect + props):
 *       ready-made (starter scenes) → an `experiences` row built by the studio's
 *                                     own buildStarterDraft, tagged
 *                                     'starter:<scene id>'
 *       library looks (composites)  → event_catalog_links
 *       the host's own              → an `experiences` row, tagged 'custom'
 *     Every row is built as a studio draft and serialized by draftToPayload,
 *     the same function the Studio saves through, so a wizard filter is a
 *     normal studio scene the Studio can open later.
 */
import type { Experience, ExperienceConfig, ExperienceDraft } from '../../types';
import { BORDER_MAP, GENERIC_FRAMES, frameDataUrl } from '../borders';
import { FILTER_SHADERS, defaultParams } from '../shaders';
import { lookSeason } from '../themeMatch';
import { BUNDLED_PROPS, BUNDLED_PROP_MAP, type BundledProp } from '../studio/bundledProps';
import { STARTER_SCENES, buildStarterDraft, bundledPropObject, type StarterScene } from '../studio/starterScenes';
import { createOverlay, deriveKind, initialDraft, type StudioDraft, type StudioObject } from '../studio/state';
import { draftToPayload, existingUrlResolver, experienceToDraft } from '../studio/draftMapping';
import type { TriggerConfig } from '../studio/triggers';
import type { FramePalette } from '../borders';

/** No id matches this, so an allow-list holding only it shows nothing. */
export const NO_LOOKS = '__none__';

export type LookCategory = 'frames' | 'props' | 'effects';

export const LOOK_CATEGORIES: readonly { id: LookCategory; label: string; noun: string }[] = [
  { id: 'frames', label: 'Frames', noun: 'frame' },
  { id: 'props', label: '3D props', noun: 'prop' },
  { id: 'effects', label: 'Effects', noun: 'effect' },
];

export type LookSource = 'frame' | 'effect' | 'library' | 'classic';

/** One thing a guest can try on, in one category. */
export interface WizardLook {
  /** Stable selection key: `frame:<id>` · `effect:<id>` · `lib:<uuid>` · `classic:<id>`. */
  key: string;
  category: LookCategory;
  source: LookSource;
  /** The id within its source (border id, shader id, experience uuid, bundled prop id). */
  ref: string;
  name: string;
  /** A picture for the tile (null = the tile draws its own swatch). */
  thumb: string | null;
  /** Shelf heading inside the category ("Hats & caps", "Christmas", …). */
  group: string;
  /** Opt-in seasonal look ('christmas'). */
  seasonal?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/* ── The catalogue ─────────────────────────────────────────────────── */

const SEASON_GROUP: Record<string, string> = { christmas: 'Christmas' };

/** Built-in frames (the generic, brand-free ones), drawn in the event colour. */
export function frameLooks(palette?: FramePalette | null): WizardLook[] {
  return GENERIC_FRAMES.flatMap((f) => {
    const b = BORDER_MAP[f.id];
    if (!b) return [];
    const season = lookSeason('frame', f.id);
    return [{
      key: `frame:${f.id}`,
      category: 'frames' as const,
      source: 'frame' as const,
      ref: f.id,
      name: f.name,
      thumb: frameDataUrl(b, palette ?? null),
      group: season ? SEASON_GROUP[season] ?? season : b.kind === 'border' ? 'Frames' : 'Overlays',
      ...(season ? { seasonal: season } : {}),
    }];
  });
}

/** Built-in camera effects. */
export function effectLooks(): WizardLook[] {
  return FILTER_SHADERS.map((s) => {
    const season = s.seasonal;
    return {
      key: `effect:${s.id}`,
      category: 'effects' as const,
      source: 'effect' as const,
      ref: s.id,
      name: s.name,
      thumb: null,
      group: season ? SEASON_GROUP[season] ?? season : 'Effects',
      ...(season ? { seasonal: season } : {}),
    };
  });
}

/** The Beamwall classics: the bundled GLB props (crown, tiara, Santa hat…). */
export function classicLooks(): WizardLook[] {
  return BUNDLED_PROPS.map((p) => ({
    key: `classic:${p.id}`,
    category: 'props' as const,
    source: 'classic' as const,
    ref: p.id,
    name: p.name,
    thumb: p.thumb,
    group: p.collection ? SEASON_GROUP[p.collection] ?? p.collection : 'Beamwall classics',
    ...(p.collection ? { seasonal: p.collection } : {}),
  }));
}

/** A library row as a pick-and-choose look; composites are filters, not looks. */
export function libraryLook(row: Experience, categoryName: string | null): WizardLook | null {
  const category: LookCategory | null =
    row.kind === '3d_attachment' ? 'props'
      : row.kind === 'border' || row.kind === '2d_filter' ? 'frames'
        : row.kind === 'shader' ? 'effects'
          : null;
  if (category === null) return null;
  const thumb = typeof row.thumbnail_url === 'string' && row.thumbnail_url !== ''
    ? row.thumbnail_url
    : category === 'frames' && typeof row.asset_url === 'string' ? row.asset_url : null;
  return {
    key: `lib:${row.id}`,
    category,
    source: 'library',
    ref: row.id,
    name: row.name,
    thumb,
    group: categoryName ?? (category === 'props' ? 'More props' : category === 'frames' ? 'More frames' : 'More effects'),
  };
}

/** True for a library row that is still a hidden draft (bulk import). */
export function isLibraryDraft(row: { config?: unknown }): boolean {
  const cfg = isRecord(row.config) ? row.config : {};
  const lib = isRecord(cfg.library) ? cfg.library : {};
  return lib.draft === true;
}

/**
 * Every look, by category, in shelf order: built-ins and classics first (they
 * load instantly), then the library grouped by its category. Library rows
 * still in draft are never offered.
 */
export function buildLookCatalog(
  libraryRows: readonly (Experience & { library_category_id?: string | null })[],
  categoryNames: ReadonlyMap<string, string>,
  palette?: FramePalette | null,
): Record<LookCategory, WizardLook[]> {
  const lib = libraryRows
    .filter((r) => r.is_published !== false && !isLibraryDraft(r))
    .flatMap((r) => {
      const name = r.library_category_id ? categoryNames.get(r.library_category_id) ?? null : null;
      const look = libraryLook(r, name);
      return look ? [look] : [];
    });
  const byGroup = (a: WizardLook, b: WizardLook) => a.group.localeCompare(b.group);
  return {
    frames: [...frameLooks(palette), ...lib.filter((l) => l.category === 'frames').sort(byGroup)],
    props: [...classicLooks(), ...lib.filter((l) => l.category === 'props').sort(byGroup)],
    effects: [...effectLooks(), ...lib.filter((l) => l.category === 'effects').sort(byGroup)],
  };
}

/** Shelf headings in first-seen order, with their looks. */
export function groupLooks(looks: readonly WizardLook[]): { group: string; looks: WizardLook[] }[] {
  const out: { group: string; looks: WizardLook[] }[] = [];
  for (const l of looks) {
    const g = out.find((x) => x.group === l.group);
    if (g) g.looks.push(l);
    else out.push({ group: l.group, looks: [l] });
  }
  return out;
}

/* ── What the event offers today ───────────────────────────────────── */

export interface LookPicks {
  frames: string[];
  effects: string[];
  /** Linked library experience ids (props / frames / effects, not composites). */
  library: string[];
  /** Bundled prop ids that have a wizard row on this event. */
  classics: string[];
}

/** The wizard tag on an experience row, or null. */
export function wizardRefOf(row: { config?: unknown }): string | null {
  const cfg = isRecord(row.config) ? row.config : {};
  return typeof cfg.wizardRef === 'string' ? cfg.wizardRef : null;
}

function idList(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
}

/**
 * Read the event's current picks. An allow-list the host never set (absent or
 * empty) shows everything that is not seasonal, so that is what is reported —
 * the wizard must describe the booth guests actually get.
 */
export function picksFromEvent(
  config: Record<string, unknown> | null | undefined,
  linkedIds: readonly string[],
  eventRows: readonly { id: string; config?: unknown }[],
  libraryKinds: ReadonlyMap<string, string>,
): LookPicks {
  const ar = isRecord(config?.arContent) ? (config!.arContent as Record<string, unknown>) : {};
  const borderIds = idList(ar.borderIds) ?? [];
  const shaderIds = idList(ar.shaderIds) ?? [];
  const genericFrameIds = GENERIC_FRAMES.map((f) => f.id);
  const frames = borderIds.length === 0
    ? genericFrameIds.filter((id) => lookSeason('frame', id) === null)
    : borderIds.filter((id) => id !== NO_LOOKS && genericFrameIds.includes(id));
  const allEffects = FILTER_SHADERS.map((s) => s.id);
  const effects = shaderIds.length === 0
    ? FILTER_SHADERS.filter((s) => s.seasonal === undefined).map((s) => s.id)
    : shaderIds.filter((id) => id !== NO_LOOKS && allEffects.includes(id));
  const classics = eventRows.flatMap((r) => {
    const ref = wizardRefOf(r);
    return ref !== null && ref.startsWith('classic:') && BUNDLED_PROP_MAP[ref.slice(8)] ? [ref.slice(8)] : [];
  });
  const library = linkedIds.filter((id) => {
    const kind = libraryKinds.get(id);
    return kind !== undefined && kind !== 'composite';
  });
  return { frames, effects, library: [...new Set(library)], classics: [...new Set(classics)] };
}

/** Is a look on? */
export function isPicked(picks: LookPicks, look: WizardLook): boolean {
  switch (look.source) {
    case 'frame': return picks.frames.includes(look.ref);
    case 'effect': return picks.effects.includes(look.ref);
    case 'library': return picks.library.includes(look.ref);
    case 'classic': return picks.classics.includes(look.ref);
  }
}

/** Toggle one look; returns new picks (never mutates). */
export function togglePick(picks: LookPicks, look: WizardLook): LookPicks {
  const flip = (list: string[]) => (list.includes(look.ref) ? list.filter((x) => x !== look.ref) : [...list, look.ref]);
  switch (look.source) {
    case 'frame': return { ...picks, frames: flip(picks.frames) };
    case 'effect': return { ...picks, effects: flip(picks.effects) };
    case 'library': return { ...picks, library: flip(picks.library) };
    case 'classic': return { ...picks, classics: flip(picks.classics) };
  }
}

/** Set a whole category on/off at once ("Add all" / "Clear"). */
export function setCategory(picks: LookPicks, looks: readonly WizardLook[], on: boolean): LookPicks {
  let next = picks;
  for (const l of looks) if (isPicked(next, l) !== on) next = togglePick(next, l);
  return next;
}

/** How many looks are on in a category. */
export function countPicked(picks: LookPicks, looks: readonly WizardLook[]): number {
  return looks.filter((l) => isPicked(picks, l)).length;
}

/**
 * The events.config patch for the built-in allow-lists. arContent is rebuilt
 * from the current one (updateEventConfig merges shallowly). Empty → the
 * sentinel, never `[]` (which the booth reads as "everything"). The built-in
 * procedural head pieces are switched off: the classics replace them.
 */
export function picksConfigPatch(
  currentConfig: Record<string, unknown> | null | undefined,
  picks: LookPicks,
): Record<string, unknown> {
  const cur = isRecord(currentConfig?.arContent) ? (currentConfig!.arContent as Record<string, unknown>) : {};
  return {
    arContent: {
      ...cur,
      borderIds: picks.frames.length > 0 ? [...picks.frames] : [NO_LOOKS],
      shaderIds: picks.effects.length > 0 ? [...picks.effects] : [NO_LOOKS],
      headPieceIds: [NO_LOOKS],
    },
  };
}

/** What has to happen in the database to go from `before` to `after`. */
export interface PicksDiff {
  link: string[];
  unlink: string[];
  addClassics: string[];
  removeClassics: string[];
  configChanged: boolean;
}

export function diffPicks(before: LookPicks, after: LookPicks): PicksDiff {
  const minus = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return {
    link: minus(after.library, before.library),
    unlink: minus(before.library, after.library),
    addClassics: minus(after.classics, before.classics),
    removeClassics: minus(before.classics, after.classics),
    configChanged: !same(before.frames, after.frames) || !same(before.effects, after.effects),
  };
}

/* ── Experience rows the wizard writes ─────────────────────────────── */

/** Serialize a draft the way the Studio does, plus the wizard tag. */
export function draftRow(draft: StudioDraft, wizardRef: string, thumb: string | null): ExperienceDraft | null {
  const resolver = existingUrlResolver(draft);
  if (resolver === null) return null;
  const payload = draftToPayload(draft, resolver, thumb);
  const config = { ...((payload.config ?? {}) as ExperienceConfig), wizardRef } as ExperienceConfig;
  return { ...payload, config, is_published: true, featured: true };
}

/** A Beamwall classic as a lone 3D prop row. */
export function classicRow(prop: BundledProp): ExperienceDraft | null {
  const draft: StudioDraft = { ...initialDraft('3d_attachment'), name: prop.name, objects: [bundledPropObject(prop, prop.occlude === true)] };
  draft.kind = deriveKind(draft);
  return draftRow(draft, `classic:${prop.id}`, prop.thumb);
}

/* ── Filters (one-tap bundles) ─────────────────────────────────────── */

/** The ready-made filters a host can switch on (power-up gear lives on the next step). */
export const POWER_SCENE_IDS: readonly string[] = ['hero-visor', 'wizard-duel', 'power-surge'];

export function readyFilters(): StarterScene[] {
  return STARTER_SCENES.filter((s) => !POWER_SCENE_IDS.includes(s.id));
}

export function powerScenes(): StarterScene[] {
  return STARTER_SCENES.filter((s) => POWER_SCENE_IDS.includes(s.id));
}

/** A starter scene as a filter row (optionally carrying extra triggers). */
export function starterRow(sceneId: string, extraTriggers: readonly TriggerConfig[] = []): ExperienceDraft | null {
  const draft = buildStarterDraft(sceneId);
  const scene = STARTER_SCENES.find((s) => s.id === sceneId);
  if (!draft || !scene) return null;
  if (extraTriggers.length > 0) draft.triggers = [...draft.triggers, ...extraTriggers];
  return draftRow(draft, `starter:${sceneId}`, scene.preview);
}

/** The host's own filter: what goes in it. */
export interface CustomFilterSpec {
  name: string;
  /** Built-in frame id, or null for no frame. */
  frameId: string | null;
  /** Effect (shader) id, or null for none. */
  effectId: string | null;
  /** Bundled prop ids (classics). */
  classics: string[];
  /** Library prop/frame experience rows. */
  library: Experience[];
}

export const CUSTOM_FILTER_MAX_PROPS = 4;

/** Why a custom filter cannot be saved yet, or null when it can. */
export function customFilterError(spec: CustomFilterSpec): string | null {
  if (spec.name.trim() === '') return 'Give your filter a name.';
  if (spec.name.trim().length > 40) return 'Keep the name under 40 letters.';
  const parts = (spec.frameId ? 1 : 0) + (spec.effectId ? 1 : 0) + spec.classics.length + spec.library.length;
  if (parts < 2) return 'A filter combines at least two things. Pick a frame, an effect or a prop.';
  if (spec.classics.length + spec.library.length > CUSTOM_FILTER_MAX_PROPS) return `Up to ${CUSTOM_FILTER_MAX_PROPS} props per filter.`;
  return null;
}

/**
 * A studio draft for any combination of looks — used for the live preview AND
 * for saving a custom filter, so the preview is the filter.
 */
export function composeDraft(spec: Omit<CustomFilterSpec, 'name'> & { name?: string }, palette?: FramePalette | null): StudioDraft {
  const objects: StudioObject[] = [];
  if (spec.frameId) {
    const b = BORDER_MAP[spec.frameId];
    if (b) {
      objects.push(createOverlay(b.kind, {
        url: frameDataUrl(b, palette ?? null),
        isBuiltin: true,
        builtinId: b.id,
        name: b.name,
      }));
    }
  }
  // Library frames first (2D under 3D), then the props.
  for (const row of spec.library) {
    const d = experienceToDraft(row);
    if (d) objects.push(...d.objects);
  }
  const props = spec.classics.flatMap((id) => (BUNDLED_PROP_MAP[id] ? [BUNDLED_PROP_MAP[id]] : []));
  const occlude = props.some((p) => p.occlude === true);
  for (const p of props) objects.push(bundledPropObject(p, occlude));
  const shaderId = spec.effectId ?? 'none';
  const draft: StudioDraft = {
    ...initialDraft('shader'),
    name: spec.name?.trim() || 'My filter',
    objects,
    selectedId: objects[0]?.id ?? null,
    shaderId,
    shaderParams: shaderId === 'none' ? {} : defaultParams(shaderId),
  };
  draft.kind = deriveKind(draft);
  return draft;
}

/** The custom filter as a row; its thumbnail is the frame or the first prop. */
export function customFilterRow(spec: CustomFilterSpec, palette?: FramePalette | null): ExperienceDraft | null {
  if (customFilterError(spec) !== null) return null;
  const draft = composeDraft(spec, palette);
  const firstClassic = spec.classics[0] ? BUNDLED_PROP_MAP[spec.classics[0]]?.thumb ?? null : null;
  const firstLib = spec.library.find((r) => typeof r.thumbnail_url === 'string' && r.thumbnail_url !== '')?.thumbnail_url ?? null;
  const frame = spec.frameId && BORDER_MAP[spec.frameId] ? frameDataUrl(BORDER_MAP[spec.frameId], palette ?? null) : null;
  return draftRow(draft, 'custom', firstClassic ?? firstLib ?? frame);
}

/** One filter the event offers, for the list on the Looks step. */
export interface EventFilter {
  /** Experience id (event row, or linked library composite). */
  id: string;
  name: string;
  thumb: string | null;
  kind: 'ready' | 'library' | 'custom' | 'power';
  /** Starter scene id for ready/power filters. */
  starterId?: string;
}

/** The filters on an event: its wizard-tagged rows plus linked library composites. */
export function eventFilters(
  eventRows: readonly Experience[],
  linkedComposites: readonly Experience[],
): EventFilter[] {
  const out: EventFilter[] = [];
  for (const r of eventRows) {
    const ref = wizardRefOf(r);
    if (ref === null) continue;
    if (ref.startsWith('starter:')) {
      const id = ref.slice(8);
      out.push({ id: r.id, name: r.name, thumb: r.thumbnail_url, kind: POWER_SCENE_IDS.includes(id) ? 'power' : 'ready', starterId: id });
    } else if (ref === 'custom') {
      out.push({ id: r.id, name: r.name, thumb: r.thumbnail_url, kind: 'custom' });
    }
  }
  for (const r of linkedComposites) out.push({ id: r.id, name: r.name, thumb: r.thumbnail_url, kind: 'library' });
  return out;
}
