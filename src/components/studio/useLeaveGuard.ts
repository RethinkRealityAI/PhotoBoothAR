/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLeaveGuard — stops a dirty studio scene from disappearing without a word.
 *
 * Before this, `state.dirty` guarded exactly ONE control (the in-app back
 * arrow). A refresh, a tab close, or the browser Back button destroyed the scene
 * silently — including 3D pieces the host had just paid credits for.
 *
 * WHY NOT `useBlocker`: react-router 7's useBlocker calls useDataRouterContext
 * and throws outside a data router (react-router/dist/.../chunk-6CSD65Y2.mjs
 * :6402-6404). This app mounts a plain <BrowserRouter> (src/App.tsx:17), so
 * useBlocker — and unstable_usePrompt, which is built on it — would crash the
 * studio on mount. Converting the whole app to createBrowserRouter is not this
 * component's call, so the guard is assembled from primitives that work under
 * BrowserRouter:
 *
 *   1. `beforeunload` — refresh, tab close, and navigation off the SPA. The
 *      browser shows its own generic dialog; that is all any site can do.
 *   2. a POPSTATE TRAP — browser Back/Forward inside the SPA, which fires no
 *      beforeunload. While dirty we hold one sentinel history entry; a Back
 *      press consumes it, we immediately restore it (so the host stays put) and
 *      raise the same confirm the back arrow raises.
 *
 * Autosave (draftSafety) sits underneath both, so even a guard that is bypassed
 * costs the host a click, not their scene.
 */
import { useEffect, useRef } from 'react';

/** Marks the history entry this guard pushed, so we only ever consume our own. */
const GUARD_FLAG = '__bwStudioLeaveGuard';

export interface LeaveGuardOptions {
  /** Guard only while there is unsaved work. */
  dirty: boolean;
  /** Raised when the host tries to leave via Back/Forward. Show your confirm. */
  onAttemptLeave: () => void;
  /**
   * Set true the moment the host CONFIRMS leaving, so the guard stands down and
   * the navigation it is about to perform is not itself intercepted.
   */
  bypass?: boolean;
}

/**
 * Whether a popstate event should be treated as an attempt to leave. Pure so the
 * decision is inspectable: we only intercept while dirty and not bypassing, and
 * only once per pop (the caller re-arms).
 */
export function shouldInterceptPop(opts: { dirty: boolean; bypass: boolean; armed: boolean }): boolean {
  return opts.dirty && !opts.bypass && opts.armed;
}

export function useLeaveGuard({ dirty, onAttemptLeave, bypass = false }: LeaveGuardOptions): void {
  // Latest callback without re-arming the listeners every render.
  const onAttemptRef = useRef(onAttemptLeave);
  onAttemptRef.current = onAttemptLeave;
  const bypassRef = useRef(bypass);
  bypassRef.current = bypass;

  /* 1. Refresh / tab close / leaving the SPA entirely. */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassRef.current) return;
      // Both forms are required across browsers; the message itself is ignored
      // by every modern one, which shows its own wording.
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /* 2. In-SPA Back / Forward. */
  useEffect(() => {
    if (!dirty) return;
    if (typeof window === 'undefined' || !window.history) return;

    let armed = true;
    // Hold ONE sentinel at the current URL. Back consumes it instead of leaving.
    const push = () => {
      try {
        window.history.pushState({ ...(window.history.state ?? {}), [GUARD_FLAG]: true }, '');
      } catch {
        // Some embedded/sandboxed contexts refuse pushState. beforeunload and
        // the autosave still cover the host; a missing sentinel is not fatal.
        armed = false;
      }
    };
    push();

    const onPop = () => {
      if (!shouldInterceptPop({ dirty: true, bypass: bypassRef.current, armed })) return;
      // Our sentinel was just popped: put it back so the host stays on the
      // editor, then ask. Without the re-push a second Back would leave.
      push();
      onAttemptRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      armed = false;
      window.removeEventListener('popstate', onPop);
      // Deliberately NOT calling history.back() here: it is asynchronous and,
      // racing an in-flight route change, would send the host somewhere they
      // did not ask to go. The sentinel points at the URL we are already on, so
      // leaving it costs at most one extra Back press — a far better failure
      // than an unexplained navigation.
    };
  }, [dirty]);
}
