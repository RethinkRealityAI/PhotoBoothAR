import { describe, it, expect } from 'vitest';
import {
  colorFamily, libraryTags, isListed, matchScore, rankLibrary, recommendedFor, frameSuggestion,
} from './libraryMatch';
import { frameBriefGaps } from './assetBrief';

describe('colorFamily', () => {
  it.each([
    ['#D4AF37', 'gold'], ['#FFD700', 'gold'], ['#DAA520', 'gold'],
    ['#FF0000', 'red'], ['#B22222', 'red'],
    ['#FFA500', 'orange'], ['#FFFF00', 'yellow'],
    ['#50C878', 'green'], ['#00FF00', 'green'],
    ['#008080', 'teal'], ['#000080', 'blue'], ['#0000FF', 'blue'],
    ['#8A2BE2', 'purple'], ['#800080', 'purple'],
    ['#FF69B4', 'pink'], ['#FFC0CB', 'pink'], ['#FF1493', 'pink'],
    ['#000000', 'dark'], ['#0B0B12', 'dark'], ['#2A2A2A', 'dark'],
    ['#FFFFFF', 'light'], ['#FBF3D9', 'light'], ['#E6E6FA', 'light'],
    ['#808080', 'neutral'], ['#9A9A9F', 'neutral'],
  ])('%s -> %s', (hex, fam) => {
    expect(colorFamily(hex)).toBe(fam);
  });

  it('accepts #rgb and a missing #', () => {
    expect(colorFamily('#f00')).toBe('red');
    expect(colorFamily('D4AF37')).toBe('gold');
  });

  it('returns null for anything that is not a hex colour', () => {
    for (const v of ['', 'gold', '#12', '#GGGGGG', null, undefined, 'rgb(1,2,3)']) {
      expect(colorFamily(v as string | null | undefined)).toBeNull();
    }
  });
});

describe('libraryTags / isListed', () => {
  it('reads occasions, colours (names or hexes) and styles, lower-cased and de-duplicated', () => {
    const t = libraryTags({
      library: { tags: { occasions: ['Wedding'], colors: ['gold', '#D4AF37', 'Navy?', '#000080'], styles: ['Elegant'] } },
    });
    expect(t).toEqual({ occasions: ['wedding'], colors: ['gold', 'blue'], styles: ['elegant'] });
  });

  it('never crashes on missing or malformed tags', () => {
    const bad: unknown[] = [
      undefined, null, 1, 'x', {}, { library: null }, { library: [] }, { library: { tags: 'x' } },
      { library: { tags: { occasions: 'wedding', colors: [1, null], styles: {} } } },
    ];
    for (const cfg of bad) expect(libraryTags(cfg)).toBeNull();
  });

  it('lists everything except an explicit listed:false', () => {
    expect(isListed(undefined)).toBe(true);
    expect(isListed({})).toBe(true);
    expect(isListed({ library: { listed: true } })).toBe(true);
    expect(isListed({ library: {} })).toBe(true);
    expect(isListed({ library: { listed: 'false' } })).toBe(true);
    expect(isListed({ library: { listed: false } })).toBe(false);
  });
});

const item = (id: string, tags?: Record<string, unknown>) => ({
  id,
  config: tags === undefined ? {} : { library: { tags } },
});

describe('rankLibrary', () => {
  const ctx = { eventType: 'wedding', accentHex: '#D4AF37' };

  it('scores occasion 2 and colour 1', () => {
    expect(matchScore(item('a', { occasions: ['wedding'], colors: ['gold'] }).config, ctx)).toBe(3);
    expect(matchScore(item('b', { occasions: ['wedding'] }).config, ctx)).toBe(2);
    expect(matchScore(item('c', { colors: ['gold'] }).config, ctx)).toBe(1);
    expect(matchScore(item('d', { occasions: ['gala'] }).config, ctx)).toBe(0);
    expect(matchScore(item('e').config, ctx)).toBe(0);
  });

  it('orders by score, then tagged before untagged, then incoming order', () => {
    const items = [
      item('untagged-1'),
      item('colour', { colors: ['gold'] }),
      item('gala', { occasions: ['gala'] }),
      item('both', { occasions: ['wedding'], colors: ['#FFD700'] }),
      item('untagged-2'),
      item('occasion', { occasions: ['wedding'] }),
      item('gala-2', { occasions: ['gala'] }),
    ];
    expect(rankLibrary(items, ctx).map((i) => i.id)).toEqual([
      'both', 'occasion', 'colour', 'gala', 'gala-2', 'untagged-1', 'untagged-2',
    ]);
  });

  it('keeps incoming order when nothing matches, and does not mutate its input', () => {
    const items = [item('a'), item('b', { styles: ['x'] }), item('c')];
    const copy = [...items];
    expect(rankLibrary(items, { eventType: null, accentHex: null }).map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(items).toEqual(copy);
  });

  it('recommends only items that match something, capped', () => {
    const items = [item('a'), item('b', { occasions: ['wedding'] }), item('c', { colors: ['gold'] }), item('d', { occasions: ['gala'] })];
    expect(recommendedFor(items, ctx).map((i) => i.id)).toEqual(['b', 'c']);
    expect(recommendedFor(items, ctx, 1).map((i) => i.id)).toEqual(['b']);
    expect(recommendedFor([], ctx)).toEqual([]);
  });

  it('tolerates items with no config at all', () => {
    const items: { id: string; config?: unknown }[] = [{ id: 'x' }];
    expect(rankLibrary(items, ctx)).toHaveLength(1);
  });
});

describe('frameSuggestion', () => {
  it('names a colour and a style so the brief hint starts satisfied', () => {
    for (const eventType of ['wedding', 'gala', 'birthday', 'corporate', 'party', 'remote', null, 'unknown']) {
      for (const accentHex of ['#D4AF37', '#000080', '#FFC0CB', '#808080', '#000000', '#FFFFFF', null, 'nope']) {
        const s = frameSuggestion({ eventName: 'Maya & Sam', eventType, accentHex });
        expect(frameBriefGaps(s), `${eventType} ${accentHex}: ${s}`).toEqual([]);
        expect(s.length).toBeLessThanOrEqual(400);
      }
    }
  });

  it('prefers the brief palette and tone when the host wrote one', () => {
    const s = frameSuggestion({
      eventName: 'X', eventType: 'wedding', accentHex: '#D4AF37', palette: 'sage and blush', tone: 'romantic',
    });
    expect(s).toContain('sage and blush');
    expect(s).toContain('romantic');
  });

  it('works without an event name', () => {
    expect(frameSuggestion({ eventName: '  ', eventType: 'gala', accentHex: '#D4AF37' })).not.toContain('“');
  });
});
