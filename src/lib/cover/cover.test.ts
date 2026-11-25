import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COVER_FONT_FACES, COVER_SCRIPT_FACE, COVER_TEMPLATES, COVER_TEMPLATE_IDS, COVER_TYPEFACE, COVER_H, COVER_W,
  GARNISH_IDS, defaultCoverTemplateFor, isCoverTemplateId,
} from './templates';
import {
  coverDateFrom, coverExperienceId, coverExperiences, coverTemplateOfId, coverWantsGuestNames, coversConfigPatch, fillCoverText,
  formatCoverDate, joinNames, normalizeCover, normalizeCovers, possessive, removeCover, resolveCover, resolveLine, upsertCover,
  type CoverContext,
} from './spec';

const ROOT = join(__dirname, '..', '..', '..', 'public');
const ctx = (over: Partial<CoverContext> = {}): CoverContext => ({
  eventName: 'Ada & Tunde’s Wedding', honorees: ['Ada', 'Tunde'], date: '2027-06-14', fallbackYear: 2026, ...over,
});

describe('cover templates', () => {
  it('has one cover per major occasion, unique ids', () => {
    expect(COVER_TEMPLATES.length).toBe(12);
    expect(new Set(COVER_TEMPLATE_IDS).size).toBe(12);
    for (const id of ['wedding', 'birthday', 'anniversary', 'retirement', 'corporate', 'launch', 'christmas', 'halloween']) {
      expect(isCoverTemplateId(id)).toBe(true);
    }
  });

  it('never uses a real magazine name as a masthead', () => {
    const real = /\b(VOGUE|ELLE|GQ|TIME|PEOPLE|ESQUIRE|COSMOPOLITAN|HARPER|BAZAAR|GLAMOUR|ALLURE|ESSENCE|EBONY|TATLER|MARIE CLAIRE|VANITY FAIR|INSTYLE|W)\b/;
    for (const t of COVER_TEMPLATES) expect(real.test(t.masthead.text)).toBe(false);
  });

  it('ships every font, typeface and garnish a template names', () => {
    for (const t of COVER_TEMPLATES) {
      for (const f of [...COVER_FONT_FACES[t.masthead.font], ...COVER_FONT_FACES[t.lineFont]]) {
        expect(existsSync(join(ROOT, 'fonts', 'cover', f.file)), f.file).toBe(true);
      }
      const tf = join(ROOT, 'fonts', 'cover', 'typeface', `${COVER_TYPEFACE[t.masthead.font]}.json`);
      expect(existsSync(tf), tf).toBe(true);
      // Every masthead letter is in the extruded typeface.
      const glyphs = (JSON.parse(readFileSync(tf, 'utf8')) as { glyphs: Record<string, unknown> }).glyphs;
      for (const ch of t.masthead.text.replace(/ /g, '')) expect(glyphs[ch], `${t.id} ${ch}`).toBeDefined();
      for (const g of [...t.garnish3d, ...t.garnish2d]) expect(GARNISH_IDS).toContain(g.id);
    }
    expect(existsSync(join(ROOT, 'fonts', 'cover', COVER_SCRIPT_FACE.file))).toBe(true);
    for (const id of GARNISH_IDS) {
      expect(existsSync(join(ROOT, 'models', 'garnish', `${id}.glb`)), id).toBe(true);
      expect(existsSync(join(ROOT, 'models', 'garnish', `${id}.webp`)), `${id}.webp`).toBe(true);
    }
  });

  it('keeps 3D garnishes near the frame (never in the middle, where people stand)', () => {
    for (const t of COVER_TEMPLATES) {
      for (const g of t.garnish3d) {
        const nearSide = Math.abs(g.x) > COVER_W / 2 - 0.3;
        const nearTopOrFloor = g.y > COVER_H - 0.3 || g.y < 0.45;
        expect(nearSide || nearTopOrFloor, `${t.id} ${g.id}`).toBe(true);
        expect(g.size).toBeGreaterThan(0.1);
        expect(g.size).toBeLessThan(1);
      }
      // 2D sprites stay off the clear middle too.
      for (const g of t.garnish2d) expect(g.x < 0.25 || g.x > 0.75 || g.y > 0.82, `${t.id} 2d ${g.id}`).toBe(true);
    }
  });

  it('every template resolves with no names at all (nothing reads "{honorees}")', () => {
    for (const t of COVER_TEMPLATES) {
      const c = resolveCover({ template: t.id }, 'Spring Social', [], new Date(2026, 10, 25));
      const all = [c.masthead, c.issue, c.dateLine, c.star.kicker, c.star.names, c.star.deck,
        ...c.left.flatMap((l) => [l.kicker, l.head, l.deck]), ...c.right.flatMap((l) => [l.kicker, l.head, l.deck])].join(' ');
      expect(all, t.id).not.toMatch(/[{}]/);
      expect(c.left.length + c.right.length, t.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('maps event types to a starting template', () => {
    expect(defaultCoverTemplateFor('wedding')).toBe('wedding');
    expect(defaultCoverTemplateFor('party')).toBe('birthday');
    expect(defaultCoverTemplateFor(null)).toBe('wedding');
  });
});

describe('cover words', () => {
  it('joins names and makes possessives', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Ada'])).toBe('Ada');
    expect(joinNames(['Ada', 'Tunde'])).toBe('Ada & Tunde');
    expect(joinNames(['Ada', 'Tunde', 'Kemi'])).toBe('Ada, Tunde & Kemi');
    expect(possessive('Ada & Tunde')).toBe('Ada & Tunde’s');
    expect(possessive('The Okafors')).toBe('The Okafors’');
    expect(possessive('')).toBe('');
  });

  it('formats the date without a time-zone shift', () => {
    expect(formatCoverDate('2027-06-14')).toBe('June 14, 2027');
    expect(formatCoverDate('2027-01-01T00:00:00Z')).toBe('January 1, 2027');
    expect(formatCoverDate('2027-13-01')).toBeNull();
    expect(formatCoverDate('soon')).toBeNull();
    expect(formatCoverDate(null)).toBeNull();
  });

  it('fills tokens, and says null when one is missing', () => {
    expect(fillCoverText('Guests of {honoreesPossessive} wedding', ctx())).toBe('Guests of Ada & Tunde’s wedding');
    expect(fillCoverText('Class of {year}', ctx())).toBe('Class of 2027');
    expect(fillCoverText('Class of {year}', ctx({ date: null }))).toBe('Class of 2026');
    expect(fillCoverText('At {event}', ctx())).toBe('At Ada & Tunde’s Wedding');
    expect(fillCoverText('Guests of {honoreesPossessive} wedding', ctx({ honorees: [] }))).toBeNull();
    expect(fillCoverText('Keeps {unknown}', ctx())).toBe('Keeps {unknown}');
  });

  it('falls back to a line’s alt, or drops it', () => {
    const line = { kicker: 'Cover story', head: '{honorees} turns 30', alt: { head: 'Thirty, flirty' } };
    expect(resolveLine(line, ctx())).toEqual({ kicker: 'Cover story', head: 'Ada & Tunde turns 30', deck: '' });
    expect(resolveLine(line, ctx({ honorees: [] }))).toEqual({ kicker: '', head: 'Thirty, flirty', deck: '' });
    expect(resolveLine({ head: '{honorees}' }, ctx({ honorees: [] }))).toBeNull();
  });

  it('puts the guests on the cover, else the template’s fallback', () => {
    const s = { template: 'wedding' as const, honorees: ['Ada', 'Tunde'] };
    const withGuests = resolveCover(s, 'The Wedding', ['Bola', 'Chi'], new Date(2026, 0, 1));
    expect(withGuests.star.names).toBe('Bola & Chi');
    expect(withGuests.star.deck).toBe('Guests of Ada & Tunde’s wedding');
    const none = resolveCover({ template: 'wedding' }, 'The Wedding', ['  '], new Date(2026, 0, 1));
    expect(none.star.names).toBe('The Guest List');
    expect(none.star.deck).toBe('Guests of The Wedding');
  });

  it('uses the host’s title (upper-cased) and headline', () => {
    const c = resolveCover({ template: 'wedding', title: 'Mr & Mrs', headline: 'Finally!' }, 'X', []);
    expect(c.masthead).toBe('MR & MRS');
    expect(c.left[0].head).toBe('Finally!');
    expect(c.left[0].kicker).toBe('Exclusive');
  });

  it('prints the date, else the event name, under the masthead', () => {
    expect(resolveCover({ template: 'gala', date: '2027-03-02' }, 'Hope Gala', []).dateLine).toBe('March 2, 2027');
    expect(resolveCover({ template: 'gala' }, ' Hope Gala ', []).dateLine).toBe('Hope Gala');
  });
});

describe('cover settings', () => {
  it('normalizes one cover', () => {
    expect(normalizeCover(null)).toBeNull();
    expect(normalizeCover({ template: 'vogue' })).toBeNull();
    expect(normalizeCover({ template: 'wedding' })).toEqual({ template: 'wedding' });
    expect(normalizeCover({
      template: 'wedding', title: '  Amour   Toujours forever ', honorees: ['Ada', '', 7, 'Tunde', 'Kemi', 'Extra'],
      headline: 'x'.repeat(80), date: '2027-06-14', guestNames: false, junk: 1,
    })).toEqual({
      template: 'wedding', title: 'Amour Toujours f', honorees: ['Ada', 'Tunde', 'Kemi'],
      headline: 'x'.repeat(48), date: '2027-06-14', guestNames: false,
    });
    expect(normalizeCover({ template: 'wedding', date: 'June' })).toEqual({ template: 'wedding' });
    expect(normalizeCover({ template: 'wedding', title: 'Mariba & Phil' })).toEqual({ template: 'wedding', title: 'Mariba & Phil' });
  });

  it('keeps one cover per template, in order', () => {
    expect(normalizeCovers(undefined)).toEqual([]);
    expect(normalizeCovers({ template: 'wedding' })).toEqual([]);
    expect(normalizeCovers([{ template: 'gala' }, { template: 'wedding' }, { template: 'gala', title: 'B' }, 'x'])
      .map((c) => c.template)).toEqual(['gala', 'wedding']);
  });

  it('asks for guest names unless the host turned it off', () => {
    expect(coverWantsGuestNames({ template: 'wedding' })).toBe(true);
    expect(coverWantsGuestNames({ template: 'wedding', guestNames: false })).toBe(false);
    expect(coverWantsGuestNames(null)).toBe(false);
  });
});

describe('cover catalog', () => {
  it('makes one Frame per cover whose art is ready', () => {
    const exps = coverExperiences([{ template: 'wedding' }, { template: 'gala' }], { wedding: 'blob:a' });
    expect(exps).toHaveLength(1);
    expect(exps[0]).toMatchObject({ id: 'builtin:cover:wedding', kind: 'border', asset_url: 'blob:a', name: 'Wedding cover', is_published: true });
  });

  it('reads the template back from a Frame id or its 3D tile', () => {
    expect(coverTemplateOfId(coverExperienceId('gala'))).toBe('gala');
    expect(coverTemplateOfId('world:builtin:cover:gala')).toBe('gala');
    expect(coverTemplateOfId('builtin:cover:nope')).toBeNull();
    expect(coverTemplateOfId('builtin:border:gold')).toBeNull();
    expect(coverTemplateOfId(null)).toBeNull();
  });
});

describe('cover host edits', () => {
  it('adds, replaces in place and removes covers', () => {
    let list = upsertCover([], { template: 'wedding' });
    list = upsertCover(list, { template: 'gala', title: 'Gala' });
    list = upsertCover(list, { template: 'wedding', honorees: ['Ada'] });
    expect(list).toEqual([{ template: 'wedding', honorees: ['Ada'] }, { template: 'gala', title: 'Gala' }]);
    expect(removeCover(list, 'wedding')).toEqual([{ template: 'gala', title: 'Gala' }]);
    expect(upsertCover(list, { template: 'nope' } as never)).toEqual(list);
  });

  it('patches arContent without losing the rest of it', () => {
    const cfg = { arContent: { borderIds: ['a'], framePalette: { accent: '#fff' } }, name: 'x' };
    expect(coversConfigPatch(cfg, [{ template: 'gala' }])).toEqual({
      arContent: { borderIds: ['a'], framePalette: { accent: '#fff' }, covers: [{ template: 'gala' }] },
    });
    expect(coversConfigPatch({ arContent: { borderIds: ['a'], covers: [{ template: 'gala' }] } }, [])).toEqual({ arContent: { borderIds: ['a'] } });
    expect(coversConfigPatch(null, [])).toEqual({ arContent: {} });
  });

  it('reads the event day from starts_at', () => {
    expect(coverDateFrom('2027-06-14T18:00:00+00:00')).toBe('2027-06-14');
    expect(coverDateFrom(null)).toBeUndefined();
    expect(coverDateFrom('tbd')).toBeUndefined();
  });
});
