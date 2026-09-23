/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE arbiter for the two blocking CPU landmarkers (face, hand). Pure — no
 * MediaPipe, no DOM — so the fairness policy is unit-tested in node.
 *
 * Why it exists. Each tracker used to gate itself: face on a 33ms floor, hand
 * on 66ms plus a "not right after a face inference" lockout. The trigger loops
 * (Booth, StudioStage) ask for face THEN hand on every frame, and once inference
 * itself blocks the frame (every phone, and any scene with a face piece) face is
 * due on every frame — so the lockout denied the hand on every frame, forever.
 * Measured in the headless harness: face 5.6 inferences/s, hand 0/s, with a crown
 * on the head and a Power FX gauntlet on the hand. A lockout can only ever
 * say "not you"; it cannot say "you're next". This says "you're next".
 *
 * The policy:
 *  - A task is ACTIVE while something asked for it in the last DEMAND_TTL_MS
 *    (a rig mounted, a trigger loop running). Inactive tasks never block.
 *  - A task is READY when its own gate allows it: its (adaptive) interval has
 *    elapsed and the camera has produced a frame it has not seen
 *    (faceDetectClock.shouldDetect — the same rule as before, per task).
 *  - Of the ready tasks, the MOST OVERDUE (elapsed ÷ interval) wins. A caller
 *    asking for the other one is told no, and the winner's own caller — later
 *    in the same frame, or first thing next frame — is told yes. Call order no
 *    longer decides who runs, so neither tracker can starve the other.
 *  - At most ONE expensive inference per rendered frame (frameKey): two blocking
 *    calls in one frame is exactly the dropped frame the old lockout was for.
 *    A second one is allowed only when the first was cheap (a desktop, where
 *    both fit comfortably), so fast machines keep full cadence on both.
 *  - Intervals ADAPT to measured cost so the pair never eats the frame budget:
 *    interval ≥ cost ÷ share, with the share split when both are active. On a
 *    phone paying ~20ms per inference that is ~20Hz face + ~12Hz hand instead of
 *    30Hz face + 0Hz hand; dead reckoning (smoothing.ts) covers the gaps.
 */
import { createDetectGate, markDetected, shouldDetect, type DetectGate } from './faceDetectClock';

export type TrackTask = 'face' | 'hand';

/** A consumer that stops asking releases its task after this long. */
export const DEMAND_TTL_MS = 300;
/** A first inference cheaper than this leaves room for a second in the frame. */
export const CHEAP_INFERENCE_MS = 8;
/** Share of wall time the trackers may take between them (the rest renders). */
export const TRACKING_DUTY = 0.6;
/** How the duty splits when both trackers are active. */
export const SHARE_BOTH: Readonly<Record<TrackTask, number>> = { face: 0.35, hand: 0.25 };
const COST_EMA = 0.25;

interface TaskState {
  gate: DetectGate;
  /** performance.now() of the most recent request, or -Infinity. */
  demandAt: number;
  /** The requester's own floor (face 33ms, hand 66ms / 150ms idle). */
  minIntervalMs: number;
  /** Smoothed inference cost, ms; 0 until measured. */
  costMs: number;
  /** Inferences run — diagnostics. */
  runs: number;
}

export interface TrackingScheduler {
  tasks: Record<TrackTask, TaskState>;
  /** Frame the last inference ran in, and how many / how costly so far. */
  frameKey: number;
  frameRuns: number;
  frameCostMs: number;
}

function task(minIntervalMs: number): TaskState {
  return { gate: createDetectGate(), demandAt: -Infinity, minIntervalMs, costMs: 0, runs: 0 };
}

export function createTrackingScheduler(): TrackingScheduler {
  return { tasks: { face: task(33), hand: task(66) }, frameKey: NaN, frameRuns: 0, frameCostMs: 0 };
}

const OTHER: Readonly<Record<TrackTask, TrackTask>> = { face: 'hand', hand: 'face' };

export function isActive(s: TrackingScheduler, t: TrackTask, now: number): boolean {
  return now - s.tasks[t].demandAt < DEMAND_TTL_MS;
}

/** The interval this task runs at right now: its floor, or longer when its
 *  measured cost would otherwise take more than its share of the frame time. */
export function effectiveIntervalMs(s: TrackingScheduler, t: TrackTask, now: number): number {
  const st = s.tasks[t];
  const both = isActive(s, OTHER[t], now);
  const share = both ? SHARE_BOTH[t] : TRACKING_DUTY;
  return Math.max(st.minIntervalMs, st.costMs / share);
}

function ready(s: TrackingScheduler, t: TrackTask, now: number, videoTime: number): boolean {
  if (!isActive(s, t, now)) return false;
  return shouldDetect(s.tasks[t].gate, now, videoTime, { minIntervalMs: effectiveIntervalMs(s, t, now) });
}

/** elapsed ÷ interval — how late this task is. A task that never ran is
 *  infinitely overdue. */
function overdue(s: TrackingScheduler, t: TrackTask, now: number): number {
  const last = s.tasks[t].gate.lastDetectMs;
  if (!Number.isFinite(last)) return Infinity;
  return (now - last) / effectiveIntervalMs(s, t, now);
}

/**
 * May `t` run an inference now? Records the request as demand (a caller that
 * asks is, by definition, a consumer) and answers without side effects on the
 * gates; the caller reports the run with `recordRun` once inference returns.
 *
 * `frameKey` identifies the rendered frame (document.timeline.currentTime is
 * identical for every rAF callback of one frame); `videoTime` identifies the
 * camera frame.
 */
export function requestInference(
  s: TrackingScheduler,
  t: TrackTask,
  now: number,
  videoTime: number,
  frameKey: number,
  minIntervalMs: number,
): boolean {
  const st = s.tasks[t];
  st.demandAt = now;
  st.minIntervalMs = minIntervalMs;
  // Frame budget first: one blocking inference per frame unless it was cheap.
  if (s.frameKey === frameKey && s.frameRuns > 0) {
    if (s.frameRuns >= 2 || s.frameCostMs > CHEAP_INFERENCE_MS) return false;
  }
  if (!ready(s, t, now, videoTime)) return false;
  const o = OTHER[t];
  if (ready(s, o, now, videoTime)) {
    const mine = overdue(s, t, now);
    const theirs = overdue(s, o, now);
    // Strictly more overdue wins; a dead heat (both never ran) goes to the
    // face — the head pose is what most scenes are built on.
    if (theirs > mine || (theirs === mine && o === 'face')) return false;
  }
  return true;
}

/** Report an inference that ran from `startMs` to `endMs` on `videoTime`. */
export function recordRun(
  s: TrackingScheduler,
  t: TrackTask,
  startMs: number,
  endMs: number,
  videoTime: number,
  frameKey: number,
): void {
  const st = s.tasks[t];
  markDetected(st.gate, startMs, videoTime);
  const cost = Math.max(0, endMs - startMs);
  st.costMs = st.costMs === 0 ? cost : st.costMs + COST_EMA * (cost - st.costMs);
  st.runs++;
  if (s.frameKey !== frameKey) {
    s.frameKey = frameKey;
    s.frameRuns = 0;
    s.frameCostMs = 0;
  }
  s.frameRuns++;
  s.frameCostMs += cost;
}

/** Forget one task's history (scene switch / booth unmount). */
export function resetTask(s: TrackingScheduler, t: TrackTask): void {
  const st = s.tasks[t];
  st.gate.lastDetectMs = -Infinity;
  st.gate.lastVideoTime = -1;
  st.costMs = 0;
}

/* ── The app's one instance ─────────────────────────────────────────────── */

/** Shared by faceRig and handRig — one arbiter per page, like the landmarkers. */
export const tracking = createTrackingScheduler();

/**
 * The rendered frame's identity: `document.timeline.currentTime` is set once
 * per rendering update and is the same for every rAF callback in it (R3F's
 * useFrame and the booth's own loop alike). Without a document (tests) or a
 * timeline, every call is its own frame — arbitration still holds, only the
 * one-per-frame budget is lost.
 */
export function currentFrameKey(): number {
  const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
  return typeof t === 'number' && Number.isFinite(t) ? t : performance.now();
}

/* ── Holding a tracked target ────────────────────────────────────────────── */

/**
 * With inference shared between two trackers — and on a slow device, one
 * inference per rendered frame — a tracker can go a while WITHOUT an
 * inference. That is not the same as losing the target, and treating it as
 * such hid a crown on a face that was plainly in frame (measured: 1.7s between
 * face inferences at 2fps while the hand held the other slots). So a target is
 * dropped only when:
 *  - an inference actually came back WITHOUT it, and kept doing so for
 *    `holdMs` (a blink, a hand passing by, fast motion); or
 *  - nothing has confirmed it for `staleMs` (the tracker itself stalled).
 */
export const STALE_MS = 2500;

export function isHeld(
  now: number,
  /** performance.now() of the last inference that FOUND it (-Infinity = never). */
  seenAt: number,
  /** performance.now() of the first inference since then that did NOT find it. */
  missSince: number | null,
  holdMs: number,
  staleMs: number = STALE_MS,
): boolean {
  if (!Number.isFinite(seenAt)) return false;
  if (now - seenAt >= staleMs) return false;
  return missSince === null || now - missSince < holdMs;
}
