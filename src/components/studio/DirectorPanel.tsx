/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DirectorPanel — the studio persona of the platform's assistant, DOCKED to the
 * right of the stage (a lg+ column between the stage and the Properties dock; a
 * right slide-in drawer below lg).
 *
 * A running chat: the host describes a look (or asks for ideas), and the
 * Director replies — pure-ideation turns are just a reply; scene turns attach a
 * coordinated plan (frame + filter + head piece) as composer cards inline after
 * the reply, via ai-event-designer mode:'scene' (client-normalized + clamped by
 * sceneDirector.ts / parseDirectorTurn).
 *
 * GENERATE-THEN-ADD: "Generate all" runs every generatable piece IN PARALLEL,
 * each DWELLING at a visible 'ready' preview (2D image, interactive 3D viewer)
 * so the host inspects it BEFORE it lands. A sticky "Add N to scene" footer then
 * approves every ready card into the OPEN DRAFT (SELECT_SHADER /
 * SET_OVERLAY_UPLOAD / SELECT_HEAD_PIECE / SET_MODEL_ASSET); per-card
 * Approve/Reject also work. (The old Add-all auto-approved through the only
 * media-bearing state under React 19 batching, so previews were never seen.)
 *
 * REJECT → capture intent → charged regenerate: rejecting a ready asset opens a
 * "what should change" box + a clearly-priced Regenerate (frame 1cr; head piece
 * 11cr — a rejected LOOK redoes the Gemini concept + Meshy). FAILURE retries
 * stay free (rawFrameRef reprocess; a cached concept never re-charges).
 *
 * REFERENCE IMAGE: the composer's paperclip uploads an image (uploadAsset); it
 * guides frame generation (passed to ai-generate-image as referenceImageUrl) and
 * REPLACES the Gemini concept step for a head piece (reference → ai-generate-3d
 * image mode directly, saving the 1cr concept → "Generate · 10").
 *
 * Degrades honestly: when the Gemini key is missing/rejected the Director says
 * so (a bubble) and the host can still build every piece by hand from the docks.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Check, Clapperboard, Loader2, Paperclip, X } from 'lucide-react';
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
import { uploadAsset } from '../../lib/db';
import type { Experience } from '../../types';
import { MAX_OBJECTS, sceneCounts, type StudioAction, type StudioDraft } from '../../lib/studio/state';
import {
  parseDirectorTurn,
  FRAME_CREDIT_COST,
  GENERATE_3D_CREDIT_COST,
  type ScenePlan,
  type ScenePieceKey,
  type SceneShaderCatalogEntry,
} from '../../lib/studio/sceneDirector';
import { processGeneratedFrame } from './AiFramePanel';
import { measureGlbFitScale } from '../../lib/studio/glbThumb';
import {
  SceneHeader,
  FilterCard,
  FrameCard,
  HeadPieceCard,
  MESHY_STATUS_LINES,
  type CardState,
} from './DirectorCards';

// A generated head piece with NO reference is two spends: a Gemini concept
// image (1 credit) then image→3D (10 credits). A reference REPLACES the concept
// (image→3D directly), so it costs only the 10cr 3D leg.
const HEAD_PIECE_GENERATE_TOTAL = FRAME_CREDIT_COST + GENERATE_3D_CREDIT_COST;

// Meshy poll cadence — matches admin/creator3d/AiGeneratePanel.
const POLL_MS = 5000;
const MAX_POLLS = 60; // ~5 minutes
const ROTATE_MS = 2500;

type Phase = 'idle' | 'planning';

/** One line of the Director chat transcript. */
interface ChatBubble {
  id: string;
  role: 'user' | 'director';
  text: string;
  /** director error bubbles render amber and are excluded from the model convo. */
  tone?: 'error';
}

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
  draftRef,
  initialPrompt = '',
  onClose,
}: {
  dispatch: React.Dispatch<StudioAction>;
  /** Always-current draft (StudioShell's ref) — approvals check the object cap
   *  BEFORE claiming success (audit H1: appendObject no-ops silently at cap). */
  draftRef: React.RefObject<StudioDraft | null>;
  initialPrompt?: string;
  onClose: () => void;
}) {
  const { eventId, eventUuid } = useEvent();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<ScenePlan | null>(null);
  const [cards, setCards] = useState<Record<ScenePieceKey, CardState>>(IDLE_CARDS);
  // Chat transcript + the message id the active plan's cards render after.
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [planAnchorId, setPlanAnchorId] = useState<string | null>(null);
  // Host-uploaded reference image (guides frame gen + replaces the head-piece
  // concept step). Lives until removed; read at generation time.
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceUploading, setReferenceUploading] = useState(false);

  // Latest snapshots for async orchestration (reads current state, no stale
  // closures): cards for the parallel generate/add, messages for the convo.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const referenceUrlRef = useRef(referenceUrl);
  referenceUrlRef.current = referenceUrl;

  // Retry caches — a failed LATER leg must never re-charge an EARLIER leg (audit:
  // retries bled 1cr each). The generated-but-unkeyed frame reprocesses for free;
  // a saved concept image is reused instead of regenerated.
  const rawFrameRef = useRef<Experience | null>(null);
  const conceptUrlRef = useRef<string | null>(null);
  // Synchronous approve-once latch (state re-render lags a fast double-click,
  // and SELECT_HEAD_PIECE/SET_MODEL_ASSET would append twice). Reset per plan.
  const approvedRef = useRef<Record<string, boolean>>({});
  // Plan EPOCH — bumped the instant a NEW plan takes effect (send() below, where
  // cards reset). Every async generate/poll/approve continuation captures it at
  // start and BAILS if it changed, so plan A's in-flight Meshy/gen never writes
  // onto plan B's cards, poisons the shared money-safety caches, or approves A's
  // paid asset under B's metadata (audit H1: cross-plan card contamination).
  const planEpochRef = useRef(0);
  // Synchronous double-fire guard per action (state `disabled` lags a tick).
  const running = useRef<Record<string, boolean>>({});
  // Alive flag so an in-flight Meshy poll never setState after unmount.
  const aliveRef = useRef(true);
  const rotateTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setCard = useCallback((piece: ScenePieceKey, patch: Partial<CardState>) => {
    setCards((c) => ({ ...c, [piece]: { ...c[piece], ...patch } }));
  }, []);

  const pushDirector = useCallback((text: string, tone?: 'error') => {
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'director', text, tone }]);
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

  /* ── Send a chat turn — reply-only ideation OR a fresh scene plan ────────── */
  const send = useCallback(() => guard('send', async () => {
    const brief = prompt.trim();
    if (!brief || phase === 'planning') return;
    // Belt (on top of the epoch): don't let a new plan land while a piece is mid
    // generation — finish or discard it first (the control is also disabled).
    const g = cardsRef.current;
    if (g.frame.status === 'generating' || g.headPiece.status === 'generating') return;
    const userId = crypto.randomUUID();
    setMessages((m) => [...m, { id: userId, role: 'user', text: brief }]);
    setPrompt('');
    setPhase('planning');
    try {
      // Multi-turn context (drop error bubbles; cap at the edge fn's 20-turn max).
      const convo = [...messagesRef.current, { id: userId, role: 'user' as const, text: brief, tone: undefined }]
        .filter((b) => b.tone !== 'error')
        .map((b) => ({ role: (b.role === 'director' ? 'assistant' : 'user') as 'assistant' | 'user', content: b.text }))
        .slice(-20);
      const { supabase } = await import('../../lib/supabase');
      const { data, error } = await supabase.functions.invoke('ai-event-designer', {
        body: { mode: 'scene', messages: convo, shaderCatalog: CATALOG, headPieceIds: HEAD_PIECE_IDS },
      });
      if (error) {
        let code: string | undefined;
        if (error instanceof FunctionsHttpError) {
          try { code = ((await error.context.json()) as { error?: string }).error; } catch { /* unreadable */ }
        }
        pushDirector(KEY_HELP(code), 'error');
        return;
      }
      const turn = parseDirectorTurn(data, CATALOG, HEAD_PIECE_IDS);
      if (!turn) { pushDirector(KEY_HELP(undefined), 'error'); return; }
      const dirId = crypto.randomUUID();
      setMessages((m) => [...m, { id: dirId, role: 'director', text: turn.reply || 'Here’s a scene to try.' }]);
      if (turn.plan) {
        // A fresh plan REPLACES the active cards (same reset the old design() did).
        // Bump the epoch FIRST so any in-flight continuation from the prior plan
        // sees the change and bails before touching these freshly-reset cards.
        planEpochRef.current += 1;
        setPlan(turn.plan);
        setCards(IDLE_CARDS);
        rawFrameRef.current = null;
        conceptUrlRef.current = null;
        approvedRef.current = {};
        stopRotation();
        setPlanAnchorId(dirId);
      }
    } catch {
      pushDirector(KEY_HELP(undefined), 'error');
    } finally {
      setPhase('idle');
    }
  }), [guard, prompt, phase, pushDirector, stopRotation]);

  /* ── Reference image upload (paperclip) ─────────────────────────────────── */
  const onReferenceFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    // Gate BEFORE upload: the server silently drops a reference over its size cap
    // (fetchReferenceInline → null) yet the host still pays for the now-unguided
    // generation. Reject non-images and anything over 8 MB (safely under the
    // server's 10 MB) with an honest bubble instead (audit M).
    if (!file.type.startsWith('image/')) {
      pushDirector('That file isn’t an image — attach a JPG, PNG, or WEBP to guide generation.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      pushDirector('That image is over 8 MB — references that large get dropped before they can guide generation. Try a smaller or compressed image.', 'error');
      return;
    }
    setReferenceUploading(true);
    try {
      const url = await uploadAsset(file, 'director-reference');
      if (url) setReferenceUrl(url);
      else pushDirector('That image couldn’t be uploaded — try another.', 'error');
    } catch {
      pushDirector('That image couldn’t be uploaded — try another.', 'error');
    } finally {
      setReferenceUploading(false);
    }
  }, [pushDirector]);

  /* ── FILTER: free, instant → dispatch into the draft ────────────────────── */
  const approveFilter = useCallback(() => {
    if (!plan?.shader) return;
    dispatch({ type: 'SELECT_SHADER', shaderId: plan.shader.shaderId, params: plan.shader.params });
    setCard('shader', { status: 'added' });
  }, [plan, dispatch, setCard]);

  /* ── FRAME: generate (1cr) → transparent preview → approve into draft ───── */
  // Returns the processed transparent PNG url on success, else null.
  const generateFrame = useCallback(async (promptOverride?: string): Promise<string | null> => {
    if (!plan?.frame) return null;
    const epoch = planEpochRef.current;
    const framePrompt = promptOverride ?? plan.frame.prompt;
    setCard('frame', { status: 'generating', error: undefined });
    let raw = rawFrameRef.current;
    if (!raw) {
      const uuid = await resolveEventUuid(eventId, eventUuid);
      if (planEpochRef.current !== epoch) return null;
      if (!uuid) { setCard('frame', { status: 'failed', error: aiErrorMessage('event_not_found') }); return null; }
      const reference = referenceUrlRef.current;
      const { data, error } = await generateImage(uuid, {
        prompt: framePrompt,
        kind: 'border',
        transparentBackground: false,
        greenScreen: true,
        ...(reference ? { referenceImageUrl: reference } : {}),
      });
      // Bail AFTER the charge but BEFORE caching: a stale epoch must not write the
      // raw onto the shared cache (the next plan's generate reads it un-scoped and
      // would reuse A's paid image for free). A is abandoned; its credit is spent.
      if (planEpochRef.current !== epoch) return null;
      if (error || !data?.experience) { setCard('frame', { status: 'failed', error: aiErrorMessage((error ?? 'internal') as AiErrorCode) }); return null; }
      raw = data.experience;
      rawFrameRef.current = raw;
    }
    // Chroma-key the green backdrop out. An unkeyed result is still the raw GREEN
    // image — never ship it: keep it cached and let Retry reprocess for free.
    const { experience: processed, keyed } = await processGeneratedFrame(raw, eventId, { scene: plan.sceneName });
    if (planEpochRef.current !== epoch) return null;
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

  // A broken preview <img> (CORS/transient) at 'ready' → surface it as a failure
  // with Retry rather than a silent blank swatch. (Only from 'ready' — an added
  // frame's asset already lives in the scene; a preview glitch never unwinds it.)
  const onFrameImageError = useCallback(() => {
    if (cardsRef.current.frame.status === 'ready') {
      setCard('frame', { status: 'failed', error: 'The preview image failed to load — Retry to regenerate.' });
    }
  }, [setCard]);

  /* ── HEAD PIECE ─────────────────────────────────────────────────────────── */
  // Approvals append into the draft — but appendObject silently no-ops at the
  // MAX_OBJECTS cap, so check FIRST and refuse honestly instead of showing a
  // false "Added" on a full scene. (Frame approvals are exempt: placeFrame
  // always swaps the single frame.)
  const sceneFull = useCallback((): boolean => {
    const d = draftRef.current;
    return !!d && sceneCounts(d).capped >= MAX_OBJECTS;
  }, [draftRef]);

  const approveProceduralPiece = useCallback(() => {
    if (plan?.headPiece?.kind !== 'procedural' || !plan.headPiece.id) return;
    if (approvedRef.current.headPiece) return;
    if (sceneFull()) {
      setCard('headPiece', { error: 'Scene is full (20 pieces) — remove something in Scene Layers first.' });
      return;
    }
    approvedRef.current.headPiece = true;
    dispatch({ type: 'SELECT_HEAD_PIECE', pieceId: plan.headPiece.id });
    setCard('headPiece', { status: 'added', error: undefined });
  }, [plan, dispatch, setCard, sceneFull]);

  // Imperative Meshy poll — drives the progress bar; resolves with the GLB.
  const pollModel = useCallback(async (jobId: string): Promise<{ glbUrl: string; name: string | null } | { error: string } | { timeout: true }> => {
    const epoch = planEpochRef.current;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      if (!aliveRef.current || planEpochRef.current !== epoch) return { error: 'cancelled' };
      const { data } = await pollJob(jobId);
      if (!aliveRef.current || planEpochRef.current !== epoch) return { error: 'cancelled' };
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
    // Timed out, NOT failed: the Meshy job is still running server-side and the
    // 10 credits are already spent on it — the only honest affordance is to keep
    // polling the SAME job (free). Claiming "it will land in your Library" would
    // be false: nothing re-polls a job once every poller has given up.
    return { timeout: true as const };
  }, [setCard]);

  /** Shared outcome handling for a Meshy poll (first run AND resumed runs). */
  const finishModelPoll = useCallback((result: Awaited<ReturnType<typeof pollModel>>, epoch: number): { glbUrl: string; name: string | null } | null => {
    // Plan switched while this job polled: don't flip B's card to 'ready' with A's
    // model, and don't clear the shared concept cache B may already be using.
    if (planEpochRef.current !== epoch) return null;
    if ('timeout' in result) {
      setCard('headPiece', {
        status: 'stalled',
        error: 'Meshy is still working — big models can take a while. Keep waiting to check the same job (no new credits).',
      });
      return null;
    }
    if ('error' in result) {
      if (result.error === 'cancelled') return null;
      setCard('headPiece', { status: 'failed', error: result.error });
      return null;
    }
    conceptUrlRef.current = null; // model landed; the concept has served its purpose
    setCard('headPiece', { status: 'ready', glbUrl: result.glbUrl, glbName: result.name, progress: 100, error: undefined });
    return result;
  }, [setCard]);

  /** Stalled → keep polling the SAME job. Free; never regenerates a leg. */
  const resumePoll = useCallback(() => guard('headPiece', async () => {
    const jobId = cardsRef.current.headPiece.jobId;
    if (!jobId) return;
    const epoch = planEpochRef.current;
    setCard('headPiece', { status: 'generating', error: undefined, statusLine: MESHY_STATUS_LINES[0] });
    stopRotation();
    let ri = 0;
    rotateTimer.current = setInterval(() => {
      ri = (ri + 1) % MESHY_STATUS_LINES.length;
      setCard('headPiece', { statusLine: MESHY_STATUS_LINES[ri] });
    }, ROTATE_MS);
    try {
      finishModelPoll(await pollModel(jobId), epoch);
    } finally {
      stopRotation();
    }
  }), [guard, setCard, stopRotation, pollModel, finishModelPoll]);

  // Generate a head piece → 'ready' viewer. The image fed to image→3D is, in
  // priority: (1) a concept cached by a previous attempt (free retry — never
  // re-charge); (2) the host's REFERENCE image, which replaces the 1cr concept
  // step (unless forceConcept — a reject-regen always redesigns the concept);
  // (3) a fresh Gemini concept (1cr). Returns the GLB or null.
  const generatePiece = useCallback(async (
    briefOverride?: string,
    forceConcept = false,
  ): Promise<{ glbUrl: string; name: string | null } | null> => {
    if (plan?.headPiece?.kind !== 'generate') return null;
    const epoch = planEpochRef.current;
    const brief = briefOverride ?? plan.headPiece.prompt ?? plan.sceneName;
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
      if (planEpochRef.current !== epoch) return null;
      if (!uuid) { setCard('headPiece', { status: 'failed', error: aiErrorMessage('event_not_found') }); return null; }

      let conceptUrl = conceptUrlRef.current;
      const reference = referenceUrlRef.current;
      if (!conceptUrl && reference && !forceConcept) {
        // Reference REPLACES the concept — skip the 1cr Gemini step (feed it to
        // image→3D directly). Cache it so a failed 3D leg reuses it for free.
        conceptUrl = reference;
        conceptUrlRef.current = reference;
      } else if (!conceptUrl) {
        // No greenScreen: image→3D wants the object on a plain background.
        const concept = await generateImage(uuid, {
          prompt: `${brief} — a single centered object, isolated on a plain neutral studio background, product shot, no frame, no border, no text`,
          kind: '2d_filter',
        });
        // Bail AFTER the charge but BEFORE caching: a stale epoch must not write
        // the concept onto the shared cache (the next plan reads it un-scoped and
        // would build B's 3D from A's concept). A is abandoned; its credit is spent.
        if (planEpochRef.current !== epoch) return null;
        if (concept.error || !concept.data?.experience?.asset_url) {
          setCard('headPiece', { status: 'failed', error: aiErrorMessage((concept.error ?? 'internal') as AiErrorCode) });
          return null;
        }
        conceptUrl = concept.data.experience.asset_url;
        conceptUrlRef.current = conceptUrl;
      }

      const { data, error } = await generate3d(uuid, { mode: 'image', imageUrl: conceptUrl, prompt: brief });
      if (planEpochRef.current !== epoch) return null;
      if (error || !data?.job) {
        setCard('headPiece', { status: 'failed', error: `${aiErrorMessage((error ?? 'internal') as AiErrorCode)} (the source image is saved — Retry does the 3D step only.)` });
        return null;
      }
      // Keep the concept cached until the model is actually READY — a timeout or
      // Meshy failure retried later must still reuse it, never re-charge the 1cr.
      setCard('headPiece', { jobId: data.job.id });

      const result = await pollModel(data.job.id);
      return finishModelPoll(result, epoch);
    } finally {
      stopRotation();
    }
  }, [plan, eventId, eventUuid, setCard, stopRotation, pollModel, finishModelPoll]);

  const approvePiece = useCallback((artifact?: { glbUrl: string; name: string | null }) => {
    const glbUrl = artifact?.glbUrl ?? cardsRef.current.headPiece.glbUrl;
    if (!glbUrl) return;
    const epoch = planEpochRef.current;
    if (approvedRef.current.headPiece) return;
    if (sceneFull()) {
      setCard('headPiece', { error: 'Scene is full (20 pieces) — remove something in Scene Layers first. Your model is safe in the Library.' });
      return;
    }
    approvedRef.current.headPiece = true;
    const name = artifact?.name ?? cardsRef.current.headPiece.glbName ?? plan?.headPiece?.prompt ?? plan?.sceneName ?? 'Head Piece';
    // NOTE: this intentionally dispatches into WHATEVER draft is open right now
    // — if the host loaded a template mid-generation, Approve means "add this
    // piece to my current scene", which is exactly what happens.
    // Measure-then-add: auto-fit the Meshy GLB to head-space cm (a raw ~1-unit
    // model renders ~1cm). The "Added" badge flips only once it actually lands.
    void measureGlbFitScale(glbUrl).then((fitScale) => {
      // A NEW Director plan landed during the async measure — bail: don't add A's
      // model or flip B's card (audit H1). A load-template mid-generation does NOT
      // bump the epoch, so the intentional dispatch-into-current-draft above stands.
      if (planEpochRef.current !== epoch) return;
      // The scene can fill during the measure gap; appendObject then no-ops, so the
      // 'added' badge would lie (audit L: added-at-cap). Re-check BEFORE dispatch;
      // if full, release the latch and mirror the sync cap message — never claim added.
      if (sceneFull()) {
        approvedRef.current.headPiece = false;
        setCard('headPiece', { error: 'Scene is full (20 pieces) — remove something in Scene Layers first. Your model is safe in the Library.' });
        return;
      }
      dispatch({ type: 'SET_MODEL_ASSET', url: glbUrl, name, scale: fitScale ?? undefined });
      setCard('headPiece', { status: 'added', error: undefined });
    });
  }, [plan, dispatch, setCard, sceneFull]);

  /* ── Reject → capture intent → charged regenerate ───────────────────────── */
  const rejectFrame = useCallback(() => setCard('frame', { status: 'rejected' }), [setCard]);
  const keepFrame = useCallback(() => setCard('frame', { status: 'ready', error: undefined }), [setCard]);
  const discardFrame = useCallback(() => setCard('frame', { status: 'discarded' }), [setCard]);
  const setFrameFeedback = useCallback((v: string) => setCard('frame', { feedback: v }), [setCard]);
  const regenerateFrame = useCallback(() => guard('frame', async () => {
    const feedback = (cardsRef.current.frame.feedback ?? '').trim();
    // A rejected LOOK → regenerate the image (1cr): clear the free-reprocess
    // cache so a NEW image is produced, not the old raw re-keyed.
    rawFrameRef.current = null;
    const base = plan?.frame?.prompt ?? '';
    const revised = feedback ? `${base}. Revision: ${feedback}` : base;
    await generateFrame(revised);
  }), [guard, plan, generateFrame]);

  const rejectPiece = useCallback(() => setCard('headPiece', { status: 'rejected' }), [setCard]);
  const keepPiece = useCallback(() => setCard('headPiece', { status: 'ready', error: undefined }), [setCard]);
  const discardPiece = useCallback(() => setCard('headPiece', { status: 'discarded' }), [setCard]);
  const skipPiece = useCallback(() => setCard('headPiece', { status: 'discarded' }), [setCard]);
  const setPieceFeedback = useCallback((v: string) => setCard('headPiece', { feedback: v }), [setCard]);
  const regeneratePiece = useCallback(() => guard('headPiece', async () => {
    const feedback = (cardsRef.current.headPiece.feedback ?? '').trim();
    // A rejected LOOK → redo the concept (1cr) AND the 3D (10cr) = 11cr, even
    // with a reference attached: the reference produced the rejected result, so
    // a fresh concept from the host's notes is what changes it (locked: 11cr).
    conceptUrlRef.current = null;
    const base = plan?.headPiece?.prompt ?? plan?.sceneName ?? '';
    const revised = feedback ? `${base}. Revision: ${feedback}` : base;
    await generatePiece(revised, true);
  }), [guard, plan, generatePiece]);

  const skipFilter = useCallback(() => setCard('shader', { status: 'discarded' }), [setCard]);

  /* ── Generate all — every generatable piece IN PARALLEL, each → 'ready' ──── */
  const generateAll = useCallback(() => guard('generateAll', async () => {
    const p = plan;
    if (!p) return;
    const c = () => cardsRef.current;
    // Filter + built-in piece are free/instant — a "no-op generation" straight
    // to 'ready' so "Add N to scene" approves them alongside the generated ones.
    if (p.shader && c().shader.status === 'idle') setCard('shader', { status: 'ready' });
    if (p.headPiece?.kind === 'procedural' && c().headPiece.status === 'idle') setCard('headPiece', { status: 'ready' });

    const jobs: Promise<unknown>[] = [];
    if (p.frame && (c().frame.status === 'idle' || c().frame.status === 'failed')) {
      jobs.push(guard('frame', () => generateFrame()));
    }
    if (p.headPiece?.kind === 'generate' && (c().headPiece.status === 'idle' || c().headPiece.status === 'failed')) {
      jobs.push(guard('headPiece', () => generatePiece()));
    }
    await Promise.all(jobs);
  }), [guard, plan, setCard, generateFrame, generatePiece]);

  /* ── Add N to scene — approve every READY card (reuses the guarded approves) ─ */
  const addReadyToScene = useCallback(() => {
    const c = cardsRef.current;
    if (plan?.shader && c.shader.status === 'ready') approveFilter();
    if (plan?.frame && c.frame.status === 'ready') approveFrame();
    if (plan?.headPiece && c.headPiece.status === 'ready') {
      if (plan.headPiece.kind === 'procedural') approveProceduralPiece();
      else approvePiece();
    }
  }, [plan, approveFilter, approveFrame, approveProceduralPiece, approvePiece]);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  const anyGenerating = cards.frame.status === 'generating' || cards.headPiece.status === 'generating';
  const readyCount =
    ((plan?.frame && cards.frame.status === 'ready') ? 1 : 0) +
    ((plan?.shader && cards.shader.status === 'ready') ? 1 : 0) +
    ((plan?.headPiece && cards.headPiece.status === 'ready') ? 1 : 0);

  const headKind = plan?.headPiece?.kind;
  const headLabel = plan?.headPiece
    ? plan.headPiece.kind === 'procedural'
      ? (HEAD_PIECE_MAP[plan.headPiece.id ?? '']?.name ?? plan.headPiece.id ?? '')
      : (plan.headPiece.prompt ?? 'Generated piece')
    : '';
  // A reference replaces the 1cr concept → 10cr; without one it's 11cr.
  const headGenerateCost = referenceUrl ? GENERATE_3D_CREDIT_COST : HEAD_PIECE_GENERATE_TOTAL;
  const headGenerateNote = referenceUrl
    ? `Your reference image → 3D model (${GENERATE_3D_CREDIT_COST} credits)`
    : `Concept image (${FRAME_CREDIT_COST} credit, or one of your free generations) → 3D model (${GENERATE_3D_CREDIT_COST} credits)`;

  const planBlock = plan && (
    <div className="flex flex-col gap-3">
      <SceneHeader sceneName={plan.sceneName} onGenerateAll={generateAll} generateAllDisabled={anyGenerating} />

      {plan.frame && (
        <FrameCard
          prompt={plan.frame.prompt}
          cost={FRAME_CREDIT_COST}
          regenCost={FRAME_CREDIT_COST}
          state={cards.frame}
          onGenerate={() => guard('frame', () => generateFrame())}
          onApprove={() => approveFrame()}
          onReject={rejectFrame}
          onImageError={onFrameImageError}
          onFeedbackChange={setFrameFeedback}
          onRegenerate={regenerateFrame}
          onKeep={keepFrame}
          onDiscard={discardFrame}
        />
      )}

      {plan.shader && (
        <FilterCard
          name={SHADER_MAP[plan.shader.shaderId]?.name ?? plan.shader.shaderId}
          description={SHADER_MAP[plan.shader.shaderId]?.description ?? 'A coordinated booth filter.'}
          state={cards.shader}
          onApprove={approveFilter}
          onSkip={skipFilter}
        />
      )}

      {plan.headPiece && headKind && (
        <HeadPieceCard
          mode={headKind}
          label={headLabel}
          cost={headKind === 'generate' ? headGenerateCost : 0}
          regenCost={HEAD_PIECE_GENERATE_TOTAL}
          note={headKind === 'generate' ? headGenerateNote : undefined}
          state={cards.headPiece}
          onApprove={headKind === 'procedural' ? approveProceduralPiece : () => approvePiece()}
          onResume={resumePoll}
          onGenerate={() => guard('headPiece', () => generatePiece())}
          onReject={rejectPiece}
          onSkip={skipPiece}
          onFeedbackChange={setPieceFeedback}
          onRegenerate={regeneratePiece}
          onKeep={keepPiece}
          onDiscard={discardPiece}
        />
      )}
    </div>
  );

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
        {messages.length === 0 && (
          <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3.5">
            <p className="font-sans text-[13px] text-brand-fg/90 leading-relaxed">
              Describe a look and I'll design a matching{' '}
              <span className="text-accent-2">frame</span>,{' '}
              <span className="text-accent-2">filter</span>, and{' '}
              <span className="text-accent-2">head piece</span> as one scene — or ask for ideas first.
            </p>
            <p className="font-sans text-[11px] text-brand-muted/55 leading-relaxed mt-2">
              Generate to preview each piece, then add what you love. You only spend credits on what you generate.
            </p>
            <p className="font-sans text-[10px] text-brand-muted/45 leading-relaxed mt-1.5">
              Frame {FRAME_CREDIT_COST} credit · 3D piece {HEAD_PIECE_GENERATE_TOTAL} ({GENERATE_3D_CREDIT_COST} with a reference) · filters free.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <Fragment key={m.id}>
            {m.role === 'user' ? (
              <div className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-accent)]/15 border border-accent/20 px-3.5 py-2 font-sans text-[13px] text-brand-fg leading-snug whitespace-pre-wrap break-words">
                {m.text}
              </div>
            ) : (
              <div
                role={m.tone === 'error' ? 'alert' : undefined}
                className={`self-start max-w-[92%] rounded-2xl rounded-bl-sm border px-3.5 py-2.5 font-sans text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                  m.tone === 'error'
                    ? 'bg-amber-500/10 border-amber-400/25 text-amber-200/90'
                    : 'bg-white/[0.03] border-white/8 text-brand-fg/90'
                }`}
              >
                {m.text}
              </div>
            )}
            {m.id === planAnchorId && planBlock}
          </Fragment>
        ))}

        {phase === 'planning' && (
          <div className="self-start flex items-center gap-2 rounded-2xl rounded-bl-sm border border-white/8 bg-white/[0.03] px-3.5 py-2.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-2" />
            <span className="font-sans text-[12px] text-brand-muted/60">Thinking…</span>
          </div>
        )}
      </div>

      {/* Add N to scene (sticky) */}
      {readyCount > 0 && (
        <div className="shrink-0 border-t border-white/10 px-3 py-2.5 bg-brand-bg/70 lg:bg-white/[0.02]">
          <button
            onClick={addReadyToScene}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-foil px-4 py-2.5 font-label uppercase tracking-widest text-[10px] font-bold text-white glow-accent transition active:scale-[0.98]"
          >
            <Check className="w-3.5 h-3.5" /> Add {readyCount} to scene
          </button>
        </div>
      )}

      {/* Composer (bottom) */}
      <div className="shrink-0 border-t border-white/10 p-3 bg-brand-bg/60 lg:bg-transparent">
        {(referenceUrl || referenceUploading) && (
          <div className="mb-2 flex items-center gap-2 w-fit max-w-full rounded-lg bg-white/[0.05] border border-white/10 pl-1.5 pr-2 py-1.5">
            {referenceUploading ? (
              <span className="w-8 h-8 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-accent-2" /></span>
            ) : (
              <img src={referenceUrl!} alt="Reference" className="w-8 h-8 rounded object-cover" />
            )}
            <span className="font-sans text-[11px] text-brand-fg/80 truncate">
              {referenceUploading ? 'Uploading reference…' : 'Reference · guides frame + 3D'}
            </span>
            {referenceUrl && (
              <button onClick={() => setReferenceUrl(null)} aria-label="Remove reference" className="p-0.5 rounded text-brand-muted/60 hover:text-brand-fg transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {anyGenerating && (
          <p className="mb-2 font-sans text-[10px] text-brand-muted/50 leading-snug">
            Finish or discard the current generation before starting a new scene.
          </p>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={referenceUploading}
            aria-label="Attach a reference image"
            title="Attach a reference image"
            className="shrink-0 p-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-brand-muted/70 hover:text-brand-fg transition-colors disabled:opacity-50"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!anyGenerating) send(); } }}
            rows={2}
            maxLength={400}
            placeholder="Describe a look, or ask for ideas…"
            className="flex-1 rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-[13px] text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/60 resize-none"
          />
          <button
            onClick={send}
            disabled={!prompt.trim() || phase === 'planning' || anyGenerating}
            className="shrink-0 flex items-center gap-1.5 rounded-xl bg-foil px-4 py-2.5 font-label uppercase tracking-widest text-[10px] font-bold text-white glow-accent transition active:scale-[0.97] disabled:opacity-50"
          >
            {phase === 'planning' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clapperboard className="w-3.5 h-3.5" />}
            {phase === 'planning' ? 'Thinking…' : 'Send'}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onReferenceFile} />
      </div>
    </div>
  );
}
