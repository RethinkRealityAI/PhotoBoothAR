/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * framePreview — the single source of truth for how an uploaded image is
 * positioned inside a frame, expressed as a CSS style. Both the interactive
 * CropStage and the static thumbnails (FramedThumb) render through this helper,
 * and it mirrors `compositeUpload`'s canvas math exactly — so every preview,
 * every thumbnail, and the final image baked to the wall are pixel-for-pixel
 * the same. What you see is what you get.
 *
 * The trick: position the image with *percentages* of the (fixed 9:16) frame
 * box. Because the preview box and the compositing canvas share the 9:16 aspect
 * of FRAME_W×FRAME_H, a percentage layout is exact at any on-screen size — no
 * measuring, no sub-pixel rounding, no distortion.
 */
import type { CSSProperties } from 'react';
import { computeCropRect, FRAME_W, FRAME_H, UploadCrop } from '../booth/capture';

/**
 * Absolute-position style for the `<img>` inside a 9:16 frame box, reproducing
 * `compositeUpload`'s cover-fit + zoom + pan + quarter-turn rotation.
 */
export function cropImageStyle(
  crop: UploadCrop,
  imgW: number,
  imgH: number,
): CSSProperties {
  const r = computeCropRect(
    imgW || 1,
    imgH || 1,
    FRAME_W,
    FRAME_H,
    crop.zoom,
    crop.offsetX,
    crop.offsetY,
    crop.rotation,
  );
  return {
    position: 'absolute',
    left: `${(r.x / FRAME_W) * 100}%`,
    top: `${(r.y / FRAME_H) * 100}%`,
    width: `${(r.w / FRAME_W) * 100}%`,
    height: `${(r.h / FRAME_H) * 100}%`,
    transform: crop.rotation ? `rotate(${crop.rotation}deg)` : undefined,
    transformOrigin: 'center center',
  };
}
