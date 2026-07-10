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
import { ArrowLeft, Check, Clapperboard, Copy, Layers, Loader2, Pencil, Redo2, Save, SlidersHorizontal, Undo2, X } from 'lucide-react';
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
import { studioReducer, initialState, selectedObject, type StudioState, type StudioAction, type StudioDraft } from '../../lib/studio/state';
import { withHistory, initHistory, canUndo, canRedo } from '../../lib/studio/history';
import { nudgeTransform } from '../../lib/studio/snap';
import { experienceToDraft, draftToPayload } from '../../lib/studio/draftMapping';
import type { Experience } from '../../types';

/* Undo/redo wiring — these predicates mirror src/lib/studio/history.test.ts
 * (the studio integration block) so history behaves exactly as the lib tests
 * assert: mode/view/pause/selection are pass-through (not recorded), LOAD +
 * MARK_SAVED reset the timeline, and continuous edits coalesce per target. */
// SET_KIND is now a pure view-flip alias (never mutates the draft) so it stays
// OFF the undo timeline like SET_MODE; CLEAR_FILTER edits the scene's filter slot
// so it is recorded + dirty-making (it falls through as a mutating action).
const isDraftMutating = (a: StudioAction): boolean =>
  a.type !== 'SET_MODE' &&
  a.type !== 'SET_THREE_VIEW' &&
  a.type !== 'SET_PAUSED' &&
  a.type !== 'SELECT_OBJECT' &&
  a.type !== 'SET_KIND';
const isClearing = (a: StudioAction): boolean => a.type === 'LOAD' || a.type === 'MARK_SAVED';
const coalesceKey = (a: StudioAction, s: StudioState): string | null => {
  switch (a.type) {
    case 'SET_TRANSFORM':
      return `transform:${s.draft.selectedId}`;
    case 'PATCH_ANCHOR_CONFIG':
      return `anchor:${s.draft.selectedId}`;
    case 'SET_SHADER_PARAM':
      return `shader:${a.key}`;
    case 'UPDATE_OBJECT':
      // A visibility (eye) toggle is a discrete action — coalescing it with
      // adjacent property edits (or a following re-show) would make undo skip
      // or no-op the hide. Everything else per-object coalesces as one edit.
      return 'hidden' in a.patch ? null : `update:${a.id}`;
    default:
      return null;
  }
};
const studioHistoryReducer = withHistory<StudioState, StudioAction>(studioReducer, {
  record: isDraftMutating,
  clear: isClearing,
  coalesce: coalesceKey,
});
import AssetsDock from './AssetsDock';
import StudioStage from './StudioStage';
import PropertiesDock from './PropertiesDock';
import DragGhost from './DragGhost';
import SceneDirectorPanel from './SceneDirectorPanel';
import TestOnPhone from './TestOnPhone';
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

  const [history, dispatch] = useReducer(studioHistoryReducer, undefined, () => initHistory(initialState('shader')));
  const state = history.present;
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [faceVisible, setFaceVisible] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(sceneParam !== null);
  const [testPhoneOpen, setTestPhoneOpen] = useState(false);
  // Below lg the docks are slide-in drawers (they'd otherwise have no room);
  // this tracks which one is open. At lg+ both are always-visible columns.
  const [mobilePanel, setMobilePanel] = useState<'assets' | 'props' | null>(null);

  // Experience name lives in the centered header field (moved out of the props
  // dock). `editingName` swaps the label for an inline input; `nameDraft` holds
  // the in-flight text so Escape can cancel without touching the draft.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  // First-load naming dialog: only for a brand-NEW draft (no `?id=` deep link
  // and not arriving from the Scene Director), so an existing experience or a
  // scene-prefill never gets interrupted by it.
  const [showNameDialog, setShowNameDialog] = useState(!editId && sceneParam === null);
  const [dialogName, setDialogName] = useState(() => state.draft.name);

  // Head-size calibration (per event). Occlusion itself is per-experience
  // (config.occlusion), so there's no event-wide occlusion switch to track.
  const [headScale, setHeadScale] = useState(1);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHeadScale = useRef<number | null>(null);

  const cam = useCameraStream(true);
  const stageBodyRef = useRef<HTMLDivElement | null>(null);
  const headMatrixRef = useRef<number[] | null>(null);
  // Always-current draft for the DnD hook's cap guard (window listeners can't
  // safely close over state).
  const draftRef = useRef<StudioDraft | null>(state.draft);
  draftRef.current = state.draft;
  const dnd = useStudioDnd({ dispatch, stageBodyRef, headMatrixRef, draftRef });

  // Load studio settings once.
  useEffect(() => {
    let alive = true;
    getStudioSettings(eventId).then((s) => { if (alive) setHeadScale(s.headScale); });
    return () => { alive = false; };
  }, [eventId]);

  // Load an existing experience for editing.
  useEffect(() => {
    if (!editId) return;
    let alive = true;
    setLoadingEdit(true);
    getExperience(eventId, editId).then((exp) => {
      if (!alive) return;
      const draft = exp ? experienceToDraft(exp) : null;
      if (draft) dispatch({ type: 'LOAD', draft });
      setLoadingEdit(false);
    });
    return () => { alive = false; };
  }, [editId, eventId]);

  // Persist head-scale (debounced) — event-wide booth calibration.
  const onHeadScaleChange = useCallback((v: number) => {
    const next = clampHeadScale(v);
    setHeadScale(next);
    pendingHeadScale.current = next;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      setStudioSettings(eventId, { headScale: next });
      pendingHeadScale.current = null;
    }, 500);
  }, [eventId]);
  // Flush any pending calibration on unmount so a quick slide + navigate away
  // doesn't drop the last value.
  useEffect(() => () => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      if (pendingHeadScale.current !== null) setStudioSettings(eventId, { headScale: pendingHeadScale.current });
    }
  }, [eventId]);

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

      // Resolve every object's post-upload asset URL into a Map<objectId, url|null>
      // that draftToPayload reads. Rules per object, preserving the old Creator2D
      // behaviour: built-in overlays upload their SVG; custom overlays upload their
      // pending Blob; already-stored (http/data) urls pass through; 3D models keep
      // their assetUrl and procedural head pieces resolve to null.
      const urlMap = new Map<string, string | null>();
      for (const obj of draft.objects) {
        if (obj.type === 'overlay') {
          if (obj.isBuiltin && obj.builtinId) {
            const b = BUILTIN_BORDERS.find((x) => x.id === obj.builtinId);
            urlMap.set(obj.id, b ? await uploadAsset(svgBlob(b.svg), `${b.id}.svg`) : (obj.url ?? null));
          } else if (obj.blob) {
            const base = obj.name.replace(/\s+/g, '-').toLowerCase() || 'overlay';
            urlMap.set(obj.id, await uploadAsset(obj.blob, base));
          } else if (obj.url && (obj.url.startsWith('http') || obj.url.startsWith('data:'))) {
            urlMap.set(obj.id, obj.url);
          } else {
            urlMap.set(obj.id, null);
          }
        } else {
          // Object3D — procedural pieces have no GLB; models keep their asset url.
          urlMap.set(obj.id, obj.type === 'headpiece' && obj.proceduralId ? null : (obj.assetUrl ?? null));
        }
      }

      let thumbnailUrl: string | null = null;
      if (draft.thumbBlob) {
        thumbnailUrl = await uploadAsset(draft.thumbBlob, `icon-${draft.name.replace(/\s+/g, '-').toLowerCase()}`);
      } else if (draft.thumbUrl && draft.thumbUrl.startsWith('http')) {
        thumbnailUrl = draft.thumbUrl;
      }

      const payload = draftToPayload(draft, urlMap, thumbnailUrl);
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

  // Duplicate — strip the id so the current draft becomes a NEW unsaved scene,
  // suffix the name, and LOAD it (LOAD clears the undo timeline by design).
  const handleDuplicate = useCallback(() => {
    const { id: _id, ...rest } = state.draft;
    void _id;
    dispatch({ type: 'LOAD', draft: { ...rest, name: `${state.draft.name} copy` } });
  }, [state.draft]);

  // Header inline-rename: open seeds the input from the live name; commit writes
  // a non-empty trimmed name (SET_NAME) and closes; Escape closes without saving.
  const startRename = useCallback(() => {
    setNameDraft(state.draft.name);
    setEditingName(true);
  }, [state.draft.name]);
  const commitName = useCallback(() => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== state.draft.name) dispatch({ type: 'SET_NAME', name: trimmed });
    setEditingName(false);
  }, [nameDraft, state.draft.name]);
  // First-load dialog: "Start creating" / Enter commits the (possibly edited)
  // name; the X or accepting the default just closes without dirtying the draft.
  const commitDialogName = useCallback(() => {
    const trimmed = dialogName.trim();
    if (trimmed && trimmed !== state.draft.name) dispatch({ type: 'SET_NAME', name: trimmed });
    setShowNameDialog(false);
  }, [dialogName, state.draft.name]);

  // Keyboard shortcuts on the shell. Skipped while typing in a field so undo/
  // delete never fights text editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        dispatch(e.shiftKey ? { type: 'REDO' } : { type: 'UNDO' });
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }
      const draft = state.draft;
      if ((e.key === 'Delete' || e.key === 'Backspace') && draft.selectedId) {
        e.preventDefault();
        dispatch({ type: 'DELETE_OBJECT', id: draft.selectedId });
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const sel = selectedObject(draft);
        if (sel && sel.type === 'overlay') {
          e.preventDefault();
          dispatch({ type: 'UPDATE_OBJECT', id: sel.id, patch: { transform: nudgeTransform(sel.transform, e.key, e.shiftKey) } });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.draft]);

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
      <header className="h-14 shrink-0 flex items-center gap-1.5 sm:gap-3 px-2.5 sm:px-4 liquid-glass border-b border-white/10 z-40">
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
        <div className="min-w-0 hidden sm:block shrink-0">
          <p className="font-serif italic text-sm text-brand-fg leading-tight">Studio</p>
          <p className="font-label text-[8px] uppercase tracking-widest text-brand-muted/50">{state.draft.id ? 'Editing experience' : 'New experience'}</p>
        </div>
        {/* Centered experience name — click the pencil (or the name) to rename
            inline. Truncates with ellipsis on phone; the pencil stays tappable. */}
        <div className="flex-1 flex justify-center min-w-0 px-1 sm:px-2">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitName(); }
                else if (e.key === 'Escape') { e.preventDefault(); setEditingName(false); }
              }}
              placeholder="Experience name…"
              aria-label="Experience name"
              className="w-full max-w-[18rem] text-center rounded-lg bg-white/[0.06] border border-accent/40 px-3 py-1.5 text-sm text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/60 transition"
            />
          ) : (
            <button
              onClick={startRename}
              aria-label="Rename experience"
              className="group flex items-center gap-1.5 min-w-0 max-w-[18rem] px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
            >
              <span className="font-serif italic text-sm text-brand-fg truncate">{state.draft.name || 'Untitled experience'}</span>
              <Pencil className="w-3 h-3 text-brand-muted/40 group-hover:text-accent-2 shrink-0 transition-colors" />
            </button>
          )}
        </div>
        {/* Undo / Redo / Duplicate */}
        <div className="flex items-center gap-1">
          <Tooltip label="Undo" hint="Ctrl/Cmd+Z" side="bottom">
            <button
              onClick={() => dispatch({ type: 'UNDO' })}
              disabled={!canUndo(history)}
              aria-label="Undo"
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label="Redo" hint="Ctrl/Cmd+Shift+Z" side="bottom">
            <button
              onClick={() => dispatch({ type: 'REDO' })}
              disabled={!canRedo(history)}
              aria-label="Redo"
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </Tooltip>
          {state.draft.id && (
            <Tooltip label="Duplicate" hint="Save a copy as a new experience" side="bottom">
              <button
                onClick={handleDuplicate}
                aria-label="Duplicate experience"
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
        </div>
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
          aria-label={state.draft.id ? 'Update experience' : 'Save experience'}
          className="flex items-center gap-1.5 px-3 sm:px-5 py-2 bg-foil text-white font-bold text-[10px] font-label uppercase tracking-widest rounded-xl glow-accent transition active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{saving ? 'Saving…' : saved ? 'Saved' : state.draft.id ? 'Update' : 'Save'}</span>
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
            occlusionEnabled={source === 'db'}
            debugOcclusion={debugOcclusion}
            faceVisible={faceVisible}
            onFaceVisible={setFaceVisible}
            stageBodyRef={stageBodyRef}
            headMatrixRef={headMatrixRef}
            dropActive={dnd.dragging && dnd.overStage}
            onTestOnPhone={() => setTestPhoneOpen(true)}
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

      {/* First-load naming dialog — brand-new drafts only (see showNameDialog).
          Skippable via the X or by accepting the pre-filled default. */}
      {showNameDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="liquid-glass rounded-2xl border border-accent/20 p-6 w-full max-w-sm relative animate-rise-in">
            <button
              onClick={() => setShowNameDialog(false)}
              aria-label="Skip naming"
              className="absolute top-3 right-3 p-1 rounded-lg text-brand-muted/50 hover:text-brand-fg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <p className="font-label text-[9px] uppercase tracking-widest text-accent-2 mb-1">New experience</p>
            <h2 className="font-serif italic text-xl text-brand-fg mb-4">Name your experience</h2>
            <form onSubmit={(e) => { e.preventDefault(); commitDialogName(); }}>
              <input
                autoFocus
                value={dialogName}
                onChange={(e) => setDialogName(e.target.value)}
                placeholder="Experience name…"
                aria-label="Experience name"
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/60 transition mb-4"
              />
              <button
                type="submit"
                className="w-full py-2.5 bg-foil text-white font-bold text-[10px] font-label uppercase tracking-widest rounded-xl glow-accent transition active:scale-[0.98]"
              >
                Start creating
              </button>
            </form>
          </div>
        </div>
      )}

      {sceneOpen && <SceneDirectorPanel initialPrompt={sceneParam ?? ''} onClose={() => setSceneOpen(false)} />}
      {testPhoneOpen && (
        <TestOnPhone
          experienceId={state.draft.id}
          dirty={state.dirty}
          isPublished={state.draft.isPublished}
          saving={saving}
          onSave={handleSave}
          onClose={() => setTestPhoneOpen(false)}
        />
      )}
    </div>
  );
}
