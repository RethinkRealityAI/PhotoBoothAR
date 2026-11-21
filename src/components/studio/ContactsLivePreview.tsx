/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ContactsLivePreview — the contacts builder's "Live camera" tab: the look in
 * progress on the host's own eyes, through the booth's pipeline (StageCanvas
 * compositing an Overlay3D), so it is what a guest's photo will show.
 *
 * Opens NO camera: it reads the studio's one persistent <video id="studio-video">
 * (StudioShell keeps that stream alive in every mode). Only the scene's face
 * layer is drawn (face paint, if any, plus the lenses) — the rest of the scene
 * stays on the stage behind the dialog.
 *
 * Lazily loaded by ContactsBuilder, so the Example tab never mounts a canvas.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import StageCanvas from '../booth/StageCanvas';
import Overlay3D from '../booth/Overlay3D';
import { getActiveFaceEngineInfo, subscribeFaceEngine } from '../../lib/faceEngine';
import { objectToPiece } from '../../lib/studio/draftMapping';
import type { Object3D } from '../../lib/studio/state';

const STUDIO_VIDEO_ID = 'studio-video';
/** Its own wrapper id: the stage behind the dialog may hold a 'booth-3d-layer'. */
const LAYER_ID = 'contacts-live-3d-layer';

/** What the pane says instead of (or over) the picture; null when the lenses are on a found face. */
function contactsLiveStatus(s: {
  camReady: boolean; trackerFailed: boolean; trackerReady: boolean; lensesUnavailable: boolean; faceVisible: boolean;
}): string | null {
  if (!s.camReady) return 'Waiting for your camera. Allow camera access to see the lenses on you.';
  if (s.trackerFailed) return 'The face tracker could not start here. The Example tab still shows your look.';
  if (s.lensesUnavailable) return 'This device cannot run the tracker the lenses need. The Example tab still shows your look.';
  if (!s.trackerReady) return 'Loading the face tracker…';
  if (!s.faceVisible) return 'Bring your face into the picture';
  return null;
}

export default function ContactsLivePreview({ layer }: { layer: Object3D }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [camReady, setCamReady] = useState(false);
  const [faceVisible, setFaceVisible] = useState(false);
  const faceInfo = useSyncExternalStore(subscribeFaceEngine, getActiveFaceEngineInfo, getActiveFaceEngineInfo);

  // The studio's video is mounted long before any Power-Up can open; its stream
  // may still be starting (or be denied), so readiness is polled, not assumed.
  useEffect(() => {
    const check = () => {
      const v = document.getElementById(STUDIO_VIDEO_ID);
      videoRef.current = v instanceof HTMLVideoElement ? v : null;
      setCamReady(videoRef.current !== null && videoRef.current.srcObject !== null && videoRef.current.readyState >= 2);
    };
    check();
    const t = window.setInterval(check, 500);
    return () => window.clearInterval(t);
  }, []);

  const pieces = useMemo(() => [objectToPiece(layer, { occlusionEnabled: false })], [layer]);
  const status = contactsLiveStatus({
    camReady,
    trackerFailed: faceInfo.failed,
    trackerReady: faceInfo.ready,
    lensesUnavailable: faceInfo.active === 'mediapipe' && (faceInfo.fellBack || faceInfo.requested === 'mediapipe'),
    faceVisible,
  });

  return (
    <div className="relative w-full h-full" data-testid="contacts-live">
      {camReady && (
        // The composite is 9:16; the pane is 3:4 and shows its middle, so the
        // face (and the eyes being edited) reads larger.
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 aspect-[9/16]">
          <StageCanvas
            videoRef={videoRef}
            effectId="none"
            mirror
            overlays={null}
            threeCanvasId={LAYER_ID}
            frameLock
            active
            watermark={false}
          />
          <div className="absolute inset-0">
            <Overlay3D
              pieces={pieces}
              anchor={pieces[0].anchor}
              videoId={STUDIO_VIDEO_ID}
              mirror
              headScale={1}
              onFaceVisible={setFaceVisible}
              composited
              // A small pane: a full-density buffer here only competes with the
              // tracker (and with the stage still running behind the dialog).
              dpr={1}
              layerId={LAYER_ID}
            />
          </div>
        </div>
      )}
      {status !== null && (
        <p
          role="status"
          className={`absolute inset-x-3 font-sans text-[11px] leading-snug text-center text-white rounded-xl bg-black/55 backdrop-blur-sm px-3 py-2 ${
            camReady && faceInfo.ready && !faceInfo.failed ? 'bottom-3' : 'top-1/2 -translate-y-1/2'
          }`}
        >
          {status}
        </p>
      )}
    </div>
  );
}
