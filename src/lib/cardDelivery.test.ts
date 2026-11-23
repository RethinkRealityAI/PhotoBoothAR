import { describe, expect, it } from 'vitest';
import {
  deliveryErrorCopy, describeDelivery, formatDelivery, inputValuesFor, relativeWhen, scheduleInstant, scheduleProblem,
  timeZoneChoices, MIN_LEAD_MS, MAX_LEAD_MS, type DeliveryFields,
} from './cardDelivery';

describe('deliveryErrorCopy — the 051 send ceiling', () => {
  it('names the daily limit instead of promising a retry that cannot happen today', () => {
    const msg = deliveryErrorCopy('send_cap_reached');
    expect(msg).toContain('sending limit');
    expect(msg).toContain('tomorrow');
    expect(msg).not.toContain('retrying');
  });

  it('treats a send-log hiccup as the temporary, retried problem it is', () => {
    expect(deliveryErrorCopy('send_log_failed')).toBe(deliveryErrorCopy('features_unavailable'));
    expect(deliveryErrorCopy('send_log_failed')).toContain('retrying automatically');
  });
});

const NONE: DeliveryFields = {
  deliver_at: null, deliver_time_zone: null, delivery_state: null, delivery_error: null, delivered_at: null,
};

describe('scheduleInstant', () => {
  it('reads the wall clock in the chosen zone', () => {
    // 9 am Lagos (+01:00, no DST) = 08:00Z
    expect(new Date(scheduleInstant('2026-12-03', '09:00', 'Africa/Lagos')!).toISOString()).toBe('2026-12-03T08:00:00.000Z');
    // 9 am Toronto in winter (−05:00) = 14:00Z
    expect(new Date(scheduleInstant('2026-12-03', '09:00', 'America/Toronto')!).toISOString()).toBe('2026-12-03T14:00:00.000Z');
  });

  it('uses the offset in force on that date, across DST (TRAPS: DST)', () => {
    // 2027-03-14 is the US spring-forward day; 10:00 is after the change (−04:00).
    expect(new Date(scheduleInstant('2027-03-14', '10:00', 'America/Toronto')!).toISOString()).toBe('2027-03-14T14:00:00.000Z');
  });

  it('handles year-end (TRAPS: Dec 31)', () => {
    expect(new Date(scheduleInstant('2026-12-31', '23:30', 'America/Toronto')!).toISOString()).toBe('2027-01-01T04:30:00.000Z');
  });

  it('rejects impossible dates and DST-gap times', () => {
    expect(scheduleInstant('2027-02-30', '09:00', 'Africa/Lagos')).toBeNull();
    expect(scheduleInstant('2027-01-31', '25:00', 'Africa/Lagos')).toBeNull();
    // 02:30 does not exist in Toronto on the spring-forward day.
    expect(scheduleInstant('2027-03-14', '02:30', 'America/Toronto')).toBeNull();
    expect(scheduleInstant('', '09:00', 'Africa/Lagos')).toBeNull();
    expect(scheduleInstant('2026-12-03', '09:00', 'Not/AZone')).toBeNull();
  });
});

describe('scheduleProblem', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  it('accepts a time inside the window', () => {
    expect(scheduleProblem(now + MIN_LEAD_MS, now)).toBeNull();
    expect(scheduleProblem(now + MAX_LEAD_MS, now)).toBeNull();
  });
  it('names each problem', () => {
    expect(scheduleProblem(null, now)).toBe('invalid');
    expect(scheduleProblem(now - 1, now)).toBe('past');
    expect(scheduleProblem(now, now)).toBe('past');
    expect(scheduleProblem(now + MIN_LEAD_MS - 1, now)).toBe('too_soon');
    expect(scheduleProblem(now + MAX_LEAD_MS + 1, now)).toBe('too_far');
  });
});

describe('inputValuesFor', () => {
  it('round-trips with scheduleInstant', () => {
    const ms = scheduleInstant('2027-01-31', '07:05', 'Europe/London')!;
    expect(inputValuesFor(ms, 'Europe/London')).toEqual({ date: '2027-01-31', time: '07:05' });
  });
});

describe('timeZoneChoices', () => {
  it('puts an unlisted viewer zone first', () => {
    expect(timeZoneChoices('Asia/Tokyo')[0].id).toBe('Asia/Tokyo');
  });
  it('does not duplicate a listed zone', () => {
    const list = timeZoneChoices('Africa/Lagos');
    expect(list.filter((o) => o.id === 'Africa/Lagos')).toHaveLength(1);
  });
  it('ignores an invalid zone', () => {
    expect(timeZoneChoices('nope').some((o) => o.id === 'nope')).toBe(false);
  });
});

describe('relativeWhen', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  it('is coarse and honest', () => {
    expect(relativeWhen(now - 1, now)).toBe('any moment now');
    expect(relativeWhen(now + 60_000, now)).toBe('in 1 minute');
    expect(relativeWhen(now + 3 * 3_600_000, now)).toBe('in 3 hours');
    expect(relativeWhen(now + 26 * 3_600_000, now)).toBe('tomorrow');
    expect(relativeWhen(now + 12 * 86_400_000, now)).toBe('in 12 days');
  });
});

describe('describeDelivery', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  const at = '2026-12-03T08:00:00.000Z';

  it('none when nothing is scheduled', () => {
    expect(describeDelivery(NONE, now).kind).toBe('none');
  });

  it('scheduled carries the time in the host zone', () => {
    const d = describeDelivery({ ...NONE, deliver_at: at, deliver_time_zone: 'Africa/Lagos', delivery_state: 'scheduled' }, now);
    expect(d.kind).toBe('scheduled');
    expect(d.short).toBe('Sends in 14 days');
    expect(d.detail).toContain('Lagos time');
    expect(d.detail).toContain('9:00');
  });

  it('a scheduled row with email_not_configured is WAITING, not "sends in N days"', () => {
    const d = describeDelivery({
      ...NONE, deliver_at: at, delivery_state: 'scheduled', delivery_error: 'email_not_configured',
    }, now);
    expect(d.kind).toBe('waiting');
    expect(d.short).not.toMatch(/Sends/);
  });

  it('a scheduled row with another error is retrying', () => {
    expect(describeDelivery({ ...NONE, deliver_at: at, delivery_state: 'scheduled', delivery_error: 'email_failed' }, now).kind)
      .toBe('retrying');
  });

  it('sent and failed', () => {
    expect(describeDelivery({ ...NONE, delivery_state: 'sent', delivered_at: at, deliver_time_zone: 'UTC' }, now).detail)
      .toContain('Delivered');
    const f = describeDelivery({ ...NONE, delivery_state: 'failed', delivery_error: 'invalid_recipient' }, now);
    expect(f.kind).toBe('failed');
    expect(f.detail).toMatch(/email/i);
  });
});

describe('formatDelivery', () => {
  it('falls back to UTC for a missing zone', () => {
    expect(formatDelivery(Date.parse('2026-12-03T08:00:00Z'), null)).toContain('UTC time');
  });
});
