/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reconciling AI jobs nobody is watching any more.
 *
 * Meshy 3D generation is asynchronous, and `ai-job-status` only advances a job
 * when something POLLS it: it is the poll that starts the refine pass, downloads
 * the GLB, creates the experience, or refunds a failure. But every poller in the
 * product is an in-flight UI loop (AiGeneratePanel, DirectorPanel, CopilotChat).
 * Close the tab, navigate away, or let the loop time out, and the job is finished
 * at the provider and frozen at `running` here — forever. The host paid ~11
 * credits, the model exists at Meshy, and it never reaches their Library. Meshy
 * deletes it after three days.
 *
 * So: on entering the host area, sweep the org's running jobs and poll each one
 * once. That is enough — a single poll performs whatever transition is due, and
 * the sweep repeats while any job is still unresolved.
 *
 * The selection rules are pure and tested, because the failure modes are all
 * about WHICH jobs to touch: poll one a live UI loop is already driving and the
 * two race for the same transition (the edge function's conditional claims make
 * that safe but wasteful); poll one that has been stuck for a week and we burn
 * requests on something Meshy has long since deleted.
 */
import { supabase } from './supabase';
import { pollJob, type AiJob } from './ai';

/**
 * Don't touch a job younger than this.
 *
 * The obvious rule — "skip anything updated recently, an active loop is on it" —
 * DOES NOT WORK, and it took reading `ai-job-status` to see why: while a Meshy
 * task is still PENDING/IN_PROGRESS the function returns progress and writes
 * nothing, so `updated_at` stays at the row's creation time no matter how hard a
 * UI loop is polling. A job being actively watched therefore looks stale.
 *
 * So the signal is AGE instead: this is just over the longest UI poll budget
 * (AiGeneratePanel's ~10 minutes, MAX_POLLS × POLL_MS). Past it, no live loop
 * can still be responsible. Recovery waiting eleven minutes costs nothing — the
 * host has already left — whereas racing a live loop into the refine hand-off
 * would pay Meshy for a duplicate task.
 */
export const MIN_AGE_MS = 11 * 60 * 1000;

/**
 * Additionally leave a job alone this long after a real state CHANGE. Unlike a
 * plain progress poll, the transitions that do write (the preview → refine
 * hand-off) bump `updated_at`, and a job that just moved deserves a moment
 * before anyone leans on it again.
 */
export const FRESH_MS = 30_000;

/**
 * Past this age, stop trying. Meshy keeps generated assets for three days, and a
 * job still `running` after a day is not going to resolve into anything useful —
 * polling it forever would be a request leak on every page load. These jobs stay
 * visible in the ledger as spent; recovering them is a support action, not
 * something a client sweep should keep hammering.
 */
export const ABANDON_MS = 24 * 60 * 60 * 1000;

/** Most jobs to poll in one sweep — a burst of requests on page load is worse
 *  than resolving the rest a few seconds later. */
export const MAX_PER_SWEEP = 5;

/** The subset of an ai_jobs row this module needs. */
export interface ReconcilableJob {
  id: string;
  status: string;
  provider: string;
  updated_at: string;
  created_at: string;
}

/**
 * Which of these jobs this client should poll right now, oldest first.
 *
 * Only `running` Meshy jobs qualify: image jobs are synchronous (they are
 * already final by the time they are stored) and any other status is terminal.
 */
export function jobsToReconcile<T extends ReconcilableJob>(
  jobs: T[],
  nowMs: number,
  opts: { minAgeMs?: number; freshMs?: number; abandonMs?: number; max?: number } = {},
): T[] {
  const minAgeMs = opts.minAgeMs ?? MIN_AGE_MS;
  const freshMs = opts.freshMs ?? FRESH_MS;
  const abandonMs = opts.abandonMs ?? ABANDON_MS;
  const max = opts.max ?? MAX_PER_SWEEP;
  return jobs
    .filter((j) => {
      if (j.status !== 'running') return false;
      if (j.provider !== 'meshy') return false;
      const updated = Date.parse(j.updated_at);
      const created = Date.parse(j.created_at);
      // An unparseable timestamp must not be treated as "0ms ago" (which would
      // make it look abandoned) nor as "just now" (which would hide it forever).
      if (!Number.isFinite(updated) || !Number.isFinite(created)) return false;
      const age = nowMs - created;
      if (age < minAgeMs) return false;              // a live UI loop may still own it
      if (age > abandonMs) return false;             // too old to be worth it
      if (nowMs - updated < freshMs) return false;   // it just transitioned
      return true;
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .slice(0, max);
}

/** Every ai_jobs row for an org that is still `running`. RLS already limits
 *  reads to org members (ai_jobs_member_read), so this is safe from the client.
 *  Returns [] on failure — a sweep is best-effort and must never break a page. */
export async function fetchRunningAiJobs(orgId: string): Promise<ReconcilableJob[]> {
  try {
    const { data, error } = await supabase
      .from('ai_jobs')
      .select('id, status, provider, updated_at, created_at')
      .eq('org_id', orgId)
      .eq('status', 'running')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) {
      console.warn('[aiJobs] fetchRunningAiJobs', error);
      return [];
    }
    return (data ?? []) as ReconcilableJob[];
  } catch (e) {
    console.warn('[aiJobs] fetchRunningAiJobs', e);
    return [];
  }
}

export interface SweepResult {
  /** Jobs polled this sweep. */
  polled: number;
  /** Jobs that reached a terminal state because of this sweep. */
  resolved: AiJob[];
  /** True while at least one job is still running — sweep again later. */
  pending: boolean;
}

/**
 * Poll every job this client should be responsible for, once.
 *
 * One poll per job per sweep is deliberate: `ai-job-status` performs exactly one
 * transition per call (preview → refine, or → materialised, or → refunded), and
 * hammering it would just multiply provider requests. `pending` tells the caller
 * whether to come back.
 */
export async function sweepAiJobs(orgId: string, nowMs: number): Promise<SweepResult> {
  const running = await fetchRunningAiJobs(orgId);
  const due = jobsToReconcile(running, nowMs);
  const resolved: AiJob[] = [];
  for (const job of due) {
    const { data } = await pollJob(job.id);
    const updated = data?.job;
    if (updated && updated.status !== 'running' && updated.status !== 'queued') {
      resolved.push(updated);
    }
  }
  // Anything still running — including jobs we skipped as too fresh — means
  // there is more to do. Jobs past ABANDON_MS are excluded so a permanently
  // stuck row can't keep a sweep timer alive for the whole session.
  const stillOpen = running.some(
    (j) => j.status === 'running'
      && !resolved.some((r) => r.id === j.id)
      && Number.isFinite(Date.parse(j.created_at))
      && nowMs - Date.parse(j.created_at) <= ABANDON_MS,
  );
  return { polled: due.length, resolved, pending: stillOpen };
}
