/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 2D / Shader Creator — live studio for authoring overlays, borders, and shader looks.
 * Left: settings panel  ·  Center: live camera preview with drag-to-place  ·  Right: properties.
 *
 * Shader picker uses FILTER_SHADERS (excludes the special 'golden-disintegration' dissolve
 * and the 'none' passthrough — those are not user-facing booth filters).
 */
import {
  useState, useEffect, useRef, useCallback, useMemo, ChangeEvent
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/* Lightweight fixed-proportion 3-column panels (robust replacement for the
   flaky react-resizable-panels v4 fork). Same names → no other edits needed. */
function PanelGroup({ children, className = '' }: { children: React.ReactNode; className?: string }) {
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
  // Strip the cursor class — these are non-resizable fixed shims.
  return <div className={className.replace('cursor-col-resize', '').trim()} />;
}

import {
  Save, ArrowLeft, Upload, Wand2, Loader, RotateCcw,
  Eye, EyeOff, Star, StarOff, X, Sparkles, Image as ImageIcon, LayoutTemplate,
} from 'lucide-react';
import EventBackground from '../ui/EventBackground';
import { FILTER_SHADERS, SHADER_MAP, defaultParams, ShaderRunner } from '../../lib/shaders';
import { getCameraStream, stopStream } from '../../lib/camera';
import { BUILTIN_BORDERS, toDataUrl } from '../../lib/borders';
import { getExperience, createExperience, updateExperience, uploadAsset } from '../../lib/db';
import { useEvent } from '../../events/EventContext';
import { useStudioBase } from './studioBase';
import type { ExperienceKind, Transform2D, ExperienceConfig } from '../../types';

/* ------------------------------------------------------------------ */
/* Types & constants                                                    */
/* ------------------------------------------------------------------ */

type StudioKind = 'shader' | 'border' | '2d_filter';

interface StickerTransform extends Transform2D {
  scale: number;
  x: number;
  y: number;
  rotation: number;
}

const DEFAULT_TRANSFORM: StickerTransform = { scale: 1, x: 0, y: 0, rotation: 0 };

const KIND_META: Record<StudioKind, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  shader:    { label: 'Shader Effect', icon: Sparkles },
  border:    { label: 'Border / Frame', icon: LayoutTemplate },
  '2d_filter': { label: 'Sticker', icon: ImageIcon },
};

/* ------------------------------------------------------------------ */
/* Utility                                                              */
/* ------------------------------------------------------------------ */

function blobFromSvg(svgStr: string): Blob {
  return new Blob([svgStr], { type: 'image/svg+xml' });
}

/* ------------------------------------------------------------------ */
/* Gold slider                                                          */
/* ------------------------------------------------------------------ */

function GoldSlider({
  label, value, min, max, step, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline">
        <span className="font-label uppercase tracking-widest text-[9px] text-champagne/60">{label}</span>
        <span className="font-mono text-[9px] text-gold-300">{value.toFixed(2)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 appearance-none rounded-full cursor-pointer"
        style={{
          background: `linear-gradient(to right, #D4AF37 0%, #D4AF37 ${pct}%, rgba(255,255,255,0.1) ${pct}%, rgba(255,255,255,0.1) 100%)`,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gemini Magic Generate                                                */
/* ------------------------------------------------------------------ */

const GEMINI_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';

function MagicGenerate({ onGenerated }: { onGenerated: (url: string, blob: Blob) => void }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError('');
    try {
      const body = {
        system_instruction: {
          parts: [{ text: 'Output ONLY valid SVG markup. No code fences, no explanation. Transparent background. viewBox="0 0 1080 1920". Design for a gala photo-booth overlay.' }],
        },
        contents: [{ parts: [{ text: prompt }] }],
      };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();
      let svg: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      svg = svg.replace(/^```[a-z]*\n?/im, '').replace(/```$/m, '').trim();
      if (!svg.startsWith('<svg')) throw new Error('Response was not SVG');
      const blob = blobFromSvg(svg);
      const url = URL.createObjectURL(blob);
      onGenerated(url, blob);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-xl border border-gold-400/20 p-4 flex flex-col gap-3">
      <p className="font-label uppercase tracking-widest text-[9px] text-gold-300 flex items-center gap-1.5">
        <Wand2 className="w-3 h-3" /> AI Generate Sticker
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe an overlay — e.g. 'golden crown with sparkles'…"
        rows={2}
        className="w-full bg-white/5 border border-gold-400/15 rounded-lg px-3 py-2 text-ivory text-xs placeholder-white/20 outline-none focus:border-gold-400/50 resize-none"
      />
      {error && <p className="text-red-400 text-[10px]">{error}</p>}
      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        className="flex items-center justify-center gap-1.5 py-2 bg-foil text-noir-900 rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 hover:scale-[1.02] transition-transform"
      >
        {loading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
        {loading ? 'Generating…' : 'Generate'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live preview with drag support                                       */
/* ------------------------------------------------------------------ */

interface PreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  shaderCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayUrl: string | null;
  transform: StickerTransform;
  kind: StudioKind;
  shaderId: string;
  onTransformChange: (t: StickerTransform) => void;
}

function LivePreview({
  videoRef,
  shaderCanvasRef,
  overlayUrl,
  transform,
  kind,
  shaderId,
  onTransformChange,
}: PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStart = useRef<{ mx: number; my: number; tx: number; ty: number }>({ mx: 0, my: 0, tx: 0, ty: 0 });

  // Wheel → scale (works for all kinds when an overlay is present)
  const onWheel = (e: React.WheelEvent) => {
    if (kind !== '2d_filter') return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    const next = Math.max(0.1, Math.min(5, transform.scale + delta));
    onTransformChange({ ...transform, scale: next });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (kind !== '2d_filter' || !overlayUrl) return;
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y };
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragStart.current.mx) / rect.width) * 100;
    const dy = ((e.clientY - dragStart.current.my) / rect.height) * 100;
    onTransformChange({
      ...transform,
      x: Math.max(-100, Math.min(100, dragStart.current.tx + dx)),
      y: Math.max(-100, Math.min(100, dragStart.current.ty + dy)),
    });
  }, [transform, onTransformChange]);

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Touch drag
  const touchStart = useRef<{ tx0: number; ty0: number; x0: number; y0: number }>({ tx0: 0, ty0: 0, x0: 0, y0: 0 });
  const onTouchStart = (e: React.TouchEvent) => {
    if (kind !== '2d_filter' || !overlayUrl) return;
    const t = e.touches[0];
    touchStart.current = { tx0: transform.x, ty0: transform.y, x0: t.clientX, y0: t.clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (kind !== '2d_filter' || !overlayUrl || !containerRef.current) return;
    e.preventDefault();
    const t = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const dx = ((t.clientX - touchStart.current.x0) / rect.width) * 100;
    const dy = ((t.clientY - touchStart.current.y0) / rect.height) * 100;
    onTransformChange({
      ...transform,
      x: Math.max(-100, Math.min(100, touchStart.current.tx0 + dx)),
      y: Math.max(-100, Math.min(100, touchStart.current.ty0 + dy)),
    });
  };

  // 2D sticker overlay position
  const overlayStyle: React.CSSProperties = kind === '2d_filter'
    ? {
        position: 'absolute',
        left: `calc(50% + ${transform.x}%)`,
        top: `calc(50% + ${transform.y}%)`,
        transform: `translate(-50%, -50%) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
        width: '60%',
        height: '60%',
        objectFit: 'contain',
        cursor: overlayUrl ? 'grab' : 'default',
        userSelect: 'none',
        pointerEvents: overlayUrl ? 'auto' : 'none',
        touchAction: 'none',
      }
    : {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        pointerEvents: 'none',
      };

  // Shader name for badge
  const shaderName = SHADER_MAP[shaderId]?.name ?? shaderId;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-noir-900 select-none rounded-xl"
      style={{ aspectRatio: '9/16', maxHeight: '100%' }}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      {/* Mirrored video */}
      <video
        ref={videoRef as React.RefObject<HTMLVideoElement>}
        id="creator-video"
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)', pointerEvents: 'none' }}
      />

      {/* Shader output canvas — always rendered, visibility via opacity layer logic */}
      <canvas
        ref={shaderCanvasRef as React.RefObject<HTMLCanvasElement>}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity"
        style={{ opacity: kind === 'shader' ? 1 : 0.35 }}
      />

      {/* 2D overlay or border image */}
      {overlayUrl && (kind === '2d_filter' || kind === 'border') && (
        <img
          src={overlayUrl}
          alt="overlay"
          style={overlayStyle}
          draggable={false}
        />
      )}

      {/* Top-left: mode badge */}
      <div className="absolute top-2 left-2 pointer-events-none">
        <span className="bg-noir-900/70 text-gold-400/70 text-[8px] font-label uppercase tracking-widest px-2 py-1 rounded-full backdrop-blur-sm">
          Live Preview
        </span>
      </div>

      {/* Shader name badge */}
      {kind === 'shader' && (
        <div className="absolute top-2 right-2 pointer-events-none">
          <span className="bg-gold-400/20 border border-gold-400/30 text-gold-300 text-[8px] font-label uppercase tracking-widest px-2 py-1 rounded-full backdrop-blur-sm">
            {shaderName}
          </span>
        </div>
      )}

      {/* Drag hint for 2D sticker */}
      {kind === '2d_filter' && overlayUrl && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="bg-noir-900/70 text-champagne/60 text-[9px] font-sans px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
            Drag · Scroll to scale
          </span>
        </div>
      )}

      {/* Empty state for 2D sticker with no overlay */}
      {kind === '2d_filter' && !overlayUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <div className="bg-noir-900/60 rounded-2xl px-6 py-4 flex flex-col items-center gap-2 backdrop-blur-sm border border-gold-400/10">
            <ImageIcon className="w-8 h-8 text-gold-400/40" />
            <p className="font-serif italic text-ivory/40 text-sm">Choose or upload a sticker</p>
          </div>
        </div>
      )}

      {/* Empty state for border with no overlay */}
      {kind === 'border' && !overlayUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <div className="bg-noir-900/60 rounded-2xl px-6 py-4 flex flex-col items-center gap-2 backdrop-blur-sm border border-gold-400/10">
            <LayoutTemplate className="w-8 h-8 text-gold-400/40" />
            <p className="font-serif italic text-ivory/40 text-sm">Select a frame above</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section header                                                       */
/* ------------------------------------------------------------------ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/50 mb-2">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Main Creator2D                                                       */
/* ------------------------------------------------------------------ */

export default function Creator2D() {
  const navigate = useNavigate();
  const base = useStudioBase();
  const { eventId } = useEvent();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');

  // Form state
  const [name, setName] = useState('Untitled Experience');
  const [kind, setKind] = useState<StudioKind>('shader');
  const [isPublished, setIsPublished] = useState(true);
  const [featured, setFeatured] = useState(false);

  // Shader state
  const [shaderId, setShaderId] = useState<string>('golden-hour-bloom');
  const [shaderParams, setShaderParams] = useState<Record<string, number>>(defaultParams('golden-hour-bloom'));

  // Border / sticker state
  const [selectedBorderId, setSelectedBorderId] = useState<string>('frame-classic');
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [overlayBlob, setOverlayBlob] = useState<Blob | null>(null);
  const [overlayIsBuiltin, setOverlayIsBuiltin] = useState(true);

  // Custom booth-icon thumbnail (uploaded by the author for the booth filter orb)
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Transform
  const [transform, setTransform] = useState<StickerTransform>(DEFAULT_TRANSFORM);

  // Status
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [camError, setCamError] = useState('');

  // Camera & shader refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runnerRef = useRef<ShaderRunner | null>(null);
  const rafRef = useRef<number>(0);

  /* ---- Camera init ---- */
  useEffect(() => {
    let active = true;

    // Create the shader runner independently of the camera. (It was previously
    // created inside the getUserMedia promise, so a WebGL failure landed in
    // .catch and showed a bogus "Camera unavailable" error.)
    try {
      runnerRef.current = new ShaderRunner(1080, 1920);
    } catch (e) {
      console.warn('[Creator2D] shader runner init failed', e);
    }

    getCameraStream({ facingMode: 'user' })
      .then((stream) => {
        if (!active) { stopStream(stream); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          // Explicit play() — autoplay alone is unreliable when srcObject is set
          // after the element mounts (the live preview would stay blank).
          v.onloadedmetadata = () => v.play().catch(() => {});
          v.play().catch(() => {});
        }
      })
      .catch((err) => {
        if (active) setCamError(`Camera unavailable: ${(err as Error)?.message ?? err}`);
      });

    return () => {
      active = false;
      stopStream(streamRef.current);
      cancelAnimationFrame(rafRef.current);
      runnerRef.current?.dispose();
    };
  }, []);

  /* ---- Shader render loop — always running so preview is live ---- */
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const draw = () => {
      const video = videoRef.current;
      const canvas = shaderCanvasRef.current;
      const runner = runnerRef.current;
      if (video && video.readyState >= 2 && canvas && runner?.available) {
        const result = runner.draw(video, shaderId, shaderParams, true);
        if (result) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            canvas.width = canvas.offsetWidth || 540;
            canvas.height = canvas.offsetHeight || 960;
            ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [shaderId, shaderParams]);

  /* ---- Load edit target ---- */
  useEffect(() => {
    if (!editId) return;
    setLoadingEdit(true);
    getExperience(eventId, editId).then((exp) => {
      if (!exp) { setLoadingEdit(false); return; }
      setName(exp.name);
      setIsPublished(exp.is_published);
      setFeatured(exp.featured);
      setThumbUrl(exp.thumbnail_url ?? null);
      const k = exp.kind as StudioKind;
      setKind(k);
      if (k === 'shader' && exp.config.shader) {
        const sid = exp.config.shader.shaderId;
        setShaderId(sid);
        setShaderParams(exp.config.shader.params ?? defaultParams(sid));
      }
      if ((k === 'border' || k === '2d_filter') && exp.asset_url) {
        // Load the SAVED asset exactly as stored. Treat it as a custom overlay
        // (overlayIsBuiltin=false) so the built-in "sync" effects never overwrite
        // the uploaded image with a default frame.
        setOverlayUrl(exp.asset_url);
        setOverlayBlob(null);
        setOverlayIsBuiltin(false);
      }
      if (exp.config.transform) setTransform(exp.config.transform as StickerTransform);
      setLoadingEdit(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  /* ---- Border URL sync — keep overlayUrl in sync when kind=border + builtin ---- */
  useEffect(() => {
    if (kind !== 'border' || !overlayIsBuiltin) return;
    const border = BUILTIN_BORDERS.find((b) => b.id === selectedBorderId);
    if (border) setOverlayUrl(toDataUrl(border.svg));
  }, [kind, selectedBorderId, overlayIsBuiltin]);

  /* ---- 2D sticker builtin sync ---- */
  useEffect(() => {
    if (kind !== '2d_filter' || !overlayIsBuiltin) return;
    const border = BUILTIN_BORDERS.find((b) => b.id === selectedBorderId && b.kind === '2d_filter');
    if (border) setOverlayUrl(toDataUrl(border.svg));
  }, [kind, selectedBorderId, overlayIsBuiltin]);

  /* ---- Shader change — reset params ---- */
  const handleShaderChange = useCallback((id: string) => {
    setShaderId(id);
    setShaderParams(defaultParams(id));
  }, []);

  /* ---- Kind switch — clear upload state cleanly ---- */
  const handleKindChange = useCallback((k: StudioKind) => {
    setKind(k);
    setSaveError(null);
    // When switching to border, restore the default builtin border
    if (k === 'border') {
      setOverlayIsBuiltin(true);
      setOverlayBlob(null);
      const border = BUILTIN_BORDERS.find((b) => b.id === selectedBorderId && b.kind === 'border')
        ?? BUILTIN_BORDERS.find((b) => b.kind === 'border');
      if (border) { setSelectedBorderId(border.id); setOverlayUrl(toDataUrl(border.svg)); }
    } else if (k === '2d_filter') {
      setOverlayIsBuiltin(true);
      setOverlayBlob(null);
      const ov = BUILTIN_BORDERS.find((b) => b.kind === '2d_filter');
      if (ov) { setSelectedBorderId(ov.id); setOverlayUrl(toDataUrl(ov.svg)); }
    }
    // shader kind — clear overlay so the video shows cleanly
    if (k === 'shader') {
      setOverlayUrl(null);
      setOverlayBlob(null);
    }
  }, [selectedBorderId]);

  /* ---- File upload ---- */
  const handleFileUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setOverlayUrl(url);
    setOverlayBlob(file);
    setOverlayIsBuiltin(false);
    e.target.value = ''; // allow re-upload of same file
  }, []);

  /* ---- Booth-icon thumbnail upload ---- */
  const handleThumbUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setThumbBlob(file);
    setThumbUrl(URL.createObjectURL(file));
    e.target.value = '';
  }, []);
  const clearThumb = useCallback(() => { setThumbBlob(null); setThumbUrl(null); }, []);

  /* ---- Save ---- */
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      let asset_url: string | null = null;
      let thumbnail_url: string | null = null;

      if (kind === 'border' || kind === '2d_filter') {
        if (overlayIsBuiltin) {
          const border = BUILTIN_BORDERS.find((b) => b.id === selectedBorderId);
          if (border) {
            const blob = blobFromSvg(border.svg);
            asset_url = await uploadAsset(blob, `${border.id}.svg`);
          }
        } else if (overlayBlob) {
          asset_url = await uploadAsset(overlayBlob, `${name.replace(/\s+/g, '-').toLowerCase()}`);
        } else if (overlayUrl && (overlayUrl.startsWith('http') || overlayUrl.startsWith('data:'))) {
          asset_url = overlayUrl; // already a stored URL (remote upload or data URI) — keep it
        }
      }

      // Booth-icon thumbnail: use the author's uploaded icon (preferred), or keep
      // an existing one. If none, leave null — the booth falls back to the frame
      // art. (No more auto-captured camera photos.)
      if (thumbBlob) {
        thumbnail_url = await uploadAsset(thumbBlob, `icon-${name.replace(/\s+/g, '-').toLowerCase()}`);
      } else if (thumbUrl && thumbUrl.startsWith('http')) {
        thumbnail_url = thumbUrl;
      }

      const config: ExperienceConfig = {};
      if (kind === 'shader') {
        config.shader = { shaderId, params: shaderParams };
      } else {
        config.transform = transform;
        config.opacity = 1;
      }

      const draft = {
        name,
        kind: kind as ExperienceKind,
        asset_url,
        thumbnail_url,
        config,
        is_published: isPublished,
        featured,
        sort_order: 0,
      };

      const result = editId
        ? await updateExperience(eventId, editId, draft)
        : await createExperience(eventId, draft);

      if (!result) {
        setSaveError('Save failed — check connection and try again.');
      } else {
        navigate(`${base}/library`);
      }
    } catch (err) {
      console.error('[creator2d] save error', err);
      setSaveError('Unexpected error — see console.');
    } finally {
      setSaving(false);
    }
  }, [kind, overlayBlob, overlayIsBuiltin, overlayUrl, selectedBorderId, shaderId, shaderParams, transform, name, isPublished, featured, thumbBlob, thumbUrl, editId, navigate, base]);

  const shaderDef = useMemo(() => SHADER_MAP[shaderId], [shaderId]);

  /* ---- Loading state ---- */
  if (loadingEdit) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-noir-900">
        <EventBackground density={24} />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-gold-400 animate-spin" />
          <p className="font-sans text-sm text-champagne/50">Loading experience…</p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="absolute inset-0 flex flex-col bg-noir-900 overflow-hidden">
      <EventBackground density={20} />

      {/* ── TOP BAR ── */}
      <div className="relative z-20 shrink-0 h-14 flex items-center justify-between px-4 glass-strong border-b border-gold-400/15">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(`${base}/library`)}
            className="p-1.5 glass rounded-lg text-champagne/50 hover:text-ivory transition-colors shrink-0"
            aria-label="Back to library"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent font-serif italic text-lg text-ivory outline-none border-b border-transparent focus:border-gold-400/40 px-1 min-w-0 w-44"
            placeholder="Experience name…"
          />
          {editId && (
            <span className="text-[9px] font-label uppercase tracking-widest text-gold-400/50 bg-gold-400/10 px-2 py-0.5 rounded-full shrink-0">
              Editing
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Published toggle */}
          <button
            onClick={() => setIsPublished((v) => !v)}
            title={isPublished ? 'Click to unpublish' : 'Click to publish'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-label uppercase tracking-widest transition-colors ${isPublished ? 'bg-gold-400/20 text-gold-300' : 'glass text-champagne/40 hover:text-ivory'}`}
          >
            {isPublished ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {isPublished ? 'Live' : 'Hidden'}
          </button>
          {/* Featured */}
          <button
            onClick={() => setFeatured((v) => !v)}
            title={featured ? 'Remove from featured' : 'Mark as featured'}
            className={`p-1.5 rounded-xl transition-colors ${featured ? 'text-gold-400 bg-gold-400/10' : 'glass text-champagne/30 hover:text-gold-300'}`}
          >
            {featured ? <Star className="w-4 h-4 fill-gold-400" /> : <StarOff className="w-4 h-4" />}
          </button>

          {/* Save error */}
          {saveError && (
            <span className="text-red-400 text-[10px] font-sans max-w-[160px] text-right">{saveError}</span>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-foil text-noir-900 font-bold text-[10px] font-label uppercase tracking-widest rounded-xl glow-accent hover:scale-[1.02] transition-transform disabled:opacity-50"
          >
            {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving…' : editId ? 'Update' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── THREE-PANEL LAYOUT ── */}
      <div className="relative z-10 flex-1 overflow-hidden">
        <PanelGroup className="h-full">

          {/* LEFT: Settings */}
          <Panel defaultSize={26} minSize={20} maxSize={36}>
            <div className="h-full overflow-y-auto hide-scrollbar p-4 flex flex-col gap-5 border-r border-gold-400/10">

              {/* Kind selector */}
              <div>
                <SectionLabel>Experience Type</SectionLabel>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['shader', 'border', '2d_filter'] as StudioKind[]).map((k) => {
                    const meta = KIND_META[k];
                    const Icon = meta.icon;
                    return (
                      <button
                        key={k}
                        onClick={() => handleKindChange(k)}
                        className={`py-2.5 px-1 rounded-xl text-[9px] font-label uppercase tracking-widest transition-all flex flex-col items-center gap-1 ${kind === k ? 'bg-gold-400/20 text-gold-300 ring-1 ring-gold-400/30' : 'glass text-champagne/40 hover:text-ivory hover:bg-white/5'}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {k === '2d_filter' ? 'Sticker' : k === 'border' ? 'Border' : 'Shader'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── SHADER settings ── */}
              {kind === 'shader' && (
                <div className="flex flex-col gap-3">
                  <SectionLabel>Shader Effect</SectionLabel>
                  {/* Use FILTER_SHADERS — excludes 'none' and special effects */}
                  <div className="flex flex-col gap-1">
                    {FILTER_SHADERS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleShaderChange(s.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${shaderId === s.id ? 'bg-gold-400/20 ring-1 ring-gold-400/30' : 'glass hover:bg-white/5'}`}
                      >
                        <div className="flex items-center justify-between">
                          <p className={`text-xs font-sans font-medium ${shaderId === s.id ? 'text-gold-300' : 'text-ivory'}`}>
                            {s.name}
                          </p>
                          {s.animated && (
                            <span className="text-[7px] font-label uppercase tracking-widest text-gold-400/50 bg-gold-400/10 px-1.5 py-0.5 rounded-full">Anim</span>
                          )}
                        </div>
                        <p className="text-[9px] text-champagne/35 mt-0.5 leading-tight">{s.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── BORDER settings ── */}
              {kind === 'border' && (
                <div className="flex flex-col gap-4">
                  <div>
                    <SectionLabel>Built-in Frames</SectionLabel>
                    <div className="flex flex-col gap-1">
                      {BUILTIN_BORDERS.filter((b) => b.kind === 'border').map((b) => {
                        const active = selectedBorderId === b.id && overlayIsBuiltin;
                        return (
                          <button
                            key={b.id}
                            onClick={() => {
                              setSelectedBorderId(b.id);
                              setOverlayUrl(toDataUrl(b.svg));
                              setOverlayIsBuiltin(true);
                              setOverlayBlob(null);
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${active ? 'bg-gold-400/20 ring-1 ring-gold-400/30 text-gold-300' : 'glass hover:bg-white/5 text-champagne/60 hover:text-ivory'}`}
                          >
                            <p className="text-xs font-sans">{b.name}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="border-t border-white/8 pt-3">
                    <SectionLabel>Upload Custom (PNG / SVG 1080×1920)</SectionLabel>
                    <label className="flex items-center gap-2 px-3 py-2.5 glass rounded-xl cursor-pointer hover:bg-white/5 transition-colors">
                      <Upload className="w-3.5 h-3.5 text-gold-300" />
                      <span className="text-xs text-champagne/60">Browse file…</span>
                      <input type="file" accept="image/png,image/svg+xml" className="sr-only" onChange={handleFileUpload} />
                    </label>
                    {!overlayIsBuiltin && overlayUrl && (
                      <button
                        onClick={() => {
                          setOverlayIsBuiltin(true);
                          setOverlayBlob(null);
                          const border = BUILTIN_BORDERS.find((b) => b.id === selectedBorderId && b.kind === 'border');
                          if (border) setOverlayUrl(toDataUrl(border.svg));
                        }}
                        className="mt-1 flex items-center gap-1.5 px-3 py-1.5 glass rounded-xl text-[9px] font-label uppercase tracking-widest text-red-400/70 hover:text-red-400 transition-colors w-full"
                      >
                        <X className="w-3 h-3" /> Remove Custom
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── 2D Sticker settings ── */}
              {kind === '2d_filter' && (
                <div className="flex flex-col gap-4">
                  <div>
                    <SectionLabel>Built-in Overlays</SectionLabel>
                    <div className="flex flex-col gap-1">
                      {BUILTIN_BORDERS.filter((b) => b.kind === '2d_filter').map((b) => {
                        const active = selectedBorderId === b.id && overlayIsBuiltin;
                        return (
                          <button
                            key={b.id}
                            onClick={() => {
                              setSelectedBorderId(b.id);
                              setOverlayUrl(toDataUrl(b.svg));
                              setOverlayIsBuiltin(true);
                              setOverlayBlob(null);
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${active ? 'bg-gold-400/20 ring-1 ring-gold-400/30 text-gold-300' : 'glass hover:bg-white/5 text-champagne/60 hover:text-ivory'}`}
                          >
                            <p className="text-xs font-sans">{b.name}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-white/8 pt-3 flex flex-col gap-2">
                    <SectionLabel>Upload Sticker (PNG / SVG)</SectionLabel>
                    <label className="flex items-center gap-2 px-3 py-2.5 glass rounded-xl cursor-pointer hover:bg-white/5 transition-colors">
                      <Upload className="w-3.5 h-3.5 text-gold-300" />
                      <span className="text-xs text-champagne/60">Browse file…</span>
                      <input type="file" accept="image/png,image/svg+xml" className="sr-only" onChange={handleFileUpload} />
                    </label>
                    {overlayUrl && (
                      <button
                        onClick={() => { setOverlayUrl(null); setOverlayBlob(null); setOverlayIsBuiltin(false); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 glass rounded-xl text-[9px] font-label uppercase tracking-widest text-red-400/70 hover:text-red-400 transition-colors"
                      >
                        <X className="w-3 h-3" /> Clear Sticker
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Booth icon thumbnail */}
              {(kind === 'border' || kind === '2d_filter') && (
                <div className="border-t border-white/8 pt-3">
                  <SectionLabel>Booth Icon (optional)</SectionLabel>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-noir-800 border border-gold-400/15 flex items-center justify-center shrink-0">
                      {thumbUrl
                        ? <img src={thumbUrl} alt="icon" className="w-full h-full object-cover" />
                        : <ImageIcon className="w-5 h-5 text-gold-400/40" />}
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                      <label className="flex items-center gap-2 px-3 py-2 glass rounded-xl cursor-pointer hover:bg-white/5 transition-colors text-xs text-champagne/60">
                        <Upload className="w-3.5 h-3.5 text-gold-300 shrink-0" />
                        {thumbUrl ? 'Replace icon' : 'Upload icon'}
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={handleThumbUpload} />
                      </label>
                      {thumbUrl && (
                        <button onClick={clearThumb} className="flex items-center gap-1.5 px-3 py-1 glass rounded-xl text-[9px] font-label uppercase tracking-widest text-red-400/70 hover:text-red-400 transition-colors w-full justify-center">
                          <X className="w-3 h-3" /> Remove icon
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[9px] text-champagne/35 mt-1.5 leading-relaxed">
                    Shown as this filter's icon in the booth picker. If empty, the frame art is used.
                  </p>
                </div>
              )}

              {/* AI sticker generator */}
              {GEMINI_KEY && kind === '2d_filter' && (
                <MagicGenerate
                  onGenerated={(url, blob) => {
                    setOverlayUrl(url);
                    setOverlayBlob(blob);
                    setOverlayIsBuiltin(false);
                  }}
                />
              )}

              {/* Camera error */}
              {camError && (
                <div className="rounded-xl bg-red-900/30 border border-red-400/20 p-3 text-xs text-red-300">
                  {camError}
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-gold-400/10" />

          {/* CENTER: Live preview */}
          <Panel defaultSize={46} minSize={30}>
            <div className="h-full flex items-center justify-center bg-noir-900/40 p-4">
              <div className="relative h-full" style={{ aspectRatio: '9/16', maxWidth: '100%' }}>
                <LivePreview
                  videoRef={videoRef}
                  shaderCanvasRef={shaderCanvasRef}
                  overlayUrl={overlayUrl}
                  transform={transform}
                  kind={kind}
                  shaderId={shaderId}
                  onTransformChange={setTransform}
                />
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-gold-400/10" />

          {/* RIGHT: Properties */}
          <Panel defaultSize={28} minSize={22} maxSize={38}>
            <div className="h-full overflow-y-auto hide-scrollbar p-4 flex flex-col gap-5 border-l border-gold-400/10">
              <SectionLabel>Properties</SectionLabel>

              {/* ── Shader params ── */}
              {kind === 'shader' && shaderDef && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-sans text-xs text-ivory font-medium">{shaderDef.name}</p>
                      {shaderDef.animated && (
                        <p className="text-[9px] text-gold-400/50 font-label uppercase tracking-widest mt-0.5">Animated</p>
                      )}
                    </div>
                    {shaderDef.params.length > 0 && (
                      <button
                        onClick={() => setShaderParams(defaultParams(shaderId))}
                        className="flex items-center gap-1 text-[9px] text-champagne/40 hover:text-gold-300 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>
                    )}
                  </div>

                  {shaderDef.params.length > 0 ? (
                    shaderDef.params.map((p) => (
                      <GoldSlider
                        key={p.key}
                        label={p.label}
                        value={shaderParams[p.key] ?? p.default}
                        min={p.min}
                        max={p.max}
                        step={p.step}
                        onChange={(v) => setShaderParams((prev) => ({ ...prev, [p.key]: v }))}
                      />
                    ))
                  ) : (
                    <p className="text-[10px] text-champagne/30 font-sans">No adjustable parameters for this effect.</p>
                  )}

                  <p className="text-[9px] text-champagne/30 font-sans leading-relaxed">
                    {shaderDef.description}
                  </p>
                </div>
              )}

              {/* ── Transform controls (2D sticker) ── */}
              {kind === '2d_filter' && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <p className="font-sans text-xs text-ivory font-medium">Sticker Transform</p>
                    <button
                      onClick={() => setTransform(DEFAULT_TRANSFORM)}
                      className="flex items-center gap-1 text-[9px] text-champagne/40 hover:text-gold-300 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Reset
                    </button>
                  </div>
                  <p className="text-[9px] text-champagne/40 font-sans -mt-2">
                    Drag on preview to reposition · Scroll to scale.
                  </p>
                  <GoldSlider
                    label="Scale"
                    value={transform.scale}
                    min={0.1}
                    max={3}
                    step={0.05}
                    onChange={(v) => setTransform((t) => ({ ...t, scale: v }))}
                  />
                  <GoldSlider
                    label="X Position (%)"
                    value={transform.x}
                    min={-100}
                    max={100}
                    step={0.5}
                    onChange={(v) => setTransform((t) => ({ ...t, x: v }))}
                  />
                  <GoldSlider
                    label="Y Position (%)"
                    value={transform.y}
                    min={-100}
                    max={100}
                    step={0.5}
                    onChange={(v) => setTransform((t) => ({ ...t, y: v }))}
                  />
                  <GoldSlider
                    label="Rotation (°)"
                    value={transform.rotation}
                    min={-180}
                    max={180}
                    step={1}
                    onChange={(v) => setTransform((t) => ({ ...t, rotation: v }))}
                  />
                </div>
              )}

              {/* ── Border info ── */}
              {kind === 'border' && (
                <div className="glass rounded-xl border border-gold-400/10 p-4 flex flex-col gap-2">
                  <p className="font-label uppercase tracking-luxe text-[9px] text-gold-400/60">Full Frame</p>
                  <p className="font-sans text-xs text-champagne/50 leading-relaxed">
                    Borders are rendered at 1080×1920 covering the entire frame. Choose a built-in design or upload a custom transparent PNG/SVG.
                  </p>
                </div>
              )}

              {/* ── Info strip ── */}
              <div className="mt-auto glass rounded-xl border border-gold-400/10 p-3 flex flex-col gap-1.5">
                <div className="flex justify-between text-[9px]">
                  <span className="font-label uppercase tracking-widest text-champagne/40">Type</span>
                  <span className="text-gold-300 font-sans capitalize">{kind.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between text-[9px]">
                  <span className="font-label uppercase tracking-widest text-champagne/40">Mode</span>
                  <span className="text-gold-300 font-sans">{editId ? 'Editing' : 'Creating'}</span>
                </div>
                <div className="flex justify-between text-[9px]">
                  <span className="font-label uppercase tracking-widest text-champagne/40">Status</span>
                  <span className={`font-sans ${isPublished ? 'text-emerald-400' : 'text-champagne/40'}`}>
                    {isPublished ? 'Published' : 'Draft'}
                  </span>
                </div>
                {kind === 'shader' && (
                  <div className="flex justify-between text-[9px]">
                    <span className="font-label uppercase tracking-widest text-champagne/40">Shader</span>
                    <span className="text-gold-300 font-sans truncate max-w-[120px]">{shaderDef?.name ?? shaderId}</span>
                  </div>
                )}
              </div>
            </div>
          </Panel>

        </PanelGroup>
      </div>
    </div>
  );
}
