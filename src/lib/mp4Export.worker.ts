/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runs lib/mp4Export.ts `toShareableMp4` off the main thread. In the booth the
 * main thread is busy with the camera, the face tracker and 3D after Stop, and
 * a conversion sharing it was measured at 20 s+ (headless) for a clip that
 * converts in 1.5 s on a quiet thread. One worker per clip: the client
 * terminates it on a timeout, which is a hard cancel.
 */
import { toShareableMp4, warmMp4, type Mp4Level, type Mp4Outcome } from './mp4Export';

export type Mp4WorkerRequest =
  /** Load the converter (and the AAC encoder if `aac`) while the guest records. */
  | { kind: 'warm'; aac: boolean }
  | { kind: 'convert'; blob: Blob; level: Mp4Level };

export type Mp4WorkerMessage =
  | { kind: 'progress'; progress: number }
  | { kind: 'done'; blob: Blob; outcome: Mp4Outcome };

interface WorkerScope {
  onmessage: ((e: MessageEvent<Mp4WorkerRequest>) => void) | null;
  postMessage(message: Mp4WorkerMessage): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.kind === 'warm') {
    void warmMp4(msg.aac);
    return;
  }
  const { blob, level } = msg;
  // The client owns the timeout (it terminates this worker), so none here.
  void toShareableMp4(blob, {
    level,
    timeoutMs: 10 * 60_000,
    onProgress: (progress) => scope.postMessage({ kind: 'progress', progress }),
  }).then((r) => scope.postMessage({ kind: 'done', blob: r.blob, outcome: r.outcome }));
};
