import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AR_CATEGORIES, DEFAULT_FIT_BY_CATEGORY, HOME_ASSET_DEFAULTS, arOrder, arTour, carousel, categoryStart, demoQrUrl,
  DEFAULT_OPENING, PROP_MIN_SCALE, frameOnBeamy, lookAction, lookFit, lookThumb, nextAr, selectedLooks, smallWindow, stepIntoFrame, toBeamyLook, toggleLook, type HomeLook,
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

  it('gives every frame a real see-through window', () => {
    for (const l of HOME_ASSET_DEFAULTS.arLooks.filter((x) => x.category === 'frame')) {
      const o = l.opening ?? DEFAULT_OPENING;
      expect(l.opening, l.id).toBeDefined();
      expect(o.top, l.id).toBeGreaterThanOrEqual(0);
      expect(o.bottom - o.top, l.id).toBeGreaterThan(0.3);
      expect(o.right - o.left, l.id).toBeGreaterThan(0.3);
      expect(o.bottom, l.id).toBeLessThanOrEqual(1);
      expect(o.right, l.id).toBeLessThanOrEqual(1);
    }
  });

  it('stands the frame on him: inside the box, nothing poking out, his face mid-window', () => {
    const frames = HOME_ASSET_DEFAULTS.arLooks.filter((x) => x.category === 'frame');
    // Beamy as the stage draws him at a phone, a laptop and a tight box; props from none to a tall hat.
    const cases = [
      { x: 195, tip: 470, mouth: 590, heightPx: 270, box: { top: 74, bottom: 836, left: 8, right: 382 } },
      { x: 720, tip: 230, mouth: 470, heightPx: 460, box: { top: 92, bottom: 892, left: 8, right: 1432 } },
      { x: 512, tip: 300, mouth: 450, heightPx: 330, box: { top: 92, bottom: 760, left: 8, right: 1016 } },
    ];
    for (const c of cases) {
      for (const f of frames) {
        for (const liftK of [0, 0.15, 0.5]) {
          const lift = liftK * c.heightPx;
          const r = frameOnBeamy({ ...c, lift, opening: f.opening ?? DEFAULT_OPENING });
          const tag = `${f.id} ${c.x} lift ${liftK}`;
          // 1: the whole frame inside the box.
          expect(r.top, tag).toBeGreaterThanOrEqual(c.box.top - 0.01);
          expect(r.top + r.h, tag).toBeLessThanOrEqual(c.box.bottom + 0.01);
          expect(r.left, tag).toBeGreaterThanOrEqual(c.box.left - 0.01);
          expect(r.left + (r.h * 9) / 16, tag).toBeLessThanOrEqual(c.box.right + 0.01);
          // The prop only ever shrinks, never below the floor.
          expect(r.propScale, tag).toBeGreaterThanOrEqual(PROP_MIN_SCALE);
          expect(r.propScale, tag).toBeLessThanOrEqual(1);
          const shown = lift * r.propScale;
          // 2: never anything above its top edge (whenever the prop is in the box at all).
          if (c.tip - shown >= c.box.top) expect(r.top, tag).toBeLessThanOrEqual(c.tip - shown + 0.01);
          else expect(r.top, tag).toBe(c.box.top);
          // When it fits, the window holds his head and the (shrunk) prop.
          const o = f.opening ?? DEFAULT_OPENING;
          if (r.fits) expect(r.top + o.top * r.h, tag).toBeLessThanOrEqual(c.tip - shown + 0.5);
        }
      }
    }
    // A roomy box and no prop: his face sits in the middle of the window.
    const o = DEFAULT_OPENING;
    const r = frameOnBeamy({ x: 500, tip: 400, mouth: 520, heightPx: 300, lift: 0, opening: o, box: { top: 0, bottom: 2000, left: 0, right: 2000 } });
    expect(r.fits).toBe(true);
    expect(r.top + ((o.top + o.bottom) / 2) * r.h).toBeCloseTo(520 - 18, 0);
    expect(r.left + (r.h * 9) / 32).toBeCloseTo(500, 0);
    expect(r.propScale).toBe(1);
    // A tall hat in a tight box: the frame rises first, then the hat shrinks into the window.
    const tight = { x: 720, tip: 393, mouth: 646, heightPx: 473, opening: HOME_ASSET_DEFAULTS.arLooks[0].opening ?? o, box: { top: 92, bottom: 892, left: 8, right: 1432 } };
    const small = frameOnBeamy({ ...tight, lift: 60 });
    const mid = frameOnBeamy({ ...tight, lift: 170 });
    const tall = frameOnBeamy({ ...tight, lift: 284 });
    expect(small.propScale).toBe(1);
    expect(small.fits).toBe(true);
    expect(mid.propScale).toBeLessThan(1);
    expect(mid.fits).toBe(true);
    // Too tall for this window even shrunk: it keeps its size, cropped by the frame's border,
    // never out of the frame, and his face (eyes to chin) still in the window.
    expect(tall.fits).toBe(false);
    expect(tall.top).toBeLessThanOrEqual(tight.tip - 284 * tall.propScale);
    expect(tall.top + tight.opening.top * tall.h).toBeLessThanOrEqual(tight.mouth - 0.2 * tight.heightPx + 0.5);
    expect(tall.top + tight.opening.bottom * tall.h).toBeGreaterThanOrEqual(tight.mouth + 0.12 * tight.heightPx - 0.5);
  });

  it('calls only the face-oval frames small, and steps him into their window', () => {
    const small = HOME_ASSET_DEFAULTS.arLooks.filter((l) => l.category === 'frame' && l.opening !== undefined && smallWindow(l.opening)).map((l) => l.id).sort();
    // The floral arch's oval was swapped for the wedding monogram (a full-width window).
    expect(small).toEqual(['ar-art-deco']);
    const o = { top: 0.263, bottom: 0.637, left: 0.274, right: 0.73 };
    const box = { top: 391, bottom: 836, left: 8, right: 382 };
    const g = stepIntoFrame({ opening: o, box, mouthAt: 0.49 });
    // The frame takes the whole room under the picker, centred across.
    expect(g.frame.top).toBe(391);
    expect(g.frame.h).toBeCloseTo(445, 5);
    const w = (g.frame.h * 9) / 16;
    expect(g.frame.left + w / 2).toBeCloseTo(195, 5);
    // His face fills the window's width and sits mid-window.
    const winL = g.frame.left + o.left * w;
    const winR = g.frame.left + o.right * w;
    expect(g.stand.heightPx * 0.42).toBeCloseTo(winR - winL, 5);
    expect(g.stand.x).toBeCloseTo((winL + winR) / 2, 5);
    const mouth = g.stand.y - 0.49 * g.stand.heightPx;
    const face = mouth - 0.06 * g.stand.heightPx;
    expect(face).toBeCloseTo(g.frame.top + ((o.top + o.bottom) / 2) * g.frame.h, 5);
    // Eyes to chin stay inside the window.
    expect(mouth - 0.2 * g.stand.heightPx).toBeGreaterThanOrEqual(g.frame.top + o.top * g.frame.h);
    expect(mouth + 0.12 * g.stand.heightPx).toBeLessThanOrEqual(g.frame.top + o.bottom * g.frame.h);
    // A tall thin window: his height is capped by its height instead.
    const thin = stepIntoFrame({ opening: { top: 0.4, bottom: 0.5, left: 0, right: 1 }, box, mouthAt: 0.49 });
    expect(thin.stand.heightPx).toBeCloseTo((0.1 * thin.frame.h) / 0.4, 5);
  });

  it('points the real QR code at the demo event’s guest welcome, tagged', () => {
    expect(demoQrUrl('https://deploy-preview-57--beamwall.netlify.app', 'demo')).toBe('https://deploy-preview-57--beamwall.netlify.app/e/demo/welcome?from=beamy-qr');
    // A dev or http origin cannot be opened from a phone: production instead.
    expect(demoQrUrl('http://localhost:5180', 'demo')).toBe('https://beamwall.app/e/demo/welcome?from=beamy-qr');
    expect(demoQrUrl('https://beamwall.app/', 'a b')).toBe('https://beamwall.app/e/a%20b/welcome?from=beamy-qr');
  });
});
