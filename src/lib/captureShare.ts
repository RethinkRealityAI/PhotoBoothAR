/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keeping the shot a guest just took — the pure half.
 *
 * Two facts drive the UI built on this (components/booth/KeepShotButton.tsx):
 *
 *   • On iPhone, `<a download>` puts a photo in the Files app, not Photos.
 *     The share sheet is where "Save Image" lives, so when the browser can
 *     share FILES the one button opens the share sheet — save, Instagram,
 *     WhatsApp and AirDrop all sit in the same place.
 *   • `navigator.share()` needs a recent tap. Building the File only after
 *     the tap (an awaited fetch, even of a local blob URL) can outlast that on
 *     a slow phone, so the File is prepared as soon as the screen appears and
 *     the tap shares it with nothing awaited first.
 *
 * Browser APIs stay in the component; everything here is plain data so the
 * node-env suite can pin it.
 */

export type CaptureMedia = 'image' | 'video';

/** The extension that matches the bytes. Recordings are MP4 in most browsers
 *  now (lib/mp4Export.ts) but can still be WebM, and a wrong extension makes
 *  players treat the file as corrupt. */
export function captureExtension(mediaType: CaptureMedia, mime: string | null | undefined): string {
  const type = (mime ?? '').toLowerCase();
  if (mediaType === 'video') {
    if (type.includes('mp4') || type.includes('quicktime')) return 'mp4';
    if (type.includes('webm')) return 'webm';
    return 'mp4';
  }
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

/** `<Prefix>-<timestamp>.<ext>`; a blank prefix falls back to "Beamwall". */
export function captureFileName(
  prefix: string | null | undefined,
  mediaType: CaptureMedia,
  mime: string | null | undefined,
  now: number,
): string {
  const safe = (prefix ?? '').replace(/[^a-zA-Z0-9_-]+/g, '') || 'Beamwall';
  return `${safe}-${Math.max(0, Math.floor(now))}.${captureExtension(mediaType, mime)}`;
}

/** What the one "keep it" button does on this browser. */
export type KeepMode = 'share' | 'download';

export function keepMode(canShareFiles: boolean): KeepMode {
  return canShareFiles ? 'share' : 'download';
}

/** The button's words. `share` says both halves because on iPhone the sheet
 *  is how a photo reaches Photos — "Share" alone hides that. */
export function keepLabel(mode: KeepMode, mediaType: CaptureMedia): string {
  if (mode === 'share') return 'Save or share';
  return mediaType === 'video' ? 'Save video' : 'Save photo';
}

/**
 * The text that rides along with a share. Some targets (Messages, WhatsApp)
 * show it beside the photo; Instagram ignores it. Empty pieces are dropped,
 * and the event name is not repeated when the share text already carries it.
 */
export function shareMessage(shareText: string | null | undefined, eventName: string | null | undefined): string {
  const text = (shareText ?? '').trim();
  const name = (eventName ?? '').trim();
  if (text) return text;
  return name ? `My moment from ${name}.` : '';
}

/** How a finished attempt is reported back to the guest (null = say nothing:
 *  a cancelled share sheet is the guest's choice, not an error). */
export function keepOutcomeNote(
  outcome: 'shared' | 'cancelled' | 'unsupported' | 'failed' | 'downloaded',
  mediaType: CaptureMedia,
): string | null {
  const noun = mediaType === 'video' ? 'video' : 'photo';
  switch (outcome) {
    case 'shared':
      return null;
    case 'cancelled':
      return null;
    case 'downloaded':
      return `Your ${noun} is downloading.`;
    case 'unsupported':
    case 'failed':
      return `Couldn’t open sharing here, so we saved the ${noun} instead.`;
  }
}
