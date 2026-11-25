import { describe, it, expect } from 'vitest';
import { buildDeck, type DeckSelection } from './boothDeck';
import { buildLookStrip, runLookAction, type LookHandlers } from './lookStrip';
import { canSurprise, pickSurprise, surpriseAnnouncement, surprisePool, SURPRISE_MIN_LOOKS, type Surprise } from './lookSurprise';
import { withWorldLooks } from './world/worldLooks';
import type { Experience, ExperienceKind } from '../types';

function exp(id: string, kind: ExperienceKind, name: string, config: Experience['config'] = {}): Experience {
  return {
    id, created_at: '2026-07-25T00:00:00Z', updated_at: '2026-07-25T00:00:00Z',
    name, kind, asset_url: kind === 'border' ? `https://x/${id}.png` : null, thumbnail_url: null,
    config, is_published: true, featured: false, sort_order: 0,
  };
}
const shader = (id: string, name: string, shaderId: string) => exp(id, 'shader', name, { shader: { shaderId } });
const paint = (id: string, name: string) =>
  exp(id, '3d_attachment', name, { layers: [{ facePaint: { design: 'tiger' } }] } as unknown as Experience['config']);

/** A seeded sequence RNG (mulberry32), so every test is deterministic. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NONE: DeckSelection = { effectId: 'none', frameId: null, attachmentId: null, paintId: null };

const CATALOG: Experience[] = [
  exp('f1', 'border', 'Gold Confetti'),
  exp('f2', 'border', 'Gold Border'),
  exp('p1', '3d_attachment', 'Queen Tiara'),
  exp('p2', '3d_attachment', 'Party Shades'),
  paint('fp1', 'Tiger Paint'),
  shader('s1', 'Aurora', 'aurora-lumina'),
  shader('s2', 'Prism', 'prismatic-holo'),
];
const STRIP = buildLookStrip(buildDeck(withWorldLooks(CATALOG)));

/** Apply a surprise the way the booth would, into a plain selection. */
function apply(actions: Surprise['actions'], from: DeckSelection): DeckSelection {
  const sel = { ...from };
  const h: LookHandlers = {
    onSelectFrame: (e) => {
      sel.frameId = e?.id ?? null;
      if (e?.kind === 'composite') { sel.attachmentId = e.id; sel.effectId = e.config?.ambientShader?.shaderId ?? sel.effectId; }
    },
    onSelectAttachment: (e) => { sel.attachmentId = e?.id ?? null; },
    onSelectPaint: (e) => { sel.paintId = e?.id ?? null; },
    onSelectEffect: (id) => { sel.effectId = id; },
  };
  for (const a of actions) runLookAction(a, h);
  return sel;
}

describe('pickSurprise', () => {
  it('is deterministic for a given rng', () => {
    const a = pickSurprise(STRIP, seeded(42), NONE);
    const b = pickSurprise(STRIP, seeded(42), NONE);
    expect(a).not.toBeNull();
    expect(a!.result).toEqual(b!.result);
  });

  it('always leads with a frame when the event has frames, and its actions produce its result', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = pickSurprise(STRIP, seeded(seed), NONE)!;
      expect(s.result.frameId).not.toBeNull();
      expect(s.actions[0].category).toBe('frame');
      expect(apply(s.actions, NONE)).toEqual(s.result);
    }
  });

  it('never picks a room-mode "3D" Frame tile', () => {
    expect(STRIP.some((i) => i.exp.id.startsWith('world:'))).toBe(true);
    for (let seed = 1; seed <= 80; seed++) {
      const s = pickSurprise(STRIP, seeded(seed), NONE)!;
      expect(s.picks.every((p) => !p.exp.id.startsWith('world:'))).toBe(true);
    }
  });

  it('can wear a prop AND a paint together (separate slots)', () => {
    const both = Array.from({ length: 120 }, (_, i) => pickSurprise(STRIP, seeded(i + 1), NONE)!)
      .some((s) => s.result.attachmentId !== null && s.result.paintId !== null);
    expect(both).toBe(true);
  });

  it('never repeats the combination that is already on', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const first = pickSurprise(STRIP, seeded(seed), NONE)!;
      const next = pickSurprise(STRIP, seeded(seed), first.result)!;
      expect(next).not.toBeNull();
      expect(next.result).not.toEqual(first.result);
    }
  });

  it('returns null when only one combination exists and it is already on', () => {
    const tiny = buildLookStrip(buildDeck([shader('s1', 'A', 'a'), shader('s2', 'B', 'a'), shader('s3', 'C', 'a')]));
    const on: DeckSelection = { ...NONE, effectId: 'a' };
    expect(pickSurprise(tiny, seeded(1), on)).toBeNull();
    expect(pickSurprise(tiny, seeded(1), NONE)!.result.effectId).toBe('a');
  });

  it('clears the slots it does not fill (a surprise replaces the whole look)', () => {
    const wearing: DeckSelection = { frameId: 'f1', attachmentId: 'p1', paintId: 'fp1', effectId: 'aurora-lumina' };
    for (let seed = 1; seed <= 40; seed++) {
      const s = pickSurprise(STRIP, seeded(seed), wearing)!;
      expect(apply(s.actions, wearing)).toEqual(s.result);
    }
  });

  it('never stacks a prop on a combined scene, and keeps the scene\'s own effect', () => {
    const scene = exp('c1', 'composite', 'Neon Scene', { ambientShader: { shaderId: 'neon' } } as Experience['config']);
    const strip = buildLookStrip(buildDeck([scene, exp('p1', '3d_attachment', 'Tiara'), paint('fp1', 'Tiger'), shader('s1', 'Aurora', 'aurora')]));
    for (let seed = 1; seed <= 60; seed++) {
      const s = pickSurprise(strip, seeded(seed), NONE)!;
      expect(s.result.frameId).toBe('c1');
      expect(s.result.attachmentId).toBe('c1');
      expect(s.result.effectId).toBe('neon');
      expect(s.actions.some((a) => a.category === 'prop')).toBe(false);
      expect(s.actions.some((a) => a.category === 'effect')).toBe(false);
      expect(apply(s.actions, NONE)).toEqual(s.result);
    }
  });

  it('handles empty categories: no frames → a face look or an effect', () => {
    const strip = buildLookStrip(buildDeck([exp('p1', '3d_attachment', 'Tiara'), exp('p2', '3d_attachment', 'Crown'), shader('s1', 'Aurora', 'aurora')]));
    for (let seed = 1; seed <= 40; seed++) {
      const s = pickSurprise(strip, seeded(seed), NONE)!;
      expect(s.result.frameId).toBeNull();
      expect(s.picks.length).toBeGreaterThan(0);
    }
  });

  it('copes with an rng that returns exactly 0 or nearly 1', () => {
    expect(pickSurprise(STRIP, () => 0, NONE)).not.toBeNull();
    expect(pickSurprise(STRIP, () => 0.9999999, NONE)).not.toBeNull();
  });
});

describe('canSurprise', () => {
  it(`needs at least ${SURPRISE_MIN_LOOKS} looks, not counting room-mode tiles`, () => {
    const two = buildLookStrip(buildDeck(withWorldLooks([exp('f1', 'border', 'A'), exp('f2', 'border', 'B')])));
    expect(two.length).toBe(4);
    expect(surprisePool(two).length).toBe(2);
    expect(canSurprise(two, NONE)).toBe(false);
    expect(pickSurprise(two, seeded(1), NONE)).toBeNull();
    expect(canSurprise(STRIP, NONE)).toBe(true);
    expect(canSurprise([], NONE)).toBe(false);
  });

  it('hides while the booth is in room mode (a "3D" Frame is on)', () => {
    expect(canSurprise(STRIP, { ...NONE, attachmentId: 'world:f1' })).toBe(false);
  });
});

describe('surpriseAnnouncement', () => {
  it('names what went on, frame first', () => {
    const s = pickSurprise(STRIP, seeded(7), NONE)!;
    const text = surpriseAnnouncement(s);
    expect(text.startsWith(s.picks[0].title)).toBe(true);
    expect(text.split(' + ').length).toBe(s.picks.length);
  });
});
