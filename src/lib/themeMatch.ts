/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which ready-made frames and filters suit THIS event — occasion first, then
 * colour. One ranking feeds the create flow's seeded set, the LooksPicker's
 * "Recommended" order, and the patch both of them write into events.config,
 * so what the host is shown first is what the booth opens with.
 *
 * PURE: no React, no supabase.
 */
import { BORDER_MAP, GENERIC_FRAMES, type FramePalette } from './borders';
import { FILTER_SHADERS } from './shaders';
import { templateById, type EventTemplate, type TemplateId } from './eventTemplates';
import { normalizeHex } from './themeDerive';
import { rgbToHsl } from './studio/colorways';

/** Occasion + dominant colour of each built-in filter. Kept here (not in the
 *  910-line GPU shader registry) so the booth's render path is untouched; a
 *  test asserts every filter the booth can show has an entry. */
export const FILTER_LOOKS: Record<string, { occasions: TemplateId[]; tone: string }> = {
  'champagne-sparkle': { occasions: ['wedding', 'gala', 'birthday'], tone: '#E8C766' },
  'golden-hour-bloom': { occasions: ['wedding', 'gala', 'corporate'], tone: '#F2B05E' },
  'prismatic-holo': { occasions: ['birthday', 'party'], tone: '#B48CFF' },
  'aureate-god-rays': { occasions: ['gala', 'wedding'], tone: '#E8C766' },
  'velvet-film': { occasions: ['wedding', 'corporate', 'gala'], tone: '#8C5A3C' },
  'crystalline-kaleidoscope': { occasions: ['party'], tone: '#7AE0FF' },
  'celestial-lens-flare': { occasions: ['gala', 'corporate'], tone: '#9EC9FF' },
  'aurora-lumina': { occasions: ['wedding', 'party'], tone: '#2FDD8B' },
  'neon-pulse': { occasions: ['party'], tone: '#FF2D9B' },
  'holo-bloom': { occasions: ['birthday', 'party'], tone: '#FF6FD6' },
  'laser-sparkle': { occasions: ['party', 'birthday'], tone: '#19E3FF' },
};

function hueOf(hex: string): { h: number; s: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const [h, s] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  return { h, s };
}

/** 0 … 1: how close two colours' hues are (1 = same hue). Two greys, or a
 *  grey against anything, count as a neutral 0.5 — a hue on a grey is noise. */
export function hueAffinity(a: string, b: string): number {
  const ha = hueOf(a);
  const hb = hueOf(b);
  if (ha.s < 0.08 || hb.s < 0.08) return 0.5;
  const d = Math.abs(ha.h - hb.h) % 360;
  const dist = d > 180 ? 360 - d : d;
  return 1 - dist / 180;
}

export interface RankInput {
  templateId?: string | null;
  /** events.event_type — used when no template id is known ('remote' → none). */
  eventType?: string | null;
  accentHex?: string | null;
}

export interface RankedLooks {
  frameIds: string[];
  filterIds: string[];
}

function occasionOf(input: RankInput): { template: EventTemplate | undefined; occasion: string | null } {
  const template = templateById(input.templateId ?? undefined) ?? templateById(input.eventType ?? undefined);
  return { template, occasion: template?.id ?? null };
}

/**
 * Every generic frame and every booth filter, best first. Score (higher wins,
 * ties keep the registry order so the result is stable):
 *   +100 in the template's own curated set (the look the host picked)
 *   + 50 tagged for this occasion
 *   + 0…30 colour affinity — a recolourable frame takes the event colour, so
 *     it always scores the full 30 once there is an accent.
 */
export function rankLooks(input: RankInput): RankedLooks {
  const { template, occasion } = occasionOf(input);
  const accent = normalizeHex(input.accentHex);
  const score = (inSet: boolean, occasions: string[] | undefined, tone: string | undefined, recolors: boolean): number => {
    let s = 0;
    if (inSet) s += 100;
    if (occasion !== null && occasions?.includes(occasion)) s += 50;
    if (accent !== null) s += recolors ? 30 : tone ? 30 * hueAffinity(tone, accent) : 0;
    return s;
  };
  const order = <T,>(items: T[], scoreOf: (x: T) => number): T[] =>
    items
      .map((x, i) => ({ x, i, s: scoreOf(x) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((e) => e.x);

  const frameSet = new Set(template?.borderIds ?? []);
  const frameIds = order(GENERIC_FRAMES.map((f) => f.id), (id) => {
    const b = BORDER_MAP[id];
    return score(frameSet.has(id), b?.occasions, b?.tone, Boolean(b?.recolor));
  });
  const filterSet = new Set(template?.shaderIds ?? []);
  const filterIds = order(FILTER_SHADERS.map((s) => s.id), (id) => {
    const look = FILTER_LOOKS[id];
    return score(filterSet.has(id), look?.occasions, look?.tone, false);
  });
  return { frameIds, filterIds };
}

/** What a host's look selection is. `frameId` is the one the booth opens with. */
export interface LooksSelection {
  borderIds: string[];
  shaderIds: string[];
  frameId: string | null;
  /** The colour recolourable frames take on; null keeps them as drawn. */
  palette: FramePalette | null;
}

/** Read the current selection out of an events.config (what LooksPicker
 *  starts from). Missing lists come back empty — the caller decides what an
 *  empty list means (the booth treats an empty allow-list as "everything"). */
export function selectionFromConfig(config: Record<string, unknown> | null | undefined): LooksSelection {
  const cfg = config ?? {};
  const ar = (cfg.arContent && typeof cfg.arContent === 'object' ? cfg.arContent : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const def = typeof cfg.defaultExperienceId === 'string' ? cfg.defaultExperienceId : '';
  const frameId = def.startsWith('builtin:border:') ? def.slice('builtin:border:'.length) : null;
  const pal = ar.framePalette as { accent?: unknown; accent2?: unknown } | undefined;
  const accent = normalizeHex(pal?.accent);
  return {
    borderIds: list(ar.borderIds),
    shaderIds: list(ar.shaderIds),
    frameId,
    palette: accent ? { accent, accent2: normalizeHex(pal?.accent2) } : null,
  };
}

/**
 * The events.config patch for a selection. `arContent` is rebuilt from the
 * CURRENT one (updateEventConfig merges shallowly, so writing a bare
 * `{ borderIds }` would erase headPieceIds). The default frame is only pinned
 * when it is one of the selected frames.
 */
export function looksConfigPatch(
  currentConfig: Record<string, unknown> | null | undefined,
  sel: LooksSelection,
): Record<string, unknown> {
  const cfg = currentConfig ?? {};
  const currentAr = (cfg.arContent && typeof cfg.arContent === 'object' ? cfg.arContent : {}) as Record<string, unknown>;
  const arContent: Record<string, unknown> = { ...currentAr, borderIds: [...sel.borderIds], shaderIds: [...sel.shaderIds] };
  if (sel.palette) arContent.framePalette = { ...sel.palette };
  else delete arContent.framePalette;
  const patch: Record<string, unknown> = { arContent };
  if (sel.frameId !== null && sel.borderIds.includes(sel.frameId)) {
    patch.defaultExperienceId = `builtin:border:${sel.frameId}`;
  }
  return patch;
}

/**
 * The ready-made frame the booth should open with after a looks save. The
 * host's own pick wins; otherwise the first selected frame — UNLESS the event
 * already opens with something that is not a ready-made frame (an AI frame
 * pinned by FrameStudio), which a looks save must not silently replace.
 */
export function effectiveDefaultFrame(
  sel: LooksSelection,
  currentDefaultId: unknown,
): string | null {
  if (sel.frameId !== null && sel.borderIds.includes(sel.frameId)) return sel.frameId;
  const keepsOther = typeof currentDefaultId === 'string' && currentDefaultId !== '' && !currentDefaultId.startsWith('builtin:border:');
  if (keepsOther) return null;
  return sel.borderIds[0] ?? null;
}

/**
 * The seeded set for a fresh event: the template's own frames/filters, put in
 * ranked order, plus the frame palette when the host chose a colour. Merged
 * over templateConfigPatch's arContent by the create flow — with no accent the
 * lists are the template's exact ids (only the order can differ).
 */
export function seededLooks(template: EventTemplate, accentHex: string | null | undefined): { arContent: Record<string, unknown> } {
  const ranked = rankLooks({ templateId: template.id, accentHex });
  const own = (ids: string[], ranked: string[]) => [
    ...ranked.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !ranked.includes(id)),
  ];
  const accent = normalizeHex(accentHex);
  return {
    arContent: {
      shaderIds: own(template.shaderIds, ranked.filterIds),
      borderIds: own(template.borderIds, ranked.frameIds),
      ...(accent ? { framePalette: { accent } } : {}),
    },
  };
}
