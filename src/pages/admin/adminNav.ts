/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The /admin rail's structure, kept pure so the grouping and "which page am I
 * on" rule can be tested without rendering. Fifteen destinations in one flat
 * column filled a 900px laptop to the last pixel (and clipped below that); in
 * four named groups the operator finds a screen by what it is for.
 */

export type AdminNavId =
  | 'overview' | 'customers' | 'events' | 'support'
  | 'payments' | 'catalog' | 'credits'
  | 'library' | 'home-assets' | 'landing' | 'reveals' | 'qr-cards'
  | 'features' | 'users' | 'audit' | 'admins';

export interface AdminNavEntry {
  id: AdminNavId;
  to: string;
  label: string;
  /** Only the index route matches exactly; every other entry owns its subtree. */
  end?: boolean;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavEntry[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'Run',
    items: [
      { id: 'overview', to: '/admin', end: true, label: 'Overview' },
      { id: 'customers', to: '/admin/customers', label: 'Customers' },
      { id: 'events', to: '/admin/events', label: 'Events' },
      { id: 'support', to: '/admin/support', label: 'Support' },
    ],
  },
  {
    label: 'Money',
    items: [
      { id: 'payments', to: '/admin/payments', label: 'Payments' },
      { id: 'catalog', to: '/admin/catalog', label: 'Catalog' },
      { id: 'credits', to: '/admin/credits', label: 'Credits' },
    ],
  },
  {
    label: 'Content',
    items: [
      { id: 'library', to: '/admin/library', label: 'Library' },
      { id: 'home-assets', to: '/admin/home-assets', label: 'Homepage' },
      { id: 'landing', to: '/admin/landing', label: 'Classic landing' },
      { id: 'reveals', to: '/admin/reveals', label: 'Reveals' },
      { id: 'qr-cards', to: '/admin/qr-cards', label: 'QR cards' },
    ],
  },
  {
    label: 'Access',
    items: [
      { id: 'features', to: '/admin/features', label: 'Plans & features' },
      { id: 'users', to: '/admin/users', label: 'Users' },
      { id: 'audit', to: '/admin/audit', label: 'Audit log' },
      { id: 'admins', to: '/admin/admins', label: 'Admins' },
    ],
  },
];

export const ADMIN_NAV: AdminNavEntry[] = ADMIN_NAV_GROUPS.flatMap((g) => g.items);

/** The rail entry a path belongs to (deepest match wins), or null off the map. */
export function currentAdminNav(pathname: string): AdminNavEntry | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best: AdminNavEntry | null = null;
  for (const item of ADMIN_NAV) {
    const hit = item.end ? path === item.to : path === item.to || path.startsWith(`${item.to}/`);
    if (hit && (best === null || item.to.length > best.to.length)) best = item;
  }
  return best;
}
