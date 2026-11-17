import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchMyOrg,
  fetchMyOrgResult,
  goLive,
  pickPrimaryOrg,
  updateEventConfig,
  updateEventDate,
  updateEventName,
  updateEventStatus,
} from './host';

// host.ts creates the supabase client at module load — mock it (same pattern
// as eventDesigner.test.ts). Only the org_members select→eq→order chain used
// by fetchMyOrgResult, the events update→eq→select chain used by the lifecycle
// writers, plus the auth.getSession the org query is scoped with, are stubbed.
const { order, maybeSingle, getSession, update, updateSelect, generateEventCopy } = vi.hoisted(() => ({
  order: vi.fn(),
  maybeSingle: vi.fn(),
  getSession: vi.fn(),
  update: vi.fn(),
  updateSelect: vi.fn(),
  generateEventCopy: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order, maybeSingle }) }),
      update: (patch: Record<string, unknown>) => {
        update(patch);
        return { eq: () => ({ select: updateSelect }) };
      },
    }),
    auth: { getSession },
    functions: { invoke: vi.fn() },
  },
}));

const SIGNED_IN = { data: { session: { user: { id: 'user-1' } } } };

/** What PostgREST hands back for an UPDATE … RETURNING id that matched a row. */
const ONE_ROW = { data: [{ id: 'ev-1' }], error: null };
/** …and for one that matched none: 204, no error. The whole point of the tests. */
const NO_ROWS = { data: [], error: null };

// goLive lazy-imports ./eventCopy (whose impure half reaches supabase) — mocked
// so the fire-and-forget is observable and never touches a client.
vi.mock('./eventCopy', () => ({ generateEventCopy }));

beforeEach(() => {
  order.mockReset();
  maybeSingle.mockReset();
  getSession.mockReset();
  update.mockReset();
  updateSelect.mockReset();
  generateEventCopy.mockReset();
  generateEventCopy.mockResolvedValue({ ok: true });
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

describe('lifecycle writes report a zero-row UPDATE as failure', () => {
  // An UPDATE filtered out by tenant RLS (or aimed at a stale id) returns 204
  // with error === null. Reading only `error` made that indistinguishable from
  // success, which is how the copilot came to announce "Your event is LIVE"
  // over a write that changed nothing.
  it('updateEventStatus: one row → true, no rows → false, error → false', async () => {
    updateSelect.mockResolvedValueOnce(ONE_ROW);
    await expect(updateEventStatus('ev-1', 'live')).resolves.toBe(true);
    updateSelect.mockResolvedValueOnce(NO_ROWS);
    await expect(updateEventStatus('ev-1', 'live')).resolves.toBe(false);
    updateSelect.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(updateEventStatus('ev-1', 'live')).resolves.toBe(false);
  });

  it('updateEventDate: one row → true, no rows → false, error → false', async () => {
    updateSelect.mockResolvedValueOnce(ONE_ROW);
    await expect(updateEventDate('ev-1', '2026-09-12')).resolves.toBe(true);
    updateSelect.mockResolvedValueOnce(NO_ROWS);
    await expect(updateEventDate('ev-1', '2026-09-12')).resolves.toBe(false);
    updateSelect.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(updateEventDate('ev-1', '2026-09-12')).resolves.toBe(false);
  });

  it('updateEventName: one row → true, no rows → false, error → false', async () => {
    updateSelect.mockResolvedValueOnce(ONE_ROW);
    await expect(updateEventName('ev-1', 'Gala')).resolves.toBe(true);
    updateSelect.mockResolvedValueOnce(NO_ROWS);
    await expect(updateEventName('ev-1', 'Gala')).resolves.toBe(false);
    updateSelect.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(updateEventName('ev-1', 'Gala')).resolves.toBe(false);
  });

  it('updateEventName still refuses an empty name without touching the DB', async () => {
    await expect(updateEventName('ev-1', '   ')).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('updateEventDate still sends start-of-day, and null for an empty date', async () => {
    updateSelect.mockResolvedValue(ONE_ROW);
    await updateEventDate('ev-1', '2026-09-12');
    expect(update).toHaveBeenLastCalledWith({ starts_at: new Date('2026-09-12T00:00:00').toISOString() });
    await updateEventDate('ev-1', '');
    expect(update).toHaveBeenLastCalledWith({ starts_at: null });
  });

  it('updateEventName still trims', async () => {
    updateSelect.mockResolvedValue(ONE_ROW);
    await updateEventName('ev-1', '  Gala  ');
    expect(update).toHaveBeenLastCalledWith({ name: 'Gala' });
  });
});

describe('updateEventConfig — shallow merge, zero-row write is failure', () => {
  it('merges the patch over the stored config and reports true on one matched row', async () => {
    maybeSingle.mockResolvedValue({ data: { config: { copy: { fullName: 'E' }, keep: 1 } }, error: null });
    updateSelect.mockResolvedValue(ONE_ROW);
    await expect(updateEventConfig('ev-1', { brief: { occasion: 'x' } })).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({ config: { copy: { fullName: 'E' }, keep: 1, brief: { occasion: 'x' } } });
  });

  it('reports false when the UPDATE matched no row, and on read/write errors', async () => {
    maybeSingle.mockResolvedValue({ data: { config: {} }, error: null });
    updateSelect.mockResolvedValue(NO_ROWS);
    await expect(updateEventConfig('ev-1', { a: 1 })).resolves.toBe(false);
    updateSelect.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(updateEventConfig('ev-1', { a: 1 })).resolves.toBe(false);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(updateEventConfig('ev-1', { a: 1 })).resolves.toBe(false);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe('goLive', () => {
  it('flips the status and fires generateEventCopy once, after the flip', async () => {
    updateSelect.mockResolvedValue(ONE_ROW);
    await expect(goLive('ev-1')).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({ status: 'live', archived_at: null });
    await vi.waitFor(() => expect(generateEventCopy).toHaveBeenCalledWith('ev-1'));
    expect(generateEventCopy).toHaveBeenCalledTimes(1);
  });

  it('does NOT generate copy when the flip matched no row', async () => {
    updateSelect.mockResolvedValue(NO_ROWS);
    await expect(goLive('ev-1')).resolves.toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(generateEventCopy).not.toHaveBeenCalled();
  });

  it('a copy generator that rejects cannot undo a successful go-live', async () => {
    updateSelect.mockResolvedValue(ONE_ROW);
    generateEventCopy.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(goLive('ev-1')).resolves.toBe(true);
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
  });
});

describe('updateEventStatus stamps archived_at', () => {
  it('sets it to now when archiving', async () => {
    updateSelect.mockResolvedValue(ONE_ROW);
    const before = Date.now();
    await updateEventStatus('ev-1', 'archived');
    const patch = update.mock.calls[0][0] as { status: string; archived_at: string | null };
    expect(patch.status).toBe('archived');
    expect(typeof patch.archived_at).toBe('string');
    const stamped = Date.parse(patch.archived_at as string);
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('CLEARS it on every other status, so a restored event keeps no stale date', async () => {
    updateSelect.mockResolvedValue(ONE_ROW);
    for (const status of ['ended', 'live', 'draft']) {
      await updateEventStatus('ev-1', status);
      expect(update).toHaveBeenLastCalledWith({ status, archived_at: null });
    }
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
