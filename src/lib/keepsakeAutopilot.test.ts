import { describe, expect, it } from 'vitest';
import {
  AFTER_END_DELAY_MS,
  FILM_MAX_PHOTOS,
  MAX_ATTEMPTS,
  MAX_LATE_MS,
  NEXT_MORNING_OFFSET_MS,
  STALE_CLAIM_MS,
  autoSendEnabled,
  buildEventFilmPayload,
  reclaimMode,
  filmEntitled,
  filmPaths,
  isKeepsakeDue,
  keepsakeDueAt,
  pickFilmPhotos,
  workerAuthorized,
  type FilmPost,
} from '../../supabase/functions/send-keepsakes/autopilot.ts';

const H = 60 * 60 * 1000;
// Event date 2026-12-05, written as local midnight in Toronto (UTC-5).
const DATE = '2026-12-05T05:00:00.000Z';
const dateMs = Date.parse(DATE);

describe('keepsakeDueAt', () => {
  it('is 10:00 local the next day for a dated live event', () => {
    const due = keepsakeDueAt({ status: 'live', starts_at: DATE, ended_at: null, config: {} });
    expect(due).toBe(dateMs + NEXT_MORNING_OFFSET_MS);
    expect(new Date(due as number).toISOString()).toBe('2026-12-06T15:00:00.000Z'); // 10:00 EST
  });

  it('is 12h after the host ended it when that is sooner', () => {
    const ended = '2026-12-06T03:00:00.000Z'; // 10pm EST on the night
    const due = keepsakeDueAt({ status: 'ended', starts_at: DATE, ended_at: ended, config: {} });
    expect(due).toBe(Date.parse(ended) + AFTER_END_DELAY_MS);
  });

  it('uses the end time alone for an undated ended event', () => {
    const ended = '2026-12-06T03:00:00.000Z';
    expect(keepsakeDueAt({ status: 'archived', starts_at: null, ended_at: ended, config: null })).toBe(
      Date.parse(ended) + AFTER_END_DELAY_MS,
    );
  });

  it('never fires for drafts or for a live event with no date', () => {
    expect(keepsakeDueAt({ status: 'draft', starts_at: DATE, ended_at: null, config: {} })).toBeNull();
    expect(keepsakeDueAt({ status: 'live', starts_at: null, ended_at: null, config: {} })).toBeNull();
  });

  it('ignores a stale ended_at on a live event', () => {
    expect(keepsakeDueAt({ status: 'live', starts_at: null, ended_at: DATE, config: {} })).toBeNull();
  });

  it('treats an unparseable date as no date', () => {
    expect(keepsakeDueAt({ status: 'live', starts_at: 'not a date', ended_at: null, config: {} })).toBeNull();
  });
});

describe('isKeepsakeDue', () => {
  const ev = { status: 'live', starts_at: DATE, ended_at: null, config: {} };
  const due = dateMs + NEXT_MORNING_OFFSET_MS;

  it('is false before, true at, and true up to 7 days after its time', () => {
    expect(isKeepsakeDue(ev, due - 1)).toBe(false);
    expect(isKeepsakeDue(ev, due)).toBe(true);
    expect(isKeepsakeDue(ev, due + MAX_LATE_MS)).toBe(true);
  });

  it('never picks up an old event (the first deploy must not mail July)', () => {
    expect(isKeepsakeDue(ev, due + MAX_LATE_MS + 1)).toBe(false);
  });

  it('respects the host switching it off', () => {
    expect(isKeepsakeDue({ ...ev, config: { keepsakes: { autoSend: false } } }, due)).toBe(false);
  });
});

describe('autoSendEnabled', () => {
  it('defaults on; only an explicit false turns it off', () => {
    expect(autoSendEnabled(null)).toBe(true);
    expect(autoSendEnabled({})).toBe(true);
    expect(autoSendEnabled({ keepsakes: null })).toBe(true);
    expect(autoSendEnabled({ keepsakes: { autoSend: true } })).toBe(true);
    expect(autoSendEnabled({ keepsakes: { autoSend: 0 } })).toBe(true);
    expect(autoSendEnabled({ keepsakes: { autoSend: false } })).toBe(false);
  });
});

describe('reclaimMode', () => {
  const now = Date.parse('2026-12-06T18:00:00.000Z');
  const old = new Date(now - STALE_CLAIM_MS).toISOString();
  it('retries a silent claim, then mails without the film, then gives up', () => {
    expect(reclaimMode({ status: 'claimed', attempts: 1, claimed_at: old }, now)).toBe('film');
    expect(reclaimMode({ status: 'claimed', attempts: MAX_ATTEMPTS, claimed_at: old }, now)).toBe('email_only');
    expect(reclaimMode({ status: 'claimed', attempts: MAX_ATTEMPTS + 1, claimed_at: old }, now)).toBeNull();
  });
  it('never touches a fresh claim or a finished run', () => {
    expect(reclaimMode({ status: 'claimed', attempts: 1, claimed_at: new Date(now - H).toISOString() }, now)).toBeNull();
    expect(reclaimMode({ status: 'done', attempts: 1, claimed_at: old }, now)).toBeNull();
    expect(reclaimMode({ status: 'failed', attempts: 1, claimed_at: old }, now)).toBeNull();
    expect(reclaimMode({ status: 'claimed', attempts: 1, claimed_at: 'garbage' }, now)).toBeNull();
  });
});

describe('filmEntitled', () => {
  it('is paid plans only (no watermark), failing closed', () => {
    expect(filmEntitled({ watermark: false })).toBe(true);
    expect(filmEntitled({ watermark: true })).toBe(false);
    expect(filmEntitled({})).toBe(false);
    expect(filmEntitled(null)).toBe(false);
  });
});

function post(i: number, extra: Partial<FilmPost> = {}): FilmPost {
  return {
    id: `p${String(i).padStart(3, '0')}`,
    image_url: `https://x.supabase.co/storage/v1/object/public/posts/e/${i}.jpg`,
    media_type: 'image',
    guest_name: null,
    message: null,
    created_at: new Date(Date.UTC(2026, 11, 5, 20, i)).toISOString(),
    ...extra,
  };
}

describe('pickFilmPhotos', () => {
  it('keeps every still when there are few, oldest first', () => {
    const picked = pickFilmPhotos([post(3), post(1), post(2)]);
    expect(picked.map((p) => p.id)).toEqual(['p001', 'p002', 'p003']);
  });

  it('spreads across the night, always including the first and last shot', () => {
    const posts = Array.from({ length: 50 }, (_, i) => post(i));
    const picked = pickFilmPhotos(posts);
    expect(picked).toHaveLength(FILM_MAX_PHOTOS);
    expect(picked[0].id).toBe('p000');
    expect(picked[picked.length - 1].id).toBe('p049');
    expect(new Set(picked.map((p) => p.id)).size).toBe(FILM_MAX_PHOTOS);
  });

  it('drops videos and anything that is not an https URL', () => {
    const picked = pickFilmPhotos([
      post(1, { media_type: 'video' }),
      post(2, { image_url: null }),
      post(3, { image_url: 'javascript:alert(1)' }),
      post(4),
    ]);
    expect(picked.map((p) => p.id)).toEqual(['p004']);
  });
});

describe('buildEventFilmPayload', () => {
  it('describes an event film, not a greeting card', () => {
    const p = buildEventFilmPayload({ eventName: 'Ade & Tunji', accent: '#E8C766', photos: [post(1, { guest_name: '  Ada ' })], totalPhotos: 48 });
    expect(p.card.title).toBe('Ade & Tunji');
    expect(p.card.recipientName).toBeNull();
    expect(p.card.countLabel).toBe('48 photos from the booth');
    expect(p.card.theme).toEqual({ accent: '#E8C766' });
    expect(p.contributions[0]).toMatchObject({ contributorName: 'Ada', mediaType: 'photo', message: null, fit: 'contain' });
  });

  it('refuses a non-hex accent and singularises one photo', () => {
    const p = buildEventFilmPayload({ eventName: 'X', accent: 'red;}', photos: [], totalPhotos: 1 });
    expect(p.card.theme).toEqual({});
    expect(p.card.countLabel).toBe('1 photo from the booth');
  });

  it('caps long guest text', () => {
    const p = buildEventFilmPayload({ eventName: 'X', accent: null, photos: [post(1, { message: 'a'.repeat(400) })], totalPhotos: 1 });
    expect((p.contributions[0].message as string).length).toBe(140);
  });
});

describe('filmPaths', () => {
  it('lives under the event prefix so delete-event sweeps it', () => {
    expect(filmPaths('ade-tunji')).toEqual({ film: 'ade-tunji/_film/keepsake.mp4', poster: 'ade-tunji/_film/poster.jpg' });
  });
});

describe('workerAuthorized', () => {
  const secret = 's'.repeat(40);
  it('accepts only the exact secret, and nothing when the secret is unset or weak', () => {
    expect(workerAuthorized(secret, secret)).toBe(true);
    expect(workerAuthorized(`${'s'.repeat(39)}t`, secret)).toBe(false);
    expect(workerAuthorized(null, secret)).toBe(false);
    expect(workerAuthorized('', undefined)).toBe(false);
    expect(workerAuthorized('short', 'short')).toBe(false);
  });
});
