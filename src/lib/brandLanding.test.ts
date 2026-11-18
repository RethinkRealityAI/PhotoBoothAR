import { describe, expect, it } from 'vitest';
import {
  CELEBRATIONS, EMOJI_RE, LAST_SECTION, LOOKS, POKE_IDLE, POKE_STREAK_MS, SECTIONS, WHEEL_COOLDOWN_MS, WHEEL_IDLE,
  WHEEL_THRESHOLD, clampSection, createReactionPicker, keyToNav, landingCopy, navigate, nearestFront,
  pickCelebration, pickReaction, pokeStep, releaseVelocity, sectionIndex, seededRandom, spinSettled, spinStep,
  startFacts, swipeDecision, wheelDecision, type Moment, type PokeState, type Reaction, type Spin, type WheelState,
} from './brandLanding';
import { ENTITLEMENTS } from './plans';
import { DEMO_KITS } from './demoKits';
import { AUDIENCES, DELIVER_STEPS, DONE_FOR_YOU, GREETING, HELLO, POKE_LINES, TOUR_STOPS } from './beamyTour';

describe('section state machine', () => {
  it('has six unique sections in the agreed order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['intro', 'pick', 'try', 'magic', 'how', 'start']);
    expect(sectionIndex('try')).toBe(2);
  });
  it('clamps next/back at both ends and jumps', () => {
    expect(navigate(0, 'back')).toBe(0);
    expect(navigate(0, 'next')).toBe(1);
    expect(navigate(LAST_SECTION, 'next')).toBe(LAST_SECTION);
    expect(navigate(3, 'first')).toBe(0);
    expect(navigate(1, 'last')).toBe(LAST_SECTION);
    expect(clampSection(-4)).toBe(0);
    expect(clampSection(99)).toBe(LAST_SECTION);
    expect(clampSection(Number.NaN)).toBe(0);
  });
});

describe('keyToNav', () => {
  it('maps arrows/page keys and leaves fields and controls alone', () => {
    expect(keyToNav('ArrowRight', false, false)).toBe('next');
    expect(keyToNav('ArrowLeft', false, false)).toBe('back');
    expect(keyToNav('PageDown', false, true)).toBe('next');
    expect(keyToNav('Home', false, false)).toBe('first');
    expect(keyToNav('End', false, false)).toBe('last');
    expect(keyToNav('Enter', false, false)).toBe('next');
    expect(keyToNav('Enter', false, true)).toBeNull();
    expect(keyToNav('ArrowRight', true, false)).toBeNull();
    expect(keyToNav('a', false, false)).toBeNull();
  });
});

describe('wheelDecision', () => {
  it('moves once per flick and swallows the inertia tail', () => {
    let s: WheelState = WHEEL_IDLE;
    const moves: string[] = [];
    // A trackpad flick: 30 events of 12px, 16ms apart, then a long tail.
    for (let i = 0; i < 80; i++) {
      const r = wheelDecision(s, 12, 1000 + i * 16);
      s = r.state;
      if (r.nav) moves.push(r.nav);
    }
    expect(moves).toEqual(['next']);
  });
  it('needs the threshold and resets on direction change or a pause', () => {
    let r = wheelDecision(WHEEL_IDLE, WHEEL_THRESHOLD - 1, 1000);
    expect(r.nav).toBeNull();
    r = wheelDecision(r.state, -10, 1010);
    expect(r.state.accum).toBe(-10);
    r = wheelDecision(r.state, 30, 2000);
    expect(r.state.accum).toBe(30);
  });
  it('moves again after the cooldown, backwards on negative deltas', () => {
    const a = wheelDecision(WHEEL_IDLE, 120, 1000);
    expect(a.nav).toBe('next');
    expect(wheelDecision(a.state, -120, 1000 + WHEEL_COOLDOWN_MS - 1).nav).toBeNull();
    expect(wheelDecision(a.state, -120, 1000 + WHEEL_COOLDOWN_MS + 300).nav).toBe('back');
  });
});

describe('swipeDecision', () => {
  it('reads up/left as next and down/right as back, ignoring small or slow drags', () => {
    expect(swipeDecision(0, -120, 200)).toBe('next');
    expect(swipeDecision(0, 120, 200)).toBe('back');
    expect(swipeDecision(-120, 10, 200)).toBe('next');
    expect(swipeDecision(120, 0, 200)).toBe('back');
    expect(swipeDecision(20, -30, 200)).toBeNull();
    expect(swipeDecision(0, -200, 1200)).toBeNull();
    expect(swipeDecision(100, -100, 200)).toBeNull();
  });
});

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
  const all = [...landingCopy(), ...tourCopy];

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
      'Welcome to your immersive photo booth', 'Every guest phone becomes the booth. Simple.',
      'Create your free event', 'Try the live demo',
    ]));
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
