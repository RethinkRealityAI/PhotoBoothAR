import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMyOrg, fetchMyOrgResult } from './host';

// host.ts creates the supabase client at module load — mock it (same pattern
// as eventDesigner.test.ts). Only the org_members select→limit→maybeSingle
// chain used by fetchMyOrgResult is stubbed.
const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: () => ({ maybeSingle }) }) }),
    functions: { invoke: vi.fn() },
  },
}));

beforeEach(() => {
  maybeSingle.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMyOrgResult', () => {
  it('flags a genuine query FAILURE (failed true, org null)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: true });
  });

  it('a successful fetch with no membership is NOT a failure', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: false });
  });

  it('maps a membership row (orgs as object) to HostOrg', async () => {
    maybeSingle.mockResolvedValue({
      data: { role: 'owner', orgs: { id: 'org-1', name: 'Acme' } },
      error: null,
    });
    await expect(fetchMyOrgResult()).resolves.toEqual({
      org: { orgId: 'org-1', name: 'Acme', role: 'owner' },
      failed: false,
    });
  });

  it('takes the first org when the join comes back as an array', async () => {
    maybeSingle.mockResolvedValue({
      data: { role: 'editor', orgs: [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: 'Beta' }] },
      error: null,
    });
    await expect(fetchMyOrgResult()).resolves.toEqual({
      org: { orgId: 'org-1', name: 'Acme', role: 'editor' },
      failed: false,
    });
  });

  it('a membership row with a null orgs join is no-org, not a failure', async () => {
    maybeSingle.mockResolvedValue({ data: { role: 'owner', orgs: null }, error: null });
    await expect(fetchMyOrgResult()).resolves.toEqual({ org: null, failed: false });
  });
});

describe('fetchMyOrg (back-compat wrapper)', () => {
  it('collapses BOTH failure and no-org to null', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    await expect(fetchMyOrg()).resolves.toBeNull();
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchMyOrg()).resolves.toBeNull();
  });

  it('returns the mapped org on success', async () => {
    maybeSingle.mockResolvedValue({
      data: { role: 'owner', orgs: { id: 'org-1', name: 'Acme' } },
      error: null,
    });
    await expect(fetchMyOrg()).resolves.toEqual({ orgId: 'org-1', name: 'Acme', role: 'owner' });
  });
});
