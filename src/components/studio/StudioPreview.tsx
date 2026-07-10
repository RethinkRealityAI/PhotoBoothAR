/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StudioPreview — renders the current draft through the EXACT booth pipeline
 * (StageCanvas, plus Overlay3D for 3D drafts) so "Preview" is pixel-parity with
 * what guests capture. Reads the studio's single shared <video>, so no extra
 * camera is opened.
 */
import StageCanvas, { type StageOverlaySpec } from '../booth/StageCanvas';
import Overlay3D, { type Overlay3DPiece } from '../booth/Overlay3D';
import type { StudioDraft, Overlay2D, Object3D } from '../../lib/studio/state';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  draft: StudioDraft;
  headScale: number;
  occlusionEnabled: boolean;
  onFaceVisible?: (v: boolean) => void;
}

export default function StudioPreview({ videoRef, draft, headScale, occlusionEnabled, onFaceVisible }: Props) {
  // Mixed scenes: preview EVERYTHING present simultaneously — the filter slot
  // (effectId = shaderId, 'none' == off), any visible overlays, and any visible
  // 3D pieces — instead of gating on the derived kind. Layers flagged `hidden`
  // in the panel are dropped from the render (editor-only, never persisted).
  const overlaySpecs: StageOverlaySpec[] = draft.objects
    .filter((o): o is Overlay2D => o.type === 'overlay' && !!o.url && !o.hidden)
    .map((o) => ({ url: o.url as string, transform: o.transform, opacity: 1, animation: o.animation }));

  const pieces: Overlay3DPiece[] = draft.objects
    .filter((o): o is Object3D => o.type !== 'overlay' && !o.hidden)
    .map((o) => ({
      assetUrl: o.type === 'model' ? o.assetUrl ?? null : null,
      proceduralId: o.type === 'headpiece' ? o.proceduralId ?? null : null,
      anchor: { anchor: o.anchor, offset: o.anchorConfig.offset, rotation: o.anchorConfig.rotation, scale: o.anchorConfig.scale },
      animation: o.animation,
      occlude: occlusionEnabled && o.occlusion,
    }));

  const hasOverlays = overlaySpecs.length > 0;
  const has3D = pieces.length > 0;

  return (
    <div className="relative h-full w-full flex items-center justify-center">
      <div className="relative h-full" style={{ aspectRatio: '9/16', maxWidth: '100%' }}>
        <StageCanvas
          videoRef={videoRef}
          effectId={draft.shaderId}
          mirror
          overlays={hasOverlays ? overlaySpecs : null}
          threeCanvasId={has3D ? 'booth-3d-layer' : null}
          active
          watermark={false}
        />
        {has3D && (
          <div className="absolute inset-0">
            <Overlay3D
              pieces={pieces}
              anchor={pieces[0].anchor}
              videoId={videoRef.current?.id || 'studio-video'}
              mirror
              headScale={headScale}
              onFaceVisible={onFaceVisible}
            />
          </div>
        )}
      </div>
    </div>
  );
}
