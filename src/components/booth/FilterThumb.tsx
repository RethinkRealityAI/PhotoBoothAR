/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One live filter thumbnail — the guest's own face, through THIS filter.
 *
 * Renders `children` (the existing static gradient swatch) underneath and
 * cross-fades a tiny live canvas over it once the shared engine has actually
 * painted a frame. That ordering is the whole degradation story: if WebGL is
 * missing, the camera is off, the tab is hidden or the guest prefers reduced
 * motion, `onPaint` never fires, the canvas stays at opacity 0 and the orb is
 * exactly what it was before this component existed.
 *
 * The canvas itself is 96x96 and shared-engine-driven; see filterThumbEngine.
 * The parent must be `relative` + `overflow-hidden`, which every orb already is.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { registerThumbTarget } from './filterThumbEngine';

export default function FilterThumb({
  shaderId, children,
}: {
  /** Shader to preview. `'none'` previews the untouched camera, which is what
   *  a "Clear"/"None" option honestly means. */
  shaderId: string;
  /** Static fallback, rendered underneath and never removed. */
  children: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    setLive(false);
    return registerThumbTarget(shaderId, el, () => setLive(true));
  }, [shaderId]);

  return (
    <>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        style={{
          opacity: live ? 1 : 0,
          transition: reduced ? 'none' : 'opacity 320ms ease-out',
        }}
      />
    </>
  );
}
