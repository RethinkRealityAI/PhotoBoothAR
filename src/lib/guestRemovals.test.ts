import { describe, expect, it, vi } from 'vitest';
import {
  RemovalQueue,
  UNDO_MS,
  outcomeMessage,
  parsePersisted,
  pendingLabel,
  type CommitResult,
  type QueueDeps,
  type RemovalItem,
} from './guestRemovals';

const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** A fake clock + timers we can step by hand. */
function harness(commit?: (eventId: string, item: RemovalItem) => Promise<CommitResult>) {
  let now = 1_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let tid = 0;
  const removed: { eventId: string; ids: string[] }[] = [];
  const persisted: Record<string, RemovalItem[]>[] = [];
  const commitFn = vi.fn(commit ?? (async () => ({ deleted: true, error: null })));
  const deps: QueueDeps = {
    commit: commitFn,
    onRemoved: (eventId, ids) => { removed.push({ eventId, ids }); },
    persist: (p) => { persisted.push(p); },
    now: () => now,
    setTimer: (fn, ms) => { tid += 1; timers.set(tid, { at: now + ms, fn }); return tid; },
    clearTimer: (h) => { timers.delete(h as number); },
  };
  const q = new RemovalQueue(deps);
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) { timers.delete(id); t.fn(); }
    }
    // let the commit promises settle
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { q, deps, commitFn, removed, persisted, advance, timers };
}

const wall = (id: string, token: string | null = TOKEN): RemovalItem => ({ id, origin: 'db', deleteToken: token });

describe('RemovalQueue', () => {
  it('hides immediately, deletes only after the undo window', async () => {
    const h = harness();
    h.q.schedule('ev', [wall('a'), wall('b')]);
    expect([...h.q.pendingIds('ev')].sort()).toEqual(['a', 'b']);
    expect(h.q.getSnapshot().batches[0]).toMatchObject({ count: 2, phase: 'waiting' });
    await h.advance(UNDO_MS - 1);
    expect(h.commitFn).not.toHaveBeenCalled();
    await h.advance(1);
    expect(h.commitFn).toHaveBeenCalledTimes(2);
    // still hidden after the delete: a stale wall list must not redraw them
    expect([...h.q.pendingIds('ev')].sort()).toEqual(['a', 'b']);
    expect(h.q.getSnapshot().batches).toEqual([]);
    expect(h.removed).toEqual([{ eventId: 'ev', ids: ['a', 'b'] }]);
    expect(h.q.getSnapshot().outcome).toMatchObject({ removed: ['a', 'b'], failed: [], wall: true });
  });

  it('undo inside the window sends nothing and restores the photos', async () => {
    const h = harness();
    const id = h.q.schedule('ev', [wall('a')])!;
    expect(h.q.undo(id)).toBe(true);
    expect(h.q.pendingIds('ev').size).toBe(0);
    await h.advance(UNDO_MS * 2);
    expect(h.commitFn).not.toHaveBeenCalled();
    expect(h.q.getSnapshot().outcome).toBeNull();
    // persisted list is empty again
    expect(h.persisted.at(-1)).toEqual({});
  });

  it('undo after commit started is refused', async () => {
    let release!: () => void;
    const h = harness(() => new Promise((r) => { release = () => r({ deleted: true, error: null }); }));
    const id = h.q.schedule('ev', [wall('a')])!;
    await h.advance(UNDO_MS);
    expect(h.q.getSnapshot().batches[0].phase).toBe('committing');
    expect(h.q.undo(id)).toBe(false);
    release();
    await h.advance(0);
    expect(h.q.getSnapshot().outcome?.removed).toEqual(['a']);
  });

  it('ignores ids already pending (double tap)', () => {
    const h = harness();
    h.q.schedule('ev', [wall('a')]);
    expect(h.q.schedule('ev', [wall('a')])).toBeNull();
    expect(h.q.schedule('ev', [wall('a'), wall('b')])).not.toBeNull();
    expect(h.q.getSnapshot().batches.map((b) => b.count)).toEqual([1, 1]);
  });

  it('never calls the server for a local-only capture or a tokenless post', async () => {
    const h = harness();
    h.q.schedule('ev', [{ id: 'loc', origin: 'local' }, wall('x', null)]);
    await h.advance(UNDO_MS);
    expect(h.commitFn).not.toHaveBeenCalled();
    const o = h.q.getSnapshot().outcome!;
    expect(o.removed).toEqual(['loc']);
    expect(o.failed).toEqual([{ id: 'x', error: 'not_yours' }]);
    expect(o.wall).toBe(false);
  });

  it('post_not_found counts as removed; a failure keeps the photo', async () => {
    const h = harness(async (_e, it) =>
      it.id === 'gone' ? { deleted: false, error: 'post_not_found' }
        : it.id === 'bad' ? { deleted: false, error: 'storage_failed' }
          : { deleted: true, error: null });
    h.q.schedule('ev', [wall('gone'), wall('bad'), wall('ok')]);
    await h.advance(UNDO_MS);
    const o = h.q.getSnapshot().outcome!;
    expect(o.removed).toEqual(['gone', 'ok']);
    expect(o.failed).toEqual([{ id: 'bad', error: 'storage_failed' }]);
    expect(h.removed[0].ids).toEqual(['gone', 'ok']);
    expect(h.q.pendingIds('ev').has('bad')).toBe(false); // back on screen
  });

  it('stops asking once the server rate-limits, and reports the rest', async () => {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      return calls >= 2 ? { deleted: false, error: 'rate_limited' } : { deleted: true, error: null };
    });
    h.q.schedule('ev', Array.from({ length: 10 }, (_, i) => wall(`p${i}`)));
    await h.advance(UNDO_MS);
    const o = h.q.getSnapshot().outcome!;
    expect(o.removed.length + o.failed.length).toBe(10);
    expect(calls).toBeLessThanOrEqual(4); // concurrency 3 + the first
    expect(o.failed.every((f) => f.error === 'rate_limited')).toBe(true);
  });

  it('a throwing commit is a failure, not a crash', async () => {
    const h = harness(async () => { throw new Error('offline'); });
    h.q.schedule('ev', [wall('a')]);
    await h.advance(UNDO_MS);
    expect(h.q.getSnapshot().outcome?.failed).toEqual([{ id: 'a', error: 'internal' }]);
  });

  it('flush commits waiting batches now', async () => {
    const h = harness();
    h.q.schedule('ev', [wall('a')]);
    await h.q.flush();
    expect(h.commitFn).toHaveBeenCalledTimes(1);
    expect(h.timers.size).toBe(0);
  });

  it('keeps events apart', () => {
    const h = harness();
    h.q.schedule('one', [wall('a')]);
    h.q.schedule('two', [wall('b')]);
    expect([...h.q.pendingIds('one')]).toEqual(['a']);
    expect(h.q.pendingItems()).toEqual({ one: [wall('a')], two: [wall('b')] });
  });
});

describe('outcomeMessage', () => {
  const base = { batchId: 'b', eventId: 'e', wall: true };
  it('names the wall only when a wall post went', () => {
    expect(outcomeMessage({ ...base, removed: ['a'], failed: [] })).toEqual({ text: 'Removed. It’s off the wall too.', tone: 'ok' });
    expect(outcomeMessage({ ...base, removed: ['a', 'b'], failed: [] }).text).toBe('Removed 2 photos. They’re off the wall too.');
    expect(outcomeMessage({ ...base, wall: false, removed: ['a'], failed: [] }).text).toBe('Removed.');
  });
  it('explains a partial failure', () => {
    const m = outcomeMessage({ ...base, removed: ['a'], failed: [{ id: 'b', error: 'rate_limited' }] });
    expect(m.tone).toBe('error');
    expect(m.text).toContain('Removed 1. 1 couldn’t be removed.');
    expect(m.text).toContain('little while');
    expect(outcomeMessage({ ...base, removed: [], failed: [{ id: 'b', error: 'not_yours' }] }).text).toContain('another phone');
  });
});

describe('pendingLabel / parsePersisted', () => {
  it('labels', () => {
    expect(pendingLabel(1)).toBe('Removed 1 photo');
    expect(pendingLabel(4)).toBe('Removed 4 photos');
  });
  it('drops junk, keeps valid items', () => {
    expect(parsePersisted(null)).toEqual({});
    expect(parsePersisted('{oops')).toEqual({});
    expect(parsePersisted('[]')).toEqual({});
    expect(parsePersisted(JSON.stringify({
      ev: [{ id: 'a', origin: 'db', deleteToken: TOKEN }, { id: 'b', origin: 'db', deleteToken: 'nope' }, { id: '', origin: 'db' }, { id: 'c', origin: 'x' }, 5],
      empty: [],
      bad: 'x',
    }))).toEqual({ ev: [{ id: 'a', origin: 'db', deleteToken: TOKEN }, { id: 'b', origin: 'db', deleteToken: null }] });
  });
});
