/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  keepsakePreviewMessage,
  keepsakeSendMessage,
  recapAccess,
  recapCountLine,
  recapCounts,
  recapPhotoFileName,
  stillPhotos,
  type RecapPost,
} from './eventRecap';
import type { KeepsakeSendError } from './keepsakeContacts';

/**
 * Every failure the send client can report.
 *
 * Only the TYPE is imported — erased at transform, so this file's runtime graph
 * never reaches `keepsakeContacts.ts` or the supabase client behind it. Keying
 * a record on the union is the same trick `guidesDrift.test.ts` uses for
 * `FeatureHelpTopic`: a thirteenth error code stops this file compiling until
 * somebody writes the host a sentence explaining it.
 */
const ALL_SEND_ERRORS: Record<KeepsakeSendError, true> = {
  unauthorized: true,
  forbidden: true,
  event_not_found: true,
  event_still_live: true,
  recently_sent: true,
  preview_rate_limited: true,
  invalid_email: true,
  invalid_body: true,
  email_not_configured: true,
  email_failed: true,
  internal: true,
  network: true,
};

function post(id: string, session: string | null, media?: string): RecapPost {
  return { id, session_id: session, media_type: media ?? 'image' };
}

describe('recapAccess — the album opens exactly when the booth closes', () => {
  it('opens for a finished event, which is the whole point of it', () => {
    expect(recapAccess('ended')).toBe('open');
    expect(recapAccess('archived')).toBe('open');
  });

  it('opens during the event too, so the link works the moment it is shared', () => {
    expect(recapAccess('live')).toBe('open');
  });

  it('has nothing to show for a draft', () => {
    expect(recapAccess('draft')).toBe('not-available');
  });

  it('refuses an unknown status rather than publishing by default', () => {
    // A status added server-side must never silently expose an album.
    for (const s of ['', '   ', 'paused', 'suspended', 'deleted', 'LIVE-ish']) {
      expect(recapAccess(s)).toBe('not-available');
    }
  });

  it('is case- and whitespace-insensitive, like guestAccess', () => {
    expect(recapAccess('  Ended ')).toBe('open');
    expect(recapAccess('ARCHIVED')).toBe('open');
  });
});

describe('recapCounts — the numbers under the event name', () => {
  it('counts moments and distinct devices', () => {
    const album = [
      post('a', 's1'), post('b', 's1'), post('c', 's2'), post('d', 's3'),
    ];
    expect(recapCounts(album)).toEqual({ moments: 4, guests: 3 });
  });

  it('counts a post with no session as a moment but not as a guest', () => {
    // Uploads and legacy rows can carry no session id. The photo is real; the
    // device behind it is unknowable, and inventing one would inflate the count.
    expect(recapCounts([post('a', null), post('b', ''), post('c', 's1')]))
      .toEqual({ moments: 3, guests: 1 });
  });

  it('ignores whitespace-only session ids', () => {
    expect(recapCounts([post('a', '   ')]).guests).toBe(0);
  });

  it('handles an empty album', () => {
    expect(recapCounts([])).toEqual({ moments: 0, guests: 0 });
  });
});

describe('recapCountLine', () => {
  it('reads as a sentence, not a data dump', () => {
    expect(recapCountLine({ moments: 142, guests: 38 })).toBe('142 moments · 38 guests');
  });

  it('never prints "1 moments"', () => {
    expect(recapCountLine({ moments: 1, guests: 1 })).toBe('1 moment · 1 guest');
  });

  it('drops the guest half rather than claiming zero guests over a full wall', () => {
    expect(recapCountLine({ moments: 9, guests: 0 })).toBe('9 moments');
  });

  it('survives an empty event', () => {
    expect(recapCountLine({ moments: 0, guests: 0 })).toBe('0 moments');
  });
});

describe('stillPhotos — what the collage may paint', () => {
  it('drops clips, because drawImage cannot decode one', () => {
    const album = [post('a', 's1'), post('b', 's1', 'video'), post('c', 's2')];
    expect(stillPhotos(album).map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('keeps rows whose media type is missing — they are stills', () => {
    expect(stillPhotos([{ id: 'a', session_id: null }])).toHaveLength(1);
  });

  it('preserves order, so the newest-first album stays newest-first', () => {
    const album = [post('a', 's'), post('b', 's', 'video'), post('c', 's'), post('d', 's')];
    expect(stillPhotos(album).map((p) => p.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('recapPhotoFileName', () => {
  it('matches the wall lightbox shape', () => {
    expect(recapPhotoFileName('HopeGala', { id: 'abcdef1234-5678', media_type: 'image' }, 'x.jpg'))
      .toBe('HopeGala-abcdef12.jpg');
  });

  it('names a clip by what it actually is', () => {
    expect(recapPhotoFileName('Night', { id: '0123456789', media_type: 'video' }, 'https://x/y.mp4'))
      .toBe('Night-01234567.mp4');
    expect(recapPhotoFileName('Night', { id: '0123456789', media_type: 'video' }, 'https://x/y.webm'))
      .toBe('Night-01234567.webm');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(recapPhotoFileName('', { id: 'aaaaaaaaaa' }, 'x.jpg')).toBe('event-aaaaaaaa.jpg');
    expect(recapPhotoFileName('!!!', { id: 'aaaaaaaaaa' }, 'x.jpg')).toBe('event-aaaaaaaa.jpg');
  });
});

describe('keepsakeSendMessage — never claim a delivery we cannot confirm', () => {
  it('reports a real send with its number', () => {
    expect(keepsakeSendMessage({ ok: true, sent: 42, skipped: 0, failed: 0, error: null }))
      .toEqual({ tone: 'success', message: 'Album sent to 42 guests.' });
  });

  it('does not say "1 guests"', () => {
    expect(keepsakeSendMessage({ ok: true, sent: 1, error: null }).message)
      .toBe('Album sent to 1 guest.');
  });

  it('admits the ones it skipped and the ones that bounced', () => {
    const out = keepsakeSendMessage({ ok: true, sent: 30, skipped: 4, failed: 2, error: null });
    expect(out.message).toBe('Album sent to 30 guests. 4 already had it. 2 didn’t go through.');
    // Not a clean success: something did not arrive, and the tone must not
    // celebrate over it.
    expect(out.tone).toBe('info');
  });

  it('calls an empty opt-in list what it is, not an error', () => {
    const out = keepsakeSendMessage({ ok: true, sent: 0, error: null });
    expect(out.tone).toBe('info');
    expect(out.message).toContain('Nobody has left an address');
  });

  it('has plain words for every failure the client can report', () => {
    for (const code of Object.keys(ALL_SEND_ERRORS) as KeepsakeSendError[]) {
      const out = keepsakeSendMessage({ ok: false, sent: 0, error: code });
      expect(out.tone, code).toBe('error');
      // Long enough to be a sentence, and free of the raw code — a host should
      // never be shown 'email_not_configured'.
      expect(out.message.length, code).toBeGreaterThan(30);
      expect(out.message, code).not.toContain('_');
    }
  });

  it('says outright that email is switched off, without blaming the host', () => {
    const msg = keepsakeSendMessage({ ok: false, sent: 0, error: 'email_not_configured' }).message;
    expect(msg).toContain('platform admin');
    expect(msg).toContain('no guest was emailed');
  });

  it('refuses to guess after a network failure', () => {
    const msg = keepsakeSendMessage({ ok: false, sent: 0, error: 'network' }).message;
    expect(msg).toContain('can’t tell you whether anything was sent');
  });

  it('treats ok:false with no code as an unconfirmed send, not a success', () => {
    const out = keepsakeSendMessage({ ok: false, sent: 12, error: null });
    expect(out.tone).toBe('error');
    expect(out.message).not.toContain('12');
  });
});

describe('keepsakePreviewMessage', () => {
  it('names the address it went to', () => {
    expect(keepsakePreviewMessage({ ok: true, sent: 1, error: null }, 'host@example.com'))
      .toEqual({
        tone: 'success',
        message: 'Preview sent to host@example.com. Check your inbox — and your spam folder.',
      });
  });

  it('shares the same failure vocabulary as a full send', () => {
    for (const code of Object.keys(ALL_SEND_ERRORS) as KeepsakeSendError[]) {
      const out = keepsakePreviewMessage({ ok: false, sent: 0, error: code }, 'a@b.co');
      expect(out.tone, code).toBe('error');
      expect(out.message, code).toBe(keepsakeSendMessage({ ok: false, sent: 0, error: code }).message);
    }
  });
});
