/**
 * admin-api/librarySettings.ts — copy a library prop's settings onto other
 * library items, and validate the settings the in-library editor saves.
 *
 * Runtime-free on purpose (no Deno globals, no jsr:/npm: imports), so the
 * browser imports THIS file directly (src/lib/adminLibrary.ts) and
 * src/lib/librarySettings.test.ts runs it under vitest. One copy, no mirror.
 *
 * A "piece" is the ONE 3D object a library prop is made of: the single
 * `3d_attachment` layer of `config.layers` (face-paint layers do not count),
 * or, for a row written before layers existed, the legacy singular
 * `config.anchor`. A scene with several 3D pieces is refused rather than
 * guessed at: which of its pieces a hat's fit belongs on is not knowable.
 *
 * Settings come in three groups, so a host can copy only what they mean to:
 *   fit       where it sits: anchor point, size, position, tilt, which hand,
 *             anchor calibration, and whether the head hides parts of it.
 *   look      material finish and colour wash (+ recoloured regions, only
 *             when both models share the same configurator template).
 *   behaviour idle animation, face-trigger effects, face-tracking engine.
 *
 * Size is copied RELATIVE to each model's own size when both were measured at
 * import (`config.library.import.maxDim`), so a variant exported at a
 * different scale still ends up the same size on a face. Same-size variants
 * get exactly the same number.
 *
 * MIRROR RULE (types.ts ExperienceLayer): the singular `config.anchor` /
 * `config.occlusion` always mirror layer 0, so they are written whenever the
 * piece IS layer 0 (or there are no layers).
 *
 * DEPLOY NOTE: admin-api deploys as SIX files (index.ts, library.ts,
 * libraryImport.ts, taxonomy.ts, librarySettings.ts, deno.json). A deploy
 * missing this sibling is an import error at boot = every admin-api request 500s.
 */

export type SettingsGroup = 'fit' | 'look' | 'behaviour';
export const SETTINGS_GROUPS: readonly SettingsGroup[] = ['fit', 'look', 'behaviour'];

/** = src/types.ts HeadAnchor (pinned by librarySettings.test.ts). */
export const HEAD_ANCHOR_IDS = [
  'crown', 'forehead', 'noseBridge', 'noseTip', 'leftEye', 'rightEye',
  'leftEar', 'rightEar', 'leftCheek', 'rightCheek', 'mouth', 'chin',
] as const;
/** = src/lib/handPose.ts HAND_ANCHORS ids (pinned by the test). */
export const HAND_ANCHOR_IDS = ['grip', 'wristBack', 'palm', 'forearm'] as const;
export const ANIMATION_IDS = ['none', 'float', 'pulse', 'spin'] as const;
export const TRACKING_IDS = ['mediapipe', 'xr8', 'hybrid'] as const;

export const COPY_TARGETS_MAX = 100;
const SCALE_MIN = 0.001;
const SCALE_MAX = 1000;
const OFFSET_MAX = 200;
const ROTATION_MAX = 4 * Math.PI;
const TRIGGERS_MAX = 32;
const TRIGGERS_MAX_BYTES = 16 * 1024;
const TEMPLATE_MAX_BYTES = 64 * 1024;

export interface Vec3 { x: number; y: number; z: number }
export interface PieceAnchor { anchor: string; offset: Vec3; rotation: Vec3; scale: number }

export interface FitSettings {
  anchor: PieceAnchor;
  /** Only an exact 2 is meaningful (faceRig ANCHOR_PRESETS_V2); absent = v1. */
  anchorVersion?: 2;
  handAnchor?: string;
  handFit?: 'left' | 'right';
  occlusion: boolean;
}

export interface LookSettings {
  finish?: string;
  tint?: string;
  tintStrength?: number;
  /** Copied only onto a model whose template is byte-identical. */
  customization?: unknown;
  template?: unknown;
}

export interface BehaviourSettings {
  animation?: string;
  triggers?: unknown[];
  tracking?: string;
}

export interface PieceSettings {
  fit: FitSettings;
  look: LookSettings;
  behaviour: BehaviourSettings;
  /** The 3D layer's id (triggers name it), null for a legacy singular row. */
  layerId: string | null;
  /** Longest side of the model in its own units, measured at import. */
  modelSize: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function vec3(raw: unknown, max: number): Vec3 | null {
  if (!isRecord(raw)) return null;
  const { x, y, z } = raw;
  if (!finite(x) || !finite(y) || !finite(z)) return null;
  return { x: clamp(x, -max, max), y: clamp(y, -max, max), z: clamp(z, -max, max) };
}

/** A validated anchor, or null. Numbers are clamped, never rejected for size. */
export function normalizeAnchor(raw: unknown): PieceAnchor | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.anchor !== 'string' || !(HEAD_ANCHOR_IDS as readonly string[]).includes(raw.anchor)) return null;
  const offset = vec3(raw.offset ?? { x: 0, y: 0, z: 0 }, OFFSET_MAX);
  const rotation = vec3(raw.rotation ?? { x: 0, y: 0, z: 0 }, ROTATION_MAX);
  if (!offset || !rotation || !finite(raw.scale) || raw.scale <= 0) return null;
  return { anchor: raw.anchor, offset, rotation, scale: clamp(raw.scale, SCALE_MIN, SCALE_MAX) };
}

/** Where the piece lives in a config: a layer index, or -1 for the legacy singular fields. */
export type PieceLocation = { ok: true; index: number } | { ok: false; reason: 'not_a_prop' | 'several_pieces' };

export function locatePiece(config: unknown): PieceLocation {
  if (!isRecord(config)) return { ok: false, reason: 'not_a_prop' };
  const layers = Array.isArray(config.layers) ? config.layers : null;
  if (layers && layers.length > 0) {
    const idx: number[] = [];
    layers.forEach((l, i) => {
      if (isRecord(l) && l.kind === '3d_attachment' && l.facePaint === undefined) idx.push(i);
    });
    if (idx.length === 0) return { ok: false, reason: 'not_a_prop' };
    if (idx.length > 1) return { ok: false, reason: 'several_pieces' };
    return { ok: true, index: idx[0] };
  }
  return normalizeAnchor(config.anchor) ? { ok: true, index: -1 } : { ok: false, reason: 'not_a_prop' };
}

/** The model's measured size (import), or null when it was never measured. */
export function modelSizeOf(config: unknown): number | null {
  if (!isRecord(config) || !isRecord(config.library) || !isRecord(config.library.import)) return null;
  const m = config.library.import.maxDim;
  return finite(m) && m > 0 ? m : null;
}

const HEX_RE = /^#[0-9a-f]{6}$/;
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;

function byteLength(v: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(v)).length; } catch { return Infinity; }
}

/** Read a row's settings. null = not a single-piece prop (see locatePiece). */
export function extractSettings(config: unknown): PieceSettings | null {
  const loc = locatePiece(config);
  if (!loc.ok || !isRecord(config)) return null;
  const layer = loc.index >= 0 ? (config.layers as Record<string, unknown>[])[loc.index] : null;
  const anchor = normalizeAnchor(layer ? (layer.anchor ?? config.anchor) : config.anchor);
  if (!anchor) return null;
  const src = layer ?? config;
  const fit: FitSettings = {
    anchor,
    occlusion: src.occlusion === true || (loc.index <= 0 && config.occlusion === true && layer?.occlusion !== false),
  };
  if (layer?.anchorVersion === 2) fit.anchorVersion = 2;
  if (layer && typeof layer.handAnchor === 'string' && (HAND_ANCHOR_IDS as readonly string[]).includes(layer.handAnchor)) {
    fit.handAnchor = layer.handAnchor;
    if (layer.handFit === 'left' || layer.handFit === 'right') fit.handFit = layer.handFit;
  }
  const look: LookSettings = {};
  if (layer) {
    if (typeof layer.finish === 'string' && ID_RE.test(layer.finish)) look.finish = layer.finish;
    if (typeof layer.tint === 'string' && HEX_RE.test(layer.tint)) look.tint = layer.tint;
    if (finite(layer.tintStrength)) look.tintStrength = clamp(layer.tintStrength, 0, 1);
    if (layer.customization !== undefined) look.customization = layer.customization;
    if (layer.template !== undefined) look.template = layer.template;
  }
  const behaviour: BehaviourSettings = {};
  if (layer && typeof layer.animation === 'string' && layer.animation !== 'none'
    && (ANIMATION_IDS as readonly string[]).includes(layer.animation)) behaviour.animation = layer.animation;
  if (Array.isArray(config.triggers) && config.triggers.length > 0) behaviour.triggers = config.triggers;
  if (typeof config.tracking === 'string' && (TRACKING_IDS as readonly string[]).includes(config.tracking)) {
    behaviour.tracking = config.tracking;
  }
  return {
    fit, look, behaviour,
    layerId: layer && typeof layer.id === 'string' ? layer.id : null,
    modelSize: modelSizeOf(config),
  };
}

/**
 * Validate settings sent by the in-library editor. Untrusted input: every
 * field is checked, and anything not understood is a 400, not a silent drop —
 * dropping a field here would quietly erase it from a live prop.
 */
export function normalizeSettings(raw: unknown): { ok: true; settings: Omit<PieceSettings, 'layerId' | 'modelSize'> } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: 'invalid_settings' };
  const f = raw.fit, l = raw.look ?? {}, b = raw.behaviour ?? {};
  if (!isRecord(f) || !isRecord(l) || !isRecord(b)) return { ok: false, error: 'invalid_settings' };
  const anchor = normalizeAnchor(f.anchor);
  if (!anchor) return { ok: false, error: 'invalid_anchor' };
  if (typeof f.occlusion !== 'boolean') return { ok: false, error: 'invalid_settings' };
  const fit: FitSettings = { anchor, occlusion: f.occlusion };
  if (f.anchorVersion !== undefined) {
    if (f.anchorVersion !== 2) return { ok: false, error: 'invalid_settings' };
    fit.anchorVersion = 2;
  }
  if (f.handAnchor !== undefined) {
    if (typeof f.handAnchor !== 'string' || !(HAND_ANCHOR_IDS as readonly string[]).includes(f.handAnchor)) return { ok: false, error: 'invalid_anchor' };
    fit.handAnchor = f.handAnchor;
    if (f.handFit !== undefined) {
      if (f.handFit !== 'left' && f.handFit !== 'right') return { ok: false, error: 'invalid_settings' };
      fit.handFit = f.handFit;
    }
  }
  const look: LookSettings = {};
  if (l.finish !== undefined) {
    if (typeof l.finish !== 'string' || !ID_RE.test(l.finish)) return { ok: false, error: 'invalid_settings' };
    look.finish = l.finish;
  }
  if (l.tint !== undefined) {
    if (typeof l.tint !== 'string' || !HEX_RE.test(l.tint)) return { ok: false, error: 'invalid_settings' };
    look.tint = l.tint;
  }
  if (l.tintStrength !== undefined) {
    if (!finite(l.tintStrength)) return { ok: false, error: 'invalid_settings' };
    look.tintStrength = clamp(l.tintStrength, 0, 1);
  }
  if (l.customization !== undefined) {
    if (!isRecord(l.customization) || byteLength(l.customization) > TEMPLATE_MAX_BYTES) return { ok: false, error: 'invalid_settings' };
    look.customization = l.customization;
  }
  if (l.template !== undefined) {
    if (byteLength(l.template) > TEMPLATE_MAX_BYTES) return { ok: false, error: 'invalid_settings' };
    look.template = l.template;
  }
  const behaviour: BehaviourSettings = {};
  if (b.animation !== undefined) {
    if (typeof b.animation !== 'string' || !(ANIMATION_IDS as readonly string[]).includes(b.animation)) return { ok: false, error: 'invalid_settings' };
    if (b.animation !== 'none') behaviour.animation = b.animation;
  }
  if (b.triggers !== undefined) {
    if (!Array.isArray(b.triggers) || b.triggers.length > TRIGGERS_MAX || byteLength(b.triggers) > TRIGGERS_MAX_BYTES
      || !b.triggers.every(isRecord)) return { ok: false, error: 'invalid_settings' };
    if (b.triggers.length > 0) behaviour.triggers = b.triggers;
  }
  if (b.tracking !== undefined) {
    if (typeof b.tracking !== 'string' || !(TRACKING_IDS as readonly string[]).includes(b.tracking)) return { ok: false, error: 'invalid_settings' };
    behaviour.tracking = b.tracking;
  }
  return { ok: true, settings: { fit, look, behaviour } };
}

export function normalizeGroups(raw: unknown): SettingsGroup[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SettingsGroup[] = [];
  for (const g of raw) {
    if (!(SETTINGS_GROUPS as readonly unknown[]).includes(g)) return null;
    if (!out.includes(g as SettingsGroup)) out.push(g as SettingsGroup);
  }
  return out;
}

/** The size to give a target so it ends up as big on a face as the source. */
export function matchedScale(sourceScale: number, sourceSize: number | null, targetSize: number | null): number {
  if (sourceSize === null || targetSize === null) return sourceScale;
  const ratio = sourceSize / targetSize;
  // A wildly different model is not a variant; copy the plain number. Within
  // 1% is the same export (measurement noise), so variants get the SAME number.
  if (!(ratio > 0.2 && ratio < 5) || Math.abs(ratio - 1) < 0.01) return sourceScale;
  return clamp(sourceScale * ratio, SCALE_MIN, SCALE_MAX);
}

/** Deep-replace one string (a layer id inside trigger configs). */
function replaceString(value: unknown, from: string, to: string, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === 'string') return value === from ? to : value;
  if (Array.isArray(value)) return value.map((v) => replaceString(v, from, to, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceString(v, from, to, depth + 1);
    return out;
  }
  return value;
}

function setOrDelete(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** JSON with object keys sorted: Postgres jsonb hands keys back in its own
 *  order, so key order must never count as a change. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export type ApplyResult =
  | { ok: true; config: Record<string, unknown>; changed: boolean; notes: string[] }
  | { ok: false; reason: 'not_a_prop' | 'several_pieces' };

/**
 * Write `settings` (only the chosen groups) onto a target row's config.
 * Never mutates its input. `sourceSize`/`sourceLayerId` come from the row the
 * settings were read from (null when they were typed in the editor).
 */
export function applySettings(
  targetConfig: unknown,
  settings: { fit: FitSettings; look: LookSettings; behaviour: BehaviourSettings },
  groups: readonly SettingsGroup[],
  source: { modelSize: number | null; layerId: string | null } = { modelSize: null, layerId: null },
): ApplyResult {
  const loc = locatePiece(targetConfig);
  if ('reason' in loc) return { ok: false, reason: loc.reason };
  const before = stableJson(targetConfig);
  const config = clone(targetConfig as Record<string, unknown>);
  const layers = Array.isArray(config.layers) ? (config.layers as Record<string, unknown>[]) : null;
  const layer = loc.index >= 0 && layers ? layers[loc.index] : null;
  const mirrors = loc.index <= 0; // the singular fields mirror layer 0
  const notes: string[] = [];

  if (groups.includes('fit')) {
    const a = settings.fit.anchor;
    const anchor: PieceAnchor = {
      ...a,
      offset: { ...a.offset },
      rotation: { ...a.rotation },
      scale: matchedScale(a.scale, source.modelSize, modelSizeOf(targetConfig)),
    };
    if (layer) {
      layer.anchor = anchor;
      setOrDelete(layer, 'anchorVersion', settings.fit.anchorVersion);
      setOrDelete(layer, 'handAnchor', settings.fit.handAnchor);
      setOrDelete(layer, 'handFit', settings.fit.handAnchor !== undefined ? settings.fit.handFit : undefined);
      setOrDelete(layer, 'occlusion', settings.fit.occlusion ? true : undefined);
    }
    if (mirrors) {
      config.anchor = clone(anchor);
      setOrDelete(config, 'occlusion', settings.fit.occlusion ? true : undefined);
    }
  }

  if (groups.includes('look') && layer) {
    setOrDelete(layer, 'finish', settings.look.finish);
    setOrDelete(layer, 'tint', settings.look.tint);
    setOrDelete(layer, 'tintStrength', settings.look.tint !== undefined ? settings.look.tintStrength : undefined);
    if (settings.look.customization !== undefined) {
      if (stableJson(settings.look.template ?? null) === stableJson(layer.template ?? null)) {
        layer.customization = clone(settings.look.customization);
      } else {
        notes.push('colours_skipped');
      }
    }
  } else if (groups.includes('look') && !layer) {
    notes.push('look_needs_layers');
  }

  if (groups.includes('behaviour')) {
    if (layer) setOrDelete(layer, 'animation', settings.behaviour.animation);
    else if (settings.behaviour.animation !== undefined) notes.push('animation_needs_layers');
    let triggers: unknown = settings.behaviour.triggers;
    if (triggers !== undefined && source.layerId !== null && typeof layer?.id === 'string' && layer.id !== source.layerId) {
      triggers = replaceString(triggers, source.layerId, layer.id);
    }
    setOrDelete(config, 'triggers', triggers === undefined ? undefined : clone(triggers));
    setOrDelete(config, 'tracking', settings.behaviour.tracking);
  }

  return { ok: true, config, changed: stableJson(config) !== before, notes };
}

/* ── Variant suggestions ─────────────────────────────────────────────── */

/** Colour and finish words that tell variants of one piece apart. */
const VARIANT_WORDS = new Set([
  'red', 'orange', 'yellow', 'gold', 'golden', 'green', 'teal', 'blue', 'purple', 'pink', 'neutral', 'black', 'white',
  'silver', 'emerald', 'ruby', 'sapphire', 'amethyst', 'onyx', 'ivory', 'rose', 'crimson', 'navy', 'royal', 'bronze',
  'copper', 'pearl', 'cream', 'grey', 'gray', 'brown', 'tan', 'beige', 'violet', 'lilac', 'mint', 'coral', 'magenta',
  'cyan', 'turquoise', 'champagne', 'platinum', 'chrome', 'matte', 'gloss', 'glossy', 'metallic', 'dark', 'light',
  'bright', 'deep', 'pale', 'm', 'v1', 'v2', 'v3', 'and', 'the', 'a', 'of', 'with', 'glb', 'copy', 'new', 'final',
  'optimized', 'optimised',
  // Generator noise in file names ("Meshy_AI_Kabuki_Mask_1119232645_texture.glb").
  'meshy', 'ai', 'texture', 'generate', 'image', 'to', '3d', 'refine', 'remesh',
]);

/** The words that name WHAT the piece is (colours and noise removed). */
export function coreWords(...names: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    for (const w of n.toLowerCase().replace(/\.glb$/, '').split(/[^a-z0-9]+/)) {
      if (w.length > 0 && !VARIANT_WORDS.has(w) && !/^\d+$/.test(w)) out.add(w);
    }
  }
  return [...out];
}

export interface VariantCandidate { id: string; name: string; kind: string; fileName?: string | null; modelSize?: number | null }

/**
 * 0..1: how likely `b` is another colourway of `a`. Variants of one piece name
 * the same THING once colour words are removed ("Black Gold Gala Mask" and
 * "Emerald Gala Mask" are both {gala, mask}), so the rule is set equality, or
 * one name extending the other ("Crimson Demon Mask" / "ZM Crimson Demon
 * Mask"). Merely sharing a word ("Kabuki Mask" / "Timberwood Mask") is NOT a
 * variant: every mask shares "mask".
 */
export function variantScore(a: VariantCandidate, b: VariantCandidate): number {
  if (a.id === b.id || a.kind !== b.kind) return 0;
  const wa = coreWords(a.name, a.fileName), wb = coreWords(b.name, b.fileName);
  if (wa.length === 0 || wb.length === 0) return 0;
  const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  if (!small.every((w) => big.includes(w))) return 0;
  if (small.length === big.length) return 1;
  return small.length >= 2 ? 0.7 : 0;
}

export const VARIANT_THRESHOLD = 0.5;

/** The items most likely to be variants of `source`, best first. */
export function suggestVariants(source: VariantCandidate, pool: readonly VariantCandidate[]): string[] {
  return pool
    .map((c) => ({ id: c.id, s: variantScore(source, c) }))
    .filter((x) => x.s >= VARIANT_THRESHOLD)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.id);
}
