import { describe, it, expect } from 'vitest';
import {
  activeOptionId,
  buildDeck,
  initialCategory,
  isPristine,
  sectionHasSelection,
  shortLabel,
  type DeckSelection,
} from './boothDeck';
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
  exp('f1', 'border', 'Gold Border'),
  exp('f2', '2d_filter', 'Art Deco'),
  exp('c1', 'composite', 'Neon Scene'),
  exp('p1', '3d_attachment', 'Queen Tiara'),
];

describe('buildDeck', () => {
  it('splits the catalog into effect, frame and 3D', () => {
    const deck = buildDeck(CATALOG);
    expect(deck.map((s) => s.key)).toEqual(['effect', 'frame', 'prop']);
    expect(deck[0].options.map((o) => o.exp.id)).toEqual(['s1', 's2']);
    expect(deck[2].options.map((o) => o.exp.id)).toEqual(['p1']);
  });

  it('files a composite scene under Frame, matching how the booth applies it', () => {
    // handleSelectFrame applies a composite's frame+3D+filter slots together,
    // so it must be reachable from the Frame tab.
    const frame = buildDeck(CATALOG).find((s) => s.key === 'frame');
    expect(frame?.options.map((o) => o.exp.id)).toContain('c1');
  });

  it('drops empty categories rather than showing a tab that leads nowhere', () => {
    const deck = buildDeck([exp('f1', 'border', 'Gold Border')]);
    expect(deck.map((s) => s.key)).toEqual(['frame']);
  });

  it('returns nothing for an empty catalog', () => {
    expect(buildDeck([])).toEqual([]);
  });
});

describe('activeOptionId', () => {
  it('matches an effect on its shader id, not its experience id', () => {
    // The booth stores the active SHADER; two catalog rows can carry the same one.
    const effect = buildDeck(CATALOG)[0];
    expect(activeOptionId(effect, { ...NONE, effectId: 'aurora-lumina' })).toBe('s2');
  });

  it('reports no effect when the shader is none', () => {
    const effect = buildDeck(CATALOG)[0];
    expect(activeOptionId(effect, NONE)).toBeNull();
  });

  it('reports null for a shader that is not in the catalog', () => {
    const effect = buildDeck(CATALOG)[0];
    expect(activeOptionId(effect, { ...NONE, effectId: 'deleted-shader' })).toBeNull();
  });

  it('matches frames and props on experience id', () => {
    const deck = buildDeck(CATALOG);
    expect(activeOptionId(deck[1], { ...NONE, frameId: 'c1' })).toBe('c1');
    expect(activeOptionId(deck[2], { ...NONE, attachmentId: 'p1' })).toBe('p1');
  });
});

describe('sectionHasSelection', () => {
  it('is true only for the category holding the selection', () => {
    const deck = buildDeck(CATALOG);
    const sel = { ...NONE, frameId: 'f1' };
    expect(deck.map((s) => sectionHasSelection(s, sel))).toEqual([false, true, false]);
  });
});

describe('initialCategory', () => {
  it('opens on whatever is already applied, so an /experience/:id link lands on it', () => {
    const deck = buildDeck(CATALOG);
    expect(initialCategory(deck, { ...NONE, attachmentId: 'p1' })).toBe('prop');
  });

  it('falls back to the first category when nothing is applied', () => {
    expect(initialCategory(buildDeck(CATALOG), NONE)).toBe('effect');
  });

  it('returns null when the event has no experiences at all', () => {
    expect(initialCategory([], NONE)).toBeNull();
  });
});

describe('isPristine', () => {
  it('is true only when nothing at all is applied', () => {
    expect(isPristine(NONE, false)).toBe(true);
    expect(isPristine(NONE, true)).toBe(false);
    expect(isPristine({ ...NONE, effectId: 'aurora-lumina' }, false)).toBe(false);
    expect(isPristine({ ...NONE, frameId: 'f1' }, false)).toBe(false);
    expect(isPristine({ ...NONE, attachmentId: 'p1' }, false)).toBe(false);
  });
});

describe('shortLabel', () => {
  it('keeps the first word, because orbs are 48px wide', () => {
    expect(shortLabel('Prismatic Holo')).toBe('Prismatic');
  });

  it('truncates a long single word instead of overflowing', () => {
    expect(shortLabel('Kaleidoscopic')).toBe('Kaleidos…');
  });

  it('survives an empty name', () => {
    expect(shortLabel('   ')).toBe('');
  });
});
