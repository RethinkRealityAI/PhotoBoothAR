/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local unsaved-work safety net for the studio.
 *
 * Before this module the ONLY guard on losing a scene was `state.dirty` on the
 * in-app back arrow (StudioShell). There was no `beforeunload`, no router
 * blocker, no autosave and no local draft: a refresh, a tab close or the browser
 * Back button silently destroyed the scene — including 3D pieces the host had
 * just paid credits to generate.
 *
 * This file is the pure half: snapshot encode/decode, a defensive normalizer and
 * a storage-shaped adapter, all free of React/DOM/Supabase so vitest (node env)
 * exercises every path. The rules it enforces:
 *
 *   • BOUNDED — a snapshot is capped in bytes; oversized inline data URLs are
 *     dropped (and counted) rather than blowing the quota, and a draft that
 *     still will not fit is simply not saved. localStorage is ~5MB total and
 *     shared with the rest of the app; a studio autosave may never monopolise it.
 *   • NEVER LOAD-BEARING — every read is defensive and self-healing. A corrupt,
 *     truncated, wrong-version or hostile entry returns null AND is deleted, so
 *     a bad snapshot can never wedge the editor into an unopenable state.
 *   • HONEST — the snapshot records what it had to drop, so the restore prompt
 *     can say so instead of silently handing back a scene missing its uploads.
 */
import type { StudioDraft, StudioObject, Overlay2D, Object3D, DraftKind } from './state';
import { MAX_OBJECTS, deriveKind } from './state';
import type { LayerAnimation, Transform2D, GuestLetteringConfig } from '../../types';
import type { TriggerConfig } from './triggers';
import { TRIGGER_SOURCES, BURST_STYLES } from './triggers';
import { OVERLAY_SCALE, OVERLAY_POSITION, OVERLAY_ROTATION, FINISH_TINT_STRENGTH, clampToSpec } from './controlSpecs';
import { DEFAULT_FINISH, normalizeFinish, normalizeTint, normalizeTintStrength } from './finish';

/** Key prefix for every studio autosave entry — also the prune scope. */
export const DRAFT_KEY_PREFIX = 'bw.studio.draft.';
/** Bump when the snapshot shape changes; older versions are discarded, not migrated. */
export const SNAPSHOT_VERSION = 1;
/** Hard ceiling on one encoded snapshot. Well under a browser's ~5MB budget. */
export const MAX_SNAPSHOT_BYTES = 400_000;
/** Inline `data:` URLs larger than this are dropped from the snapshot. */
export const MAX_INLINE_URL_BYTES = 48_000;
/** A snapshot older than this is never offered for recovery (and is pruned). */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface DraftSnapshot {
  v: number;
  savedAt: number;
  eventId: string;
  /** The experience row this draft edits, or null for an unsaved new scene. */
  experienceId: string | null;
  /** Assets that could not be preserved (pending uploads / oversized inline data). */
  droppedAssets: number;
  draft: StudioDraft;
}

/* — keys ------------------------------------------------------------------- */

/**
 * One slot per (event, experience). A brand-new unsaved scene uses the 'new'
 * slot, so starting a second new scene overwrites the first rather than growing
 * storage without bound.
 */
export function draftStorageKey(eventId: string, experienceId: string | null | undefined): string {
  const safeEvent = String(eventId ?? '').slice(0, 80) || 'unknown';
  const safeId = experienceId ? String(experienceId).slice(0, 80) : 'new';
  return `${DRAFT_KEY_PREFIX}${safeEvent}.${safeId}`;
}

export function isDraftKey(key: string): boolean {
  return typeof key === 'string' && key.startsWith(DRAFT_KEY_PREFIX);
}

/* — serialization ---------------------------------------------------------- */

/** Whether a URL survives a page reload. `blob:` object URLs do not. */
function urlIsPersistable(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('blob:')) return false;
  if (url.startsWith('data:')) return url.length <= MAX_INLINE_URL_BYTES;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Strip a draft down to what can actually survive a reload: Blobs cannot be
 * JSON-encoded and `blob:` URLs die with the document, so both are dropped and
 * counted. Never mutates the input.
 */
export function serializeDraft(d: StudioDraft): { draft: StudioDraft; dropped: number } {
  let dropped = 0;
  const objects = d.objects.map((o): StudioObject => {
    if (o.type === 'overlay') {
      const keep = urlIsPersistable(o.url);
      if (!keep && (o.url || o.blob)) dropped += 1;
      const next: Overlay2D = { ...o, url: keep ? o.url : null, blob: null };
      return next;
    }
    const next: Object3D = { ...o };
    return next;
  });
  const thumbKeep = urlIsPersistable(d.thumbUrl);
  if (!thumbKeep && (d.thumbUrl || d.thumbBlob)) dropped += 1;
  return {
    draft: {
      ...d,
      objects,
      thumbUrl: thumbKeep ? d.thumbUrl : null,
      thumbBlob: null,
      shaderParams: { ...d.shaderParams },
      triggers: d.triggers.map((t) => ({ ...t })),
    },
    dropped,
  };
}

/**
 * Encode a snapshot, or return null when it cannot be made to fit. Tries the
 * full draft first, then a degraded pass that drops every inline `data:` URL
 * (built-ins re-resolve from the catalog on load anyway), then gives up —
 * refusing to save is always better than throwing a quota error at the host
 * mid-edit.
 */
export function encodeSnapshot(
  meta: { eventId: string; experienceId: string | null; savedAt: number },
  draft: StudioDraft,
): { text: string; bytes: number; droppedAssets: number } | null {
  const attempt = (d: StudioDraft, dropped: number) => {
    const snap: DraftSnapshot = {
      v: SNAPSHOT_VERSION,
      savedAt: meta.savedAt,
      eventId: meta.eventId,
      experienceId: meta.experienceId,
      droppedAssets: dropped,
      draft: d,
    };
    let text: string;
    try {
      text = JSON.stringify(snap);
    } catch {
      return null; // a circular or otherwise unencodable draft — never throw at the caller
    }
    return text.length <= MAX_SNAPSHOT_BYTES ? { text, bytes: text.length, droppedAssets: dropped } : null;
  };

  const first = serializeDraft(draft);
  const full = attempt(first.draft, first.dropped);
  if (full) return full;

  // Degraded pass: drop inline data URLs (a built-in re-resolves from its id).
  let extra = 0;
  const lean: StudioDraft = {
    ...first.draft,
    objects: first.draft.objects.map((o) => {
      if (o.type !== 'overlay' || !o.url?.startsWith('data:')) return o;
      extra += 1;
      return { ...o, url: null };
    }),
  };
  return attempt(lean, first.dropped + extra);
}

/* — defensive decoding ----------------------------------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const ANIMATIONS: readonly LayerAnimation[] = ['none', 'float', 'pulse', 'spin'];
const ANCHORS = ['crown', 'forehead', 'noseBridge', 'leftEar', 'rightEar', 'chin', 'neck', 'leftEye', 'rightEye', 'mouth'];

function animationOf(v: unknown): LayerAnimation {
  return ANIMATIONS.includes(v as LayerAnimation) ? (v as LayerAnimation) : 'none';
}

function transformOf(v: unknown): Transform2D {
  const t = isObj(v) ? v : {};
  return {
    scale: clampToSpec(num(t.scale, 1), OVERLAY_SCALE),
    x: clampToSpec(num(t.x, 0), OVERLAY_POSITION),
    y: clampToSpec(num(t.y, 0), OVERLAY_POSITION),
    rotation: clampToSpec(num(t.rotation, 0), OVERLAY_ROTATION),
  };
}

function letteringOf(v: unknown): GuestLetteringConfig | undefined {
  if (!isObj(v)) return undefined;
  const token = str(v.token);
  if (token !== 'guestName' && token !== 'fixed') return undefined;
  const placement = v.placement === 'top' ? 'top' : 'bottom';
  const style = ['script', 'serif', 'block', 'label'].includes(str(v.style)) ? (v.style as GuestLetteringConfig['style']) : 'script';
  const out: GuestLetteringConfig = { token: token as GuestLetteringConfig['token'], style, color: str(v.color, '#FFFFFF').slice(0, 32), placement };
  if (typeof v.text === 'string') out.text = v.text.slice(0, 120);
  return out;
}

function vec3Of(v: unknown): { x: number; y: number; z: number } {
  const o = isObj(v) ? v : {};
  const lim = (n: number) => Math.min(1000, Math.max(-1000, n));
  return { x: lim(num(o.x, 0)), y: lim(num(o.y, 0)), z: lim(num(o.z, 0)) };
}

function objectOf(v: unknown, seen: Set<string>): StudioObject | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  if (!id || seen.has(id)) return null;
  const name = str(v.name, 'Layer').slice(0, 120);
  if (v.type === 'overlay') {
    const overlayKind = v.overlayKind === '2d_filter' ? '2d_filter' : 'border';
    const url = typeof v.url === 'string' && urlIsPersistable(v.url) ? v.url : null;
    const builtinId = typeof v.builtinId === 'string' ? v.builtinId.slice(0, 80) : undefined;
    // Nothing to draw and nothing to re-resolve from → not a recoverable layer.
    if (!url && !builtinId) return null;
    seen.add(id);
    const out: Overlay2D = {
      id, type: 'overlay', overlayKind, url, blob: null,
      isBuiltin: bool(v.isBuiltin, !!builtinId),
      name,
      transform: transformOf(v.transform),
      animation: animationOf(v.animation),
    };
    if (builtinId) out.builtinId = builtinId;
    if (v.hidden === true) out.hidden = true;
    const lettering = letteringOf(v.lettering);
    if (lettering) out.lettering = lettering;
    return out;
  }
  if (v.type === 'model' || v.type === 'headpiece') {
    const assetUrl = typeof v.assetUrl === 'string' && urlIsPersistable(v.assetUrl) ? v.assetUrl : undefined;
    const proceduralId = typeof v.proceduralId === 'string' ? v.proceduralId.slice(0, 80) : undefined;
    if (!assetUrl && !proceduralId) return null;
    seen.add(id);
    const cfg = isObj(v.anchorConfig) ? v.anchorConfig : {};
    const out: Object3D = {
      id, type: v.type, name,
      anchor: (ANCHORS.includes(str(v.anchor)) ? v.anchor : 'crown') as Object3D['anchor'],
      anchorConfig: {
        offset: vec3Of(cfg.offset),
        rotation: vec3Of(cfg.rotation),
        scale: Math.min(50, Math.max(0.001, num(cfg.scale, 1))),
      },
      animation: animationOf(v.animation),
      occlusion: bool(v.occlusion, false),
    };
    if (assetUrl) out.assetUrl = assetUrl;
    if (proceduralId) out.proceduralId = proceduralId;
    // Finish keys are narrowed through the same normalizers the reducer uses —
    // an arbitrary string from a restored autosave can never reach a THREE
    // material. Defaults are OMITTED, so a pre-Wave-6 draft restores with no
    // finish keys and deep-equals its old self.
    const finish = normalizeFinish(v.finish);
    if (finish !== DEFAULT_FINISH) out.finish = finish;
    const tint = normalizeTint(v.tint);
    if (tint) {
      out.tint = tint;
      const strength = normalizeTintStrength(v.tintStrength);
      if (strength !== FINISH_TINT_STRENGTH.max) out.tintStrength = strength;
    }
    if (v.hidden === true) out.hidden = true;
    return out;
  }
  return null;
}

function triggersOf(v: unknown): TriggerConfig[] {
  if (!Array.isArray(v)) return [];
  const out: TriggerConfig[] = [];
  for (const raw of v.slice(0, 16)) {
    if (!isObj(raw)) continue;
    const id = str(raw.id);
    const source = raw.source;
    const action = raw.action;
    if (!id || !TRIGGER_SOURCES.includes(source as never) || !isObj(action)) continue;
    if (action.type === 'burst' && BURST_STYLES.includes(action.style as never)) {
      out.push({ id, source: source as TriggerConfig['source'], action: { type: 'burst', style: action.style as never } });
    } else if (action.type === 'reveal' && typeof action.objectId === 'string') {
      out.push({ id, source: source as TriggerConfig['source'], action: { type: 'reveal', objectId: action.objectId } });
    } else if (action.type === 'filterPulse') {
      out.push({
        id,
        source: source as TriggerConfig['source'],
        action: {
          type: 'filterPulse',
          ...(typeof action.shaderId === 'string' ? { shaderId: action.shaderId.slice(0, 80) } : {}),
          ...(typeof action.durationMs === 'number' && Number.isFinite(action.durationMs)
            ? { durationMs: Math.min(10_000, Math.max(0, action.durationMs)) }
            : {}),
        },
      });
    }
  }
  return out;
}

function shaderParamsOf(v: unknown): Record<string, number> {
  if (!isObj(v)) return {};
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (n >= 24) break;
    if (typeof val === 'number' && Number.isFinite(val)) { out[k.slice(0, 40)] = val; n += 1; }
  }
  return out;
}

/**
 * Turn arbitrary parsed JSON into a StudioDraft the reducer can safely accept,
 * or null when it is not recoverable. Every field is re-derived rather than
 * trusted — `kind` in particular is recomputed with deriveKind so a tampered or
 * stale snapshot cannot put the editor into a mode its content contradicts.
 */
export function normalizeDraft(raw: unknown): StudioDraft | null {
  if (!isObj(raw)) return null;
  const seen = new Set<string>();
  const objects: StudioObject[] = [];
  if (Array.isArray(raw.objects)) {
    // Cap at the scene limit + the exempt frame, so a hostile entry cannot make
    // the editor render thousands of layers.
    for (const item of raw.objects.slice(0, MAX_OBJECTS + 1)) {
      const o = objectOf(item, seen);
      if (o) objects.push(o);
    }
  }
  const shaderId = str(raw.shaderId, 'none').slice(0, 80) || 'none';
  const draft: StudioDraft = {
    name: str(raw.name, 'Untitled Experience').slice(0, 160) || 'Untitled Experience',
    kind: 'shader' as DraftKind,
    isPublished: bool(raw.isPublished, true),
    featured: bool(raw.featured, true),
    shaderId,
    shaderParams: shaderParamsOf(raw.shaderParams),
    objects,
    selectedId: null,
    thumbUrl: typeof raw.thumbUrl === 'string' && urlIsPersistable(raw.thumbUrl) ? raw.thumbUrl : null,
    thumbBlob: null,
    triggers: triggersOf(raw.triggers),
  };
  if (typeof raw.id === 'string' && raw.id) draft.id = raw.id.slice(0, 80);
  if (typeof raw.scene === 'string' && raw.scene) draft.scene = raw.scene.slice(0, 120);
  // Selection must point at something that survived normalization.
  const selectedId = str(raw.selectedId);
  if (selectedId && objects.some((o) => o.id === selectedId)) draft.selectedId = selectedId;
  // Drop reveal triggers whose target did not survive (no dangling references).
  draft.triggers = draft.triggers.filter((t) => {
    if (t.action.type !== 'reveal') return true;
    const target = t.action.objectId;
    return objects.some((o) => o.id === target);
  });
  draft.kind = deriveKind(draft);
  // Nothing to restore is not a recovery — it is an empty editor the host already has.
  if (objects.length === 0 && draft.shaderId === 'none') return null;
  return draft;
}

/** Parse + validate a stored snapshot. Returns null for anything unusable. */
export function decodeSnapshot(text: string | null | undefined): DraftSnapshot | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_SNAPSHOT_BYTES * 2) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(parsed) || parsed.v !== SNAPSHOT_VERSION) return null;
  const draft = normalizeDraft(parsed.draft);
  if (!draft) return null;
  const savedAt = num(parsed.savedAt, 0);
  if (savedAt <= 0) return null;
  return {
    v: SNAPSHOT_VERSION,
    savedAt,
    eventId: str(parsed.eventId),
    experienceId: typeof parsed.experienceId === 'string' ? parsed.experienceId : null,
    droppedAssets: Math.max(0, Math.round(num(parsed.droppedAssets, 0))),
    draft,
  };
}

/* — storage adapter -------------------------------------------------------- */

/** The slice of the Storage API this module needs (injectable → node-testable). */
export interface DraftStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export type SaveOutcome = 'saved' | 'too-large' | 'unavailable';

/**
 * Write a snapshot. Never throws: a full or disabled (private-mode / blocked)
 * storage reports 'unavailable' and the editor carries on — autosave is a safety
 * net, never a precondition for editing.
 */
export function saveSnapshot(
  store: DraftStore | null,
  meta: { eventId: string; experienceId: string | null; savedAt: number },
  draft: StudioDraft,
): { outcome: SaveOutcome; droppedAssets: number } {
  if (!store) return { outcome: 'unavailable', droppedAssets: 0 };
  const encoded = encodeSnapshot(meta, draft);
  if (!encoded) return { outcome: 'too-large', droppedAssets: 0 };
  const key = draftStorageKey(meta.eventId, meta.experienceId);
  try {
    store.setItem(key, encoded.text);
    return { outcome: 'saved', droppedAssets: encoded.droppedAssets };
  } catch {
    // Quota exceeded (or a hostile setItem). Clear stale siblings and retry ONCE.
    try {
      pruneSnapshots(store, meta.savedAt, 0, key);
      store.setItem(key, encoded.text);
      return { outcome: 'saved', droppedAssets: encoded.droppedAssets };
    } catch {
      return { outcome: 'unavailable', droppedAssets: 0 };
    }
  }
}

/**
 * Read a snapshot, SELF-HEALING: anything unusable is removed on the way out, so
 * a corrupt entry can never be re-read on every subsequent visit.
 */
export function loadSnapshot(store: DraftStore | null, eventId: string, experienceId: string | null): DraftSnapshot | null {
  if (!store) return null;
  const key = draftStorageKey(eventId, experienceId);
  let text: string | null = null;
  try {
    text = store.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  const snap = decodeSnapshot(text);
  if (!snap) {
    try { store.removeItem(key); } catch { /* nothing further to do */ }
    return null;
  }
  return snap;
}

export function clearSnapshot(store: DraftStore | null, eventId: string, experienceId: string | null): void {
  if (!store) return;
  try { store.removeItem(draftStorageKey(eventId, experienceId)); } catch { /* best effort */ }
}

/**
 * Drop every studio snapshot older than `maxAgeMs` (and optionally everything
 * except `keepKey`). Keeps the recovery data bounded without ever touching a key
 * that is not ours.
 */
export function pruneSnapshots(
  store: DraftStore | null,
  now: number,
  maxAgeMs: number = SNAPSHOT_MAX_AGE_MS,
  keepKey?: string,
): number {
  if (!store) return 0;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !isDraftKey(key) || key === keepKey) continue;
      const snap = decodeSnapshot(store.getItem(key));
      if (!snap || now - snap.savedAt > maxAgeMs) doomed.push(key);
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const key of doomed) {
    try { store.removeItem(key); removed += 1; } catch { /* best effort */ }
  }
  return removed;
}

/* — recovery decision ------------------------------------------------------ */

/**
 * Whether a snapshot is worth offering back. Deliberately conservative: a stale
 * snapshot, or one that matches what the editor already loaded, would make the
 * restore prompt noise — and a prompt hosts learn to dismiss is worse than none.
 */
export function shouldOfferRecovery(
  snap: DraftSnapshot | null,
  current: StudioDraft | null,
  now: number,
  maxAgeMs: number = SNAPSHOT_MAX_AGE_MS,
): boolean {
  if (!snap) return false;
  if (now - snap.savedAt > maxAgeMs) return false;
  if (snap.savedAt > now + 60_000) return false; // clock skew / tampered future stamp
  if (snap.draft.objects.length === 0 && snap.draft.shaderId === 'none') return false;
  if (!current) return true;
  return !draftsEquivalent(snap.draft, current);
}

/** Content equality for the recovery prompt — ignores selection and thumbnails. */
export function draftsEquivalent(a: StudioDraft, b: StudioDraft): boolean {
  if (a.name !== b.name || a.shaderId !== b.shaderId) return false;
  if (a.objects.length !== b.objects.length) return false;
  if (a.triggers.length !== b.triggers.length) return false;
  const keys = new Set([...Object.keys(a.shaderParams), ...Object.keys(b.shaderParams)]);
  for (const k of keys) if (a.shaderParams[k] !== b.shaderParams[k]) return false;
  for (let i = 0; i < a.objects.length; i++) {
    const x = a.objects[i];
    const y = b.objects[i];
    if (x.type !== y.type || x.name !== y.name || !!x.hidden !== !!y.hidden || x.animation !== y.animation) return false;
    if (x.type === 'overlay' && y.type === 'overlay') {
      if (x.overlayKind !== y.overlayKind || x.url !== y.url || x.builtinId !== y.builtinId) return false;
      const t = x.transform;
      const u = y.transform;
      if (t.scale !== u.scale || t.x !== u.x || t.y !== u.y || t.rotation !== u.rotation) return false;
    } else if (x.type !== 'overlay' && y.type !== 'overlay') {
      if (x.assetUrl !== y.assetUrl || x.proceduralId !== y.proceduralId || x.anchor !== y.anchor) return false;
      if (x.occlusion !== y.occlusion) return false;
      // A restyled piece IS different work: without this, changing a crown from
      // grey plastic to gold and refreshing would show no recovery prompt.
      if (x.finish !== y.finish || x.tint !== y.tint || x.tintStrength !== y.tintStrength) return false;
      const p = x.anchorConfig;
      const q = y.anchorConfig;
      if (p.scale !== q.scale) return false;
      for (const axis of ['x', 'y', 'z'] as const) {
        if (p.offset[axis] !== q.offset[axis] || p.rotation[axis] !== q.rotation[axis]) return false;
      }
    }
  }
  return true;
}

/** Human-readable age for the restore prompt ("2 minutes ago"). */
export function describeAge(savedAt: number, now: number): string {
  const ms = Math.max(0, now - savedAt);
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'moments ago';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
