import { describe, expect, it } from 'vitest';
import {
  buildShareLink,
  clampIndex,
  contactCta,
  countUnfilled,
  currentPlanWeek,
  filterTemplates,
  keyToStep,
  normalizeRef,
  parseIsoDay,
  parseMarket,
  parseSlideHash,
  searchObjections,
  slideHash,
  splitUnfilled,
  swipeDirection,
  todayIso,
  withRef,
} from './salesHub';
import type { MessageTemplate } from './salesTypes';

describe('clampIndex', () => {
  it('clamps into range', () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(9, 5)).toBe(4);
  });
  it('an empty deck or a non-number clamps to 0', () => {
    expect(clampIndex(3, 0)).toBe(0);
    expect(clampIndex(Number.NaN, 5)).toBe(0);
  });
  it('truncates fractions', () => {
    expect(clampIndex(2.9, 5)).toBe(2);
  });
});

describe('slide hash', () => {
  it('is 1-based both ways', () => {
    expect(parseSlideHash('#3', 10)).toBe(2);
    expect(parseSlideHash('3', 10)).toBe(2);
    expect(slideHash(2)).toBe('#3');
    expect(parseSlideHash(slideHash(0), 1)).toBe(0);
  });
  it('rejects out-of-range and non-numeric hashes', () => {
    expect(parseSlideHash('#0', 10)).toBeNull();
    expect(parseSlideHash('#11', 10)).toBeNull();
    expect(parseSlideHash('#top', 10)).toBeNull();
    expect(parseSlideHash('', 10)).toBeNull();
    expect(parseSlideHash('#2.5', 10)).toBeNull();
    expect(parseSlideHash('#-1', 10)).toBeNull();
  });
});

describe('swipeDirection', () => {
  it('left swipe = next, right = prev', () => {
    expect(swipeDirection(-80, 5)).toBe('next');
    expect(swipeDirection(80, 5)).toBe('prev');
  });
  it('ignores taps and vertical scrolls', () => {
    expect(swipeDirection(-20, 0)).toBeNull();
    expect(swipeDirection(-60, 100)).toBeNull();
  });
});

describe('keyToStep', () => {
  it('maps presenter keys', () => {
    expect(keyToStep('ArrowRight')).toBe('next');
    expect(keyToStep(' ')).toBe('next');
    expect(keyToStep('PageDown')).toBe('next');
    expect(keyToStep('PageUp')).toBe('prev');
    expect(keyToStep('ArrowLeft')).toBe('prev');
    expect(keyToStep('Home')).toBe('first');
    expect(keyToStep('End')).toBe('last');
    expect(keyToStep('a')).toBeNull();
  });
});

describe('share links', () => {
  it('adds ?ref only when non-empty', () => {
    expect(buildShareLink('https://x.app', '/pitch/planners', '')).toBe('https://x.app/pitch/planners');
    expect(buildShareLink('https://x.app', '/pitch/planners', '   ')).toBe('https://x.app/pitch/planners');
    expect(buildShareLink('https://x.app', '/pitch/planners', null)).toBe('https://x.app/pitch/planners');
    expect(buildShareLink('https://x.app', '/pitch/planners', 'james')).toBe('https://x.app/pitch/planners?ref=james');
  });
  it('url-encodes the ref', () => {
    expect(buildShareLink('https://x.app', '/signup', 'a&b=c/d')).toBe('https://x.app/signup?ref=a%26b%3Dc%2Fd');
  });
  it('tolerates a trailing slash on origin and a missing slash on path', () => {
    expect(buildShareLink('https://x.app/', 'guides', '')).toBe('https://x.app/guides');
    expect(buildShareLink('https://x.app/', '/', 'j')).toBe('https://x.app/?ref=j');
  });
  it('keeps an existing query and hash', () => {
    expect(withRef('/a?x=1#3', 'j')).toBe('/a?x=1&ref=j#3');
    expect(withRef('/a#3', 'j')).toBe('/a?ref=j#3');
  });
  it('normalizeRef trims, strips spaces and caps length', () => {
    expect(normalizeRef(' ja mes ')).toBe('james');
    expect(normalizeRef('x'.repeat(60))).toHaveLength(40);
    expect(normalizeRef(undefined)).toBe('');
  });
});

describe('contactCta', () => {
  it('prefers a booking url', () => {
    expect(contactCta({ name: '', email: 'j@b.com', bookingUrl: 'https://cal.com/j' })).toEqual({
      href: 'https://cal.com/j',
      label: 'Book a call',
      external: true,
    });
  });
  it('falls back to mailto, then the site', () => {
    expect(contactCta({ name: '', email: 'j@b.com', bookingUrl: '' }).href).toBe('mailto:j@b.com');
    expect(contactCta({ name: '', email: '', bookingUrl: '' })).toEqual({ href: '/', label: 'Visit Beamwall', external: false });
  });
  it('refuses a non-http booking link and a junk email', () => {
    expect(contactCta({ name: '', email: 'not an email', bookingUrl: 'javascript:alert(1)' }).href).toBe('/');
  });
});

describe('template helpers', () => {
  const t = (over: Partial<MessageTemplate>): MessageTemplate => ({
    id: 'x',
    title: 'x',
    channel: 'email',
    stage: 'opener',
    icp: 'planners',
    market: 'any',
    body: '',
    when: '',
    ...over,
  });
  const list = [
    t({ id: 'a' }),
    t({ id: 'b', channel: 'instagram', icp: 'any' }),
    t({ id: 'c', channel: 'sms', stage: 'follow-up', icp: 'brands' }),
    t({ id: 'd', channel: 'whatsapp', market: 'ng' }),
    t({ id: 'e', market: 'na' }),
  ];
  it('filters by channel, stage and icp; any-icp matches every icp', () => {
    const f = { market: 'ng' as const, channel: 'all' as const, stage: 'all' as const, icp: 'all' as const };
    expect(filterTemplates(list, f).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterTemplates(list, { ...f, icp: 'brands' }).map((x) => x.id)).toEqual(['b', 'c']);
    expect(filterTemplates(list, { ...f, channel: 'sms' }).map((x) => x.id)).toEqual(['c']);
    expect(filterTemplates(list, { ...f, stage: 'follow-up' }).map((x) => x.id)).toEqual(['c']);
  });
  it('filters by market; any-market templates show in both', () => {
    const f = { market: 'na' as const, channel: 'all' as const, stage: 'all' as const, icp: 'all' as const };
    expect(filterTemplates(list, f).map((x) => x.id)).toEqual(['a', 'b', 'c', 'e']);
    expect(filterTemplates(list, { ...f, market: 'ng', channel: 'whatsapp' }).map((x) => x.id)).toEqual(['d']);
  });
  it('parseMarket defaults to Nigeria', () => {
    expect(parseMarket('na')).toBe('na');
    expect(parseMarket('ng')).toBe('ng');
    expect(parseMarket(null)).toBe('ng');
    expect(parseMarket('xx')).toBe('ng');
  });
  it('marks only real unfilled tokens', () => {
    const segs = splitUnfilled('Hi [firstName], see [note] at [deckLink].');
    expect(segs.filter((s) => s.token).map((s) => s.text)).toEqual(['[firstName]', '[deckLink]']);
    expect(segs.map((s) => s.text).join('')).toBe('Hi [firstName], see [note] at [deckLink].');
    expect(countUnfilled('all filled')).toBe(0);
    expect(splitUnfilled('')).toEqual([]);
  });
});

describe('searchObjections', () => {
  const list = [
    { objection: 'Too expensive', answer: 'Compare to a booth rental.' },
    { objection: 'Guests will not scan', answer: 'No app needed.' },
  ];
  it('matches every word, case-insensitively, across both fields', () => {
    expect(searchObjections(list, 'BOOTH')).toHaveLength(1);
    expect(searchObjections(list, 'no app')).toHaveLength(1);
    expect(searchObjections(list, 'expensive app')).toHaveLength(0);
    expect(searchObjections(list, '  ')).toHaveLength(2);
  });
});

describe('plan week', () => {
  it('parses only real calendar days', () => {
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('2026-2-3')).toBeNull();
    expect(parseIsoDay('2026-11-17')?.getDate()).toBe(17);
  });
  it('counts calendar weeks from the start day', () => {
    expect(currentPlanWeek('2026-11-17', new Date(2026, 10, 16), 4)).toBeNull();
    expect(currentPlanWeek('2026-11-17', new Date(2026, 10, 17, 23, 59), 4)).toBe(1);
    expect(currentPlanWeek('2026-11-17', new Date(2026, 10, 23), 4)).toBe(1);
    expect(currentPlanWeek('2026-11-17', new Date(2026, 10, 24), 4)).toBe(2);
    expect(currentPlanWeek('2026-11-17', new Date(2027, 0, 30), 4)).toBe(4);
    expect(currentPlanWeek('junk', new Date(), 4)).toBeNull();
  });
  it('crosses a DST boundary without slipping a day', () => {
    // US DST ends 2026-11-01.
    expect(currentPlanWeek('2026-10-26', new Date(2026, 10, 2), 4)).toBe(2);
  });
  it('todayIso pads', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('route wiring', () => {
  it('App.tsx hub route literal matches SALES_HUB_PATH, and netlify noindex covers it', async () => {
    const { readFileSync } = await import('node:fs');
    const { SALES_HUB_PATH, PITCH_BASE } = await import('./salesTypes');
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain(`<Route path="${SALES_HUB_PATH}"`);
    expect(app).toContain(`<Route path="${PITCH_BASE}/:slug"`);
    // App must not import the sales contract eagerly (bundle size, see App.tsx).
    expect(app).not.toMatch(/from '\.\/lib\/sales/);
    const netlify = readFileSync('netlify.toml', 'utf8');
    const prefix = SALES_HUB_PATH.split('/').slice(0, 2).join('/');
    expect(netlify).toContain(`for = "${prefix}/*"`);
    expect(netlify).toContain(`for = "${PITCH_BASE}/*"`);
  });
});
