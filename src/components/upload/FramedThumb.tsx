/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FramedThumb — a small, non-interactive preview of an UploadItem that renders
 * exactly what will land on the wall:
 *   • framed image → 9:16 tile with the crop (pan/zoom/rotate) applied and the
 *     frame overlaid, using the shared `cropImageStyle` transform, and
 *   • un-framed image / video → its native media, cover-fit.
 *
 * Because it shares `cropImageStyle` with the interactive stage and the
 * compositor, thumbnails never disagree with the final post.
 */
import { Experience } from '../../types';
import { UploadItem } from './types';
import { cropImageStyle } from './framePreview';

export function frameAssetUrl(item: UploadItem, frames: Experience[]): string | null {
  if (!item.frameId) return null;
  return frames.find((f) => f.id === item.frameId)?.asset_url ?? null;
}

interface Props {
  item: UploadItem;
  frames: Experience[];
  /** Extra classes for the outer tile (e.g. sizing / ring). */
  className?: string;
  /** Rounding utility (defaults to rounded-lg). */
  rounded?: string;
  /** How un-framed media fills the tile. 'contain' shows the whole photo. */
  fit?: 'cover' | 'contain';
}

export default function FramedThumb({ item, frames, className = '', rounded = 'rounded-lg', fit = 'cover' }: Props) {
  const frameUrl = frameAssetUrl(item, frames);
  const isVideo = item.kind === 'video';
  const framed = !isVideo && !!frameUrl;
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div
      className={`relative overflow-hidden ${rounded} ${className}`}
      style={{ background: 'linear-gradient(135deg, #15100a, #221806)' }}
    >
      {isVideo ? (
        <video src={item.srcUrl} className={`absolute inset-0 w-full h-full ${fitClass}`} muted playsInline />
      ) : framed ? (
        <>
          {/* Same transform the compositor bakes — WYSIWYG. */}
          <img
            src={item.srcUrl}
            alt=""
            draggable={false}
            className="select-none"
            style={cropImageStyle(item.crop, item.naturalW ?? 1080, item.naturalH ?? 1920)}
          />
          <img src={frameUrl!} alt="" aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" />
        </>
      ) : (
        <img src={item.srcUrl} alt="" className={`absolute inset-0 w-full h-full ${fitClass}`} draggable={false} />
      )}
    </div>
  );
}
