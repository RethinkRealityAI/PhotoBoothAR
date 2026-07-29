/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure logic behind the guest keepsake gallery (/e/:slug/me).
 *
 * Everything here is deliberately free of React, the DOM and Supabase so it can
 * be tested in the node-env vitest suite. The component keeps the effects; this
 * file keeps the decisions.
 */

export type KeepsakeKind = 'image' | 'video';

export interface KeepsakeItem {
  id: string;
  url: string;
  kind: KeepsakeKind;
  /** ms epoch */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * File extension for a capture.
 *
 * The URL is the authority when it carries one we recognise — the booth writes
 * `.webm` clips but an uploaded keepsake can be `.mp4`, and handing Photos a
 * `.webm` named `.mp4` produces a file that imports and then will not play.
 * Falls back to the media type, never to a bare guess.
 */
export function mediaExtension(url: string, kind: KeepsakeKind): string {
  const withoutQuery = url.split('?')[0].split('#')[0];
  const m = /\.([a-z0-9]{2,4})$/i.exec(withoutQuery);
  const found = m ? m[1].toLowerCase() : '';
  const allowed = kind === 'video'
    ? ['webm', 'mp4', 'mov', 'm4v']
    : ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
  if (allowed.includes(found)) return found === 'jpeg' ? 'jpg' : found;
  return kind === 'video' ? 'webm' : 'jpg';
}

/** MIME type matching `mediaExtension`, for the File objects handed to share(). */
export function mediaMimeType(ext: string): string {
  switch (ext) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'avif': return 'image/avif';
    case 'webm': return 'video/webm';
    case 'mp4':
    case 'm4v': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    default: return 'image/jpeg';
  }
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * A filename a guest can recognise a year later: event, date, sequence.
 *
 * The sequence number is 1-based and zero-padded to the width of the batch, so
 * a phone's Files app sorts them in capture order rather than 1, 10, 11, 2.
 */
export function keepsakeFileName(
  prefix: string,
  item: KeepsakeItem,
  index: number,
  total: number,
): string {
  const d = new Date(item.createdAt);
  const stamp = Number.isFinite(item.createdAt)
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : 'moment';
  const width = String(Math.max(1, total)).length;
  const seq = String(index + 1).padStart(width, '0');
  const clean = (prefix || 'moment').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean || 'moment'}_${stamp}_${seq}.${mediaExtension(item.url, item.kind)}`;
}

/** Name for the whole archive, e.g. `Hope-Gala-moments.zip`. */
export function archiveName(prefix: string): string {
  const clean = (prefix || 'moments').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean || 'moments'}-moments.zip`;
}

// ---------------------------------------------------------------------------
// Counting and grouping
// ---------------------------------------------------------------------------

export interface KeepsakeSummary {
  total: number;
  photos: number;
  videos: number;
}

export function summarize(items: KeepsakeItem[]): KeepsakeSummary {
  let videos = 0;
  for (const i of items) if (i.kind === 'video') videos++;
  return { total: items.length, photos: items.length - videos, videos };
}

/** "3 photos · 1 video" — the count line under the title. */
export function summaryLine(s: KeepsakeSummary): string {
  const parts: string[] = [];
  if (s.photos > 0) parts.push(`${s.photos} ${s.photos === 1 ? 'photo' : 'photos'}`);
  if (s.videos > 0) parts.push(`${s.videos} ${s.videos === 1 ? 'video' : 'videos'}`);
  return parts.join(' · ');
}

export interface KeepsakeGroup {
  /** Stable key: the local calendar day, `YYYY-MM-DD`. */
  key: string;
  label: string;
  items: KeepsakeItem[];
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Group newest-first into calendar days.
 *
 * A guest who attended one evening sees a single group and no visual noise; a
 * guest who came back for the brunch sees the two nights separated, which is
 * the whole reason the grouping exists. Order within a group is preserved, so
 * the caller's sort (newest first) still holds.
 */
export function groupByDay(items: KeepsakeItem[], now: number = Date.now()): KeepsakeGroup[] {
  const today = dayKey(now);
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  const order: string[] = [];
  const buckets = new Map<string, KeepsakeItem[]>();

  for (const item of items) {
    const key = dayKey(item.createdAt);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }

  return order.map((key) => {
    const bucket = buckets.get(key) ?? [];
    let label: string;
    if (key === today) label = 'Today';
    else if (key === yesterday) label = 'Yesterday';
    else {
      const d = new Date(bucket[0].createdAt);
      label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }
    return { key, label, items: bucket };
  });
}

// ---------------------------------------------------------------------------
// Video playback policy
// ---------------------------------------------------------------------------

/**
 * How many clips may play at once.
 *
 * Every mobile platform caps simultaneously decoding videos (iOS historically
 * around 4-16 depending on the device); past the cap the extra <video> elements
 * paint black rather than erroring, which is exactly the "some of my videos are
 * broken" report. Three is comfortably inside every cap and is more than a
 * phone shows at once anyway.
 */
export const MAX_CONCURRENT_VIDEOS = 3;

/**
 * Which clips are allowed to play, given what is on screen.
 *
 * `visibleInOrder` is the intersecting set in document order. Returning the
 * first N of that — rather than "whichever intersected most recently" — keeps
 * the choice stable while scrolling, so a clip does not flicker between playing
 * and paused as its neighbour crosses the threshold.
 *
 * Under `prefers-reduced-motion` nothing plays: the grid shows first frames and
 * the guest presses play. Autoplaying a wall of video is precisely the ambient
 * motion that setting asks us not to produce.
 */
export function playableVideoIds(
  visibleInOrder: string[],
  opts: { reducedMotion?: boolean; max?: number } = {},
): string[] {
  if (opts.reducedMotion) return [];
  const max = opts.max ?? MAX_CONCURRENT_VIDEOS;
  if (max <= 0) return [];
  return visibleInOrder.slice(0, max);
}

// ---------------------------------------------------------------------------
// Bulk save strategy
// ---------------------------------------------------------------------------

export type BulkSaveMode = 'share' | 'zip' | 'single';

export interface BulkSaveCapabilities {
  /** `navigator.canShare({ files })` returned true for a probe file. */
  canShareFiles: boolean;
  /** Number of items the guest asked to save. */
  count: number;
}

/**
 * How to hand a batch of captures to the guest.
 *
 * The rule this replaces was "click N download anchors 600 ms apart", which is
 * blocked after the first file on iOS Safari — the guest got one photo and a
 * spinner that never finished.
 *
 *  - one item            -> `single`: a plain download; an archive of one file
 *                           is a worse gift than the file.
 *  - share sheet present -> `share`: on iOS this lands photos and videos in
 *                           Photos, which is where the guest wants them. A zip
 *                           would land in Files and need a second app to open.
 *  - otherwise           -> `zip`: one file, one download, works everywhere.
 */
export function pickBulkSaveMode(caps: BulkSaveCapabilities): BulkSaveMode {
  if (caps.count <= 1) return 'single';
  if (caps.canShareFiles) return 'share';
  return 'zip';
}

/** Human size for the "ready to save — 24.3 MB" line. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** "Saving 3 of 8" — progress copy that never claims a step it has not done. */
export function progressLabel(done: number, total: number): string {
  const clamped = Math.min(Math.max(done, 0), total);
  return `Collecting ${clamped} of ${total}`;
}
