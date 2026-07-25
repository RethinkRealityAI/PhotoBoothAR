import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ABANDON_MS, FRESH_MS, MIN_AGE_MS, jobsToReconcile, type ReconcilableJob } from './aiJobs';

// aiJobs.ts reaches supabase at module load (same pattern as ai.test.ts).
const { fromMock, pollMock } = vi.hoisted(() => ({ fromMock: vi.fn(), pollMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: fromMock, functions: { invoke: vi.fn() } } }));
vi.mock('./ai', () => ({ pollJob: pollMock }));

const NOW = Date.parse('2026-07-25T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function job(over: Partial<ReconcilableJob> = {}): ReconcilableJob {
  return {
    id: 'j1',
    status: 'running',
    provider: 'meshy',
    created_at: ago(20 * 60 * 1000),
    updated_at: ago(20 * 60 * 1000),
    ...over,
  };
}

describe('jobsToReconcile', () => {
  it('takes an abandoned running Meshy job', () => {
    expect(jobsToReconcile([job()], NOW)).toHaveLength(1);
  });

  it('leaves a job young enough that a live UI loop may still own it', () => {
    // NOT gated on updated_at: ai-job-status writes nothing while a Meshy task
    // is PENDING/IN_PROGRESS, so a job under active polling has an updated_at
    // frozen at creation and would look stale. Age is the only honest signal.
    const young = job({ created_at: ago(MIN_AGE_MS - 60_000), updated_at: ago(MIN_AGE_MS - 60_000) });
    expect(jobsToReconcile([young], NOW)).toEqual([]);
  });

  it('leaves a job that just transitioned, even when it is old enough', () => {
    // The preview → refine hand-off DOES bump updated_at; give it a moment.
    expect(jobsToReconcile([job({ updated_at: ago(FRESH_MS - 1000) })], NOW)).toEqual([]);
  });

  it('gives up on a job too old to still be recoverable', () => {
    // Meshy deletes generated assets after three days; a day-old running job is
    // never going to resolve into anything, and polling it on every page load
    // would leak requests for the rest of the session.
    expect(jobsToReconcile([job({ created_at: ago(ABANDON_MS + 1000) })], NOW)).toEqual([]);
  });

  it('ignores terminal statuses', () => {
    for (const status of ['succeeded', 'failed', 'refunded', 'queued']) {
      expect(jobsToReconcile([job({ status })], NOW)).toEqual([]);
    }
  });

  it('ignores synchronous image jobs, which are already final when stored', () => {
    expect(jobsToReconcile([job({ provider: 'gemini' })], NOW)).toEqual([]);
    expect(jobsToReconcile([job({ provider: 'higgsfield' })], NOW)).toEqual([]);
  });

  it('skips a row with an unparseable timestamp rather than guessing', () => {
    // Treating NaN as "0ms ago" would make it look abandoned; treating it as
    // "just now" would hide it forever. Neither is a decision to make silently.
    expect(jobsToReconcile([job({ updated_at: 'not a date' })], NOW)).toEqual([]);
    expect(jobsToReconcile([job({ created_at: '' })], NOW)).toEqual([]);
  });

  it('polls the oldest first and caps the burst', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      job({ id: `j${i}`, created_at: ago((i + 12) * 60 * 1000), updated_at: ago(12 * 60 * 1000) }));
    const due = jobsToReconcile(many, NOW, { max: 3 });
    expect(due).toHaveLength(3);
    // Oldest created_at first: the highest i is the furthest in the past.
    expect(due.map((j) => j.id)).toEqual(['j8', 'j7', 'j6']);
  });

  it('respects overridden thresholds', () => {
    expect(jobsToReconcile([job({ updated_at: ago(1000) })], NOW, { freshMs: 500 })).toHaveLength(1);
    const young = job({ created_at: ago(60_000), updated_at: ago(60_000) });
    expect(jobsToReconcile([young], NOW, { minAgeMs: 1000 })).toHaveLength(1);
  });
});

describe('sweepAiJobs', () => {
  beforeEach(() => {
    fromMock.mockReset();
    pollMock.mockReset();
  });

  /** Minimal PostgREST builder stub for the one query fetchRunningAiJobs makes. */
  function stubRows(rows: ReconcilableJob[] | null, error: unknown = null) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: rows, error }),
    };
    fromMock.mockReturnValue(builder);
  }

  it('polls each due job once and reports what resolved', async () => {
    const { sweepAiJobs } = await import('./aiJobs');
    stubRows([job({ id: 'a' }), job({ id: 'b' })]);
    pollMock.mockImplementation((id: string) =>
      Promise.resolve({ data: { job: { id, status: id === 'a' ? 'succeeded' : 'running' } }, error: null }));

    const res = await sweepAiJobs('org1', NOW);
    expect(res.polled).toBe(2);
    expect(pollMock).toHaveBeenCalledTimes(2);
    expect(res.resolved.map((j) => j.id)).toEqual(['a']);
    // 'b' is still running, so the caller must come back.
    expect(res.pending).toBe(true);
  });

  it('stops asking for more sweeps once everything resolved', async () => {
    const { sweepAiJobs } = await import('./aiJobs');
    stubRows([job({ id: 'a' })]);
    pollMock.mockResolvedValue({ data: { job: { id: 'a', status: 'succeeded' } }, error: null });
    expect((await sweepAiJobs('org1', NOW)).pending).toBe(false);
  });

  it('does not keep sweeping for a job that is past giving up on', async () => {
    const { sweepAiJobs } = await import('./aiJobs');
    stubRows([job({ id: 'old', created_at: ago(ABANDON_MS + 1000) })]);
    const res = await sweepAiJobs('org1', NOW);
    expect(res.polled).toBe(0);
    expect(pollMock).not.toHaveBeenCalled();
    expect(res.pending).toBe(false);
  });

  it('still reports pending for a job it skipped as too fresh', async () => {
    const { sweepAiJobs } = await import('./aiJobs');
    stubRows([job({ id: 'fresh', updated_at: ago(1000) })]);
    const res = await sweepAiJobs('org1', NOW);
    expect(res.polled).toBe(0);
    expect(res.pending).toBe(true);
  });

  it('is silent and harmless when the read fails', async () => {
    const { sweepAiJobs } = await import('./aiJobs');
    stubRows(null, { message: 'boom' });
    const res = await sweepAiJobs('org1', NOW);
    expect(res).toEqual({ polled: 0, resolved: [], pending: false });
  });

  it('survives a poll that returns nothing', async () => {
    const { sweepAiJobs } = await import('./aiJobs');
    stubRows([job({ id: 'a' })]);
    pollMock.mockResolvedValue({ data: null, error: 'network' });
    const res = await sweepAiJobs('org1', NOW);
    expect(res.resolved).toEqual([]);
    expect(res.pending).toBe(true);
  });
});
