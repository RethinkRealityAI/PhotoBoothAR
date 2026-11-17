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
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Move, RefreshCw, Sparkles, Wand2 } from 'lucide-react';
import {
  generateImage,
  aiErrorMessage,
  countFreeFramesLeft,
  frameAllowance,
  FREE_FRAMES_USED_COPY,
  type AiErrorCode,
} from '../../lib/ai';
import { useEntitlements } from '../../lib/entitlements';
import { frameBriefGaps, gapSummary } from '../../lib/assetBrief';
import { inferFrameLayout } from '../../lib/assetPrompt';
import { processGeneratedFrame } from '../../lib/studio/frameProcessing';
import { aiFrameName } from '../../lib/studio/frameText';
import { rekeyOptions } from '../../lib/studio/frameQuality';
import { setOpeningLook } from '../../lib/host';
import { openingLookErrorCopy } from '../../lib/openingLook';
import GuidedFrameMaker from '../../components/studio/GuidedFrameMaker';
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
  | { kind: 'error'; message: string; code?: AiErrorCode }
  // Chroma-key processing missed on an already-generated (and already-charged)
  // raw green asset — retry reprocessing it for free, never regenerate.
  | { kind: 'keyfail'; message: string };

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-[13px] text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60';

export default function FrameStudio({
  eventUuid,
  suggestion,
  onApplied,
}: {
  eventUuid: string;
  /** Concierge-derived starting prompt (template + event context). */
  suggestion: string;
  /** The frame is published and opens first — lets the host Library re-read. */
  onApplied?: () => void;
}) {
  const [prompt, setPrompt] = useState(suggestion);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [tf, setTf] = useState<FrameTransform>(IDENTITY);
  // A generated (and already-charged) raw green asset whose chroma-key missed —
  // held with its resolved slug so a retry reprocesses it for FREE, never
  // re-calling generateImage (frameProcessing: reprocessing a saved raw
  // experience costs no credits — mirrors AiFramePanel.pendingRaw).
  const [rawFrame, setRawFrame] = useState<{ experience: Experience; slug: string } | null>(null);
  // The identical key reproduces the identical miss — the one useful free
  // retry is a looser key, once (frameQuality.rekeyOptions).
  const [rekeys, setRekeys] = useState(0);
  // Guided "pick a look" first; the free-text box is one tap away.
  const [mode, setMode] = useState<'guided' | 'describe'>('guided');
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  // Live read of what the brief is still missing (colour / style / any brief at
  // all). Cheap enough to compute per keystroke — two regexes on ≤500 chars.
  const briefHint = gapSummary(frameBriefGaps(prompt));
  // The SAME allowance GuidedFrameMaker shows: without aiStudio, once the
  // event's free frames are used the server answers upgrade_required, so the
  // header, the describe box and the Generate button all follow that state.
  const { aiStudio } = useEntitlements();
  const [freeLeft, setFreeLeft] = useState<number | null>(null);
  const [freeCheck, setFreeCheck] = useState(0);
  useEffect(() => {
    let alive = true;
    void countFreeFramesLeft(eventUuid).then((n) => { if (alive) setFreeLeft(n); });
    return () => { alive = false; };
  }, [eventUuid, freeCheck]);
  const allowance = frameAllowance(freeLeft, aiStudio);
  const outOfFree = allowance === 'upgrade';
  const headerNote =
    allowance === 'free' ? `${freeLeft} free left`
      : allowance === 'trial' ? 'first 3 on us'
        : allowance === 'paid' ? 'uses credits'
          : 'free frames used';

  const generate = async () => {
    const brief = prompt.trim();
    if (!brief || phase.kind === 'generating') return;
    setTf(IDENTITY);
    setRawFrame(null);
    setRekeys(0);
    setPhase({ kind: 'generating' });
    // experiences.event_id is the event SLUG (key trap), and this component
    // only receives the uuid — resolve the slug UP FRONT, before spending a
    // credit, so a slug-lookup miss fails with no charge (and never lands the
    // host on a retry that regenerates).
    const { supabase } = await import('../../lib/supabase');
    const { data: ev } = await supabase.from('events').select('slug').eq('id', eventUuid).maybeSingle();
    const slug = typeof ev?.slug === 'string' ? ev.slug : '';
    if (!slug) {
      setPhase({
        kind: 'error',
        message: 'Couldn’t load this event to save the frame — try again in a moment.',
      });
      return;
    }
    const res = await generateImage(eventUuid, {
      prompt: brief,
      kind: 'border',
      // The image models don't produce clean real transparency — request a
      // solid green backdrop and chroma-key it out client-side, the exact
      // pipeline the studio surfaces use (AiFramePanel / DirectorPanel /
      // CopilotChat via processGeneratedFrame).
      transparentBackground: false,
      greenScreen: true,
      // No archetype picker on the create-event success screen — the brief
      // itself chooses, and a brief that describes nothing special stays on
      // 'classic-border', exactly what this screen generated before.
      layout: inferFrameLayout(brief),
    });
    setFreeCheck((n) => n + 1);
    if (res.error !== null || !res.data) {
      const code = (res.error ?? 'internal') as AiErrorCode;
      setPhase({ kind: 'error', message: aiErrorMessage(code), code });
      return;
    }
    // keyed:false means the asset is still the RAW GREEN image — never show or
    // ship it (a solid green box over the guest is worse than an error). The
    // raw row is persisted server-side, so hold it for a no-credit reprocess.
    const raw = res.data.experience;
    // A described frame is named "Custom frame", not after the raw prompt.
    const keyed = await processGeneratedFrame(raw, slug, {}, { layout: inferFrameLayout(brief), name: aiFrameName(null) });
    if (!keyed?.keyed) {
      setRawFrame({ experience: raw, slug });
      setPhase({
        kind: 'keyfail',
        message: 'Generated, but the transparent cutout didn’t come through cleanly — retry the cutout below (no extra credit).',
      });
      return;
    }
    setRawFrame(null);
    setPhase({ kind: 'preview', experience: keyed.experience });
  };

  // Free retry: re-run the chroma-key on the already-saved raw generation —
  // no generateImage, so no second credit.
  const retryProcessing = async () => {
    const keyOpts = rekeyOptions(rekeys);
    if (!rawFrame || phase.kind === 'generating' || !keyOpts) return;
    setPhase({ kind: 'generating' });
    setRekeys((n) => n + 1);
    const keyed = await processGeneratedFrame(rawFrame.experience, rawFrame.slug, {}, { keyOpts });
    if (!keyed?.keyed) {
      setRawFrame(null);
      setPhase({
        kind: 'keyfail',
        message: 'The transparent cutout still didn’t come through — try a fresh frame, or describe it a little differently.',
      });
      return;
    }
    setRawFrame(null);
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
    if (pubErr) {
      setPhase({
        kind: 'error',
        message: 'The frame was made but couldn’t be switched on — find it under Your own and switch it on there.',
      });
      return;
    }
    // The one opening-look writer needs the slug too (the wall store is keyed
    // by it) — a config-only pin was overruled by a wall value the copilot set.
    const { data: ev } = await supabase.from('events').select('slug').eq('id', eventUuid).maybeSingle();
    const slug = typeof ev?.slug === 'string' ? ev.slug : '';
    const pinned = slug !== ''
      ? await setOpeningLook({ slug, eventUuid }, experience.id)
      : { ok: false, failed: 'config' as const };
    if (!pinned.ok) {
      setPhase({
        kind: 'error',
        message: `Your frame is on for guests. ${openingLookErrorCopy(pinned.failed)}`,
      });
      onApplied?.();
      return;
    }
    setPhase({ kind: 'done' });
    onApplied?.();
  };

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col gap-3 text-left">
      <div className="flex items-center gap-2">
        <Wand2 className="w-4 h-4 text-[color:var(--color-accent)]" />
        <p className="font-label uppercase tracking-luxe text-[11px] text-brand-fg">Design your signature frame</p>
        <span className="ml-auto font-sans text-[11px] text-brand-muted/50">{headerNote}</span>
      </div>

      {phase.kind === 'done' ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-400/25 px-3.5 py-3">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="font-sans text-[12px] text-emerald-200/90 leading-snug">
            Your frame is on for guests and the booth opens with it. It’s under Your own below —
            switch it off there any time.
          </p>
        </div>
      ) : mode === 'guided' ? (
        <>
          <GuidedFrameMaker
            eventUuid={eventUuid}
            eventSlug={null}
            freeTrial={!aiStudio}
            onUse={useAsFrame}
            useLabel="Use as booth frame"
            onDescribeYourself={() => setMode('describe')}
            // The header's "N free left" is THIS component's count; a guided
            // generation spent a free slot it never re-counted.
            onSpent={() => setFreeCheck((n) => n + 1)}
          />
          {phase.kind === 'error' && (
            <p role="alert" className="font-sans text-[12px] text-red-400 leading-snug">{phase.message}</p>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setMode('guided')}
            className="self-start min-h-[44px] rounded-full border border-white/15 bg-white/[0.04] px-4 font-sans text-[12px] text-brand-fg hover:bg-white/[0.08]"
          >
            ← Back to looks
          </button>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            maxLength={500}
            className={`${inputClass} resize-none`}
            placeholder="e.g. art-deco gold border with subtle basketball motifs in the corners"
          />

          {/* What the brief still doesn't say. A frame generated from "gold" is
              a generic gold frame, and the host paid for it — naming the gap
              before they press the button is far kinder than after. Advisory
              here: the button stays live, because a host who means it should
              not have to argue with us. */}
          {phase.kind !== 'generating' && briefHint && (
            <p className="font-sans text-[11px] text-brand-muted/60 leading-snug">{briefHint}</p>
          )}

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
                  <span className="font-label uppercase tracking-luxe text-[11px] text-brand-muted/60 shrink-0">Size</span>
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
                    className="flex items-center gap-1.5 rounded-full bg-foil px-4 py-2 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.97] disabled:opacity-50"
                  >
                    {phase.kind === 'applying'
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Activating…</>
                      : <><Check className="w-3.5 h-3.5" /> Use as booth frame</>}
                  </button>
                  {!outOfFree && <button
                    onClick={generate}
                    disabled={phase.kind === 'applying'}
                    className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 font-label uppercase tracking-luxe text-[11px] text-brand-fg transition hover:bg-white/[0.08] disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                  </button>}
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

          {phase.kind === 'keyfail' && (
            <div className="flex flex-col gap-2">
              <p role="alert" className="font-sans text-[12px] text-red-400 leading-snug">{phase.message}</p>
              {rawFrame && rekeyOptions(rekeys) !== null && <button
                onClick={retryProcessing}
                className="self-start flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 font-label uppercase tracking-luxe text-[11px] text-brand-fg transition hover:bg-white/[0.08]"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Clean it up — no extra credits
              </button>}
            </div>
          )}

          {outOfFree && phase.kind !== 'generating' && (
            <p className="font-sans text-[12px] text-brand-fg leading-snug">
              {FREE_FRAMES_USED_COPY}{' '}
              <Link to="/host/billing" className="inline-flex min-h-[44px] items-center align-middle text-accent-2 underline">See upgrade options</Link>
            </p>
          )}
          {!outOfFree && (phase.kind === 'idle' || phase.kind === 'generating' || phase.kind === 'error') && (
            <button
              onClick={generate}
              disabled={phase.kind === 'generating' || !prompt.trim()}
              className="flex items-center justify-center gap-2 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] glow-accent transition active:scale-[0.98] disabled:opacity-50"
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
