import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMyOrg, fetchMyOrgResult, pickPrimaryOrg } from './host';

// host.ts creates the supabase client at module load — mock it (same pattern
// as eventDesigner.test.ts). Only the org_members select→eq→order chain used
// by fetchMyOrgResult, plus the auth.getSession it scopes that query with, are
// stubbed.
const { order, getSession } = vi.hoisted(() => ({ order: vi.fn(), getSession: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order }) }) }),
    auth: { getSession },
    functions: { invoke: vi.fn() },
  },
}));

const SIGNED_IN = { data: { session: { user: { id: 'user-1' } } } };

beforeEach(() => {
  order.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue(SIGNED_IN);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMyOrgResult', () => {
  it('flags a genuine query FAILURE (failed true, org null)', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: true });
  });

  it('a successful fetch with no membership is NOT a failure', async () => {
    order.mockResolvedValue({ data: [], error: null });
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: false });
  });

  it('maps a membership row (orgs as object) to HostOrg', async () => {
    order.mockResolvedValue({
      data: [{ role: 'owner', orgs: { id: 'org-1', name: 'Acme' } }],
      error: null,
    });
    await expect(fetchMyOrgResult()).resolves.toEqual({
      org: { orgId: 'org-1', name: 'Acme', role: 'owner' },
      failed: false,
    });
  });

  it('takes the first org when the join comes back as an array', async () => {
    order.mockResolvedValue({
      data: [{ role: 'editor', orgs: [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: 'Beta' }] }],
      error: null,
    });
    await expect(fetchMyOrgResult()).resolves.toEqual({
      org: { orgId: 'org-1', name: 'Acme', role: 'editor' },
      failed: false,
    });
  });

  it('a membership row with a null orgs join is no-org, not a failure', async () => {
    order.mockResolvedValue({ data: [{ role: 'owner', orgs: null }], error: null });
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: false });
  });

  it('scopes the query to the CALLER — org_members RLS also returns colleagues', async () => {
    // is_org_member(org_id) exposes every member row of every org you belong
    // to, so an unfiltered read could hand back a co-worker's row (and their
    // role). The user id from the session must reach the query.
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const { supabase } = await import('./supabase');
    vi.spyOn(supabase, 'from').mockReturnValue({ select } as never);
    order.mockResolvedValue({ data: [], error: null });

    await fetchMyOrgResult();
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(select).toHaveBeenCalledWith(expect.stringContaining('owner_id'));
  });

  it('a signed-out caller is no-org, not a failure', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: false });
    expect(order).not.toHaveBeenCalled();
  });

  it('a session read that THROWS is a failure — the org is unknowable', async () => {
    getSession.mockRejectedValue(new Error('storage unavailable'));
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: true });
  });
});

describe('pickPrimaryOrg (multi-org determinism)', () => {
  const row = (
    role: string,
    id: string,
    name: string,
    owner_id: string | null = null,
  ) => ({ role, orgs: { id, name, owner_id } });

  it('prefers the org the user OWNS over an earlier-joined one', () => {
    const rows = [row('editor', 'org-a', 'Agency', 'someone-else'), row('editor', 'org-b', 'Mine', 'user-1')];
    expect(pickPrimaryOrg(rows, 'user-1')).toEqual({ orgId: 'org-b', name: 'Mine', role: 'editor' });
  });

  it('falls back to an owner MEMBERSHIP when orgs.owner_id was nulled out', () => {
    const rows = [row('editor', 'org-a', 'Agency', null), row('owner', 'org-b', 'Mine', null)];
    expect(pickPrimaryOrg(rows, 'user-1')).toEqual({ orgId: 'org-b', name: 'Mine', role: 'owner' });
  });

  it('falls back to the earliest-joined membership when nothing is owned', () => {
    const rows = [row('editor', 'org-a', 'Agency'), row('editor', 'org-b', 'Beta')];
    expect(pickPrimaryOrg(rows, 'user-1')).toEqual({ orgId: 'org-a', name: 'Agency', role: 'editor' });
  });

  it('is deterministic: the same memberships always resolve to the same org', () => {
    const rows = [row('editor', 'org-a', 'Agency'), row('owner', 'org-b', 'Mine', 'user-1'), row('owner', 'org-c', 'Third', 'user-1')];
    const first = pickPrimaryOrg(rows, 'user-1');
    expect(pickPrimaryOrg(rows, 'user-1')).toEqual(first);
    expect(first).toEqual({ orgId: 'org-b', name: 'Mine', role: 'owner' }); // earliest of the owned
  });

  it('ignores an unknown user id rather than matching a null owner_id', () => {
    const rows = [row('editor', 'org-a', 'Agency', null)];
    expect(pickPrimaryOrg(rows, null)).toEqual({ orgId: 'org-a', name: 'Agency', role: 'editor' });
  });

  it('skips rows whose org join is missing, and returns null when none survive', () => {
    expect(pickPrimaryOrg([{ role: 'owner', orgs: null }], 'user-1')).toBeNull();
    expect(pickPrimaryOrg([], 'user-1')).toBeNull();
    expect(pickPrimaryOrg([{ role: 'owner', orgs: null }, row('editor', 'org-a', 'Agency')], 'user-1'))
      .toEqual({ orgId: 'org-a', name: 'Agency', role: 'editor' });
  });
});

describe('fetchMyOrg (back-compat wrapper)', () => {
  it('collapses BOTH failure and no-org to null', async () => {
    order.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    await expect(fetchMyOrg()).resolves.toBeNull();
    order.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchMyOrg()).resolves.toBeNull();
  });

  it('returns the mapped org on success', async () => {
    order.mockResolvedValue({
      data: [{ role: 'owner', orgs: { id: 'org-1', name: 'Acme' } }],
      error: null,
    });
    await expect(fetchMyOrg()).resolves.toEqual({ orgId: 'org-1', name: 'Acme', role: 'owner' });
  });
});
