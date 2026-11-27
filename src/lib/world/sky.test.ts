import { describe, expect, it } from 'vitest';
import {
  SKY_EFFECTS, SKY_EFFECT_IDS, SKY_ONLY_AR_ID, SKY_PROBE_H, SKY_PROBE_W, SKY_TEXT_MAX,
  domeRotation, easeSkyline, elevationAt, headingOf, isSkyShaderId, skyExperiences, skyIdFrom,
  skyIdOfShader, skylineElevation, skyPalette, skyQuery, skyText, skyWords, stageShaderId, wantsSkyHint,
  type SkyView,
} from './skyFx';
import { boardLight, easeLight, meanOfRow, worldLightFrom, LIGHT_MAX_GAIN, LIGHT_MIN_GAIN, type Rgb } from './lightEstimate';
import { arFrameIdFrom, enterArUrl, leaveArUrl } from './arSession';

const quatX = (deg: number) => ({ x: Math.sin(deg * Math.PI / 360), y: 0, z: 0, w: Math.cos(deg * Math.PI / 360) });
const quatY = (deg: number) => ({ x: 0, y: Math.sin(deg * Math.PI / 360), z: 0, w: Math.cos(deg * Math.PI / 360) });

/** A 60 degree tall, portrait view (the harness's lens). */
function view(pitchDeg: number): SkyView {
  const P5 = 1 / Math.tan(Math.PI / 6), proj = new Float32Array(16);
  proj[0] = P5 / (9 / 16); proj[5] = P5;
  const q = quatX(pitchDeg);
  return { vp: { offsetX: 0, offsetY: 0, width: 720, height: 1280 }, canvasW: 720, canvasH: 1280, proj, rot: domeRotation(q, headingOf(q), new Float32Array(9)) };
}

describe('sky effects: the registry and the Effects slot', () => {
  it('has one entry per id, each with a name, a blurb and a tile', () => {
    expect(SKY_EFFECTS.map((e) => e.id)).toEqual([...SKY_EFFECT_IDS]);
    for (const e of SKY_EFFECTS) {
      expect(e.name.length).toBeGreaterThan(3);
      expect(e.blurb.endsWith('.')).toBe(true);
      expect(e.swatch).toHaveLength(2);
    }
  });
  it('recognises only real sky shader ids', () => {
    expect(isSkyShaderId('sky:stars')).toBe(true);
    expect(skyIdOfShader('sky:fireworks')).toBe('fireworks');
    expect(isSkyShaderId('sky:nope')).toBe(false);
    expect(isSkyShaderId('golden-hour')).toBe(false);
    expect(isSkyShaderId(null)).toBe(false);
    expect(skyIdOfShader('none')).toBeNull();
  });
  it('never hands a sky id to the stage shader runner', () => {
    expect(stageShaderId('sky:aurora')).toBe('none');
    expect(stageShaderId('golden-hour')).toBe('golden-hour');
    expect(stageShaderId('none')).toBe('none');
  });
  it('builds Effects tiles with built-in ids, and honours the host hiding one', () => {
    const all = skyExperiences();
    expect(all).toHaveLength(SKY_EFFECTS.filter((e) => !e.packs).length);
    expect(all[0]).toMatchObject({ id: 'builtin:shader:sky:golden', kind: 'shader', asset_url: null, is_published: true });
    expect(all[0].config.shader?.shaderId).toBe('sky:golden');
    expect(skyExperiences(['builtin:shader:sky:hearts']).some((e) => e.id.endsWith('hearts'))).toBe(false);
  });
  it('shows an effect made for a theme pack only in events wearing it, leading the row', () => {
    const ids = (pack: string | null) => skyExperiences([], pack).map((e) => e.id.replace('builtin:shader:sky:', ''));
    expect(ids(null)).toEqual(['golden', 'stars', 'aurora', 'fireworks', 'lanterns', 'hearts', 'names']);
    expect(ids('some-other-pack')).toEqual(ids(null));
    expect(ids('island-golden-hour')).toEqual(['petals', 'heartbursts', 'vows', ...ids(null)]);
    // Sort order follows the row, so the pack's own effects come first in the tab.
    const orders = skyExperiences([], 'island-golden-hour').map((e) => e.sort_order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(skyExperiences(['builtin:shader:sky:vows'], 'island-golden-hour').some((e) => e.id.endsWith('vows'))).toBe(false);
  });
  it('writes the names, and for the vows the hashtag on a second line', () => {
    expect(skyWords('stars', 'Mariba & Philip', '#ForeverWeDO')).toBeNull();
    expect(skyWords('names', 'Mariba & Philip', '#ForeverWeDO')).toBe('Mariba & Philip');
    expect(skyWords('vows', 'Mariba & Philip', '#ForeverWeDO')).toBe('Mariba & Philip\n#ForeverWeDO');
    expect(skyWords('vows', 'Gala Night', 'Gala Night')).toBe('Gala Night');
    expect(skyWords('vows', '', '#OnlyTag')).toBe('#OnlyTag');
    expect(skyWords('vows', null, null)).toBeNull();
  });
});

describe('sky effects: the AR page URL', () => {
  it('reads ?sky= and ignores unknown ids', () => {
    expect(skyIdFrom('?ar=sky&sky=lanterns')).toBe('lanterns');
    expect(skyIdFrom('?ar=sky&sky=<script>')).toBeNull();
    expect(skyIdFrom('?ar=sky')).toBeNull();
  });
  it('the sky-only id is a valid AR id', () => {
    expect(arFrameIdFrom(`?ar=${SKY_ONLY_AR_ID}&sky=stars`)).toBe(SKY_ONLY_AR_ID);
  });
  it('enters with the effect and leaves without it', () => {
    const url = enterArUrl('/e/demo', '?sky=stars&trackdebug=1', SKY_ONLY_AR_ID);
    expect(url).toBe('/e/demo/booth?sky=stars&trackdebug=1&ar=sky');
    const back = leaveArUrl('/e/demo', '?ar=sky&sky=stars&trackdebug=1', null);
    expect(back).toBe('/e/demo/booth?trackdebug=1&cam=1');
  });
  it('swaps the effect in place, keeps a standing Frame, and leaves when nothing is left', () => {
    expect(skyQuery('?ar=sky&sky=stars', 'sky', 'aurora')).toBe('ar=sky&sky=aurora');
    expect(skyQuery('?ar=abc&x=1', 'abc', 'hearts')).toBe('ar=abc&x=1&sky=hearts');
    expect(skyQuery('?ar=abc&sky=stars', 'abc', null)).toBe('ar=abc');
    expect(skyQuery('?ar=sky&sky=stars', 'sky', null)).toBeNull();
  });
});

describe('sky effects: the dome', () => {
  it('heads where the camera looks along the ground', () => {
    const [x, z] = headingOf(quatX(20));
    expect(x).toBeCloseTo(0, 6); expect(z).toBeCloseTo(-1, 6);
    // Turned 90 degrees to the left: -z becomes -x.
    const [lx, lz] = headingOf(quatY(90));
    expect(lx).toBeCloseTo(-1, 6); expect(lz).toBeCloseTo(0, 6);
  });
  it('still has a heading looking straight up', () => {
    const [x, z] = headingOf(quatX(90));
    expect(Math.hypot(x, z)).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(-1, 6);
  });
  it('puts the picture centre straight ahead on the dome, whichever way the guest faced', () => {
    for (const yaw of [0, 45, 170, -120]) {
      const q = quatY(yaw), m = domeRotation(q, headingOf(q), new Float32Array(9));
      // camera forward (0, 0, -1) -> dome: minus the third column
      expect(-m[6]).toBeCloseTo(0, 5); expect(-m[7]).toBeCloseTo(0, 5); expect(-m[8]).toBeCloseTo(-1, 5);
    }
  });
  it('elevation of the picture centre is the camera pitch', () => {
    expect(elevationAt(view(25), 0.5, 0.5)).toBeCloseTo(25 * Math.PI / 180, 4);
    // 60 degree lens: the top edge is 30 degrees higher.
    expect(elevationAt(view(10), 0.5, 0)).toBeCloseTo(40 * Math.PI / 180, 3);
  });
  it('keeps turning with the phone after the heading is fixed', () => {
    const q0 = quatY(0), heading = headingOf(q0);
    const m = domeRotation(quatY(-30), heading, new Float32Array(9));
    // Now looking 30 degrees to the right of the anchor: dome x is positive.
    expect(-m[6]).toBeCloseTo(Math.sin(Math.PI / 6), 5);
  });
});

describe('sky effects: the skyline', () => {
  const probe = (skyRows: (cx: number) => number) => {
    const p = new Uint8Array(SKY_PROBE_W * SKY_PROBE_H);
    for (let cx = 0; cx < SKY_PROBE_W; cx++) for (let cy = 0; cy < skyRows(cx); cy++) p[cy * SKY_PROBE_W + cx] = 255;
    return p;
  };
  it('finds a level skyline at the right elevation', () => {
    // Sky in the top half of a picture pitched up 20 degrees: the skyline is at the centre.
    const el = skylineElevation(probe(() => SKY_PROBE_H / 2), view(20));
    expect(el).not.toBeNull();
    expect(el!).toBeCloseTo(20 * Math.PI / 180, 2);
  });
  it('takes the median, so one tower does not lift it', () => {
    const flat = skylineElevation(probe(() => 16), view(20))!;
    const tower = skylineElevation(probe((cx) => (cx === 3 || cx === 4 ? 4 : 16)), view(20))!;
    // (Columns off the centre line sit a hair higher, so the median column may change.)
    expect(tower).toBeCloseTo(flat, 2);
  });
  it('says nothing with almost no sky, or when the sky fills the picture to the bottom', () => {
    expect(skylineElevation(probe((cx) => (cx < 2 ? 10 : 0)), view(20))).toBeNull();
    expect(skylineElevation(probe(() => SKY_PROBE_H), view(60))).toBeNull();
    expect(skylineElevation(new Uint8Array(SKY_PROBE_W * SKY_PROBE_H), view(0))).toBeNull();
  });
  it('ignores a single stray sky pixel under the skyline', () => {
    const p = probe(() => 10);
    p[25 * SKY_PROBE_W + 5] = 255;
    expect(skylineElevation(p, view(20))).toBeCloseTo(skylineElevation(probe(() => 10), view(20))!, 6);
  });
  it('eases towards a new reading and stays in its band', () => {
    expect(easeSkyline(null, 0.3)).toBe(0.3);
    expect(easeSkyline(0.2, 0.6)).toBeCloseTo(0.3, 6);
    expect(easeSkyline(null, 5)).toBe(0.9);
    expect(easeSkyline(null, -5)).toBe(-0.2);
  });
});

describe('sky effects: colours, words and the hint', () => {
  it('uses the event colours, bright enough to glow', () => {
    const [a, b] = skyPalette(['#3a1a00', '#102040']);
    expect(Math.max(...a)).toBeCloseTo(0.9, 2);
    expect(Math.max(...b)).toBeCloseTo(0.9, 2);
    expect(a[0]).toBeGreaterThan(a[2]);
    expect(b[2]).toBeGreaterThan(b[0]);
  });
  it('makes a second colour when the event has one, or two the same', () => {
    const [a, b] = skyPalette(['#d4af37']);
    expect(b).not.toEqual(a);
    const [c, d] = skyPalette(['#d4af37', '#d4af37']);
    expect(d).not.toEqual(c);
    expect(skyPalette(undefined)[0].every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(skyPalette(['#000000'])[0]).toEqual([0.9, 0.9, 0.9]);
  });
  it('tidies the words and gives none for an empty name', () => {
    expect(skyText('  Mariba   &  Philip ')).toBe('Mariba & Philip');
    expect(skyText('Mariba & Philip', '#ForeverWeDO')).toBe('Mariba & Philip');
    expect(skyText('  ', '#ForeverWeDO')).toBe('#ForeverWeDO');
    expect(skyText(null, null)).toBeNull();
    expect(skyText('')).toBeNull();
    expect(skyText(undefined)).toBeNull();
    const long = skyText('x'.repeat(80))!;
    expect(long.length).toBe(SKY_TEXT_MAX);
    expect(long.endsWith('…')).toBe(true);
  });
  it('asks for the sky only after a moment without it', () => {
    expect(wantsSkyHint(0)).toBe(false);
    expect(wantsSkyHint(1000)).toBe(false);
    expect(wantsSkyHint(3000)).toBe(true);
    expect(wantsSkyHint(Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('room light for the standing Frame', () => {
  const lumOf = (c: Rgb) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  it('leaves the board alone in a normal, neutral picture', () => {
    const c = boardLight(0, [0.42, 0.42, 0.42]);
    for (const v of c) expect(v).toBeCloseTo(1, 2);
    expect(boardLight(null, null)).toEqual([1, 1, 1]);
  });
  it('dims the board in a dark room and never below the floor', () => {
    const dim = boardLight(-0.5, [0.15, 0.15, 0.15]);
    expect(lumOf(dim)).toBeLessThan(0.75);
    expect(lumOf(dim)).toBeGreaterThanOrEqual(LIGHT_MIN_GAIN - 1e-6);
    expect(lumOf(boardLight(-5, [0.01, 0.01, 0.01]))).toBeCloseTo(LIGHT_MIN_GAIN, 2);
  });
  it('never blows the board out in a bright one', () => {
    expect(lumOf(boardLight(0.5, [0.9, 0.9, 0.9]))).toBeLessThanOrEqual(LIGHT_MAX_GAIN + 1e-6);
  });
  it('takes some of the cast, not all of it', () => {
    const warm = boardLight(0, [0.6, 0.42, 0.25]);
    expect(warm[0]).toBeGreaterThan(warm[1]);
    expect(warm[1]).toBeGreaterThan(warm[2]);
    // The scene is 2.4x redder than blue; the board far less.
    expect(warm[0] / warm[2]).toBeLessThan(1.6);
  });
  it('ignores a non-finite exposure', () => {
    expect(boardLight(Number.NaN, null)).toEqual([1, 1, 1]);
  });
  it('averages a row of pixels and rejects an empty or black read', () => {
    expect(meanOfRow(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]))).toEqual([0.5, 0, 0.5]);
    expect(meanOfRow(new Uint8Array(0))).toBeNull();
    expect(meanOfRow(new Uint8Array(8))).toBeNull();
  });
  it('eases without overshoot and holds on a zero step', () => {
    const cur: Rgb = [1, 1, 1];
    easeLight(cur, [0.5, 0.5, 0.5], 0);
    expect(cur).toEqual([1, 1, 1]);
    easeLight(cur, [0.5, 0.5, 0.5], 0.6);
    expect(cur[0]).toBeGreaterThan(0.5); expect(cur[0]).toBeLessThan(0.75);
    easeLight(cur, [0.5, 0.5, 0.5], 60);
    expect(cur[0]).toBeCloseTo(0.5, 6);
  });
  it('has a tester switch', () => {
    expect(worldLightFrom('?wlight=0')).toBe(false);
    expect(worldLightFrom('?ar=x')).toBe(true);
  });
});
