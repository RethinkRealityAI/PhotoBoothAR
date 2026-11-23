/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scales a fixed-size stage (a 390×844 phone, a 600px email) down to fit the
 * box it sits in, never up. Two fits:
 *
 *   contain  the whole stage is visible (a phone frame)
 *   width    the stage fills the width; its height grows to fill the box, so
 *            a long document (an email) scrolls inside its own iframe
 *
 * The child is rendered at its real size and scaled with a transform, so an
 * iframe inside it lays out exactly as it would on the device.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export default function FitFrame({ width, height, fit = 'contain', align = 'center', children }: {
  /** The stage's real size in CSS px. `height` is ignored for fit="width". */
  width: number;
  height?: number;
  fit?: 'contain' | 'width';
  align?: 'center' | 'top';
  /** Receives the stage's laid-out height (for fit="width" it grows with the box). */
  children: (stage: { width: number; height: number; scale: number }) => ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let scale = 1;
  let stageH = height ?? 0;
  if (size !== null && size.w > 0 && size.h > 0) {
    if (fit === 'width') {
      scale = Math.min(1, size.w / width);
      stageH = Math.max(1, Math.floor(size.h / scale));
    } else {
      scale = Math.min(1, size.w / width, size.h / Math.max(1, height ?? 1));
    }
  }
  const outerW = Math.round(width * scale);
  const outerH = Math.round(stageH * scale);

  return (
    <div ref={box} className={`relative h-full w-full min-h-0 overflow-hidden flex justify-center ${align === 'top' || fit === 'width' ? 'items-start' : 'items-center'}`}>
      {size !== null && (
        <div style={{ width: outerW, height: outerH }} className="relative shrink-0">
          <div style={{ width, height: stageH, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="absolute left-0 top-0">
            {children({ width, height: stageH, scale })}
          </div>
        </div>
      )}
    </div>
  );
}
