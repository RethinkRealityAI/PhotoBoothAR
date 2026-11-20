import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RETENTION_NOTICE_DAYS, RETENTION_POLICY_START, RETENTION_EXEMPT_SLUGS,
  retentionAnchor, retentionDeadline, retentionStage, downloadParts, formatKeptUntil,
  DOWNLOAD_PART_BYTES, type RetentionEvent,
} from './retention';
import { VIDEO_CLIP_BYTE_BUDGET } from './plans';

const DAY = 24 * 60 * 60 * 1000;
const POLICY = Date.parse(RETENTION_POLICY_START);

function ev(over: Partial<RetentionEvent> = {}): RetentionEvent {
  return {
    slug: 'smith-wedding', status: 'ended',
    starts_at: '2027-03-01T18:00:00Z', ends_at: '2027-03-02T02:00:00Z', created_at: '2027-01-10T00:00:00Z',
    ...over,
  };
}

describe('retention clock', () => {
  it('starts at the event end, then start, then creation', () => {
    expect(retentionAnchor(ev())).toBe(Date.parse('2027-03-02T02:00:00Z'));
    expect(retentionAnchor(ev({ ends_at: null }))).toBe(Date.parse('2027-03-01T18:00:00Z'));
    expect(retentionAnchor(ev({ ends_at: null, starts_at: null }))).toBe(Date.parse('2027-01-10T00:00:00Z'));
    expect(retentionAnchor(ev({ ends_at: null, starts_at: null, created_at: null }))).toBeNull();
  });

  it('never starts before the policy existed (no surprise deletes of old events)', () => {
    const old = ev({ ends_at: '2025-06-01T00:00:00Z' });
    expect(retentionAnchor(old)).toBe(POLICY);
    expect(retentionDeadline(old, 7)).toBe(POLICY + 7 * DAY);
  });

  it('keeps forever when retention is null, zero or nonsense', () => {
    expect(retentionDeadline(ev(), null)).toBeNull();
    expect(retentionDeadline(ev(), 0)).toBeNull();
    expect(retentionDeadline(ev(), Number.NaN)).toBeNull();
  });
});

describe('retentionStage', () => {
  const e = ev();
  const deadline = retentionDeadline(e, 90) as number;

  it('keeps well before the deadline', () => {
    expect(retentionStage(e, 90, null, deadline - 30 * DAY)).toBe('keep');
  });

  it('notifies inside the notice window', () => {
    expect(retentionStage(e, 90, null, deadline - (RETENTION_NOTICE_DAYS - 1) * DAY)).toBe('notify');
  });

  it('never purges without a reminder having gone out, even long past the deadline', () => {
    expect(retentionStage(e, 90, null, deadline + 365 * DAY)).toBe('notify');
  });

  it('purges only once the deadline AND a full notice period after the email have passed', () => {
    const sent = new Date(deadline - 2 * DAY).toISOString();
    expect(retentionStage(e, 90, sent, deadline)).toBe('keep');
    expect(retentionStage(e, 90, sent, deadline - 2 * DAY + RETENTION_NOTICE_DAYS * DAY)).toBe('purge');
  });

  it('a late reminder pushes the purge out a full notice period', () => {
    const sent = new Date(deadline + 100 * DAY).toISOString();
    expect(retentionStage(e, 90, sent, deadline + 101 * DAY)).toBe('keep');
    expect(retentionStage(e, 90, sent, deadline + 100 * DAY + RETENTION_NOTICE_DAYS * DAY)).toBe('purge');
  });

  it('never touches a live event or a legacy slug', () => {
    const sent = new Date(deadline - 20 * DAY).toISOString();
    expect(retentionStage(ev({ status: 'live' }), 90, sent, deadline + 400 * DAY)).toBe('keep');
    for (const slug of RETENTION_EXEMPT_SLUGS) {
      expect(retentionStage(ev({ slug }), 7, sent, deadline + 400 * DAY)).toBe('keep');
    }
  });

  it('keeps forever on an unlimited plan', () => {
    expect(retentionStage(e, null, null, deadline + 4000 * DAY)).toBe('keep');
  });
});

describe('the edge function mirrors this policy', () => {
  const src = readFileSync(
    new URL('../../supabase/functions/media-retention/index.ts', import.meta.url), 'utf8',
  );
  it('uses the same constants', () => {
    expect(src).toContain(`const RETENTION_NOTICE_DAYS = ${RETENTION_NOTICE_DAYS};`);
    expect(src).toContain(`const RETENTION_POLICY_START = '${RETENTION_POLICY_START}';`);
    expect(src).toContain(
      `const RETENTION_EXEMPT_SLUGS = [${RETENTION_EXEMPT_SLUGS.map((s) => `'${s}'`).join(', ')}];`,
    );
  });
  it('defaults to report-only and never deletes without the purge mode', () => {
    expect(src).toMatch(/return v === 'notify' \|\| v === 'purge' \? v : 'off';/);
    expect(src).toContain("if (mode !== 'purge') row.action = 'would remove media';");
    // A failed resolver read must keep the media.
    expect(src).toContain("action: 'skipped: features_unavailable'");
  });
  it('only sweeps the posts bucket under a safe slug prefix', () => {
    expect(src).toContain("const POSTS_BUCKET = 'posts';");
    expect(src).toContain("if (!SAFE_SLUG_RE.test(ev.slug)) throw new Error('unsafe_slug');");
  });
});

describe('downloadParts', () => {
  const photo = (id: string) => ({ id, media_type: 'image' });
  const video = (id: string) => ({ id, media_type: 'video' });

  it('keeps a small event in one download', () => {
    const posts = [photo('a'), video('b'), photo('c')];
    expect(downloadParts(posts)).toEqual([posts]);
  });

  it('splits a heavy event so no part can exceed the in-memory ceiling', () => {
    const posts = Array.from({ length: 100 }, (_, i) => video(`v${i}`));
    const parts = downloadParts(posts);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat()).toEqual(posts); // every post once, order kept
    const perPart = Math.floor(DOWNLOAD_PART_BYTES / VIDEO_CLIP_BYTE_BUDGET);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(perPart);
  });

  it('returns nothing for nothing', () => {
    expect(downloadParts([])).toEqual([]);
  });
});

describe('formatKeptUntil', () => {
  it('names a date or forever', () => {
    expect(formatKeptUntil(Date.parse('2027-11-19T00:00:00Z'))).toBe('Kept until 19 Nov 2027');
    expect(formatKeptUntil(null)).toBe('Kept forever');
  });
});
