/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI photo-check verdicts, summarised per challenge for the host. Rows come
 * from `challenge_checks` (migration 038 — service-role written by
 * validate-challenge-photo; members read their own event's rows) and carry NO
 * guest identity: pass/confidence/reason/time only.
 *
 * PURE: db.ts fetches (`fetchChallengeCheckStats`), this summarises.
 */
export interface ChallengeCheckRow {
  challenge_id: string;
  pass: boolean;
  confidence: number | null;
  /** The model's one-line reason (≤240 chars), shown to the guest at the time. */
  reason: string | null;
  created_at: string;
}

export interface ChallengeCheckStats {
  checked: number;
  passed: number;
  /** Newest first, at most RECENT_FAILS, reasons only (blank reasons skipped). */
  recentFails: { reason: string; at: string }[];
}

export const RECENT_FAILS = 5;

/** Per challenge id → stats. Challenges with no rows are absent (the caller
 *  renders nothing rather than "0 checked" for a challenge without a check). */
export function summarizeChallengeChecks(rows: ChallengeCheckRow[]): Record<string, ChallengeCheckStats> {
  const out: Record<string, ChallengeCheckStats> = {};
  // Newest first; ISO timestamps compare lexicographically. `toSorted` would
  // need ES2023 — copy then sort so the caller's array is untouched.
  const ordered = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  for (const r of ordered) {
    if (typeof r.challenge_id !== 'string' || !r.challenge_id) continue;
    const s = (out[r.challenge_id] ??= { checked: 0, passed: 0, recentFails: [] });
    s.checked++;
    if (r.pass === true) {
      s.passed++;
    } else if (s.recentFails.length < RECENT_FAILS) {
      const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
      if (reason) s.recentFails.push({ reason, at: r.created_at });
    }
  }
  return out;
}

/** "3 checked · 2 passed" — the Challenges row badge text. */
export function formatCheckStats(s: ChallengeCheckStats): string {
  return `${s.checked} checked · ${s.passed} passed`;
}
