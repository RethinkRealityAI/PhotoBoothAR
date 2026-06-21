/**
 * Creator3D — 3D Anchor-Point Editor
 * ====================================
 * Full pro-tool layout for placing GLB models on head attachment points
 * with a live face-tracked WYSIWYG preview.
 *
 * Layout (3-column):
 *   LEFT  — AnchorPanel (upload + anchor picker)
 *   CENTER — canvas switcher (Model mode | Live mode)
 *   RIGHT — PropertiesPanel (transform sliders + save)
 *
 * Preview modes:
 *   Model — stylised reference head + TransformControls + OrbitControls
 *   Live  — real camera + FaceRig overlay (identical to booth)
 *
 * Persistence: createExperience / updateExperience via src/lib/db.ts
 * Edit mode:   ?id=<uuid> loads an existing experience
 */
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/* Lightweight fixed-proportion 3-column panels (robust replacement for the
   flaky react-resizable-panels v4 fork). Same names → no other edits needed. */
function PanelGroup({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`flex ${className}`}>{children}</div>;
}
function Panel({
  children,
  className = '',
  defaultSize = 1,
}: {
  children: React.ReactNode;
  className?: string;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
}) {
  return (
    <div className={`h-full min-w-0 ${className}`} style={{ flex: `${defaultSize} 1 0%` }}>
      {children}
    </div>
  );
}
function PanelResizeHandle({ className = '' }: { className?: string }) {
  return <div className={className.replace('cursor-col-resize', '').trim()} />;
}

import {
  Video,
  Box,
  PauseCircle,
  PlayCircle,
  ChevronLeft,
  Save,
  Loader,
} from 'lucide-react';

import { Mark } from '../ui/EventLogo';
import EventBackground from '../ui/EventBackground';

import { getExperience, createExperience, updateExperience, uploadAsset } from '../../lib/db';
import { AnchorConfig, HeadAnchor } from '../../types';
import { HEAD_PIECE_MAP } from '../../lib/headPieces';

import AnchorPanel from './creator3d/AnchorPanel';
import PropertiesPanel from './creator3d/PropertiesPanel';

// Lazy-load the canvases — they pull in Three.js / WebGL heavy code
import { lazy } from 'react';
const ModelCanvas = lazy(() => import('./creator3d/ModelCanvas'));
const LiveCanvas = lazy(() => import('./creator3d/LiveCanvas'));

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type PreviewMode = 'model' | 'live';

const DEFAULT_OFFSET = { x: 0, y: 0, z: 0 };
const DEFAULT_ROTATION = { x: 0, y: 0, z: 0 };

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export default function Creator3D() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');

  // ── editor state ──
  const [name, setName] = useState('Untitled 3D Experience');
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [proceduralId, setProceduralId] = useState<string | null>(null); // built-in head piece
  const [assetName, setAssetName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isPublished, setIsPublished] = useState(true);
  const [featured, setFeatured] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Custom booth-icon thumbnail (uploaded for the booth filter orb)
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Anchor is stored separately from anchorConfig so handleAnchorSelect
  // can check "was it already the same anchor?" without relying on a field
  // that doesn't exist in the Partial<AnchorConfig> state.
  const [anchor, setAnchor] = useState<HeadAnchor>('crown');
  const [anchorConfig, setAnchorConfig] = useState<Partial<AnchorConfig>>({
    offset: { ...DEFAULT_OFFSET },
    rotation: { ...DEFAULT_ROTATION },
    scale: 1,
  });

  // ── canvas state ──
  const [previewMode, setPreviewMode] = useState<PreviewMode>('model');
  const [paused, setPaused] = useState(false);
  const [faceVisible, setFaceVisible] = useState(false);

  // ── load existing experience ──
  useEffect(() => {
    if (!editId) return;
    setLoadingEdit(true);
    getExperience(editId).then((exp) => {
      if (!exp || exp.kind !== '3d_attachment') {
        setLoadingEdit(false);
        return;
      }
      setName(exp.name);
      setAssetUrl(exp.asset_url ?? null);
      setProceduralId(exp.config?.procedural ?? null);
      setIsPublished(exp.is_published);
      setFeatured(exp.featured);
      setThumbUrl(exp.thumbnail_url ?? null);
      const cfg = exp.config?.anchor;
      if (cfg) {
        setAnchor(cfg.anchor ?? 'crown');
        setAnchorConfig({
          offset: cfg.offset ?? { ...DEFAULT_OFFSET },
          rotation: cfg.rotation ?? { ...DEFAULT_ROTATION },
          scale: cfg.scale ?? 1,
        });
      }
      setLoadingEdit(false);
    });
  }, [editId]);

  // ── upload handler ──
  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setSaveError(null);
    try {
      const url = await uploadAsset(file, file.name);
      if (url) {
        setAssetUrl(url);
        setAssetName(file.name);
        setProceduralId(null); // a real GLB overrides any built-in preset
      } else {
        setSaveError('Upload failed — check Supabase storage bucket permissions.');
      }
    } finally {
      setUploading(false);
    }
  }, []);

  // ── select a built-in head piece preset ──
  const handleSelectPreset = useCallback((id: string) => {
    const piece = HEAD_PIECE_MAP[id];
    if (!piece) return;
    setProceduralId(id);
    setAssetUrl(null);
    setAssetName(piece.name);
    setName(piece.name);
    setAnchor(piece.config.anchor);
    setAnchorConfig({
      offset: { ...piece.config.offset },
      rotation: { ...piece.config.rotation },
      scale: piece.config.scale,
    });
  }, []);

  // ── booth-icon thumbnail upload ──
  const handleThumbUpload = useCallback((file: File) => {
    setThumbBlob(file);
    setThumbUrl(URL.createObjectURL(file));
  }, []);
  const clearThumb = useCallback(() => { setThumbBlob(null); setThumbUrl(null); }, []);

  // ── transform change handler (from gizmo or sliders) ──
  const handleTransformChange = useCallback((patch: Partial<AnchorConfig>) => {
    setAnchorConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── anchor select — only resets offset when the anchor actually changes ──
  const handleAnchorSelect = useCallback((a: HeadAnchor) => {
    setAnchor((prev) => {
      if (prev === a) return prev; // same anchor → no reset
      // New anchor → reset offset/rotation but keep scale
      setAnchorConfig((cfg) => ({
        offset: { ...DEFAULT_OFFSET },
        rotation: { ...DEFAULT_ROTATION },
        scale: cfg.scale ?? 1,
      }));
      return a;
    });
  }, []);

  // ── save ──
  const handleSave = useCallback(async () => {
    if (!assetUrl && !proceduralId) {
      setSaveError('Upload a 3D model or pick a head-piece preset before saving.');
      return;
    }
    setSaving(true);
    setSaveError(null);

    const fullConfig: AnchorConfig = {
      anchor,
      offset: anchorConfig.offset ?? { ...DEFAULT_OFFSET },
      rotation: anchorConfig.rotation ?? { ...DEFAULT_ROTATION },
      scale: anchorConfig.scale ?? 1,
    };

    // Booth-icon thumbnail: upload the author's icon (preferred), or keep an
    // existing one. If none, leave null — the booth shows a crown icon.
    let thumbnail_url: string | null = null;
    if (thumbBlob) {
      thumbnail_url = await uploadAsset(thumbBlob, `icon-${name.replace(/\s+/g, '-').toLowerCase()}`);
    } else if (thumbUrl && thumbUrl.startsWith('http')) {
      thumbnail_url = thumbUrl;
    }

    const draft = {
      name,
      kind: '3d_attachment' as const,
      asset_url: proceduralId ? null : assetUrl,
      thumbnail_url,
      config: proceduralId ? { anchor: fullConfig, procedural: proceduralId } : { anchor: fullConfig },
      is_published: isPublished,
      featured,
    };

    const result = editId
      ? await updateExperience(editId, draft)
      : await createExperience(draft);

    setSaving(false);
    if (!result) {
      setSaveError('Save failed — check your connection and try again.');
    } else {
      navigate('/admin/library');
    }
  }, [assetUrl, proceduralId, anchor, anchorConfig, name, isPublished, featured, thumbBlob, thumbUrl, editId, navigate]);

  // ──────────────────────────────────────────────────────────────────────────
  // Loading state
  // ──────────────────────────────────────────────────────────────────────────

  if (loadingEdit) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-noir-900 face-grid">
        <EventBackground density={20} />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
          <span className="font-label text-xs text-gold-400 tracking-luxe uppercase">Loading experience…</span>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 flex flex-col bg-noir-900 overflow-hidden">
      <EventBackground density={24} />

      {/* ── TOP BAR ── */}
      <header className="relative z-20 shrink-0 flex items-center gap-3 px-4 py-2.5
                         border-b border-gold-700/20 glass-strong">
        {/* back */}
        <button
          onClick={() => navigate('/admin/library')}
          className="glass flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                     font-label text-[10px] uppercase tracking-luxe text-ivory/60
                     hover:text-ivory/90 transition-colors shrink-0"
        >
          <ChevronLeft size={13} />
          Library
        </button>

        <Mark />

        {/* title */}
        <div className="flex flex-col leading-none ml-1">
          <span className="font-serif italic text-ivory text-base">3D Anchor Editor</span>
          {editId && (
            <span className="font-label text-[8px] uppercase tracking-luxe text-gold-500/60">
              Editing experience
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* preview mode toggle */}
        <div className="flex items-center gap-1 glass rounded-xl p-1">
          {([
            { mode: 'model' as const, icon: Box,   label: 'Model', title: 'Reference head + transform gizmo' },
            { mode: 'live'  as const, icon: Video, label: 'Live',  title: 'Real camera + face tracking (WYSIWYG)' },
          ] as const).map(({ mode, icon: Icon, label, title }) => (
            <button
              key={mode}
              onClick={() => setPreviewMode(mode)}
              title={title}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-label text-[10px]',
                'uppercase tracking-luxe transition-all',
                previewMode === mode
                  ? 'bg-foil text-noir-900 glow-accent'
                  : 'text-ivory/50 hover:text-ivory/80',
              ].join(' ')}
            >
              <Icon size={13} />
              {label}
              {mode === 'live' && previewMode === 'live' && faceVisible && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 ml-0.5 shrink-0" />
              )}
            </button>
          ))}
        </div>

        {/* pause toggle (live mode only) */}
        {previewMode === 'live' && (
          <button
            onClick={() => setPaused((p) => !p)}
            title={paused ? 'Resume tracking' : 'Pause tracking — freeze head to fine-tune'}
            className={[
              'flex items-center gap-1.5 glass px-3 py-1.5 rounded-xl',
              'font-label text-[10px] uppercase tracking-luxe transition-all',
              paused
                ? 'text-gold-400 border border-gold-500/40'
                : 'text-ivory/50 hover:text-ivory/80',
            ].join(' ')}
          >
            {paused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}

        {/* quick save in top bar (also in right panel) */}
        <button
          onClick={handleSave}
          disabled={saving || (!assetUrl && !proceduralId)}
          title={!assetUrl && !proceduralId ? 'Upload a model or pick a preset first' : 'Save experience'}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-foil text-noir-900 rounded-xl
                     font-label text-[10px] uppercase tracking-luxe glow-accent
                     hover:scale-[1.02] transition-transform disabled:opacity-40 shrink-0"
        >
          {saving ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : editId ? 'Update' : 'Save'}
        </button>

        {/* save error */}
        {saveError && (
          <span className="font-sans text-[10px] text-rose-400 max-w-[180px] text-right shrink-0">
            {saveError}
          </span>
        )}
      </header>

      {/* ── MAIN 3-COLUMN LAYOUT ── */}
      <div className="relative flex-1 overflow-hidden z-10">
        <PanelGroup className="h-full">

          {/* ── LEFT: asset + anchor list ── */}
          <Panel defaultSize={20} minSize={16} maxSize={28}>
            <div className="h-full glass border-r border-gold-700/20 overflow-hidden">
              <AnchorPanel
                assetUrl={assetUrl}
                assetName={assetName}
                proceduralId={proceduralId}
                uploading={uploading}
                anchor={anchor}
                onUpload={handleUpload}
                onAnchorSelect={handleAnchorSelect}
                onSelectPreset={handleSelectPreset}
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-gold-700/10" />

          {/* ── CENTER: canvas ── */}
          <Panel defaultSize={56} minSize={40}>
            <div className="relative h-full bg-noir-900 overflow-hidden">

              {/* empty-state overlay — shown when no asset and in model mode */}
              {!assetUrl && !proceduralId && previewMode === 'model' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 pointer-events-none">
                  <div className="glass px-8 py-6 rounded-2xl flex flex-col items-center gap-3 text-center border border-gold-400/10">
                    <div className="w-14 h-14 rounded-full bg-gold-400/10 border border-gold-400/30
                                   flex items-center justify-center glow-soft">
                      <Box size={24} className="text-gold-400/60" />
                    </div>
                    <p className="font-serif italic text-xl text-ivory/60">Upload a 3D model to begin</p>
                    <p className="font-sans text-xs text-ivory/30 max-w-[220px] leading-relaxed">
                      Drop a .glb or .gltf in the left panel, then use the anchor picker to position it on the head.
                    </p>
                  </div>
                </div>
              )}

              {/* canvas (lazy-loaded) */}
              <Suspense
                fallback={
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 border-2 border-gold-400 border-t-transparent rounded-full animate-spin" />
                    <span className="font-label text-[10px] uppercase tracking-luxe text-gold-400/60">
                      Loading 3D…
                    </span>
                  </div>
                }
              >
                {previewMode === 'model' ? (
                  <ModelCanvas
                    assetUrl={assetUrl}
                    proceduralId={proceduralId}
                    anchor={anchor}
                    anchorConfig={anchorConfig}
                    onAnchorSelect={handleAnchorSelect}
                    onTransformChange={handleTransformChange}
                  />
                ) : (
                  <LiveCanvas
                    assetUrl={assetUrl}
                    proceduralId={proceduralId}
                    anchor={anchor}
                    anchorConfig={anchorConfig}
                    paused={paused}
                    onFaceVisible={setFaceVisible}
                    onTransformChange={handleTransformChange}
                  />
                )}
              </Suspense>

              {/* bottom caption pill */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none z-20">
                {previewMode === 'model' ? (
                  <div className="glass px-4 py-1.5 rounded-full flex items-center gap-3 border border-gold-400/10">
                    <span className="font-label text-[9px] uppercase tracking-luxe text-ivory/40">
                      Orbit: drag · Zoom: scroll · Gizmo: move · rotate · scale
                    </span>
                    <span className="w-px h-3 bg-ivory/20" />
                    <span className="font-label text-[9px] uppercase tracking-luxe text-gold-500/60">
                      Anchor: click gold dot
                    </span>
                  </div>
                ) : (
                  <div className="glass px-4 py-1.5 rounded-full flex items-center gap-3 border border-gold-400/10">
                    {paused ? (
                      <span className="font-label text-[9px] uppercase tracking-luxe text-gold-400 animate-pulse-glow">
                        ⏸ Tracking paused — adjust transforms, then resume
                      </span>
                    ) : faceVisible ? (
                      <span className="font-label text-[9px] uppercase tracking-luxe text-green-400/80">
                        ● Face detected — drag the gizmo to place (auto-pauses)
                      </span>
                    ) : (
                      <span className="font-label text-[9px] uppercase tracking-luxe text-ivory/40">
                        Look into the camera to preview placement
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-gold-700/10" />

          {/* ── RIGHT: properties ── */}
          <Panel defaultSize={24} minSize={20} maxSize={32}>
            <div className="h-full glass border-l border-gold-700/20 overflow-hidden">
              <PropertiesPanel
                name={name}
                isPublished={isPublished}
                featured={featured}
                anchorConfig={anchorConfig}
                saving={saving}
                thumbnailUrl={thumbUrl}
                onThumbnailUpload={handleThumbUpload}
                onThumbnailClear={clearThumb}
                onNameChange={setName}
                onPublishedChange={setIsPublished}
                onFeaturedChange={setFeatured}
                onTransformChange={handleTransformChange}
                onSave={handleSave}
                onBack={() => navigate('/admin/library')}
              />
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  );
}
