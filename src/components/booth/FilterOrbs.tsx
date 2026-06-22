/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FilterOrbs — Instagram / Snapchat-style quick-switch rail above the shutter.
 * Grouped into clearly-separated sections (Quick · Effects · Frames · 3D), each
 * showing up to 3 orbs so guests can reach every filter TYPE without scrolling
 * far. The full set lives behind the "All Filters" sheet. Orbs show a thumbnail
 * of each filter (effect gradient, frame preview, 3D thumbnail/icon) so guests
 * can see what they are. The active item in each group is always shown.
 */
import { Sparkles, Ban, Crown } from 'lucide-react';
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
}

const EFFECT_GRADIENT: Record<string, string> = {
  'champagne-sparkle': 'from-yellow-200 to-amber-400',
  'golden-hour-bloom': 'from-amber-300 to-orange-500',
  'prismatic-holo': 'from-violet-400 to-cyan-400',
  'aureate-god-rays': 'from-yellow-400 to-amber-700',
  'velvet-film': 'from-stone-400 to-stone-700',
  'crystalline-kaleidoscope': 'from-cyan-300 to-blue-600',
  'celestial-lens-flare': 'from-amber-200 to-yellow-600',
  'aurora-lumina': 'from-yellow-200 to-amber-500',
};

/** Up to 3 items, always including the active one. */
function pick3<T extends { id: string }>(items: T[], activeId: string | null): T[] {
  if (!activeId) return items.slice(0, 3);
  const active = items.find((i) => i.id === activeId);
  if (!active) return items.slice(0, 3);
  return [active, ...items.filter((i) => i.id !== activeId).slice(0, 2)];
}

function Orb({
  active, onClick, label, children, ring = 'gold',
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  ring?: 'gold' | 'dim';
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 shrink-0 w-[56px] focus:outline-none group"
      aria-pressed={active}
    >
      <span
        className={[
          'relative w-[50px] h-[50px] rounded-full overflow-hidden flex items-center justify-center transition-all duration-200',
          active
            ? 'ring-2 ring-gold-400 ring-offset-2 ring-offset-noir-900 scale-105 shadow-[0_0_16px_rgba(var(--accent-rgb),0.45)]'
            : ring === 'gold'
              ? 'ring-1 ring-gold-700/30 opacity-85 group-hover:opacity-100 group-active:scale-95'
              : 'ring-1 ring-white/10 opacity-80 group-hover:opacity-100',
        ].join(' ')}
      >
        {children}
      </span>
      <span
        className={[
          'font-label text-[7.5px] uppercase tracking-wide leading-none text-center max-w-[56px] truncate',
          active ? 'text-gold-300' : 'text-champagne/45',
        ].join(' ')}
      >
        {label}
      </span>
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-label uppercase tracking-luxe text-[7px] text-gold-400/55 pl-0.5 leading-none whitespace-nowrap">
      {children}
    </span>
  );
}

function Divider() {
  return <span className="w-px self-stretch mx-0.5 my-1 bg-gold-700/25 shrink-0" />;
}

function FrameThumb({ exp }: { exp: Experience }) {
  const src = exp.thumbnail_url ?? exp.asset_url;
  return (
    <span className="w-full h-full flex items-center justify-center" style={{ background: 'radial-gradient(circle at 50% 40%, #2a1f0f, #110b05)' }}>
      {src ? (
        <img src={src} alt={exp.name} className={exp.thumbnail_url ? 'w-full h-full object-cover' : 'w-full h-full object-contain p-0.5'} />
      ) : (
        <span className="text-gold-400/60 text-base">▣</span>
      )}
    </span>
  );
}

function PieceThumb({ exp }: { exp: Experience }) {
  return (
    <span className="w-full h-full flex items-center justify-center" style={{ background: 'radial-gradient(circle at 50% 35%, #1e1609, #0c0904)' }}>
      {exp.thumbnail_url ? (
        <img src={exp.thumbnail_url} alt={exp.name} className="w-full h-full object-cover" />
      ) : (
        <Crown className="w-5 h-5 text-gold-400/80" />
      )}
    </span>
  );
}

export default function FilterOrbs({
  catalog, effectId, sparkles, frameId, attachmentId,
  onSelectEffect, onToggleSparkles, onSelectFrame, onSelectAttachment,
}: Props) {
  // Effects come from the catalog (shader experiences) so hidden/reordered
  // presets are respected — same as frames and 3D.
  const effects = catalog.filter((e) => e.kind === 'shader');
  const frames = catalog.filter((e) => e.kind === 'border' || e.kind === '2d_filter');
  const attachments = catalog.filter((e) => e.kind === '3d_attachment');

  const anyActive = effectId !== 'none' || sparkles || frameId || attachmentId;

  const activeEffectCatId = effectId === 'none'
    ? null
    : (effects.find((e) => e.config?.shader?.shaderId === effectId)?.id ?? null);
  const shownEffects = pick3(effects, activeEffectCatId);
  const shownFrames = pick3(frames, frameId);
  const shown3d = pick3(attachments, attachmentId);

  const clearAll = () => {
    onSelectEffect('none');
    onToggleSparkles(false);
    onSelectFrame(null);
    onSelectAttachment(null);
  };

  return (
    <div className="flex gap-2.5 overflow-x-auto hide-scrollbar px-4 py-1 items-start">
      {/* Quick toggles */}
      <div className="flex flex-col gap-1 shrink-0">
        <GroupLabel>Quick</GroupLabel>
        <div className="flex gap-2.5">
          <Orb active={!anyActive} onClick={clearAll} label="Clear" ring="dim">
            <span className="w-full h-full bg-noir-800 flex items-center justify-center">
              <Ban className="w-5 h-5 text-champagne/40" />
            </span>
          </Orb>
          <Orb active={sparkles} onClick={() => onToggleSparkles(!sparkles)} label="Sparkles">
            <span className="w-full h-full bg-gradient-to-br from-yellow-200/90 to-amber-500/90 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-noir-900/80" />
            </span>
          </Orb>
        </div>
      </div>

      {/* Effects */}
      {effects.length > 0 && (
        <>
          <Divider />
          <div className="flex flex-col gap-1 shrink-0">
            <GroupLabel>Effects</GroupLabel>
            <div className="flex gap-2.5">
              {shownEffects.map((exp) => {
                const sid = exp.config?.shader?.shaderId ?? '';
                return (
                  <Orb
                    key={exp.id}
                    active={effectId === sid}
                    onClick={() => onSelectEffect(effectId === sid ? 'none' : sid)}
                    label={exp.name.split(' ')[0]}
                  >
                    <span className={`w-full h-full bg-gradient-to-br ${EFFECT_GRADIENT[sid] ?? 'from-gold-500 to-gold-700'} flex items-center justify-center`}>
                      <Sparkles className="w-4 h-4 text-noir-900/40" />
                    </span>
                  </Orb>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Frames */}
      {frames.length > 0 && (
        <>
          <Divider />
          <div className="flex flex-col gap-1 shrink-0">
            <GroupLabel>Frames</GroupLabel>
            <div className="flex gap-2.5">
              {shownFrames.map((exp) => (
                <Orb
                  key={exp.id}
                  active={frameId === exp.id}
                  onClick={() => onSelectFrame(frameId === exp.id ? null : exp)}
                  label={exp.name.split(' ')[0]}
                >
                  <FrameThumb exp={exp} />
                </Orb>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 3D pieces */}
      {attachments.length > 0 && (
        <>
          <Divider />
          <div className="flex flex-col gap-1 shrink-0">
            <GroupLabel>3D</GroupLabel>
            <div className="flex gap-2.5">
              {shown3d.map((exp) => (
                <Orb
                  key={exp.id}
                  active={attachmentId === exp.id}
                  onClick={() => onSelectAttachment(attachmentId === exp.id ? null : exp)}
                  label={exp.name.split(' ')[0]}
                >
                  <PieceThumb exp={exp} />
                </Orb>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
