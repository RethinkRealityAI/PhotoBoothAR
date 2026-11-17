import { describe, it, expect } from 'vitest';
import { RECENT_FAILS, formatCheckStats, summarizeChallengeChecks, type ChallengeCheckRow } from './challengeChecks';

const row = (challenge_id: string, pass: boolean, reason: string | null, at: string): ChallengeCheckRow =>
  ({ challenge_id, pass, confidence: 0.9, reason, created_at: at });

describe('summarizeChallengeChecks', () => {
  it('counts per challenge and keeps the newest fail reasons first', () => {
    const rows = [
      row('a', true, 'ok', '2026-09-01T00:00:00Z'),
      row('a', false, 'No cake in view', '2026-09-02T00:00:00Z'),
      row('a', false, 'Too dark to tell', '2026-09-03T00:00:00Z'),
      row('b', false, '   ', '2026-09-03T00:00:00Z'),
      row('b', false, null, '2026-09-04T00:00:00Z'),
    ];
    const s = summarizeChallengeChecks(rows);
    expect(s.a).toEqual({
      checked: 3, passed: 1,
      recentFails: [{ reason: 'Too dark to tell', at: '2026-09-03T00:00:00Z' }, { reason: 'No cake in view', at: '2026-09-02T00:00:00Z' }],
    });
    expect(s.b).toEqual({ checked: 2, passed: 0, recentFails: [] });
    expect(rows[0].challenge_id).toBe('a'); // input order untouched
    expect(rows.map((r) => r.created_at)[1]).toBe('2026-09-02T00:00:00Z');
  });

  it(`caps recent fails at ${RECENT_FAILS} and skips rows without a challenge id`, () => {
    const rows = Array.from({ length: 9 }, (_v, i) => row('a', false, `fail ${i}`, `2026-09-0${i + 1}T00:00:00Z`));
    rows.push({ ...row('', false, 'x', '2026-09-10T00:00:00Z') });
    const s = summarizeChallengeChecks(rows);
    expect(s.a.checked).toBe(9);
    expect(s.a.recentFails).toHaveLength(RECENT_FAILS);
    expect(s.a.recentFails[0].reason).toBe('fail 8');
    expect(Object.keys(s)).toEqual(['a']);
  });

  it('formats the row badge', () => {
    expect(formatCheckStats({ checked: 3, passed: 2, recentFails: [] })).toBe('3 checked · 2 passed');
    expect(summarizeChallengeChecks([])).toEqual({});
  });
});
