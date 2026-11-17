import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bookingUrl, buildIcs, compactWeekly, friendlyBookingError, generateSlots, googleCalendarUrl, groupSlotsByDay,
  parseHHMM, sortBookings, tzOffsetMinutes, upcomingCount, validateBooker, validateWeekly, wallTime,
  zonedWallTimeToUtc, EMPTY_BOOKER, type Booking, type SlotRules,
} from './booking';

const iso = (ms: number) => new Date(ms).toISOString();

describe('time helpers', () => {
  it('parseHHMM accepts HH:MM and a 24:00 end, rejects junk', () => {
    expect(parseHHMM('09:30')).toBe(570);
    expect(parseHHMM('24:00')).toBe(1440);
    expect(parseHHMM('24:30')).toBeNull();
    expect(parseHHMM('9:30')).toBeNull();
    expect(parseHHMM('12:60')).toBeNull();
  });

  it('wall time → UTC: the three TRAPS traces', () => {
    expect(iso(zonedWallTimeToUtc(2026, 1, 31, 600, 'Africa/Lagos'))).toBe('2026-01-31T09:00:00.000Z');
    expect(iso(zonedWallTimeToUtc(2026, 12, 31, 23 * 60 + 30, 'America/Toronto'))).toBe('2027-01-01T04:30:00.000Z');
    expect(iso(zonedWallTimeToUtc(2026, 3, 8, 600, 'America/Toronto'))).toBe('2026-03-08T14:00:00.000Z');
  });

  it('offset and weekday match Postgres conventions (0 = Sunday)', () => {
    expect(tzOffsetMinutes(Date.parse('2026-11-17T05:00:00Z'), 'Africa/Lagos')).toBe(60);
    expect(tzOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'), 'America/Toronto')).toBe(-240);
    expect(wallTime(Date.parse('2026-11-22T12:00:00Z'), 'Africa/Lagos').dow).toBe(0);
  });
});

// Tuesday 2026-11-17, 06:00 in Lagos.
const NOW = new Date('2026-11-17T05:00:00Z');
const LAGOS: SlotRules = {
  duration_min: 30, buffer_min: 0, timezone: 'Africa/Lagos',
  weekly: { '2': [['10:00', '12:00']] }, min_notice_hours: 0, horizon_days: 1,
};

describe('generateSlots (the grid 042 re-validates)', () => {
  it('lays the grid from the window start', () => {
    const s = generateSlots(LAGOS, [], NOW).map((x) => iso(x.startMs));
    expect(s).toEqual([
      '2026-11-17T09:00:00.000Z', '2026-11-17T09:30:00.000Z',
      '2026-11-17T10:00:00.000Z', '2026-11-17T10:30:00.000Z',
    ]);
  });

  it('never runs a slot past the window end', () => {
    const s = generateSlots({ ...LAGOS, duration_min: 45 }, [], NOW).map((x) => iso(x.startMs));
    // 10:00, 10:45 fit (11:30 end); 11:30 + 45 = 12:15 > 12:00 is dropped.
    expect(s).toEqual(['2026-11-17T09:00:00.000Z', '2026-11-17T09:45:00.000Z']);
  });

  it('respects the notice period', () => {
    expect(generateSlots({ ...LAGOS, min_notice_hours: 12 }, [], NOW)).toEqual([]);
    expect(generateSlots({ ...LAGOS, min_notice_hours: 5 }, [], NOW).map((x) => iso(x.startMs)))
      .toEqual(['2026-11-17T10:00:00.000Z', '2026-11-17T10:30:00.000Z']);
  });

  it('busy times block their slot, and the buffer blocks the neighbours', () => {
    const busy: Array<[string, string]> = [['2026-11-17T09:30:00Z', '2026-11-17T10:00:00Z']]; // 10:30-11:00 Lagos
    expect(generateSlots(LAGOS, busy, NOW).map((x) => iso(x.startMs)))
      .toEqual(['2026-11-17T09:00:00.000Z', '2026-11-17T10:00:00.000Z', '2026-11-17T10:30:00.000Z']);
    expect(generateSlots({ ...LAGOS, buffer_min: 10 }, busy, NOW).map((x) => iso(x.startMs)))
      .toEqual(['2026-11-17T10:30:00.000Z']);
  });

  it('walks calendar days up to (not including) the horizon', () => {
    const rules = { ...LAGOS, weekly: { '2': [['10:00', '10:30']], '3': [['10:00', '10:30']], '4': [['10:00', '10:30']] } as SlotRules['weekly'] };
    expect(generateSlots({ ...rules, horizon_days: 2 }, [], NOW).map((x) => iso(x.startMs)))
      .toEqual(['2026-11-17T09:00:00.000Z', '2026-11-18T09:00:00.000Z']);
    expect(generateSlots({ ...rules, horizon_days: 0 }, [], NOW)).toEqual([]);
  });

  it('skips a wall time that DST makes impossible', () => {
    const toronto: SlotRules = {
      duration_min: 60, buffer_min: 0, timezone: 'America/Toronto',
      weekly: { '0': [['01:00', '04:00']] }, min_notice_hours: 0, horizon_days: 1,
    };
    const s = generateSlots(toronto, [], new Date('2026-03-08T05:00:00Z')).map((x) => iso(x.startMs));
    // 01:00 EST = 06:00Z; 02:00 does not exist; 03:00 EDT = 07:00Z.
    expect(s).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z']);
  });

  it('returns nothing for a bad timezone instead of throwing', () => {
    expect(generateSlots({ ...LAGOS, timezone: 'Mars/Olympus' }, [], NOW)).toEqual([]);
  });

  it('groups by the VIEWER’s day — a Lagos 05:30 slot is the previous evening in Toronto', () => {
    const rules: SlotRules = { ...LAGOS, weekly: { '3': [['05:30', '06:00']] }, horizon_days: 2 };
    const slots = generateSlots(rules, [], NOW);
    expect(groupSlotsByDay(slots, 'Africa/Lagos').map((d) => d.key)).toEqual(['2026-11-18']);
    expect(groupSlotsByDay(slots, 'America/Toronto').map((d) => d.key)).toEqual(['2026-11-17']);
  });

  it('the SQL in 042 carries the same grid, buffer and horizon rule', () => {
    const sql = readFileSync('supabase/migrations/042_sales_booking.sql', 'utf8');
    expect(sql).toContain('(v_min - ws) % bp.duration_min = 0');
    expect(sql).toContain('v_min + bp.duration_min <= we');
    expect(sql).toContain('b.starts_at < v_end + make_interval(mins => bp.buffer_min)');
    expect(sql).toContain('b.ends_at > p_starts_at - make_interval(mins => bp.buffer_min)');
    expect(sql).toContain('(now() at time zone bp.timezone)::date + bp.horizon_days');
    expect(sql).toContain('p_starts_at < now() + make_interval(hours => bp.min_notice_hours)');
  });

  it('042 grants anon only the two public functions', () => {
    const sql = readFileSync('supabase/migrations/042_sales_booking.sql', 'utf8');
    const anonGrants = sql.match(/grant execute on function [^;]+ to anon[^;]*;/g) ?? [];
    expect(anonGrants.map((g) => /function public\.(\w+)/.exec(g)?.[1])).toEqual(['sales_booking_page_public', 'sales_book_meeting']);
    for (const fn of ['sales_set_my_ref_code', 'sales_booking_page_public', 'sales_book_meeting']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
    }
    expect(sql).not.toMatch(/create policy \w+ on public\.sales_bookings for insert/);
  });
});

describe('hours validation', () => {
  it('needs one open day, valid ranges, ≤3 a day', () => {
    expect(validateWeekly({})).toMatch(/at least one day/);
    expect(validateWeekly({ '1': [['10:00', '09:00']] })).toMatch(/end after/);
    expect(validateWeekly({ '1': [['9:00', '10:00']] })).toMatch(/09:00/);
    expect(validateWeekly({ '1': [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00'], ['14:00', '15:00']] })).toMatch(/three/);
    expect(validateWeekly({ '1': [['09:00', '24:00']] })).toBeNull();
  });

  it('compactWeekly drops closed days', () => {
    expect(compactWeekly({ '1': [['09:00', '10:00']], '2': [] })).toEqual({ '1': [['09:00', '10:00']] });
  });
});

describe('booker form', () => {
  it('needs a name, a way to reach them and consent', () => {
    const e = validateBooker(EMPTY_BOOKER);
    expect(e.name).toBeDefined();
    expect(e.contact).toBeDefined();
    expect(e.consent).toBeDefined();
  });

  it('either email or phone is enough', () => {
    const base = { ...EMPTY_BOOKER, name: 'Ada', consent: true };
    expect(validateBooker({ ...base, phone: '+234 803 123 4567' })).toEqual({});
    expect(validateBooker({ ...base, email: 'ada@example.com' })).toEqual({});
    expect(validateBooker({ ...base, email: 'nope' }).email).toBeDefined();
    expect(validateBooker({ ...base, phone: 'call me' }).phone).toBeDefined();
  });
});

describe('links + calendar', () => {
  it('bookingUrl needs a valid ref code', () => {
    expect(bookingUrl('https://beamwall.app', 'JamesA')).toBe('https://beamwall.app/book/jamesa');
    expect(bookingUrl('https://beamwall.app', null)).toBeNull();
    expect(bookingUrl('https://beamwall.app', '../admin')).toBeNull();
  });

  it('ICS escapes text and uses UTC stamps with CRLF', () => {
    const ics = buildIcs({
      uid: 'abc', startMs: Date.parse('2026-11-20T09:00:00Z'), endMs: Date.parse('2026-11-20T09:30:00Z'),
      title: 'Beamwall call, with James', description: 'Line one\nLine; two', location: 'https://meet.google.com/x',
    }, Date.parse('2026-11-17T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261120T090000Z\r\n');
    expect(ics).toContain('SUMMARY:Beamwall call\\, with James\r\n');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine\\; two\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('Google Calendar link carries start/end', () => {
    const url = new URL(googleCalendarUrl({
      uid: 'a', startMs: Date.parse('2026-11-20T09:00:00Z'), endMs: Date.parse('2026-11-20T09:30:00Z'),
      title: 'Call', description: '', location: null,
    }));
    expect(url.searchParams.get('dates')).toBe('20261120T090000Z/20261120T093000Z');
    expect(url.searchParams.has('location')).toBe(false);
  });
});

describe('errors + lists', () => {
  it('maps server codes to sentences', () => {
    expect(friendlyBookingError({ message: 'slot_taken', code: '23P01' })).toMatch(/just booked/);
    expect(friendlyBookingError({ message: 'ref_code_locked' })).toMatch(/already live/);
    expect(friendlyBookingError({ message: 'Failed to fetch' })).toMatch(/connection/);
  });

  it('upcoming confirmed first, soonest first; history after, newest first', () => {
    const b = (id: string, starts: string, status: Booking['status'] = 'confirmed'): Booking => ({
      id, rep_id: 'r', prospect_id: null, starts_at: starts, ends_at: new Date(Date.parse(starts) + 1_800_000).toISOString(),
      status, name: id, email: null, phone: null, company: null, icp: 'other', event_date: null, notes: null,
      booker_tz: null, created_at: starts,
    });
    const list = [
      b('past', '2026-11-10T09:00:00Z'), b('later', '2026-11-25T09:00:00Z'),
      b('soon', '2026-11-18T09:00:00Z'), b('cancelled', '2026-11-19T09:00:00Z', 'cancelled'),
    ];
    expect(sortBookings(list, NOW).map((x) => x.id)).toEqual(['soon', 'later', 'cancelled', 'past']);
    expect(upcomingCount(list, NOW)).toBe(2);
  });
});
