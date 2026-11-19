import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AR_CATEGORIES, DEFAULT_FIT_BY_CATEGORY, HOME_ASSET_DEFAULTS, arOrder, arTour, carousel, categoryStart, demoQrUrl,
  lookAction, lookFit, lookThumb, nextAr, selectedLooks, toBeamyLook, toggleLook, type HomeLook,
} from './beamyAssets';
import { BEAMY_LOOKS } from './beamyLooks';
import { EMOJI_RE } from './brandLanding';

const pub = (u: string) => resolve(__dirname, '../../public', `.${u}`);

describe('beamyAssets', () => {
  it('has the override contract’s shape with stable, unique ids', () => {
    const d = HOME_ASSET_DEFAULTS;
    expect(Object.keys(d.films).sort()).toEqual(['booth', 'cards', 'challenges', 'wall']);
    const ids = [...d.heroLooks, ...d.arLooks].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(d.demoEventSlug).toBe('demo');
    expect(d.sceneProps.length).toBeGreaterThan(0);
    for (const u of d.sceneProps) expect(existsSync(pub(u)), u).toBe(true);
  });

  it('gives the AR step every category, none of the hero’s looks, and real files', () => {
    const hero = new Set(HOME_ASSET_DEFAULTS.heroLooks.map((l) => l.url));
    for (const c of AR_CATEGORIES) expect(HOME_ASSET_DEFAULTS.arLooks.some((l) => l.category === c.id), c.id).toBe(true);
    expect(HOME_ASSET_DEFAULTS.arLooks.filter((l) => l.category === 'frame').length).toBeGreaterThanOrEqual(4);
    for (const l of HOME_ASSET_DEFAULTS.arLooks) {
      expect(hero.has(l.url), l.id).toBe(false);
      expect(lookAction(l).kind, l.id).not.toBe('none');
      if (l.category === 'frame' || l.category === 'prop') {
        expect(existsSync(pub(l.url)), l.url).toBe(true);
        const t = lookThumb(l);
        expect(t, l.id).not.toBeNull();
        expect(existsSync(pub(String(t))), String(t)).toBe(true);
      }
      expect(l.name, l.name).not.toMatch(EMOJI_RE);
      expect(l.name.length, l.name).toBeLessThanOrEqual(22);
    }
  });

  it('keeps the hero tour exactly the hero looks, after the greeting', () => {
    expect(BEAMY_LOOKS.slice(1).map((l) => l.id)).toEqual(HOME_ASSET_DEFAULTS.heroLooks.map((l) => l.id));
    expect(BEAMY_LOOKS.slice(1).every((l) => l.kind === 'prop' || l.kind === 'frame')).toBe(true);
  });

  it('falls back to the category’s fit when a look names none', () => {
    const bare: HomeLook = { id: 'x', name: 'X', category: 'prop', url: '/models/props/elf-hat.glb' };
    expect(lookFit(bare)).toEqual(DEFAULT_FIT_BY_CATEGORY.prop);
    const own: HomeLook = { ...bare, fit: { width: 1, at: [0, 0, 0], align: 'centre' } };
    expect(lookFit(own).width).toBe(1);
    for (const c of AR_CATEGORIES) expect(DEFAULT_FIT_BY_CATEGORY[c.id].width).toBeGreaterThan(0);
    expect(toBeamyLook(bare).fit).toEqual(DEFAULT_FIT_BY_CATEGORY.prop);
  });

  it('parses built-ins and rejects malformed ones without throwing', () => {
    const f = (category: HomeLook['category'], url: string): HomeLook => ({ id: 'a', name: 'A', category, url });
    expect(lookAction(f('filter', 'tint:#34D399'))).toEqual({ kind: 'tint', color: '#34D399' });
    expect(lookAction(f('filter', 'tint:prismatic'))).toEqual({ kind: 'tint', color: 'prismatic' });
    expect(lookAction(f('filter', 'tint:red; background:url(x)')).kind).toBe('none');
    // An override's picture/clip (what the CMS stores for filters and effects) shows on its tile.
    expect(lookAction(f('filter', '/x.png'))).toEqual({ kind: 'media', url: '/x.png' });
    expect(lookAction(f('effect', 'https://cdn.example/fx.mp4')).kind).toBe('media');
    expect(lookAction(f('effect', 'javascript:alert(1)')).kind).toBe('none');
    expect(lookAction(f('effect', 'fx:beam'))).toEqual({ kind: 'fx', fx: 'beam' });
    expect(lookAction(f('effect', 'fx:explode')).kind).toBe('none');
    expect(lookAction(f('frame', '')).kind).toBe('none');
    expect(lookAction(f('frame', '/guides/frames/nye-countdown.png')).kind).toBe('frame');
    expect(toBeamyLook(f('effect', 'fx:beam')).kind).toBe('none');
  });

  it('orders the picker by category and auto-advances with a wrap', () => {
    const o = arOrder(HOME_ASSET_DEFAULTS.arLooks);
    expect(o.length).toBe(HOME_ASSET_DEFAULTS.arLooks.length);
    const cats = o.map((l) => l.category);
    expect(cats.indexOf('frame')).toBe(0);
    for (let k = 1; k < cats.length; k++) {
      expect(AR_CATEGORIES.findIndex((c) => c.id === cats[k])).toBeGreaterThanOrEqual(AR_CATEGORIES.findIndex((c) => c.id === cats[k - 1]));
    }
    expect(categoryStart(o, 'prop')).toBe(cats.indexOf('prop'));
    expect(categoryStart([], 'prop')).toBe(-1);
    expect(nextAr(o.length - 1, o.length)).toBe(0);
    expect(nextAr(0, 0)).toBe(0);
  });

  it('lays out the frames carousel around the current frame, wrapping', () => {
    expect(carousel(0, 6)).toEqual({ prev: 5, next: 1, after: 2 });
    expect(carousel(5, 6)).toEqual({ prev: 4, next: 0, after: 1 });
    expect(carousel(0, 3)).toEqual({ prev: 2, next: 1, after: null });
    expect(carousel(0, 2)).toEqual({ prev: null, next: 1, after: null });
    expect(carousel(0, 1)).toEqual({ prev: null, next: null, after: null });
  });

  it('wears one look per category, combined, and a second tap takes it off', () => {
    const o = arOrder(HOME_ASSET_DEFAULTS.arLooks);
    const first = (c: HomeLook['category'], k = 0) => o.filter((l) => l.category === c)[k];
    let sel = toggleLook({}, first('frame'));
    sel = toggleLook(sel, first('prop'));
    sel = toggleLook(sel, first('filter'));
    sel = toggleLook(sel, first('effect'));
    expect(selectedLooks(sel, o).map((l) => l.category)).toEqual(['frame', 'prop', 'filter', 'effect']);
    // Another pick in the same category replaces it, never stacks two.
    sel = toggleLook(sel, first('prop', 1));
    expect(sel.prop).toBe(first('prop', 1).id);
    expect(selectedLooks(sel, o).filter((l) => l.category === 'prop')).toHaveLength(1);
    // A tap on what he is wearing takes it off; the others stay on.
    sel = toggleLook(sel, first('frame'));
    expect(sel.frame).toBeUndefined();
    expect(selectedLooks(sel, o).map((l) => l.category)).toEqual(['prop', 'filter', 'effect']);
    // Pure: the input selection is never changed.
    const before = { frame: first('frame').id };
    toggleLook(before, first('frame'));
    expect(before).toEqual({ frame: first('frame').id });
    // Stale or mis-filed ids are dropped.
    expect(selectedLooks({ frame: 'gone', prop: first('frame').id }, o)).toEqual([]);
  });

  it('tours by building a look up one category at a time, then a fresh one', () => {
    const o = arOrder(HOME_ASSET_DEFAULTS.arLooks);
    const cats = (k: number) => Object.keys(arTour(k, o).sel).sort();
    expect(arTour(0, o).tab).toBe('frame');
    expect(cats(0)).toEqual(['frame']);
    expect(cats(1)).toEqual(['frame', 'prop']);
    expect(cats(2)).toEqual(['filter', 'frame', 'prop']);
    expect(cats(3)).toEqual(['effect', 'filter', 'frame', 'prop']);
    expect(arTour(3, o).tab).toBe('effect');
    // The next round starts over with each category's next item.
    expect(cats(4)).toEqual(['frame']);
    expect(arTour(4, o).sel.frame).toBe(o.filter((l) => l.category === 'frame')[1].id);
    expect(arTour(4, o).sel.frame).not.toBe(arTour(0, o).sel.frame);
    // Every step is a valid selection (one look per category, all real).
    for (let k = 0; k < 40; k++) {
      const t = arTour(k, o);
      expect(selectedLooks(t.sel, o)).toHaveLength(Object.keys(t.sel).length);
      expect(t.sel[t.tab]).toBeDefined();
    }
    expect(arTour(0, [])).toEqual({ sel: {}, tab: 'frame' });
    expect(arTour(-3, o)).toEqual(arTour(0, o));
  });

  it('points the real QR code at the demo event’s guest welcome, tagged', () => {
    expect(demoQrUrl('https://deploy-preview-57--beamwall.netlify.app', 'demo')).toBe('https://deploy-preview-57--beamwall.netlify.app/e/demo/welcome?from=beamy-qr');
    // A dev or http origin cannot be opened from a phone: production instead.
    expect(demoQrUrl('http://localhost:5180', 'demo')).toBe('https://beamwall.app/e/demo/welcome?from=beamy-qr');
    expect(demoQrUrl('https://beamwall.app/', 'a b')).toBe('https://beamwall.app/e/a%20b/welcome?from=beamy-qr');
  });
});
