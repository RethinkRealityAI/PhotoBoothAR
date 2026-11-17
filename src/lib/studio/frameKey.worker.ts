/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Off-main-thread chroma key for AI frames. Keying + contain-fit + the quality
 * gate is ~2M pixels of arithmetic per take (×3 with variants); on a mid-range
 * phone that froze the studio for well over a second per frame. Here it runs
 * on a worker: fetch → createImageBitmap → OffscreenCanvas → prepareFrame (the
 * SAME pure function the main-thread fallback runs) → the RGBA buffer is
 * TRANSFERRED back, never copied.
 *
 * Text compositing and PNG encoding stay on the main thread: fonts loaded via
 * the page's fonts.css are not visible to a worker's canvas in every browser
 * (WorkerGlobalScope.fonts is missing in Safari), and canvas.toBlob already
 * encodes off-thread.
 */
import { prepareFrame, type PrepareFlags, type PrepareOptions, type PreparedFrame } from './frameQuality';

export interface FrameKeyRequest {
  id: number;
  url: string;
  flags: PrepareFlags;
  opts: PrepareOptions;
}

export type FrameKeyResponse =
  | { id: number; ok: true; result: PreparedFrame; source: { width: number; height: number } }
  | { id: number; ok: false; error: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<FrameKeyRequest>) => void) | null;
  postMessage(message: FrameKeyResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  void handle(e.data);
};

async function handle({ id, url, flags, opts }: FrameKeyRequest): Promise<void> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`fetch_${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no_2d_context');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = prepareFrame({ data: src.data, width: src.width, height: src.height }, flags, opts);
    // `image` already IS the repaired buffer when a repair happened; drop the
    // duplicate reference so only one buffer crosses (and is transferred).
    const result: PreparedFrame = out.quality ? { ...out, quality: { ...out.quality, repaired: undefined } } : out;
    scope.postMessage(
      { id, ok: true, result, source: { width: src.width, height: src.height } },
      [result.image.data.buffer],
    );
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
