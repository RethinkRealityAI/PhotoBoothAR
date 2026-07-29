/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  DRAFT_KEY_PREFIX,
  SNAPSHOT_VERSION,
  MAX_SNAPSHOT_BYTES,
  MAX_INLINE_URL_BYTES,
  SNAPSHOT_MAX_AGE_MS,
  draftStorageKey,
  isDraftKey,
  serializeDraft,
  encodeSnapshot,
  decodeSnapshot,
  normalizeDraft,
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  pruneSnapshots,
  shouldOfferRecovery,
  draftsEquivalent,
  describeAge,
  type DraftStore,
} from './draftSafety';
import { initialDraft, createOverlay, createObject3D, MAX_OBJECTS, type StudioDraft } from './state';

/* — a Storage-shaped test double ------------------------------------------ */

class MemStore implements DraftStore {
  map = new Map<string, string>();
  failSet = false;
  failGet = false;
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { if (this.failGet) throw new Error('blocked'); return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.failSet) throw new Error('QuotaExceededError'); this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

function sceneDraft(): StudioDraft {
  const d = initialDraft('shader');
  const frame = createOverlay('border', { url: 'https://cdn.test/frame.png', builtinId: 'frame-deco-plain', name: 'Art Deco' });
  const sticker = createOverlay('2d_filter', { url: 'https://cdn.test/star.png', name: 'Star' });
  const piece = createObject3D('headpiece', { proceduralId: 'royal-crown', name: 'Royal Crown' });
  return { ...d, objects: [frame, sticker, piece], selectedId: sticker.id, shaderId: 'neon-pulse', shaderParams: { intensity: 0.5 } };
}

const META = { eventId: 'ev1', experienceId: null, savedAt: 1_700_000_000_000 };

/* — keys ------------------------------------------------------------------- */

describe('draftStorageKey', () => {
  it('gives one slot per event + experience', () => {
    expect(draftStorageKey('ev1', 'exp1')).toBe(`${DRAFT_KEY_PREFIX}ev1.exp1`);
    expect(draftStorageKey('ev1', null)).toBe(`${DRAFT_KEY_PREFIX}ev1.new`);
    expect(draftStorageKey('ev1', 'exp1')).not.toBe(draftStorageKey('ev2', 'exp1'));
  });

  it('bounds absurd ids instead of writing an unbounded key', () => {
    const key = draftStorageKey('e'.repeat(500), 'x'.repeat(500));
    expect(key.length).toBeLessThan(DRAFT_KEY_PREFIX.length + 170);
  });

  it('recognises only its own keys', () => {
    expect(isDraftKey(draftStorageKey('a', null))).toBe(true);
    expect(isDraftKey('sb-auth-token')).toBe(false);
    expect(isDraftKey('')).toBe(false);
  });
});

/* — serialization ---------------------------------------------------------- */

describe('serializeDraft', () => {
  it('keeps http and small data urls', () => {
    const d = sceneDraft();
    const { draft, dropped } = serializeDraft(d);
    expect((draft.objects[0] as { url: string | null }).url).toBe('https://cdn.test/frame.png');
    expect(dropped).toBe(0);
  });

  it('drops blob: urls and pending Blobs, and counts them', () => {
    const d = initialDraft('shader');
    const custom = createOverlay('border', { url: 'blob:http://x/abc', blob: { size: 10 } as unknown as Blob, isBuiltin: false });
    const { draft, dropped } = serializeDraft({ ...d, objects: [custom] });
    const o = draft.objects[0] as { url: string | null; blob: Blob | null };
    expect(o.url).toBeNull();
    expect(o.blob).toBeNull();
    expect(dropped).toBe(1);
  });

  it('drops an oversized inline data url', () => {
    const big = `data:image/svg+xml;utf8,${'x'.repeat(MAX_INLINE_URL_BYTES + 10)}`;
    const d = initialDraft('shader');
    const o = createOverlay('border', { url: big, builtinId: 'frame-deco-plain' });
    const { draft, dropped } = serializeDraft({ ...d, objects: [o] });
    expect((draft.objects[0] as { url: string | null }).url).toBeNull();
    expect(dropped).toBe(1);
  });

  it('drops the thumbnail blob', () => {
    const d = { ...initialDraft('shader'), thumbUrl: 'blob:http://x/t', thumbBlob: {} as Blob };
    const { draft, dropped } = serializeDraft(d);
    expect(draft.thumbUrl).toBeNull();
    expect(draft.thumbBlob).toBeNull();
    expect(dropped).toBe(1);
  });

  it('never mutates the input draft', () => {
    const d = sceneDraft();
    const before = JSON.stringify(d.objects.map((o) => o.id));
    serializeDraft(d);
    expect(JSON.stringify(d.objects.map((o) => o.id))).toBe(before);
    expect(d.thumbBlob).toBeNull();
  });
});

describe('encodeSnapshot', () => {
  it('round-trips a real scene', () => {
    const enc = encodeSnapshot(META, sceneDraft());
    expect(enc).not.toBeNull();
    const back = decodeSnapshot(enc!.text);
    expect(back?.draft.objects).toHaveLength(3);
    expect(back?.draft.shaderId).toBe('neon-pulse');
    expect(back?.draft.shaderParams.intensity).toBe(0.5);
  });

  it('stays under the byte ceiling', () => {
    const enc = encodeSnapshot(META, sceneDraft());
    expect(enc!.bytes).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
  });

  it('degrades by dropping inline data urls before giving up', () => {
    // Ten built-ins each just under the inline cap: the full pass blows the
    // ceiling, the degraded pass (ids only) fits.
    const url = `data:image/svg+xml;utf8,${'y'.repeat(MAX_INLINE_URL_BYTES - 100)}`;
    const objects = Array.from({ length: 10 }, (_, i) =>
      createOverlay('2d_filter', { url, builtinId: `sticker-${i}`, name: `S${i}` }));
    const enc = encodeSnapshot(META, { ...initialDraft('shader'), objects });
    expect(enc).not.toBeNull();
    expect(enc!.bytes).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
    expect(enc!.droppedAssets).toBe(10);
    const back = decodeSnapshot(enc!.text);
    // The layers survive (re-resolvable by builtinId) even though the bytes did not.
    expect(back?.draft.objects).toHaveLength(10);
  });

  it('returns null rather than throwing when nothing can be made to fit', () => {
    // A single http url over the ceiling survives neither pass.
    const huge = `https://cdn.test/${'z'.repeat(MAX_SNAPSHOT_BYTES + 1000)}`;
    const o = createOverlay('border', { url: huge });
    expect(encodeSnapshot(META, { ...initialDraft('shader'), objects: [o] })).toBeNull();
  });
});

/* — defensive decoding ----------------------------------------------------- */

describe('decodeSnapshot — a bad entry can never wedge the editor', () => {
  it('rejects null / empty / non-string', () => {
    expect(decodeSnapshot(null)).toBeNull();
    expect(decodeSnapshot('')).toBeNull();
    expect(decodeSnapshot(undefined)).toBeNull();
  });

  it('rejects invalid JSON', () => {
    expect(decodeSnapshot('{"v":1,')).toBeNull();
    expect(decodeSnapshot('not json at all')).toBeNull();
  });

  it('rejects a JSON primitive or array', () => {
    expect(decodeSnapshot('42')).toBeNull();
    expect(decodeSnapshot('"hi"')).toBeNull();
    expect(decodeSnapshot('[1,2,3]')).toBeNull();
    expect(decodeSnapshot('null')).toBeNull();
  });

  it('rejects a different snapshot version', () => {
    const enc = encodeSnapshot(META, sceneDraft())!;
    const bumped = enc.text.replace(`"v":${SNAPSHOT_VERSION}`, `"v":${SNAPSHOT_VERSION + 1}`);
    expect(decodeSnapshot(bumped)).toBeNull();
  });

  it('rejects a missing or zero timestamp', () => {
    expect(decodeSnapshot(JSON.stringify({ v: SNAPSHOT_VERSION, draft: sceneDraft() }))).toBeNull();
  });

  it('rejects an absurdly long payload without parsing it', () => {
    expect(decodeSnapshot('x'.repeat(MAX_SNAPSHOT_BYTES * 2 + 1))).toBeNull();
  });

  it('rejects a snapshot whose draft is missing or empty', () => {
    expect(decodeSnapshot(JSON.stringify({ v: SNAPSHOT_VERSION, savedAt: 1, draft: null }))).toBeNull();
    expect(decodeSnapshot(JSON.stringify({ v: SNAPSHOT_VERSION, savedAt: 1, draft: { objects: [], shaderId: 'none' } }))).toBeNull();
  });
});

describe('normalizeDraft', () => {
  it('re-derives kind rather than trusting the stored value', () => {
    const d = normalizeDraft({
      ...sceneDraft(),
      kind: '3d_attachment', // a lie: the scene holds overlays AND a 3D piece
    });
    expect(d?.kind).toBe('composite');
  });

  it('drops layers that have neither a url nor a builtin id', () => {
    const d = normalizeDraft({
      shaderId: 'neon-pulse',
      objects: [
        { id: 'a', type: 'overlay', overlayKind: 'border', url: null, name: 'ghost' },
        { id: 'b', type: 'overlay', overlayKind: 'border', url: 'https://x/y.png', name: 'real' },
      ],
    });
    expect(d?.objects.map((o) => o.id)).toEqual(['b']);
  });

  it('drops duplicate ids', () => {
    const d = normalizeDraft({
      shaderId: 'none',
      objects: [
        { id: 'dup', type: 'overlay', overlayKind: 'border', url: 'https://x/1.png' },
        { id: 'dup', type: 'overlay', overlayKind: 'border', url: 'https://x/2.png' },
      ],
    });
    expect(d?.objects).toHaveLength(1);
  });

  it('caps the object count at the scene limit + the exempt frame', () => {
    const objects = Array.from({ length: 500 }, (_, i) => ({
      id: `o${i}`, type: 'overlay', overlayKind: '2d_filter', url: `https://x/${i}.png`,
    }));
    const d = normalizeDraft({ shaderId: 'none', objects });
    expect(d!.objects.length).toBeLessThanOrEqual(MAX_OBJECTS + 1);
  });

  it('clamps out-of-range transforms into the control bounds', () => {
    const d = normalizeDraft({
      shaderId: 'none',
      objects: [{ id: 'a', type: 'overlay', overlayKind: 'border', url: 'https://x/1.png', transform: { scale: 1e9, x: -9999, y: 9999, rotation: 4000 } }],
    });
    const t = (d!.objects[0] as { transform: { scale: number; x: number; y: number; rotation: number } }).transform;
    expect(t.scale).toBe(5);
    expect(t.x).toBe(-100);
    expect(t.y).toBe(100);
    expect(t.rotation).toBe(180);
  });

  it('replaces NaN / non-numeric transform fields with defaults', () => {
    const d = normalizeDraft({
      shaderId: 'none',
      objects: [{ id: 'a', type: 'overlay', overlayKind: 'border', url: 'https://x/1.png', transform: { scale: 'big', x: null, y: NaN, rotation: {} } }],
    });
    const t = (d!.objects[0] as { transform: { scale: number; x: number; y: number; rotation: number } }).transform;
    expect(t).toEqual({ scale: 1, x: 0, y: 0, rotation: 0 });
  });

  it('drops a selection that points at nothing', () => {
    const d = normalizeDraft({ shaderId: 'none', selectedId: 'gone', objects: [{ id: 'a', type: 'overlay', overlayKind: 'border', url: 'https://x/1.png' }] });
    expect(d?.selectedId).toBeNull();
  });

  it('keeps a selection that survived', () => {
    const d = normalizeDraft({ shaderId: 'none', selectedId: 'a', objects: [{ id: 'a', type: 'overlay', overlayKind: 'border', url: 'https://x/1.png' }] });
    expect(d?.selectedId).toBe('a');
  });

  it('drops reveal triggers whose target did not survive', () => {
    const d = normalizeDraft({
      shaderId: 'none',
      objects: [{ id: 'a', type: 'overlay', overlayKind: 'border', url: 'https://x/1.png' }],
      triggers: [
        { id: 't1', source: 'smile', action: { type: 'reveal', objectId: 'gone' } },
        { id: 't2', source: 'wink', action: { type: 'burst', style: 'confetti' } },
      ],
    });
    expect(d?.triggers.map((t) => t.id)).toEqual(['t2']);
  });

  it('rejects triggers with an unknown source or action', () => {
    const d = normalizeDraft({
      shaderId: 'none',
      objects: [{ id: 'a', type: 'overlay', overlayKind: 'border', url: 'https://x/1.png' }],
      triggers: [
        { id: 't1', source: 'sneeze', action: { type: 'burst', style: 'confetti' } },
        { id: 't2', source: 'smile', action: { type: 'launchMissile' } },
        { id: 't3', source: 'smile', action: { type: 'burst', style: 'plasma' } },
      ],
    });
    expect(d?.triggers).toEqual([]);
  });

  it('rejects an unknown object type', () => {
    const d = normalizeDraft({
      shaderId: 'neon-pulse',
      objects: [{ id: 'a', type: 'script', url: 'https://x/evil.js' }],
    });
    expect(d?.objects).toEqual([]);
  });

  it('refuses a javascript: or blob: url', () => {
    const d = normalizeDraft({
      shaderId: 'neon-pulse',
      objects: [
        { id: 'a', type: 'overlay', overlayKind: 'border', url: 'javascript:alert(1)' },
        { id: 'b', type: 'overlay', overlayKind: 'border', url: 'blob:http://x/1' },
      ],
    });
    expect(d?.objects).toEqual([]);
  });

  it('keeps a builtin whose url was dropped, so it can re-resolve by id', () => {
    const d = normalizeDraft({
      shaderId: 'none',
      objects: [{ id: 'a', type: 'overlay', overlayKind: 'border', url: 'blob:http://x/1', builtinId: 'frame-deco-plain', isBuiltin: true }],
    });
    expect(d?.objects).toHaveLength(1);
    expect((d!.objects[0] as { url: string | null }).url).toBeNull();
  });

  it('normalizes a 3D piece and clamps its anchor config', () => {
    const d = normalizeDraft({
      shaderId: 'none',
      objects: [{
        id: 'p', type: 'headpiece', proceduralId: 'royal-crown', name: 'Crown',
        anchor: 'not-an-anchor',
        anchorConfig: { offset: { x: 1e9, y: 'x', z: 2 }, rotation: {}, scale: -5 },
      }],
    });
    const o = d!.objects[0] as { anchor: string; anchorConfig: { offset: { x: number; y: number }; scale: number } };
    expect(o.anchor).toBe('crown');
    expect(o.anchorConfig.offset.x).toBe(1000);
    expect(o.anchorConfig.offset.y).toBe(0);
    expect(o.anchorConfig.scale).toBeGreaterThan(0);
  });

  it('returns null for a draft with nothing in it', () => {
    expect(normalizeDraft({ shaderId: 'none', objects: [] })).toBeNull();
    expect(normalizeDraft('nope')).toBeNull();
    expect(normalizeDraft(null)).toBeNull();
  });

  it('keeps a filter-only scene', () => {
    expect(normalizeDraft({ shaderId: 'neon-pulse', objects: [] })?.kind).toBe('shader');
  });
});

/* — storage adapter -------------------------------------------------------- */

describe('saveSnapshot / loadSnapshot', () => {
  it('round-trips through a store', () => {
    const s = new MemStore();
    expect(saveSnapshot(s, META, sceneDraft()).outcome).toBe('saved');
    expect(loadSnapshot(s, 'ev1', null)?.draft.objects).toHaveLength(3);
  });

  it('reports "unavailable" without throwing when storage is missing or blocked', () => {
    expect(saveSnapshot(null, META, sceneDraft()).outcome).toBe('unavailable');
    const s = new MemStore();
    s.failSet = true;
    expect(saveSnapshot(s, META, sceneDraft()).outcome).toBe('unavailable');
    expect(loadSnapshot(null, 'ev1', null)).toBeNull();
  });

  it('retries once after clearing siblings on a quota error', () => {
    const s = new MemStore();
    s.map.set(draftStorageKey('other', 'x'), 'garbage');
    let calls = 0;
    const flaky: DraftStore = {
      get length() { return s.length; },
      key: (i) => s.key(i),
      getItem: (k) => s.getItem(k),
      removeItem: (k) => s.removeItem(k),
      setItem: (k, v) => { calls += 1; if (calls === 1) throw new Error('QuotaExceededError'); s.setItem(k, v); },
    };
    expect(saveSnapshot(flaky, META, sceneDraft()).outcome).toBe('saved');
    expect(s.map.has(draftStorageKey('other', 'x'))).toBe(false);
  });

  it('DELETES a corrupt entry on read so it can never be re-read', () => {
    const s = new MemStore();
    const key = draftStorageKey('ev1', null);
    s.map.set(key, '{"v":1,"savedAt"'); // truncated
    expect(loadSnapshot(s, 'ev1', null)).toBeNull();
    expect(s.map.has(key)).toBe(false);
  });

  it('survives a store whose getItem throws', () => {
    const s = new MemStore();
    s.failGet = true;
    expect(loadSnapshot(s, 'ev1', null)).toBeNull();
  });

  it('clearSnapshot removes only its own slot', () => {
    const s = new MemStore();
    saveSnapshot(s, META, sceneDraft());
    s.map.set('unrelated', 'keep me');
    clearSnapshot(s, 'ev1', null);
    expect(loadSnapshot(s, 'ev1', null)).toBeNull();
    expect(s.map.get('unrelated')).toBe('keep me');
  });
});

describe('pruneSnapshots', () => {
  it('removes stale and corrupt entries, keeping fresh ones', () => {
    const s = new MemStore();
    saveSnapshot(s, { eventId: 'fresh', experienceId: null, savedAt: 1000 }, sceneDraft());
    saveSnapshot(s, { eventId: 'stale', experienceId: null, savedAt: 1 }, sceneDraft());
    s.map.set(draftStorageKey('rotten', null), 'not json');
    const removed = pruneSnapshots(s, 1000, 500);
    expect(removed).toBe(2);
    expect(loadSnapshot(s, 'fresh', null)).not.toBeNull();
    expect(loadSnapshot(s, 'stale', null)).toBeNull();
  });

  it('never touches keys that are not ours', () => {
    const s = new MemStore();
    s.map.set('sb-auth-token', 'precious');
    s.map.set('theme', 'dark');
    pruneSnapshots(s, Date.now(), 0);
    expect(s.map.get('sb-auth-token')).toBe('precious');
    expect(s.map.get('theme')).toBe('dark');
  });

  it('honours keepKey', () => {
    const s = new MemStore();
    const keep = draftStorageKey('a', null);
    saveSnapshot(s, { eventId: 'a', experienceId: null, savedAt: 1 }, sceneDraft());
    saveSnapshot(s, { eventId: 'b', experienceId: null, savedAt: 1 }, sceneDraft());
    pruneSnapshots(s, 999999, 0, keep);
    expect(s.map.has(keep)).toBe(true);
    expect(s.map.has(draftStorageKey('b', null))).toBe(false);
  });

  it('returns 0 for a null store', () => {
    expect(pruneSnapshots(null, Date.now())).toBe(0);
  });
});

/* — recovery decision ------------------------------------------------------ */

describe('shouldOfferRecovery', () => {
  const now = 2_000_000_000_000;
  const snap = (over: Partial<{ savedAt: number; draft: StudioDraft }> = {}) => ({
    v: SNAPSHOT_VERSION, savedAt: now - 60_000, eventId: 'ev1', experienceId: null, droppedAssets: 0,
    draft: sceneDraft(), ...over,
  });

  it('offers a fresh snapshot when there is nothing loaded', () => {
    expect(shouldOfferRecovery(snap(), null, now)).toBe(true);
  });

  it('does not offer a stale snapshot', () => {
    expect(shouldOfferRecovery(snap({ savedAt: now - SNAPSHOT_MAX_AGE_MS - 1 }), null, now)).toBe(false);
  });

  it('does not offer a snapshot stamped in the future (clock skew / tampering)', () => {
    expect(shouldOfferRecovery(snap({ savedAt: now + 10 * 60_000 }), null, now)).toBe(false);
  });

  it('does not offer a snapshot identical to what is already open', () => {
    const d = sceneDraft();
    expect(shouldOfferRecovery(snap({ draft: d }), d, now)).toBe(false);
  });

  it('offers when the snapshot differs from what is open', () => {
    const open = sceneDraft();
    const changed = { ...open, objects: open.objects.slice(0, 1) };
    expect(shouldOfferRecovery(snap({ draft: open }), changed, now)).toBe(true);
  });

  it('never offers null', () => {
    expect(shouldOfferRecovery(null, null, now)).toBe(false);
  });
});

describe('draftsEquivalent', () => {
  it('ignores selection and thumbnails', () => {
    const a = sceneDraft();
    const b = { ...a, selectedId: null, thumbUrl: 'https://x/other.png' };
    expect(draftsEquivalent(a, b)).toBe(true);
  });

  it('notices a moved overlay', () => {
    const a = sceneDraft();
    const moved = { ...a.objects[0], transform: { scale: 1, x: 12, y: 0, rotation: 0 } };
    expect(draftsEquivalent(a, { ...a, objects: [moved, ...a.objects.slice(1)] })).toBe(false);
  });

  it('notices a renamed scene, a changed filter and a changed param', () => {
    const a = sceneDraft();
    expect(draftsEquivalent(a, { ...a, name: 'Other' })).toBe(false);
    expect(draftsEquivalent(a, { ...a, shaderId: 'velvet-film' })).toBe(false);
    expect(draftsEquivalent(a, { ...a, shaderParams: { intensity: 0.9 } })).toBe(false);
  });

  it('notices a different layer count and a hidden layer', () => {
    const a = sceneDraft();
    expect(draftsEquivalent(a, { ...a, objects: a.objects.slice(1) })).toBe(false);
    const hidden = { ...a.objects[1], hidden: true };
    expect(draftsEquivalent(a, { ...a, objects: [a.objects[0], hidden, a.objects[2]] })).toBe(false);
  });

  it('notices a moved 3D piece', () => {
    const a = sceneDraft();
    const p = a.objects[2] as { anchorConfig: { offset: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: number } };
    const moved = { ...a.objects[2], anchorConfig: { ...p.anchorConfig, offset: { ...p.anchorConfig.offset, y: 3 } } };
    expect(draftsEquivalent(a, { ...a, objects: [a.objects[0], a.objects[1], moved] })).toBe(false);
  });
});

describe('describeAge', () => {
  it('reads like a human', () => {
    const now = 1_000_000_000;
    expect(describeAge(now, now)).toBe('moments ago');
    expect(describeAge(now - 60_000, now)).toBe('1 minute ago');
    expect(describeAge(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(describeAge(now - 60 * 60_000, now)).toBe('1 hour ago');
    expect(describeAge(now - 5 * 60 * 60_000, now)).toBe('5 hours ago');
    expect(describeAge(now - 24 * 60 * 60_000, now)).toBe('yesterday');
    expect(describeAge(now - 3 * 24 * 60 * 60_000, now)).toBe('3 days ago');
  });

  it('never reports a negative age', () => {
    expect(describeAge(2000, 1000)).toBe('moments ago');
  });
});
