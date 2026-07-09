/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StudioPreview — renders the current draft through the EXACT booth pipeline
 * (StageCanvas, plus Overlay3D for 3D drafts) so "Preview" is pixel-parity with
 * what guests capture. Reads the studio's single shared <video>, so no extra
 * camera is opened.
 */
import StageCanvas from '../booth/StageCanvas';
import Overlay3D from '../booth/Overlay3D';
import type { StudioDraft } from '../../lib/studio/state';
import type { AnchorConfig, Transform2D } from '../../types';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  draft: StudioDraft;
  headScale: number;
  occlusionEnabled: boolean;
  onFaceVisible?: (v: boolean) => void;
}

export default function StudioPreview({ videoRef, draft, headScale, occlusionEnabled, onFaceVisible }: Props) {
  const is3D = draft.kind === '3d_attachment' && (!!draft.assetUrl || !!draft.proceduralId);
  const isShader = draft.kind === 'shader';
  const isOverlay = draft.kind === 'border' || draft.kind === '2d_filter';

  const anchor: AnchorConfig = {
    anchor: draft.anchor,
    offset: draft.anchorConfig.offset,
    rotation: draft.anchorConfig.rotation,
    scale: draft.anchorConfig.scale,
  };

  const transform: Transform2D = draft.transform;

  return (
    <div className="relative h-full w-full flex items-center justify-center">
      <div className="relative h-full" style={{ aspectRatio: '9/16', maxWidth: '100%' }}>
        <StageCanvas
          videoRef={videoRef}
          effectId={isShader ? draft.shaderId : 'none'}
          mirror
          overlayUrl={isOverlay ? draft.overlayUrl : null}
          overlayTransform={transform}
          overlayOpacity={1}
          threeCanvasId={is3D ? 'booth-3d-layer' : null}
          active
          watermark={false}
        />
        {is3D && (
          <div className="absolute inset-0">
            <Overlay3D
              assetUrl={draft.assetUrl}
              proceduralId={draft.proceduralId}
              anchor={anchor}
              videoId={videoRef.current?.id || 'studio-video'}
              mirror
              occlude={occlusionEnabled && draft.occlusion}
              headScale={headScale}
              onFaceVisible={onFaceVisible}
            />
          </div>
        )}
      </div>
    </div>
  );
}
