/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Saving a whole gallery of captures to a guest's phone.
 *
 * The old implementation clicked one synthetic `<a download>` per file, 600 ms
 * apart. Mobile Safari allows one programmatic download per user gesture and
 * discards the rest without an error, so a guest with eight moments got one
 * file and a spinner that ran until they gave up. Chrome on Android prompts
 * ("allow multiple downloads?") which most people dismiss.
 *
 * The replacement collects the bytes ONCE, reports honest progress while it
 * does, and then offers whichever handoff the browser actually supports:
 *
 *   • `navigator.share({ files })` — on iOS this puts photos and videos into
 *     Photos, which is where a guest wants them. Feature-detected through
 *     `navigator.canShare`, never assumed.
 *   • a single STORE zip (src/lib/zipStore.ts) — one file, one download, works
 *     in every browser including the ones with no share sheet.
 *
 * `share()` requires transient user activation, and collecting a dozen files
 * over venue wifi outlasts it — so collection and handoff are deliberately two
 * separate steps, the second driven by a fresh tap. That is also why nothing
 * here auto-fires: a blocked auto-action is indistinguishable from a hang.
 *
 * The network lives behind an injected `fetchImpl` so this module is testable
 * in the node-env suite with no DOM and no server.
 */
import { KeepsakeItem, keepsakeFileName, mediaExtension, mediaMimeType } from './keepsake';
import { uniqueNames, zipSafeName, zipBlob, ZipLimitError } from './zipStore';

export interface CollectedFile {
  /** The source item's id, so the UI can point at what failed. */
  id: string;
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface CollectFailure {
  id: string;
  /** One short line fit to show a guest. */
  reason: string;
}

export interface CollectResult {
  files: CollectedFile[];
  failures: CollectFailure[];
  totalBytes: number;
  /** True when the caller aborted; the partial result is still returned. */
  aborted: boolean;
}

export interface CollectOptions {
  filePrefix: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** A hard ceiling on what we will hold in memory before refusing the batch. */
export const MAX_ARCHIVE_BYTES = 1_500_000_000; // 1.5 GB

export class ArchiveTooBigError extends Error {
  constructor(readonly bytes: number) {
    super(`archive would be ${bytes} bytes`);
    this.name = 'ArchiveTooBigError';
  }
}

/**
 * Download every capture into memory, sequentially.
 *
 * Sequential rather than parallel on purpose: this runs on a phone on venue
 * wifi, and eight parallel 4 MB fetches is how you turn a slow save into a
 * failed one. It also makes the progress count mean something.
 *
 * A single item failing does NOT fail the batch — the guest still gets the
 * moments that did load, and the ones that did not are named.
 */
export async function collectFiles(
  items: KeepsakeItem[],
  opts: CollectOptions,
): Promise<CollectResult> {
  const doFetch = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  const files: CollectedFile[] = [];
  const failures: CollectFailure[] = [];
  let totalBytes = 0;
  let aborted = false;

  if (!doFetch) {
    return {
      files,
      failures: items.map((i) => ({ id: i.id, reason: 'downloads are unavailable here' })),
      totalBytes: 0,
      aborted: false,
    };
  }

  const rawNames = items.map((item, i) =>
    zipSafeName(keepsakeFileName(opts.filePrefix, item, i, items.length)),
  );
  const names = uniqueNames(rawNames);

  opts.onProgress?.(0, items.length);

  for (let i = 0; i < items.length; i++) {
    if (opts.signal?.aborted) {
      aborted = true;
      break;
    }
    const item = items[i];
    try {
      const resp = await doFetch(item.url, { mode: 'cors', signal: opts.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      totalBytes += bytes.length;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new ArchiveTooBigError(totalBytes);
      files.push({
        id: item.id,
        name: names[i],
        type: mediaMimeType(mediaExtension(item.url, item.kind)),
        bytes,
      });
    } catch (err) {
      if (err instanceof ArchiveTooBigError) throw err;
      if (opts.signal?.aborted) {
        aborted = true;
        break;
      }
      failures.push({ id: item.id, reason: shortReason(err) });
    }
    opts.onProgress?.(files.length + failures.length, items.length);
  }

  return { files, failures, totalBytes, aborted };
}

function shortReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 4\d\d/.test(msg)) return 'this one is no longer available';
  if (/HTTP 5\d\d/.test(msg)) return 'the event server had a problem';
  return 'the connection dropped';
}

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

/** Whether this browser can receive files through the native share sheet. */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    // A real probe, not a guess: Safari on macOS exposes canShare but rejects
    // files, and several in-app browsers expose share() with no file support.
    const probe = new File([new Uint8Array([0])], 'probe.jpg', { type: 'image/jpeg' });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function toShareFiles(files: CollectedFile[]): File[] {
  // A fresh copy of the bytes: some browsers neuter the backing buffer after a
  // share, and the guest may well press "Download .zip" afterwards.
  return files.map((f) => new File([f.bytes.slice()], f.name, { type: f.type }));
}

/** Package collected files into one archive Blob. */
export function archiveOf(files: CollectedFile[]): Blob {
  return zipBlob(files.map((f) => ({ name: f.name, data: f.bytes })));
}

/**
 * A flat string rather than a discriminated union on purpose: this repo's
 * tsconfig leaves `strictNullChecks` off, and without it TypeScript will not
 * narrow a union by a boolean `ok` discriminant — every caller would have to
 * cast. Four names carry the same information with none of that.
 */
export type HandoffOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

/**
 * Hand the files to the native share sheet.
 *
 * MUST be called directly from a user gesture — see the module note. A user
 * cancelling is reported distinctly from a genuine failure, because the UI
 * should say nothing at all in the first case and offer the zip in the second.
 */
export async function shareFiles(
  files: CollectedFile[],
  meta: { title?: string; text?: string },
): Promise<HandoffOutcome> {
  if (!canShareFiles()) return 'unsupported';
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const payload: ShareData = { files: toShareFiles(files) };
  if (meta.title) payload.title = meta.title;
  if (meta.text) payload.text = meta.text;
  try {
    if (nav.canShare && !nav.canShare(payload)) return 'unsupported';
    await nav.share(payload);
    return 'shared';
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

/**
 * Save a Blob to disk through a single anchor click.
 *
 * One click, from a user gesture, is the only download shape mobile browsers
 * reliably honour — which is the entire reason the batch became one zip.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously races Safari's download start; one frame is enough
  // and the object is released either way when the tab goes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export { ZipLimitError };
