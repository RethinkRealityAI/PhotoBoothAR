/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A frame-pack thumbnail on a chequerboard.
 *
 * The single most important fact about a frame is that its middle is NOT
 * there. The thumbs used to be flattened onto the page's own near-black, which
 * meant the window rendered as a black rectangle — indistinguishable from black
 * artwork, and on the deco and midnight designs invisible entirely. The webp
 * files now carry real alpha (scripts/key-guide-frames.mjs), and this paints
 * the universal "nothing here" chequerboard behind them.
 *
 * Kept deliberately low-contrast: it has to read as transparency at a glance
 * without competing with the artwork it sits under.
 *
 * `children` is where the download gallery hangs its measured face window.
 */
import type { CSSProperties, ReactNode } from 'react';
import { frameThumb } from '../../lib/guidesMedia';
import type { FramePackId } from '../../lib/guidesContent';

const CELL = 14;
const TINT = 'rgba(255,255,255,0.055)';

const CHEQUER: CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.028)',
  backgroundImage: `linear-gradient(45deg, ${TINT} 25%, transparent 25%, transparent 75%, ${TINT} 75%), linear-gradient(45deg, ${TINT} 25%, transparent 25%, transparent 75%, ${TINT} 75%)`,
  backgroundSize: `${CELL * 2}px ${CELL * 2}px`,
  backgroundPosition: `0 0, ${CELL}px ${CELL}px`,
};

export default function FrameThumb({
  id,
  alt,
  className = '',
  children,
}: {
  id: FramePackId;
  alt: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={`relative block aspect-[9/16] w-full overflow-hidden ${className}`}
      style={CHEQUER}
    >
      <img
        src={frameThumb(id)}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      {children}
    </span>
  );
}
