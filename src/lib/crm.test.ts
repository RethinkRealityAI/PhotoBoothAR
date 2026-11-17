/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  addDaysToKey, applyCollateral, centsToInput, collateralFor, csvCell, CSV_COLUMNS, daysBetweenKeys,
  DAILY_TOUCH_TARGET, dialable, draftFromProspect, filterProspects, followUpLabel, followUpState,
  formatCents, formatCentsCompact, localDateKey, normalizeUrl, parseDateKey, parseDollarsToCents,
  pipelineSummary, PROSPECT_STATUSES, prospectsToCsv, quickContactToDraft, sentAgo, shareLink,
  sortForWorklist, startOfLocalDayIso, statusAfterTouch, templateVarsFor, toInsertPayload,
  touchesToday, validateProspectDraft, whatsappLink, templatesFor, friendlyCrmError, NOT_SET_UP_MESSAGE,
  validRefCode, type Activity, type Prospect,
} from './crm';
import type { MessageTemplate } from './salesTypes';

function prospect(over: Partial<Prospect> = {}): Prospect {
  return {
    id: 'p1', owner_id: 'u1', name: 'Jane Doe', company: null, role: null, icp: 'planners', market: 'ng',
    email: null, phone: null, website: null, location: null, socials: {}, source: null,
    status: 'new', deal_value_cents: null, next_follow_up: null, last_contacted_at: null,
    notes: null, collateral: {}, tags: [], created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z', ...over,
  };
}

describe('statuses', () => {
  it('lists the eight DB statuses in pipeline order', () => {
    expect(PROSPECT_STATUSES.map((s) => s.id)).toEqual(
      ['new', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost', 'nurture'],
    );
  });
  it('exports a positive daily target', () => {
    expect(DAILY_TOUCH_TARGET).toBe(20);
  });
});

describe('normalizeUrl', () => {
  it('returns null for empty / whitespace', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl(undefined)).toBeNull();
  });
  it('accepts bare domains and paths', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('www.example.co.uk/about')).toBe('https://www.example.co.uk/about');
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com/');
  });
  it('upgrades http to https and keeps https', () => {
    expect(normalizeUrl('http://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeUrl('HTTPS://Example.com')).toBe('https://example.com/');
  });
  it('rejects dangerous or non-web schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('JavaScript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html,<script>')).toBeNull();
    expect(normalizeUrl('mailto:a@b.co')).toBeNull();
    expect(normalizeUrl('ftp://example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)', 'instagram')).toBeNull();
  });
  it('rejects http without a real host', () => {
    expect(normalizeUrl('http://')).toBeNull();
    expect(normalizeUrl('https://')).toBeNull();
    expect(normalizeUrl('https:example.com')).toBeNull();
    expect(normalizeUrl('https://localhost')).toBeNull();
    expect(normalizeUrl('foo')).toBeNull();
    expect(normalizeUrl('https://1.2.3.4')).toBeNull();
  });
  it('rejects credentials, whitespace and over-long URLs', () => {
    expect(normalizeUrl('https://user:pw@example.com')).toBeNull();
    expect(normalizeUrl('exa mple.com')).toBeNull();
    expect(normalizeUrl(`example.com/${'a'.repeat(600)}`)).toBeNull();
  });
  it('builds profile URLs from @handles', () => {
    expect(normalizeUrl('@jane', 'instagram')).toBe('https://www.instagram.com/jane/');
    expect(normalizeUrl('@jane', 'tiktok')).toBe('https://www.tiktok.com/@jane');
    expect(normalizeUrl('@jane', 'x')).toBe('https://x.com/jane');
    expect(normalizeUrl('@jane', 'youtube')).toBe('https://www.youtube.com/@jane');
    expect(normalizeUrl('jane-doe', 'linkedin')).toBe('https://www.linkedin.com/in/jane-doe');
    expect(normalizeUrl('janedoe', 'facebook')).toBe('https://www.facebook.com/janedoe');
  });
  it('treats a dotted bare word in a social field as a handle, not a domain', () => {
    expect(normalizeUrl('jane.doe', 'instagram')).toBe('https://www.instagram.com/jane.doe/');
  });
  it('keeps real platform URLs in a social field', () => {
    expect(normalizeUrl('instagram.com/jane', 'instagram')).toBe('https://instagram.com/jane');
    expect(normalizeUrl('http://www.linkedin.com/in/jane', 'linkedin')).toBe('https://www.linkedin.com/in/jane');
  });
  it('rejects handles with illegal characters', () => {
    expect(normalizeUrl('@ja<ne', 'instagram')).toBeNull();
    expect(normalizeUrl('@', 'instagram')).toBeNull();
  });
});

describe('parseDollarsToCents', () => {
  it('parses whole and fractional dollars without float drift', () => {
    expect(parseDollarsToCents('1500')).toEqual({ ok: true, cents: 150000 });
    expect(parseDollarsToCents('1,500')).toEqual({ ok: true, cents: 150000 });
    expect(parseDollarsToCents('1500.50')).toEqual({ ok: true, cents: 150050 });
    expect(parseDollarsToCents('1500.5')).toEqual({ ok: true, cents: 150050 });
    expect(parseDollarsToCents('0.29')).toEqual({ ok: true, cents: 29 });
    expect(parseDollarsToCents('$99')).toEqual({ ok: true, cents: 9900 });
    expect(parseDollarsToCents('.5')).toEqual({ ok: true, cents: 50 });
    expect(parseDollarsToCents('12,345,678.99')).toEqual({ ok: true, cents: 1234567899 });
  });
  it('treats 0 as a real value, and empty as null', () => {
    expect(parseDollarsToCents('0')).toEqual({ ok: true, cents: 0 });
    expect(parseDollarsToCents('0.00')).toEqual({ ok: true, cents: 0 });
    expect(parseDollarsToCents('')).toEqual({ ok: true, cents: null });
    expect(parseDollarsToCents('  ')).toEqual({ ok: true, cents: null });
    expect(parseDollarsToCents(undefined)).toEqual({ ok: true, cents: null });
  });
  it('rejects garbage, negatives, 3 decimals, bad grouping, and int overflow', () => {
    for (const bad of ['-5', 'abc', '1.234', '1,50', '1,,500', '.', '$', '1e3', '21474837', '99999999999']) {
      expect(parseDollarsToCents(bad).ok, bad).toBe(false);
    }
    expect(parseDollarsToCents('21474836.47')).toEqual({ ok: true, cents: 2147483647 });
    expect(parseDollarsToCents('21474836.48').ok).toBe(false);
  });
  it('round-trips through centsToInput and formats', () => {
    expect(centsToInput(150050)).toBe('1500.50');
    expect(centsToInput(150000)).toBe('1500');
    expect(centsToInput(0)).toBe('0');
    expect(centsToInput(null)).toBe('');
    expect(formatCents(150050)).toBe('$1,500.50');
    expect(formatCents(0)).toBe('$0');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCentsCompact(150000)).toBe('$1.5k');
    expect(formatCentsCompact(100000)).toBe('$1k');
    expect(formatCentsCompact(125000000)).toBe('$1.25M');
    expect(formatCentsCompact(9900)).toBe('$99');
    expect(formatCents(150000000, 'ng')).toBe('₦1,500,000');
    expect(formatCentsCompact(150000000, 'ng')).toBe('₦1.5M');
  });
  it('accepts a naira prefix', () => {
    expect(parseDollarsToCents('₦250,000')).toEqual({ ok: true, cents: 25000000 });
    expect(parseDollarsToCents('NGN 5000')).toEqual({ ok: true, cents: 500000 });
  });
});

describe('calendar-day keys', () => {
  it('localDateKey uses local parts', () => {
    expect(localDateKey(new Date(2026, 10, 17, 23, 59))).toBe('2026-11-17');
    expect(localDateKey(new Date(2026, 10, 18, 0, 1))).toBe('2026-11-18');
  });
  it('parseDateKey is strict', () => {
    expect(parseDateKey('2026-11-17')).toEqual([2026, 11, 17]);
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('2026-1-1')).toBeNull();
    expect(parseDateKey('')).toBeNull();
    expect(parseDateKey(null)).toBeNull();
  });
  it('addDaysToKey crosses months, years, leap days and DST', () => {
    expect(addDaysToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDaysToKey('2026-11-01', 7)).toBe('2026-11-08');
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('daysBetweenKeys', () => {
    expect(daysBetweenKeys('2026-11-17', '2026-11-20')).toBe(3);
    expect(daysBetweenKeys('2026-11-17', '2026-11-10')).toBe(-7);
    expect(daysBetweenKeys('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetweenKeys('bad', '2026-11-10')).toBeNull();
  });
  it('startOfLocalDayIso is local midnight', () => {
    const iso = startOfLocalDayIso(new Date(2026, 10, 17, 15, 0));
    const d = new Date(iso);
    expect(localDateKey(d)).toBe('2026-11-17');
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});

describe('followUpState', () => {
  const key = '2026-11-17';
  it('is "today" across the whole local day, even late at night (no UTC shift)', () => {
    expect(followUpState(prospect({ next_follow_up: key }), new Date(2026, 10, 17, 0, 5))).toBe('today');
    // 11:30pm in Toronto is already the 18th in UTC — must still be today.
    expect(followUpState(prospect({ next_follow_up: key }), new Date(2026, 10, 17, 23, 30))).toBe('today');
  });
  it('flips to overdue only after local midnight', () => {
    expect(followUpState(prospect({ next_follow_up: key }), new Date(2026, 10, 18, 0, 1))).toBe('overdue');
  });
  it('is "soon" within 3 days, then none', () => {
    const today = new Date(2026, 10, 14, 9);
    expect(followUpState(prospect({ next_follow_up: key }), today)).toBe('soon');
    expect(followUpState(prospect({ next_follow_up: '2026-11-18' }), today)).toBe('none');
    expect(followUpState(prospect({ next_follow_up: '2026-11-15' }), new Date(2026, 10, 14, 23, 59))).toBe('soon');
  });
  it('is none for no date, invalid dates, and closed deals', () => {
    const today = new Date(2026, 10, 20);
    expect(followUpState(prospect(), today)).toBe('none');
    expect(followUpState(prospect({ next_follow_up: 'nope' }), today)).toBe('none');
    expect(followUpState(prospect({ next_follow_up: key, status: 'won' }), today)).toBe('none');
    expect(followUpState(prospect({ next_follow_up: key, status: 'lost' }), today)).toBe('none');
    expect(followUpState(prospect({ next_follow_up: key, status: 'nurture' }), today)).toBe('overdue');
  });
  it('labels', () => {
    const today = new Date(2026, 10, 17, 12);
    expect(followUpLabel('2026-11-17', today)).toBe('Due today');
    expect(followUpLabel('2026-11-18', today)).toBe('Tomorrow');
    expect(followUpLabel('2026-11-16', today)).toBe('Overdue 1 day');
    expect(followUpLabel('2026-11-10', today)).toBe('Overdue 7 days');
    expect(followUpLabel('2026-11-20', today)).toBe('In 3 days');
    expect(followUpLabel('2026-12-25', today)).toBe('Fri, Dec 25');
  });
});

describe('sentAgo', () => {
  const now = new Date(2026, 10, 17, 10);
  it('counts by local day', () => {
    expect(sentAgo(new Date(2026, 10, 17, 0, 1).toISOString(), now)).toBe('Sent today');
    expect(sentAgo(new Date(2026, 10, 16, 23, 59).toISOString(), now)).toBe('Sent yesterday');
    expect(sentAgo(new Date(2026, 10, 14, 12).toISOString(), now)).toBe('Sent 3 days ago');
    expect(sentAgo('garbage', now)).toBe('Sent');
  });
});

describe('validateProspectDraft', () => {
  it('needs only a name', () => {
    expect(validateProspectDraft({ name: 'Jane' })).toEqual({ ok: true, errors: {} });
  });
  it('rejects blank and over-long names', () => {
    expect(validateProspectDraft({ name: '   ' }).errors.name).toBeDefined();
    expect(validateProspectDraft({ name: 'a'.repeat(201) }).errors.name).toBeDefined();
    expect(validateProspectDraft({ name: 'a'.repeat(200) }).ok).toBe(true);
  });
  it('checks email shape and length', () => {
    expect(validateProspectDraft({ name: 'J', email: 'jane@' }).errors.email).toBeDefined();
    expect(validateProspectDraft({ name: 'J', email: 'jane@example' }).errors.email).toBeDefined();
    expect(validateProspectDraft({ name: 'J', email: ' jane@example.com ' }).ok).toBe(true);
    expect(validateProspectDraft({ name: 'J', email: `${'a'.repeat(250)}@x.co` }).errors.email).toBeDefined();
  });
  it('mirrors the SQL length caps', () => {
    const r = validateProspectDraft({
      name: 'J', company: 'c'.repeat(201), role: 'r'.repeat(121), phone: '1'.repeat(41),
      location: 'l'.repeat(121), source: 's'.repeat(121), notes: 'n'.repeat(20001),
    });
    expect(Object.keys(r.errors).sort()).toEqual(['company', 'location', 'notes', 'phone', 'role', 'source']);
    expect(validateProspectDraft({ name: 'J', notes: 'n'.repeat(20000), phone: '1'.repeat(40) }).ok).toBe(true);
  });
  it('flags bad urls, socials, money, dates, enums', () => {
    const r = validateProspectDraft({
      name: 'J', website: 'javascript:alert(1)', socials: { instagram: '@ok', x: 'bad handle!' },
      dealValue: '12.345', nextFollowUp: '2026-02-30', icp: 'aliens', status: 'maybe',
    });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(
      ['dealValue', 'icp', 'nextFollowUp', 'socials.x', 'status', 'website'],
    );
  });
  it('accepts a 0 deal value and "other" icp', () => {
    expect(validateProspectDraft({ name: 'J', dealValue: '0', icp: 'other' }).ok).toBe(true);
  });
});

describe('toInsertPayload', () => {
  it('trims, nulls empties and defaults enums', () => {
    expect(toInsertPayload({ name: '  Jane  ', company: '  ', email: '' })).toEqual({
      name: 'Jane', company: null, role: null, icp: 'planners', market: 'ng', email: null, phone: null,
      website: null, location: null, source: null, status: 'new', deal_value_cents: null,
      next_follow_up: null, notes: null, socials: {},
    });
  });
  it('normalizes socials and website, dropping blanks and invalid ones', () => {
    const p = toInsertPayload({
      name: 'J', website: 'http://acme.co', socials: { instagram: '@jane', tiktok: '', x: 'no good!' },
    });
    expect(p.website).toBe('https://acme.co/');
    expect(p.socials).toEqual({ instagram: 'https://www.instagram.com/jane/' });
  });
  it('converts dollars to integer cents, keeping 0', () => {
    expect(toInsertPayload({ name: 'J', dealValue: '1,500' }).deal_value_cents).toBe(150000);
    expect(toInsertPayload({ name: 'J', dealValue: '1500.50' }).deal_value_cents).toBe(150050);
    expect(toInsertPayload({ name: 'J', dealValue: '0' }).deal_value_cents).toBe(0);
    expect(toInsertPayload({ name: 'J', dealValue: 'lots' }).deal_value_cents).toBeNull();
    expect(Number.isInteger(toInsertPayload({ name: 'J', dealValue: '0.29' }).deal_value_cents)).toBe(true);
  });
  it('keeps valid dates and enums, drops invalid ones', () => {
    const p = toInsertPayload({ name: 'J', nextFollowUp: '2026-11-20', icp: 'brands', status: 'meeting' });
    expect(p.next_follow_up).toBe('2026-11-20');
    expect(p.icp).toBe('brands');
    expect(p.status).toBe('meeting');
    expect(toInsertPayload({ name: 'J', nextFollowUp: '11/20/2026' }).next_follow_up).toBeNull();
  });
  it('defaults the market to Nigeria and keeps an explicit one', () => {
    expect(toInsertPayload({ name: 'J' }).market).toBe('ng');
    expect(toInsertPayload({ name: 'J', market: 'na' }).market).toBe('na');
    expect(toInsertPayload({ name: 'J', market: 'eu' }).market).toBe('ng');
    expect(validateProspectDraft({ name: 'J', market: 'eu' }).errors.market).toBeDefined();
    expect(validateProspectDraft({ name: 'J', market: 'na' }).ok).toBe(true);
  });
  it('never sends owner_id (the DB defaults it to auth.uid())', () => {
    expect('owner_id' in toInsertPayload({ name: 'J' })).toBe(false);
  });
  it('round-trips with draftFromProspect', () => {
    const row = prospect({
      company: 'Acme', deal_value_cents: 150050, market: 'na', next_follow_up: '2026-11-20', icp: 'brands',
      socials: { instagram: 'https://www.instagram.com/jane/' }, website: 'https://acme.co/',
    });
    const back = toInsertPayload(draftFromProspect(row));
    expect(back.company).toBe('Acme');
    expect(back.deal_value_cents).toBe(150050);
    expect(back.next_follow_up).toBe('2026-11-20');
    expect(back.socials).toEqual({ instagram: 'https://www.instagram.com/jane/' });
    expect(back.website).toBe('https://acme.co/');
    expect(back.market).toBe('na');
  });
});

describe('quickContactToDraft', () => {
  it('routes emails, handles and links', () => {
    expect(quickContactToDraft('jane@acme.co', 'instagram')).toEqual({ email: 'jane@acme.co' });
    expect(quickContactToDraft('@jane', 'instagram')).toEqual({ socials: { instagram: '@jane' } });
    expect(quickContactToDraft('jane.doe', 'instagram')).toEqual({ socials: { instagram: 'jane.doe' } });
    expect(quickContactToDraft('linkedin.com/in/jane', 'linkedin')).toEqual({ socials: { linkedin: 'linkedin.com/in/jane' } });
    expect(quickContactToDraft('https://acme.co/team', 'instagram')).toEqual({ website: 'https://acme.co/team' });
    expect(quickContactToDraft('   ', 'instagram')).toEqual({});
    expect(quickContactToDraft('0803 123 4567', 'instagram')).toEqual({ phone: '0803 123 4567' });
    expect(quickContactToDraft('+1 (416) 555-0100', 'x')).toEqual({ phone: '+1 (416) 555-0100' });
    expect(quickContactToDraft('2024', 'instagram')).toEqual({ socials: { instagram: '2024' } });
  });
});

describe('filterProspects / sortForWorklist', () => {
  const today = new Date(2026, 10, 17, 10);
  const list = [
    prospect({ id: 'a', name: 'Ada Lovelace', company: 'Engines Ltd', icp: 'brands', status: 'contacted', next_follow_up: '2026-11-15', owner_id: 'u1' }),
    prospect({ id: 'b', name: 'Bea Planner', icp: 'planners', status: 'new', next_follow_up: '2026-11-17', owner_id: 'u2', notes: 'met at Toronto wedding show' }),
    prospect({ id: 'c', name: 'Cy Creator', icp: 'creators', status: 'won', next_follow_up: '2026-11-10', socials: { tiktok: 'https://www.tiktok.com/@cyc' } }),
    prospect({ id: 'd', name: 'Di', icp: 'planners', status: 'meeting', next_follow_up: '2026-11-19', updated_at: '2026-11-05T00:00:00Z' }),
    prospect({ id: 'e', name: 'Ed', icp: 'other', status: 'nurture', market: 'na' }),
  ];
  const ids = (l: Prospect[]) => l.map((p) => p.id);
  it('searches across fields, all words must match, case-insensitive', () => {
    expect(ids(filterProspects(list, { query: 'engines' }, today))).toEqual(['a']);
    expect(ids(filterProspects(list, { query: 'TORONTO wedding' }, today))).toEqual(['b']);
    expect(ids(filterProspects(list, { query: 'cyc' }, today))).toEqual(['c']);
    expect(ids(filterProspects(list, { query: 'toronto ada' }, today))).toEqual([]);
    expect(filterProspects(list, { query: '   ' }, today)).toHaveLength(5);
  });
  it('filters by status, open, icp, owner and due', () => {
    expect(ids(filterProspects(list, { status: 'won' }, today))).toEqual(['c']);
    expect(ids(filterProspects(list, { status: 'open' }, today))).toEqual(['a', 'b', 'd', 'e']);
    expect(ids(filterProspects(list, { icp: 'planners' }, today))).toEqual(['b', 'd']);
    expect(ids(filterProspects(list, { owner: 'u2' }, today))).toEqual(['b']);
    expect(ids(filterProspects(list, { market: 'na' }, today))).toEqual(['e']);
    expect(filterProspects(list, { market: 'ng' }, today)).toHaveLength(4);
    expect(ids(filterProspects(list, { due: 'due' }, today))).toEqual(['a', 'b']);
    expect(ids(filterProspects(list, { due: 'overdue' }, today))).toEqual(['a']);
    expect(ids(filterProspects(list, { due: 'soon' }, today))).toEqual(['d']);
    expect(ids(filterProspects(list, { status: null, icp: null, due: null }, today))).toHaveLength(5);
  });
  it('orders the worklist overdue → today → soon → rest → closed, without mutating', () => {
    const before = ids(list);
    expect(ids(sortForWorklist(list, today))).toEqual(['a', 'b', 'd', 'e', 'c']);
    expect(ids(list)).toEqual(before);
  });
});

describe('pipelineSummary', () => {
  it('counts per status and sums open value PER MARKET, treating null as 0 and keeping 0', () => {
    const today = new Date(2026, 10, 17, 10);
    const s = pipelineSummary([
      prospect({ status: 'new', deal_value_cents: 0, next_follow_up: '2026-11-17' }),
      prospect({ status: 'proposal', deal_value_cents: 250000, next_follow_up: '2026-11-01' }),
      prospect({ status: 'meeting', deal_value_cents: null, market: 'na' }),
      prospect({ status: 'contacted', deal_value_cents: 70000, market: 'na' }),
      prospect({ status: 'won', deal_value_cents: 99900 }),
      prospect({ status: 'lost', deal_value_cents: 500000 }),
    ], today);
    expect(s.total).toBe(6);
    expect(s.open).toBe(4);
    expect(s.openValueByMarket).toEqual({ ng: 250000, na: 70000 });
    expect(s.openByMarket).toEqual({ ng: 2, na: 2 });
    expect(s.wonValueByMarket).toEqual({ ng: 99900, na: 0 });
    expect(s.counts).toEqual({ new: 1, contacted: 1, replied: 0, meeting: 1, proposal: 1, won: 1, lost: 1, nurture: 0 });
    expect(s.overdue).toBe(1);
    expect(s.dueToday).toBe(1);
  });
  it('handles an empty list', () => {
    expect(pipelineSummary([]).openValueByMarket).toEqual({ ng: 0, na: 0 });
  });
});

describe('touchesToday', () => {
  const now = new Date(2026, 10, 17, 9, 0);
  const act = (over: Partial<Activity>): Activity => ({
    id: 'x', prospect_id: 'p', actor_id: 'me', kind: 'dm', channel: null, body: null,
    created_at: new Date(2026, 10, 17, 8).toISOString(), ...over,
  });
  it('counts only my touch kinds on my local day', () => {
    const list = [
      act({}),
      act({ kind: 'email' }),
      act({ kind: 'call' }),
      act({ kind: 'meeting' }),
      act({ kind: 'note' }),
      act({ kind: 'status' }),
      act({ actor_id: 'someone-else' }),
      act({ actor_id: null }),
      act({ created_at: new Date(2026, 10, 17, 23, 59).toISOString() }), // late tonight: today
      act({ created_at: new Date(2026, 10, 16, 23, 59).toISOString() }), // last night: not
      act({ created_at: new Date(2026, 10, 18, 0, 1).toISOString() }),   // after midnight: not
      act({ created_at: 'not a date' }),
    ];
    expect(touchesToday(list, 'me', now)).toBe(5);
  });
});

describe('statusAfterTouch', () => {
  it('advances new → contacted on a touch only', () => {
    expect(statusAfterTouch('new', 'dm')).toBe('contacted');
    expect(statusAfterTouch('new', 'meeting')).toBe('contacted');
    expect(statusAfterTouch('new', 'note')).toBe('new');
    expect(statusAfterTouch('replied', 'call')).toBe('replied');
  });
});

describe('collateral', () => {
  it('applyCollateral stamps, keeps the first stamp, and removes, without mutating', () => {
    const cur = { guides: '2026-11-01T00:00:00.000Z' };
    const added = applyCollateral(cur, 'live-demo', true, '2026-11-17T00:00:00.000Z');
    expect(added).toEqual({ guides: '2026-11-01T00:00:00.000Z', 'live-demo': '2026-11-17T00:00:00.000Z' });
    expect(cur).toEqual({ guides: '2026-11-01T00:00:00.000Z' });
    expect(applyCollateral(added, 'guides', true, 'later')).toEqual(added);
    expect(applyCollateral(added, 'guides', false, 'x')).toEqual({ 'live-demo': '2026-11-17T00:00:00.000Z' });
    expect(applyCollateral(null, 'a', true, 't')).toEqual({ a: 't' });
  });
  it('shareLink adds ?ref only when there is a code', () => {
    expect(shareLink('https://beamwall.app', '/pitch/planners', 'jamesa')).toBe('https://beamwall.app/pitch/planners?ref=jamesa');
    expect(shareLink('https://beamwall.app', '/', null)).toBe('https://beamwall.app/');
    expect(shareLink('https://beamwall.app', '/guides', '  ')).toBe('https://beamwall.app/guides');
    expect(shareLink('https://beamwall.app', undefined, 'jamesa')).toBeNull();
  });
  it('collateralFor puts the prospect market\'s ICP deck first, the other market collapsed', () => {
    const ng = collateralFor('brands', 'ng');
    expect(ng.primary[0].id).toBe('deck-ng-brands');
    expect(ng.primary.map((c) => c.id)).toContain('guides');
    expect(ng.primary.map((c) => c.id)).not.toContain('deck-brands');
    expect(ng.primary.map((c) => c.id)).not.toContain('deck-ng-planners');
    expect(ng.other.map((c) => c.id)).toEqual(['deck-brands']);
    const na = collateralFor('planners', 'na');
    expect(na.primary[0].id).toBe('deck-planners');
    expect(na.other.map((c) => c.id)).toEqual(['deck-ng-planners']);
    const other = collateralFor('other', 'ng');
    expect(other.primary.filter((c) => c.market === 'ng')).toHaveLength(3);
    expect(other.other).toHaveLength(3);
  });
});

describe('CSV', () => {
  it('escapes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(0)).toBe('0');
  });
  it('defuses formula injection', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+1 416 555 0100')).toBe("'+1 416 555 0100");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('a=b')).toBe('a=b');
  });
  it('exports a header and one row per prospect', () => {
    const csv = prospectsToCsv([
      prospect({ name: '=cmd', company: 'Acme, Inc', deal_value_cents: 0, socials: { x: 'https://x.com/j' } }),
    ], (id) => (id === 'u1' ? 'James' : ''));
    const [head, row] = csv.split('\r\n');
    expect(head).toBe(CSV_COLUMNS.join(','));
    expect(row.startsWith(`'=cmd,"Acme, Inc",`)).toBe(true);
    const cells = row.split(',');
    expect(cells[CSV_COLUMNS.indexOf('deal_value') + 1]).toBe('0'); // +1: the quoted "Acme, Inc" splits in two
    expect(row).toContain('https://x.com/j');
    expect(row).toContain('James');
    expect(prospectsToCsv([])).toBe(CSV_COLUMNS.join(','));
  });
});

describe('templateVarsFor', () => {
  it('fills what it honestly can, with the ref code on the ICP deck link', () => {
    const vars = templateVarsFor(
      { name: '  Jane   Doe ', company: 'Acme', icp: 'planners', market: 'ng' },
      { name: 'James', refCode: 'jamesa', origin: 'https://beamwall.app' },
    );
    expect(vars).toEqual({
      firstName: 'Jane', company: 'Acme', senderName: 'James',
      deckLink: 'https://beamwall.app/pitch/ng-planners?ref=jamesa',
    });
    expect(templateVarsFor({ name: 'A', company: null, icp: 'brands', market: 'na' }, { name: 'J', origin: 'https://b.app' }).deckLink)
      .toBe('https://b.app/pitch/brands');
  });
  it('leaves unknowns unset so fillTemplate shows [token]', () => {
    const vars = templateVarsFor({ name: 'Jo', company: null, icp: 'other', market: 'ng' }, { name: '', origin: 'https://b.app' });
    expect(vars).toEqual({ firstName: 'Jo' });
    expect('personalHook' in vars).toBe(false);
  });
});

describe('dialable', () => {
  it('keeps a leading + and digits', () => {
    expect(dialable('+1 (416) 555-0100')).toBe('+14165550100');
    expect(dialable('416.555.0100 ext')).toBe('4165550100');
    expect(dialable('')).toBe('');
    expect(dialable(null)).toBe('');
    expect(dialable('call me')).toBe('');
  });
});

describe('whatsappLink', () => {
  it('turns Nigerian local numbers into 234…', () => {
    expect(whatsappLink('0803 123 4567', 'ng')).toBe('https://wa.me/2348031234567');
    expect(whatsappLink('08031234567', 'ng')).toBe('https://wa.me/2348031234567');
    expect(whatsappLink('234 803 123 4567', 'ng')).toBe('https://wa.me/2348031234567');
  });
  it('keeps explicit international numbers whatever the market', () => {
    expect(whatsappLink('+234 803 123 4567', 'na')).toBe('https://wa.me/2348031234567');
    expect(whatsappLink('+1 (416) 555-0100', 'ng')).toBe('https://wa.me/14165550100');
    expect(whatsappLink('00234 803 123 4567', 'na')).toBe('https://wa.me/2348031234567');
  });
  it('adds 1 to a 10-digit North American number', () => {
    expect(whatsappLink('416-555-0100', 'na')).toBe('https://wa.me/14165550100');
    expect(whatsappLink('1 416 555 0100', 'na')).toBe('https://wa.me/14165550100');
  });
  it('returns null when it cannot be sure of the country code', () => {
    expect(whatsappLink('', 'ng')).toBeNull();
    expect(whatsappLink(null, 'ng')).toBeNull();
    expect(whatsappLink('call me', 'ng')).toBeNull();
    expect(whatsappLink('8031234567', 'ng')).toBeNull();
    expect(whatsappLink('0803 123', 'ng')).toBeNull();
    expect(whatsappLink('555-0100', 'na')).toBeNull();
    expect(whatsappLink('0416 555 0100', 'na')).toBeNull();
    expect(whatsappLink('+0 123 456 789', 'na')).toBeNull();
    expect(whatsappLink('+1234567', 'na')).toBeNull();
    expect(whatsappLink('+1234567890123456', 'na')).toBeNull();
  });
});

describe('templatesFor', () => {
  const t = (id: string, icp: MessageTemplate['icp'], market: MessageTemplate['market']): MessageTemplate => ({
    id, title: id, channel: 'whatsapp', stage: 'opener', icp, market, body: 'Hi {{firstName}}', when: '',
  });
  const all = [t('a', 'planners', 'ng'), t('b', 'any', 'ng'), t('c', 'planners', 'na'), t('d', 'any', 'any'), t('e', 'brands', 'any')];
  it('filters by ICP AND market, honouring any', () => {
    expect(templatesFor(all, 'planners', 'ng').map((x) => x.id)).toEqual(['a', 'b', 'd']);
    expect(templatesFor(all, 'brands', 'na').map((x) => x.id)).toEqual(['d', 'e']);
    expect(templatesFor(all, 'other', 'na').map((x) => x.id)).toEqual(['d']);
  });
});

describe('friendlyCrmError', () => {
  it('maps the codes the CRM can hit', () => {
    expect(friendlyCrmError({ code: 'P0002', message: 'no_account' })).toMatch(/\/signup first/);
    expect(friendlyCrmError({ code: '42501', message: 'not_authorized' })).toMatch(/not authorised/);
    expect(friendlyCrmError({ code: '', message: 'new row violates row-level security policy' })).toMatch(/not authorised/);
    expect(friendlyCrmError({ code: 'PGRST116', message: 'x' })).toMatch(/isn’t yours/);
    expect(friendlyCrmError({ code: 'PGRST202', message: 'x' })).toBe(NOT_SET_UP_MESSAGE);
    expect(friendlyCrmError({ code: '42P01', message: 'x' })).toBe(NOT_SET_UP_MESSAGE);
    expect(friendlyCrmError({ code: '23505', message: 'dup' })).toMatch(/ref code/);
    expect(friendlyCrmError({ code: '', message: 'TypeError: Failed to fetch' })).toMatch(/connection/);
    expect(friendlyCrmError({ code: 'XX', message: 'boom' })).toBe('Something went wrong: boom');
    expect(friendlyCrmError(null)).toBe('Something went wrong. Try again.');
  });
  it('validRefCode mirrors the SQL check', () => {
    expect(validRefCode('jamesa')).toBe(true);
    expect(validRefCode(' JamesA ')).toBe(true);
    expect(validRefCode('j')).toBe(false);
    expect(validRefCode('james a')).toBe(false);
    expect(validRefCode('a'.repeat(25))).toBe(false);
  });
});
