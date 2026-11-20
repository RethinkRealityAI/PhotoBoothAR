import { describe, it, expect } from 'vitest';
import { buildDeck, type DeckSelection } from './boothDeck';
import {
  activeLookIds,
  buildLookStrip,
  centeredScrollLeft,
  changedLook,
  lookChips,
  lookHintSeen,
  looksForChip,
  lookTapAction,
  markLookHintSeen,
  runLookAction,
  shouldShowLookHint,
  LOOK_HINT_KEY,
  LOOK_HINT_MIN_LOOKS,
} from './lookStrip';
import type { Experience, ExperienceKind } from '../types';

function exp(id: string, kind: ExperienceKind, name: string, shaderId?: string): Experience {
  return {
    id,
    created_at: '2026-07-25T00:00:00Z',
    updated_at: '2026-07-25T00:00:00Z',
    name,
    kind,
    asset_url: null,
    thumbnail_url: null,
    config: shaderId ? { shader: { shaderId } } : {},
    is_published: true,
    featured: false,
    sort_order: 0,
  };
}

const NONE: DeckSelection = { effectId: 'none', frameId: null, attachmentId: null };

const CATALOG: Experience[] = [
  exp('s1', 'shader', 'Prismatic Holo', 'prismatic-holo'),
  exp('s2', 'shader', 'Aurora Lumina', 'aurora-lumina'),
  exp('s3', 'shader', 'Holo Twin', 'prismatic-holo'),
  exp('f1', 'border', 'Gold Border'),
  exp('c1', 'composite', 'Neon Scene'),
  exp('p1', '3d_attachment', 'Queen Tiara'),
];
const STRIP = buildLookStrip(buildDeck(CATALOG));

describe('buildLookStrip', () => {
  it('orders frames, then 3D, then effects — the host-made looks lead', () => {
    expect(STRIP.map((i) => i.exp.id)).toEqual(['f1', 'c1', 'p1', 's1', 's2', 's3']);
    expect(STRIP.map((i) => i.category)).toEqual(['frame', 'frame', 'prop', 'effect', 'effect', 'effect']);
  });

  it('keeps the deck option fields (label, shaderId)', () => {
    const s1 = STRIP.find((i) => i.exp.id === 's1')!;
    expect(s1.label).toBe('Prismatic');
    expect(s1.shaderId).toBe('prismatic-holo');
  });

  it('is empty for an empty catalog', () => {
    expect(buildLookStrip(buildDeck([]))).toEqual([]);
  });
});

describe('activeLookIds', () => {
  it('lights nothing when nothing is applied', () => {
    expect(activeLookIds(STRIP, NONE).size).toBe(0);
  });

  it('lights one tile per category, so combined looks all show as on', () => {
    const ids = activeLookIds(STRIP, { effectId: 'aurora-lumina', frameId: 'f1', attachmentId: 'p1' });
    expect([...ids].sort()).toEqual(['f1', 'p1', 's2']);
  });

  it('lights only the FIRST tile that shares the active shader', () => {
    expect([...activeLookIds(STRIP, { ...NONE, effectId: 'prismatic-holo' })]).toEqual(['s1']);
  });

  it('ignores a selected id that is not in the strip', () => {
    expect(activeLookIds(STRIP, { ...NONE, frameId: 'gone' }).size).toBe(0);
  });
});

describe('lookTapAction', () => {
  const s2 = STRIP.find((i) => i.exp.id === 's2')!;
  const f1 = STRIP.find((i) => i.exp.id === 'f1')!;
  const p1 = STRIP.find((i) => i.exp.id === 'p1')!;

  it('applies an effect with its own experience (it may carry triggers)', () => {
    expect(lookTapAction(s2, false)).toEqual({ category: 'effect', shaderId: 'aurora-lumina', exp: s2.exp });
  });

  it('a second tap on an active effect clears it', () => {
    expect(lookTapAction(s2, true)).toEqual({ category: 'effect', shaderId: 'none', exp: null });
  });

  it('frames and 3D toggle their own category only', () => {
    expect(lookTapAction(f1, false)).toEqual({ category: 'frame', exp: f1.exp });
    expect(lookTapAction(f1, true)).toEqual({ category: 'frame', exp: null });
    expect(lookTapAction(p1, false)).toEqual({ category: 'prop', exp: p1.exp });
    expect(lookTapAction(p1, true)).toEqual({ category: 'prop', exp: null });
  });

  it('an effect row with no shader id applies "none" rather than undefined', () => {
    const odd = { ...s2, shaderId: null };
    expect(lookTapAction(odd, false)).toMatchObject({ shaderId: 'none' });
  });
});

describe('runLookAction', () => {
  function spy() {
    const calls: string[] = [];
    return {
      calls,
      h: {
        onSelectEffect: (sid: string, e: Experience | null) => calls.push(`effect:${sid}:${e?.id ?? 'null'}`),
        onSelectFrame: (e: Experience | null) => calls.push(`frame:${e?.id ?? 'null'}`),
        onSelectAttachment: (e: Experience | null) => calls.push(`prop:${e?.id ?? 'null'}`),
      },
    };
  }

  it('routes each category to exactly one setter', () => {
    const { calls, h } = spy();
    for (const id of ['s2', 'f1', 'p1']) runLookAction(lookTapAction(STRIP.find((i) => i.exp.id === id)!, false), h);
    runLookAction(lookTapAction(STRIP.find((i) => i.exp.id === 'f1')!, true), h);
    expect(calls).toEqual(['effect:aurora-lumina:s2', 'frame:f1', 'prop:p1', 'frame:null']);
  });
});

describe('changedLook', () => {
  it('announces nothing on the first selection it sees', () => {
    expect(changedLook(STRIP, null, { ...NONE, frameId: 'f1' })).toBeNull();
  });

  it('announces nothing when the selection did not change', () => {
    expect(changedLook(STRIP, NONE, { ...NONE })).toBeNull();
  });

  it('names a look that turned on', () => {
    expect(changedLook(STRIP, NONE, { ...NONE, effectId: 'aurora-lumina' })).toEqual({ id: 's2', name: 'Aurora Lumina', on: true });
  });

  it('names a combined scene by its frame when several categories change at once', () => {
    const next = { effectId: 'aurora-lumina', frameId: 'c1', attachmentId: 'p1' };
    expect(changedLook(STRIP, NONE, next)).toEqual({ id: 'c1', name: 'Neon Scene', on: true });
  });

  it('prefers a look turning on over one turning off', () => {
    const prev = { ...NONE, frameId: 'f1' };
    const next = { ...NONE, effectId: 'aurora-lumina' };
    expect(changedLook(STRIP, prev, next)).toEqual({ id: 's2', name: 'Aurora Lumina', on: true });
  });

  it('names what was removed when a change only turned things off', () => {
    expect(changedLook(STRIP, { ...NONE, attachmentId: 'p1' }, NONE)).toEqual({ id: 'p1', name: 'Queen Tiara', on: false });
  });

  it('stays quiet for an id it cannot name', () => {
    expect(changedLook(STRIP, NONE, { ...NONE, frameId: 'not-in-strip' })).toBeNull();
  });
});

describe('lookChips / looksForChip', () => {
  it('offers All first, then each non-empty category with its count', () => {
    expect(lookChips(STRIP)).toEqual([
      { key: 'all', label: 'All', count: 6 },
      { key: 'frame', label: 'Frames', count: 2 },
      { key: 'prop', label: '3D', count: 1 },
      { key: 'effect', label: 'Effects', count: 3 },
    ]);
  });

  it('drops "All" when there is only one category', () => {
    const fxOnly = buildLookStrip(buildDeck(CATALOG.filter((e) => e.kind === 'shader')));
    expect(lookChips(fxOnly).map((c) => c.key)).toEqual(['effect']);
  });

  it('All groups by category in strip order; a chip narrows to one group', () => {
    expect(looksForChip(STRIP, 'all').map((g) => [g.label, g.items.length])).toEqual([
      ['Frames', 2], ['3D', 1], ['Effects', 3],
    ]);
    expect(looksForChip(STRIP, 'prop').map((g) => g.items.map((i) => i.exp.id))).toEqual([['p1']]);
  });

  it('a chip with nothing in it yields no groups', () => {
    const fxOnly = buildLookStrip(buildDeck(CATALOG.filter((e) => e.kind === 'shader')));
    expect(looksForChip(fxOnly, 'frame')).toEqual([]);
  });
});

describe('centeredScrollLeft', () => {
  it('centres a tile in the middle of a long strip', () => {
    expect(centeredScrollLeft(500, 60, 390, 2000)).toBe(500 + 30 - 195);
  });

  it('clamps at the start (never negative)', () => {
    expect(centeredScrollLeft(10, 60, 390, 2000)).toBe(0);
  });

  it('clamps at the end', () => {
    expect(centeredScrollLeft(1950, 60, 390, 2000)).toBe(1610);
  });

  it('a strip narrower than its viewport cannot scroll at all', () => {
    expect(centeredScrollLeft(200, 60, 390, 300)).toBe(0);
  });
});

describe('first-run hint storage', () => {
  function memStore(initial: Record<string, string> = {}) {
    const m = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, v); },
    };
  }
  const throwing = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };

  it('a fresh device has not seen it; marking it makes it seen', () => {
    const s = memStore();
    expect(lookHintSeen(s)).toBe(false);
    markLookHintSeen(s);
    expect(lookHintSeen(s)).toBe(true);
    expect(s.getItem(LOOK_HINT_KEY)).toBe('1');
  });

  it('storage that throws reads as not seen and never throws to the caller', () => {
    expect(lookHintSeen(throwing)).toBe(false);
    expect(() => markLookHintSeen(throwing)).not.toThrow();
  });

  it('no storage at all reads as not seen', () => {
    expect(lookHintSeen(null)).toBe(false);
    expect(() => markLookHintSeen(null)).not.toThrow();
  });

  it('shows only to an unseen device with enough looks to swipe through', () => {
    expect(shouldShowLookHint(false, LOOK_HINT_MIN_LOOKS)).toBe(true);
    expect(shouldShowLookHint(false, LOOK_HINT_MIN_LOOKS - 1)).toBe(false);
    expect(shouldShowLookHint(true, 40)).toBe(false);
    expect(shouldShowLookHint(false, 0)).toBe(false);
  });
});
