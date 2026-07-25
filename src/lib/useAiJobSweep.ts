/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mount-time recovery for AI jobs nobody is watching any more.
 *
 * Meshy jobs only advance when something polls them, and every poller in the
 * product is an in-flight UI loop. This sweeps the org's abandoned ones whenever
 * a host enters the platform, so a 3D model they paid for and walked away from
 * still lands in their Library. See src/lib/aiJobs.ts for why the selection
 * rules are what they are.
 *
 * Deliberately invisible. It runs in the background of a screen the host opened
 * for another reason, and interrupting them to announce a job they had already
 * given up on would be worse than the asset just being there. `onResolved` is
 * for callers that show a list which should refresh in place.
 */
import { useEffect, useRef } from 'react';
import { sweepAiJobs } from './aiJobs';
import type { AiJob } from './ai';

/** Gap between sweeps while anything is still unresolved. Long on purpose: this
 *  is recovery, not a live progress loop, and the jobs it touches are already
 *  minutes old. */
export const SWEEP_INTERVAL_MS = 60_000;

export function useAiJobSweep(orgId: string | null, onResolved?: (jobs: AiJob[]) => void): void {
  // Held in a ref so a caller passing an inline closure doesn't restart the
  // sweep on every render.
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Chained timeout rather than setInterval: a sweep that takes longer than
    // the interval must not overlap the next one and double-poll every job.
    const run = async () => {
      const res = await sweepAiJobs(orgId, Date.now());
      if (!alive) return;
      if (res.resolved.length > 0) onResolvedRef.current?.(res.resolved);
      if (res.pending) timer = setTimeout(run, SWEEP_INTERVAL_MS);
    };
    void run();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [orgId]);
}
