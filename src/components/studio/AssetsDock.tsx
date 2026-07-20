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
 * object and flips the stage view to fit) AND expands a compact settings card
 * directly below that tile's row, bound to the CURRENT selection (selectedObject)
 * — attachment point + size + occlusion for 3D pieces, size + rotation for
 * frames/stickers, params for filters. Full properties still live in the right
 * dock. Drag-onto-canvas still works (beginDrag / consumedDrag guards preserved).
 * The GLB add is async (measure-then-dispatch) — the tile shows an "adding" spinner
 * while it's in flight and the expander binds to selection, which lands with it.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Boxes, ChevronDown, ChevronRight, Crown, FileStack, Gem, Glasses, Image as ImageIcon, Loader2, Search, Sparkles, Sun, Upload, Wand2, X } from 'lucide-react';
import { FILTER_SHADERS, SHADER_MAP, defaultParams } from '../../lib/shaders';
import { BUILTIN_BORDERS, toDataUrl } from '../../lib/borders';
import { HEAD_PIECES } from '../../lib/headPieces';
import { ANCHOR_PRESETS } from '../../lib/faceRig';
import { uploadAsset, listAssets, fetchExperiences } from '../../lib/db';
import { captureGlbThumbnail, measureGlbFitScale } from '../../lib/studio/glbThumb';
import { PROP_SCALE_MAX } from '../../lib/studio/bustFit';
import { useEvent } from '../../events/EventContext';
import { useEntitlements } from '../../lib/entitlements';
import { selectedObject, type Overlay2D, type StudioAction, type StudioState } from '../../lib/studio/state';
import { experienceToDraft } from '../../lib/studio/draftMapping';
import { SectionLabel, StudioSlider, StudioToggle } from './StudioControls';
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
  type DockItem,
  type AssetChip,
} from '../../lib/studio/assetSources';

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  onOpenExperience: (exp: Experience) => void;
  beginDrag: (payload: DragPayload, e: React.PointerEvent) => void;
  consumedDrag: () => boolean;
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
// uploads, mine) renders through renderTiles so the inline settings card can be
// injected uniformly below the clicked tile's row.
interface Tile {
  key: string;
  label: string;
  previewUrl: string | null;
  active: boolean;
  fallbackIcon: typeof Boxes;
  drag: DragPayload;
  pending: boolean;
  onAdd: () => void;
}

/** Smooth expand/collapse for dock sub-groups and inline settings cards —
 *  the PickerDrawer height/opacity idiom; prefers-reduced-motion snaps. */
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

export default function AssetsDock({ state, dispatch, onOpenExperience, beginDrag, consumedDrag }: Props) {
  const { draft } = state;
  const { source, eventId } = useEvent();
  const entitlements = useEntitlements();
  const imgInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const show3dAi = source === 'db' && entitlements.aiStudio;

  const [chip, setChip] = useState<AssetChip>('all');
  const [query, setQuery] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  // Which tile's inline settings card is expanded (section-prefixed key so ids
  // never collide across sections), and a model tile whose async GLB measure is
  // still in flight (drives the "adding" spinner on that tile).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // The object id the open inline settings card adopted (and the tile key it
  // belongs to) — the card auto-collapses if the live selection moves off it
  // (see the guard effect after the selection is derived below).
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

  // Both remote sources load eagerly on mount — the point of the single surface
  // is to show everything at once, so there are no tabs to lazy-load behind.
  const loadUploads = useCallback(() => {
    setUploads({ status: 'loading', items: [] });
    listAssets()
      .then((assets) => setUploads({ status: 'ready', items: uploadsToDockItems(assets) }))
      .catch(() => setUploads({ status: 'error', items: [] }));
  }, []);
  const loadExperiences = useCallback(() => {
    setExperiences({ status: 'loading', templates: [], generated: [], mine: [] });
    fetchExperiences(eventId)
      .then((exps) => {
        const { templates, generated, mine } = splitExperiences(exps.filter((e) => e.id !== draft.id));
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
    dispatch({ type: 'LOAD', draft: { ...rest, isPublished: true, name: stripTemplateSuffix(exp.name) } });
  }, [state.dirty, dispatch]);

  // Click-to-add for an Uploads/Generated/Mine dock item — mirrors the built-in
  // library's handlers, guarded by consumedDrag() at the call site. Also opens
  // the inline settings card for the just-added object (keyed by the tile).
  const addDockItem = useCallback((item: DockItem, key: string) => {
    setExpandedKey(key);
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
    dispatch({ type: 'SET_OVERLAY_UPLOAD', url: URL.createObjectURL(file), blob: file, overlayKind });
    e.target.value = '';
  }, [dispatch, chip]);

  const onGlbUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setModelThumb(null);
    const url = await uploadAsset(file, file.name);
    if (!url) return;
    const fitScale = await measureGlbFitScale(url);
    dispatch({ type: 'SET_MODEL_ASSET', url, name: file.name, scale: fitScale ?? undefined });
    // Best-effort thumbnail capture — the model is already saved and selected
    // above, so a capture/upload failure here must never surface as a failed
    // model upload; it just leaves the tile on its plain Upload-icon look.
    try {
      const thumbBlob = await captureGlbThumbnail(url);
      if (!thumbBlob) return;
      const thumbUrl = await uploadAsset(thumbBlob, `${file.name}.thumb`);
      if (thumbUrl) setModelThumb(thumbUrl);
    } catch (err) {
      console.error('[AssetsDock] GLB thumbnail capture failed', err);
    }
  }, [dispatch]);

  // The selected object drives which library item reads as "active" and what the
  // inline settings card edits (the reducer selects each just-added object).
  const sel = selectedObject(draft);
  const selBuiltinId = sel && sel.type === 'overlay' && sel.isBuiltin ? sel.builtinId : undefined;
  const selProceduralId = sel && sel.type === 'headpiece' ? sel.proceduralId : undefined;
  // The scene's single frame (if any) — highlights the active frame regardless
  // of which layer is currently selected.
  const sceneFrame = draft.objects.find(
    (o): o is Overlay2D => o.type === 'overlay' && o.overlayKind === 'border',
  );

  const selId = sel?.id ?? null;
  // Guard the inline settings card against silently RETARGETING: it edits
  // selectedObject, so an EXTERNAL selection move (e.g. a Director add landing)
  // would make the open card start editing the new object. Track the object id
  // the card adopted and collapse when the live selection stops matching it.
  // Race window: a tile click sets expandedKey a frame before its OWN add lands
  // (immediate for sync adds; deferred through the async GLB measure for model
  // adds, marked by pendingKey === expandedKey) — so (re)adopt when the card key
  // changes and defer adoption while that add is still pending.
  useEffect(() => {
    const objectCard = !!expandedKey && !expandedKey.startsWith('filter:');
    if (!objectCard) { cardKeyRef.current = expandedKey; cardObjIdRef.current = null; return; }
    if (cardKeyRef.current !== expandedKey) {          // a different tile's card opened
      cardKeyRef.current = expandedKey;
      cardObjIdRef.current = pendingKey === expandedKey ? null : selId; // defer if its add is in flight
      return;
    }
    if (cardObjIdRef.current === null) {               // deferred adoption: the add's object just landed
      if (pendingKey !== expandedKey && selId) cardObjIdRef.current = selId;
      return;
    }
    if (selId && selId !== cardObjIdRef.current) {     // selection moved to another object → collapse
      setExpandedKey(null);
      cardKeyRef.current = null;
      cardObjIdRef.current = null;
    }
  }, [selId, expandedKey, pendingKey]);

  const q = query.trim().toLowerCase();
  const matchQuery = (name: string) => !q || name.toLowerCase().includes(q);

  const editingCaption = (name: string): ReactNode => (
    <p className="flex items-baseline gap-1.5 min-w-0">
      <span className="font-label text-[9px] uppercase tracking-widest text-brand-muted/50 shrink-0">Editing</span>
      <span className="text-brand-muted/30 shrink-0">·</span>
      <span className="text-xs text-brand-fg font-medium truncate">{name}</span>
    </p>
  );

  // The compact settings card that expands under a clicked tile — a quick-reach
  // subset of PropertiesDock, bound to the current selection (for object tiles) or
  // the scene filter slot (for filter tiles). Full controls remain in the right dock.
  const renderInlineSettings = (key: string): ReactNode => {
    // Filter tiles aren't scene objects — bind to the single filter slot directly.
    if (key.startsWith('filter:')) {
      const def = SHADER_MAP[draft.shaderId];
      if (!def || draft.shaderId === 'none') return null;
      return (
        <div className="rounded-xl liquid-glass p-3 flex flex-col gap-3">
          {editingCaption(def.name)}
          {def.params.length > 0 ? (
            def.params.map((p) => (
              <StudioSlider
                key={p.key}
                label={p.label}
                value={draft.shaderParams[p.key] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(v) => dispatch({ type: 'SET_SHADER_PARAM', key: p.key, value: v })}
              />
            ))
          ) : (
            <p className="text-[10px] text-brand-muted/40 font-sans">No adjustable parameters.</p>
          )}
        </div>
      );
    }
    if (!sel) {
      // A model tile whose async measure is still landing — hold the card open.
      if (pendingKey === key) {
        return (
          <div className="rounded-xl liquid-glass p-3 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-2" />
            <span className="font-sans text-[10px] text-brand-muted/60">Adding to scene…</span>
          </div>
        );
      }
      return null;
    }
    if (sel.type === 'overlay') {
      return (
        <div className="rounded-xl liquid-glass p-3 flex flex-col gap-3">
          {editingCaption(sel.name)}
          <StudioSlider
            label="Size"
            value={sel.transform.scale}
            min={0.1}
            max={3}
            step={0.05}
            onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...sel.transform, scale: v } })}
          />
          <StudioSlider
            label="Rotation (°)"
            value={sel.transform.rotation}
            min={-180}
            max={180}
            step={1}
            format={(v) => v.toFixed(0)}
            onChange={(v) => dispatch({ type: 'SET_TRANSFORM', transform: { ...sel.transform, rotation: v } })}
          />
        </div>
      );
    }
    // 3D piece: attachment point + size + occlusion.
    return (
      <div className="rounded-xl liquid-glass p-3 flex flex-col gap-3">
        {editingCaption(sel.name)}
        <div>
          <SectionLabel>Attachment point</SectionLabel>
          <div className="grid grid-cols-3 gap-1">
            {ANCHOR_PRESETS.map((p) => {
              const active = p.id === sel.anchor;
              return (
                <button
                  key={p.id}
                  onClick={() => dispatch({ type: 'SELECT_ANCHOR', anchor: p.id })}
                  title={p.hint}
                  className={`px-1 py-1.5 rounded-lg text-[8px] font-label uppercase tracking-wide truncate transition-colors ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
        <StudioSlider
          label="Size"
          value={Math.min(sel.anchorConfig.scale, PROP_SCALE_MAX)}
          min={0.05}
          max={PROP_SCALE_MAX}
          step={0.05}
          onChange={(v) => dispatch({ type: 'PATCH_ANCHOR_CONFIG', patch: { scale: v } })}
        />
        <StudioToggle
          label="Occlude behind head"
          hint="Hide parts of this piece behind the real head"
          value={sel.occlusion}
          onChange={(v) => dispatch({ type: 'SET_OCCLUSION', occlusion: v })}
        />
      </div>
    );
  };

  // Renders a set of tiles as rows of 3 (every grid here is grid-cols-3), then
  // injects the inline settings card as a full-width row directly BELOW the row
  // that holds the expanded tile — "settings show below the tile you clicked".
  const renderTiles = (tiles: Tile[], aspect: 'square' | 'frame'): ReactNode => {
    const rows: Tile[][] = [];
    for (let i = 0; i < tiles.length; i += 3) rows.push(tiles.slice(i, i + 3));
    const aspectCls = aspect === 'frame' ? 'aspect-[9/16]' : 'aspect-square';
    return (
      <div className="flex flex-col gap-1.5">
        {rows.map((row, ri) => {
          const expanded = row.find((t) => t.key === expandedKey);
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
                      {t.pending && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <Loader2 className="w-4 h-4 animate-spin text-accent-2" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <Collapse show={!!expanded}>{expanded ? renderInlineSettings(expanded.key) : null}</Collapse>
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
  const builtinTiles = (kind: 'border' | '2d_filter'): Tile[] =>
    BUILTIN_BORDERS.filter((b) => !b.legacy && b.kind === kind && matchQuery(b.name)).map((b) => {
      const url = toDataUrl(b.svg);
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
        onAdd: () => { dispatch({ type: 'SELECT_BUILTIN', borderId: b.id, url }); setExpandedKey(key); },
      };
    });

  const headPieceTiles = (): Tile[] =>
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
        onAdd: () => { dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: p.id }); setExpandedKey(key); },
      };
    });

  const dockTiles = (items: DockItem[], prefix: string): Tile[] =>
    filterDockByChip(items, chip, query).map((item) => {
      const key = `${prefix}:${item.id}`;
      return {
        key,
        label: item.label,
        previewUrl: item.previewUrl,
        active: false,
        fallbackIcon: item.family === '3d' ? Boxes : ImageIcon,
        pending: pendingKey === key,
        drag: dragPayloadFor(item),
        onAdd: () => addDockItem(item, key),
      };
    });

  // Filters are a descriptive list (no visual preview), not a tile grid — the
  // param sliders expand right below the clicked row. Preserves CLEAR_FILTER and
  // SELECT_SHADER + the manual SET_MODE '2d' (SELECT_SHADER alone doesn't flip view).
  const renderFilters = (): ReactNode => {
    const shaders = FILTER_SHADERS.filter((s) => matchQuery(s.name));
    return (
      <div className="flex flex-col gap-1">
        {!q && (
          <button
            onClick={() => { dispatch({ type: 'CLEAR_FILTER' }); setExpandedKey(null); }}
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
                  setExpandedKey(key);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl transition-colors ${active ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}
              >
                <div className="flex items-center justify-between">
                  <p className={`text-xs font-sans font-medium ${active ? 'text-accent-2' : 'text-brand-fg'}`}>{s.name}</p>
                  {s.animated && <span className="text-[7px] font-label uppercase tracking-widest text-accent-2/60 bg-accent/10 px-1.5 py-0.5 rounded-full">Anim</span>}
                </div>
                <p className="text-[9px] text-brand-muted/40 mt-0.5 leading-tight">{s.description}</p>
              </button>
              <Collapse show={expandedKey === key}>{expandedKey === key ? renderInlineSettings(key) : null}</Collapse>
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

  const frameTiles = showFrames ? builtinTiles('border') : [];
  const stickerTiles = showStickers ? builtinTiles('2d_filter') : [];
  const headTiles = showHeadPieces ? headPieceTiles() : [];
  const filterCount = showFilters ? FILTER_SHADERS.filter((s) => matchQuery(s.name)).length : 0;
  const libraryCount = frameTiles.length + stickerTiles.length + headTiles.length + filterCount;

  const generatedTiles = dockTiles(experiences.generated, 'gen');
  const uploadTiles = dockTiles(uploads.items, 'up');
  const mineTiles = dockTiles(experiences.mine, 'mine');
  // Templates are whole scenes, not a single kind — only under the 'all' chip.
  const templates = (chip === 'all' ? experiences.templates : []).filter((t) => matchQuery(t.name));

  const showImageUpload = chip === 'all' || chip === 'frame' || chip === 'sticker';
  const showGlbUpload = chip === 'all' || chip === '3d';
  const showUploadsSection = showImageUpload || showGlbUpload || uploadTiles.length > 0 || mineTiles.length > 0;

  // AI generate — frame/sticker via AiFramePanel, 3D via AiGeneratePanel; nothing
  // for the 'filter' chip (shaders aren't AI-generated).
  const aiKind: 'border' | '2d_filter' = chip === 'sticker' ? '2d_filter' : 'border';
  const showAi3d = chip === '3d' && show3dAi;
  const showAiOverlay = chip !== '3d' && chip !== 'filter';
  const showAi = showAiOverlay || showAi3d;

  const anythingVisible =
    libraryCount > 0 || generatedTiles.length > 0 || showUploadsSection || templates.length > 0 ||
    experiences.status === 'loading' || uploads.status === 'loading';

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
        {libraryCount > 0 && (
          <div className="flex flex-col gap-4">
            <SectionLabel>Studio Library</SectionLabel>
            {subGroup('lib-frames', 'Frames', frameTiles.length, renderTiles(frameTiles, 'frame'))}
            {subGroup('lib-stickers', 'Stickers', stickerTiles.length, renderTiles(stickerTiles, 'square'))}
            {subGroup('lib-filters', 'Filters', filterCount, renderFilters())}
            {subGroup('lib-pieces', 'Head pieces', headTiles.length, renderTiles(headTiles, 'square'))}
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
                    className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs text-brand-muted/70 overflow-hidden"
                  >
                    {modelThumb ? <img src={modelThumb} alt="" className="w-5 h-5 object-contain shrink-0" /> : <Upload className="w-3.5 h-3.5 text-accent-2 shrink-0" />}
                    <span className="truncate">Upload model (.glb / .gltf)</span>
                  </button>
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
        {!anythingVisible && (
          <p className="font-sans text-[10px] text-brand-muted/40 text-center py-8">
            {q ? 'No assets match your search.' : 'No assets here yet.'}
          </p>
        )}
      </div>
    </div>
  );
}
