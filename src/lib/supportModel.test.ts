import { describe, it, expect } from 'vitest';
import {
  SUPPORT_CATEGORIES,
  categoryDef,
  isSupportCategory,
  suggestCategories,
  redactUrl,
  redactDiagnostics,
  REDACTED,
  unreadForCustomer,
  unreadForAdmin,
  unreadCount,
  isOpenStatus,
  statusAfterCustomerReply,
  statusAfterAdminReply,
  canTransition,
  type UnreadFields,
} from './supportModel';

describe('category catalogue', () => {
  it('every pill has a distinct id and non-empty copy', () => {
    const ids = SUPPORT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SUPPORT_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.hint.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
    }
  });

  it('falls back to "other" rather than throwing on an unknown id', () => {
    expect(categoryDef('nonsense').id).toBe('other');
    expect(isSupportCategory('nonsense')).toBe(false);
    expect(isSupportCategory('billing')).toBe(true);
  });
});

describe('suggestCategories', () => {
  it('always returns every category, so a wrong guess is recoverable', () => {
    const out = suggestCategories('guest_booth', '/e/wall-party/booth', '');
    expect(out).toHaveLength(SUPPORT_CATEGORIES.length);
    expect(new Set(out).size).toBe(out.length);
  });

  it('leads with bug from an error boundary', () => {
    expect(suggestCategories('error_boundary', '/host', '')[0]).toBe('bug');
  });

  it('leads with billing on the billing route', () => {
    expect(suggestCategories('host_rail', '/host/billing', '')[0]).toBe('billing');
  });

  it('what the user typed beats the route they are on', () => {
    // On the billing page, but describing a broken camera.
    const out = suggestCategories('host_rail', '/host/billing', 'the camera is frozen');
    expect(out[0]).toBe('bug');
  });

  it('surfaces billing from "charged twice" regardless of surface', () => {
    expect(suggestCategories('landing', '/', 'I was charged twice this month')[0]).toBe('billing');
  });

  it('degrades to the full default order when it knows nothing', () => {
    expect(suggestCategories(null, null, null)).toEqual(SUPPORT_CATEGORIES.map((c) => c.id));
  });
});

describe('redactUrl — session-granting secrets must never reach a ticket', () => {
  it('strips a Supabase recovery fragment entirely', () => {
    const recovery =
      'https://beamwall.app/reset-password#access_token=eyJhbGciOi.REAL.SECRET' +
      '&refresh_token=v1.MDk4NzY&expires_in=3600&type=recovery';
    const out = redactUrl(recovery);
    expect(out).toBe('https://beamwall.app/reset-password');
    expect(out).not.toContain('access_token');
    expect(out).not.toContain('refresh_token');
    expect(out).not.toContain('REAL.SECRET');
  });

  it('redacts token-shaped query params but keeps the key visible', () => {
    const out = redactUrl('https://beamwall.app/m/gala?token=abc123secret&tab=posts');
    expect(out).toContain(`token=${encodeURIComponent(REDACTED)}`);
    expect(out).not.toContain('abc123secret');
    expect(out).toContain('tab=posts');
  });

  it('redacts every secret-shaped param name we know about', () => {
    for (const key of ['access_token', 'refresh_token', 'id_token', 'code', 'apikey', 'api_key', 'secret', 'password', 'key']) {
      const out = redactUrl(`https://x.test/p?${key}=leak-me`);
      expect(out, key).not.toContain('leak-me');
    }
  });

  it('leaves an ordinary url alone', () => {
    const plain = 'https://beamwall.app/host/events/abc/studio';
    expect(redactUrl(plain)).toBe(plain);
  });

  it('drops the query and fragment of an unparseable value rather than keeping it', () => {
    expect(redactUrl('/reset-password#access_token=leak')).toBe('/reset-password');
    expect(redactUrl('not a url ?token=leak')).toBe('not a url ');
  });

  it('never throws and returns "" for empty input', () => {
    expect(redactUrl(null)).toBe('');
    expect(redactUrl(undefined)).toBe('');
    expect(redactUrl('   ')).toBe('');
  });

  it('truncates to the cap', () => {
    expect(redactUrl(`https://x.test/${'a'.repeat(900)}`, 100)).toHaveLength(100);
  });
});

describe('redactDiagnostics', () => {
  it('redacts url-ish keys and passes everything else through untouched', () => {
    const out = redactDiagnostics({
      url: 'https://beamwall.app/reset-password#access_token=leak',
      referrer: 'https://beamwall.app/login?code=leak',
      userAgent: 'Mozilla/5.0',
      viewport: '390x844',
      postCount: 0,
      offline: false,
    });
    expect(out.url).toBe('https://beamwall.app/reset-password');
    expect(String(out.referrer)).not.toContain('leak');
    expect(out.userAgent).toBe('Mozilla/5.0');
    // 0 and false are data, not absence — they must survive.
    expect(out.postCount).toBe(0);
    expect(out.offline).toBe(false);
  });

  it('handles a missing bag', () => {
    expect(redactDiagnostics(null)).toEqual({});
  });
});

describe('unread arithmetic', () => {
  const base: UnreadFields = {
    last_message_at: '2026-07-27T12:00:00Z',
    customer_last_read_at: null,
    admin_last_read_at: null,
  };

  it('a never-read ticket is unread for both sides', () => {
    expect(unreadForCustomer(base)).toBe(true);
    expect(unreadForAdmin(base)).toBe(true);
  });

  it('an identical timestamp is READ — the author is not notified of their own message', () => {
    const t = { ...base, admin_last_read_at: '2026-07-27T12:00:00Z' };
    expect(unreadForAdmin(t)).toBe(false);
    expect(unreadForCustomer(t)).toBe(true);
  });

  it('a later message than the pointer is unread', () => {
    expect(unreadForAdmin({ ...base, admin_last_read_at: '2026-07-27T11:59:59Z' })).toBe(true);
  });

  it('a pointer past the last message is read', () => {
    expect(unreadForAdmin({ ...base, admin_last_read_at: '2026-07-27T12:00:01Z' })).toBe(false);
  });

  it('a ticket with no messages is unread for nobody', () => {
    const empty = { last_message_at: null, customer_last_read_at: null, admin_last_read_at: null };
    expect(unreadForCustomer(empty)).toBe(false);
    expect(unreadForAdmin(empty)).toBe(false);
  });

  it('counts per side independently', () => {
    const rows: UnreadFields[] = [
      base,
      { ...base, admin_last_read_at: '2026-07-27T12:00:00Z' },
      { last_message_at: null, customer_last_read_at: null, admin_last_read_at: null },
    ];
    expect(unreadCount(rows, 'admin')).toBe(1);
    expect(unreadCount(rows, 'customer')).toBe(2);
  });
});

describe('status machine', () => {
  it('a customer reply on a resolved ticket reopens it as waiting_on_us', () => {
    expect(statusAfterCustomerReply('resolved')).toBe('waiting_on_us');
  });

  it('closed is terminal — a stray reply cannot resurrect it', () => {
    expect(statusAfterCustomerReply('closed')).toBe('closed');
    expect(statusAfterAdminReply('closed')).toBe('closed');
  });

  it('an operator reply puts the ball in the customer court', () => {
    expect(statusAfterAdminReply('new')).toBe('waiting_on_customer');
    expect(statusAfterAdminReply('waiting_on_us')).toBe('waiting_on_customer');
  });

  it('an operator reply on a resolved ticket does not silently reopen it', () => {
    expect(statusAfterAdminReply('resolved')).toBe('resolved');
  });

  it('knows which statuses still need somebody', () => {
    expect(isOpenStatus('new')).toBe(true);
    expect(isOpenStatus('waiting_on_customer')).toBe(true);
    expect(isOpenStatus('resolved')).toBe(false);
    expect(isOpenStatus('closed')).toBe(false);
  });

  it('refuses a no-op transition and only allows reopening from closed', () => {
    expect(canTransition('open', 'open')).toBe(false);
    expect(canTransition('closed', 'open')).toBe(true);
    expect(canTransition('closed', 'resolved')).toBe(false);
    expect(canTransition('new', 'resolved')).toBe(true);
  });
});
