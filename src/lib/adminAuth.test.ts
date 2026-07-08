import { describe, it, expect } from 'vitest';
import { normalizeAdminEmail, canRemoveAdmin } from './adminAuth';

describe('normalizeAdminEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeAdminEmail('  Dapo@RethinkReality.AI  ')).toBe('dapo@rethinkreality.ai');
  });
  it('is idempotent', () => {
    expect(normalizeAdminEmail(normalizeAdminEmail('a@b.com'))).toBe('a@b.com');
  });
});

describe('canRemoveAdmin', () => {
  it('blocks removing yourself', () => {
    const result = canRemoveAdmin({ actorUserId: 'u1', targetUserId: 'u1', totalAdmins: 3 });
    expect(result).toEqual({ ok: false, reason: 'cannot_remove_self' });
  });
  it('blocks removing the last admin, even if it is not the actor', () => {
    const result = canRemoveAdmin({ actorUserId: 'u1', targetUserId: 'u2', totalAdmins: 1 });
    expect(result).toEqual({ ok: false, reason: 'cannot_remove_last_admin' });
  });
  it('self-removal takes priority when both conditions apply', () => {
    const result = canRemoveAdmin({ actorUserId: 'u1', targetUserId: 'u1', totalAdmins: 1 });
    expect(result.reason).toBe('cannot_remove_self');
  });
  it('allows removing another admin when more than one remain', () => {
    const result = canRemoveAdmin({ actorUserId: 'u1', targetUserId: 'u2', totalAdmins: 2 });
    expect(result).toEqual({ ok: true });
  });
});
