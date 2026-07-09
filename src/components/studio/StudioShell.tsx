/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * StudioShell — the unified event studio. Replaces the separate 2D/Shader and
 * 3D-Anchor creator tabs with ONE surface: a single shared camera, an in-canvas
 * 2D · 3D · Preview switcher, and docked liquid-glass panels (assets / stage /
 * properties). Editing state is the pure studioReducer; persistence uses the
 * exact `experiences` payload shapes the old creators wrote, so every saved
 * experience keeps loading and the booth renders unchanged.
 *
 * Deep links: `?id=<uuid>` loads an experience for editing; `?scene=<prompt>`
 * (P4) opens the Scene Director pre-filled.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Clapperboard, Layers, Loader2, Save, SlidersHorizontal, X } from 'lucide-react';
import { useCameraStream } from '../booth/useCameraStream';
import { useEvent } from '../../events/EventContext';
import { useStudioBase } from '../admin/studioBase';
import {
  getExperience,
  createExperience,
  updateExperience,
  uploadAsset,
  getStudioSettings,
  setStudioSettings,
} from '../../lib/db';
import { BUILTIN_BORDERS } from '../../lib/borders';
import { clampHeadScale } from '../../lib/studio/occluder';
import { studioReducer, initialState } from '../../lib/studio/state';
import { experienceToDraft, draftToPayload } from '../../lib/studio/draftMapping';
import type { Experience } from '../../types';
import AssetsDock from './AssetsDock';
import StudioStage from './StudioStage';
import PropertiesDock from './PropertiesDock';
import DragGhost from './DragGhost';
import SceneDirectorPanel from './SceneDirectorPanel';
import { useStudioDnd } from './useStudioDnd';
import Tooltip from '../ui/Tooltip';

const CAMERA_MESSAGES: Record<string, string> = {
  NotAllowedError: 'Camera permission denied — grant access and retry.',
  NotFoundError: 'No camera found — connect one and retry.',
  unknown: 'Camera unavailable — retry.',
};

function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** Redirect the retired creator routes to the unified studio, keeping `?id=`. */
export function StudioRedirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

/** Mobile-only drawer header with a close button (hidden at lg+). */
function DrawerClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="lg:hidden sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-brand-bg/90 backdrop-blur border-b border-white/10">
      <span className="font-label uppercase tracking-widest text-[10px] text-brand-fg">{label}</span>
      <button onClick={onClose} aria-label="Close panel" className="p-1 rounded-lg text-brand-muted/60 hover:text-brand-fg transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function StudioShell() {
  const navigate = useNavigate();
  const base = useStudioBase();
  const { eventId, source } = useEvent();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');
  const debugOcclusion = searchParams.get('debug') === 'occluder';
  const sceneParam = searchParams.get('scene');

  const [state, dispatch] = useReducer(studioReducer, undefined, () => initialState('shader'));
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [faceVisible, setFaceVisible] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(sceneParam !== null);
  // Below lg the docks are slide-in drawers (they'd otherwise have no room);
  // this tracks which one is open. At lg+ both are always-visible columns.
  const [mobilePanel, setMobilePanel] = useState<'assets' | 'props' | null>(null);

  // Head-size calibration + occlusion master switch (per event).
  const [headScale, setHeadScale] = useState(1);
  const [occlusionEnabled, setOcclusionEnabled] = useState(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cam = useCameraStream(true);
  const stageBodyRef = useRef<HTMLDivElement | null>(null);
  const headMatrixRef = useRef<number[] | null>(null);
  const dnd = useStudioDnd({ dispatch, stageBodyRef, headMatrixRef });

  // Load studio settings once.
  useEffect(() => {
    let alive = true;
    getStudioSettings(eventId).then((s) => {
      if (!alive) return;
      setHeadScale(s.headScale);
      setOcclusionEnabled(s.occlusion);
    });
    return () => { alive = false; };
  }, [eventId]);

  // Load an existing experience for editing.
  useEffect(() => {
    if (!editId) return;
    setLoadingEdit(true);
    getExperience(eventId, editId).then((exp) => {
      const draft = exp ? experienceToDraft(exp) : null;
      if (draft) dispatch({ type: 'LOAD', draft });
      setLoadingEdit(false);
    });
  }, [editId, eventId]);

  // Persist head-scale (debounced) — event-wide booth calibration.
  const onHeadScaleChange = useCallback((v: number) => {
    const next = clampHeadScale(v);
    setHeadScale(next);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => { setStudioSettings(eventId, { headScale: next }); }, 500);
  }, [eventId]);
  useEffect(() => () => { if (persistTimer.current) clearTimeout(persistTimer.current); }, []);

  const onThumbUpload = useCallback((file: File) => {
    dispatch({ type: 'SET_THUMB', url: URL.createObjectURL(file), blob: file });
  }, []);
  const onThumbClear = useCallback(() => dispatch({ type: 'SET_THUMB', url: null, blob: null }), []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const draft = state.draft;

      // Resolve the overlay asset URL (upload builtin SVG / custom blob, or keep
      // an already-stored URL) — same rules the old Creator2D used.
      let assetUrl: string | null = null;
      if (draft.kind === 'border' || draft.kind === '2d_filter') {
        if (draft.overlayIsBuiltin) {
          const b = BUILTIN_BORDERS.find((x) => x.id === draft.selectedBorderId);
          if (b) assetUrl = await uploadAsset(svgBlob(b.svg), `${b.id}.svg`);
        } else if (draft.overlayBlob) {
          assetUrl = await uploadAsset(draft.overlayBlob, draft.name.replace(/\s+/g, '-').toLowerCase());
        } else if (draft.overlayUrl && (draft.overlayUrl.startsWith('http') || draft.overlayUrl.startsWith('data:'))) {
          assetUrl = draft.overlayUrl;
        }
      } else if (draft.kind === '3d_attachment') {
        assetUrl = draft.assetUrl;
      }

      let thumbnailUrl: string | null = null;
      if (draft.thumbBlob) {
        thumbnailUrl = await uploadAsset(draft.thumbBlob, `icon-${draft.name.replace(/\s+/g, '-').toLowerCase()}`);
      } else if (draft.thumbUrl && draft.thumbUrl.startsWith('http')) {
        thumbnailUrl = draft.thumbUrl;
      }

      const payload = draftToPayload(draft, assetUrl, thumbnailUrl);
      const result = draft.id
        ? await updateExperience(eventId, draft.id, payload)
        : await createExperience(eventId, payload);

      if (!result) {
        setSaveError('Save failed — check your connection and try again.');
      } else {
        dispatch({ type: 'MARK_SAVED', id: result.id });
        setSaved(true);
        setTimeout(() => setSaved(false), 2400);
      }
    } catch (err) {
      console.error('[studio] save', err);
      setSaveError('Unexpected error — see console.');
    } finally {
      setSaving(false);
    }
  }, [state.draft, eventId]);

  const openExperience = useCallback((exp: Experience) => {
    navigate(`${base}/studio?id=${exp.id}`);
  }, [navigate, base]);

  if (loadingEdit) {
    return (
      <div className="absolute inset-0 app-bg flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
      </div>
    );
  }

  const camError = cam.error ? (CAMERA_MESSAGES[cam.error] ?? CAMERA_MESSAGES.unknown) : null;

  return (
    <div className="absolute inset-0 flex flex-col app-bg">
      {/* Top bar */}
      <header className="h-14 shrink-0 flex items-center gap-3 px-4 liquid-glass border-b border-white/10 z-40">
        <Tooltip label="Library" hint="Back to your experiences" side="bottom">
          <Link to={`${base}/library`} className="p-1.5 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Tooltip>
        {/* Mobile/tablet: toggle the Assets drawer (a static column at lg+). */}
        <button
          onClick={() => setMobilePanel((p) => (p === 'assets' ? null : 'assets'))}
          aria-label="Toggle assets panel"
          className={`lg:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${mobilePanel === 'assets' ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg'}`}
        >
          <Layers className="w-4 h-4" />
        </button>
        <div className="min-w-0 hidden sm:block">
          <p className="font-serif italic text-sm text-brand-fg leading-tight">Studio</p>
          <p className="font-label text-[8px] uppercase tracking-widest text-brand-muted/50">{state.draft.id ? 'Editing experience' : 'New experience'}</p>
        </div>
        <div className="flex-1" />
        <Tooltip label="AI Scene Director" hint="One prompt → matching frame, filter & 3D piece" side="bottom">
          <button
            onClick={() => setSceneOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl liquid-glass text-[10px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Scene Director</span>
          </button>
        </Tooltip>
        {saveError && <span className="text-rose-400 text-[10px] font-sans max-w-[180px] text-right">{saveError}</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2 bg-foil text-white font-bold text-[10px] font-label uppercase tracking-widest rounded-xl glow-accent transition active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Saving…' : saved ? 'Saved' : state.draft.id ? 'Update' : 'Save'}
        </button>
        {/* Mobile/tablet: toggle the Properties drawer (a static column at lg+). */}
        <button
          onClick={() => setMobilePanel((p) => (p === 'props' ? null : 'props'))}
          aria-label="Toggle properties panel"
          className={`lg:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${mobilePanel === 'props' ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg'}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </header>

      {/* Body — 3-pane at lg+; the side docks become slide-in drawers below lg
          so every control (pick/upload/transform) stays reachable on tablet
          and phone instead of vanishing. */}
      <div className="flex-1 min-h-0 flex relative">
        {/* Backdrop for the mobile drawers. */}
        {mobilePanel && (
          <div className="fixed inset-0 top-14 z-30 bg-black/50 lg:hidden" onClick={() => setMobilePanel(null)} />
        )}

        <aside
          data-panel="assets"
          className={`overflow-y-auto hide-scrollbar bg-brand-bg lg:bg-transparent border-white/10
            fixed z-40 top-14 bottom-0 left-0 w-[20rem] max-w-[86vw] border-r transition-transform duration-200
            lg:static lg:z-auto lg:top-0 lg:w-[19rem] lg:max-w-none lg:translate-x-0 lg:shrink-0
            ${mobilePanel === 'assets' ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <DrawerClose label="Assets" onClose={() => setMobilePanel(null)} />
          <AssetsDock state={state} dispatch={dispatch} onOpenExperience={openExperience} beginDrag={dnd.beginDrag} consumedDrag={dnd.consumedDrag} />
        </aside>

        <main className="flex-1 min-w-0 relative">
          <StudioStage
            state={state}
            dispatch={dispatch}
            cam={{ videoRef: cam.videoRef, ready: cam.ready, error: camError, retry: cam.retry }}
            headScale={headScale}
            occlusionEnabled={source === 'db' && occlusionEnabled}
            debugOcclusion={debugOcclusion}
            faceVisible={faceVisible}
            onFaceVisible={setFaceVisible}
            stageBodyRef={stageBodyRef}
            headMatrixRef={headMatrixRef}
            dropActive={dnd.dragging && dnd.overStage}
          />
        </main>

        <aside
          data-panel="props"
          className={`overflow-y-auto hide-scrollbar bg-brand-bg lg:bg-transparent border-white/10
            fixed z-40 top-14 bottom-0 right-0 w-[20rem] max-w-[86vw] border-l transition-transform duration-200
            lg:static lg:z-auto lg:top-0 lg:w-[19rem] lg:max-w-none lg:translate-x-0 lg:shrink-0
            ${mobilePanel === 'props' ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <DrawerClose label="Properties" onClose={() => setMobilePanel(null)} />
          <PropertiesDock
            state={state}
            dispatch={dispatch}
            headScale={headScale}
            onHeadScaleChange={onHeadScaleChange}
            onThumbUpload={onThumbUpload}
            onThumbClear={onThumbClear}
          />
        </aside>
      </div>

      <DragGhost payload={dnd.payload} ghost={dnd.ghost} />
      {sceneOpen && <SceneDirectorPanel initialPrompt={sceneParam ?? ''} onClose={() => setSceneOpen(false)} />}
    </div>
  );
}
