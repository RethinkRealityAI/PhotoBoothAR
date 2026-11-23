/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LiveGate — a gateway drawn piece by piece (lib/liveGates.ts), so each
 * balloon lets go on its own and the velvet curtains gather fold by fold.
 *
 * The opener writes its timeline position into `tRef` (and the held seal into
 * `chargeRef`); one rAF loop here reads them and writes each piece's pose
 * straight to the DOM. Idle life (balloons bob, velvet ripples) runs while
 * the gate waits; reduced motion keeps it still.
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import {
  curtainSvg,
  liveBaseOpacity,
  liveDefs,
  livePieces,
  livePose,
  valanceSvg,
  type LiveGateKind,
} from '../../../lib/liveGates';

export interface LiveGateProps {
  kind: LiveGateKind;
  seed: string;
  tRef: MutableRefObject<number>;
  chargeRef: MutableRefObject<number>;
  reducedMotion: boolean;
  hidden?: boolean;
  /** Pop party: piece key → when it was popped (performance.now ms). */
  poppedRef?: MutableRefObject<Map<string, number>>;
  /** Leave out the wall behind the balloons, so popped ones show the party. */
  noBase?: boolean;
}

/** How long a popped balloon takes to burst away. */
const POP_MS = 170;

export default function LiveGate({ kind, seed, tRef, chargeRef, reducedMotion, hidden, poppedRef, noBase }: LiveGateProps) {
  const pieces = useMemo(() => livePieces(kind, seed), [kind, seed]);
  const groupRefs = useRef<Record<string, SVGGElement | null>>({});
  const baseRef = useRef<SVGRectElement | null>(null);
  const defs = useMemo(() => liveDefs(kind), [kind]);
  const valance = useMemo(() => (kind === 'curtains' ? valanceSvg() : ''), [kind]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = tRef.current;
      const timeS = (now - start) / 1000;
      for (const p of pieces) {
        const el = groupRefs.current[p.key];
        if (!el) continue;
        const popped = poppedRef?.current.get(p.key);
        if (popped !== undefined) {
          // A pop: a quick swell and gone.
          const age = Math.min(1, (now - popped) / POP_MS);
          if (age >= 1) {
            if (el.style.display !== 'none') el.style.display = 'none';
            continue;
          }
          const q = livePose(kind, p, t, 0, timeS, reducedMotion);
          el.setAttribute('transform', `${q.transform} scale(${(1 + 0.4 * age).toFixed(3)})`);
          el.setAttribute('opacity', (1 - age).toFixed(3));
          continue;
        }
        const q = livePose(kind, p, t, chargeRef.current, timeS, reducedMotion);
        if (q.d !== undefined) {
          for (const path of Array.from(el.querySelectorAll('path'))) path.setAttribute('d', q.d);
        } else {
          el.setAttribute('transform', q.transform);
        }
      }
      if (baseRef.current) baseRef.current.setAttribute('opacity', String(liveBaseOpacity(kind, t)));
      // Past the opening the gate is gone: stop drawing it.
      if (t < 0.75) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [kind, pieces, tRef, chargeRef, reducedMotion, poppedRef]);

  return (
    <svg
      aria-hidden
      viewBox="0 0 900 1600"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ visibility: hidden ? 'hidden' : undefined }}
      data-live-gate={kind}
    >
      <defs dangerouslySetInnerHTML={{ __html: defs }} />
      {kind === 'balloons' && !noBase && <rect ref={baseRef} width="900" height="1600" fill="#FBE7D6" />}
      {pieces.map((p) => {
        const q = livePose(kind, p, 0, 0, 0, true);
        if (kind === 'curtains' && p.key !== 'valance') {
          return (
            <g
              key={p.key}
              ref={(el) => {
                groupRefs.current[p.key] = el;
              }}
              dangerouslySetInnerHTML={{ __html: curtainSvg(q.d ?? '') }}
            />
          );
        }
        return (
          <g
            key={p.key}
            ref={(el) => {
              groupRefs.current[p.key] = el;
            }}
            transform={q.transform}
            dangerouslySetInnerHTML={{ __html: p.key === 'valance' ? valance : p.body }}
          />
        );
      })}
    </svg>
  );
}
