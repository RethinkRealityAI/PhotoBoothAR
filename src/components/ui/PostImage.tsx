/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A wall/gallery photo served at roughly the size it is shown at.
 *
 * Every tile used to render the untouched 1080×1920 capture, so a guest opening
 * a busy wall pulled dozens of full-resolution JPEGs onto a phone over venue
 * wifi to display them a couple of hundred pixels wide.
 *
 * Two independent savings, deliberately not dependent on each other:
 *
 *  1. `loading="lazy"` + `decoding="async"`. Free, universal, and on a long wall
 *     the bigger win of the two — off-screen tiles are never fetched at all.
 *  2. A Supabase Storage resize URL, when the URL is one we recognise. Image
 *     transformation is a paid plan feature and this could not be verified from
 *     the build sandbox, so the FIRST error swaps to the original and the tile
 *     renders exactly as it did before. Being wrong costs one failed request per
 *     image, never a broken wall.
 *
 * Videos are passed through untouched — the image transformer does not handle
 * them, and `transformedUrl` already refuses them.
 */
import { useEffect, useState } from 'react';
import { pixelWidth, transformedUrl } from '../../lib/mediaUrl';
import { useOptionalEvent } from '../../events/EventContext';

/** Legacy single-event builds keep their shipped URLs byte-for-byte. */
const IS_LEGACY_BUILD = (((import.meta.env.VITE_EVENT as string | undefined) ?? '')).trim() !== '';

export interface PostImageProps {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  /** Roughly how wide this renders, in CSS px. Used to pick the fetched size. */
  displayWidth: number;
  /** Above-the-fold tiles should not be lazy — it delays the first paint. */
  eager?: boolean;
  draggable?: boolean;
  onClick?: () => void;
}

export default function PostImage({
  src, alt, className, style, displayWidth, eager = false, draggable, onClick,
}: PostImageProps) {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  // `resize=cover` with only a width keeps the ORIGINAL height: a 1080×1920
  // capture asked for at 720 wide came back 720×1920 (sides cropped, aspect
  // 0.375), and the 9:16 tile then cover-cropped its top and bottom — frame
  // art along the bottom edge vanished on the wall. `contain` with only a
  // width scales the whole photo (720×1280). Platform events only; legacy
  // builds and coded events keep the URL they shipped with.
  const event = useOptionalEvent();
  const platform = event?.source === 'db' && !IS_LEGACY_BUILD;
  const optimized = transformedUrl(src, { width: pixelWidth(displayWidth, dpr), resize: platform ? 'contain' : 'cover' });
  // `failed` is keyed on src: a re-used component instance showing a DIFFERENT
  // photo must get a fresh attempt, or one bad image would permanently downgrade
  // every later one that lands in the same slot.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => { setFailedSrc(null); }, [src]);

  const useOriginal = !optimized || failedSrc === src;

  return (
    <img
      src={useOriginal ? src : optimized}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={draggable}
      onClick={onClick}
      onError={() => { if (!useOriginal) setFailedSrc(src); }}
      className={className}
      style={style}
    />
  );
}
