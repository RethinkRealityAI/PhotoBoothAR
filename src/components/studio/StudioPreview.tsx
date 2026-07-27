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
import { isLayerVisible } from '../../lib/studio/triggers';

const EMPTY_SET: Set<string> = new Set();
/** Reveal targets minus the ones still waiting = the ones that have fired. */
function firedOf(targets: ReadonlySet<string>, pending: ReadonlySet<string> | undefined): Set<string> {
  const out = new Set<string>();
  for (const id of targets) if (!pending?.has(id)) out.add(id);
  return out;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  draft: StudioDraft;
  headScale: number;
  occlusionEnabled: boolean;
  onFaceVisible?: (v: boolean) => void;
  /** Reveal-target object ids not yet fired — dropped from the render so a
   *  reveal trigger's piece stays hidden until it fires (booth parity). */
  hiddenObjectIds?: Set<string>;
  /** Every reveal target in the scene, fired or not. Needed to match the booth:
   *  a reveal target is governed ONLY by its trigger, so a piece that is BOTH
   *  eye-hidden and a reveal target still appears once fired. Preview used to AND
   *  the two conditions and could never show it. */
  revealTargetIds?: Set<string>;
  /** Transient filterPulse shader — overrides the scene filter for ~1.2s. */
  effectIdOverride?: string;
  /** Booth reveal-spring flag — plays the 3D scale-in as a piece reveals. */
  reveal?: boolean;
}

export default function StudioPreview({ videoRef, draft, headScale, occlusionEnabled, onFaceVisible, hiddenObjectIds, revealTargetIds, effectIdOverride, reveal }: Props) {
  const targets = revealTargetIds ?? EMPTY_SET;
  // Fired = a target NOT in hiddenObjectIds (the parent tracks the un-fired set).
  const visible = (o: { id: string; hidden?: boolean }) =>
    isLayerVisible(o, targets, firedOf(targets, hiddenObjectIds));
  // Mixed scenes: preview EVERYTHING present simultaneously — the filter slot
  // (effectId = shaderId, 'none' == off), any visible overlays, and any visible
  // 3D pieces — instead of gating on the derived kind. Layers flagged `hidden`
  // in the panel are dropped from the render (editor-only, never persisted);
  // reveal-target pieces are gated by hiddenObjectIds until their trigger fires.
  const overlaySpecs: StageOverlaySpec[] = draft.objects
    .filter((o): o is Overlay2D => o.type === 'overlay' && !!o.url && visible(o))
    .map((o) => ({ url: o.url as string, transform: o.transform, opacity: 1, animation: o.animation }));

  const pieces: Overlay3DPiece[] = draft.objects
    .filter((o): o is Object3D => o.type !== 'overlay' && visible(o))
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
      {/* The stage body is already an exact 9:16 box (StudioStage sizes it via
          fitStageBox semantics), so fill it. This used to re-declare
          `h-full` + `aspectRatio` + `maxWidth`, which is NOT a 9:16 box when
          width binds — the ratio silently changed and object-cover cropped the
          composite the host was told matched the guest capture. */}
      <div className="relative h-full w-full">
        <StageCanvas
          videoRef={videoRef}
          effectId={effectIdOverride ?? draft.shaderId}
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
              reveal={reveal}
            />
          </div>
        )}
      </div>
    </div>
  );
}
