/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  POLL_ACTIVE_MS,
  POLL_BACKGROUND_MS,
  POLL_MAX_MS,
  bucketOf,
  filterPosts,
  mergeIncoming,
  moveIndex,
  nextPollDelayMs,
  queueCounts,
  undoEntryFor,
} from './managerQueue';
import type { Post } from '../types';

function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    created_at: '2026-07-29T10:00:00.000Z',
    image_url: `https://example.test/${id}.jpg`,
    media_type: 'image',
    duration_ms: null,
    message: null,
    guest_name: null,
    experience_id: null,
    challenge_id: null,
    session_id: null,
    approved: true,
    hidden: false,
    width: null,
    height: null,
    ...over,
  };
}

describe('bucketOf', () => {
  it('sends a hidden post to hidden whatever its approval says', () => {
    expect(bucketOf(post('a', { hidden: true, approved: true }))).toBe('hidden');
    expect(bucketOf(post('b', { hidden: true, approved: false }))).toBe('hidden');
  });

  it('splits the rest on approval', () => {
    expect(bucketOf(post('c', { approved: true }))).toBe('live');
    expect(bucketOf(post('d', { approved: false }))).toBe('pending');
  });
});

describe('queueCounts', () => {
  const posts = [
    post('a', { approved: false }),
    post('b', { approved: false }),
    post('c', { approved: true }),
    post('d', { hidden: true, approved: false }),
  ];

  it('counts each bucket', () => {
    expect(queueCounts(posts)).toEqual({ all: 4, pending: 2, live: 1, hidden: 1 });
  });

  it('partitions exactly — the three buckets sum to the total', () => {
    const c = queueCounts(posts);
    expect(c.pending + c.live + c.hidden).toBe(c.all);
  });

  it('is all zeroes for an empty list', () => {
    expect(queueCounts([])).toEqual({ all: 0, pending: 0, live: 0, hidden: 0 });
  });
});

describe('filterPosts', () => {
  const posts = [
    post('a', { approved: false }),
    post('b', { approved: true }),
    post('c', { hidden: true }),
  ];

  it('is a real filter, not a pass-through', () => {
    expect(filterPosts(posts, 'pending').map((p) => p.id)).toEqual(['a']);
    expect(filterPosts(posts, 'live').map((p) => p.id)).toEqual(['b']);
    expect(filterPosts(posts, 'hidden').map((p) => p.id)).toEqual(['c']);
  });

  it('returns everything for "all"', () => {
    expect(filterPosts(posts, 'all')).toHaveLength(3);
  });

  it('preserves server order', () => {
    const many = [post('1', { approved: false }), post('2', { approved: true }), post('3', { approved: false })];
    expect(filterPosts(many, 'pending').map((p) => p.id)).toEqual(['1', '3']);
  });
});

describe('mergeIncoming', () => {
  it('reports ids the console has not seen before', () => {
    const prev = [post('a'), post('b')];
    const next = [post('c'), post('a'), post('b')];
    expect(mergeIncoming(prev, next).arrivedIds).toEqual(['c']);
  });

  it('takes the server list verbatim, so a deleted post cannot be resurrected', () => {
    const prev = [post('a'), post('b')];
    const next = [post('a')];
    const { posts, arrivedIds } = mergeIncoming(prev, next);
    expect(posts.map((p) => p.id)).toEqual(['a']);
    expect(arrivedIds).toEqual([]);
  });

  it('treats a first load as all-new', () => {
    expect(mergeIncoming([], [post('a'), post('b')]).arrivedIds).toEqual(['a', 'b']);
  });

  it('reports no arrivals when nothing changed', () => {
    const same = [post('a'), post('b')];
    expect(mergeIncoming(same, [post('a'), post('b')]).arrivedIds).toEqual([]);
  });
});

describe('nextPollDelayMs', () => {
  it('polls fast while the tab is visible and healthy', () => {
    expect(nextPollDelayMs({ consecutiveErrors: 0, documentHidden: false })).toBe(POLL_ACTIVE_MS);
  });

  it('drops to a keep-warm cadence when the tab is backgrounded', () => {
    expect(nextPollDelayMs({ consecutiveErrors: 0, documentHidden: true })).toBe(POLL_BACKGROUND_MS);
  });

  it('backs off exponentially on consecutive failures', () => {
    expect(nextPollDelayMs({ consecutiveErrors: 1, documentHidden: false })).toBe(POLL_ACTIVE_MS * 2);
    expect(nextPollDelayMs({ consecutiveErrors: 2, documentHidden: false })).toBe(POLL_ACTIVE_MS * 4);
  });

  it('never exceeds the ceiling, however long the network is down', () => {
    expect(nextPollDelayMs({ consecutiveErrors: 50, documentHidden: false })).toBe(POLL_MAX_MS);
    expect(nextPollDelayMs({ consecutiveErrors: 50, documentHidden: true })).toBe(POLL_MAX_MS);
  });

  it('treats a negative error count as healthy rather than shrinking the delay', () => {
    expect(nextPollDelayMs({ consecutiveErrors: -3, documentHidden: false })).toBe(POLL_ACTIVE_MS);
  });
});

describe('moveIndex', () => {
  it('steps within bounds', () => {
    expect(moveIndex(1, 1, 5)).toBe(2);
    expect(moveIndex(1, -1, 5)).toBe(0);
  });

  it('clamps instead of wrapping, so a held key cannot re-enter cleared posts', () => {
    expect(moveIndex(4, 1, 5)).toBe(4);
    expect(moveIndex(0, -1, 5)).toBe(0);
  });

  it('enters from nothing selected at the near end', () => {
    expect(moveIndex(-1, 1, 5)).toBe(0);
    expect(moveIndex(-1, -1, 5)).toBe(4);
  });

  it('reports no selection for an empty list', () => {
    expect(moveIndex(0, 1, 0)).toBe(-1);
    expect(moveIndex(-1, 1, 0)).toBe(-1);
  });
});

describe('undoEntryFor', () => {
  it('restores the prior hidden value, not a hard-coded default', () => {
    const before = post('a', { hidden: true });
    const entry = undoEntryFor(before, { hidden: false });
    expect(entry).toEqual({
      postId: 'a',
      op: 'set_post_hidden',
      args: { postId: 'a', hidden: true },
      patch: { hidden: true },
      label: 'Back on the wall',
    });
  });

  it('restores the prior approval value', () => {
    const entry = undoEntryFor(post('b', { approved: false }), { approved: true });
    expect(entry?.op).toBe('set_post_approved');
    expect(entry?.args).toEqual({ postId: 'b', approved: false });
    expect(entry?.label).toBe('Approved');
  });

  it('offers nothing to undo when the value did not actually change', () => {
    expect(undoEntryFor(post('c', { hidden: false }), { hidden: false })).toBeNull();
    expect(undoEntryFor(post('c', { approved: true }), { approved: true })).toBeNull();
  });

  it('offers nothing for a change it cannot reverse (a delete carries no field)', () => {
    expect(undoEntryFor(post('d'), {})).toBeNull();
  });
});
