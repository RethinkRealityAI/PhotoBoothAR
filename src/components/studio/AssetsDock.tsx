/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AssetsDock — the studio's left panel: ONE scrollable "My Assets" surface that
 * shows the host's full breadth of placeable assets at once, no tabs. A sticky
 * header (search + kind chips: All · Frames · Stickers · Filters · 3D) filters
 * every section together. Sections, in order:
 *   • Studio Library — the built-ins: frames, stickers, filters, head pieces
 *     (collapsible sub-groups with counts, default expanded).
 *   • Generated — AI-created experiences (config.generated, server-set marker).
 *   • Uploads — bucket file uploads + the image/GLB upload buttons + the host's
 *     own hand-made saved experiences ("My experiences").
 *   • Templates — reusable scene templates (open as a fresh draft; confirm-on-dirty).
 * Plus a collapsible "AI generate" block up top (frame/sticker via AiFramePanel,
 * 3D via AiGeneratePanel), adapting to the active chip.
 *
 * Clicking any tile ADDS it to the scene instantly (the reducer selects the new
 * object and flips the stage view to fit) and drops ONE compact confirmation row
 * under that tile's row: "Added — edit in Properties". This panel edits NOTHING.
 *
 * It used to. A compact settings card expanded under the clicked tile carrying a
 * SUBSET of the right dock's controls — size/rotation for overlays, attachment
 * point/size/occlusion for 3D, shader params for filters — so the same property
 * existed in two places, disagreed about which subset mattered, and taught hosts
 * that "properties are wherever you last clicked". The 3D case was the worst:
 * attachment points are the single most confusing control in the studio and they
 * appeared in a 19rem column, below the fold, beside a grid of thumbnails. Every
 * one of those controls exists in PropertiesDock (which is where the selection
 * they edit is already shown), so the card is gone and the row that replaces it
 * POINTS there — opening the properties drawer on phones/tablets, where that
 * dock is otherwise off-screen.
 *
 * Drag-onto-canvas still works (beginDrag / consumedDrag guards preserved). The
 * GLB add is async (measure-then-dispatch) — the tile keeps its "adding" spinner
 * while it's in flight and the row says "Adding to scene…" until it lands.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Boxes, Check, ChevronDown, ChevronRight, Crown, FileStack, Gem, Glasses, Image as ImageIcon, Loader2, Palette, Search, Sparkles, Sun, Upload, Wand2, X } from 'lucide-react';
import { FILTER_SHADERS, SHADER_MAP, defaultParams } from '../../lib/shaders';
import { BUILTIN_BORDERS, toDataUrl } from '../../lib/borders';
import { HEAD_PIECES } from '../../lib/headPieces';
import { uploadAsset, listAssetsResult, fetchExperiencesResult } from '../../lib/db';
import { captureGlbThumbnail, measureGlbFitScale } from '../../lib/studio/glbThumb';
import type { LightingPresetId } from '../../lib/studio/lighting';
import { PROP_TARGET_CM } from '../../lib/studio/bustFit';
import {
  LIBRARY_ASSET_CHECKLIST,
  LIBRARY_EMPTY_MESSAGE,
  assetTemplateOf,
  libraryAssets,
} from '../../lib/studio/assetLibrary';
import { useEvent } from '../../events/EventContext';
import { useEntitlements } from '../../lib/entitlements';
import { SCENE_FULL_MESSAGE, canAddObject, selectedObject, sceneCounts, MAX_OBJECTS, type Overlay2D, type StudioAction, type StudioState } from '../../lib/studio/state';
import { experienceToDraft } from '../../lib/studio/draftMapping';
import { SectionLabel } from './StudioControls';
import AiFramePanel from './AiFramePanel';
import AiGeneratePanel from '../admin/creator3d/AiGeneratePanel';
import HelpButton from './HelpButton';
import type { DragPayload } from './useStudioDnd';
import type { Experience } from '../../types';
import {
  uploadsToDockItems,
  experiencesToDockItems,
  splitExperiences,
  filterDockByChip,
  stripTemplateSuffix,
  dockItemKind,
  isDockItemInScene,
  type DockItem,
  type AssetChip,
} from '../../lib/studio/assetSources';

// Lazy: the jewelry builder pulls in TextGeometry, the GLTF exporter and the
// bundled typefaces, none of which the dock needs until the host opens it.
const Text3DBuilder = lazy(() => import('./Text3DBuilder'));

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  onOpenExperience: (exp: Experience) => void;
  beginDrag: (payload: DragPayload, e: React.PointerEvent) => void;
  consumedDrag: () => boolean;
  /** Event lighting rig — passed straight through to the jewelry builder so its
   *  live preview is lit exactly like the booth (otherwise a host tuning a
   *  chrome necklace under 'Neon' would be judging it under 'Studio'). */
  lighting: LightingPresetId;
  /** Reveal the right-hand Properties dock — the ONLY place assets are edited.
   *  Below lg that dock is an off-screen drawer, so the "edit in Properties"
   *  row would otherwise point at something the host cannot see. */
  onOpenProperties: () => void;
}

// Head pieces are procedural (no image asset) — a distinctive icon per piece
// keeps the catalog reading as a visual grid rather than text pills. Falls back
// to the generic 3D glyph for any future piece added without an icon here.
const HEAD_PIECE_ICONS: Record<string, typeof Crown> = {
  'royal-crown': Crown,
  'queen-tiara': Gem,
  'cheek-stars': Sparkles,
  'hope-halo': Sun,
  'neon-shades': Glasses,
};

// The kind filter chips across the whole surface — pure browsing UI (never
// touches the draft). 'filter' shows only the built-in shader list.
const KIND_CHIPS: { id: AssetChip; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'frame', label: 'Frames' },
  { id: 'sticker', label: 'Stickers' },
  { id: 'filter', label: 'Filters' },
  { id: '3d', label: '3D' },
];

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
interface UploadsState { status: LoadStatus; items: DockItem[] }
interface ExperiencesState { status: LoadStatus; templates: Experience[]; generated: DockItem[]; mine: DockItem[] }

// A normalized tile — every grid section (built-ins, head pieces, generated,
// uploads, mine) renders through renderTiles so the "Added — edit in Properties"
// row can be injected uniformly below the clicked tile's row.
interface Tile {
  key: string;
  label: string;
  previewUrl: string | null;
  active: boolean;
  fallbackIcon: typeof Boxes;
  drag: DragPayload;
  pending: boolean;
  /** Short label for what clicking this tile ADDS ('Frame' / 'Sticker' / '3D').
   *  Omitted where the section header already makes it unambiguous. */
  kindBadge?: string;
  onAdd: () => void;
}

/** Badge copy per resolved tile kind. A bare uploaded image has no declared
 *  overlayKind and is placed as a FRAME, so it must say so. */
const KIND_BADGE: Record<ReturnType<typeof dockItemKind>, string> = {
  frame: 'Frame',
  sticker: 'Sticker',
  '3d': '3D',
  image: 'Frame',
};

/**
 * Filename marker stamped by Text3DBuilder's upload (`<name>-<kind>.bw1.glb`).
 * Those pieces are authored in true head-space centimetres, so the measure-then-
 * add auto-fit MUST be skipped for them: computePropFitScale normalizes any
 * model to PROP_TARGET_CM (24cm), which would blow a life-size 15cm necklace up
 * to something wider than the head it hangs on.
 */
const AUTHORED_CM_MARKER = '.bw1';

function isAuthoredInCm(url: string | null | undefined, label: string): boolean {
  const u = (url ?? '').toLowerCase();
  return u.endsWith(`${AUTHORED_CM_MARKER}.glb`) || label.toLowerCase().endsWith(AUTHORED_CM_MARKER);
}

/**
 * Built-in SVG → data-URL cache, keyed by built-in id.
 *
 * `builtinTiles` called toDataUrl(b.svg) for EVERY built-in on EVERY render, and
 * toDataUrl does a regex replace plus encodeURIComponent over a multi-kilobyte
 * SVG string (src/lib/borders.ts:46-48). With ~30 built-ins that is ~30 full
 * string encodes per render — and this dock re-rendered on every frame of an
 * overlay drag. The bytes are immutable, so the encode happens once per id per
 * page load. Module-level, so it survives dock remounts too.
 */
const builtinDataUrls = new Map<string, string>();
function builtinDataUrl(id: string, svg: string): string {
  let url = builtinDataUrls.get(id);
  if (url === undefined) {
    url = toDataUrl(svg);
    builtinDataUrls.set(id, url);
  }
  return url;
}

/** Smooth expand/collapse for dock sub-groups and the just-added confirmation
 *  row — the PickerDrawer height/opacity idiom; prefers-reduced-motion snaps. */
function Collapse({ show, children }: { show: boolean; children: ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function AssetsDock({ state, dispatch, onOpenExperience, beginDrag, consumedDrag, lighting, onOpenProperties }: Props) {
  const { draft } = state;
  const { source, eventId } = useEvent();
  const entitlements = useEntitlements();
  const imgInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const show3dAi = source === 'db' && entitlements.aiStudio;

  const [chip, setChip] = useState<AssetChip>('all');
  const [query, setQuery] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  // Which tile was JUST added — its "Added — edit in Properties" row shows under
  // that tile's grid row (section-prefixed key so ids never collide across
  // sections) — and a model tile whose async GLB measure is still in flight
  // (drives the "adding" spinner on that tile AND the row's pending copy).
  const [addedKey, setAddedKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // The object id the open confirmation row adopted (and the tile key it belongs
  // to) — the row auto-dismisses if the live selection moves off it (see the
  // guard effect after the selection is derived below).
  const cardObjIdRef = useRef<string | null>(null);
  const cardKeyRef = useRef<string | null>(null);
  // Collapsible Studio-Library sub-groups (default all expanded → collapsed:false).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [uploads, setUploads] = useState<UploadsState>({ status: 'idle', items: [] });
  const [experiences, setExperiences] = useState<ExperiencesState>({ status: 'idle', templates: [], generated: [], mine: [] });
  const [confirmTemplateId, setConfirmTemplateId] = useState<string | null>(null);
  // Auto-captured thumbnail for the most recently uploaded GLB — shown on the
  // "Upload model" tile itself (best-effort; null while capturing/on failure).
  const [modelThumb, setModelThumb] = useState<string | null>(null);
  /** Busy/error for the GLB upload — a failed storage write used to be silent. */
  const [glbUpload, setGlbUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [jewelryOpen, setJewelryOpen] = useState(false);

  // Both remote sources load eagerly on mount — the point of the single surface
  // is to show everything at once, so there are no tabs to lazy-load behind.
  // Both remote reads use the *Result siblings. The plain helpers RESOLVE with []
  // on failure (they log and swallow), so these .catch branches were unreachable
  // dead code: a Supabase outage rendered as a confidently empty library with no
  // error and no retry. `failed` is the only honest signal.
  const loadUploads = useCallback(() => {
    setUploads({ status: 'loading', items: [] });
    listAssetsResult(eventId)
      .then(({ rows, failed }) =>
        setUploads(failed ? { status: 'error', items: [] } : { status: 'ready', items: uploadsToDockItems(rows) }))
      .catch(() => setUploads({ status: 'error', items: [] }));
  }, [eventId]);
  const loadExperiences = useCallback(() => {
    setExperiences({ status: 'loading', templates: [], generated: [], mine: [] });
    fetchExperiencesResult(eventId)
      .then(({ rows, failed }) => {
        if (failed) { setExperiences({ status: 'error', templates: [], generated: [], mine: [] }); return; }
        const { templates, generated, mine } = splitExperiences(rows.filter((e) => e.id !== draft.id));
        setExperiences({
          status: 'ready',
          templates,
          generated: experiencesToDockItems(generated),
          mine: experiencesToDockItems(mine),
        });
      })
      .catch(() => setExperiences({ status: 'error', templates: [], generated: [], mine: [] }));
  }, [eventId, draft.id]);
  useEffect(() => { loadUploads(); }, [loadUploads]);
  useEffect(() => { loadExperiences(); }, [loadExperiences]);

  // Opens a template as a fresh, unsaved draft — NOT add-as-layer (a template can
  // be a whole composite/shader scene). Strips the id (LOAD clears history +
  // `dirty`) and the " (template)" name suffix. Dirty-draft guard renders as an
  // inline liquid-glass confirm on the tile (the app's idiom — no window.confirm).
  const useTemplate = useCallback((exp: Experience, confirmed = false) => {
    if (state.dirty && !confirmed) { setConfirmTemplateId(exp.id); return; }
    setConfirmTemplateId(null);
    const loaded = experienceToDraft(exp);
    if (!loaded) return;
    const { id: _id, ...rest } = loaded;
    void _id;
    // A reused template starts Live like any fresh draft — the template ROW is
    // forced hidden, but that must not make experiences built FROM it unpublished.
    //
    // dirty:true — a template opened this way is UNSAVED work from the instant
    // it lands. LOAD used to force dirty:false, so the leave-guard was disarmed
    // on a scene that existed nowhere but in this tab (the same hole Duplicate
    // had); it is now guarded and autosaved like any other unsaved draft.
    dispatch({ type: 'LOAD', draft: { ...rest, isPublished: true, name: stripTemplateSuffix(exp.name) }, dirty: true });
  }, [state.dirty, dispatch]);

  // Click-to-add for an Uploads/Generated/Mine dock item — mirrors the built-in
  // library's handlers, guarded by consumedDrag() at the call site. Also flags
  // the tile as the just-added one, so its confirmation row shows.
  const addDockItem = useCallback((item: DockItem, key: string) => {
    setAddedKey(key);
    if (item.family === '2d') {
      if (item.payload.url) {
        // Explicit sub-kind: the item's own kind, else the active chip (sticker),
        // else 'border' (without it a sticker-chip upload would land as a frame).
        const overlayKind = item.payload.overlayKind ?? (chip === 'sticker' ? '2d_filter' as const : 'border' as const);
        dispatch({ type: 'SET_OVERLAY_UPLOAD', url: item.payload.url, blob: null, overlayKind });
      }
      return;
    }
    if (item.payload.proceduralId) {
      dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: item.payload.proceduralId });
    } else if (item.payload.assetUrl) {
      // Measure-then-add: auto-fit the GLB to head-space cm at ADD time (a raw
      // Meshy model is ~1 unit ≈ 1cm — invisible). null → legacy scale 1. The
      // tile shows an "adding" spinner until the measure resolves and dispatches.
      const url = item.payload.assetUrl;
      const label = item.label;
      // Procedural jewelry is already life-size — add it at scale 1 without the
      // async measure, so re-adding a saved piece matches how it was authored.
      if (isAuthoredInCm(url, label)) {
        dispatch({ type: 'SET_MODEL_ASSET', url, name: label, scale: 1 });
        return;
      }
      setPendingKey(key);
      void measureGlbFitScale(url)
        .then((fitScale) => dispatch({ type: 'SET_MODEL_ASSET', url, name: label, scale: fitScale ?? undefined }))
        .finally(() => setPendingKey((k) => (k === key ? null : k)));
    }
  }, [dispatch, chip]);

  // Drag payload for a dock item — useStudioDnd's resolveDrop reads `assetUrl`
  // (not `url`) for the non-builtin overlay branch, so payload.url maps here.
  const dragPayloadFor = useCallback((item: DockItem): DragPayload => {
    if (item.family === '2d') {
      return {
        target: 'overlay',
        label: item.label,
        previewUrl: item.previewUrl,
        overlayKind: item.payload.overlayKind ?? (chip === 'sticker' ? '2d_filter' : 'border'),
        assetUrl: item.payload.url,
      };
    }
    if (item.payload.proceduralId) {
      return { target: 'headpiece', label: item.label, previewUrl: item.previewUrl, pieceId: item.payload.proceduralId };
    }
    return { target: 'model', label: item.label, previewUrl: item.previewUrl, assetUrl: item.payload.assetUrl };
  }, [chip]);

  const onImageUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // The active chip names the intended sub-kind (sticker → 2d_filter, else frame).
    const overlayKind = chip === 'sticker' ? '2d_filter' as const : 'border' as const;
    // Carry the picked file's name through. Every 2D upload used to be stamped
    // 'Custom overlay', so the Uploads grid became N identical tiles a host had
    // no way to tell apart.
    dispatch({
      type: 'SET_OVERLAY_UPLOAD',
      url: URL.createObjectURL(file),
      blob: file,
      overlayKind,
      name: file.name.replace(/\.[^.]+$/, ''),
    });
    e.target.value = '';
  }, [dispatch, chip]);

  const onGlbUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setModelThumb(null);
    // A GLB upload + fit measurement can take many seconds. Without a busy state
    // the host gets no feedback at all, and `if (!url) return` turned a failed
    // storage write (quota, RLS, offline) into a silent no-op — they picked a
    // file and the studio simply ignored it.
    setGlbUpload({ busy: true, error: null });
    let url: string | null = null;
    try {
      url = await uploadAsset(eventId, file, file.name);
    } catch {
      url = null;
    }
    if (!url) {
      setGlbUpload({ busy: false, error: "Upload failed — check your connection and try again." });
      return;
    }
    setGlbUpload({ busy: false, error: null });
    loadUploads();
    const fitScale = await measureGlbFitScale(url);
    dispatch({ type: 'SET_MODEL_ASSET', url, name: file.name, scale: fitScale ?? undefined });
    // Best-effort thumbnail capture — the model is already saved and selected
    // above, so a capture/upload failure here must never surface as a failed
    // model upload; it just leaves the tile on its plain Upload-icon look.
    try {
      const thumbBlob = await captureGlbThumbnail(url);
      if (!thumbBlob) return;
      const thumbUrl = await uploadAsset(eventId, thumbBlob, `${file.name}.thumb`);
      if (thumbUrl) setModelThumb(thumbUrl);
    } catch (err) {
      console.error('[AssetsDock] GLB thumbnail capture failed', err);
    }
  }, [dispatch, eventId, loadUploads]);

  // The selected object drives which library item reads as "active" and which
  // name the confirmation row shows (the reducer selects each just-added object).
  const sel = selectedObject(draft);
  /**
   * A stable signature of WHAT is in the scene, ignoring where it sits.
   *
   * Everything below depends on scene membership, not on placement — but
   * `draft.objects` is a brand-new array on every UPDATE_OBJECT, i.e. on every
   * frame of a drag. Keying the memos on this string means a drag (which only
   * ever changes transforms) leaves every derived tile list untouched.
   */
  const placementKey = draft.objects
    .map((o) => (o.type === 'overlay' ? `o:${o.url ?? ''}` : o.type === 'model' ? `m:${o.assetUrl ?? ''}` : `p:${o.proceduralId ?? ''}`))
    .join('|');

  // Identity of everything currently in the scene, for the in-scene tile ring.
  const placedRefs = useMemo(
    () => draft.objects.map((o) => ({
      url: o.type === 'overlay' ? o.url : null,
      assetUrl: o.type === 'model' ? o.assetUrl : null,
      proceduralId: o.type === 'headpiece' ? o.proceduralId : null,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placementKey IS the
    // membership identity of draft.objects; depending on the array itself would
    // rebuild this on every drag frame, which is the whole point of the key.
    [placementKey],
  );
  // Scene at the object cap → adds will be refused, so say so BEFORE the click.
  const counts = sceneCounts(draft);
  const capReached = !canAddObject(draft);
  const selBuiltinId = sel && sel.type === 'overlay' && sel.isBuiltin ? sel.builtinId : undefined;
  const selProceduralId = sel && sel.type === 'headpiece' ? sel.proceduralId : undefined;
  // The scene's single frame (if any) — highlights the active frame regardless
  // of which layer is currently selected.
  const sceneFrame = draft.objects.find(
    (o): o is Overlay2D => o.type === 'overlay' && o.overlayKind === 'border',
  );

  const selId = sel?.id ?? null;
  // Keep the confirmation row honest about WHICH add it is confirming. It is
  // written against the just-added object, so an EXTERNAL selection move (e.g. a
  // Director add landing, or the host picking another layer) means the row is
  // now describing something that is no longer what the Properties dock will
  // show — so it dismisses instead of lying. Track the object id the row adopted
  // and clear when the live selection stops matching it.
  // Race window: a tile click sets addedKey a frame before its OWN add lands
  // (immediate for sync adds; deferred through the async GLB measure for model
  // adds, marked by pendingKey === addedKey) — so (re)adopt when the row's key
  // changes and defer adoption while that add is still pending.
  useEffect(() => {
    const objectRow = !!addedKey && !addedKey.startsWith('filter:');
    if (!objectRow) { cardKeyRef.current = addedKey; cardObjIdRef.current = null; return; }
    if (cardKeyRef.current !== addedKey) {          // a different tile's row opened
      cardKeyRef.current = addedKey;
      cardObjIdRef.current = pendingKey === addedKey ? null : selId; // defer if its add is in flight
      return;
    }
    if (cardObjIdRef.current === null) {               // deferred adoption: the add's object just landed
      if (pendingKey !== addedKey && selId) cardObjIdRef.current = selId;
      return;
    }
    if (selId && selId !== cardObjIdRef.current) {     // selection moved to another object → dismiss
      setAddedKey(null);
      cardKeyRef.current = null;
      cardObjIdRef.current = null;
    }
  }, [selId, addedKey, pendingKey]);

  const q = query.trim().toLowerCase();
  const matchQuery = (name: string) => !q || name.toLowerCase().includes(q);

  /**
   * The ONE row that replaced the inline settings card.
   *
   * It confirms the add, names the thing that landed, and says — in words, not
   * by implication — where its controls are; below lg it also OPENS that dock,
   * which is a drawer there. Deliberately one line high: anything taller starts
   * competing with the Properties dock for the same job, which is the confusion
   * this whole change removes.
   */
  const renderAddedRow = (key: string): ReactNode => {
    const adding = pendingKey === key;
    // A filter tile edits the scene's single filter slot, not an object, so it
    // has no selection to name — its params live in the same dock (under
    // the Assets tab's block when nothing is selected, under Scene when something is).
    const isFilter = key.startsWith('filter:');
    const landed = isFilter ? SHADER_MAP[draft.shaderId] != null : sel != null;
    // Nothing landed and nothing is in flight → say nothing. (An add refused at
    // the object cap takes this path; the cap banner at the top of the dock is
    // the honest explanation, not a confirmation row for a thing that is
    // not there.)
    if (!landed && !adding) return null;
    return (
      <button
        onClick={onOpenProperties}
        disabled={adding}
        className="pressable group flex items-center gap-2 w-full min-h-11 rounded-xl liquid-glass px-3 text-left transition-colors hover:bg-white/[0.06] disabled:pointer-events-none"
      >
        {adding
          ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-accent-2" />
          : <Check className="w-3.5 h-3.5 shrink-0 text-accent-2" />}
        {/* The asset's NAME is deliberately not in here. It did not fit — at the
            dock's 19rem the row rendered "Gold Border added — edit in Prope…",
            truncating the half that says what to DO. The highlighted tile
            directly above already names it, and so does the Properties header
            this row points at. */}
        <span className="flex-1 min-w-0 truncate font-sans text-[10px] leading-snug text-brand-muted/70">
          {adding ? 'Adding to scene…' : <><span className="text-brand-fg">Added</span> — edit in Properties</>}
        </span>
        {!adding && <ArrowRight className="w-3.5 h-3.5 shrink-0 text-accent-2/70 group-hover:text-accent-2 transition-colors" />}
      </button>
    );
  };

  // Renders a set of tiles as rows of 3 (every grid here is grid-cols-3), then
  // injects the "Added — edit in Properties" row as a full-width row directly
  // BELOW the grid row holding the tile that was clicked, so the confirmation
  // lands where the host's eye already is.
  const renderTiles = (tiles: Tile[], aspect: 'square' | 'frame'): ReactNode => {
    const rows: Tile[][] = [];
    for (let i = 0; i < tiles.length; i += 3) rows.push(tiles.slice(i, i + 3));
    const aspectCls = aspect === 'frame' ? 'aspect-[9/16]' : 'aspect-square';
    return (
      <div className="flex flex-col gap-1.5">
        {rows.map((row, ri) => {
          const expanded = row.find((t) => t.key === addedKey);
          return (
            <div key={ri} className="flex flex-col gap-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                {row.map((t) => {
                  const Icon = t.fallbackIcon;
                  return (
                    <button
                      key={t.key}
                      onPointerDown={(e) => beginDrag(t.drag, e)}
                      onClick={() => { if (consumedDrag()) return; t.onAdd(); }}
                      title={`${t.label} · click to add · drag to place`}
                      className={`group relative ${aspectCls} rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-colors border ${t.active ? 'border-accent/40 ring-1 ring-accent/30 bg-accent/[0.06]' : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06] hover:border-accent/25'}`}
                    >
                      {t.previewUrl ? (
                        <img src={t.previewUrl} alt={t.label} draggable={false} className="w-full h-full object-contain p-1.5" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Icon className="w-4 h-4 text-brand-muted/40" /></div>
                      )}
                      <span className={`absolute inset-x-0 bottom-0 px-1 py-0.5 text-[7px] font-label uppercase tracking-wide truncate ${t.active ? 'bg-accent/30 text-accent-2' : 'bg-black/60 text-white/80'}`}>{t.label}</span>
                      {/* What this tile becomes when clicked. A bare uploaded
                          image shows under BOTH the Frames and Stickers chips
                          but lands as a FRAME under "All" — which silently
                          replaces the scene's existing frame. Saying so up front
                          is the difference between a choice and a surprise. */}
                      {t.kindBadge && (
                        <span className="absolute top-0.5 left-0.5 px-1 py-px rounded-full bg-black/70 text-accent-2 font-label text-[7px] uppercase tracking-widest">
                          {t.kindBadge}
                        </span>
                      )}
                      {t.pending && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Loader2 className="w-4 h-4 animate-spin text-accent-2" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <Collapse show={!!expanded}>{expanded ? renderAddedRow(expanded.key) : null}</Collapse>
            </div>
          );
        })}
      </div>
    );
  };

  // Built-in frames/stickers → SELECT_BUILTIN (the reducer swaps the one frame in
  // place / appends stickers, and flips the view to 2D). Frames highlight the
  // scene's frame; stickers highlight the selected sticker. Legacy-branded
  // built-ins (baked event text — see BuiltinBorder.legacy) never surface here:
  // self-serve hosts only see the generic library. Legacy events still resolve
  // them by id through their event config (catalog.ts / BORDER_MAP).
  // Every tile list below is MEMOISED. They used to be rebuilt on each render —
  // ~30 SVG data-URL encodes, a full re-map of every dock item and a fresh
  // chip/query filter pass — and this dock re-renders on every frame of an
  // overlay drag, because the shell hands it the whole studio state.
  const builtinTiles = useCallback((kind: 'border' | '2d_filter'): Tile[] =>
    BUILTIN_BORDERS.filter((b) => !b.legacy && b.kind === kind && matchQuery(b.name)).map((b) => {
      const url = builtinDataUrl(b.id, b.svg);
      const active = kind === 'border' ? sceneFrame?.builtinId === b.id : selBuiltinId === b.id;
      const key = `builtin:${b.id}`;
      return {
        key,
        label: b.name,
        previewUrl: url,
        active,
        fallbackIcon: ImageIcon,
        pending: false,
        drag: { target: 'overlay', label: b.name, overlayKind: b.kind, builtinId: b.id, builtinUrl: url, previewUrl: url },
        onAdd: () => { dispatch({ type: 'SELECT_BUILTIN', borderId: b.id, url }); setAddedKey(key); },
      };
    }),
    // `matchQuery` closes over `q`; sceneFrame/selBuiltinId are compared by ID,
    // so a transform-only change leaves all three deps identical.
    [q, sceneFrame?.builtinId, selBuiltinId, dispatch], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * CONFIGURABLE MODELS — the curated shelf from lib/studio/assetLibrary.ts.
   *
   * The only tile kind that carries a `template` on the way in. Without it the
   * model lands as a plain GLB and the personalisation controls in the right
   * dock have nothing to attach to — which is exactly what every SET_MODEL_ASSET
   * call site did before this, so the feature's own controls never appeared.
   *
   * The fit measure runs exactly as it does for an upload, but retargeted: a
   * library asset states its own real-world size (`template.fitCm`), and
   * `measureGlbFitScale` reports the multiplier that lands the model at the
   * generic PROP_TARGET_CM. Scaling by their ratio is what makes a 2cm earring
   * arrive as an earring instead of as a 24cm one.
   */
  const configurableTiles = useCallback((): Tile[] =>
    libraryAssets(import.meta.env.DEV)
      .filter((a) => matchQuery(a.name))
      .flatMap((a) => {
        const template = assetTemplateOf(a);
        // A catalogue entry whose descriptor does not validate is not offered at
        // all. Its colocated test asserts this can never happen for shipped
        // content, so reaching here means someone hand-edited the data.
        if (!template) return [];
        const key = `cfg:${a.id}`;
        const drag: DragPayload = {
          target: 'model',
          label: a.name,
          previewUrl: null,
          assetUrl: template.glbUrl,
          template: a.template,
        };
        return [{
          key,
          label: a.name,
          previewUrl: null,
          active: placedRefs.some((p) => p.assetUrl === template.glbUrl || p.url === template.glbUrl),
          fallbackIcon: Palette,
          pending: pendingKey === key,
          kindBadge: a.demo ? 'Demo' : 'Personalise',
          drag,
          onAdd: () => {
            setAddedKey(key);
            setPendingKey(key);
            void measureGlbFitScale(template.glbUrl)
              .then((fitScale) => dispatch({
                type: 'SET_MODEL_ASSET',
                url: template.glbUrl,
                name: a.name,
                scale: fitScale != null ? (fitScale * template.fitCm) / PROP_TARGET_CM : undefined,
                template: a.template,
                offsetCm: a.defaultNudgeCm,
              }))
              .finally(() => setPendingKey((k) => (k === key ? null : k)));
          },
        }];
      }),
    [q, placedRefs, pendingKey, dispatch], // eslint-disable-line react-hooks/exhaustive-deps -- matchQuery closes over q
  );

  const headPieceTiles = useCallback((): Tile[] =>
    HEAD_PIECES.filter((p) => matchQuery(p.name)).map((p) => {
      const key = `piece:${p.id}`;
      return {
        key,
        label: p.name,
        previewUrl: null,
        active: selProceduralId === p.id,
        fallbackIcon: HEAD_PIECE_ICONS[p.id] ?? Boxes,
        pending: false,
        drag: { target: 'headpiece', label: p.name, pieceId: p.id },
        onAdd: () => { dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: p.id }); setAddedKey(key); },
      };
    }),
    [q, selProceduralId, dispatch], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dockTiles = useCallback((items: DockItem[], prefix: string): Tile[] =>
    filterDockByChip(items, chip, query).map((item) => {
      const key = `${prefix}:${item.id}`;
      return {
        key,
        label: item.label,
        previewUrl: item.previewUrl,
        // Was hard-coded false, so an upload/generated/saved asset never showed
        // as already-in-scene even though built-in tiles did.
        active: isDockItemInScene(item, placedRefs),
        fallbackIcon: item.family === '3d' ? Boxes : ImageIcon,
        pending: pendingKey === key,
        kindBadge: KIND_BADGE[dockItemKind(item)],
        drag: dragPayloadFor(item),
        onAdd: () => addDockItem(item, key),
      };
    }),
    [chip, query, placedRefs, pendingKey, dragPayloadFor, addDockItem],
  );

  // Filters are a descriptive list (no visual preview), not a tile grid — the
  // confirmation row lands right below the clicked row and the params themselves
  // live in the Properties dock. Preserves CLEAR_FILTER and SELECT_SHADER + the
  // manual SET_MODE '2d' (SELECT_SHADER alone doesn't flip view).
  const renderFilters = (): ReactNode => {
    const shaders = FILTER_SHADERS.filter((s) => matchQuery(s.name));
    return (
      <div className="flex flex-col gap-1">
        {!q && (
          <button
            onClick={() => { dispatch({ type: 'CLEAR_FILTER' }); setAddedKey(null); }}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${draft.shaderId === 'none' ? 'bg-accent/15 ring-1 ring-accent/30 text-accent-2' : 'bg-white/[0.03] hover:bg-white/[0.06] text-brand-muted/70 hover:text-brand-fg'}`}
          >
            <X className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs font-sans font-medium">No filter</span>
          </button>
        )}
        {shaders.map((s) => {
          const active = draft.shaderId === s.id;
          const key = `filter:${s.id}`;
          return (
            <div key={s.id}>
              <button
                onClick={() => {
                  dispatch({ type: 'SELECT_SHADER', shaderId: s.id, params: defaultParams(s.id) });
                  dispatch({ type: 'SET_MODE', mode: '2d' });
                  setAddedKey(key);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${active ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}
              >
                <div className="flex items-center justify-between">
                  <p className={`text-xs font-sans font-medium ${active ? 'text-accent-2' : 'text-brand-fg'}`}>{s.name}</p>
                  {s.animated && <span className="text-[7px] font-label uppercase tracking-widest text-accent-2/60 bg-accent/10 px-1.5 py-0.5 rounded-full">Anim</span>}
                </div>
                <p className="text-[9px] text-brand-muted/40 mt-0.5 leading-tight">{s.description}</p>
              </button>
              <Collapse show={addedKey === key}>{addedKey === key ? renderAddedRow(key) : null}</Collapse>
            </div>
          );
        })}
      </div>
    );
  };

  // A collapsible Studio-Library sub-group with a count; hidden entirely at 0.
  const subGroup = (id: string, label: string, count: number, body: ReactNode): ReactNode => {
    if (count === 0) return null;
    const isCollapsed = collapsed[id] ?? false;
    return (
      <div>
        <button
          onClick={() => setCollapsed((c) => ({ ...c, [id]: !isCollapsed }))}
          className="flex items-center gap-1.5 w-full mb-1.5 text-brand-muted/60 hover:text-brand-fg transition-colors"
        >
          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          <span className="font-label uppercase tracking-widest text-[9px]">{label}</span>
          <span className="font-mono text-[8px] text-brand-muted/50">{count}</span>
        </button>
        <Collapse show={!isCollapsed}>{body}</Collapse>
      </div>
    );
  };

  // ── Derived section data (chip- and query-filtered) ──
  const showFrames = chip === 'all' || chip === 'frame';
  const showStickers = chip === 'all' || chip === 'sticker';
  const showFilters = chip === 'all' || chip === 'filter';
  const showHeadPieces = chip === 'all' || chip === '3d';

  const frameTiles = useMemo(() => (showFrames ? builtinTiles('border') : []), [showFrames, builtinTiles]);
  const stickerTiles = useMemo(() => (showStickers ? builtinTiles('2d_filter') : []), [showStickers, builtinTiles]);
  const headTiles = useMemo(() => (showHeadPieces ? headPieceTiles() : []), [showHeadPieces, headPieceTiles]);
  const cfgTiles = useMemo(() => (showHeadPieces ? configurableTiles() : []), [showHeadPieces, configurableTiles]);
  // The configurable shelf is the one sub-group that renders when it is EMPTY:
  // it is empty by design until the owner adds content (see assetLibrary.ts), and
  // a section that simply vanishes teaches a host that the feature does not
  // exist. Only under the 3D chip and only with no active search, so it never
  // masquerades as a search result.
  const showCfgEmpty = showHeadPieces && cfgTiles.length === 0 && !q;
  const filterCount = useMemo(
    () => (showFilters ? FILTER_SHADERS.filter((s) => matchQuery(s.name)).length : 0),
    [showFilters, q], // eslint-disable-line react-hooks/exhaustive-deps -- matchQuery closes over q
  );
  const libraryCount = frameTiles.length + stickerTiles.length + headTiles.length + filterCount + cfgTiles.length;

  const generatedTiles = useMemo(() => dockTiles(experiences.generated, 'gen'), [dockTiles, experiences.generated]);
  const uploadTiles = useMemo(() => dockTiles(uploads.items, 'up'), [dockTiles, uploads.items]);
  const mineTiles = useMemo(() => dockTiles(experiences.mine, 'mine'), [dockTiles, experiences.mine]);
  // Templates are whole scenes, not a single kind — only under the 'all' chip.
  const templates = (chip === 'all' ? experiences.templates : []).filter((t) => matchQuery(t.name));

  const showImageUpload = chip === 'all' || chip === 'frame' || chip === 'sticker';
  const showGlbUpload = chip === 'all' || chip === '3d';
  const showUploadsSection = showImageUpload || showGlbUpload || uploadTiles.length > 0 || mineTiles.length > 0;
  // Whether the panel has any ASSET to show. Deliberately excludes the upload
  // buttons: `showUploadsSection` is true for every chip except Filters, so the
  // old `anythingVisible` was effectively always true and the "no results" line
  // could never render — a search matching nothing showed a blank panel with two
  // upload buttons and no explanation.
  const hasContent =
    libraryCount > 0 || generatedTiles.length > 0 || uploadTiles.length > 0 || mineTiles.length > 0 || templates.length > 0;

  // AI generate — frame/sticker via AiFramePanel, 3D via AiGeneratePanel; nothing
  // for the 'filter' chip (shaders aren't AI-generated).
  const aiKind: 'border' | '2d_filter' = chip === 'sticker' ? '2d_filter' : 'border';
  const showAi3d = chip === '3d' && show3dAi;
  const showAiOverlay = chip !== '3d' && chip !== 'filter';
  const showAi = showAiOverlay || showAi3d;

  const stillLoading = experiences.status === 'loading' || uploads.status === 'loading';

  return (
    <div className="h-full overflow-y-auto hide-scrollbar flex flex-col">
      {/* Sticky header — title + search + kind chips filter every section together */}
      <div className="sticky top-0 z-10 app-bg flex flex-col gap-2.5 px-4 pt-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-1.5">
          <span className="font-label uppercase tracking-widest text-[10px] text-brand-fg">My Assets</span>
          <HelpButton topic="library" label="How the studio library works" side="right" />
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-brand-muted/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assets…"
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-white/[0.03] text-[11px] text-brand-fg placeholder:text-brand-muted/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        </div>
        <div className="grid grid-cols-5 gap-1">
          {KIND_CHIPS.map((c) => (
            <button
              key={c.id}
              onClick={() => setChip(c.id)}
              className={`py-1.5 rounded-lg text-[9px] font-label uppercase tracking-widest transition-colors ${chip === c.id ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6 px-4 pt-4 pb-8">
        {/* Scene full — stated at the TOP of the dock, before any tile is
            clicked. Adds past the cap no-op silently in the reducer, so without
            this the host clicks an asset and simply nothing happens. */}
        {capReached && (
          <p role="status" className="rounded-xl bg-amber-400/10 ring-1 ring-amber-400/25 px-3 py-2 font-sans text-[10px] leading-snug text-amber-200/90">
            {SCENE_FULL_MESSAGE} <span className="font-mono opacity-70">({counts.capped}/{MAX_OBJECTS})</span>
          </p>
        )}

        {/* AI generate — collapsible, chip-adaptive */}
        {showAi && (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setAiOpen((v) => !v)}
              className="flex items-center gap-1.5 w-full px-3 py-2 rounded-xl bg-accent/[0.06] hover:bg-accent/[0.1] border border-accent/15 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5 text-accent-2" />
              <span className="font-label uppercase tracking-widest text-[9px] text-accent-2 flex-1 text-left">
                Quick AI — single {showAi3d ? '3D piece' : aiKind === 'border' ? 'frame' : 'sticker'}
              </span>
              {aiOpen ? <ChevronDown className="w-3.5 h-3.5 text-accent-2/70" /> : <ChevronRight className="w-3.5 h-3.5 text-accent-2/70" />}
            </button>
            <p className="font-sans text-[9px] text-brand-muted/40 leading-relaxed px-1">
              Want a whole matching scene? Open the Director above.
            </p>
            <Collapse show={aiOpen}>
              {aiOpen ? (
                showAi3d ? (
                  <AiGeneratePanel onOpenExperience={onOpenExperience} />
                ) : (
                  <AiFramePanel
                    kind={aiKind}
                    freeTrial={!entitlements.aiStudio}
                    onGenerated={(exp) => {
                      if (exp.asset_url) dispatch({ type: 'SET_OVERLAY_UPLOAD', url: exp.asset_url, blob: null, overlayKind: aiKind });
                      if (draft.name.startsWith('Untitled') && exp.name) dispatch({ type: 'SET_NAME', name: exp.name });
                      loadExperiences(); // surface the new asset in the Generated section
                    }}
                  />
                )
              ) : null}
            </Collapse>
          </div>
        )}

        {/* STUDIO LIBRARY — built-ins, collapsible sub-groups */}
        {(libraryCount > 0 || showCfgEmpty) && (
          <div className="flex flex-col gap-4">
            <SectionLabel>Studio Library</SectionLabel>
            {subGroup('lib-frames', 'Frames', frameTiles.length, renderTiles(frameTiles, 'frame'))}
            {subGroup('lib-stickers', 'Stickers', stickerTiles.length, renderTiles(stickerTiles, 'square'))}
            {subGroup('lib-filters', 'Filters', filterCount, renderFilters())}
            {subGroup('lib-pieces', 'Head pieces', headTiles.length, renderTiles(headTiles, 'square'))}
            {(cfgTiles.length > 0 || showCfgEmpty) && subGroup(
              'lib-configurable',
              'Personalise',
              cfgTiles.length,
              cfgTiles.length > 0 ? renderTiles(cfgTiles, 'square') : (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-3 flex flex-col gap-2">
                  <p className="font-sans text-[10px] leading-relaxed text-brand-muted/60">{LIBRARY_EMPTY_MESSAGE}</p>
                  <ul className="flex flex-col gap-1">
                    {LIBRARY_ASSET_CHECKLIST.map((line) => (
                      <li key={line} className="flex gap-1.5 font-sans text-[9px] leading-relaxed text-brand-muted/40">
                        <span aria-hidden className="text-accent-2/50">·</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}

        {/* GENERATED — AI-created assets */}
        {experiences.status === 'error' ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="font-sans text-[10px] text-brand-muted/40">Couldn't load your experiences.</p>
            <button onClick={loadExperiences} className="text-[9px] font-label uppercase tracking-widest text-brand-muted/50 hover:text-accent-2 transition-colors">Retry</button>
          </div>
        ) : generatedTiles.length > 0 ? (
          <div className="flex flex-col gap-2">
            <SectionLabel>Generated</SectionLabel>
            {renderTiles(generatedTiles, 'square')}
          </div>
        ) : null}

        {/* UPLOADS — bucket files + upload buttons + hand-made experiences */}
        {showUploadsSection && (
          <div className="flex flex-col gap-4">
            <SectionLabel>Uploads</SectionLabel>
            {(showImageUpload || showGlbUpload) && (
              <div className="flex flex-col gap-1.5">
                {showImageUpload && (
                  <button
                    onClick={() => imgInputRef.current?.click()}
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs text-brand-muted/70"
                  >
                    <Upload className="w-3.5 h-3.5 text-accent-2" /> Upload image (PNG / JPG / SVG)
                  </button>
                )}
                {showGlbUpload && (
                  <button
                    onClick={() => glbInputRef.current?.click()}
                    disabled={glbUpload.busy}
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs text-brand-muted/70 overflow-hidden disabled:opacity-60"
                  >
                    {glbUpload.busy
                      ? <Loader2 className="w-3.5 h-3.5 text-accent-2 shrink-0 animate-spin" />
                      : modelThumb
                        ? <img src={modelThumb} alt="" className="w-5 h-5 object-contain shrink-0" />
                        : <Upload className="w-3.5 h-3.5 text-accent-2 shrink-0" />}
                    <span className="truncate">{glbUpload.busy ? 'Uploading model…' : 'Upload model (.glb / .gltf)'}</span>
                  </button>
                )}
                {showGlbUpload && (
                  <button
                    onClick={() => setJewelryOpen(true)}
                    className="pressable flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-accent/[0.06] hover:bg-accent/[0.1] border border-accent/15 transition-colors text-xs text-brand-muted/70 overflow-hidden"
                  >
                    <Gem className="w-3.5 h-3.5 text-accent-2 shrink-0" />
                    <span className="truncate">3D Name Jewelry — build a name piece</span>
                  </button>
                )}
                {glbUpload.error && (
                  <p role="alert" className="font-sans text-[10px] text-rose-300/90 leading-relaxed px-1">{glbUpload.error}</p>
                )}
                <input ref={imgInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="sr-only" onChange={onImageUpload} />
                <input ref={glbInputRef} type="file" accept=".glb,.gltf" className="sr-only" onChange={onGlbUpload} />
                <p className="font-sans text-[9px] text-brand-muted/40 leading-relaxed px-1">
                  Transparent PNGs work best for frames — your upload drops straight into the scene.
                </p>
              </div>
            )}
            {uploads.status === 'loading' && (
              <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-brand-muted/40" /></div>
            )}
            {uploads.status === 'error' && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <p className="font-sans text-[10px] text-brand-muted/40">Couldn't load your uploads.</p>
                <button onClick={loadUploads} className="text-[9px] font-label uppercase tracking-widest text-brand-muted/50 hover:text-accent-2 transition-colors">Retry</button>
              </div>
            )}
            {uploadTiles.length > 0 && subGroup('up-files', 'Uploaded files', uploadTiles.length, renderTiles(uploadTiles, 'square'))}
            {mineTiles.length > 0 && subGroup('up-mine', 'My experiences', mineTiles.length, renderTiles(mineTiles, 'square'))}
          </div>
        )}

        {/* TEMPLATES — open as a fresh draft (not add-as-layer); confirm-on-dirty */}
        {templates.length > 0 && (
          <div className="flex flex-col gap-2">
            <SectionLabel><span className="inline-flex items-center gap-1.5"><FileStack className="w-3 h-3 text-accent-2" /> Templates</span></SectionLabel>
            <div className="flex flex-col gap-1.5">
              {templates.map((exp) => (
                <div key={exp.id}>
                  <button
                    onClick={() => useTemplate(exp)}
                    title="Start a new experience from this template"
                    className="group flex items-center gap-2 w-full rounded-lg px-2 py-1.5 bg-accent/[0.06] hover:bg-accent/[0.12] border border-accent/15 hover:border-accent/30 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-md overflow-hidden bg-white/[0.04] flex items-center justify-center shrink-0">
                      {exp.thumbnail_url ? (
                        <img src={exp.thumbnail_url} alt="" draggable={false} className="w-full h-full object-cover" />
                      ) : (
                        <FileStack className="w-3.5 h-3.5 text-accent-2/60" />
                      )}
                    </div>
                    <span className="text-[11px] font-sans truncate flex-1 min-w-0 text-brand-fg">{stripTemplateSuffix(exp.name)}</span>
                    <span className="font-label text-[7px] uppercase tracking-widest text-accent-2/70 bg-accent/10 px-1.5 py-0.5 rounded-full shrink-0">Template</span>
                  </button>
                  {confirmTemplateId === exp.id && (
                    <div className="mt-1 rounded-lg liquid-glass px-2.5 py-2 flex items-center gap-2">
                      <span className="font-sans text-[10px] text-brand-muted/70 flex-1 leading-snug">Discard unsaved changes?</span>
                      <button
                        onClick={() => useTemplate(exp, true)}
                        className="font-label text-[8px] uppercase tracking-widest text-accent-2 hover:text-accent transition-colors"
                      >
                        Use template
                      </button>
                      <button
                        onClick={() => setConfirmTemplateId(null)}
                        className="font-label text-[8px] uppercase tracking-widest text-brand-muted/50 hover:text-brand-fg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading / empty states */}
        {experiences.status === 'loading' && generatedTiles.length === 0 && !showUploadsSection && (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-brand-muted/40" /></div>
        )}
        {!hasContent && !stillLoading && (
          <p className="font-sans text-[10px] text-brand-muted/40 text-center py-8">
            {q
              ? `No assets match “${q}”.`
              : chip === 'all'
                ? 'Nothing here yet — upload a frame, sticker or model above, or generate one with AI.'
                : 'Nothing of this kind yet — try another category, or add one above.'}
          </p>
        )}
      </div>

      {jewelryOpen && (
        <Suspense fallback={null}>
          <Text3DBuilder
            eventId={eventId}
            dispatch={dispatch}
            onClose={() => setJewelryOpen(false)}
            onUploaded={loadUploads}
            lighting={lighting}
          />
        </Suspense>
      )}
    </div>
  );
}
