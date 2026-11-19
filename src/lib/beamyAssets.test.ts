import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AR_CATEGORIES, AR_NOUN, DEFAULT_FIT_BY_CATEGORY, HOME_ASSET_DEFAULTS, NONE_TITLE, arOrder, arStopIndex, arStops, arTitle, arTour, carousel, categoryStart, demoQrUrl, wearStop,
  DEFAULT_OPENING, PROP_MIN_SCALE, frameOnBeamy, lookAction, lookFit, lookThumb, nextAr, selectedLooks, smallWindow, standInFrame, stepIntoFrame, BODY_W, toBeamyLook, toggleLook, type HomeLook,
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

  it('keeps the hero tour exactly the hero looks', () => {
    expect(BEAMY_LOOKS.map((l) => l.id)).toEqual(HOME_ASSET_DEFAULTS.heroLooks.map((l) => l.id));
    expect(BEAMY_LOOKS.every((l) => l.kind === 'prop' || l.kind === 'frame')).toBe(true);
  });

  it('wears a frame’s `with` prop along with it, fitted like a prop', () => {
    const holiday: HomeLook = { id: 'h', name: 'H', category: 'frame', url: '/guides/frames/christmas-santa-cover.png', with: '/models/props/reindeer-antlers.glb' };
    const b = toBeamyLook(holiday);
    expect(b.kind).toBe('frame');
    expect(b.prop).toEqual({ url: '/models/props/reindeer-antlers.glb', fit: DEFAULT_FIT_BY_CATEGORY.prop });
    expect(b.opening).toEqual(DEFAULT_OPENING);
    // Only a GLB rides along; no `with`, no prop.
    expect(toBeamyLook({ ...holiday, with: '/x.png' }).prop).toBeUndefined();
    expect(toBeamyLook({ ...holiday, with: undefined }).prop).toBeUndefined();
  });

  it('decorates the hero with full-colour props only (no material-less GLBs)', () => {
    // royal-crown / queens-tiara / halo-ring ship with no material: three
    // draws them in its default grey. The owner: "make them proper nice assets".
    for (const u of HOME_ASSET_DEFAULTS.sceneProps) {
      expect(u, u).not.toMatch(/royal-crown|queens-tiara|halo-ring/);
      // Read the GLB's JSON chunk: it must carry a material of its own.
      const glb = readFileSync(pub(u));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as { materials?: unknown[] };
      expect(json.materials?.length ?? 0, u).toBeGreaterThan(0);
    }
    for (const l of [...HOME_ASSET_DEFAULTS.heroLooks, ...HOME_ASSET_DEFAULTS.arLooks]) expect(l.url, l.id).not.toMatch(/royal-crown|queens-tiara|halo-ring/);
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

  it('gives every category a carousel that starts on a None stop', () => {
    const o = arOrder(HOME_ASSET_DEFAULTS.arLooks);
    for (const c of AR_CATEGORIES) {
      const stops = arStops(o, c.id);
      expect(stops[0], c.id).toBeNull();
      expect(stops.slice(1).every((l) => l !== null && l.category === c.id), c.id).toBe(true);
      expect(stops.length, c.id).toBe(o.filter((l) => l.category === c.id).length + 1);
      expect(arStopIndex({}, o, c.id), c.id).toBe(0);
      expect(arTitle(c.id, null), c.id).toBe(NONE_TITLE[c.id]);
      expect(AR_NOUN[c.id].length, c.id).toBeGreaterThan(0);
    }
    const props = o.filter((l) => l.category === 'prop');
    expect(arStopIndex({ prop: props[1].id }, o, 'prop')).toBe(2);
    // An id that is gone (or in another category) stands on None, never throws.
    expect(arStopIndex({ prop: 'gone' }, o, 'prop')).toBe(0);
    expect(arStopIndex({ prop: o.find((l) => l.category === 'frame')?.id }, o, 'prop')).toBe(0);
  });

  it('wears a carousel stop in its own category only; None takes it off', () => {
    const o = arOrder(HOME_ASSET_DEFAULTS.arLooks);
    const prop = o.filter((l) => l.category === 'prop')[1];
    const before = { frame: 'ar-gala', filter: 'ar-aurora' };
    const sel = wearStop(before, 'prop', prop);
    expect(sel).toEqual({ frame: 'ar-gala', filter: 'ar-aurora', prop: prop.id });
    expect(before).toEqual({ frame: 'ar-gala', filter: 'ar-aurora' });
    expect(wearStop(sel, 'frame', null)).toEqual({ filter: 'ar-aurora', prop: prop.id });
    expect(wearStop({}, 'effect', null)).toEqual({});
  });

  it('titles a frame by its celebration, everything else by its name', () => {
    const frames = HOME_ASSET_DEFAULTS.arLooks.filter((l) => l.category === 'frame');
    const want: Record<string, string> = {
      'ar-wedding-cover': 'Wedding', 'ar-sangeet': 'Indian wedding', 'ar-birthday': 'Birthday',
      'ar-countdown': 'New Year’s Eve', 'ar-asoebi': 'Nigerian wedding', 'ar-gala': 'Gala',
    };
    for (const f of frames) expect(arTitle('frame', f), f.id).toBe(want[f.id]);
    expect(arTitle('frame', HOME_ASSET_DEFAULTS.heroLooks[0])).toBe('Christmas');
    // No occasion (or a blank one, as a CMS row may carry): the frame's name.
    expect(arTitle('frame', { ...frames[0], occasion: undefined })).toBe(frames[0].name);
    expect(arTitle('frame', { ...frames[0], occasion: '  ' })).toBe(frames[0].name);
    const prop = HOME_ASSET_DEFAULTS.arLooks.find((l) => l.category === 'prop');
    expect(prop !== undefined && arTitle('prop', { ...prop, occasion: 'Party' })).toBe(prop?.name);
    for (const l of [...HOME_ASSET_DEFAULTS.arLooks, ...HOME_ASSET_DEFAULTS.heroLooks]) {
      const t = arTitle(l.category, l);
      expect(t, l.id).not.toMatch(EMOJI_RE);
      expect(t.length, l.id).toBeLessThanOrEqual(22);
    }
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

  it('ships no face-oval default frame, and steps him into a small (CMS) frame’s window', () => {
    // The owner: a cutout must be "large enough for an actual face", so every
    // bundled AR frame has a full portrait window (the ovals were swapped out).
    const small = HOME_ASSET_DEFAULTS.arLooks.filter((l) => l.category === 'frame' && smallWindow(l.opening ?? DEFAULT_OPENING)).map((l) => l.id);
    expect(small).toEqual([]);
    // An override can still bring a face oval (the old floral arch's window):
    // it is small, and he steps into it.
    const o = { top: 0.263, bottom: 0.637, left: 0.274, right: 0.73 };
    expect(smallWindow(o)).toBe(true);
    expect(smallWindow(DEFAULT_OPENING)).toBe(false);
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

describe('standInFrame (a frame look in a box narrower than him)', () => {
  it('fills the box with the frame and stands him wholly inside its window', () => {
    const o = { top: 0.186, bottom: 0.907, left: 0.086, right: 0.916 }; // the Holiday cover
    for (const box of [{ top: 128, bottom: 856, left: 615, right: 924 }, { top: 100, bottom: 400, left: 0, right: 600 }]) {
      const { frame, stand } = standInFrame({ opening: o, box });
      const w = (frame.h * 9) / 16;
      // The frame stays in its box.
      expect(frame.left).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(frame.left + w).toBeLessThanOrEqual(box.right + 0.5);
      expect(frame.top).toBeGreaterThanOrEqual(box.top - 0.5);
      expect(frame.top + frame.h).toBeLessThanOrEqual(box.bottom + 0.5);
      // His body is inside the window: sides, feet and head.
      const win = { l: frame.left + o.left * w, r: frame.left + o.right * w, t: frame.top + o.top * frame.h, b: frame.top + o.bottom * frame.h };
      expect(stand.x - (stand.heightPx * BODY_W) / 2).toBeGreaterThanOrEqual(win.l - 0.5);
      expect(stand.x + (stand.heightPx * BODY_W) / 2).toBeLessThanOrEqual(win.r + 0.5);
      expect(stand.y).toBeLessThanOrEqual(win.b);
      expect(stand.y - stand.heightPx).toBeGreaterThan(win.t);
    }
  });

  it('keeps his selfie arm clear of the copy on its left', () => {
    const o = { top: 0.186, bottom: 0.907, left: 0.086, right: 0.916 };
    const box = { top: 128, bottom: 856, left: 615, right: 924 };
    const free = standInFrame({ opening: o, box });
    // Unconstrained, a 0.66-height reach crosses x = 604 (the headline's edge).
    expect(free.stand.x - 0.66 * free.stand.heightPx).toBeLessThan(604);
    const { frame, stand } = standInFrame({ opening: o, box, clearLeft: { x: 604, reach: 0.66 } });
    expect(stand.x - 0.66 * stand.heightPx).toBeGreaterThanOrEqual(603.5);
    // ...by the least it takes (he shrinks no more than he must).
    expect(stand.x - 0.66 * stand.heightPx).toBeLessThan(606);
    expect(frame.left + (frame.h * 9) / 16).toBeLessThanOrEqual(box.right + 0.5);
    expect(stand.heightPx).toBeGreaterThan(free.stand.heightPx * 0.75);
  });
});
