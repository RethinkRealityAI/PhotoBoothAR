/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AssetsDock — the studio's left panel. Mode-aware source library:
 *   • 2D → experience-type selector, built-in frames/stickers, custom upload,
 *          AI frame generation
 *   • 3D → head-piece presets, GLB upload, anchor picker, AI 3D generation
 * Click-to-add wires each source into the reducer. (P3 adds a bucket-assets
 * tab and pointer drag-and-drop onto the stage.)
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Boxes, Crown, Gem, Glasses, Image as ImageIcon, LayoutTemplate, Loader2, Search, Sparkles, Sun, Upload, X } from 'lucide-react';
import { FILTER_SHADERS, defaultParams } from '../../lib/shaders';
import { BUILTIN_BORDERS, toDataUrl } from '../../lib/borders';
import { HEAD_PIECES } from '../../lib/headPieces';
import { ANCHOR_PRESETS } from '../../lib/faceRig';
import { uploadAsset, listAssets, fetchExperiences } from '../../lib/db';
import { captureGlbThumbnail } from '../../lib/studio/glbThumb';
import { useEvent } from '../../events/EventContext';
import { useEntitlements } from '../../lib/entitlements';
import { selectedObject, type Overlay2D, type StudioAction, type StudioState } from '../../lib/studio/state';
import { SectionLabel } from './StudioControls';
import AiFramePanel from './AiFramePanel';
import AiGeneratePanel from '../admin/creator3d/AiGeneratePanel';
import type { DragPayload } from './useStudioDnd';
import type { Experience } from '../../types';
import { uploadsToDockItems, experiencesToDockItems, filterDockItems, type DockItem } from '../../lib/studio/assetSources';

interface Props {
  state: StudioState;
  dispatch: React.Dispatch<StudioAction>;
  onOpenExperience: (exp: Experience) => void;
  beginDrag: (payload: DragPayload, e: React.PointerEvent) => void;
  consumedDrag: () => boolean;
}

/**
 * The dock's category tabs are pure CATALOG CATEGORIES — local UI state that
 * only picks which library section to browse. They never touch the draft, are
 * never locked, and nothing about them is destructive: clicking a catalog item
 * adds/swaps per the reducer's own rules (which also flip the view to fit).
 */
type Category = 'filter' | 'frame' | 'sticker' | '3d';
const CATEGORY_TABS: { id: Category; label: string; icon: typeof Sparkles }[] = [
  { id: 'filter', label: 'Filter', icon: Sparkles },
  { id: 'frame', label: 'Frame', icon: LayoutTemplate },
  { id: 'sticker', label: 'Sticker', icon: ImageIcon },
  { id: '3d', label: '3D', icon: Boxes },
];

// Head pieces are procedural (no image asset) — a distinctive icon per piece
// keeps the catalog reading as a visual grid rather than text pills, matching
// the built-in frame/sticker tiles. Falls back to the generic 3D glyph for any
// future piece added to headPieces.ts without an icon here.
const HEAD_PIECE_ICONS: Record<string, typeof Crown> = {
  'royal-crown': Crown,
  'queen-tiara': Gem,
  'cheek-stars': Sparkles,
  'hope-halo': Sun,
  'neon-shades': Glasses,
};

type SourceTabId = 'library' | 'uploads' | 'mine';
const SOURCE_TABS: { id: SourceTabId; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'mine', label: 'Mine' },
];

interface SourceState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: DockItem[];
}
const IDLE_SOURCE: SourceState = { status: 'idle', items: [] };

export default function AssetsDock({ state, dispatch, onOpenExperience, beginDrag, consumedDrag }: Props) {
  const { draft } = state;
  const { source, eventId } = useEvent();
  const entitlements = useEntitlements();
  const imgInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);

  const show3dAi = source === 'db' && entitlements.aiStudio;

  // Source sub-tabs (Library / Uploads / Mine) — Uploads and Mine are fetched
  // lazily on first open and cached for the life of this shell mount.
  const [subTab, setSubTab] = useState<SourceTabId>('library');
  const [query, setQuery] = useState('');
  const [uploads, setUploads] = useState<SourceState>(IDLE_SOURCE);
  const [mine, setMine] = useState<SourceState>(IDLE_SOURCE);
  // Which catalog category the Library is browsing (pure UI — no draft coupling).
  // Starts on 'filter' to match a fresh draft's pre-selected filter, so the two
  // panels agree at first glance.
  const [category, setCategory] = useState<Category>('filter');
  const family: '2d' | '3d' = category === '3d' ? '3d' : '2d';
  // Auto-captured thumbnail for the most recently uploaded GLB — shown on the
  // "Upload model" tile itself (best-effort; null while capturing/on failure,
  // in which case the tile keeps its plain Upload-icon look).
  const [modelThumb, setModelThumb] = useState<string | null>(null);

  const loadUploads = useCallback(() => {
    setUploads({ status: 'loading', items: [] });
    listAssets()
      .then((assets) => setUploads({ status: 'ready', items: uploadsToDockItems(assets) }))
      .catch(() => setUploads({ status: 'error', items: [] }));
  }, []);
  useEffect(() => {
    if (subTab === 'uploads' && uploads.status === 'idle') loadUploads();
  }, [subTab, uploads.status, loadUploads]);

  const loadMine = useCallback(() => {
    setMine({ status: 'loading', items: [] });
    fetchExperiences(eventId)
      .then((exps) => setMine({ status: 'ready', items: experiencesToDockItems(exps.filter((e) => e.id !== draft.id)) }))
      .catch(() => setMine({ status: 'error', items: [] }));
  }, [eventId, draft.id]);
  useEffect(() => {
    if (subTab === 'mine' && mine.status === 'idle') loadMine();
  }, [subTab, mine.status, loadMine]);

  // Click-to-add for an Uploads/Mine dock item — mirrors the built-in library's
  // click handlers (SET_OVERLAY_UPLOAD / SELECT_HEAD_PIECE / SET_MODEL_ASSET),
  // guarded by consumedDrag() exactly like every other source button here.
  const addDockItem = useCallback((item: DockItem) => {
    if (item.family === '2d') {
      if (item.payload.url) {
        // Explicit sub-kind: the item's own kind, else the browsing category
        // (without it the reducer defaults to 'border' — a sticker-category
        // upload would land as a frame).
        const overlayKind = item.payload.overlayKind ?? (category === 'sticker' ? '2d_filter' as const : 'border' as const);
        dispatch({ type: 'SET_OVERLAY_UPLOAD', url: item.payload.url, blob: null, overlayKind });
      }
      return;
    }
    if (item.payload.proceduralId) {
      dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: item.payload.proceduralId });
    } else if (item.payload.assetUrl) {
      dispatch({ type: 'SET_MODEL_ASSET', url: item.payload.assetUrl, name: item.label });
    }
  }, [dispatch, category]);

  // Drag payload for an Uploads/Mine dock item — useStudioDnd's resolveDrop
  // reads `assetUrl` (not `url`) for the non-builtin overlay branch, so a
  // DockItem's payload.url maps onto DragPayload.assetUrl here.
  const dragPayloadFor = useCallback((item: DockItem): DragPayload => {
    if (item.family === '2d') {
      return {
        target: 'overlay',
        label: item.label,
        previewUrl: item.previewUrl,
        overlayKind: item.payload.overlayKind ?? (category === 'sticker' ? '2d_filter' : 'border'),
        assetUrl: item.payload.url,
      };
    }
    if (item.payload.proceduralId) {
      return { target: 'headpiece', label: item.label, previewUrl: item.previewUrl, pieceId: item.payload.proceduralId };
    }
    return { target: 'model', label: item.label, previewUrl: item.previewUrl, assetUrl: item.payload.assetUrl };
  }, [category]);

  const renderSourceList = (items: DockItem[], emptyText: string) => {
    if (items.length === 0) {
      return <p className="font-sans text-[10px] text-brand-muted/40 text-center py-8">{emptyText}</p>;
    }
    if (family === '2d') {
      return (
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((item) => (
            <button
              key={item.id}
              onPointerDown={(e) => beginDrag(dragPayloadFor(item), e)}
              onClick={() => { if (consumedDrag()) return; addDockItem(item); }}
              title={`${item.label} · click to add · drag onto the canvas to place`}
              className="group relative aspect-square rounded-lg overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-accent/25 cursor-grab active:cursor-grabbing transition-colors"
            >
              {item.previewUrl ? (
                <img src={item.previewUrl} alt={item.label} draggable={false} className="w-full h-full object-contain p-1.5" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-4 h-4 text-brand-muted/30" /></div>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[7px] font-label uppercase tracking-wide text-white/80 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-3 gap-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            onPointerDown={(e) => beginDrag(dragPayloadFor(item), e)}
            onClick={() => { if (consumedDrag()) return; addDockItem(item); }}
            title={`${item.label} · click to add · drag onto the head to place`}
            className="group relative aspect-square rounded-lg overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-accent/25 cursor-grab active:cursor-grabbing transition-colors"
          >
            {item.previewUrl ? (
              <img src={item.previewUrl} alt={item.label} draggable={false} className="w-full h-full object-contain p-1.5" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><Boxes className="w-4 h-4 text-brand-muted/30" /></div>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[7px] font-label uppercase tracking-wide text-white/80 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    );
  };

  // The selected object drives which library item reads as "active" (these
  // click-to-add actions add-or-replace per the reducer's documented rule).
  const sel = selectedObject(draft);
  const selBuiltinId = sel && sel.type === 'overlay' && sel.isBuiltin ? sel.builtinId : undefined;
  const selProceduralId = sel && sel.type === 'headpiece' ? sel.proceduralId : undefined;
  const selAnchor = sel && sel.type !== 'overlay' ? sel.anchor : undefined;
  const selModelName = sel && sel.type === 'model' ? sel.name : undefined;
  // The scene's single frame (if any) — highlights the active frame in the
  // Frame catalog regardless of which layer is currently selected.
  const sceneFrame = draft.objects.find(
    (o): o is Overlay2D => o.type === 'overlay' && o.overlayKind === 'border',
  );

  const onImageUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // The upload input only renders inside the visible Frame/Sticker catalog, so
    // the browsing category IS the intended sub-kind.
    const overlayKind = category === 'sticker' ? '2d_filter' as const : 'border' as const;
    dispatch({ type: 'SET_OVERLAY_UPLOAD', url: URL.createObjectURL(file), blob: file, overlayKind });
    e.target.value = '';
  }, [dispatch, category]);

  const onGlbUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setModelThumb(null);
    const url = await uploadAsset(file, file.name);
    if (!url) return;
    dispatch({ type: 'SET_MODEL_ASSET', url, name: file.name });
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

  // Frame + Sticker catalogs share their layout (built-ins → upload → AI panel);
  // only the sub-kind, the active-highlight source, and the AI kind differ. The
  // reducer's SELECT_BUILTIN flips the view to 2D on add.
  const renderOverlayCatalog = (kind: 'border' | '2d_filter') => (
    <>
      <div>
        <SectionLabel>{kind === 'border' ? 'Built-in frames' : 'Built-in stickers'}</SectionLabel>
        <div className="grid grid-cols-3 gap-1.5">
          {BUILTIN_BORDERS.filter((b) => b.kind === kind).map((b) => {
            // Frames: highlight the scene's frame (at most one) regardless of
            // selection; stickers: highlight the selected sticker.
            const active = kind === 'border' ? sceneFrame?.builtinId === b.id : selBuiltinId === b.id;
            const url = toDataUrl(b.svg);
            return (
              <button
                key={b.id}
                onPointerDown={(e) => beginDrag({ target: 'overlay', label: b.name, overlayKind: b.kind, builtinId: b.id, builtinUrl: url, previewUrl: url }, e)}
                onClick={() => { if (consumedDrag()) return; dispatch({ type: 'SELECT_BUILTIN', borderId: b.id, url }); }}
                title="Click to add · drag onto the canvas to place"
                className={`group relative aspect-square rounded-lg overflow-hidden bg-white/[0.03] hover:bg-white/[0.06] border cursor-grab active:cursor-grabbing transition-colors ${active ? 'border-accent/40 ring-1 ring-accent/30' : 'border-white/5 hover:border-accent/25'}`}
              >
                <img src={url} alt={b.name} draggable={false} className="w-full h-full object-contain p-1.5" />
                <span className={`absolute inset-x-0 bottom-0 px-1 py-0.5 text-[7px] font-label uppercase tracking-wide truncate ${active ? 'bg-accent/30 text-accent-2' : 'bg-black/60 text-white/80'}`}>{b.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <SectionLabel>Upload custom (PNG / SVG)</SectionLabel>
        <button
          onClick={() => imgInputRef.current?.click()}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-xs text-brand-muted/70"
        >
          <Upload className="w-3.5 h-3.5 text-accent-2" /> Browse file…
        </button>
        <input ref={imgInputRef} type="file" accept="image/png,image/svg+xml,image/webp" className="sr-only" onChange={onImageUpload} />
        <p className="font-sans text-[9px] text-brand-muted/35 mt-1 leading-snug">Transparent PNG, 1080×1920 for full-frame art.</p>
      </div>
      <AiFramePanel
        kind={kind}
        freeTrial={!entitlements.aiStudio}
        onGenerated={(exp) => {
          if (exp.asset_url) dispatch({ type: 'SET_OVERLAY_UPLOAD', url: exp.asset_url, blob: null, overlayKind: kind });
          if (draft.name.startsWith('Untitled') && exp.name) dispatch({ type: 'SET_NAME', name: exp.name });
        }}
      />
    </>
  );

  return (
    <div className="h-full overflow-y-auto hide-scrollbar p-4 flex flex-col gap-5">
      {/* Catalog category tabs — pure browsing UI. Never locked, nothing
          destructive: switching just picks which library section to show. Adds
          happen when you click an item (which also flips the view to fit). */}
      <div>
        <SectionLabel>Scene Type</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {CATEGORY_TABS.map((t) => {
            const active = category === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setCategory(t.id);
                  // Echo the browse choice in the stage (pure view flip, never
                  // destructive, off the undo timeline) — the dock's "3D" tab and
                  // the stage's "3D" view share a name, and users expect them to
                  // move together.
                  dispatch({ type: 'SET_MODE', mode: t.id === '3d' ? '3d' : '2d' });
                }}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-[8px] font-label uppercase tracking-widest transition-all w-full ${active ? 'bg-accent/15 text-accent-2 ring-1 ring-accent/30' : 'bg-white/[0.03] text-brand-muted/50 hover:text-brand-fg hover:bg-white/[0.06]'}`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Source sub-tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl liquid-glass">
        {SOURCE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex-1 py-1.5 rounded-lg text-[9px] font-label uppercase tracking-widest transition-colors ${subTab === t.id ? 'bg-accent/20 text-accent-2' : 'text-brand-muted/50 hover:text-brand-fg'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search — filters only the active sub-tab (Uploads / Mine) */}
      {subTab !== 'library' && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-brand-muted/30 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-white/[0.03] text-[11px] text-brand-fg placeholder:text-brand-muted/30 focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        </div>
      )}

      {subTab === 'library' && (
      <>
      {/* FILTER catalog — the scene's single filter slot. Click swaps it (and
          flips to 2D so it's visible); the top row removes it (CLEAR_FILTER). */}
      {category === 'filter' && (
        <div>
          <SectionLabel>Filter effect</SectionLabel>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => dispatch({ type: 'CLEAR_FILTER' })}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl transition-colors ${draft.shaderId === 'none' ? 'bg-accent/15 ring-1 ring-accent/30 text-accent-2' : 'bg-white/[0.03] hover:bg-white/[0.06] text-brand-muted/70 hover:text-brand-fg'}`}
            >
              <X className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs font-sans font-medium">No filter</span>
            </button>
            {FILTER_SHADERS.map((s) => {
              const active = draft.shaderId === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => { dispatch({ type: 'SELECT_SHADER', shaderId: s.id, params: defaultParams(s.id) }); dispatch({ type: 'SET_MODE', mode: '2d' }); }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${active ? 'bg-accent/15 ring-1 ring-accent/30' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}
                >
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-sans font-medium ${active ? 'text-accent-2' : 'text-brand-fg'}`}>{s.name}</p>
                    {s.animated && <span className="text-[7px] font-label uppercase tracking-widest text-accent-2/60 bg-accent/10 px-1.5 py-0.5 rounded-full">Anim</span>}
                  </div>
                  <p className="text-[9px] text-brand-muted/40 mt-0.5 leading-tight">{s.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* FRAME + STICKER built-ins (shared layout, sub-kind differs) */}
      {category === 'frame' && renderOverlayCatalog('border')}
      {category === 'sticker' && renderOverlayCatalog('2d_filter')}

      {/* 3D asset + anchors */}
      {category === '3d' && (
        <>
          <div>
            <SectionLabel><span className="inline-flex items-center gap-1.5"><Crown className="w-3 h-3 text-accent-2" /> Head pieces</span></SectionLabel>
            <div className="grid grid-cols-3 gap-1.5">
              {HEAD_PIECES.map((p) => {
                const active = selProceduralId === p.id;
                const Icon = HEAD_PIECE_ICONS[p.id] ?? Boxes;
                return (
                  <button
                    key={p.id}
                    onPointerDown={(e) => beginDrag({ target: 'headpiece', label: p.name, pieceId: p.id }, e)}
                    onClick={() => { if (consumedDrag()) return; dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: p.id }); }}
                    title="Click to add · drag onto the head to place"
                    className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-1 border cursor-grab active:cursor-grabbing transition-all ${active ? 'bg-accent/15 border-accent/40 text-accent-2' : 'bg-white/[0.03] border-white/10 text-brand-muted/60 hover:text-brand-fg hover:border-accent/25'}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-label text-[7px] uppercase tracking-wide leading-tight text-center px-1 truncate max-w-full">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionLabel>Upload model (.glb / .gltf)</SectionLabel>
            <button
              onClick={() => glbInputRef.current?.click()}
              className="flex flex-col items-center gap-1.5 w-full px-3 py-4 rounded-xl border border-dashed border-white/15 bg-white/[0.02] hover:border-accent/40 transition-colors text-brand-muted/60 overflow-hidden"
            >
              {modelThumb ? (
                <img src={modelThumb} alt={selModelName ?? 'Model thumbnail'} className="w-12 h-12 object-contain" />
              ) : (
                <Upload className="w-4 h-4 text-accent-2" />
              )}
              <span className="font-label text-[9px] uppercase tracking-widest text-center truncate max-w-full">{selModelName ?? 'Drop a .glb or click'}</span>
            </button>
            <input ref={glbInputRef} type="file" accept=".glb,.gltf" className="sr-only" onChange={onGlbUpload} />
            <p className="font-sans text-[9px] text-brand-muted/35 mt-1 leading-snug">Auto-captures a square thumbnail (256×256+).</p>
          </div>

          <div>
            <SectionLabel>Anchor point</SectionLabel>
            {/* SELECT_ANCHOR targets the SELECTED 3D piece — with none, every
                click is a silent no-op, so say so instead of rendering a list
                that looks live but does nothing. */}
            {selAnchor === undefined ? (
              <p className="font-sans text-[10px] text-brand-muted/40 px-3 py-2 leading-relaxed">
                Select a 3D piece (or add one above) to choose where it attaches.
              </p>
            ) : (
            <div className="flex flex-col gap-0.5">
              {ANCHOR_PRESETS.map((p) => {
                const active = p.id === selAnchor;
                return (
                  <button
                    key={p.id}
                    onClick={() => dispatch({ type: 'SELECT_ANCHOR', anchor: p.id })}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all flex flex-col gap-0.5 ${active ? 'bg-accent/10 ring-1 ring-accent/25' : 'hover:bg-white/[0.05]'}`}
                  >
                    <span className={`font-label text-[10px] uppercase tracking-widest ${active ? 'text-accent-2' : 'text-brand-fg/80'}`}>{p.label}</span>
                    <span className="font-sans text-[9px] text-brand-muted/40 leading-tight">{p.hint}</span>
                  </button>
                );
              })}
            </div>
            )}
          </div>

          {show3dAi && <AiGeneratePanel onOpenExperience={onOpenExperience} />}
        </>
      )}
      </>
      )}

      {/* UPLOADS tab */}
      {subTab === 'uploads' && (
        <div>
          <SectionLabel>Uploaded assets</SectionLabel>
          {uploads.status === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-brand-muted/40" />
            </div>
          )}
          {uploads.status === 'error' && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="font-sans text-[10px] text-brand-muted/40">Couldn't load your uploads.</p>
              <button onClick={loadUploads} className="text-[9px] font-label uppercase tracking-widest text-brand-muted/50 hover:text-accent-2 transition-colors">Retry</button>
            </div>
          )}
          {uploads.status === 'ready' && renderSourceList(
            filterDockItems(uploads.items, family, query),
            query ? 'No matches.' : 'No uploads yet — add files above.',
          )}
        </div>
      )}

      {/* MINE tab */}
      {subTab === 'mine' && (
        <div>
          <SectionLabel>Your experiences</SectionLabel>
          {mine.status === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-brand-muted/40" />
            </div>
          )}
          {mine.status === 'error' && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="font-sans text-[10px] text-brand-muted/40">Couldn't load your experiences.</p>
              <button onClick={loadMine} className="text-[9px] font-label uppercase tracking-widest text-brand-muted/50 hover:text-accent-2 transition-colors">Retry</button>
            </div>
          )}
          {mine.status === 'ready' && renderSourceList(
            filterDockItems(mine.items, family, query),
            query ? 'No matches.' : 'No saved experiences yet.',
          )}
        </div>
      )}
    </div>
  );
}
