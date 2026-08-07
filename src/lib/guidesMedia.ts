/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Guides' media layer — the impure half of the split, exactly like
 * src/lib/landingAssets.ts is to src/lib/landingContent.ts.
 *
 * Frame-pack artwork is NOT bundled: the fourteen PNGs are large, they are
 * downloads rather than page decoration, and a visitor to /guides should not
 * fetch 14 posters to read the copy. They are served straight out of
 * public/guides/frames/ by URL, with a small WebP thumbnail beside each one
 * for the gallery grid.
 */
import type { FramePackId, GuideVideoKey, HotspotShotKey } from './guidesContent';
import firstEventMp4 from '../assets/guides/guide-first-event.mp4';
import firstEventPoster from '../assets/guides/guide-first-event.jpg';
import designAFrameMp4 from '../assets/guides/guide-design-a-frame.mp4';
import designAFramePoster from '../assets/guides/guide-design-a-frame.jpg';

/**
 * An annotated product screenshot. Served by URL for the same reason the
 * frames are: these are wide PNGs that only one guide uses.
 *
 * The files land with the shots; until then every HOTSPOT_SHOTS entry has
 * width 0 and the renderer skips the block entirely, so this URL is never
 * requested.
 */
export function hotspotShotPng(key: HotspotShotKey): string {
  return `/guides/shots/${key}.png`;
}

/** Full-resolution 1080 × 1920 transparent PNG — what the download link points at. */
export function framePng(id: FramePackId): string {
  return `/guides/frames/${id}.png`;
}

/** The gallery thumbnail. WebP, a fraction of the PNG's weight. */
export function frameThumb(id: FramePackId): string {
  return `/guides/frames/thumb/${id}.webp`;
}

/**
 * The filename a host ends up with in their Downloads folder.
 *
 * Named rather than left as the raw id because that file gets re-uploaded into
 * the studio later, and "beamwall-wedding-arch-mask-1080x1920.png" tells them
 * what it is and that it is already the right size — "wedding-arch-mask.png"
 * sitting next to twenty other downloads does not.
 */
export function frameDownloadName(id: FramePackId): string {
  return `beamwall-${id}-1080x1920.png`;
}

/**
 * Guide films, rendered by the beamwall-video pipeline from the compositions in
 * hyperframes/studio/guide-*. `null` remains legal for a film whose media has
 * not landed yet — GuideBlock draws a styled placeholder rather than a <video>
 * pointed at a 404 — so a future guide can ship copy-first.
 */
export const GUIDE_VIDEO: Record<GuideVideoKey, { src: string; poster: string } | null> = {
  'first-event': { src: firstEventMp4, poster: firstEventPoster },
  'design-a-frame': { src: designAFrameMp4, poster: designAFramePoster },
};
