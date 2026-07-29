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
  getExperienceResult,
  createExperience,
  updateExperience,
  uploadAsset,
  getStudioSettings,
  setStudioSettings,
} from '../../lib/db';
import ConfirmModal from '../ui/ConfirmModal';
import { BUILTIN_BORDERS } from '../../lib/borders';
import { clampHeadScale } from '../../lib/studio/occluder';
import { studioReducer, initialState, selectedObject, type StudioState, type StudioAction, type StudioDraft } from '../../lib/studio/state';
import { withHistory, initHistory, canUndo, canRedo } from '../../lib/studio/history';
import { nudgeTransform } from '../../lib/studio/snap';
import { nudgeOffset3D } from '../../lib/studio/align';
import { experienceToDraft, draftToPayload } from '../../lib/studio/draftMapping';
import {
  clearSnapshot,
  describeAge,
  loadSnapshot,
  pruneSnapshots,
  saveSnapshot,
  shouldOfferRecovery,
  type DraftSnapshot,
  type DraftStore,
} from '../../lib/studio/draftSafety';
import { useLeaveGuard } from './useLeaveGuard';
import type { Experience } from '../../types';

/* Undo/redo wiring — these predicates mirror src/lib/studio/history.test.ts
 * (the studio integration block) so history behaves exactly as the lib tests
 * assert: mode/view/selection are pass-through (not recorded), LOAD +
 * MARK_SAVED reset the timeline, and continuous edits coalesce per target. */
// SET_KIND is now a pure view-flip alias (never mutates the draft) so it stays
// OFF the undo timeline like SET_MODE; CLEAR_FILTER edits the scene's filter slot
// so it is recorded + dirty-making (it falls through as a mutating action).
const isDraftMutating = (a: StudioAction): boolean =>
  a.type !== 'SET_MODE' &&
  a.type !== 'SET_THREE_VIEW' &&
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
import DirectorPanel from './DirectorPanel';
import TestOnPhone from './TestOnPhone';
import { useStudioDnd } from './useStudioDnd';
import Tooltip from '../ui/Tooltip';
import HelpButton from './HelpButton';
import { FeatureHelpProvider } from './FeatureHelpContext';

const CAMERA_MESSAGES: Record<string, string> = {
  NotAllowedError: 'Camera permission denied — grant access and retry.',
  NotFoundError: 'No camera found — connect one and retry.',
  unknown: 'Camera unavailable — retry.',
};

function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/**
 * localStorage, or null where it is unavailable (SSR, private-mode lockdowns,
 * a browser with storage disabled). Every draftSafety call takes null happily,
 * so autosave degrades to "off" instead of throwing on module load.
 */
function draftStore(): DraftStore | null {
  try {
    const s = window.localStorage;
    // Touch it — Safari's "block all cookies" throws only on ACCESS, not on the
    // property read, so a bare `window.localStorage` check is not enough.
    const probe = `${'__bw_probe__'}${Date.now()}`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/**
 * Session cache of built-in SVG uploads, keyed by event + builtin id.
 *
 * handleSave used to re-upload the catalog SVG for EVERY built-in overlay on
 * EVERY save, sequentially — so re-saving an unchanged 5-sticker scene meant 5
 * serial storage round-trips and 5 orphaned objects in the bucket. The bytes for
 * a given built-in never change, so the first upload's URL is reused for the
 * rest of the session. Module-level (not a ref) so it survives remounts of the
 * editor within one page load.
 */
const builtinUploadCache = new Map<string, string>();

/** Debounce for the local autosave, in ms. Long enough not to thrash storage
 *  during a drag, short enough that a crash costs at most a second of work. */
const AUTOSAVE_DEBOUNCE_MS = 1200;

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
  // Why the requested experience did not load. 'unreachable' is retryable (the
  // network or the database); 'missing' is not (the row is gone). Either way we
  // must NOT open a blank editor pointed at that id — see the load effect.
  const [loadError, setLoadError] = useState<'unreachable' | 'missing' | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Set the instant the host confirms leaving, so the leave guard stands down
  // and does not intercept the navigation it was just told to allow.
  const [leaving, setLeaving] = useState(false);
  // A recovered local draft waiting on the host's yes/no. Never applied
  // automatically — silently replacing what they opened would be its own bug.
  const [recovery, setRecovery] = useState<DraftSnapshot | null>(null);
  // What the autosave is doing, surfaced honestly in the header rather than
  // implying a durability we cannot promise.
  const [autosave, setAutosave] = useState<{ at: number; dropped: number } | null>(null);
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
  // The first-load naming dialog is GONE. It covered the canvas before the host
  // had seen a single thing the studio can do, to collect a field that is
  // editable at any time from the header (and that a starter scene fills in for
  // them). The empty stage now shows the starter-scene gallery instead — a
  // result in one click, then a name if they want one.

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
  //
  // A failed read used to fall through to the blank starter draft, and saving
  // THAT created a second experience rather than updating the one the host
  // opened — their edits forked into a duplicate and the original kept its old
  // content. So the two outcomes are now separated: nothing loaded means we
  // refuse to edit rather than quietly become a "new experience" screen.
  useEffect(() => {
    if (!editId) return;
    let alive = true;
    setLoadingEdit(true);
    setLoadError(null);
    getExperienceResult(eventId, editId).then(({ experience, failed }) => {
      if (!alive) return;
      const draft = experience ? experienceToDraft(experience) : null;
      if (draft) {
        loadedDraftRef.current = draft;
        dispatch({ type: 'LOAD', draft });
      } else {
        setLoadError(failed ? 'unreachable' : 'missing');
      }
      setLoadingEdit(false);
    });
    return () => { alive = false; };
  }, [editId, eventId, loadAttempt]);

  // Persist head-scale (debounced) — event-wide booth calibration. persist=false
  // updates the slider/state ONLY and cancels any pending debounced write: the
  // calibration Apply chip persists {headScale, baselineFit, autoHeadScale} in
  // one combined write, and a stale debounced {headScale} landing after it
  // would read-modify-write the row WITHOUT the baseline and drop it (audit M-A4).
  const onHeadScaleChange = useCallback((v: number, persist: boolean = true) => {
    const next = clampHeadScale(v);
    setHeadScale(next);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    if (!persist) {
      pendingHeadScale.current = null;
      return;
    }
    pendingHeadScale.current = next;
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

  /* ── The unsaved-work safety net ─────────────────────────────────────────
     Three layers, in increasing order of how much they save:
       1. beforeunload + a popstate trap (useLeaveGuard) — ASK before leaving.
       2. a debounced local autosave — so a guard that is bypassed (or a crash,
          or a killed tab) still costs nothing.
       3. an explicit restore prompt on return — never an automatic overwrite.
     None of it touches the server: the persistence contract is unchanged. */

  const storeRef = useRef<DraftStore | null | undefined>(undefined);
  if (storeRef.current === undefined) storeRef.current = draftStore();
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The draft the editor most recently LOADED, so the restore prompt can tell a
  // genuinely different snapshot from one that merely mirrors what is open.
  const loadedDraftRef = useRef<StudioDraft | null>(null);

  // Look for a recovered draft once the editor knows what it is editing.
  // Runs after the load effect settles (loadingEdit false) so `current` is the
  // real comparison target rather than the blank starter draft.
  const recoveryCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (loadingEdit || loadError) return;
    const slot = `${eventId}:${editId ?? 'new'}`;
    if (recoveryCheckedRef.current === slot) return;
    recoveryCheckedRef.current = slot;
    const store = storeRef.current;
    // Keep the recovery data bounded: sweep anything stale on the way in.
    pruneSnapshots(store, Date.now());
    const snap = loadSnapshot(store, eventId, editId ?? null);
    if (shouldOfferRecovery(snap, loadedDraftRef.current, Date.now())) setRecovery(snap);
  }, [loadingEdit, loadError, eventId, editId]);

  // Debounced autosave of the CURRENT draft whenever it is dirty. A clean draft
  // clears its slot — a saved scene has nothing left to recover, and leaving a
  // stale snapshot behind would offer the host their own already-saved work.
  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (!state.dirty) {
      clearSnapshot(store, eventId, editId ?? null);
      setAutosave(null);
      return;
    }
    autosaveTimer.current = setTimeout(() => {
      const at = Date.now();
      const res = saveSnapshot(store, { eventId, experienceId: editId ?? null, savedAt: at }, state.draft);
      setAutosave(res.outcome === 'saved' ? { at, dropped: res.droppedAssets } : null);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [state.draft, state.dirty, eventId, editId]);

  // Ask before Back / Forward / refresh / tab close. `leaving` stands the guard
  // down for the navigation the host just approved.
  useLeaveGuard({
    dirty: state.dirty && !leaving,
    bypass: leaving,
    onAttemptLeave: () => setConfirmLeave(true),
  });

  const acceptRecovery = useCallback(() => {
    if (!recovery) return;
    // dirty:true — a recovered scene is unsaved work by definition, so the
    // leave-guard must be ARMED the moment it lands (the same hole Duplicate had).
    dispatch({ type: 'LOAD', draft: recovery.draft, dirty: true });
    setRecovery(null);
  }, [recovery]);

  const discardRecovery = useCallback(() => {
    clearSnapshot(storeRef.current, eventId, editId ?? null);
    setRecovery(null);
  }, [eventId, editId]);

  const onThumbUpload = useCallback((file: File) => {
    dispatch({ type: 'SET_THUMB', url: URL.createObjectURL(file), blob: file });
  }, []);
  const onThumbClear = useCallback(() => dispatch({ type: 'SET_THUMB', url: null, blob: null }), []);

  /** Returns true only when the row actually landed — the save-and-leave path
   *  must not navigate away from work that failed to persist. */
  const handleSave = useCallback(async (): Promise<boolean> => {
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
      // Every object resolves CONCURRENTLY. This loop used to be `for … await`,
      // so a 5-sticker scene meant 5 SERIAL storage round-trips on every save;
      // and it re-uploaded each built-in's SVG unconditionally, orphaning a
      // fresh object in the bucket per save of an unchanged scene. Built-in
      // bytes never change, so their upload is memoised per event for the
      // session (builtinUploadCache) and every object is resolved in parallel.
      const resolveObjectUrl = async (obj: (typeof draft.objects)[number]): Promise<string | null> => {
        if (obj.type !== 'overlay') {
          // Object3D — procedural pieces have no GLB; models keep their asset url.
          return obj.type === 'headpiece' && obj.proceduralId ? null : (obj.assetUrl ?? null);
        }
        if (obj.isBuiltin && obj.builtinId) {
          const cacheKey = `${eventId}:${obj.builtinId}`;
          const cached = builtinUploadCache.get(cacheKey);
          if (cached) return cached;
          const b = BUILTIN_BORDERS.find((x) => x.id === obj.builtinId);
          if (!b) return obj.url ?? null;
          const uploaded = await uploadAsset(eventId, svgBlob(b.svg), `${b.id}.svg`);
          // Only a SUCCESSFUL upload is cached — caching a null would make every
          // later save in this session silently drop the layer's asset.
          if (uploaded) builtinUploadCache.set(cacheKey, uploaded);
          return uploaded;
        }
        if (obj.blob) {
          const base = obj.name.replace(/\s+/g, '-').toLowerCase() || 'overlay';
          return uploadAsset(eventId, obj.blob, base);
        }
        if (obj.url && (obj.url.startsWith('http') || obj.url.startsWith('data:'))) return obj.url;
        return null;
      };

      const resolved = await Promise.all(
        draft.objects.map(async (obj) => [obj.id, await resolveObjectUrl(obj)] as const),
      );
      const urlMap = new Map<string, string | null>(resolved);

      let thumbnailUrl: string | null = null;
      if (draft.thumbBlob) {
        thumbnailUrl = await uploadAsset(eventId, draft.thumbBlob, `icon-${draft.name.replace(/\s+/g, '-').toLowerCase()}`);
      } else if (draft.thumbUrl && draft.thumbUrl.startsWith('http')) {
        thumbnailUrl = draft.thumbUrl;
      }

      const payload = draftToPayload(draft, urlMap, thumbnailUrl);
      const result = draft.id
        ? await updateExperience(eventId, draft.id, payload)
        : await createExperience(eventId, payload);

      if (!result) {
        setSaveError('Save failed — check your connection and try again.');
        return false;
      }
      dispatch({ type: 'MARK_SAVED', id: result.id });
      // The row landed, so the local snapshot has nothing left to protect —
      // and leaving it would offer the host their own already-saved work back.
      clearSnapshot(storeRef.current, eventId, editId ?? null);
      loadedDraftRef.current = draft;
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
      return true;
    } catch (err) {
      console.error('[studio] save', err);
      setSaveError('Unexpected error — see console.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [state.draft, eventId, editId]);

  const openExperience = useCallback((exp: Experience) => {
    navigate(`${base}/studio?id=${exp.id}`);
  }, [navigate, base]);

  // Duplicate — strip the id so the current draft becomes a NEW unsaved scene,
  // suffix the name, and LOAD it (LOAD clears the undo timeline by design).
  //
  // `dirty: true` closes a real hole: LOAD forced dirty:false, so the duplicate
  // was unsaved AND the leave-guard was disarmed — one tap on the back arrow
  // discarded a fresh copy with no prompt at all. A duplicate is unsaved work
  // from the instant it exists, and is now guarded (and autosaved) as such.
  const handleDuplicate = useCallback(() => {
    const { id: _id, ...rest } = state.draft;
    void _id;
    dispatch({ type: 'LOAD', draft: { ...rest, name: `${state.draft.name} copy` }, dirty: true });
  }, [state.draft]);

  /** Load a shipped starter scene as a fresh, unsaved (and therefore guarded) draft. */
  const handleStarterScene = useCallback((draft: StudioDraft) => {
    dispatch({ type: 'LOAD', draft, dirty: true });
  }, []);

  // Header inline-rename: open seeds the input from the live name; commit writes
  // a non-empty trimmed name (SET_NAME) and closes; Escape closes without saving.
  // Escape unmounts the input, which fires its onBlur → commitName — the ref
  // makes that blur a no-op so Escape genuinely cancels.
  const escapingRename = useRef(false);
  const startRename = useCallback(() => {
    escapingRename.current = false;
    setNameDraft(state.draft.name);
    setEditingName(true);
  }, [state.draft.name]);
  const commitName = useCallback(() => {
    if (escapingRename.current) { escapingRename.current = false; return; }
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== state.draft.name) dispatch({ type: 'SET_NAME', name: trimmed });
    setEditingName(false);
  }, [nameDraft, state.draft.name]);

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
        if (!sel) return;
        e.preventDefault();
        if (sel.type === 'overlay') {
          dispatch({ type: 'UPDATE_OBJECT', id: sel.id, patch: { transform: nudgeTransform(sel.transform, e.key, e.shiftKey) } });
        } else {
          // 3D pieces had NO keyboard nudge at all — a selected prop could only
          // be moved by dragging a gizmo or a slider. Arrow keys now walk its
          // anchor offset in head-space cm, Shift for the coarse step.
          dispatch({
            type: 'UPDATE_OBJECT',
            id: sel.id,
            patch: { anchorConfig: { ...sel.anchorConfig, offset: nudgeOffset3D(sel.anchorConfig.offset, e.key, e.shiftKey) } },
          });
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

  // Refuse to edit rather than fork a duplicate. Retry is offered only when
  // retrying could help — a deleted experience will not come back.
  if (loadError) {
    return (
      <div className="absolute inset-0 app-bg flex items-center justify-center p-6">
        <div className="liquid-glass-raised max-w-sm rounded-2xl p-6 flex flex-col gap-3 text-center">
          <h1 className="font-serif text-lg text-brand-fg">
            {loadError === 'unreachable' ? 'Couldn’t open that experience' : 'That experience is gone'}
          </h1>
          <p className="font-sans text-[12px] text-brand-muted/70 leading-relaxed">
            {loadError === 'unreachable'
              ? 'We couldn’t load it just now, so the editor stayed closed — opening a blank one would have saved your work as a duplicate and left the original untouched. Nothing has changed.'
              : 'It may have been deleted. Nothing has changed — pick another from your Library, or start a new experience.'}
          </p>
          <div className="flex items-center justify-center gap-2">
            {loadError === 'unreachable' && (
              <button
                onClick={() => setLoadAttempt((n) => n + 1)}
                className="pressable rounded-full bg-foil px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold text-[color:var(--on-accent)]"
              >
                Try again
              </button>
            )}
            <Link
              to={`${base}/library`}
              className="pressable liquid-glass rounded-full px-4 min-h-11 flex items-center font-label uppercase tracking-luxe text-[10px] text-brand-fg"
            >
              Back to Library
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const camError = cam.error ? (CAMERA_MESSAGES[cam.error] ?? CAMERA_MESSAGES.unknown) : null;

  // The rename control renders in two homes, both IN FLEX FLOW (the old
  // absolutely-centered copy could sit on top of the undo cluster at mid
  // widths): the large left-aligned anchor of the bar at sm+, and a
  // full-width second header row on phones. Being a flex-1 min-w-0 item it
  // truncates under pressure but can never overlap a neighbour.
  const nameControl = editingName ? (
    <input
      autoFocus
      value={nameDraft}
      onChange={(e) => setNameDraft(e.target.value)}
      onBlur={commitName}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitName(); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          escapingRename.current = true; // the unmount blur must not commit
          setEditingName(false);
        }
      }}
      placeholder="Experience name…"
      aria-label="Experience name"
      className="w-full max-w-[24rem] rounded-lg bg-white/[0.06] border border-accent/40 px-3 py-1 font-serif italic text-lg lg:text-xl text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/60 transition"
    />
  ) : (
    <button
      onClick={startRename}
      aria-label="Rename experience"
      className="group flex items-center gap-1.5 min-w-0 max-w-full px-2.5 py-1 rounded-lg hover:bg-white/[0.04] transition-colors"
    >
      <span className="font-serif italic text-lg lg:text-xl text-brand-fg leading-tight truncate">{state.draft.name || 'Untitled experience'}</span>
      <Pencil className="w-3.5 h-3.5 text-brand-muted/40 group-hover:text-accent-2 shrink-0 transition-colors" />
    </button>
  );

  // Undo / Redo / Duplicate — one grouped cluster (≥40px targets), rendered in
  // the main row at sm+ and beside the name on the phone's second row.
  const historyControls = (
    <div className="flex items-center gap-1 shrink-0">
      <Tooltip label="Undo" hint="Ctrl/Cmd+Z" side="bottom">
        <button
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={!canUndo(history)}
          aria-label="Undo"
          className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <Undo2 className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip label="Redo" hint="Ctrl/Cmd+Shift+Z" side="bottom">
        <button
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={!canRedo(history)}
          aria-label="Redo"
          className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </Tooltip>
      {state.draft.id && (
        <Tooltip label="Duplicate" hint="Save a copy as a new experience" side="bottom">
          <button
            onClick={handleDuplicate}
            aria-label="Duplicate experience"
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors"
          >
            <Copy className="w-4 h-4" />
          </button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <FeatureHelpProvider>
    <div className="absolute inset-0 flex flex-col app-bg">
      {/* Top bar — every control is IN FLOW (no absolute positioning), so at
          any width items truncate or wrap to the phone name-row; nothing can
          overlap or hide behind another toggle. */}
      <header className="shrink-0 liquid-glass border-b border-white/10 z-40">
      <div className="h-14 flex items-center gap-1.5 sm:gap-2.5 px-2.5 sm:px-4">
        {/* Leaving with unsaved work. `state.dirty` was already tracked and
            already correct — it simply guarded nothing here, so one tap on this
            arrow discarded a whole scene with no prompt. AssetsDock:186 has
            confirmed on dirty for template-opening all along; this is the same
            rule applied to the one control that actually leaves the editor. */}
        <Tooltip label="Library" hint="Back to your experiences" side="bottom">
          <Link
            to={`${base}/library`}
            onClick={(e) => { if (state.dirty) { e.preventDefault(); setConfirmLeave(true); } }}
            className="pressable flex items-center justify-center w-11 h-11 shrink-0 rounded-lg bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Tooltip>
        {/* Mobile/tablet: toggle the Assets drawer (a static column at lg+).
            A tiny text label keeps the icon-only toggle discoverable. */}
        <button
          onClick={() => { setSceneOpen(false); setMobilePanel((p) => (p === 'assets' ? null : 'assets')); }}
          aria-label="Toggle assets panel"
          className={`lg:hidden flex flex-col items-center justify-center gap-0.5 w-11 h-11 shrink-0 rounded-lg transition-colors ${mobilePanel === 'assets' ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg'}`}
        >
          <Layers className="w-4 h-4" />
          <span className="font-label text-[7px] uppercase tracking-wide leading-none">Assets</span>
        </button>
        {/* sm+: the experience NAME is the bar's visual anchor — large, inline-
            renameable, flex-1 so it takes all slack and truncates first. */}
        <div className="hidden sm:flex flex-col justify-center min-w-0 flex-1">
          {nameControl}
          <p className="font-label text-[8px] uppercase tracking-widest text-brand-muted/50 px-2.5">
            Studio · {state.draft.id ? 'Editing experience' : 'New experience'}
          </p>
        </div>
        {/* Phone: the name lives on its own row below; this spacer spreads the
            control groups apart. */}
        <div className="flex-1 sm:hidden" />
        <div className="hidden sm:block">{historyControls}</div>
        <div className="flex items-center shrink-0">
          <Tooltip label="Director" hint="Docked AI assistant — designs a scene into your open draft" side="bottom">
            <button
              onClick={() => { setMobilePanel(null); setSceneOpen((o) => !o); }}
              aria-pressed={sceneOpen}
              className={`flex items-center gap-1.5 px-3 py-2 min-h-10 shrink-0 rounded-xl liquid-glass text-[10px] font-label uppercase tracking-widest transition-colors ${sceneOpen ? 'text-brand-fg bg-accent/15' : 'text-accent-2 hover:text-brand-fg'}`}
            >
              <Clapperboard className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Director</span>
            </button>
          </Tooltip>
          <HelpButton topic="director" label="How the Director works" side="bottom" />
        </div>
        {saveError && <span className="hidden sm:inline text-rose-400 text-[10px] font-sans max-w-[180px] text-right">{saveError}</span>}
        {/* Autosave status. Says exactly what it is — a local copy on THIS
            device, not a save to the event — so it can never be mistaken for
            having published the scene. */}
        {!saveError && !saved && state.dirty && autosave && (
          <Tooltip
            label="Draft kept on this device"
            hint="Your unsaved scene is stored locally so a refresh or crash can’t lose it. It is not published until you Save."
            side="bottom"
          >
            <span className="hidden md:inline text-[9px] font-label uppercase tracking-widest text-brand-muted/40 whitespace-nowrap cursor-help">
              Draft kept locally
            </span>
          </Tooltip>
        )}
        {/* Post-save nudge — the QR/share kit lives on the event's Share tab
            (same base path derivation as the back-to-Library link above). */}
        {saved && (
          <Link
            to={`${base}/share`}
            className="hidden sm:inline text-[9px] font-label uppercase tracking-widest text-accent-2 hover:text-brand-fg transition-colors whitespace-nowrap"
          >
            Get your QR in Share
          </Link>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          aria-label={state.draft.id ? 'Update experience' : 'Save experience'}
          className="flex items-center gap-1.5 px-3 sm:px-5 py-2 min-h-10 shrink-0 bg-foil text-white font-bold text-[10px] font-label uppercase tracking-widest rounded-xl glow-accent transition active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          <span>{saving ? 'Saving…' : saved ? 'Saved' : state.draft.id ? 'Update' : 'Save'}</span>
        </button>
        {/* Mobile/tablet: toggle the Properties drawer (a static column at lg+).
            A tiny text label keeps the icon-only toggle discoverable. */}
        <button
          onClick={() => { setSceneOpen(false); setMobilePanel((p) => (p === 'props' ? null : 'props')); }}
          aria-label="Toggle properties panel"
          className={`lg:hidden flex flex-col items-center justify-center gap-0.5 w-11 h-11 shrink-0 rounded-lg transition-colors ${mobilePanel === 'props' ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.04] text-brand-muted/60 hover:text-brand-fg'}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="font-label text-[7px] uppercase tracking-wide leading-none">Edit</span>
        </button>
      </div>
      {/* Phone: the large name gets its own full-width row (it collapsed to
          ~70px in the control row), with undo/redo/duplicate beside it — off
          the packed first row so nothing hides behind the drawer toggles. */}
      <div className="sm:hidden flex items-center gap-2 px-2.5 pb-2">
        <div className="min-w-0 flex-1">{nameControl}</div>
        {historyControls}
      </div>
      {/* Phone: save errors get their own row — inline they overflowed the
          packed control row. */}
      {saveError && <p className="sm:hidden px-3 pb-2 text-rose-400 text-[10px] font-sans">{saveError}</p>}
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
            onOpenAssets={() => { setSceneOpen(false); setMobilePanel('assets'); }}
            onStarterScene={handleStarterScene}
            refusal={dnd.refusal}
          />
        </main>

        {/* Director — docked assistant. At xl+ a column BETWEEN the stage and
            the Properties dock (chosen over overlaying the props dock so the
            Scene Layers stay visible and the host watches pieces land there too;
            the stage stays fully visible, just reflowed narrower). Below xl it's
            a right slide-in drawer — at lg..xl the fourth column crushed the
            stage to ~180px and the view pill bled across panels (W6 review),
            so mid-width laptops get the overlay instead. Kept mounted (hidden
            when closed) so an in-flight generation survives close/reopen and
            2D/3D/Preview view flips. */}
        {sceneOpen && (
          <div className="fixed inset-0 top-14 z-30 bg-black/50 xl:hidden" onClick={() => setSceneOpen(false)} />
        )}
        <aside
          data-panel="director"
          className={`overflow-hidden bg-brand-bg xl:bg-transparent border-white/10
            fixed z-40 top-14 bottom-0 right-0 w-[22rem] max-w-[92vw] border-l transition-transform duration-200
            xl:static xl:z-auto xl:top-0 xl:w-[360px] xl:max-w-none xl:shrink-0 xl:transition-none
            ${sceneOpen ? 'translate-x-0 xl:flex xl:flex-col' : 'translate-x-full xl:hidden'}`}
        >
          <DirectorPanel dispatch={dispatch} draftRef={draftRef} initialPrompt={sceneParam ?? ''} onClose={() => setSceneOpen(false)} />
        </aside>

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

      {/* Recovered local draft — an EXPLICIT prompt, never an automatic
          overwrite. The host is told what it is, how old it is, and what (if
          anything) could not be preserved, then chooses. */}
      {recovery && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
          <div className="liquid-glass rounded-2xl border border-accent/20 p-6 w-full max-w-sm relative animate-rise-in">
            <p className="font-label text-[9px] uppercase tracking-widest text-accent-2 mb-1">Unsaved work found</p>
            <h2 className="font-serif italic text-xl text-brand-fg mb-2">We recovered your scene</h2>
            <p className="font-sans text-[12px] text-brand-muted/70 leading-relaxed mb-1">
              “{recovery.draft.name}” — {recovery.draft.objects.length} layer{recovery.draft.objects.length === 1 ? '' : 's'},
              last edited {describeAge(recovery.savedAt, Date.now())} on this device and never saved.
            </p>
            {recovery.droppedAssets > 0 && (
              <p className="font-sans text-[11px] text-amber-300/80 leading-relaxed mb-1">
                {recovery.droppedAssets} uploaded image{recovery.droppedAssets === 1 ? '' : 's'} couldn’t be restored —
                those layers come back empty and need re-uploading.
              </p>
            )}
            <p className="font-sans text-[11px] text-brand-muted/50 leading-relaxed mb-4">
              Restoring replaces what’s open right now.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={acceptRecovery}
                className="flex-1 py-2.5 bg-foil text-white font-bold text-[10px] font-label uppercase tracking-widest rounded-xl glow-accent transition active:scale-[0.98]"
              >
                Restore it
              </button>
              <button
                onClick={discardRecovery}
                className="px-4 py-2.5 rounded-xl bg-white/[0.04] text-[10px] font-label uppercase tracking-widest text-brand-muted/60 hover:text-brand-fg transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Unsaved work. The primary action SAVES rather than discards: the host
          pressed "back", not "throw this away", and the scene they built is
          worth more than the click they meant to make. Leaving without saving
          is still one tap, just a labelled one. */}
      {confirmLeave && (
        <ConfirmModal
          title="Save before you go?"
          confirmLabel={saving ? 'Saving…' : 'Save and leave'}
          busy={saving}
          body={
            autosave
              ? 'This scene has changes you haven’t saved yet. A local copy is kept on this device, but only saving publishes it to your event.'
              : 'This scene has changes you haven’t saved yet. Leaving now loses them.'
          }
          onConfirm={async () => {
            const ok = await handleSave();
            // `leaving` stands the guard down BEFORE navigating, so the popstate
            // trap does not intercept the exit the host just approved.
            if (ok) { setLeaving(true); setConfirmLeave(false); navigate(`${base}/library`); }
          }}
          onCancel={() => setConfirmLeave(false)}
          extraAction={{
            label: 'Leave without saving',
            onClick: () => { setLeaving(true); setConfirmLeave(false); navigate(`${base}/library`); },
          }}
        />
      )}
    </div>
    </FeatureHelpProvider>
  );
}
