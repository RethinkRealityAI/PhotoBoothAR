/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SceneDirectorPanel — the studio's hero feature. One prompt designs a
 * coordinated "scene": a matching frame, filter look, and 3D head piece. The
 * plan comes from ai-event-designer (mode:'scene', client-normalized + clamped
 * by sceneDirector.ts); the host accepts each piece independently, and only
 * accepting spends credits — the frame via ai-generate-image (1), a generated
 * head piece via ai-generate-3d (10), shader + procedural pieces free.
 *
 * Degrades honestly: when the Gemini key is missing/rejected the panel says so
 * and still lets the host build pieces by hand from the studio.
 */
import { useCallback, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Check, Clapperboard, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import Modal from '../ui/Modal';
import { useEvent } from '../../events/EventContext';
import { FILTER_SHADERS, SHADER_MAP } from '../../lib/shaders';
import { HEAD_PIECES, HEAD_PIECE_MAP } from '../../lib/headPieces';
import { createExperience, updateExperience } from '../../lib/db';
import { generateImage, generate3d, resolveEventUuid, aiErrorMessage, type AiErrorCode } from '../../lib/ai';
import {
  planFromJson,
  pieceCreditCost,
  initialProgress,
  setPieceStatus,
  type ScenePlan,
  type SceneProgress,
  type ScenePieceKey,
  type SceneShaderCatalogEntry,
} from '../../lib/studio/sceneDirector';

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

export default function SceneDirectorPanel({ initialPrompt = '', onClose }: { initialPrompt?: string; onClose: () => void }) {
  const { eventId, eventUuid } = useEvent();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<ScenePlan | null>(null);
  const [progress, setProgress] = useState<SceneProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [pieceError, setPieceError] = useState<Partial<Record<ScenePieceKey, string>>>({});

  const design = useCallback(async () => {
    const brief = prompt.trim();
    if (!brief || phase === 'planning') return;
    setPhase('planning');
    setErrorMsg('');
    setPieceError({});
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
      setProgress(initialProgress(parsed));
      setPhase('plan');
    } catch {
      setErrorMsg(KEY_HELP(undefined));
      setPhase('error');
    }
  }, [prompt, phase]);

  const mark = useCallback((piece: ScenePieceKey, status: Parameters<typeof setPieceStatus>[2]) => {
    setProgress((p) => (p ? setPieceStatus(p, piece, status) : p));
  }, []);

  const fail = useCallback((piece: ScenePieceKey, msg: string) => {
    setPieceError((e) => ({ ...e, [piece]: msg }));
    mark(piece, 'failed');
  }, [mark]);

  const acceptShader = useCallback(async (p: ScenePlan) => {
    if (!p.shader) return;
    mark('shader', 'working');
    const exp = await createExperience(eventId, {
      name: `${p.sceneName} Filter`,
      kind: 'shader',
      config: { shader: p.shader, scene: p.sceneName },
      is_published: true,
      featured: false,
    });
    exp ? mark('shader', 'accepted') : fail('shader', 'Could not save the filter — try again.');
  }, [eventId, mark, fail]);

  const acceptFrame = useCallback(async (p: ScenePlan) => {
    if (!p.frame) return;
    mark('frame', 'working');
    const uuid = await resolveEventUuid(eventId, eventUuid);
    if (!uuid) { fail('frame', aiErrorMessage('event_not_found')); return; }
    const { data, error } = await generateImage(uuid, { prompt: p.frame.prompt, kind: 'border', transparentBackground: false });
    if (error || !data?.experience) { fail('frame', aiErrorMessage((error ?? 'internal') as AiErrorCode)); return; }
    // Best-effort scene tag on the server-saved draft.
    await updateExperience(eventId, data.experience.id, { config: { ...data.experience.config, scene: p.sceneName } });
    mark('frame', 'accepted');
  }, [eventId, eventUuid, mark, fail]);

  const acceptHeadPiece = useCallback(async (p: ScenePlan) => {
    if (!p.headPiece) return;
    mark('headPiece', 'working');
    if (p.headPiece.kind === 'procedural' && p.headPiece.id) {
      const def = HEAD_PIECE_MAP[p.headPiece.id];
      const exp = await createExperience(eventId, {
        name: def.name,
        kind: '3d_attachment',
        config: { anchor: def.config, procedural: def.id, scene: p.sceneName },
        is_published: true,
        featured: true,
      });
      exp ? mark('headPiece', 'accepted') : fail('headPiece', 'Could not save the head piece — try again.');
      return;
    }
    // generate — kick off the async Meshy job (10 credits); it lands in Library.
    const uuid = await resolveEventUuid(eventId, eventUuid);
    if (!uuid) { fail('headPiece', aiErrorMessage('event_not_found')); return; }
    const { data, error } = await generate3d(uuid, { mode: 'text', prompt: p.headPiece.prompt ?? p.sceneName });
    if (error || !data?.job) { fail('headPiece', aiErrorMessage((error ?? 'internal') as AiErrorCode)); return; }
    mark('headPiece', 'accepted');
  }, [eventId, eventUuid, mark, fail]);

  // Synchronous guard: state-based `disabled` updates a tick late, so a fast
  // double-click could otherwise fire two accepts → double credit charge.
  const accepting = useRef<Record<ScenePieceKey, boolean>>({ frame: false, shader: false, headPiece: false });
  const accept = (piece: ScenePieceKey) => {
    if (!plan || accepting.current[piece]) return;
    accepting.current[piece] = true;
    const run = piece === 'shader' ? acceptShader(plan) : piece === 'frame' ? acceptFrame(plan) : acceptHeadPiece(plan);
    run.finally(() => { accepting.current[piece] = false; });
  };

  return (
    <Modal title="AI Scene Director" onClose={onClose} maxWidthClass="max-w-xl">
      <div className="flex flex-col gap-4">
        <p className="font-sans text-[13px] text-brand-muted/70 leading-relaxed -mt-2">
          Describe a look and the director designs a matching <span className="text-brand-fg">frame</span>,{' '}
          <span className="text-brand-fg">filter</span>, and <span className="text-brand-fg">head piece</span> as one scene. Accept each piece — you only spend credits on what you keep.
        </p>

        <div className="flex items-start gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder="e.g. roaring-twenties gatsby gala — art-deco gold, warm glow, a jewelled headband"
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

        {phase === 'error' && (
          <p role="alert" className="rounded-xl bg-amber-500/10 border border-amber-400/25 px-3.5 py-3 font-sans text-[12px] text-amber-200/90 leading-snug">{errorMsg}</p>
        )}

        {phase === 'plan' && plan && progress && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-accent-2" />
              <p className="font-serif italic text-[15px] text-brand-fg">{plan.sceneName}</p>
            </div>

            {plan.frame && (
              <PieceCard
                title="Signature frame"
                detail={plan.frame.prompt}
                cost={pieceCreditCost(plan, 'frame')}
                status={progress.frame}
                error={pieceError.frame}
                onAccept={() => accept('frame')}
                onSkip={() => mark('frame', 'skipped')}
              />
            )}
            {plan.shader && (
              <PieceCard
                title="Filter look"
                detail={SHADER_MAP[plan.shader.shaderId]?.name ?? plan.shader.shaderId}
                cost={pieceCreditCost(plan, 'shader')}
                status={progress.shader}
                error={pieceError.shader}
                onAccept={() => accept('shader')}
                onSkip={() => mark('shader', 'skipped')}
              />
            )}
            {plan.headPiece && (
              <PieceCard
                title="Head piece"
                detail={plan.headPiece.kind === 'procedural' ? (HEAD_PIECE_MAP[plan.headPiece.id ?? '']?.name ?? plan.headPiece.id ?? '') : (plan.headPiece.prompt ?? 'Generated piece')}
                cost={pieceCreditCost(plan, 'headPiece')}
                status={progress.headPiece}
                error={pieceError.headPiece}
                onAccept={() => accept('headPiece')}
                onSkip={() => mark('headPiece', 'skipped')}
              />
            )}

            <p className="font-sans text-[11px] text-brand-muted/50 leading-relaxed mt-1">Accepted pieces are saved to your <span className="text-accent-2">Experiences</span> library, tagged with this scene.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PieceCard({
  title,
  detail,
  cost,
  status,
  error,
  onAccept,
  onSkip,
}: {
  title: string;
  detail: string;
  cost: number;
  status: SceneProgress[ScenePieceKey];
  error?: string;
  onAccept: () => void;
  onSkip: () => void;
}) {
  const done = status === 'accepted';
  const skipped = status === 'skipped';
  const working = status === 'working';
  return (
    <div className={`rounded-xl border px-3.5 py-3 transition-colors ${done ? 'border-emerald-400/30 bg-emerald-500/[0.06]' : skipped ? 'border-white/8 bg-white/[0.02] opacity-60' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-center gap-2">
        <span className="font-label uppercase tracking-widest text-[9px] text-accent-2">{title}</span>
        {cost > 0 && !done && <span className="font-mono text-[9px] text-brand-muted/50">{cost} credit{cost === 1 ? '' : 's'}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {done ? (
            <span className="flex items-center gap-1 text-[10px] font-label uppercase tracking-widest text-emerald-400"><Check className="w-3.5 h-3.5" /> Added</span>
          ) : skipped ? (
            <span className="text-[10px] font-label uppercase tracking-widest text-brand-muted/40">Skipped</span>
          ) : (
            <>
              <button
                onClick={onAccept}
                disabled={working}
                className="flex items-center gap-1 rounded-full bg-foil px-3 py-1.5 font-label uppercase tracking-widest text-[9px] font-bold text-white transition active:scale-95 disabled:opacity-50"
              >
                {working ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                {working ? 'Adding…' : cost > 0 ? `Accept · ${cost}` : 'Accept'}
              </button>
              <button onClick={onSkip} disabled={working} className="flex items-center justify-center w-7 h-7 rounded-full bg-white/[0.04] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-50" title="Skip">
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      <p className="font-sans text-[12px] text-brand-muted/70 leading-snug mt-1.5 line-clamp-2">{detail}</p>
      {error && <p className="font-sans text-[11px] text-rose-400 mt-1">{error}</p>}
    </div>
  );
}
