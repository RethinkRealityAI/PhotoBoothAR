/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turn a booth clip into the one video file every phone and app accepts:
 * MP4, H.264 picture, AAC sound, the index (moov) at the front.
 *
 * Why the extra step after MediaRecorder, even when it already wrote MP4:
 *   • Chrome writes FRAGMENTED MP4 (moof/mdat pieces, no overall duration).
 *     Browsers play it, but Photos, WhatsApp and Instagram are far less
 *     forgiving: no duration, no seek bar, or a rejected upload.
 *   • Chrome on Linux (and some other builds) has no AAC encoder, so its MP4
 *     carries Opus sound, which iPhones do not reliably play inside MP4.
 *   • Browsers that cannot record MP4 at all (older Chrome, Firefox) write
 *     WebM, and stored clips from before this change are WebM too.
 *
 * Two levels of work, so a guest never waits on a heavy job by surprise:
 *   • 'remux'  (right after recording): copy the H.264 picture untouched into a
 *     plain MP4 and, only if needed, re-encode the SOUND to AAC. Fast: no
 *     picture is decoded or encoded. A WebM recording is left as WebM here.
 *   • 'full'   (when someone saves an older WebM clip): also re-encode the
 *     picture to H.264 through WebCodecs, where the browser can.
 *
 * NEVER loses a clip: any failure, timeout or unsupported case returns the
 * original blob unchanged. Copying packets keeps every timestamp, so the
 * sound delay lib/audioSync.ts put into the recording survives the remux.
 *
 * mediabunny is loaded lazily, so the booth's first paint never pays for it.
 */

export type Mp4Level = 'remux' | 'full';

export interface ToMp4Options {
  level: Mp4Level;
  /** Give up and keep the original after this long. Default 20 s ('remux') / 120 s ('full'). */
  timeoutMs?: number;
  /** 0..1 while converting (for a "Preparing MP4…" line). */
  onProgress?: (progress: number) => void;
}

/** What the conversion did, for logs and the tester readout. */
export type Mp4Outcome =
  | 'converted'      // a new MP4 came out
  | 'kept-webm'      // WebM picture and this level / browser cannot make H.264
  | 'no-video'       // nothing to convert
  | 'failed';        // anything went wrong: the original is returned

export interface Mp4Result {
  blob: Blob;
  outcome: Mp4Outcome;
}

/** The decision, separated from mediabunny so it is testable in node. */
export function planMp4(
  videoCodec: string | null,
  level: Mp4Level,
  canEncodeH264: boolean,
): 'copy-video' | 'encode-video' | 'skip' {
  if (videoCodec === 'avc') return 'copy-video';
  if (level === 'full' && canEncodeH264) return 'encode-video';
  return 'skip';
}

export function isMp4Type(type: string | null | undefined): boolean {
  return typeof type === 'string' && /^video\/(mp4|quicktime)\b/i.test(type);
}

/** `moment_2026-11-25_1.webm` → `moment_2026-11-25_1.mp4` (adds one if missing). */
export function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = dot > slash && dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}

let aacRegistered: Promise<void> | null = null;

/** Load mediabunny (and the WASM AAC encoder when `aac`) ahead of use. Best-effort. */
export async function warmMp4(aac: boolean): Promise<void> {
  try {
    await import('mediabunny');
    if (aac) {
      aacRegistered ??= import('@mediabunny/aac-encoder').then((m) => m.registerAacEncoder());
      await aacRegistered;
    }
  } catch {
    aacRegistered = null;
  }
}

/** A worker started while the guest records, handed to the next convertMp4. */
let warmWorker: Worker | null = null;

function newMp4Worker(): Worker {
  return new Worker(new URL('./mp4Export.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Start the conversion worker while the guest is still recording, so the
 * tidy after Stop does not wait on loading ~200 KB (gzip) of converter, plus
 * the ~290 KB WASM AAC encoder when the recording's sound is not AAC already
 * (Chrome without a platform AAC encoder records Opus). Best-effort.
 */
export function prewarmMp4(recordingMime: string): void {
  if (!isMp4Type(recordingMime) || warmWorker || typeof Worker === 'undefined') return;
  try {
    warmWorker = newMp4Worker();
    warmWorker.postMessage({ kind: 'warm', aac: !/mp4a|aac/i.test(recordingMime) });
  } catch {
    warmWorker = null;
  }
}

/**
 * Convert to a shareable MP4, or hand back the original. Never throws.
 */
export async function toShareableMp4(blob: Blob, opts: ToMp4Options): Promise<Mp4Result> {
  if (!blob || blob.size === 0) return { blob, outcome: 'no-video' };
  const timeoutMs = opts.timeoutMs ?? (opts.level === 'remux' ? 20_000 : 120_000);
  let cancel: (() => Promise<void>) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let input: { dispose(): void } | null = null;
  try {
    const mb = await import('mediabunny');
    const source = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
    input = source;
    const video = await source.getPrimaryVideoTrack();
    if (!video) return { blob, outcome: 'no-video' };
    const audio = await source.getPrimaryAudioTrack();

    const needEncode = video.codec !== 'avc';
    const canH264 = needEncode && opts.level === 'full'
      ? await mb.canEncodeVideo('avc', { width: video.displayWidth, height: video.displayHeight }).catch(() => false)
      : false;
    const plan = planMp4(video.codec, opts.level, canH264);
    if (plan === 'skip') return { blob, outcome: 'kept-webm' };

    // Sound has to become AAC. Use the browser's encoder when it has one,
    // else the bundled WASM one (Chrome on Linux and some Android builds).
    if (audio && audio.codec !== 'aac') {
      const native = await mb.canEncodeAudio('aac', {
        numberOfChannels: audio.numberOfChannels,
        sampleRate: audio.sampleRate,
      }).catch(() => false);
      if (!native) {
        aacRegistered ??= import('@mediabunny/aac-encoder').then((m) => m.registerAacEncoder());
        try { await aacRegistered; } catch (e) { aacRegistered = null; throw e; }
      }
    }

    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const conversion = await mb.Conversion.init({
      input: source,
      output,
      // `quality` FORCES a re-encode in mediabunny even when the codec already
      // matches, so it is only set for a track that has to be re-encoded.
      video: plan === 'copy-video' ? { codec: 'avc' } : { codec: 'avc', quality: mb.QUALITY_HIGH },
      audio: (track) => (track.codec === 'aac' ? { codec: 'aac' } : { codec: 'aac', quality: mb.QUALITY_HIGH }),
      // Copy packets even when the tracks need a tiny common shift to start at
      // 0 (AAC priming puts audio a few ms below 0). mediabunny keeps the
      // sound/picture offset exact under any shift; with the default (0) it
      // would decode and RE-ENCODE the whole picture instead.
      copy: { shiftTolerance: Infinity },
      showWarnings: false,
    });
    // A conversion that would silently drop the sound (or the picture) is
    // worse than the original file: keep the original.
    const dropped = conversion.discardedTracks.some((d) => d.track === video || (audio !== null && d.track === audio));
    if (!conversion.isValid || dropped) {
      console.warn('[mp4Export] cannot convert, keeping original', conversion.discardedTracks.map((d) => d.reason));
      return { blob, outcome: 'failed' };
    }
    if (opts.onProgress) conversion.onProgress = (p) => opts.onProgress?.(p);
    cancel = () => conversion.cancel();

    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const done = await Promise.race([conversion.execute().then(() => 'ok' as const), timedOut]);
    if (done === 'timeout') {
      void cancel().catch(() => undefined);
      console.warn('[mp4Export] timed out, keeping original');
      return { blob, outcome: 'failed' };
    }
    const buf = target.buffer;
    if (!buf || buf.byteLength === 0) return { blob, outcome: 'failed' };
    return { blob: new Blob([buf], { type: 'video/mp4' }), outcome: 'converted' };
  } catch (err) {
    console.warn('[mp4Export] conversion failed, keeping original', err);
    return { blob, outcome: 'failed' };
  } finally {
    if (timer !== null) clearTimeout(timer);
    try { input?.dispose(); } catch { /* ignore */ }
  }
}

/**
 * `toShareableMp4` on a Web Worker (see mp4Export.worker.ts), so the booth's
 * camera, tracker and 3D keep the main thread. Same contract: never throws,
 * returns the original on any failure or timeout. Falls back to the main
 * thread only where a worker cannot be created at all.
 */
export function convertMp4(blob: Blob, opts: ToMp4Options): Promise<Mp4Result> {
  if (!blob || blob.size === 0) return Promise.resolve({ blob, outcome: 'no-video' });
  let worker: Worker;
  try {
    if (warmWorker) {
      worker = warmWorker;
      warmWorker = null;
    } else {
      if (typeof Worker === 'undefined') return toShareableMp4(blob, opts);
      worker = newMp4Worker();
    }
  } catch {
    return toShareableMp4(blob, opts);
  }
  const timeoutMs = opts.timeoutMs ?? (opts.level === 'remux' ? 20_000 : 120_000);
  return new Promise<Mp4Result>((resolve) => {
    let settled = false;
    const finish = (r: Mp4Result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => {
      console.warn('[mp4Export] worker timed out, keeping original');
      finish({ blob, outcome: 'failed' });
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent<{ kind: 'progress'; progress: number } | { kind: 'done'; blob: Blob; outcome: Mp4Outcome }>) => {
      const m = e.data;
      if (m.kind === 'progress') opts.onProgress?.(m.progress);
      else finish({ blob: m.blob, outcome: m.outcome });
    };
    worker.onerror = (ev) => {
      console.warn('[mp4Export] worker failed, keeping original', ev.message);
      finish({ blob, outcome: 'failed' });
    };
    worker.postMessage({ kind: 'convert', blob, level: opts.level });
  });
}

/**
 * The save/share path: a stored clip that is not already MP4 is converted
 * ('full'), an MP4 is passed through untouched (it was tidied when recorded).
 * Returns the bytes to save and the extension that matches them.
 */
export async function shareableVideo(blob: Blob, onProgress?: (p: number) => void): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  if (isMp4Type(blob.type)) return { blob, ext: 'mp4' };
  const r = await convertMp4(blob, { level: 'full', onProgress });
  return r.outcome === 'converted' ? { blob: r.blob, ext: 'mp4' } : { blob, ext: isMp4Type(r.blob.type) ? 'mp4' : 'webm' };
}
