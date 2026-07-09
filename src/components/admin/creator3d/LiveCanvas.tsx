/**
 * Live-preview mode: mirrored camera feed as an HTML <video> with an R3F
 * overlay using the shared <FaceRig> component — identical to the booth, so
 * what you place is what guests see. The all-in-one gizmo is available here too
 * (it auto-freezes tracking while you drag so adjustments are stable).
 */
import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { RIG_CAMERA } from '../../../lib/faceRig';
import { FaceRig, Model } from '../../ar/FaceRig';
import { HeadPiece, isHeadPiece } from '../../ar/HeadPieces';
import { initializeFaceLandmarker } from '../../../lib/faceTracking';
import { AnchorConfig, HeadAnchor } from '../../../types';

const VIDEO_ID = 'creator3d-video';

interface Props {
  assetUrl: string | null;
  proceduralId?: string | null;
  anchor: HeadAnchor;
  anchorConfig: Partial<AnchorConfig>;
  paused: boolean;
  gizmo?: boolean;
  onFaceVisible: (v: boolean) => void;
  onTransformChange?: (patch: Partial<AnchorConfig>) => void;
}

export default function LiveCanvas({
  assetUrl,
  proceduralId,
  anchor,
  anchorConfig,
  paused,
  gizmo = true,
  onFaceVisible,
  onTransformChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [trackerReady, setTrackerReady] = useState(false);
  const [dragging, setDragging] = useState(false);

  const hasAsset = !!assetUrl || isHeadPiece(proceduralId);

  // Start camera + face tracker
  useEffect(() => {
    let alive = true;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (!alive) return;
        const msg = err instanceof Error ? err.message : String(err);
        setCamError(
          msg.includes('Permission') || msg.includes('NotAllowed')
            ? 'Camera permission denied — grant access and reload.'
            : `Camera error: ${msg}`,
        );
      }
    }

    async function init() {
      try {
        await initializeFaceLandmarker();
        if (alive) setTrackerReady(true);
      } catch {
        if (alive) setCamError('Face tracker failed to load. Check your connection.');
        return;
      }
      await start();
    }

    init();

    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  if (camError) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-noir-900 text-ivory/60 px-8">
        <span className="text-gold-400 text-4xl">⚠</span>
        <p className="font-label text-sm text-center uppercase tracking-luxe">{camError}</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {/* Mirrored video background */}
      <video
        id={VIDEO_ID}
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Loading overlay */}
      {!trackerReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-noir-900/80 z-10">
          <div className="w-8 h-8 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
          <span className="font-label text-xs text-gold-300 tracking-luxe uppercase">
            Loading face tracker…
          </span>
        </div>
      )}

      {/* R3F AR overlay — exactly mirrors booth rendering */}
      {trackerReady && (
        <Canvas
          camera={{ position: RIG_CAMERA.position, fov: RIG_CAMERA.fov, near: RIG_CAMERA.near, far: RIG_CAMERA.far }}
          gl={{ alpha: true, preserveDrawingBuffer: true, antialias: true }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        >
          {/* Scene lighting so GLB models are visible */}
          <ambientLight intensity={0.55} />
          <directionalLight position={[5, 10, 8]} intensity={1.4} color="#FBF3D9" />
          <directionalLight position={[-4, 2, -4]} intensity={0.3} color="#8090C0" />

          <FaceRig
            videoId={VIDEO_ID}
            anchor={anchor}
            config={anchorConfig}
            paused={paused || dragging}
            mirror
            occlude={hasAsset}
            editable={gizmo && hasAsset}
            onVisibilityChange={onFaceVisible}
            onTransformChange={onTransformChange}
            onGizmoDragStart={() => setDragging(true)}
            onGizmoDragEnd={() => setDragging(false)}
          >
            {isHeadPiece(proceduralId) ? (
              <HeadPiece id={proceduralId as string} />
            ) : assetUrl ? (
              <Model url={assetUrl} />
            ) : (
              /* No asset yet — gold placeholder sphere so face detection is visible. */
              <mesh>
                <sphereGeometry args={[0.8, 16, 14]} />
                <meshStandardMaterial
                  color="#D4AF37"
                  emissive="#D4AF37"
                  emissiveIntensity={1.2}
                  metalness={0.7}
                  roughness={0.2}
                  toneMapped={false}
                />
              </mesh>
            )}
          </FaceRig>
        </Canvas>
      )}
    </div>
  );
}
