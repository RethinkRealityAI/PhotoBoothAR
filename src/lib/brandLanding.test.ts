import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CELEBRATIONS, EMOJI_RE, EXPLAIN_STEPS, FILMS, LOOKS, NAV_LINKS, POKE_IDLE, POKE_STREAK_MS,
  createReactionPicker, landingCopy, nearestFront, pickCelebration, pickReaction, planCards, pokeStep,
  pricingSection, releaseVelocity, seededRandom, spinSettled, spinStep, startFacts,
  type Moment, type PokeState, type Reaction, type Spin,
} from './brandLanding';
import { ENTITLEMENTS, formatPostCap, formatRetention } from './plans';
import { DEMO_KITS } from './demoKits';
import { DEFAULT_LANDING_CONTENT } from './landingContent';
import { STOPS, stopIndex } from './beamyScroll';
import { AUDIENCES, DELIVER_STEPS, DONE_FOR_YOU, GREETING, HELLO, POKE_LINES, TOUR_STOPS } from './beamyTour';

describe('reactions', () => {
  const moments: Moment[] = ['intro', 'pick', 'snap', 'reveal', 'pick', 'pick', 'snap', 'snap', 'reveal', 'reveal'];
  it('never repeats a reaction back to back, across moments and draws', () => {
    for (let seed = 1; seed < 200; seed++) {
      const pick = createReactionPicker(seed);
      let last: Reaction | null = null;
      for (let i = 0; i < 60; i++) {
        const r = pick(moments[i % moments.length]);
        expect(r).not.toBe(last);
        last = r;
      }
    }
  });
  it('gives routine navigation no reaction', () => {
    expect(pickReaction('nav', null, 0.5)).toBe('none');
    const pick = createReactionPicker(7);
    expect(pick('nav')).toBe('none');
  });
  it('is deterministic for a seed', () => {
    const run = (seed: number) => { const p = createReactionPicker(seed); return moments.map((m) => p(m)); };
    expect(run(42)).toEqual(run(42));
    expect(seededRandom(9)()).toBe(seededRandom(9)());
  });
  it('mostly raises a hand for a pick, and only occasionally walks', () => {
    const counts: Record<string, number> = {};
    const rand = seededRandom(3);
    for (let i = 0; i < 4000; i++) {
      const r = pickReaction('pick', null, rand());
      counts[r] = (counts[r] ?? 0) + 1;
    }
    expect(counts.handSparkle).toBeGreaterThan(counts.handBeam);
    expect(counts.handBeam).toBeGreaterThan(counts.walk);
    expect(counts.walk).toBeGreaterThan(0);
  });
  it('picks celebrations without immediate repeats', () => {
    for (const last of [null, ...CELEBRATIONS]) {
      for (const r of [0, 0.3, 0.7, 0.9999]) expect(pickCelebration(last, r)).not.toBe(last);
    }
  });
});

describe('pokeStep', () => {
  it('escalates sparkle → burst → party on a streak, then starts over', () => {
    let s: PokeState = POKE_IDLE;
    const levels: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = pokeStep(s, 1000 + i * 300);
      s = r.state;
      levels.push(r.level);
    }
    expect(levels).toEqual(['sparkle', 'sparkle', 'burst', 'burst', 'party', 'sparkle']);
  });
  it('resets after a pause', () => {
    const a = pokeStep(pokeStep(pokeStep(POKE_IDLE, 0).state, 200).state, 400);
    expect(a.level).toBe('burst');
    expect(pokeStep(a.state, 400 + POKE_STREAK_MS + 1).level).toBe('sparkle');
  });
});

describe('spin physics', () => {
  it('settles a fling back to facing front within a few seconds', () => {
    for (const start of [{ angle: 0.4, vel: 12 }, { angle: -2.1, vel: -25 }, { angle: 5, vel: 0 }]) {
      let s: Spin = start;
      let t = 0;
      while (!spinSettled(s) && t < 6) { s = spinStep(s, 1 / 60); t += 1 / 60; }
      expect(spinSettled(s), JSON.stringify(start)).toBe(true);
      expect(Math.abs(s.angle - nearestFront(s.angle))).toBeLessThan(0.01);
    }
  });
  it('derives a bounded release velocity', () => {
    expect(releaseVelocity([{ x: 0, t: 0 }])).toBe(0);
    expect(releaseVelocity([{ x: 0, t: 0 }, { x: 100, t: 100 }])).toBeGreaterThan(0);
    expect(releaseVelocity([{ x: 0, t: 0 }, { x: -100000, t: 10 }])).toBe(-30);
  });
});

describe('copy', () => {
  const tourCopy = [
    HELLO, GREETING, DONE_FOR_YOU, ...POKE_LINES,
    ...DELIVER_STEPS.flatMap((s) => [s.title, s.body]),
    ...AUDIENCES.flatMap((a) => [a.title, a.hint, ...a.gets, ...TOUR_STOPS.map((s) => a.lines[s])]),
  ];
  const all = [...landingCopy(), ...tourCopy, ...STOPS.map((x) => x.label)];

  it('carries no emoji anywhere', () => {
    expect(EMOJI_RE.test('Party 🎉')).toBe(true);
    expect(EMOJI_RE.test('Plain text, with “quotes” — and ’ apostrophes')).toBe(false);
    for (const line of all) expect(line, line).not.toMatch(EMOJI_RE);
    for (const a of AUDIENCES) expect(Object.keys(a)).not.toContain('emoji');
    for (const s of DELIVER_STEPS) expect(Object.keys(s)).not.toContain('emoji');
  });

  it('never implies on-site staff (the service is fully remote)', () => {
    const banned = /on[- ]site|on the ground|in person|at your venue|our (team|staff|crew) (at|on|will be at)|we('| wi)ll (be there|show up|set up at)|technician|attendant|operator/i;
    for (const line of all) expect(line, line).not.toMatch(banned);
  });

  it('does not pitch the enterprise Studio', () => {
    for (const line of all) expect(line, line).not.toMatch(/\bstudio\b/i);
  });

  it('keeps the headline copy the owner asked for', () => {
    expect(landingCopy()).toEqual(expect.arrayContaining([
      'Welcome to your immersive booth', 'Every guest phone becomes the booth',
      'Create your free event', 'Try the live demo',
    ]));
  });

  it('points the header anchors at real stops on this page', () => {
    for (const n of NAV_LINKS) expect(stopIndex(n.stop), n.label).toBeGreaterThanOrEqual(0);
    expect(NAV_LINKS.map((n) => n.stop)).toEqual(['try', 'how', 'pricing']);
  });

  it('reuses the original landing’s explainer and film titles, in shorter, dash-free lines', () => {
    expect(EXPLAIN_STEPS.map((x) => x.title)).toEqual(DEFAULT_LANDING_CONTENT.howSteps.map((h) => h.title));
    expect(FILMS.map((f) => f.id)).toEqual(['booth', 'wall', 'challenges', 'cards']);
    for (const f of FILMS) {
      const d = DEFAULT_LANDING_CONTENT.features.find((x) => x.id === f.id);
      expect(d, f.id).toBeDefined();
      expect([f.eyebrow, f.title]).toEqual([d?.eyebrow, d?.title]);
      expect(f.line.length, f.id).toBeGreaterThan(0);
    }
    // Step bodies stay short (about two lines on a card).
    for (const x of EXPLAIN_STEPS) expect(x.body.length, x.title).toBeLessThanOrEqual(120);
  });

  it('keeps em dashes out of every line on the page', () => {
    for (const s of landingCopy()) expect(s, s).not.toMatch(/\u2014/);
  });

  it('shows the original landing’s plan cards, fact for fact', () => {
    // Drift guard: every price, unit, blurb and literal feature line must also
    // appear in Landing.tsx's TIERS (the derived limits are checked below).
    const src = readFileSync(new URL('../pages/Landing.tsx', import.meta.url), 'utf8');
    const cards = planCards();
    const derived = new Set(Object.values(ENTITLEMENTS).flatMap((e) => [formatPostCap(e.maxPosts, e.videoEnabled), formatRetention(e.retentionDays)]));
    expect(cards.map((c) => c.name)).toEqual(['Free', 'Essentials', 'Premium', 'Deluxe']);
    for (const c of cards) {
      for (const lit of [`name: '${c.name}'`, `price: '${c.price}'`, `unit: '${c.unit}'`, `blurb: '${c.blurb}'`]) expect(src, lit).toContain(lit);
      for (const f of c.features) {
        if (derived.has(f)) continue;
        expect(src, f).toContain(`'${f}'`);
      }
    }
    expect(cards.filter((c) => c.popular).map((c) => c.name)).toEqual(['Premium']);
    expect(cards[0].features).toContain(`Up to ${ENTITLEMENTS.free.maxPosts} photos`);
    expect(cards[2].features).toContain(`Photos kept for ${ENTITLEMENTS.premium.retentionDays} days`);
    expect(src).toContain('$79/month');
    expect(src).toContain('300 AI credits a month');
    expect(pricingSection().pro).toContain('$79/month');
  });

  it('offers looks that exist, covering every audience kit', () => {
    for (const l of LOOKS) if (l.kit !== null) expect(DEMO_KITS[l.kit], l.label).toBeDefined();
    const kits = new Set(LOOKS.map((l) => l.kit));
    for (const a of AUDIENCES) expect(kits.has(a.kit), a.id).toBe(true);
  });

  it('derives the Free facts from the plan table (no invented limits)', () => {
    const f = startFacts();
    expect(f.bullets.length).toBeLessThanOrEqual(3);
    expect(f.bullets).toContain(`Up to ${ENTITLEMENTS.free.maxPosts} photos`);
    expect(f.bullets).toContain(`Photos kept for ${ENTITLEMENTS.free.retentionDays} days`);
    for (const b of f.bullets) expect(b).not.toMatch(/\$|£|€/);
  });
});
