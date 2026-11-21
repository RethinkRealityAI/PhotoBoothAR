import { describe, expect, it } from 'vitest';
import { REVEAL_MAX_S, REVEAL_MIN_S, beatsEnd, type RevealBeat } from './cardReveal';
import { CARD_REVEAL_OPTIONS, REVEAL_WEBGL_FALLBACK } from './cardPresentation';
import { KEEPSAKE_REVEAL_IDS, KEEPSAKE_THEMES, keepsakeTheme, type KeepsakeRevealId } from './keepsakeSettings';
import {
  CARD_REVEAL_PHOTOS,
  HERO_PRINTS,
  HERO_PRINT_TILT_DEG,
  RECAP_REVEAL_DONE_DEADLINE_MS,
  RECAP_REVEAL_FADE_MS,
  RECAP_REVEAL_HANDOFF_MS,
  RECAP_REVEAL_LOAD_DEADLINE_MS,
  beamBeats,
  beamBudget,
  beamRevealLength,
  fallbackHeroBoxes,
  fanTiming,
  heroPrintTilt,
  heroPrintZ,
  playableRecapReveal,
  recapDeepLink,
  recapRevealCard,
  recapRevealPalette,
  resolveRecapOpening,
  sealedLine,
  settleKind,
  stackPose,
} from './recapReveal';
import type { Post } from '../types';

const both = [false, true] as const;
const EPS = 1e-9;

const webglIds = new Set(CARD_REVEAL_OPTIONS.filter((o) => o.needsWebGL).map((o) => o.id));

describe('which opening plays', () => {
  it('every configured reveal resolves to something this device can play', () => {
    for (const id of KEEPSAKE_REVEAL_IDS) {
      for (const webgl of both) {
        const got = playableRecapReveal(id, webgl);
        if (id === 'none') expect(got).toBeNull();
        else if (id === 'beam') expect(got).toBe('beam');
        else if (!webgl && webglIds.has(id)) expect(got).toBe(REVEAL_WEBGL_FALLBACK);
        else expect(got).toBe(id);
      }
    }
  });

  it('the beam needs no WebGL', () => {
    expect(playableRecapReveal('beam', false)).toBe('beam');
  });

  it('a first visit plays the reveal and then the theme settle', () => {
    expect(resolveRecapOpening({ reveal: 'beam', webgl: true, hash: '', seen: false })).toEqual({
      reveal: 'beam',
      deepLink: null,
      settle: true,
    });
    expect(resolveRecapOpening({ reveal: 'curtain', webgl: false, hash: '', seen: false }).reveal).toBe('envelope');
  });

  it("'none' goes straight to the album; the settle is then its one flourish", () => {
    expect(resolveRecapOpening({ reveal: 'none', webgl: true, hash: '', seen: false })).toEqual({
      reveal: null,
      deepLink: null,
      settle: true,
    });
  });

  it('a repeat visit in the same tab opens nothing', () => {
    for (const id of KEEPSAKE_REVEAL_IDS) {
      expect(resolveRecapOpening({ reveal: id, webgl: true, hash: '', seen: true })).toEqual({
        reveal: null,
        deepLink: null,
        settle: false,
      });
    }
  });

  it('a deep link skips straight to its section, even on a first visit', () => {
    for (const hash of ['#film', '#photos', '#FILM', 'photos']) {
      const o = resolveRecapOpening({ reveal: 'beam', webgl: true, hash, seen: false });
      expect(o.reveal).toBeNull();
      expect(o.settle).toBe(false);
      expect(o.deepLink).toBe(hash.replace('#', '').toLowerCase());
    }
  });

  it('only #film and #photos are deep links', () => {
    expect(recapDeepLink('#film')).toBe('film');
    expect(recapDeepLink('#photos')).toBe('photos');
    for (const h of ['', '#', '#filmstrip', '#recap-album-heading', null, undefined]) expect(recapDeepLink(h)).toBeNull();
    expect(resolveRecapOpening({ reveal: 'beam', webgl: true, hash: '#top', seen: false }).reveal).toBe('beam');
  });
});

describe('the theme settle', () => {
  it('never repeats the beam right after the beam reveal', () => {
    expect(settleKind('beam', 'beam', false)).toBeNull();
    expect(settleKind('beam', 'envelope', false)).toBe('beam');
    expect(settleKind('beam', null, false)).toBe('beam');
  });

  it("keeps each theme's character after any other opening", () => {
    for (const t of KEEPSAKE_THEMES) {
      if (t.intro === 'beam') continue;
      expect(settleKind(t.intro, 'beam', false)).toBe(t.intro);
      expect(settleKind(t.intro, null, false)).toBe(t.intro);
    }
    expect(settleKind(keepsakeTheme('midnight-bloom').intro, 'beam', false)).toBe('petals');
  });

  it('reduced motion keeps only a soft glow', () => {
    for (const t of KEEPSAKE_THEMES) {
      if (t.intro === 'beam') continue;
      expect(settleKind(t.intro, 'ribbon', true)).toBe('fade');
    }
  });
});

describe('beam choreography stays inside the card contract', () => {
  for (const reduced of both) {
    it(`runs 2.5–6 s after the tap (reduced=${reduced})`, () => {
      const end = beamRevealLength(reduced);
      expect(end).toBeGreaterThanOrEqual(REVEAL_MIN_S);
      expect(end).toBeLessThanOrEqual(REVEAL_MAX_S);
      expect(end).toBe(beatsEnd(beamBeats(reduced)));
    });
  }

  it('tells its story in order: strike → seal breaks → prints fan out → calm → hold', () => {
    for (const reduced of both) {
      const b = beamBeats(reduced);
      const order: RevealBeat[] = [b.arm, b.strike, b.seal, b.fan, b.calm, b.hold];
      for (let i = 1; i < order.length; i++) expect(order[i].at).toBeGreaterThan(order[i - 1].at);
      // The seal flares once the beam has reached it.
      expect(b.flash.at + EPS).toBeGreaterThanOrEqual(b.strike.at + b.strike.dur * 0.8);
      // Nothing leaves the stack before the seal has broken.
      expect(b.fan.at).toBeGreaterThan(b.seal.at);
      // onDone fires on the landed album: the hold is last.
      expect(b.hold.at + b.hold.dur + EPS).toBeGreaterThanOrEqual(beatsEnd(b));
      // Everything has landed before the hold.
      expect(b.fan.at + b.fan.dur).toBeLessThanOrEqual(b.hold.at + EPS);
      expect(b.title.at + b.title.dur).toBeLessThanOrEqual(b.hold.at + EPS);
    }
  });

  it('reduced motion is gentler — every beat at least as slow — and never skipped', () => {
    const n = beamBeats(false);
    const r = beamBeats(true);
    for (const k of Object.keys(n) as (keyof typeof n)[]) expect(r[k].dur + EPS).toBeGreaterThanOrEqual(n[k].dur);
    expect(beamRevealLength(true)).toBeGreaterThan(REVEAL_MIN_S);
    expect(beamBudget(true, 390).idleMotes).toBeLessThan(beamBudget(false, 390).idleMotes);
    expect(beamBudget(true, 1440).burstMotes).toBeLessThan(beamBudget(false, 1440).burstMotes);
  });

  it('a phone gets fewer particles than a desktop', () => {
    expect(beamBudget(false, 390).idleMotes).toBeLessThan(beamBudget(false, 1440).idleMotes);
  });

  it('the last print lands exactly at the end of the fan beat', () => {
    for (const reduced of both) {
      const fan = beamBeats(reduced).fan;
      for (const n of [1, 2, 3, 5]) {
        const { stagger, each } = fanTiming(fan, n);
        expect(stagger * (n - 1) + each).toBeCloseTo(fan.dur, 9);
        expect(each).toBeGreaterThan(fan.dur * 0.6);
      }
    }
    expect(fanTiming(beamBeats(false).fan, 0).stagger).toBe(0);
  });

  it('the hand-off timings nest and the deadlines outlast the longest reveal', () => {
    expect(RECAP_REVEAL_FADE_MS).toBeLessThan(RECAP_REVEAL_HANDOFF_MS);
    expect(RECAP_REVEAL_DONE_DEADLINE_MS).toBeGreaterThan(REVEAL_MAX_S * 1000);
    expect(RECAP_REVEAL_LOAD_DEADLINE_MS).toBeGreaterThan(0);
  });
});

describe('the hero the beam lands on', () => {
  it('has one tilt per print, the middle on top', () => {
    expect(HERO_PRINT_TILT_DEG).toHaveLength(HERO_PRINTS);
    expect(heroPrintZ(2)).toBe(3);
    for (const i of [0, 1, 3, 4]) expect(heroPrintZ(i)).toBeLessThan(3);
    expect(heroPrintTilt(5)).toBe(HERO_PRINT_TILT_DEG[0]);
    expect(heroPrintTilt(-1)).toBe(HERO_PRINT_TILT_DEG[4]);
  });

  it('seals the stack with the top print square and the rest peeking out', () => {
    expect(stackPose(2)).toEqual({ x: -0, y: 0, rot: 0 });
    for (const i of [0, 1, 3, 4]) {
      const p = stackPose(i);
      expect(Math.abs(p.rot)).toBeGreaterThan(2);
      expect(p.y).toBeGreaterThan(0);
    }
    // Neighbours lean opposite ways.
    expect(Math.sign(stackPose(1).rot)).not.toBe(Math.sign(stackPose(0).rot));
  });

  it('falls back to a centred row of 3:4 prints when the album cannot be measured', () => {
    expect(fallbackHeroBoxes(390, 844, 0)).toEqual([]);
    const row = fallbackHeroBoxes(390, 844, 9);
    expect(row).toHaveLength(HERO_PRINTS);
    for (const b of row) {
      expect(b.h).toBeCloseTo((b.w * 4) / 3, 9);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(390);
    }
    const left = row[0].x;
    const right = 390 - (row[row.length - 1].x + row[row.length - 1].w);
    expect(left).toBeCloseTo(right, 6);
    expect(fallbackHeroBoxes(1440, 900, 3)[0].w).toBe(128);
  });

  it('says how much is inside, honestly', () => {
    expect(sealedLine(0)).toBe('Tap to open the album');
    expect(sealedLine(NaN)).toBe('Tap to open the album');
    expect(sealedLine(1)).toBe('1 moment inside');
    expect(sealedLine(1240)).toBe('1,240 moments inside');
  });
});

describe('the card-reveal adapter', () => {
  const post = (id: string, media: Post['media_type'], url = `https://x.supabase.co/storage/v1/object/public/posts/${id}.jpg`) => ({
    id,
    image_url: url,
    media_type: media,
  });

  it('titles the card with the event and addresses nobody', () => {
    const { card } = recapRevealCard({ title: '  Detola & Wuyi  ', eventDate: '2026-11-20T00:00:00Z', posts: [] });
    expect(card.title).toBe('Detola & Wuyi');
    expect(card.recipientName).toBeNull();
    expect(card.filmUrl).toBeNull();
    expect(card.publishedAt).toBe('2026-11-20T00:00:00Z');
    expect(recapRevealCard({ title: ' ', eventDate: null, posts: [] }).card.title).toBe('The event album');
  });

  it('hands over the stills as anonymous photo contributions, in album order, capped', () => {
    const posts = [
      post('a', 'image'),
      post('v', 'video'),
      post('b', 'image'),
      post('empty', 'image', ''),
      ...Array.from({ length: 10 }, (_, i) => post(`p${i}`, 'image')),
    ];
    const { contributions } = recapRevealCard({ title: 'Gala', eventDate: null, posts });
    expect(contributions).toHaveLength(CARD_REVEAL_PHOTOS);
    expect(contributions.map((c) => c.id).slice(0, 3)).toEqual(['a', 'b', 'p0']);
    for (const [i, c] of contributions.entries()) {
      expect(c.mediaType).toBe('photo');
      expect(c.contributorName).toBeNull();
      expect(c.message).toBeNull();
      expect(c.sortOrder).toBe(i);
      expect(c.url).toMatch(/^https:/);
    }
  });

  it('paints with the keepsake theme, every theme a valid palette', () => {
    for (const t of KEEPSAKE_THEMES) {
      const p = recapRevealPalette(t);
      expect(p.bg).toBe(t.palette.background);
      expect(p.fg).toBe(t.palette.ink);
      expect(p.accent).toBe(t.palette.accent);
      expect(p.accentRgb).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
    }
    expect(recapRevealPalette(keepsakeTheme('beamwall')).accentRgb).toBe('139, 125, 255');
  });

  it('covers every keepsake reveal id', () => {
    const ids: readonly KeepsakeRevealId[] = KEEPSAKE_REVEAL_IDS;
    expect(ids).toContain('beam');
    for (const o of CARD_REVEAL_OPTIONS) expect(ids).toContain(o.id);
  });
});
