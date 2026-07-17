/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FrameStudio — the concierge's finishing move (roadmap "Concierge v3").
 * Rendered on the create-event success screen: describe a signature frame,
 * the AI generates it at the booth's 9:16 capture ratio (server renders
 * 1080×1920 PNG with a clear centre), preview it in place, and one tap
 * publishes it AND sets it as the booth's default experience — so the
 * go-live checklist's "frames" step is EARNED before the host ever sees
 * the dashboard. First 3 generations per event are free on every tier
 * (enforced server-side in ai-generate-image).
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Move, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import { generateImage, aiErrorMessage, type AiErrorCode } from '../../lib/ai';
import { processGeneratedFrame } from '../../lib/studio/frameProcessing';
import { updateEventConfig } from '../../lib/host';
import type { Experience } from '../../types';

/** Matches StageCanvas overlay semantics exactly: x/y are % of the canvas
 *  offset from centre, scale is a multiplier (rotation stays 0 here). */
interface FrameTransform {
  scale: number;
  x: number;
  y: number;
}
const IDENTITY: FrameTransform = { scale: 1, x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Phase =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'preview'; experience: Experience }
  | { kind: 'applying'; experience: Experience }
  | { kind: 'done' }
  | { kind: 'error'; message: string; code?: AiErrorCode };

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-[13px] text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60';

export default function FrameStudio({
  eventUuid,
  suggestion,
}: {
  eventUuid: string;
  /** Concierge-derived starting prompt (template + event context). */
  suggestion: string;
}) {
  const [prompt, setPrompt] = useState(suggestion);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [tf, setTf] = useState<FrameTransform>(IDENTITY);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const generate = async () => {
    const brief = prompt.trim();
    if (!brief || phase.kind === 'generating') return;
    setTf(IDENTITY);
    setPhase({ kind: 'generating' });
    const res = await generateImage(eventUuid, {
      prompt: brief,
      kind: 'border',
      // The image models don't produce clean real transparency — request a
      // solid green backdrop and chroma-key it out client-side, the exact
      // pipeline the studio surfaces use (AiFramePanel / DirectorPanel /
      // CopilotChat via processGeneratedFrame).
      transparentBackground: false,
      greenScreen: true,
    });
    if (res.error !== null || !res.data) {
      const code = (res.error ?? 'internal') as AiErrorCode;
      setPhase({ kind: 'error', message: aiErrorMessage(code), code });
      return;
    }
    // experiences.event_id is the event SLUG (key trap), and this component
    // only receives the uuid — resolve the slug so the processed transparent
    // PNG is persisted onto the experience row, not just previewed.
    const { supabase } = await import('../../lib/supabase');
    const { data: ev } = await supabase.from('events').select('slug').eq('id', eventUuid).maybeSingle();
    const slug = typeof ev?.slug === 'string' ? ev.slug : '';
    // keyed:false means the asset is still the RAW GREEN image — never show or
    // ship it (a solid green box over the guest is worse than an error).
    const keyed = slug ? await processGeneratedFrame(res.data.experience, slug) : null;
    if (!keyed?.keyed) {
      setPhase({
        kind: 'error',
        message: 'Generated, but the transparent cutout didn’t come through cleanly — generate again for a fresh version.',
      });
      return;
    }
    setPhase({ kind: 'preview', experience: keyed.experience });
  };

  const useAsFrame = async (experience: Experience) => {
    setPhase({ kind: 'applying', experience });
    // Publish the (server-created, unpublished) experience with the host's
    // placement baked into config.transform, then pin it as the booth
    // default — both member-RLS writes, same as the studio does.
    const { supabase } = await import('../../lib/supabase');
    const { error: pubErr } = await supabase
      .from('experiences')
      .update({
        is_published: true,
        config: {
          ...((experience.config ?? {}) as Record<string, unknown>),
          transform: { scale: tf.scale, x: tf.x, y: tf.y, rotation: 0 },
        },
      })
      .eq('id', experience.id);
    const pinned = await updateEventConfig(eventUuid, { defaultExperienceId: experience.id });
    if (pubErr || !pinned) {
      setPhase({
        kind: 'error',
        message: 'The frame was generated but could not be activated — publish it from your studio Library.',
      });
      return;
    }
    setPhase({ kind: 'done' });
  };

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3 text-left">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-[color:var(--color-accent)]" />
        <p className="font-label uppercase tracking-luxe text-[10px] text-brand-fg">Design your signature frame</p>
        <span className="ml-auto font-sans text-[10px] text-brand-muted/50">first 3 on us</span>
      </div>

      {phase.kind === 'done' ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-400/25 px-3.5 py-3">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="font-sans text-[12px] text-emerald-200/90 leading-snug">
            Your frame is live and pre-applied in the booth. Fine-tune its placement anytime in
            the studio's 2D creator.
          </p>
        </div>
      ) : (
        <>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            maxLength={500}
            className={`${inputClass} resize-none`}
            placeholder="e.g. art-deco gold border with subtle basketball motifs in the corners"
          />

          {(phase.kind === 'preview' || phase.kind === 'applying') && (
            <div className="flex items-start gap-4">
              <div
                ref={boxRef}
                onPointerDown={(e) => {
                  dragRef.current = { px: e.clientX, py: e.clientY, x: tf.x, y: tf.y };
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  const box = boxRef.current;
                  if (!d || !box) return;
                  // px → % of the box == % of the booth canvas (StageCanvas units).
                  setTf((t) => ({
                    ...t,
                    x: clamp(d.x + ((e.clientX - d.px) / box.clientWidth) * 100, -40, 40),
                    y: clamp(d.y + ((e.clientY - d.py) / box.clientHeight) * 100, -40, 40),
                  }));
                }}
                onPointerUp={() => { dragRef.current = null; }}
                className="w-32 shrink-0 aspect-[9/16] rounded-xl overflow-hidden border border-white/15 bg-brand-bg relative cursor-grab active:cursor-grabbing touch-none select-none"
              >
                {/* Stand-in subject so the frame frames something. */}
                <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_45%,rgba(255,255,255,0.14),transparent_70%)]" />
                {phase.experience.asset_url && (
                  <img
                    src={phase.experience.asset_url}
                    alt="Generated frame"
                    draggable={false}
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    style={{ transform: `translate(${tf.x}%, ${tf.y}%) scale(${tf.scale})` }}
                  />
                )}
              </div>
              <div className="flex-1 flex flex-col gap-2 pt-1">
                <p className="font-sans text-[12px] text-brand-muted/70 leading-relaxed flex items-center gap-1.5">
                  <Move className="w-3.5 h-3.5 shrink-0 text-brand-muted/50" />
                  Drag the frame to reposition it — your placement is saved with it.
                </p>
                <label className="flex items-center gap-2">
                  <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 shrink-0">Size</span>
                  <input
                    type="range"
                    min={0.7}
                    max={1.4}
                    step={0.02}
                    value={tf.scale}
                    onChange={(e) => setTf((t) => ({ ...t, scale: Number(e.target.value) }))}
                    className="flex-1"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => useAsFrame(phase.experience)}
                    disabled={phase.kind === 'applying'}
                    className="flex items-center gap-1.5 rounded-full bg-foil px-4 py-2 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.97] disabled:opacity-50"
                  >
                    {phase.kind === 'applying'
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Activating…</>
                      : <><Check className="w-3.5 h-3.5" /> Use as booth frame</>}
                  </button>
                  <button
                    onClick={generate}
                    disabled={phase.kind === 'applying'}
                    className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition hover:bg-white/[0.08] disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase.kind === 'error' && (
            <p role="alert" className="font-sans text-[12px] text-red-400 leading-snug">
              {phase.message}
              {phase.code === 'insufficient_credits' && (
                <>
                  {' '}
                  <Link to="/host/billing" className="text-accent-2 hover:underline">Top up</Link>
                </>
              )}
            </p>
          )}

          {(phase.kind === 'idle' || phase.kind === 'generating' || phase.kind === 'error') && (
            <button
              onClick={generate}
              disabled={phase.kind === 'generating' || !prompt.trim()}
              className="flex items-center justify-center gap-2 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-50"
            >
              {phase.kind === 'generating'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Designing your frame…</>
                : <><Sparkles className="w-4 h-4" /> Generate frame</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}
