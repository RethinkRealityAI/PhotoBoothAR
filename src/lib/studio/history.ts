/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generic undo/redo — a {past, present, future} wrapper around any pure reducer.
 * Kept free of studio specifics so vitest (node env) can exercise it in
 * isolation; the studio wires it up with predicates describing which of its
 * actions mutate the draft (recorded), which reset the timeline (clear), and
 * which continuous edits should coalesce into a single undo step.
 *
 *   - UNDO/REDO walk the timeline (bounded to `limit`, default 50).
 *   - `record(action)` → false: applied but NOT pushed onto the timeline
 *     (e.g. mode/view toggles, selection changes).
 *   - `clear(action)` → true: applied, then past + future are wiped (LOAD, save).
 *   - `coalesce(action, present)` → a non-null key merges consecutive edits that
 *     share that key into one entry (drag a slider = one undo, not fifty).
 */

export interface History<S> {
  past: S[];
  present: S;
  future: S[];
  /** @internal Coalescing key of the most recent recorded step (or null). */
  lastKey?: string | null;
}

export type HistoryAction = { type: 'UNDO' } | { type: 'REDO' };

export interface WithHistoryOptions<S, A extends { type: string }> {
  /** Max entries kept in `past` (older entries are dropped). Default 50. */
  limit?: number;
  /** True for actions that mutate the draft and belong on the timeline. Default: all. */
  record?: (action: A) => boolean;
  /** True for actions that reset the timeline after applying (LOAD, MARK_SAVED). */
  clear?: (action: A) => boolean;
  /** Non-null key merges consecutive same-key edits into one undo entry. */
  coalesce?: (action: A, present: S) => string | null;
}

export const DEFAULT_HISTORY_LIMIT = 50;

/** Seed a history from an initial present value. */
export function initHistory<S>(present: S): History<S> {
  return { past: [], present, future: [], lastKey: null };
}

export function canUndo<S>(h: History<S>): boolean {
  return h.past.length > 0;
}

export function canRedo<S>(h: History<S>): boolean {
  return h.future.length > 0;
}

function isHistoryAction(a: { type: string }): a is HistoryAction {
  return a.type === 'UNDO' || a.type === 'REDO';
}

/**
 * Wrap `reducer` so its state gains undo/redo. The returned reducer accepts the
 * base action type `A` plus the `UNDO`/`REDO` control actions.
 */
export function withHistory<S, A extends { type: string }>(
  reducer: (state: S, action: A) => S,
  opts: WithHistoryOptions<S, A> = {},
): (state: History<S>, action: A | HistoryAction) => History<S> {
  const limit = opts.limit ?? DEFAULT_HISTORY_LIMIT;
  const record = opts.record ?? (() => true);
  const clear = opts.clear ?? (() => false);
  const coalesce = opts.coalesce ?? (() => null);

  return function historyReducer(state, action) {
    if (isHistoryAction(action)) {
      if (action.type === 'UNDO') {
        if (!state.past.length) return state;
        const previous = state.past[state.past.length - 1];
        return {
          past: state.past.slice(0, -1),
          present: previous,
          future: [state.present, ...state.future],
          lastKey: null,
        };
      }
      // REDO
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        lastKey: null,
      };
    }

    const a = action as A;
    const nextPresent = reducer(state.present, a);

    // Timeline-resetting actions (LOAD, MARK_SAVED): apply, then drop history.
    if (clear(a)) {
      return { past: [], present: nextPresent, future: [], lastKey: null };
    }

    // Non-recorded actions (mode/view toggles, selection): apply, no timeline entry.
    if (!record(a)) {
      if (nextPresent === state.present) return state;
      return { ...state, present: nextPresent };
    }

    // No-op recorded action (reducer returned the same state) — nothing to record.
    if (nextPresent === state.present) return state;

    const key = coalesce(a, state.present);
    if (key !== null && key === state.lastKey) {
      // Merge into the current entry: replace present, keep past, clear redo.
      return { past: state.past, present: nextPresent, future: [], lastKey: key };
    }

    const past = [...state.past, state.present];
    const trimmed = past.length > limit ? past.slice(past.length - limit) : past;
    return { past: trimmed, present: nextPresent, future: [], lastKey: key };
  };
}
