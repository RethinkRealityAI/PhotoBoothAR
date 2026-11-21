import { describe, it, expect } from 'vitest';
import {
  INBOX_STATUS_FILTERS,
  CLEARED_FILTERS,
  needsAction,
  serverStatusFor,
  keepForFilter,
  serverQueryIsUnfiltered,
  filtersAreCleared,
  activeFilterLabels,
  inboxEmptyKind,
  type InboxFilters,
} from './supportInbox';
import type { SupportStatus } from './supportModel';

const ALL_STATUSES: SupportStatus[] = ['new', 'open', 'waiting_on_customer', 'waiting_on_us', 'resolved', 'closed'];

describe('needsAction', () => {
  it('is the team-owes-a-move set: new, open, waiting on us', () => {
    expect(ALL_STATUSES.filter(needsAction)).toEqual(['new', 'open', 'waiting_on_us']);
  });
  it('excludes tickets waiting on the customer', () => {
    expect(needsAction('waiting_on_customer')).toBe(false);
  });
});

describe('serverStatusFor / keepForFilter', () => {
  it('asks the server for every status for needs_action and all', () => {
    expect(serverStatusFor('needs_action')).toBe('');
    expect(serverStatusFor('all')).toBe('');
  });
  it('never sends the shadowed "open" alias', () => {
    for (const f of INBOX_STATUS_FILTERS) expect(serverStatusFor(f.id)).not.toBe('open');
  });
  it('passes a single status straight through', () => {
    expect(serverStatusFor('waiting_on_customer')).toBe('waiting_on_customer');
  });
  it('keeps exactly the needs-action rows client-side', () => {
    expect(ALL_STATUSES.filter((s) => keepForFilter('needs_action', s))).toEqual(['new', 'open', 'waiting_on_us']);
    expect(ALL_STATUSES.filter((s) => keepForFilter('all', s))).toEqual(ALL_STATUSES);
    expect(ALL_STATUSES.filter((s) => keepForFilter('resolved', s))).toEqual(['resolved']);
  });
  it('defaults to needs_action as the first chip', () => {
    expect(INBOX_STATUS_FILTERS[0].id).toBe('needs_action');
  });
});

const f = (over: Partial<InboxFilters>): InboxFilters => ({ ...CLEARED_FILTERS, ...over });

describe('filter predicates', () => {
  it('treats the client-side needs_action chip as an unfiltered server query', () => {
    expect(serverQueryIsUnfiltered(f({ status: 'needs_action' }))).toBe(true);
    expect(filtersAreCleared(f({ status: 'needs_action' }))).toBe(false);
  });
  it('any server-side filter makes the query filtered', () => {
    expect(serverQueryIsUnfiltered(f({ status: 'new' }))).toBe(false);
    expect(serverQueryIsUnfiltered(f({ unreadOnly: true }))).toBe(false);
    expect(serverQueryIsUnfiltered(f({ category: 'bug' }))).toBe(false);
    expect(serverQueryIsUnfiltered(f({ search: 'abc' }))).toBe(false);
    expect(serverQueryIsUnfiltered(f({ search: '   ' }))).toBe(true);
  });
  it('labels active filters in bar order', () => {
    expect(activeFilterLabels(CLEARED_FILTERS, (c) => c)).toEqual([]);
    expect(activeFilterLabels(
      f({ status: 'waiting_on_customer', unreadOnly: true, category: 'bug', search: ' gala ' }),
      (c) => (c === 'bug' ? 'Something broke' : c),
    )).toEqual(['On them', 'Unread only', 'Something broke', '“gala”']);
  });
});

describe('inboxEmptyKind', () => {
  it('an unfiltered empty answer means no tickets exist', () => {
    expect(inboxEmptyKind({ filters: f({ status: 'needs_action' }), serverRows: 0, serverHasMore: false, anyTickets: null }))
      .toBe('none-ever');
    expect(inboxEmptyKind({ filters: CLEARED_FILTERS, serverRows: 0, serverHasMore: false, anyTickets: null }))
      .toBe('none-ever');
  });
  it('rows returned but hidden by needs_action is filtered', () => {
    expect(inboxEmptyKind({ filters: f({ status: 'needs_action' }), serverRows: 3, serverHasMore: false, anyTickets: null }))
      .toBe('filtered');
  });
  it('a server filter defers to the probe', () => {
    const filters = f({ status: 'closed' });
    expect(inboxEmptyKind({ filters, serverRows: 0, serverHasMore: false, anyTickets: false })).toBe('none-ever');
    expect(inboxEmptyKind({ filters, serverRows: 0, serverHasMore: false, anyTickets: true })).toBe('filtered');
    expect(inboxEmptyKind({ filters, serverRows: 0, serverHasMore: false, anyTickets: null })).toBe('unknown');
  });
});
