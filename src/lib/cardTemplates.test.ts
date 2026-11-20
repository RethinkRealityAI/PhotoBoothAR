import { describe, it, expect } from 'vitest';
import {
  CARD_TEMPLATE_IDS,
  CARD_TEMPLATE_OPTIONS,
  DEFAULT_CARD_TEMPLATE,
  POLAROID_ENTRANCE_SPAN,
  POLAROID_FAN_STEP_DEG,
  POLAROID_FAN_STEP_X_PCT,
  POLAROID_MAX_SHIFT_X_PCT,
  POLAROID_MAX_SHIFT_Y_PCT,
  POLAROID_MAX_TILT_DEG,
  isCardTemplateId,
  normalizeCardTemplate,
  polaroidEntrance,
  polaroidFan,
  polaroidPlacement,
  polaroidSeed,
  CONSTELLATION_MAX_LAT,
  SHORT_MESSAGE_MAX_CHARS,
  closingHeadline,
  constellationLayout,
  constellationRadius,
  constellationThreads,
  contributionCountLabel,
  contributorCount,
  contributorInitials,
  coverArc,
  coverPicks,
  coverRecipientLine,
  focusCameraPosition,
  formatNameList,
  messageTone,
  ornamentFrame,
  overviewDistance,
  titleMentionsRecipient,
  uniqueContributors,
} from './cardTemplates';

describe('the closed set of card templates', () => {
  it('ships exactly the shipped templates, in host-facing order', () => {
    expect(CARD_TEMPLATE_IDS).toEqual(['storybook', 'filmstrip', 'polaroid', 'carousel', 'constellation']);
  });

  it('has one option per id, in the same order, each with a one-line description', () => {
    expect(CARD_TEMPLATE_OPTIONS.map((o) => o.id)).toEqual([...CARD_TEMPLATE_IDS]);
    for (const o of CARD_TEMPLATE_OPTIONS) {
      expect(o.label.trim().length).toBeGreaterThan(0);
      expect(o.description.trim().length).toBeGreaterThan(0);
      // One LINE: descriptions sit under a <select> option, never wrap to prose.
      expect(o.description).not.toContain('\n');
      expect(o.description.length).toBeLessThanOrEqual(90);
    }
  });

  it('recognises every shipped id and nothing else', () => {
    for (const id of CARD_TEMPLATE_IDS) expect(isCardTemplateId(id)).toBe(true);
    expect(isCardTemplateId('storybooks')).toBe(false);
    expect(isCardTemplateId('')).toBe(false);
    expect(isCardTemplateId(null)).toBe(false);
    expect(isCardTemplateId(undefined)).toBe(false);
    expect(isCardTemplateId(7)).toBe(false);
  });

  it('normalizes an unknown/absent stored template to the default', () => {
    expect(normalizeCardTemplate('polaroid')).toBe('polaroid');
    expect(normalizeCardTemplate('filmstrip')).toBe('filmstrip');
    expect(normalizeCardTemplate('a-template-from-the-future')).toBe(DEFAULT_CARD_TEMPLATE);
    expect(normalizeCardTemplate('')).toBe(DEFAULT_CARD_TEMPLATE);
    expect(normalizeCardTemplate(null)).toBe(DEFAULT_CARD_TEMPLATE);
    expect(normalizeCardTemplate(undefined)).toBe(DEFAULT_CARD_TEMPLATE);
    expect(DEFAULT_CARD_TEMPLATE).toBe('storybook');
  });
});

describe('polaroidSeed', () => {
  it('is a pure function of id + salt (32-bit unsigned)', () => {
    expect(polaroidSeed('a')).toBe(polaroidSeed('a'));
    expect(polaroidSeed('')).toBe(2166136261); // the FNV-1a offset basis
    expect(polaroidSeed('a')).toBe(3826002220);
    for (const id of ['', 'a', 'contribution-7', 'x'.repeat(64)]) {
      const s = polaroidSeed(id);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('separates the salts, so one id drives independent streams', () => {
    expect(polaroidSeed('a', 1)).toBe(3842779839);
    expect(polaroidSeed('a', 1)).not.toBe(polaroidSeed('a', 0));
    expect(polaroidSeed('a', 2)).not.toBe(polaroidSeed('a', 1));
  });
});

describe('polaroidPlacement', () => {
  it('is deterministic — the same print lands at the same angle every render', () => {
    const id = 'a1b2c3d4-0000-4000-8000-000000000001';
    expect(polaroidPlacement(id)).toEqual(polaroidPlacement(id));
    // Golden values pin the rule itself (salt order, bit slice, rounding).
    expect(polaroidPlacement(id)).toEqual({ rotationDeg: -0.37, offsetXPct: -1.3, offsetYPct: 0.76 });
    expect(polaroidPlacement('9f8e7d6c-1111-4111-8111-111111111111')).toEqual({
      rotationDeg: 1.96,
      offsetXPct: -0.43,
      offsetYPct: -0.69,
    });
    expect(polaroidPlacement('contribution-7')).toEqual({
      rotationDeg: -2.69,
      offsetXPct: -0.83,
      offsetYPct: -1.42,
    });
  });

  it('differs between ids (a wall of prints is never a stack of clones)', () => {
    const rots = new Set(Array.from({ length: 50 }, (_, i) => polaroidPlacement(`id-${i}`).rotationDeg));
    expect(rots.size).toBeGreaterThan(40);
  });

  it('stays inside the published bounds and tilts both ways', () => {
    let neg = 0;
    let pos = 0;
    for (let i = 0; i < 200; i++) {
      const p = polaroidPlacement(`id-${i}`);
      expect(Math.abs(p.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_TILT_DEG);
      expect(Math.abs(p.offsetXPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_X_PCT);
      expect(Math.abs(p.offsetYPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_Y_PCT);
      // 2dp keeps the CSS value stable (no sub-pixel jitter between renders).
      // Asserted on the DECIMAL STRING: `0.57 * 100` is 56.99999999999999, so
      // multiplying back out would compare two computed binary floats.
      expect(String(p.rotationDeg)).toMatch(/^-?\d+(\.\d{1,2})?$/);
      expect(String(p.offsetXPct)).toMatch(/^-?\d+(\.\d{1,2})?$/);
      if (p.rotationDeg < 0) neg++;
      else pos++;
    }
    expect(neg).toBeGreaterThan(60);
    expect(pos).toBeGreaterThan(60);
  });

  it('handles an empty id without throwing', () => {
    const p = polaroidPlacement('');
    expect(Number.isFinite(p.rotationDeg)).toBe(true);
    expect(Math.abs(p.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_TILT_DEG);
  });
});

describe('polaroidEntrance (the driven/frame-by-frame path)', () => {
  it('starts held back and settles by the end of its span', () => {
    expect(polaroidEntrance(0)).toEqual({ opacity: 0, y: 26, scale: 0.96 });
    expect(polaroidEntrance(POLAROID_ENTRANCE_SPAN)).toEqual({ opacity: 1, y: 0, scale: 1 });
    expect(polaroidEntrance(1)).toEqual({ opacity: 1, y: 0, scale: 1 });
  });

  it('is monotonic across the span and deterministic', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const e = polaroidEntrance((i / 20) * POLAROID_ENTRANCE_SPAN);
      expect(e.opacity).toBeGreaterThanOrEqual(prev);
      expect(e).toEqual(polaroidEntrance((i / 20) * POLAROID_ENTRANCE_SPAN));
      prev = e.opacity;
    }
  });

  it('never yields NaN into a transform (out-of-range / non-finite settles)', () => {
    for (const bad of [NaN, Infinity, -Infinity, -3, 99]) {
      const e = polaroidEntrance(bad);
      expect(Number.isFinite(e.opacity)).toBe(true);
      expect(Number.isFinite(e.y)).toBe(true);
      expect(Number.isFinite(e.scale)).toBe(true);
      expect(e.opacity).toBeGreaterThanOrEqual(0);
      expect(e.opacity).toBeLessThanOrEqual(1);
    }
    expect(polaroidEntrance(NaN)).toEqual({ opacity: 1, y: 0, scale: 1 });
    expect(polaroidEntrance(-3)).toEqual({ opacity: 0, y: 26, scale: 0.96 });
  });
});

describe('polaroidFan (the cover stack)', () => {
  const ids = ['a1b2c3d4-0000-4000-8000-000000000001', '9f8e7d6c-1111-4111-8111-111111111111', 'contribution-7'];

  it('returns one placement per print, empty in, empty out', () => {
    expect(polaroidFan([])).toEqual([]);
    expect(polaroidFan(ids)).toHaveLength(3);
    expect(polaroidFan(['solo'])).toHaveLength(1);
  });

  it('fans symmetrically about the centre and stays deterministic', () => {
    const fan = polaroidFan(ids);
    expect(fan).toEqual(polaroidFan(ids));
    expect(fan[0].rotationDeg).toBeLessThan(0); // leans left
    expect(fan[2].rotationDeg).toBeGreaterThan(0); // leans right
    expect(fan[0].offsetXPct).toBeLessThan(fan[1].offsetXPct);
    expect(fan[1].offsetXPct).toBeLessThan(fan[2].offsetXPct);
    expect(fan).toEqual([
      { rotationDeg: -9.18, offsetXPct: -62.65, offsetYPct: 7.38 },
      { rotationDeg: 0.98, offsetXPct: -0.21, offsetYPct: -0.34 },
      { rotationDeg: 7.66, offsetXPct: 61.59, offsetYPct: 6.29 },
    ]);
  });

  it('bounds the fan: the outermost print never exceeds its step plus half a jitter', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const fan = polaroidFan(Array.from({ length: n }, (_, i) => `fan-${n}-${i}`));
      const maxSpread = (n - 1) / 2;
      for (const p of fan) {
        expect(Math.abs(p.rotationDeg)).toBeLessThanOrEqual(maxSpread * POLAROID_FAN_STEP_DEG + POLAROID_MAX_TILT_DEG / 2);
        expect(Math.abs(p.offsetXPct)).toBeLessThanOrEqual(maxSpread * POLAROID_FAN_STEP_X_PCT + POLAROID_MAX_SHIFT_X_PCT / 2);
      }
    }
  });

  it('centres a lone print (no spread term to apply)', () => {
    const [only] = polaroidFan(['solo']);
    expect(Math.abs(only.rotationDeg)).toBeLessThanOrEqual(POLAROID_MAX_TILT_DEG / 2);
    expect(Math.abs(only.offsetXPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_X_PCT / 2);
    expect(Math.abs(only.offsetYPct)).toBeLessThanOrEqual(POLAROID_MAX_SHIFT_Y_PCT / 2);
  });
});

describe('cover copy — no repeated names, no event name', () => {
  it('drops "for X" when the title already names the recipient (case-insensitive)', () => {
    expect(titleMentionsRecipient('Happy birthday, Dapo!', 'Dapo')).toBe(true);
    expect(titleMentionsRecipient('HAPPY BIRTHDAY, DAPO!', 'dapo')).toBe(true);
    expect(titleMentionsRecipient('Happy birthday!', 'Dapo')).toBe(false);
    expect(coverRecipientLine('Happy birthday, Dapo!', 'Dapo')).toBeNull();
    expect(coverRecipientLine('Happy birthday!', '  Dapo ')).toBe('for Dapo');
  });

  it('never matches or renders an empty recipient', () => {
    expect(titleMentionsRecipient('Anything', '')).toBe(false);
    expect(titleMentionsRecipient('Anything', null)).toBe(false);
    expect(coverRecipientLine('Anything', '   ')).toBeNull();
    expect(coverRecipientLine('Anything', undefined)).toBeNull();
  });

  it('counts messages in sentence case', () => {
    expect(contributionCountLabel(8)).toBe('8 messages inside');
    expect(contributionCountLabel(1)).toBe('1 message inside');
    expect(contributionCountLabel(0)).toBe('Nothing inside yet');
    expect(contributionCountLabel(NaN)).toBe('Nothing inside yet');
  });
});

describe('contributors', () => {
  const list = [
    { contributorName: 'The Squad' },
    { contributorName: 'Beamy' },
    { contributorName: 'beamy ' },
    { contributorName: null },
    { contributorName: '  ' },
    { contributorName: 'Tola & Femi' },
  ];

  it('initials: two letters max, letters of any script, a star for nobody', () => {
    expect(contributorInitials('The Squad')).toBe('TS');
    expect(contributorInitials('Tola & Femi')).toBe('TF');
    expect(contributorInitials('Beamy')).toBe('B');
    expect(contributorInitials('élodie martin')).toBe('ÉM');
    expect(contributorInitials('')).toBe('✦');
    expect(contributorInitials(null)).toBe('✦');
  });

  it('dedupes names case-insensitively in first-seen order and counts anonymous notes', () => {
    expect(uniqueContributors(list)).toEqual(['The Squad', 'Beamy', 'Tola & Femi']);
    expect(contributorCount(list)).toBe(5); // 3 names + 2 unsigned
  });

  it('closing headline', () => {
    expect(closingHeadline(list)).toBe('With love from 5 people');
    expect(closingHeadline([{ contributorName: 'Kemi' }])).toBe('With love from Kemi');
    expect(closingHeadline([{ contributorName: null }])).toBe('With love');
    expect(closingHeadline([])).toBe('With love');
  });

  it('formats a signed list with a cap', () => {
    expect(formatNameList([])).toBe('');
    expect(formatNameList(['Kemi'])).toBe('Kemi');
    expect(formatNameList(['Kemi', 'Marcus'])).toBe('Kemi and Marcus');
    expect(formatNameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(formatNameList(['A', 'B', 'C', 'D', 'E'], 3)).toBe('A, B, C and 2 more');
  });
});

describe('messageTone', () => {
  it('sets short lines in the display face and long ones in the text face', () => {
    expect(messageTone('Happy birthday bro!')).toBe('display');
    expect(messageTone('x'.repeat(SHORT_MESSAGE_MAX_CHARS))).toBe('display');
    expect(messageTone('x'.repeat(SHORT_MESSAGE_MAX_CHARS + 1))).toBe('text');
    expect(messageTone('  ')).toBe('none');
    expect(messageTone(null)).toBe('none');
  });

  it('counts emoji as one character each', () => {
    expect(messageTone('🎂'.repeat(SHORT_MESSAGE_MAX_CHARS))).toBe('display');
  });
});

describe('cover hero', () => {
  const c = (id: string, mediaType: string, url: string | null) => ({ id, mediaType, url });

  it('puts photos first, then videos, then notes, capped', () => {
    const picks = coverPicks([c('t', 'text', null), c('v', 'video', 'u'), c('p1', 'photo', 'u'), c('p2', 'photo', 'u')], 3);
    expect(picks.map((p) => p.id)).toEqual(['p1', 'p2', 'v']);
    expect(coverPicks([c('t', 'text', null)]).map((p) => p.id)).toEqual(['t']);
    expect(coverPicks([], 5)).toEqual([]);
  });

  it('fans symmetrically with the centre tile forward', () => {
    expect(coverArc(0)).toEqual([]);
    const arc = coverArc(5);
    expect(arc).toHaveLength(5);
    expect(arc[2]).toEqual({ rotationDeg: 0, offsetXPct: 0, offsetYPct: 0, scale: 1, zIndex: 10 });
    expect(arc[0].rotationDeg).toBe(-arc[4].rotationDeg);
    expect(arc[0].offsetXPct).toBe(-arc[4].offsetXPct);
    expect(arc[0].offsetYPct).toBe(arc[4].offsetYPct);
    expect(arc[0].zIndex).toBeLessThan(arc[1].zIndex);
    for (const s of arc) expect(s.scale).toBeGreaterThanOrEqual(0.72);
  });
});

describe('ornamentFrame', () => {
  const NUM = /-?\d+(\.\d+)?/g;

  it('is finite at every size, including degenerate ones', () => {
    for (const [w, h] of [[390, 700], [1440, 900], [0, 0], [-5, NaN], [40, 40]]) {
      const f = ornamentFrame(w, h);
      const all = [...f.rules, f.arch, f.beads, ...f.corners, ...f.crests].join(' ');
      expect(all).not.toMatch(/NaN|Infinity/);
      expect(f.arch.endsWith('Z')).toBe(true);
    }
  });

  it('is symmetric left-right: the arch peaks at the centre', () => {
    const f = ornamentFrame(400, 700);
    const nums = (f.arch.match(NUM) ?? []).map(Number);
    expect(nums).toContain(200);
    expect(f.corners[0]).toMatch(/^translate\(/);
    expect(f.corners[1]).toContain('scale(-');
  });

  it('is deterministic', () => {
    expect(ornamentFrame(390, 700)).toEqual(ornamentFrame(390, 700));
  });
});

describe('constellation layout', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `c-${i}`);

  it('is deterministic per id and one node per id', () => {
    expect(constellationLayout(ids)).toEqual(constellationLayout(ids));
    expect(constellationLayout(ids)).toHaveLength(8);
    expect(constellationLayout([])).toEqual([]);
  });

  it('keeps every tile on its shell (±8%) and away from the poles', () => {
    const R = constellationRadius(ids.length);
    for (const n of constellationLayout(ids)) {
      const r = Math.hypot(...n.position);
      expect(r).toBeGreaterThan(R * 0.91);
      expect(r).toBeLessThan(R * 1.09);
      expect(Math.abs(n.position[1]) / r).toBeLessThanOrEqual(CONSTELLATION_MAX_LAT + 1e-3);
      expect(n.phase).toBeGreaterThanOrEqual(0);
      expect(n.phase).toBeLessThan(Math.PI * 2);
      expect(n.scale).toBeGreaterThanOrEqual(0.9);
      expect(n.scale).toBeLessThanOrEqual(1.1);
    }
  });

  it('a lone tile sits on the equator', () => {
    const [only] = constellationLayout(['solo']);
    expect(only.position[1]).toBe(0);
  });

  it('grows the shell with the count, never below the minimum', () => {
    expect(constellationRadius(0)).toBe(3.6);
    expect(constellationRadius(1)).toBe(3.6);
    expect(constellationRadius(50)).toBeGreaterThan(constellationRadius(8));
  });

  it('spreads tiles out: no two closer than a tile width', () => {
    for (const count of [3, 8, 20, 40]) {
      const nodes = constellationLayout(Array.from({ length: count }, (_, i) => `n-${count}-${i}`));
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(
            nodes[i].position[0] - nodes[j].position[0],
            nodes[i].position[1] - nodes[j].position[1],
            nodes[i].position[2] - nodes[j].position[2],
          );
          expect(d).toBeGreaterThan(1.1);
        }
      }
    }
  });
});

describe('constellation threads', () => {
  it('links each tile to its k nearest, deduplicated and sorted', () => {
    const pts: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [5, 0, 0], [6, 0, 0]];
    expect(constellationThreads(pts, 1)).toEqual([[0, 1], [2, 3]]);
    const two = constellationThreads(pts, 2);
    for (const [a, b] of two) expect(a).toBeLessThan(b);
    expect(new Set(two.map(([a, b]) => `${a}-${b}`)).size).toBe(two.length);
    expect(constellationThreads([], 2)).toEqual([]);
    expect(constellationThreads([[0, 0, 0]], 2)).toEqual([]);
  });
});

describe('constellation camera', () => {
  it('stands outward of a focused tile, along its direction', () => {
    expect(focusCameraPosition([0, 0, 4], 2)).toEqual([0, 0, 6]);
    expect(focusCameraPosition([3, 0, 0], 1.5)).toEqual([4.5, 0, 0]);
    expect(focusCameraPosition([0, 0, 0], 2)).toEqual([0, 0, 2]);
  });

  it('backs off further on a portrait screen than a landscape one', () => {
    const portrait = overviewDistance(5, 390 / 700, 50);
    const landscape = overviewDistance(5, 1440 / 800, 50);
    expect(portrait).toBeGreaterThan(landscape);
    expect(Number.isFinite(overviewDistance(5, 0, NaN))).toBe(true);
  });
});
