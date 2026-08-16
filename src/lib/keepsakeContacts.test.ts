import { describe, it, expect } from 'vitest';
import {
  normalizeKeepsakeEmail,
  classifyOptInError,
  keepsakeOptInMessage,
  asSendError,
  normalizeSendResult,
  sendErrorResult,
} from './keepsakeContacts';

describe('normalizeKeepsakeEmail', () => {
  it('trims a good address', () => {
    expect(normalizeKeepsakeEmail('  guest@example.com  ')).toBe('guest@example.com');
  });

  it('does NOT lower-case (the local part is case-sensitive)', () => {
    expect(normalizeKeepsakeEmail('Guest.Name@Example.COM')).toBe('Guest.Name@Example.COM');
  });

  it('rejects addresses that are not addresses', () => {
    expect(normalizeKeepsakeEmail('guest')).toBeNull();
    expect(normalizeKeepsakeEmail('guest@')).toBeNull();
    expect(normalizeKeepsakeEmail('@example.com')).toBeNull();
    expect(normalizeKeepsakeEmail('guest@example')).toBeNull(); // no dotted TLD
    expect(normalizeKeepsakeEmail('a b@example.com')).toBeNull(); // whitespace
    expect(normalizeKeepsakeEmail('guest@exam ple.com')).toBeNull();
  });

  it('rejects blank and non-strings', () => {
    expect(normalizeKeepsakeEmail('')).toBeNull();
    expect(normalizeKeepsakeEmail('   ')).toBeNull();
    expect(normalizeKeepsakeEmail(null)).toBeNull();
    expect(normalizeKeepsakeEmail(undefined)).toBeNull();
    expect(normalizeKeepsakeEmail(42)).toBeNull();
    expect(normalizeKeepsakeEmail({ email: 'guest@example.com' })).toBeNull();
  });

  it('enforces the same 320-char ceiling migration 034 CHECKs', () => {
    const long = `${'a'.repeat(310)}@example.com`; // 322 chars
    expect(long.length).toBeGreaterThan(320);
    expect(normalizeKeepsakeEmail(long)).toBeNull();
    const ok = `${'a'.repeat(300)}@example.com`; // 312 chars
    expect(ok.length).toBeLessThanOrEqual(320);
    expect(normalizeKeepsakeEmail(ok)).toBe(ok);
  });
});

describe('classifyOptInError', () => {
  it('no code = saved', () => {
    expect(classifyOptInError(null)).toEqual({ ok: true, alreadySaved: false, error: null });
    expect(classifyOptInError(undefined)).toEqual({ ok: true, alreadySaved: false, error: null });
    expect(classifyOptInError('')).toEqual({ ok: true, alreadySaved: false, error: null });
  });

  it('a unique violation is SUCCESS — this device already opted in', () => {
    expect(classifyOptInError('23505', 'duplicate key value')).toEqual({
      ok: true,
      alreadySaved: true,
      error: null,
    });
  });

  it('RLS refusal and a dead FK both read as event_closed', () => {
    expect(classifyOptInError('42501').error).toBe('event_closed');
    expect(classifyOptInError('23503').error).toBe('event_closed');
    expect(classifyOptInError('42501').ok).toBe(false);
  });

  it("recognises 034's cap by its raise message", () => {
    expect(classifyOptInError('P0001', 'guest_contact_cap').error).toBe('cap_reached');
  });

  it('a different P0001 raise is not silently reported as the cap', () => {
    expect(classifyOptInError('P0001', 'something else entirely').error).toBe('failed');
  });

  it('an unknown code fails rather than passing through', () => {
    expect(classifyOptInError('08006')).toEqual({
      ok: false,
      alreadySaved: false,
      error: 'failed',
    });
  });
});

describe('keepsakeOptInMessage', () => {
  it('gives a distinct sentence per outcome', () => {
    const all = [null, 'invalid_email', 'event_closed', 'cap_reached', 'failed'] as const;
    const msgs = all.map((e) => keepsakeOptInMessage(e));
    expect(new Set(msgs).size).toBe(all.length);
    msgs.forEach((m) => expect(m.length).toBeGreaterThan(0));
  });

  it('never leaks an error code to the guest', () => {
    const all = ['invalid_email', 'event_closed', 'cap_reached', 'failed'] as const;
    all.forEach((e) => {
      const m = keepsakeOptInMessage(e);
      expect(m).not.toMatch(/\d{5}|P0001|guest_contact_cap/);
    });
  });
});

describe('asSendError', () => {
  it('passes through every known code', () => {
    ['unauthorized', 'forbidden', 'event_not_found', 'event_still_live', 'recently_sent',
      'preview_rate_limited', 'invalid_email', 'invalid_body', 'email_not_configured',
      'email_failed', 'internal', 'network'].forEach((c) => {
      expect(asSendError(c)).toBe(c);
    });
  });

  it('maps anything unrecognised onto internal', () => {
    expect(asSendError('surprise')).toBe('internal');
    expect(asSendError(undefined)).toBe('internal');
    expect(asSendError(null)).toBe('internal');
    expect(asSendError(500)).toBe('internal');
  });
});

describe('normalizeSendResult', () => {
  it('reads a real success body', () => {
    expect(normalizeSendResult({ sent: 40, skipped: 2, failed: 1, emailConfigured: true })).toEqual({
      ok: true,
      sent: 40,
      skipped: 2,
      failed: 1,
      emailConfigured: true,
      error: null,
    });
  });

  it('keeps a zero send honest (0 is data, not "missing")', () => {
    const r = normalizeSendResult({ sent: 0, skipped: 0, failed: 0, emailConfigured: true });
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(0);
  });

  it('refuses to call a body without emailConfigured a success', () => {
    expect(normalizeSendResult({ sent: 40 })).toEqual({
      ok: false, sent: 0, skipped: 0, failed: 0, emailConfigured: false, error: 'internal',
    });
    expect(normalizeSendResult({ sent: 40, emailConfigured: 'true' }).ok).toBe(false);
    expect(normalizeSendResult(null).ok).toBe(false);
    expect(normalizeSendResult(undefined).ok).toBe(false);
    expect(normalizeSendResult('nope').ok).toBe(false);
  });

  it('zeroes non-finite counts instead of propagating them', () => {
    const r = normalizeSendResult({ sent: NaN, skipped: '3', failed: Infinity, emailConfigured: true });
    expect(r).toMatchObject({ ok: true, sent: 0, skipped: 0, failed: 0 });
  });

  it('accepts the preview body shape (sent only)', () => {
    const r = normalizeSendResult({ sent: 1, emailConfigured: true });
    expect(r).toMatchObject({ ok: true, sent: 1, skipped: 0, failed: 0, emailConfigured: true });
  });
});

describe('sendErrorResult', () => {
  it('never claims email is configured on a failure — including a transport one', () => {
    (['email_not_configured', 'network', 'internal', 'forbidden'] as const).forEach((e) => {
      const r = sendErrorResult(e);
      expect(r.emailConfigured).toBe(false);
      expect(r.ok).toBe(false);
      expect(r.sent).toBe(0);
      expect(r.error).toBe(e);
    });
  });
});
