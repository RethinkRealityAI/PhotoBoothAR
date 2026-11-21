import { describe, it, expect } from 'vitest';
import {
  accentOf,
  cloneEventConfig,
  dayDiff,
  duplicateName,
  duplicateSlugCandidates,
  formatEventDate,
  groupEvents,
  humanDate,
  parseEventDate,
  type ListableEvent,
} from './eventList';

// Local-time constructors only (month is 0-indexed) — the module compares
// local calendar days, so tests must not build dates from UTC strings.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe('parseEventDate', () => {
  it('a bare YYYY-MM-DD is that LOCAL day', () => {
    const d = parseEventDate('2026-09-12')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 12]);
  });
  it('null for empty / garbage', () => {
    expect(parseEventDate(null)).toBeNull();
    expect(parseEventDate('')).toBeNull();
    expect(parseEventDate('not a date')).toBeNull();
  });
});

describe('dayDiff', () => {
  it('counts calendar days across month/year ends and DST', () => {
    expect(dayDiff(at(2026, 2, 1), at(2026, 1, 31))).toBe(1);
    expect(dayDiff(at(2027, 1, 1), at(2026, 12, 31))).toBe(1);
    expect(dayDiff(at(2026, 3, 9, 0), at(2026, 3, 7, 23))).toBe(2);
    expect(dayDiff(at(2026, 11, 2, 1), at(2026, 10, 31, 23))).toBe(2);
    expect(dayDiff(at(2026, 5, 1, 0), at(2026, 5, 1, 23))).toBe(0);
    expect(dayDiff(at(2026, 4, 30), at(2026, 5, 1))).toBe(-1);
  });
});

describe('formatEventDate', () => {
  const now = at(2026, 9, 9, 23);
  it('today / tomorrow / in N days / past', () => {
    expect(formatEventDate('2026-09-09', now)).toEqual({ day: 'Wed 9 Sep', relative: 'Today', past: false });
    expect(formatEventDate('2026-09-10', now)!.relative).toBe('Tomorrow');
    expect(formatEventDate('2026-09-12', now)).toEqual({ day: 'Sat 12 Sep', relative: 'in 3 days', past: false });
    expect(formatEventDate('2026-09-08', now)).toEqual({ day: 'Tue 8 Sep', relative: 'Past', past: true });
  });
  it('adds the year when it is not this year; null with no date', () => {
    expect(formatEventDate('2027-01-02', now)!.day).toBe('Sat 2 Jan 2027');
    expect(formatEventDate(null, now)).toBeNull();
  });
});

describe('humanDate', () => {
  it('always shows the year; passes junk through', () => {
    expect(humanDate('2026-09-12')).toBe('Sat 12 Sep 2026');
    expect(humanDate('soon')).toBe('soon');
  });
});

describe('groupEvents', () => {
  const now = at(2026, 9, 9);
  const ev = (id: string, status: string, starts_at: string | null, created_at = '2026-01-01T00:00:00Z'): ListableEvent => ({ id, status, starts_at, created_at });
  const events = [
    ev('live-today', 'live', '2026-09-09'),
    ev('live-past-date', 'live', '2026-09-01'),
    ev('draft-soon', 'draft', '2026-09-20'),
    ev('draft-sooner', 'draft', '2026-09-11'),
    ev('draft-undated-new', 'draft', null, '2026-08-01T00:00:00Z'),
    ev('draft-undated-old', 'draft', null, '2026-07-01T00:00:00Z'),
    ev('draft-dated-past', 'draft', '2026-08-01'),
    ev('ended-future', 'ended', '2026-12-01'),
    ev('ended-old', 'ended', '2026-03-01'),
  ];

  it('splits into upcoming / drafts / past', () => {
    const g = groupEvents(events, now);
    expect(g.upcoming.map((e) => e.id)).toEqual(['live-past-date', 'live-today']);
    expect(g.drafts.map((e) => e.id)).toEqual(['draft-sooner', 'draft-soon', 'draft-undated-new', 'draft-undated-old']);
    expect(g.past.map((e) => e.id)).toEqual(['ended-future', 'draft-dated-past', 'ended-old']);
  });

  it('never mutates the input order', () => {
    const ids = events.map((e) => e.id);
    groupEvents(events, now);
    expect(events.map((e) => e.id)).toEqual(ids);
  });
});

describe('accentOf', () => {
  it('themeVars first, then the frame palette, else null', () => {
    expect(accentOf({ themeVars: { '--color-accent': '#D4AF37' }, arContent: { framePalette: { accent: '#2FDD8B' } } })).toBe('#D4AF37');
    expect(accentOf({ arContent: { framePalette: { accent: '#2FDD8B' } } })).toBe('#2FDD8B');
    expect(accentOf({ themeVars: { '--color-accent': 'gold' } })).toBeNull();
    expect(accentOf(null)).toBeNull();
  });
});

describe('cloneEventConfig', () => {
  const src = {
    name: 'Old',
    themeVars: { '--color-accent': '#D4AF37' },
    arContent: { borderIds: ['dw-corners'] },
    primary_card: 'card-1',
    posterUrl: 'https://x/poster.png',
    defaultExperienceId: 'exp-uuid',
    copy: { eventName: 'Old', fullName: 'Old', tagline: 'Hi', generatedAt: '2026-01-01' },
    brief: { occasion: 'wedding' },
  };

  it('keeps the look and brief, renames, drops what belongs to the original', () => {
    const out = cloneEventConfig(src, 'New');
    expect(out).toEqual({
      name: 'New',
      themeVars: { '--color-accent': '#D4AF37' },
      arContent: { borderIds: ['dw-corners'] },
      copy: { eventName: 'New', fullName: 'New', tagline: 'Hi' },
      brief: { occasion: 'wedding' },
    });
  });

  it('keeps a built-in default frame; never mutates the source', () => {
    const snap = JSON.stringify(src);
    expect(cloneEventConfig({ ...src, defaultExperienceId: 'builtin:border:dw-corners' }, 'N').defaultExperienceId).toBe('builtin:border:dw-corners');
    const out = cloneEventConfig(src, 'N');
    (out.arContent as { borderIds: string[] }).borderIds.push('x');
    expect(JSON.stringify(src)).toBe(snap);
  });

  it('null config → just the copy names', () => {
    expect(cloneEventConfig(null, 'N')).toEqual({ copy: { eventName: 'N', fullName: 'N' } });
  });
});

describe('duplicate naming', () => {
  it('appends (copy) within 80 chars', () => {
    expect(duplicateName("Jenna's Wedding")).toBe("Jenna's Wedding (copy)");
    expect(duplicateName('x'.repeat(80))).toHaveLength(80);
  });
  it('slug candidates stay ≤63 chars with no doubled dash', () => {
    expect(duplicateSlugCandidates('jenna-wedding')).toEqual([
      'jenna-wedding-copy', 'jenna-wedding-copy-2', 'jenna-wedding-copy-3', 'jenna-wedding-copy-4', 'jenna-wedding-copy-5',
    ]);
    for (const s of duplicateSlugCandidates(`${'a'.repeat(57)}-bcdef`)) {
      expect(s.length).toBeLessThanOrEqual(63);
      expect(s).not.toMatch(/--/);
    }
  });
});

import { filterEvents, sortEvents, spotlightOf, nextAction, greetingFor, firstNameOf, statusBucket, type DashboardEvent } from './eventList';

const NOW = at(2026, 11, 19);
const ev = (p: Partial<DashboardEvent> & { id: string }): DashboardEvent => ({
  name: p.id, slug: p.id, status: 'live', created_at: '2026-01-01T00:00:00Z', starts_at: null, event_type: 'party', ...p,
});
const iso = (y: number, m: number, d: number) => at(y, m, d).toISOString();

describe('dashboard helpers', () => {
  const list = [
    ev({ id: 'live-today', status: 'live', starts_at: iso(2026, 11, 19), name: 'Zara Gala', event_type: 'gala' }),
    ev({ id: 'live-soon', status: 'live', starts_at: iso(2026, 12, 1), name: 'Ada Wedding', event_type: 'wedding' }),
    ev({ id: 'draft', status: 'draft', created_at: '2026-11-10T00:00:00Z', name: 'Beta Party' }),
    ev({ id: 'ended', status: 'ended', starts_at: iso(2026, 10, 1), name: 'Café Night' }),
    ev({ id: 'live-past', status: 'live', starts_at: iso(2026, 11, 1), name: 'Old Live' }),
  ];

  it('buckets by status and date', () => {
    expect(list.map((e) => statusBucket(e, NOW))).toEqual(['live', 'live', 'drafts', 'past', 'live']);
  });

  it('filters by status, type and accent-insensitive query', () => {
    expect(filterEvents(list, { status: 'live', type: null, query: '' }, NOW).map((e) => e.id)).toEqual(['live-today', 'live-soon', 'live-past']);
    expect(filterEvents(list, { status: 'all', type: 'wedding', query: '' }, NOW).map((e) => e.id)).toEqual(['live-soon']);
    expect(filterEvents(list, { status: 'all', type: null, query: 'cafe' }, NOW).map((e) => e.id)).toEqual(['ended']);
    expect(filterEvents(list, { status: 'all', type: null, query: '  ' }, NOW)).toHaveLength(5);
  });

  it('sorts without mutating', () => {
    const copy = [...list];
    expect(sortEvents(list, 'name', NOW).map((e) => e.name)).toEqual(['Ada Wedding', 'Beta Party', 'Café Night', 'Old Live', 'Zara Gala']);
    expect(sortEvents(list, 'event-date', NOW).map((e) => e.id)).toEqual(['live-past', 'live-today', 'live-soon', 'draft', 'ended']);
    expect(sortEvents(list, 'created', NOW)[0].id).toBe('draft');
    expect(list).toEqual(copy);
  });

  it('spotlights live first, then the newest draft, never the past', () => {
    expect(spotlightOf(list, NOW)?.id).toBe('live-today');
    expect(spotlightOf(list.filter((e) => e.status !== 'live'), NOW)?.id).toBe('draft');
    expect(spotlightOf([list[3]], NOW)).toBeNull();
  });

  it('picks one next action per state', () => {
    expect(list.map((e) => nextAction(e, NOW))).toEqual(['open-wall', 'share', 'go-live', 'recap', 'open-wall']);
    expect(nextAction(ev({ id: 'a', status: 'archived' }), NOW)).toBe('restore');
    expect(nextAction(ev({ id: 'u', status: 'live', starts_at: null }), NOW)).toBe('open-wall');
  });

  it('greets by hour and names by first name only', () => {
    expect([4, 5, 11, 12, 16, 17, 23].map(greetingFor)).toEqual(['Good evening', 'Good morning', 'Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening']);
    expect(firstNameOf({ display_name: '  Dapo Ajisafe ' })).toBe('Dapo');
    expect(firstNameOf({ full_name: 'Sam' })).toBe('Sam');
    expect(firstNameOf({ display_name: 'me@x.com' })).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf({ display_name: 0 })).toBeNull();
  });
});
