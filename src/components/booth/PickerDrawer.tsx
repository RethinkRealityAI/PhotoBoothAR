/**
 * Collapsible bottom-sheet picker drawer.
 *
 * Collapsed  → a slim gold bar showing current selections; tap to expand.
 * Expanded   → three segmented sections stacked vertically with horizontal
 *              thumbnail rails:
 *                • EFFECTS   – FILTER_SHADERS (live, combinable)
 *                • FRAMES    – border / 2d_filter experiences
 *                • 3D        – 3d_attachment experiences
 *
 * Each section has a clear "None" option. Selecting persists state in parent;
 * collapse collapses the sheet so the camera viewport is unobstructed.
 */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronUp, ChevronDown, Sparkles, Square, Box } from 'lucide-react';
import { Experience } from '../../types';

interface Props {
  catalog: Experience[];
  effectId: string;
  sparkles: boolean;
  frameId: string | null;
  attachmentId: string | null;
  onSelectEffect: (id: string) => void;
  onToggleSparkles: (v: boolean) => void;
  onSelectFrame: (exp: Experience | null) => void;
  onSelectAttachment: (exp: Experience | null) => void;
  /** Controlled open state (optional). When provided with hideBar, acts as a sheet. */
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /** Hide the collapsed summary bar (used when opened as a "More" sheet). */
  hideBar?: boolean;
}

// Gradient swatch colors per effect id
const EFFECT_SWATCHES: Record<string, string> = {
  'champagne-sparkle': 'from-yellow-200 to-amber-400',
  'golden-hour-bloom': 'from-amber-300 to-orange-500',
  'prismatic-holo': 'from-violet-400 to-cyan-400',
  'aureate-god-rays': 'from-yellow-400 to-amber-700',
  'velvet-film': 'from-stone-500 to-stone-800',
  'crystalline-kaleidoscope': 'from-cyan-300 to-blue-600',
  'celestial-lens-flare': 'from-amber-200 to-yellow-600',
  'aurora-lumina': 'from-yellow-200 to-amber-500',
};

function EffectThumb({ id, name, selected, onSelect }: {
  id: string; name: string; selected: boolean; onSelect: () => void;
}) {
  const grad = EFFECT_SWATCHES[id];
  return (
    <button
      onClick={onSelect}
      className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
      aria-pressed={selected}
    >
      <div
        className={`w-14 h-14 rounded-2xl transition-all duration-200 relative overflow-hidden flex items-center justify-center
          ${selected ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-noir-900 scale-110' : 'opacity-70 group-hover:opacity-95'}
          ${grad ? `bg-gradient-to-br ${grad}` : 'bg-noir-700'}`}
      >
        {id === 'none' && <span className="text-champagne/50 text-xl">∅</span>}
        {id === 'champagne-sparkle' && <span className="text-xl">✨</span>}
        {id === 'golden-hour-bloom' && <span className="text-xl">🥂</span>}
        {id === 'prismatic-holo' && <span className="text-xl">🌈</span>}
        {id === 'aureate-god-rays' && <span className="text-xl">🌅</span>}
        {id === 'velvet-film' && <span className="text-xl">🎞️</span>}
        {id === 'crystalline-kaleidoscope' && <span className="text-xl">💎</span>}
        {id === 'celestial-lens-flare' && <span className="text-xl">☀️</span>}
        {id === 'aurora-lumina' && <span className="text-xl">🌟</span>}
      </div>
      <span className={`font-label text-[8px] uppercase tracking-wide max-w-[56px] text-center leading-tight ${selected ? 'text-gold-400' : 'text-champagne/50'}`}>
        {name}
      </span>
    </button>
  );
}

function FrameThumb({ exp, selected, onSelect }: {
  exp: Experience | null; selected: boolean; onSelect: () => void;
}) {
  const isNone = exp === null;
  return (
    <button
      onClick={onSelect}
      className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
      aria-pressed={selected}
    >
      <div
        className={`w-14 h-14 rounded-2xl transition-all duration-200 overflow-hidden flex items-center justify-center border
          ${selected ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-noir-900 scale-110 border-gold-400/30' : 'opacity-70 group-hover:opacity-95 border-ivory/10'}`}
        style={{ background: 'linear-gradient(135deg, #1A130C, #2a1f0f)' }}
      >
        {isNone ? (
          <span className="text-champagne/40 text-xl">∅</span>
        ) : exp?.thumbnail_url ? (
          <img src={exp.thumbnail_url} alt={exp.name} className="w-full h-full object-cover" />
        ) : exp?.asset_url ? (
          <img src={exp.asset_url} alt={exp.name} className="w-full h-full object-contain p-1" />
        ) : (
          <span className="text-gold-400/60 text-lg">▣</span>
        )}
      </div>
      <span className={`font-label text-[8px] uppercase tracking-wide max-w-[56px] text-center leading-tight ${selected ? 'text-gold-400' : 'text-champagne/50'}`}>
        {isNone ? 'None' : exp?.name}
      </span>
    </button>
  );
}

function AttachmentThumb({ exp, selected, onSelect }: {
  exp: Experience | null; selected: boolean; onSelect: () => void;
}) {
  const isNone = exp === null;
  return (
    <button
      onClick={onSelect}
      className="flex flex-col items-center gap-1.5 flex-shrink-0 group"
      aria-pressed={selected}
    >
      <div
        className={`w-14 h-14 rounded-2xl transition-all duration-200 border flex items-center justify-center relative overflow-hidden
          ${selected ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-noir-900 scale-110 border-gold-400/30' : 'opacity-70 group-hover:opacity-95 border-ivory/10'}`}
        style={{ background: 'linear-gradient(135deg, #12100a, #1e1609)' }}
      >
        {isNone ? (
          <span className="text-champagne/40 text-xl">∅</span>
        ) : exp?.thumbnail_url ? (
          <img src={exp.thumbnail_url} alt={exp.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center">
            <Box className="w-5 h-5 text-gold-400/60" strokeWidth={1.5} />
            <span className="font-label text-[6px] uppercase text-gold-400/50 mt-0.5">3D</span>
          </div>
        )}
      </div>
      <span className={`font-label text-[8px] uppercase tracking-wide max-w-[56px] text-center leading-tight ${selected ? 'text-gold-400' : 'text-champagne/50'}`}>
        {isNone ? 'None' : exp?.name}
      </span>
    </button>
  );
}

export default function PickerDrawer({
  catalog, effectId, sparkles, frameId, attachmentId,
  onSelectEffect, onToggleSparkles, onSelectFrame, onSelectAttachment,
  open: controlledOpen, onOpenChange, hideBar = false,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setInternalOpen(v));

  // Effects derive from the catalog (shader experiences) so hidden/reordered
  // presets are respected — same as frames and 3D.
  const effects = catalog.filter((e) => e.kind === 'shader');
  const frames = catalog.filter((e) => e.kind === 'border' || e.kind === '2d_filter');
  const attachments = catalog.filter((e) => e.kind === '3d_attachment');

  const effectName = effectId === 'none'
    ? 'No Effect'
    : effects.find((e) => e.config?.shader?.shaderId === effectId)?.name ?? effectId;
  const frameName = frameId ? (catalog.find((e) => e.id === frameId)?.name ?? 'Frame') : 'No Frame';
  const attachName = attachmentId ? (catalog.find((e) => e.id === attachmentId)?.name ?? '3D') : 'No 3D';

  const handleSelectEffect = useCallback((id: string) => {
    onSelectEffect(id);
    // Don't auto-close — let user combine effect + frame
  }, [onSelectEffect]);

  const hasAny = effectId !== 'none' || sparkles || frameId !== null || attachmentId !== null;

  return (
    <div className="w-full">
      {/* ── Collapsed bar ─────────────────────────────────────────────── */}
      {!hideBar && (
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 transition-all duration-200 ${open ? 'rounded-t-2xl' : 'rounded-2xl'} glass-strong`}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          {hasAny ? (
            <>
              {effectId !== 'none' && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gold-400/15 border border-gold-400/25">
                  <Sparkles className="w-3 h-3 text-gold-400" />
                  <span className="font-label text-[8px] uppercase tracking-wide text-gold-300">{effectName}</span>
                </span>
              )}
              {sparkles && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gold-400/15 border border-gold-400/25">
                  <Sparkles className="w-3 h-3 text-gold-400" />
                  <span className="font-label text-[8px] uppercase tracking-wide text-gold-300">Sparkles</span>
                </span>
              )}
              {frameId !== null && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gold-400/10 border border-gold-400/20">
                  <Square className="w-3 h-3 text-gold-400" />
                  <span className="font-label text-[8px] uppercase tracking-wide text-gold-300">{frameName}</span>
                </span>
              )}
              {attachmentId !== null && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gold-400/10 border border-gold-400/20">
                  <Box className="w-3 h-3 text-gold-400" />
                  <span className="font-label text-[8px] uppercase tracking-wide text-gold-300">{attachName}</span>
                </span>
              )}
            </>
          ) : (
            <span className="font-label text-[9px] uppercase tracking-luxe text-champagne/40">
              Choose Effects · Frames · 3D
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-champagne/40">
          <span className="font-label text-[8px] uppercase tracking-wide">{open ? 'Close' : 'Customise'}</span>
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </div>
      </button>
      )}

      {/* ── Expanded panel ────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className={`overflow-hidden glass-strong ${hideBar ? 'rounded-t-3xl' : 'rounded-b-2xl'}`}
          >
            {hideBar && (
              <div className="flex items-center justify-between px-5 pt-4 pb-1">
                <span className="font-label uppercase tracking-luxe text-[11px] text-gold-300">All Filters</span>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full glass flex items-center justify-center text-champagne/50 hover:text-ivory transition-colors"
                  aria-label="Close"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="px-1 pt-3 pb-4 space-y-4 max-h-[55vh] overflow-y-auto hide-scrollbar">

              {/* SPARKLES — independent layer, combines with any effect + frame */}
              <div className="px-3">
                <button
                  onClick={() => onToggleSparkles(!sparkles)}
                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 border transition-all ${
                    sparkles
                      ? 'bg-gold-400/15 border-gold-400/40'
                      : 'bg-noir-800/40 border-gold-700/20 hover:border-gold-500/40'
                  }`}
                  aria-pressed={sparkles}
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className={`w-4 h-4 ${sparkles ? 'text-gold-300' : 'text-gold-400/60'}`} />
                    <span className={`font-label text-[10px] uppercase tracking-luxe ${sparkles ? 'text-gold-200' : 'text-champagne/60'}`}>
                      Sparkles
                    </span>
                    <span className="font-sans text-[9px] text-champagne/30 normal-case tracking-normal hidden xs:inline">
                      layers over everything
                    </span>
                  </span>
                  <span className={`relative w-9 h-5 rounded-full transition-colors ${sparkles ? 'bg-gold-400/80' : 'bg-noir-700'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-ivory transition-all ${sparkles ? 'left-[18px]' : 'left-0.5'}`} />
                  </span>
                </button>
              </div>

              {/* EFFECTS section */}
              <div>
                <div className="flex items-center gap-2 px-3 mb-2">
                  <Sparkles className="w-3 h-3 text-gold-400/70" />
                  <span className="font-label uppercase tracking-luxe text-[8px] text-champagne/40">Effects</span>
                </div>
                <div className="flex gap-3 px-3 overflow-x-auto hide-scrollbar pb-1">
                  {/* None */}
                  <EffectThumb
                    id="none"
                    name="None"
                    selected={effectId === 'none'}
                    onSelect={() => handleSelectEffect('none')}
                  />
                  {effects.map((exp) => {
                    const sid = exp.config?.shader?.shaderId ?? '';
                    return (
                      <EffectThumb
                        key={exp.id}
                        id={sid}
                        name={exp.name}
                        selected={effectId === sid}
                        onSelect={() => handleSelectEffect(sid)}
                      />
                    );
                  })}
                </div>
              </div>

              {/* FRAMES section */}
              <div>
                <div className="flex items-center gap-2 px-3 mb-2">
                  <Square className="w-3 h-3 text-gold-400/70" />
                  <span className="font-label uppercase tracking-luxe text-[8px] text-champagne/40">Frames</span>
                </div>
                <div className="flex gap-3 px-3 overflow-x-auto hide-scrollbar pb-1">
                  <FrameThumb exp={null} selected={frameId === null} onSelect={() => onSelectFrame(null)} />
                  {frames.map((exp) => (
                    <FrameThumb
                      key={exp.id}
                      exp={exp}
                      selected={frameId === exp.id}
                      onSelect={() => onSelectFrame(exp)}
                    />
                  ))}
                </div>
                {frames.length === 0 && (
                  <p className="px-3 text-[10px] text-champagne/20 font-label italic">Loading…</p>
                )}
              </div>

              {/* 3D section (only if there are 3D attachments) */}
              {attachments.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 px-3 mb-2">
                    <Box className="w-3 h-3 text-gold-400/70" />
                    <span className="font-label uppercase tracking-luxe text-[8px] text-champagne/40">3D</span>
                  </div>
                  <div className="flex gap-3 px-3 overflow-x-auto hide-scrollbar pb-1">
                    <AttachmentThumb exp={null} selected={attachmentId === null} onSelect={() => onSelectAttachment(null)} />
                    {attachments.map((exp) => (
                      <AttachmentThumb
                        key={exp.id}
                        exp={exp}
                        selected={attachmentId === exp.id}
                        onSelect={() => onSelectAttachment(exp)}
                      />
                    ))}
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
