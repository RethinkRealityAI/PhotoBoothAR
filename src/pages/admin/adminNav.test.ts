import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, ADMIN_NAV_GROUPS, currentAdminNav } from './adminNav';

describe('admin rail', () => {
  it('lists every admin destination exactly once', () => {
    const paths = ADMIN_NAV.map((n) => n.to);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(expect.arrayContaining([
      '/admin', '/admin/customers', '/admin/events', '/admin/support', '/admin/payments',
      '/admin/catalog', '/admin/credits', '/admin/library', '/admin/home-assets', '/admin/landing',
      '/admin/reveals', '/admin/qr-cards', '/admin/features', '/admin/users', '/admin/audit', '/admin/admins', '/admin/connector',
    ]));
    expect(paths).toHaveLength(17);
  });

  it('keeps every group non-empty', () => {
    for (const g of ADMIN_NAV_GROUPS) expect(g.items.length).toBeGreaterThan(0);
  });

  it('matches the index only exactly', () => {
    expect(currentAdminNav('/admin')?.id).toBe('overview');
    expect(currentAdminNav('/admin/')?.id).toBe('overview');
    expect(currentAdminNav('/admin/nope')).toBeNull();
  });

  it('gives a nested page to its section', () => {
    expect(currentAdminNav('/admin/customers/abc')?.id).toBe('customers');
    expect(currentAdminNav('/admin/library/import')?.id).toBe('library');
    expect(currentAdminNav('/admin/reveals/r1')?.id).toBe('reveals');
  });

  it('does not match a sibling that only shares a prefix', () => {
    expect(currentAdminNav('/admin/usersx')).toBeNull();
    expect(currentAdminNav('/host')).toBeNull();
  });
});
