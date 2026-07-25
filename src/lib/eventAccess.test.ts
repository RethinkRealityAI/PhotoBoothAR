import { describe, it, expect } from 'vitest';
import { accessAllowsBooth, guestAccess, needsMemberCheck } from './eventAccess';

describe('guestAccess', () => {
  it('opens a live event to everyone', () => {
    expect(guestAccess('live', false)).toBe('open');
    expect(guestAccess('live', true)).toBe('open');
  });

  it('closes a draft to guests', () => {
    expect(guestAccess('draft', false)).toBe('not-yet');
  });

  it('still lets the HOST preview their draft — the shipped test_experience flow', () => {
    // The copilot hands the host the real guest URL to test with. A blunt
    // "drafts are closed" rule would have broken that.
    expect(guestAccess('draft', true)).toBe('preview');
    expect(accessAllowsBooth(guestAccess('draft', true))).toBe(true);
  });

  it('closes an ended or archived event to guests', () => {
    expect(guestAccess('ended', false)).toBe('ended');
    expect(guestAccess('archived', false)).toBe('ended');
  });

  it('lets a member look back at an ended event', () => {
    expect(guestAccess('ended', true)).toBe('preview');
    expect(guestAccess('archived', true)).toBe('preview');
  });

  it('fails CLOSED on an unknown or malformed status', () => {
    // A typo or a status added server-side must never default to open.
    for (const s of ['', '   ', 'paused', 'LIVE_SOON', 'undefined']) {
      expect(guestAccess(s, false)).toBe('not-yet');
      expect(accessAllowsBooth(guestAccess(s, false))).toBe(false);
    }
  });

  it('is case- and whitespace-insensitive about the status', () => {
    expect(guestAccess('  LIVE ', false)).toBe('open');
    expect(guestAccess('Draft', false)).toBe('not-yet');
  });
});

describe('accessAllowsBooth', () => {
  it('renders the booth for open and preview only', () => {
    expect(accessAllowsBooth('open')).toBe(true);
    expect(accessAllowsBooth('preview')).toBe(true);
    expect(accessAllowsBooth('not-yet')).toBe(false);
    expect(accessAllowsBooth('ended')).toBe(false);
  });
});

describe('needsMemberCheck', () => {
  it('skips the round-trip on a live event — the common guest path', () => {
    expect(needsMemberCheck('live')).toBe(false);
    expect(needsMemberCheck(' Live ')).toBe(false);
  });

  it('checks membership for anything else', () => {
    for (const s of ['draft', 'ended', 'archived', 'weird', '']) {
      expect(needsMemberCheck(s)).toBe(true);
    }
  });
});
