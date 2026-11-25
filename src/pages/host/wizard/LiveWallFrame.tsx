/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LiveWallFrame: the REAL live wall (/e/:slug/wall?preview=1) in an iframe,
 * laid out at a projector's 1440×900 and scaled to fit the card. The host's
 * unsaved design is posted in on every change, and `beamSignal` beams a
 * sample photo in with the chosen arrival effect. Contract: lib/wallPreview.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { WALL_PREVIEW_READY, type PreviewSettings, type WallPreviewMessage } from '../../../lib/wallPreview';

const DESIGN_W = 1440;
const DESIGN_H = 900;

interface Props {
  slug: string;
  settings: Partial<PreviewSettings>;
  /** Bump to beam one sample photo in. */
  beamSignal: number;
}

export default function LiveWallFrame({ slug, settings, beamSignal }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.4);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const measure = () => setScale((el.clientWidth || 600) / DESIGN_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const send = useCallback((msg: WallPreviewMessage) => {
    frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  // The wall says when its listener is up; anything sent before is lost.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === WALL_PREVIEW_READY) setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (ready) send({ type: 'beamwall:wall-preview:settings', settings });
  }, [ready, settings, send]);

  const lastBeam = useRef(beamSignal);
  useEffect(() => {
    if (beamSignal === lastBeam.current) return;
    lastBeam.current = beamSignal;
    if (ready) send({ type: 'beamwall:wall-preview:beam' });
  }, [beamSignal, ready, send]);

  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-[22px] bg-[#0d0c2a]"
      style={{
        aspectRatio: `${DESIGN_W} / ${DESIGN_H}`,
        boxShadow: 'var(--wz-halo, 0 0 #0000), 0 30px 60px -30px rgba(6,5,26,0.85), inset 0 0 0 1px rgba(255,255,255,0.14)',
      }}
    >
      <iframe
        ref={frame}
        src={`/e/${encodeURIComponent(slug)}/wall?preview=1`}
        title="Live preview of your live wall"
        className="absolute left-0 top-0 border-0"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          opacity: ready ? 1 : 0,
          transition: 'opacity 400ms ease',
        }}
        // Its own storage and scripts are this site's; no top navigation.
        sandbox="allow-scripts allow-same-origin"
      />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-white/75">
          <span className="flex items-center gap-2 text-[13.5px]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your live wall…
          </span>
        </div>
      )}
    </div>
  );
}
