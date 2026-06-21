/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaIcons — a small set of on-theme, line-art SVG icons for the gala media
 * portal. Elegant champagne-gold strokes, a single consistent stroke-width, and
 * a uniform `size` prop so they sit cleanly in buttons, badges and empty states.
 *
 * Defaults inherit `currentColor` so an icon picks up the surrounding text color
 * (e.g. `text-noir-900` on a gold button, or `text-gold-300` on glass). Pass an
 * explicit `color` to override.
 */
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'color'> {
  /** Pixel size for both width and height. */
  size?: number;
  /** Stroke/fill color. Defaults to `currentColor`. */
  color?: string;
  /** Stroke width in viewBox units (24-grid). */
  strokeWidth?: number;
}

/** Shared base: 24-unit grid, rounded caps/joins, no fill, stroke = currentColor. */
function IconBase({
  size = 20,
  color = 'currentColor',
  strokeWidth = 1.6,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Camera body with lens — empty-state / booth call-to-action. */
export function CameraIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.7a1 1 0 0 1 .84-.45h6.72a1 1 0 0 1 .84.45L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </IconBase>
  );
}

/** Framed photo with sun + mountain — image media. */
export function PhotoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 16.5l4.2-4a1.4 1.4 0 0 1 1.9 0l3.4 3.2M14 14l1.7-1.6a1.4 1.4 0 0 1 1.9 0L20.5 15" />
    </IconBase>
  );
}

/** Movie clapper-board feel via a film frame — video media. */
export function VideoIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.4" />
      <path d="M10 9.2l4.5 2.8L10 14.8z" />
    </IconBase>
  );
}

/** Play triangle inside a ring — kept in the same family as the grid PlayBadge. */
export function PlayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5 3.5-5 3.5z" />
    </IconBase>
  );
}

/** Down-tray download — per-item & download-all. */
export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.5v10.5" />
      <path d="M8 10.5l4 4 4-4" />
      <path d="M4.5 17v1.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V17" />
    </IconBase>
  );
}

/** Share node graph — three dots joined, premium take on the share glyph. */
export function ShareIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="6.5" cy="12" r="2.3" />
      <circle cx="17" cy="6" r="2.3" />
      <circle cx="17" cy="18" r="2.3" />
      <path d="M8.6 10.9l6.3-3.6M8.6 13.1l6.3 3.6" />
    </IconBase>
  );
}

/** Expand / enlarge corners — tap-to-view affordance. */
export function ExpandIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 4.5H5.5A1.5 1.5 0 0 0 4 6v3.5" />
      <path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v3.5" />
      <path d="M9 19.5H5.5A1.5 1.5 0 0 1 4 18v-3.5" />
      <path d="M15 19.5h3.5A1.5 1.5 0 0 0 20 18v-3.5" />
    </IconBase>
  );
}

/** Close / dismiss — lightbox. */
export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </IconBase>
  );
}

/** Left chevron — back to the booth. */
export function BackIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </IconBase>
  );
}

/** 2×2 grid of frames — the live photo wall. */
export function GalleryIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </IconBase>
  );
}

/** Two stacked photo frames — your saved media. */
export function MediaStackIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="7" y="3.5" width="13.5" height="10.5" rx="1.8" />
      <rect x="3.5" y="8" width="13.5" height="12.5" rx="1.8" />
      <circle cx="7.6" cy="12.2" r="1.3" />
      <path d="M4 18.5l3-2.7a1.3 1.3 0 0 1 1.8 0l3.2 3" />
    </IconBase>
  );
}
