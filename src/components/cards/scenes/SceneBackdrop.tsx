/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SceneBackdrop — the design's scene, kept behind the card while it is read.
 *
 * The opening ends on this exact composition (scene at scale 1, cut-outs
 * home), so the hand-off has nothing to jump. From then on the layers drift
 * with the reader: whatever scrolls inside the card moves the scene a little
 * (lib/cardDesigns.ts sceneParallax; the foreground cut-outs now hang in front
 * of the page, in CardExperience), and
 * a pointer — or, on a phone, a very slow idle sway — tilts the depth.
 * A scrim in the design's own colour keeps every template legible on top.
 *
 * Reduced motion: scroll parallax at half travel, no sway, fewer particles.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { designAssets, sceneParallax, type CardDesign } from '../../../lib/cardDesigns';
import MotifLayer from './MotifLayer';
import SceneLife from './SceneLife';

export interface SceneBackdropProps {
  design: CardDesign;
  /** 0..1 — how far the reader is through whatever scrolls in the card. */
  scrollRef: MutableRefObject<number>;
  reducedMotion: boolean;
  seed: string;
  /**
   * False while the opening still plays on top. The backdrop then holds the
   * opener's final composition exactly (scale 1, no drift, no scrim), and
   * eases into its reading pose once the card arrives — so the hand-off has
   * no crop jump and no scrim pop. Absent = arrived (no opening).
   */
  arrived?: boolean;
}

/** How long the scene takes to settle into its reading pose after the opening. */
const ARRIVE_MS = 2400;
/** Reading-pose zoom: the headroom the parallax drift needs so no edge shows. */
const READ_SCALE = 1.16;

export default function SceneBackdrop({ design, scrollRef, reducedMotion, seed, arrived = true }: SceneBackdropProps) {
  const assets = useMemo(() => designAssets(design.id), [design.id]);
  const backRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const arrivedRef = useRef(arrived);
  arrivedRef.current = arrived;

  useEffect(() => {
    let raf = 0;
    let px = 0;
    let py = 0;
    let usedPointer = false;
    // Smoothed values, so the scene glides rather than snaps.
    const cur = { s: scrollRef.current, x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      usedPointer = true;
      px = (e.clientX / window.innerWidth) * 2 - 1;
      py = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const start = performance.now();
    // 0 = the opener's last frame, 1 = the reading pose. Already arrived on
    // mount (no opening) means no ramp at all.
    let a = arrivedRef.current ? 1 : 0;
    let arrivedAt = arrivedRef.current ? -Infinity : 0;
    const tick = (now: number) => {
      if (!arrivedRef.current) {
        // The opening is on top: hold still and spend nothing per frame.
        a = 0;
        arrivedAt = 0;
        if (backRef.current) backRef.current.style.transform = 'none';
        if (scrimRef.current) scrimRef.current.style.opacity = '0';
        raf = requestAnimationFrame(tick);
        return;
      }
      if (arrivedAt === 0) arrivedAt = now;
      if (a < 1) {
        const p = Math.min(1, (now - arrivedAt) / ARRIVE_MS);
        a = p * p * p * (p * (p * 6 - 15) + 10); // smootherstep: no kick at the start, no bump at the end
      }
      const t = (now - start) / 1000;
      const tx = usedPointer ? px : Math.sin(t * 0.21) * 0.6;
      const ty = usedPointer ? py : Math.cos(t * 0.17) * 0.4;
      cur.s += (scrollRef.current - cur.s) * 0.08;
      cur.x += (tx - cur.x) * 0.05;
      cur.y += (ty - cur.y) * 0.05;
      const o = sceneParallax(cur.s, cur.x, cur.y, reducedMotion);
      const zoom = 1 + (READ_SCALE - 1) * a;
      if (backRef.current) backRef.current.style.transform = `translate3d(${o.backX * a}%, ${o.backY * a}%, 0) scale(${zoom.toFixed(4)})`;
      if (scrimRef.current && a < 1) scrimRef.current.style.opacity = a.toFixed(3);
      else if (scrimRef.current && scrimRef.current.style.opacity !== '1') scrimRef.current.style.opacity = '1';
      raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [scrollRef, reducedMotion]);

  const bg = design.palette.bg;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ backgroundColor: bg }} data-scene-backdrop={design.id}>
      {/* Wide screens: the scene, blurred, fills the sides; the sharp scene
          stays a portrait column so it is never blown up to desktop width. */}
      <img
        src={assets.back}
        alt=""
        draggable={false}
        className="absolute inset-0 hidden h-full w-full scale-110 object-cover opacity-55 blur-2xl sm:block"
      />
      <div className="absolute inset-0 mx-auto aspect-[9/16] h-full max-w-full overflow-hidden">
        <div ref={backRef} className="absolute inset-0 will-change-transform" style={{ transformOrigin: '50% 55%' }}>
          <img src={assets.back} alt="" draggable={false} className="h-full w-full object-cover" />
          <SceneLife design={design} reducedMotion={reducedMotion} />
        </div>
      </div>
      {/* Scrim in the design's own colour: lighter at the top so the scene
          reads, deeper where the messages sit. */}
      <div
        ref={scrimRef}
        className="absolute inset-0"
        style={{ opacity: arrived ? 1 : 0, background: `linear-gradient(180deg, ${bg}59 0%, ${bg}8C 45%, ${bg}C7 100%)` }}
      />
      <MotifLayer
        kind={design.motif.kind}
        colors={design.motif.colors}
        seed={seed}
        reducedMotion={reducedMotion}
        density={0.55}
        intensity={arrived ? 1 : 0}
      />
    </div>
  );
}
