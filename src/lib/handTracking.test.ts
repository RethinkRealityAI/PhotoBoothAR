import { beforeEach, describe, expect, it, vi } from 'vitest';

const createFromOptions = vi.fn();
const reportError = vi.fn();

vi.mock('@mediapipe/tasks-vision', () => ({
  HandLandmarker: { createFromOptions: (...args: unknown[]) => createFromOptions(...args) },
}));
vi.mock('./faceTracking', () => ({
  resolveModelUrl: async () => '/models/hand_landmarker.task',
  visionFileset: async () => ({}),
}));
vi.mock('./errorReport', () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

describe('initializeHandLandmarker — a CPU failure is surfaced, never retried on GPU (#24)', () => {
  beforeEach(() => {
    vi.resetModules();
    createFromOptions.mockReset();
    reportError.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('rejects, records the reason, and never asks for the GPU delegate', async () => {
    // The GPU path "succeeding" is exactly what used to hide the failure while
    // it killed the GL context the face layer and the 3D canvas share.
    createFromOptions.mockImplementation(async (_v: unknown, opts: { baseOptions: { delegate: string } }) => {
      if (opts.baseOptions.delegate === 'CPU') throw new Error('xnnpack init failed');
      return { gpu: true };
    });
    const ht = await import('./handTracking');
    await expect(ht.initializeHandLandmarker()).rejects.toThrow('xnnpack init failed');
    const delegates = createFromOptions.mock.calls.map((c) => (c[1] as { baseOptions: { delegate: string } }).baseOptions.delegate);
    expect(delegates).toEqual(['CPU']);
    expect(ht.getHandLandmarker()).toBeNull();
    expect(ht.isHandLandmarkerReady()).toBe(false);
    expect(ht.getHandTrackerError()).toBe('xnnpack init failed');
  });

  it('reports the failure once, however many rigs retry', async () => {
    createFromOptions.mockRejectedValue(new Error('nope'));
    const ht = await import('./handTracking');
    await expect(ht.initializeHandLandmarker()).rejects.toThrow();
    await expect(ht.initializeHandLandmarker()).rejects.toThrow();
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(createFromOptions).toHaveBeenCalledTimes(2); // retry stays possible
  });

  it('a later successful retry clears the error', async () => {
    createFromOptions.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ ok: true });
    const ht = await import('./handTracking');
    await expect(ht.initializeHandLandmarker()).rejects.toThrow();
    await expect(ht.initializeHandLandmarker()).resolves.toEqual({ ok: true });
    expect(ht.getHandTrackerError()).toBeNull();
  });
});
