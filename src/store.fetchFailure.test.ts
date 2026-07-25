import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from './store';
import * as db from './lib/db';
import type { Post } from './types';

// The store's data layer creates the supabase client at module load, which
// needs VITE_ env vars the vitest node env doesn't have — mock it (same pattern
// as store.test.ts). ./lib/db itself is mocked so the fetch results are ours.
vi.mock('./lib/supabase', () => ({
  supabase: {},
  POSTS_BUCKET: 'posts',
  ASSETS_BUCKET: 'assets',
  publicUrl: () => '',
}));

vi.mock('./lib/db', () => ({
  fetchPostsResult: vi.fn(),
  fetchChallengesResult: vi.fn(),
  subscribeToBranding: vi.fn(),
}));

const post = (id: string): Post => ({
  id,
  created_at: '2026-07-25T00:00:00Z',
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
});

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    posts: [],
    postsLoaded: false,
    postsFailed: false,
    challenges: [],
    challengesLoaded: false,
    challengesFailed: false,
  });
});

describe('fetchPosts failure handling', () => {
  it('flags the failure instead of reporting an empty wall', async () => {
    // The regression this guards: a failed read used to land as posts: [] with
    // no failure flag, so the wall rendered "be the first to capture a moment"
    // to a room full of people who had already posted.
    vi.mocked(db.fetchPostsResult).mockResolvedValue({ rows: [], failed: true });

    await useStore.getState().fetchPosts();

    expect(useStore.getState().postsFailed).toBe(true);
    expect(useStore.getState().postsLoaded).toBe(true);
  });

  it('keeps the posts it already had when a later refresh fails', async () => {
    useStore.setState({ posts: [post('a'), post('b')], postsLoaded: true });
    vi.mocked(db.fetchPostsResult).mockResolvedValue({ rows: [], failed: true });

    await useStore.getState().fetchPosts();

    // Dropping a populated wall to empty because one poll failed is the same
    // lie in slower motion.
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['a', 'b']);
    expect(useStore.getState().postsFailed).toBe(true);
  });

  it('clears the failure flag once a fetch succeeds again', async () => {
    useStore.setState({ postsFailed: true });
    vi.mocked(db.fetchPostsResult).mockResolvedValue({ rows: [post('a')], failed: false });

    await useStore.getState().fetchPosts();

    expect(useStore.getState().postsFailed).toBe(false);
    expect(useStore.getState().posts.map((p) => p.id)).toEqual(['a']);
  });

  it('reports a genuinely empty wall as empty, not as failed', async () => {
    vi.mocked(db.fetchPostsResult).mockResolvedValue({ rows: [], failed: false });

    await useStore.getState().fetchPosts();

    expect(useStore.getState().postsFailed).toBe(false);
    expect(useStore.getState().postsLoaded).toBe(true);
    expect(useStore.getState().posts).toEqual([]);
  });
});

describe('fetchChallenges failure handling', () => {
  it('flags the failure instead of claiming the host added no challenges', async () => {
    vi.mocked(db.fetchChallengesResult).mockResolvedValue({ rows: [], failed: true });

    await useStore.getState().fetchChallenges();

    expect(useStore.getState().challengesFailed).toBe(true);
    expect(useStore.getState().challengesLoaded).toBe(true);
  });

  it('reports a genuinely challenge-free event as empty', async () => {
    vi.mocked(db.fetchChallengesResult).mockResolvedValue({ rows: [], failed: false });

    await useStore.getState().fetchChallenges();

    expect(useStore.getState().challengesFailed).toBe(false);
    expect(useStore.getState().challengesLoaded).toBe(true);
  });
});
