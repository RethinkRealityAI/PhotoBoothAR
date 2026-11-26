/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The try-on stage for the Looks and Power-ups steps.
 *
 *   Camera on  — the host's own face through the EXACT booth pipeline
 *                (StudioPreview: StageCanvas + Overlay3D), so what they see
 *                is what a guest captures.
 *   Camera off — a 3D reference head wearing the props (the studio's orbit
 *                view in showcase mode). Its canvas is streamed into a video
 *                (`captureStream`) and run through the same StageCanvas, so
 *                the frame and the effect sit on the head exactly as they
 *                sit on a face. Drag to turn the head.
 *
 * Either way the stage publishes its video to the live effect thumbnails
 * (filterThumbEngine), so the Effects shelf shows each effect on whoever is
 * on stage.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Camera, CameraOff, Loader2, RotateCw } from 'lucide-react';
import StudioPreview from '../../../components/studio/StudioPreview';
import Studio3DView from '../../../components/studio/Studio3DView';
import StageCanvas, { type StageOverlaySpec } from '../../../components/booth/StageCanvas';
import { useCameraStream } from '../../../components/booth/useCameraStream';
import { setThumbSource } from '../../../components/booth/filterThumbEngine';
import type { Object3D, Overlay2D, StudioDraft } from '../../../lib/studio/state';
import { introFieldsOf } from '../../../lib/studio/animation';

const HEAD_CANVAS_ID = 'wz-head-canvas';
const NOOP = () => {};

function CameraStage({ draft, onFail }: { draft: StudioDraft; onFail: () => void }) {
  const cam = useCameraStream(true);
  useEffect(() => { if (cam.error) onFail(); }, [cam.error, onFail]);
  useEffect(() => {
    setThumbSource(cam.ready ? cam.videoRef.current : null, cam.ready, true);
    return () => setThumbSource(null, false, true);
  }, [cam.ready, cam.videoRef]);
  return (
    <>
      <video
        id="wz-cam"
        ref={cam.videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover opacity-0 pointer-events-none"
      />
      {cam.ready ? (
        <StudioPreview videoRef={cam.videoRef} draft={draft} headScale={1} occlusionEnabled />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-white/80">
          <Loader2 className="h-6 w-6 animate-spin" aria-label="Starting your camera" />
        </div>
      )}
    </>
  );
}

function HeadStage({ draft }: { draft: StudioDraft }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streaming, setStreaming] = useState(false);
  const objects = useMemo(() => draft.objects.filter((o): o is Object3D => o.type !== 'overlay'), [draft.objects]);
  const overlays: StageOverlaySpec[] = useMemo(() => draft.objects
    .filter((o): o is Overlay2D => o.type === 'overlay' && !!o.url && o.hidden !== true)
    .map((o) => ({ url: o.url as string, transform: o.transform, opacity: 1, animation: o.animation, ...introFieldsOf(o) })), [draft.objects]);
  // Stream the head canvas into a video once R3F has made it.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let tries = 0;
    const id = window.setInterval(() => {
      const canvas = document.getElementById(HEAD_CANVAS_ID) as HTMLCanvasElement | null;
      const video = videoRef.current;
      tries++;
      if (canvas && video && typeof canvas.captureStream === 'function') {
        window.clearInterval(id);
        stream = canvas.captureStream(30);
        video.srcObject = stream;
        void video.play().catch(() => {});
        video.onplaying = () => {
          setStreaming(true);
          setThumbSource(video, true, false);
        };
      } else if (tries > 100) {
        window.clearInterval(id);
      }
    }, 100);
    return () => {
      window.clearInterval(id);
      stream?.getTracks().forEach((t) => t.stop());
      setThumbSource(null, false, false);
    };
  }, []);

  return (
    <>
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full opacity-0 pointer-events-none" />
      {streaming && (
        <div className="absolute inset-0">
          <StageCanvas
            videoRef={videoRef}
            effectId={draft.shaderId}
            mirror={false}
            overlays={overlays.length > 0 ? overlays : null}
            introKey={overlays.map((o) => `${o.intro ?? ''}${o.introDelayMs ?? 0}`).join('|')}
            active
            watermark={false}
          />
        </div>
      )}
      {/* The head itself, on top but invisible once the composite is up: it
          still takes the drag that turns the head. */}
      <div className="absolute inset-0" style={{ opacity: streaming ? 0 : 1 }}>
        <Studio3DView
          view="orbit"
          videoId="wz-none"
          objects={objects}
          selectedId={null}
          holdPose={false}
          headScale={1}
          onSelect={NOOP}
          onAnchorSelect={NOOP}
          onTransformChange={NOOP}
          showcase={{ canvasId: HEAD_CANVAS_ID, background: '#4A47B0' }}
        />
      </div>
    </>
  );
}

export default function LookStage({ draft, caption, children }: {
  draft: StudioDraft;
  /** What is on right now ("Gold frame · Crown"). */
  caption?: string;
  /** Extra overlay (e.g. a power-up hint). */
  children?: ReactNode;
}) {
  const [camera, setCamera] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const fail = useMemo(() => () => { setCameraFailed(true); setCamera(false); }, []);
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Desktop: the step's preview column is fitted to the height, so the
          stage simply fills its width. */}
      <div className="wz-stage w-[min(100%,220px)] sm:w-[min(100%,320px)] lg:w-full [touch-action:pan-y]">
        {camera ? <CameraStage draft={draft} onFail={fail} /> : <HeadStage draft={draft} />}
        <div className="absolute top-3 inset-x-3 flex items-start justify-between gap-2 pointer-events-none">
          {caption ? (
            <span className="max-w-[70%] truncate rounded-full bg-[rgba(15,13,51,0.55)] px-3 py-1.5 text-[12.5px] font-medium backdrop-blur">{caption}</span>
          ) : <span />}
          {!camera && <span className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 rounded-full bg-[rgba(15,13,51,0.45)] px-2.5 py-1.5 text-[11.5px] text-white/85 backdrop-blur"><RotateCw className="h-3 w-3" aria-hidden /> Drag to turn</span>}
        </div>
        {children}
      </div>
      <button
        type="button"
        onClick={() => { setCameraFailed(false); setCamera((c) => !c); }}
        className="pressable liquid-glass-raised inline-flex items-center gap-2 rounded-full px-4 min-h-11 text-[14px] font-medium"
      >
        {camera ? <CameraOff className="h-4 w-4" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
        {camera ? 'Use the 3D head' : 'Try it on with my camera'}
      </button>
      {cameraFailed && <p className="text-[12.5px] text-[#FFD2DA] text-center">We couldn’t start your camera, so here’s the 3D head. Check your browser’s camera permission to try again.</p>}
    </div>
  );
}
