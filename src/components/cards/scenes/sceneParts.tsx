/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared pieces of the design scenes: the portrait stage, the mirrored
 * foreground cut-outs and image preloading (the iris shape lives in the pure
 * lib/cardDesigns.ts, shared with the film intro). Used by
 * SceneOpener (the opening) and SceneBackdrop (behind the reading card).
 */
import type { HTMLAttributes, ReactNode } from 'react';
import type { CardDesign } from '../../../lib/cardDesigns';

/**
 * A portrait (9:16) stage: edge to edge on a phone, a centred column on a
 * wide screen with the scene itself, softly blurred, filling the sides — so
 * a desktop recipient never sees a stretched or letterboxed-in-black scene.
 */
export function SceneStage({
  design,
  backUrl,
  children,
  ...rest
}: { design: CardDesign; backUrl: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: design.palette.bg }} {...rest}>
      <img
        src={backUrl}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 hidden h-full w-full scale-110 object-cover opacity-55 blur-2xl sm:block"
      />
      <div className="relative mx-auto aspect-[9/16] h-full max-w-full overflow-hidden sm:shadow-[0_0_120px_-20px_rgba(0,0,0,0.7)]">
        {children}
      </div>
    </div>
  );
}

/**
 * The design's foreground cut-out, twice: one per corner, the right one
 * mirrored, hanging just past the edge like the front layer of a paper
 * diorama. Positioned in % of its layer so the parent's transforms move it.
 */
export function MidPair({ src, design }: { src: string; design: CardDesign }) {
  const size = `${design.mid.size * 100}%`;
  const top = design.mid.placement === 'top';
  const common = 'absolute select-none object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.45)]';
  const v = top ? { top: '-3%' } : { bottom: '-4%' };
  return (
    <>
      <img src={src} alt="" aria-hidden draggable={false} className={common} style={{ ...v, left: '-9%', width: size }} />
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        className={common}
        style={{ ...v, right: '-9%', width: size, transform: 'scaleX(-1)' }}
      />
    </>
  );
}

/**
 * Resolves once every image has decoded, failed, or `timeoutMs` passed —
 * never rejects. The opening must start even on a slow venue connection; a
 * missing layer just shows the palette colour.
 */
export function decodeImages(urls: readonly string[], timeoutMs: number): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  const each = urls.map(
    (src) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        if (typeof img.decode === 'function') {
          img.decode().then(() => resolve(), () => resolve());
        } else {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }
      }),
  );
  return Promise.race([
    Promise.all(each).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}
