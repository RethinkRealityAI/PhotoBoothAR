/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * guestRemovals: a guest taking their own photos down, one or many at a time,
 * with a few seconds to change their mind.
 *
 * WHY A QUEUE AND NOT A CALL. The server delete (`submit-post` `delete_post`)
 * removes the storage object and the row, and nothing brings either back. An
 * "Undo" therefore cannot be a second request; it has to be the first request
 * never being sent. So a removal is SCHEDULED: the photos leave the guest's
 * screens straight away (every surface reads `pendingIds`), and the real deletes
 * go out when the undo window closes. Undo inside the window simply cancels.
 *
 * OWNERSHIP is not decided here. Each wall post carries this device's delete
 * token (post_secrets, migration 035 — see postDelete.ts), and the server checks
 * it. This module only refuses to send a request it already knows will be
 * refused (no token), and reports what the server said.
 *
 * PURE ON PURPOSE: no Supabase, no React, no localStorage. The network call,
 * the local-gallery erase, the timers and persistence are injected, so the whole
 * lifecycle is tested in node (guestRemovals.test.ts). guestRemovalsStore.ts
 * wires the real ones.
 */
import { isDeleteToken } from './postDelete';

/** How long a removal can be undone. Long enough to read "Removed · Undo" and
 *  reach for it; short enough that the photo is really gone before the guest
 *  puts their phone away. */
export const UNDO_MS = 6000;

/** Deletes in flight at once. Enough that 20 photos clear in a few seconds,
 *  few enough not to look like a loop to the server's rate guard. */
export const COMMIT_CONCURRENCY = 3;

export interface RemovalItem {
  id: string;
  /** 'db' = on the wall; 'local' = only ever on this device. */
  origin: 'db' | 'local';
  deleteToken?: string | null;
}

/** What the injected commit answers — the shape `deleteMyPost` already returns. */
export interface CommitResult {
  deleted: boolean;
  error: string | null;
}

export interface RemovalOutcome {
  batchId: string;
  eventId: string;
  removed: string[];
  failed: { id: string; error: string }[];
  /** At least one removed item had been on the wall (not only on this device). */
  wall: boolean;
}

export interface BatchView {
  batchId: string;
  eventId: string;
  count: number;
  /** 'waiting' = Undo still possible; 'committing' = the deletes are going out. */
  phase: 'waiting' | 'committing';
  /** Epoch ms when the undo window closes (waiting only). */
  deadline: number;
}

export interface RemovalSnapshot {
  batches: readonly BatchView[];
  /** The most recent finished batch, for the outcome line. Cleared by `dismissOutcome`. */
  outcome: RemovalOutcome | null;
}

export interface QueueDeps {
  commit(eventId: string, item: RemovalItem): Promise<CommitResult>;
  /** Erase the removed ids from this device's gallery. */
  onRemoved(eventId: string, ids: string[]): void;
  /** Called whenever the set of not-yet-committed items changes, so a crash or
   *  a closed tab mid-window can be replayed on the next visit. */
  persist?(pending: Record<string, RemovalItem[]>): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

interface Batch {
  view: BatchView;
  items: RemovalItem[];
  timer: unknown;
}

let seq = 0;

export class RemovalQueue {
  private batches = new Map<string, Batch>();
  /** Ids already deleted this visit. Still hidden: a wall whose realtime
   *  socket dropped would otherwise draw them again from its stale list. */
  private gone = new Map<string, Set<string>>();
  private snapshot: RemovalSnapshot = { batches: [], outcome: null };
  private listeners = new Set<() => void>();

  constructor(private deps: QueueDeps) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): RemovalSnapshot => this.snapshot;

  /** Every id this guest has taken down for this event: waiting, committing,
   *  or already deleted this visit. Every gallery view hides these. */
  pendingIds(eventId: string): Set<string> {
    const ids = new Set<string>(this.gone.get(eventId));
    for (const b of this.batches.values()) {
      if (b.view.eventId !== eventId) continue;
      for (const it of b.items) ids.add(it.id);
    }
    return ids;
  }

  /**
   * Take these items off the guest's screens and delete them after `delayMs`.
   * Items already pending are ignored (a double tap must not send twice).
   * Returns the batch id, or null when nothing new was scheduled.
   */
  schedule(eventId: string, items: readonly RemovalItem[], delayMs: number = UNDO_MS): string | null {
    const already = this.pendingIds(eventId);
    const fresh: RemovalItem[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      if (already.has(it.id) || seen.has(it.id)) continue;
      seen.add(it.id);
      fresh.push({ id: it.id, origin: it.origin, deleteToken: it.deleteToken ?? null });
    }
    if (fresh.length === 0) return null;
    seq += 1;
    const batchId = `rm${seq}-${this.deps.now()}`;
    const batch: Batch = {
      view: {
        batchId,
        eventId,
        count: fresh.length,
        phase: 'waiting',
        deadline: this.deps.now() + Math.max(0, delayMs),
      },
      items: fresh,
      timer: null,
    };
    this.batches.set(batchId, batch);
    batch.timer = this.deps.setTimer(() => { void this.commitBatch(batchId); }, Math.max(0, delayMs));
    this.changed(true);
    return batchId;
  }

  /** Cancel a batch that has not started committing. True when it was undone. */
  undo(batchId: string): boolean {
    const b = this.batches.get(batchId);
    if (!b || b.view.phase !== 'waiting') return false;
    this.deps.clearTimer(b.timer);
    this.batches.delete(batchId);
    this.changed(true);
    return true;
  }

  /** Commit every waiting batch now (the page is going away). */
  async flush(): Promise<void> {
    const waiting = [...this.batches.values()].filter((b) => b.view.phase === 'waiting');
    await Promise.all(waiting.map((b) => {
      this.deps.clearTimer(b.timer);
      return this.commitBatch(b.view.batchId);
    }));
  }

  /** Items not yet committed, by event — what `persist` stores. */
  pendingItems(): Record<string, RemovalItem[]> {
    const out: Record<string, RemovalItem[]> = {};
    for (const b of this.batches.values()) {
      (out[b.view.eventId] ??= []).push(...b.items);
    }
    return out;
  }

  dismissOutcome(): void {
    if (this.snapshot.outcome === null) return;
    this.snapshot = { ...this.snapshot, outcome: null };
    this.emit();
  }

  private async commitBatch(batchId: string): Promise<void> {
    const b = this.batches.get(batchId);
    if (!b || b.view.phase !== 'waiting') return;
    b.view = { ...b.view, phase: 'committing' };
    this.changed(false);

    const { eventId } = b.view;
    const removed: string[] = [];
    const failed: { id: string; error: string }[] = [];
    let stopped = false;
    let next = 0;

    const worker = async () => {
      while (next < b.items.length) {
        const item = b.items[next++];
        if (stopped) {
          failed.push({ id: item.id, error: 'rate_limited' });
          continue;
        }
        const res = await this.commitOne(eventId, item);
        // 'post_not_found' is the goal already met (another tab, a replay after
        // the page closed mid-request): it counts as removed.
        if (res.deleted || res.error === 'post_not_found') {
          removed.push(item.id);
        } else {
          failed.push({ id: item.id, error: res.error ?? 'internal' });
          // The server's hourly guard has spoken; every further call would get
          // the same answer, so stop asking and report the rest honestly.
          if (res.error === 'rate_limited') stopped = true;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(COMMIT_CONCURRENCY, b.items.length) }, () => worker()),
    );

    if (removed.length > 0) {
      const g = this.gone.get(eventId) ?? new Set<string>();
      for (const id of removed) g.add(id);
      this.gone.set(eventId, g);
      try {
        this.deps.onRemoved(eventId, removed);
      } catch {
        /* a local-gallery erase failing must not hide the server outcome */
      }
    }
    this.batches.delete(batchId);
    // Keep the caller's order in the outcome, not completion order.
    const order = new Map(b.items.map((it, i) => [it.id, i]));
    removed.sort((x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0));
    failed.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
    this.snapshot = { batches: this.views(), outcome: {
      batchId,
      eventId,
      removed,
      failed,
      wall: b.items.some((it) => it.origin === 'db' && removed.includes(it.id)),
    } };
    this.persistNow();
    this.emit();
  }

  private async commitOne(eventId: string, item: RemovalItem): Promise<CommitResult> {
    if (item.origin === 'local') return { deleted: true, error: null };
    // No token = this device holds no proof; the server would say the same.
    if (!isDeleteToken(item.deleteToken)) return { deleted: false, error: 'not_yours' };
    try {
      return await this.deps.commit(eventId, item);
    } catch {
      return { deleted: false, error: 'internal' };
    }
  }

  private views(): BatchView[] {
    return [...this.batches.values()].map((b) => b.view);
  }

  private changed(persist: boolean): void {
    this.snapshot = { ...this.snapshot, batches: this.views() };
    if (persist) this.persistNow();
    this.emit();
  }

  private persistNow(): void {
    try {
      this.deps.persist?.(this.pendingItems());
    } catch {
      /* storage unavailable: the in-memory queue still works */
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** The one line a guest reads after a batch finishes. */
export function outcomeMessage(o: RemovalOutcome): { text: string; tone: 'ok' | 'error' } {
  const n = o.removed.length;
  const f = o.failed.length;
  const noun = (k: number) => (k === 1 ? 'photo' : 'photos');
  if (f === 0) {
    const where = o.wall ? (n === 1 ? ' It’s off the wall too.' : ' They’re off the wall too.') : '';
    return { text: `${n === 1 ? 'Removed' : `Removed ${n} ${noun(n)}`}.${where}`, tone: 'ok' };
  }
  const errors = new Set(o.failed.map((x) => x.error));
  const why = errors.has('rate_limited')
    ? 'That’s a lot at once. Try the rest again in a little while.'
    : errors.has('not_yours')
      ? 'They were posted from another phone, so remove them from that one.'
      : errors.has('storage_failed')
        ? 'We couldn’t remove the files, so they’re still up. Try again in a moment.'
        : 'Check your connection and try again.';
  const lead = n > 0
    ? `Removed ${n}. ${f} couldn’t be removed.`
    : f === 1 ? 'Couldn’t remove that one.' : `Couldn’t remove ${f} ${noun(f)}.`;
  return { text: `${lead} ${why}`, tone: 'error' };
}

/** Undo-bar label while a batch waits. */
export function pendingLabel(count: number): string {
  return count === 1 ? 'Removed 1 photo' : `Removed ${count} photos`;
}

/**
 * Parse what `persist` stored. Anything malformed is dropped, never thrown:
 * this runs on page load with whatever an older build (or a person) left there.
 */
export function parsePersisted(raw: string | null): Record<string, RemovalItem[]> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const out: Record<string, RemovalItem[]> = {};
  for (const [eventId, list] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const items: RemovalItem[] = [];
    for (const v of list) {
      if (typeof v !== 'object' || v === null) continue;
      const r = v as Record<string, unknown>;
      if (typeof r.id !== 'string' || r.id === '') continue;
      if (r.origin !== 'db' && r.origin !== 'local') continue;
      items.push({ id: r.id, origin: r.origin, deleteToken: isDeleteToken(r.deleteToken) ? r.deleteToken : null });
    }
    if (items.length > 0) out[eventId] = items;
  }
  return out;
}
