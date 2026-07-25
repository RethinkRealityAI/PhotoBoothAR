import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subscribeToPosts } from './db';
import type { Post } from '../types';

// db.ts creates the supabase client at module load (needs VITE_ env vars the
// vitest node env doesn't have) — mock it (same pattern as eventDesigner.test.ts)
// with a channel builder that records each postgres_changes handler by its
// event name so tests can fire synthetic realtime payloads.
const { rt } = vi.hoisted(() => ({
  rt: {
    handlers: new Map<string, (payload: unknown) => void>(),
    removed: [] as unknown[],
  },
}));
vi.mock('./supabase', () => {
  const channel = {
    on(_type: string, filter: { event: string }, cb: (payload: unknown) => void) {
      rt.handlers.set(filter.event, cb);
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return {
    supabase: {
      channel: () => channel,
      removeChannel: (c: unknown) => rt.removed.push(c),
    },
    POSTS_BUCKET: 'posts',
    ASSETS_BUCKET: 'assets',
    publicUrl: () => '',
  };
});

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

const fire = {
  insert: (p: Post) => rt.handlers.get('INSERT')!({ new: p }),
  update: (p: Post) => rt.handlers.get('UPDATE')!({ new: p }),
  delete: (id: string) => rt.handlers.get('DELETE')!({ old: { id } }),
};

function handlerSpies() {
  return { onInsert: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() };
}

beforeEach(() => {
  rt.handlers.clear();
  rt.removed.length = 0;
});

describe('subscribeToPosts (default — raw pass-through for moderation surfaces)', () => {
  it('delivers every INSERT and UPDATE, visible or not, exactly as before', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h);
    const unapproved = post('a', { approved: false });
    const hidden = post('b', { hidden: true });
    fire.insert(unapproved);
    fire.update(hidden);
    expect(h.onInsert).toHaveBeenCalledWith(unapproved);
    expect(h.onUpdate).toHaveBeenCalledWith(hidden);
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('delivers DELETE as the row id', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h);
    fire.delete('gone');
    expect(h.onDelete).toHaveBeenCalledWith('gone');
  });

  it('returns an unsubscribe that removes the channel', () => {
    const unsubscribe = subscribeToPosts('evt', handlerSpies());
    expect(rt.removed).toHaveLength(0);
    unsubscribe();
    expect(rt.removed).toHaveLength(1);
  });
});

describe('subscribeToPosts visibleOnly (guest walls)', () => {
  it('delivers an INSERT of a wall-visible post', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h, { visibleOnly: true });
    const visible = post('a');
    fire.insert(visible);
    expect(h.onInsert).toHaveBeenCalledWith(visible);
  });

  it('drops an INSERT of an unapproved post (pre-moderation never flashes it)', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h, { visibleOnly: true });
    fire.insert(post('a', { approved: false }));
    expect(h.onInsert).not.toHaveBeenCalled();
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('drops an INSERT of a hidden post', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h, { visibleOnly: true });
    fire.insert(post('a', { hidden: true }));
    expect(h.onInsert).not.toHaveBeenCalled();
  });

  it('turns an UPDATE that hides a post into onDelete (instant hide)', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h, { visibleOnly: true });
    fire.update(post('a', { hidden: true }));
    expect(h.onDelete).toHaveBeenCalledWith('a');
    expect(h.onUpdate).not.toHaveBeenCalled();
  });

  it('turns an UPDATE that unapproves a post into onDelete', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h, { visibleOnly: true });
    fire.update(post('a', { approved: false }));
    expect(h.onDelete).toHaveBeenCalledWith('a');
    expect(h.onUpdate).not.toHaveBeenCalled();
  });

  it('delivers an UPDATE that keeps the post visible', () => {
    const h = handlerSpies();
    subscribeToPosts('evt', h, { visibleOnly: true });
    const updated = post('a', { message: 'edited' });
    fire.update(updated);
    expect(h.onUpdate).toHaveBeenCalledWith(updated);
    expect(h.onDelete).not.toHaveBeenCalled();
  });
});
