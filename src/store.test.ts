import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from './store';
import type { Post } from './types';

// The store's data layer (./lib/db) creates the supabase client at module
// load, which needs VITE_ env vars the vitest node env doesn't have — mock it
// (same pattern as eventDesigner.test.ts). The actions under test here
// (prependPost / updatePost / removePost) never touch the network.
vi.mock('./lib/supabase', () => ({
  supabase: {},
  POSTS_BUCKET: 'posts',
  ASSETS_BUCKET: 'assets',
  publicUrl: () => '',
}));

function post(id: string, over: Partial<Post> = {}): Post {
  return {
    id,
    created_at: '2026-07-21T00:00:00Z',
    image_url: `https://cdn.example/${id}.jpg`,
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

beforeEach(() => {
  useStore.setState({ posts: [], postsLoaded: false });
});

describe('prependPost (wall visibility guard)', () => {
  it('prepends a wall-visible (approved, not hidden) post', () => {
    useStore.setState({ posts: [post('a')] });
    useStore.getState().prependPost(post('b'));
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('drops an unapproved post (pre-moderation must never flash it)', () => {
    useStore.getState().prependPost(post('a', { approved: false }));
    expect(useStore.getState().posts).toEqual([]);
  });

  it('drops a hidden post', () => {
    useStore.getState().prependPost(post('a', { hidden: true }));
    expect(useStore.getState().posts).toEqual([]);
  });

  it('dedupes by id — a post already on the wall is not added again', () => {
    const original = post('a', { message: 'first' });
    useStore.setState({ posts: [original] });
    useStore.getState().prependPost(post('a', { message: 'second' }));
    const posts = useStore.getState().posts;
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe(original); // untouched, not replaced
  });
});

describe('updatePost (wall visibility guard)', () => {
  it('removes a post that was hidden', () => {
    useStore.setState({ posts: [post('a'), post('b')] });
    useStore.getState().updatePost(post('a', { hidden: true }));
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['b']);
  });

  it('removes a post that was unapproved', () => {
    useStore.setState({ posts: [post('a'), post('b')] });
    useStore.getState().updatePost(post('b', { approved: false }));
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['a']);
  });

  it('is a no-op when a non-visible post is not on the wall', () => {
    useStore.setState({ posts: [post('a')] });
    useStore.getState().updatePost(post('zz', { hidden: true }));
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['a']);
  });

  it('prepends a newly-approved post that is not on the wall yet', () => {
    useStore.setState({ posts: [post('a')] });
    useStore.getState().updatePost(post('b'));
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('replaces a visible post in place, preserving its position', () => {
    useStore.setState({ posts: [post('a'), post('b'), post('c')] });
    const updated = post('b', { message: 'edited' });
    useStore.getState().updatePost(updated);
    const posts = useStore.getState().posts;
    expect(posts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(posts[1].message).toBe('edited');
  });
});

describe('removePost', () => {
  it('removes by id and leaves the rest', () => {
    useStore.setState({ posts: [post('a'), post('b')] });
    useStore.getState().removePost('a');
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['b']);
  });
});
