/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DirectorPanel — the studio persona of the platform's assistant, DOCKED to the
 * right of the stage (a lg+ column between the stage and the Properties dock; a
 * right slide-in drawer below lg). Replaces the old SceneDirectorPanel modal.
 *
 * One prompt designs a coordinated scene (frame + filter + head piece) via
 * ai-event-designer mode:'scene' (client-normalized + clamped by
 * sceneDirector.ts). Each piece is a composer card; approving a card dispatches
 * the asset STRAIGHT INTO THE OPEN DRAFT (SELECT_SHADER / SET_OVERLAY_UPLOAD /
 * SELECT_HEAD_PIECE / SET_MODEL_ASSET), so the host watches the scene assemble
 * in the canvas and Scene Layers. Credits are spent only on generation:
 * the frame via ai-generate-image (1), a generated head piece via a concept
 * image (1) + ai-generate-3d (10); shader + built-in pieces are free.
 *
 * Degrades honestly: when the Gemini key is missing/rejected the panel says so
 * and the host can still build every piece by hand from the studio docks.
 *
 * Retry safety (ported from the modal): a generated-but-unkeyed frame reprocesses
 * for free (rawFrameRef), and a saved concept image is reused rather than
 * regenerated (conceptUrlRef) so a failed later leg never re-charges an earlier one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Clapperboard, Loader2, X } from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import { FILTER_SHADERS, SHADER_MAP } from '../../lib/shaders';
import { HEAD_PIECES, HEAD_PIECE_MAP } from '../../lib/headPieces';
import {
  generateImage,
  generate3d,
  pollJob,
  resolveEventUuid,
  aiErrorMessage,
  type AiErrorCode,
} from '../../lib/ai';
import type { Experience } from '../../types';
import type { StudioAction } from '../../lib/studio/state';
import {
  planFromJson,
  FRAME_CREDIT_COST,
  GENERATE_3D_CREDIT_COST,
  type ScenePlan,
  type ScenePieceKey,
  type SceneShaderCatalogEntry,
} from '../../lib/studio/sceneDirector';
import { processGeneratedFrame } from './AiFramePanel';
import {
  SceneHeader,
  FilterCard,
  FrameCard,
  HeadPieceCard,
  MESHY_STATUS_LINES,
  type CardState,
} from './DirectorCards';

// A generated head piece is two spends: a Gemini concept image (1 credit) then
// image→3D (10 credits). sceneDirector.pieceCreditCost reports only the 3D leg,
// so surface the honest total + breakdown here.
const HEAD_PIECE_GENERATE_TOTAL = FRAME_CREDIT_COST + GENERATE_3D_CREDIT_COST;

// Meshy poll cadence — matches admin/creator3d/AiGeneratePanel.
const POLL_MS = 5000;
const MAX_POLLS = 60; // ~5 minutes
const ROTATE_MS = 2500;

type Phase = 'idle' | 'planning' | 'plan' | 'error';

const CATALOG: SceneShaderCatalogEntry[] = FILTER_SHADERS.map((s) => ({
  id: s.id,
  params: s.params.map((p) => ({ key: p.key, min: p.min, max: p.max, default: p.default })),
}));
const HEAD_PIECE_IDS = HEAD_PIECES.map((p) => p.id);

function KEY_HELP(code: string | undefined): string {
  if (code === 'ai_key_invalid') return 'The AI key was rejected by Google — a platform admin needs to set a valid GEMINI_API_KEY. You can still build each piece by hand in the studio.';
  if (code === 'ai_not_configured') return 'AI is not configured yet — a platform admin needs to add a GEMINI_API_KEY. Build pieces by hand in the meantime.';
  if (code === 'rate_limited') return 'Too many AI requests this hour — try again shortly.';
  return 'The scene could not be designed right now — try again, or build each piece by hand.';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const IDLE_CARDS: Record<ScenePieceKey, CardState> = {
  frame: { status: 'idle' },
  shader: { status: 'idle' },
  headPiece: { status: 'idle' },
};

export default function DirectorPanel({
  dispatch,
  initialPrompt = '',
  onClose,
}: {
  dispatch: React.Dispatch<StudioAction>;
  initialPrompt?: string;
  onClose: () => void;
}) {
  const { eventId, eventUuid } = useEvent();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<ScenePlan | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cards, setCards] = useState<Record<ScenePieceKey, CardState>>(IDLE_CARDS);

  // Latest cards for async orchestration (Add-all reads current state without
  // stale closures).
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  // Retry caches — a failed LATER leg must never re-charge an EARLIER leg (audit:
  // retries bled 1cr each). The generated-but-unkeyed frame reprocesses for free;
  // a saved concept image is reused instead of regenerated.
  const rawFrameRef = useRef<Experience | null>(null);
  const conceptUrlRef = useRef<string | null>(null);
  // Synchronous double-fire guard per action (state `disabled` lags a tick).
  const running = useRef<Record<string, boolean>>({});
  // Alive flag so an in-flight Meshy poll never setState after unmount.
  const aliveRef = useRef(true);
  const rotateTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const setCard = useCallback((piece: ScenePieceKey, patch: Partial<CardState>) => {
    setCards((c) => ({ ...c, [piece]: { ...c[piece], ...patch } }));
  }, []);

  const stopRotation = useCallback(() => {
    if (rotateTimer.current) { clearInterval(rotateTimer.current); rotateTimer.current = null; }
  }, []);

  useEffect(() => () => { aliveRef.current = false; stopRotation(); }, [stopRotation]);

  const guard = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    if (running.current[key]) return;
    running.current[key] = true;
    try { await fn(); } finally { running.current[key] = false; }
  }, []);

  /* ── Plan fetch (single-shot; a new Design replaces the pending plan) ────── */
  const design = useCallback(async () => {
    const brief = prompt.trim();
    if (!brief || phase === 'planning') return;
    setPhase('planning');
    setErrorMsg('');
    setPlan(null);
    setCards(IDLE_CARDS);
    rawFrameRef.current = null;
    conceptUrlRef.current = null;
    stopRotation();
    try {
      const { supabase } = await import('../../lib/supabase');
      const { data, error } = await supabase.functions.invoke('ai-event-designer', {
        body: { mode: 'scene', messages: [{ role: 'user', content: brief }], shaderCatalog: CATALOG, headPieceIds: HEAD_PIECE_IDS },
      });
      if (error) {
        let code: string | undefined;
        if (error instanceof FunctionsHttpError) {
          try { code = ((await error.context.json()) as { error?: string }).error; } catch { /* unreadable */ }
        }
        setErrorMsg(KEY_HELP(code));
        setPhase('error');
        return;
      }
      const parsed = planFromJson((data as { planJson?: string })?.planJson, CATALOG, HEAD_PIECE_IDS);
      if (!parsed) {
        setErrorMsg('The director could not shape a usable scene from that — try describing the vibe, colours, or occasion.');
        setPhase('error');
        return;
      }
      setPlan(parsed);
      setCards(IDLE_CARDS);
      setPhase('plan');
    } catch {
      setErrorMsg(KEY_HELP(undefined));
      setPhase('error');
    }
  }, [prompt, phase, stopRotation]);

  /* ── FILTER: free, instant → dispatch into the draft ────────────────────── */
  const approveFilter = useCallback(() => {
    if (!plan?.shader) return;
    dispatch({ type: 'SELECT_SHADER', shaderId: plan.shader.shaderId, params: plan.shader.params });
    setCard('shader', { status: 'added' });
  }, [plan, dispatch, setCard]);

  /* ── FRAME: generate (1cr) → transparent preview → approve into draft ───── */
  // Returns the processed transparent PNG url on success (for Add-all), else null.
  const generateFrame = useCallback(async (): Promise<string | null> => {
    if (!plan?.frame) return null;
    setCard('frame', { status: 'generating', error: undefined });
    let raw = rawFrameRef.current;
    if (!raw) {
      const uuid = await resolveEventUuid(eventId, eventUuid);
      if (!uuid) { setCard('frame', { status: 'failed', error: aiErrorMessage('event_not_found') }); return null; }
      const { data, error } = await generateImage(uuid, { prompt: plan.frame.prompt, kind: 'border', transparentBackground: false, greenScreen: true });
      if (error || !data?.experience) { setCard('frame', { status: 'failed', error: aiErrorMessage((error ?? 'internal') as AiErrorCode) }); return null; }
      raw = data.experience;
      rawFrameRef.current = raw;
    }
    // Chroma-key the green backdrop out. An unkeyed result is still the raw GREEN
    // image — never ship it: keep it cached and let Retry reprocess for free.
    const { experience: processed, keyed } = await processGeneratedFrame(raw, eventId, { scene: plan.sceneName });
    if (!keyed) {
      setCard('frame', { status: 'failed', error: 'Generated, but transparency processing failed — Retry (no new credits).' });
      return null;
    }
    rawFrameRef.current = null;
    const url = processed.asset_url ?? undefined;
    setCard('frame', { status: 'ready', frameUrl: url, error: undefined });
    return url ?? null;
  }, [plan, eventId, eventUuid, setCard]);

  const approveFrame = useCallback((url?: string) => {
    const target = url ?? cardsRef.current.frame.frameUrl;
    if (!target) return;
    // The one-frame rule swaps any existing frame in place.
    dispatch({ type: 'SET_OVERLAY_UPLOAD', url: target, blob: null, overlayKind: 'border' });
    setCard('frame', { status: 'added' });
  }, [dispatch, setCard]);

  /* ── HEAD PIECE ─────────────────────────────────────────────────────────── */
  const approveProceduralPiece = useCallback(() => {
    if (plan?.headPiece?.kind !== 'procedural' || !plan.headPiece.id) return;
    dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: plan.headPiece.id });
    setCard('headPiece', { status: 'added' });
  }, [plan, dispatch, setCard]);

  // Imperative Meshy poll — drives the progress bar; resolves with the GLB.
  const pollModel = useCallback(async (jobId: string): Promise<{ glbUrl: string; name: string | null } | { error: string }> => {
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      if (!aliveRef.current) return { error: 'cancelled' };
      const { data } = await pollJob(jobId);
      if (!aliveRef.current) return { error: 'cancelled' };
      if (data?.job) {
        if (data.job.status === 'succeeded') {
          const url = data.experience?.asset_url;
          if (!url) return { error: 'Generated, but no model file came back — Retry.' };
          return { glbUrl: url, name: data.experience?.name ?? null };
        }
        if (data.job.status === 'failed' || data.job.status === 'refunded') {
          return { error: data.job.error ? `Generation failed — credits refunded. (${data.job.error})` : 'Generation failed — credits refunded.' };
        }
        if (typeof data.progress === 'number') setCard('headPiece', { progress: data.progress });
      }
    }
    return { error: 'Still working — the finished model will land in your Library shortly.' };
  }, [setCard]);

  // Generate (concept image 1cr → image→3D 10cr → poll). Returns the GLB or null.
  const generatePiece = useCallback(async (): Promise<{ glbUrl: string; name: string | null } | null> => {
    if (plan?.headPiece?.kind !== 'generate') return null;
    const brief = plan.headPiece.prompt ?? plan.sceneName;
    setCard('headPiece', { status: 'generating', error: undefined, progress: null, statusLine: MESHY_STATUS_LINES[0] });
    // Rotate the status verbs while the job runs (cycle; never exceed real state).
    stopRotation();
    let ri = 0;
    rotateTimer.current = setInterval(() => {
      ri = (ri + 1) % MESHY_STATUS_LINES.length;
      setCard('headPiece', { statusLine: MESHY_STATUS_LINES[ri] });
    }, ROTATE_MS);

    try {
      const uuid = await resolveEventUuid(eventId, eventUuid);
      if (!uuid) { setCard('headPiece', { status: 'failed', error: aiErrorMessage('event_not_found') }); return null; }

      // Reuse a concept saved by a previous attempt — a failed 3D leg must not
      // regenerate (and re-charge) the image leg on every retry.
      let conceptUrl = conceptUrlRef.current;
      if (!conceptUrl) {
        // No greenScreen: image→3D wants the object on a plain background.
        const concept = await generateImage(uuid, {
          prompt: `${brief} — a single centered object, isolated on a plain neutral studio background, product shot, no frame, no border, no text`,
          kind: '2d_filter',
        });
        if (concept.error || !concept.data?.experience?.asset_url) {
          setCard('headPiece', { status: 'failed', error: aiErrorMessage((concept.error ?? 'internal') as AiErrorCode) });
          return null;
        }
        conceptUrl = concept.data.experience.asset_url;
        conceptUrlRef.current = conceptUrl;
      }

      const { data, error } = await generate3d(uuid, { mode: 'image', imageUrl: conceptUrl, prompt: brief });
      if (error || !data?.job) {
        setCard('headPiece', { status: 'failed', error: `${aiErrorMessage((error ?? 'internal') as AiErrorCode)} (the concept image is saved — Retry does the 3D step only.)` });
        return null;
      }
      conceptUrlRef.current = null; // 3D leg accepted the concept; don't reuse it

      const result = await pollModel(data.job.id);
      if ('error' in result) {
        if (result.error === 'cancelled') return null;
        setCard('headPiece', { status: 'failed', error: result.error });
        return null;
      }
      setCard('headPiece', { status: 'ready', glbUrl: result.glbUrl, glbName: result.name, progress: 100, error: undefined });
      return result;
    } finally {
      stopRotation();
    }
  }, [plan, eventId, eventUuid, setCard, stopRotation, pollModel]);

  const approvePiece = useCallback((artifact?: { glbUrl: string; name: string | null }) => {
    const glbUrl = artifact?.glbUrl ?? cardsRef.current.headPiece.glbUrl;
    if (!glbUrl) return;
    const name = artifact?.name ?? cardsRef.current.headPiece.glbName ?? plan?.headPiece?.prompt ?? plan?.sceneName ?? 'Head Piece';
    dispatch({ type: 'SET_MODEL_ASSET', url: glbUrl, name });
    setCard('headPiece', { status: 'added' });
  }, [plan, dispatch, setCard]);

  const rejectPiece = useCallback(() => setCard('headPiece', { status: 'discarded' }), [setCard]);

  /* ── Add all — run every unfinished piece sequentially, adding on success ── */
  const anyGenerating = cards.frame.status === 'generating' || cards.headPiece.status === 'generating';

  const addAll = useCallback(() => guard('addAll', async () => {
    const p = plan;
    if (!p) return;
    const c = () => cardsRef.current;

    if (p.shader && c().shader.status !== 'added') approveFilter();

    if (p.frame && c().frame.status !== 'added') {
      let url: string | null = c().frame.frameUrl ?? null;
      if (c().frame.status !== 'ready') url = await generateFrame();
      if (url) approveFrame(url);
    }

    if (p.headPiece && c().headPiece.status !== 'added' && c().headPiece.status !== 'discarded') {
      if (p.headPiece.kind === 'procedural') {
        approveProceduralPiece();
      } else {
        let artifact: { glbUrl: string; name: string | null } | null =
          c().headPiece.glbUrl ? { glbUrl: c().headPiece.glbUrl, name: c().headPiece.glbName ?? null } : null;
        if (c().headPiece.status !== 'ready') artifact = await generatePiece();
        if (artifact) approvePiece(artifact);
      }
    }
  }), [guard, plan, approveFilter, generateFrame, approveFrame, approveProceduralPiece, generatePiece, approvePiece]);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  const headKind = plan?.headPiece?.kind;
  const headLabel = plan?.headPiece
    ? plan.headPiece.kind === 'procedural'
      ? (HEAD_PIECE_MAP[plan.headPiece.id ?? '']?.name ?? plan.headPiece.id ?? '')
      : (plan.headPiece.prompt ?? 'Generated piece')
    : '';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/10 bg-brand-bg/60 lg:bg-transparent">
        <Clapperboard className="w-4 h-4 text-accent-2 shrink-0" />
        <div className="min-w-0">
          <p className="font-serif italic text-sm text-brand-fg leading-tight">Director</p>
          <p className="font-label text-[8px] uppercase tracking-widest text-brand-muted/50">Studio assistant</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close Director"
          className="ml-auto p-1.5 rounded-lg text-brand-muted/60 hover:text-brand-fg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Conversation column */}
      <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar px-4 py-4 flex flex-col gap-3">
        {phase !== 'plan' && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3.5">
            <p className="font-sans text-[13px] text-brand-fg/90 leading-relaxed">
              Describe a look and I'll design a matching{' '}
              <span className="text-accent-2">frame</span>,{' '}
              <span className="text-accent-2">filter</span>, and{' '}
              <span className="text-accent-2">head piece</span> as one scene.
            </p>
            <p className="font-sans text-[11px] text-brand-muted/55 leading-relaxed mt-2">
              Approved pieces land in your scene — press Save when it's yours. You only spend credits on what you generate.
            </p>
          </div>
        )}

        {phase === 'error' && (
          <p role="alert" className="rounded-xl bg-amber-500/10 border border-amber-400/25 px-3.5 py-3 font-sans text-[12px] text-amber-200/90 leading-snug">{errorMsg}</p>
        )}

        {phase === 'plan' && plan && (
          <>
            <SceneHeader
              sceneName={plan.sceneName}
              onAddAll={addAll}
              addAllDisabled={anyGenerating}
            />

            {plan.frame && (
              <FrameCard
                prompt={plan.frame.prompt}
                cost={FRAME_CREDIT_COST}
                state={cards.frame}
                onGenerate={() => guard('frame', generateFrame)}
                onApprove={() => approveFrame()}
                onReject={() => setCard('frame', { status: 'discarded' })}
              />
            )}

            {plan.shader && (
              <FilterCard
                name={SHADER_MAP[plan.shader.shaderId]?.name ?? plan.shader.shaderId}
                description={SHADER_MAP[plan.shader.shaderId]?.description ?? 'A coordinated booth filter.'}
                state={cards.shader}
                onApprove={approveFilter}
              />
            )}

            {plan.headPiece && headKind && (
              <HeadPieceCard
                mode={headKind}
                label={headLabel}
                cost={headKind === 'generate' ? HEAD_PIECE_GENERATE_TOTAL : 0}
                note={headKind === 'generate' ? `Concept image (${FRAME_CREDIT_COST} credit, or one of your free generations) → 3D model (${GENERATE_3D_CREDIT_COST} credits)` : undefined}
                state={cards.headPiece}
                onApprove={headKind === 'procedural' ? approveProceduralPiece : () => approvePiece()}
                onGenerate={() => guard('headPiece', generatePiece)}
                onReject={rejectPiece}
              />
            )}
          </>
        )}
      </div>

      {/* Prompt box (bottom) */}
      <div className="shrink-0 border-t border-white/10 p-3 bg-brand-bg/60 lg:bg-transparent">
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); design(); } }}
            rows={2}
            maxLength={400}
            placeholder="Describe the scene you want…"
            className="flex-1 rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-[13px] text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/60 resize-none"
          />
          <button
            onClick={design}
            disabled={!prompt.trim() || phase === 'planning'}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-foil px-4 py-2.5 font-label uppercase tracking-widest text-[10px] font-bold text-white glow-accent transition active:scale-[0.97] disabled:opacity-50"
          >
            {phase === 'planning' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clapperboard className="w-3.5 h-3.5" />}
            {phase === 'planning' ? 'Designing…' : 'Design'}
          </button>
        </div>
      </div>
    </div>
  );
}
