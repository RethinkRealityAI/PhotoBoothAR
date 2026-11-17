import { describe, it, expect } from 'vitest';
import {
  colorFamily, libraryTags, isListed, matchScore, rankLibrary, recommendedFor, frameSuggestion,
  libraryCollection, collectionLabel, eventMonth, activeCollections, libraryShelves, capShelves,
  isThumbnailSrc, libraryKindLabel, boothTabOf,
} from './libraryMatch';
import { LIBRARY_COLORS } from './libraryPublish';
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

describe('publish colour vocabulary', () => {
  it('every colour an admin can tag with resolves to a family', () => {
    for (const c of LIBRARY_COLORS) {
      expect(libraryTags({ library: { tags: { colors: [c] } } }), c).not.toBeNull();
    }
  });

  it('black / white / silver tags match dark / light / grey events', () => {
    expect(matchScore({ library: { tags: { colors: ['black'] } } }, { accentHex: '#0B0B12' })).toBe(1);
    expect(matchScore({ library: { tags: { colors: ['white'] } } }, { accentHex: '#FFFFFF' })).toBe(1);
    expect(matchScore({ library: { tags: { colors: ['silver'] } } }, { accentHex: '#808080' })).toBe(1);
  });
});

const xmas = (id: string, tags?: Record<string, unknown>) => ({
  id,
  config: { library: { collection: 'christmas', starterId: id, ...(tags ? { tags } : {}) } },
});

describe('collections', () => {
  it('reads the collection id, lower-cased; null when absent or malformed', () => {
    expect(libraryCollection({ library: { collection: ' Christmas ' } })).toBe('christmas');
    for (const c of [undefined, {}, { library: {} }, { library: { collection: 3 } }, { library: { collection: '  ' } }]) {
      expect(libraryCollection(c)).toBeNull();
    }
  });

  it('labels known seasons from the table and title-cases the rest', () => {
    expect(collectionLabel('christmas')).toBe('Christmas');
    expect(collectionLabel('summer-garden')).toBe('Summer Garden');
  });

  it.each([
    ['2026-12-31', 12], ['2026-01-31', 1], ['2026-12-01', 12],
    ['2026-12-15T12:00:00Z', 12], ['', null], ['nope', null], [null, null], ['2026-13-01', null],
  ])('eventMonth(%s) = %s', (d, m) => {
    expect(eventMonth(d as string | null)).toBe(m);
  });

  it('a Christmas word in the event text, or a December date, activates the season', () => {
    expect(activeCollections({ text: 'Acme Xmas party' })).toEqual(['christmas']);
    expect(activeCollections({ text: 'The Festive Ball' })).toEqual(['christmas']);
    expect(activeCollections({ text: 'Santa’s grotto' })).toEqual(['christmas']);
    expect(activeCollections({ date: '2026-12-19' })).toEqual(['christmas']);
    expect(activeCollections({ text: 'Spooky night', date: '2026-10-31' })).toEqual(['halloween']);
  });

  it('does not fire on a word that merely contains a keyword, or with nothing to go on', () => {
    expect(activeCollections({ text: 'Santana tribute night' })).toEqual([]);
    expect(activeCollections({ text: 'Summer wedding', date: '2026-07-04' })).toEqual([]);
    expect(activeCollections({})).toEqual([]);
  });
});

describe('libraryShelves', () => {
  const plain = (id: string, tags?: Record<string, unknown>) => item(id, tags);

  it('no items -> no shelves (the create screen renders nothing)', () => {
    expect(libraryShelves([], { eventType: 'party', text: 'Christmas party' })).toEqual([]);
  });

  it('puts a fitting season first under its heading, ranked inside', () => {
    const items = [plain('wed', { occasions: ['party'] }), xmas('elf'), xmas('santa', { occasions: ['party'] }), plain('x')];
    const shelves = libraryShelves(items, { eventType: 'party', text: 'Office Christmas party' });
    expect(shelves.map((s) => [s.label, s.items.map((i) => i.id)])).toEqual([
      ['Christmas', ['santa', 'elf']],
      [null, ['wed', 'x']],
    ]);
  });

  it('out of season the collection ranks with everything else, unheaded', () => {
    const items = [xmas('elf'), plain('party', { occasions: ['party'] })];
    const shelves = libraryShelves(items, { eventType: 'party', text: 'Summer party', date: '2026-07-01' });
    expect(shelves).toHaveLength(1);
    expect(shelves[0].label).toBeNull();
    expect(shelves[0].items.map((i) => i.id)).toEqual(['party', 'elf']);
  });

  it('drops unlisted items and never mutates its input', () => {
    const items = [xmas('a'), { id: 'gone', config: { library: { listed: false, collection: 'christmas' } } }];
    const copy = JSON.stringify(items);
    const shelves = libraryShelves(items, { date: '2026-12-24' });
    expect(shelves.flatMap((s) => s.items.map((i) => i.id))).toEqual(['a']);
    expect(JSON.stringify(items)).toBe(copy);
  });

  it('keeps an unlisted look the event already uses, so it can be switched off', () => {
    const items = [xmas('a'), { id: 'retired', config: { library: { listed: false } } }];
    const ids = libraryShelves(items, {}, new Set(['retired'])).flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(['a', 'retired']);
  });

  it('caps across shelves and reports how many were cut', () => {
    const s = (n: number, label: string | null) => ({ id: label, label, items: Array.from({ length: n }, (_, i) => `${label}-${i}`) });
    expect(capShelves([], 6)).toEqual({ shelves: [], hidden: 0 });
    const a = capShelves([s(4, 'Christmas'), s(3, null)], 6);
    expect(a.shelves.map((x) => x.items.length)).toEqual([4, 2]);
    expect(a.hidden).toBe(1);
    expect(capShelves([s(7, null)], 6).hidden).toBe(1);
    expect(capShelves([s(2, 'a'), s(1, null)], 6)).toEqual({ shelves: [s(2, 'a'), s(1, null)], hidden: 0 });
    const fifty = capShelves([s(7, 'Christmas'), s(43, null)], 6);
    expect(fifty.shelves).toHaveLength(1);
    expect(fifty.hidden).toBe(44);
  });
});

describe('isThumbnailSrc', () => {
  it('accepts http(s), data: and same-origin absolute paths', () => {
    for (const u of ['https://x.supabase.co/storage/v1/object/public/assets/a.png', 'http://localhost/a.png', 'data:image/svg+xml;utf8,<svg/>', '/starters/santa-claus.webp', '/guides/frames/thumbs/a.png']) {
      expect(isThumbnailSrc(u), u).toBe(true);
    }
  });

  it('rejects protocol-relative, relative, scripted and empty values', () => {
    for (const u of ['//evil.example/a.png', '/\\evil.example/a.png', 'starters/a.webp', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', '', '/', ' /a.png', null, undefined, 3]) {
      expect(isThumbnailSrc(u), String(u)).toBe(false);
    }
  });
});

describe('libraryKindLabel / boothTabOf', () => {
  it('speaks plainly, and says what a combined look holds', () => {
    expect(libraryKindLabel({ kind: 'border' })).toBe('Frame');
    expect(libraryKindLabel({ kind: 'shader' })).toBe('Filter');
    expect(libraryKindLabel({ kind: '3d_attachment' })).toBe('3D prop');
    expect(libraryKindLabel({ kind: 'composite', asset_url: 'data:image/svg+xml,<svg/>', config: { layers: [{ kind: '3d_attachment' }] } })).toBe('Frame + 3D props');
    expect(libraryKindLabel({ kind: 'composite', config: { layers: [{ kind: '3d_attachment' }] } })).toBe('3D props');
    expect(libraryKindLabel({ kind: 'composite', config: null })).toBe('Full look');
    expect(libraryKindLabel({ kind: 'weird' })).toBe('Look');
  });

  it('a combined look joins the Frames tab, like the booth picker', () => {
    expect(boothTabOf('composite')).toBe('frames');
    expect(boothTabOf('border')).toBe('frames');
    expect(boothTabOf('shader')).toBe('filters');
    expect(boothTabOf('3d_attachment')).toBe('props');
    expect(boothTabOf('nope')).toBeNull();
  });
});
