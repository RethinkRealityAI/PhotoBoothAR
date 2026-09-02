/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The copilot conversation: docs-grounded Q&A + event-aware tool proposals.
 * Mutations render as A2UI confirm cards (preview-first); confirm executes
 * the lib call with the host's own RLS session and feeds a [tool_result]
 * turn back to the model (merged for role alternation on the wire).
 * Read-only tools (get_stats / share_links) execute instantly.
 *
 * Transcripts persist per event in sessionStorage ('beamwall:copilot:v1').
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Loader2, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  askCopilot, executeAction, normalizeActions, applyGeneratedFrame, applyGeneratedPiece,
  formatToolResult, toolResultSummary, sendFeedback,
  type CopilotAction, type CopilotCtx, type ExecResult, type FrameProvider,
} from '../../lib/copilot';
import { useCopilotStore } from '../../lib/copilotStore';
import { openSupportDialog } from '../../lib/supportStore';
import {
  buildCardLinkSurface, buildLinksSurface, buildProposalSurface, buildStatsSurface,
  buildGeneratingSurface, buildFramePreviewSurface, buildHeadPiecePreviewSurface,
  buildGenErrorSurface, buildBoothTestSurface, buildChecklistSurface,
  type ProposalChallenge,
} from '../../lib/copilotSurfaces';
import { gapPrompt, proposalGaps, requiredGaps } from '../../lib/proposalGaps';
import {
  applySurfaceMessages, setPath,
  type A2uiActionEvent, type A2uiMessage, type SurfaceState,
} from '../../lib/a2ui';
import {
  generateImage, generate3d, pollJob, resolveEventUuid, aiErrorMessage, aiErrorRetryable,
  fetchEventCreditBalance, type AiErrorCode,
} from '../../lib/ai';
import { providerCostLabel } from '../../lib/providerPricing';
import { processGeneratedFrame } from '../../lib/studio/frameProcessing';
import { measureGlbFitScale } from '../../lib/studio/glbThumb';
import { boothUrl } from '../../lib/copilotBooth';
import { FILTER_SHADERS } from '../../lib/shaders';
import { HEAD_PIECES } from '../../lib/headPieces';
import type { ChatMessage } from '../../lib/eventDesigner';
import type { EventSnapshot } from '../../lib/eventSnapshot';
import type { Experience } from '../../types';
import A2uiSurface from '../a2ui/A2uiSurface';
import { haptic } from '../../lib/haptics';
import { useKeyboardInset } from './useKeyboardInset';
import { buildConceptPrompt, normalizeLettering, type LetteringSpec } from '../../lib/assetPrompt';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const POLL_MS = 5000;
const MAX_POLLS = 60; // ~5 minutes — matches the studio Director's Meshy poll
const DEFAULT_FILTER_ID = FILTER_SHADERS.find((s) => s.id !== 'none')?.id ?? 'none';
const DEFAULT_PIECE_ID = HEAD_PIECES[0]?.id ?? '';

/** A retry is pointless (and unfair) for hard, non-transient failures —
 *  including a missing/rejected provider key (shared list in lib/ai.ts). */
const retryableGenError = aiErrorRetryable;

/**
 * Cost caption for a paid-generation proposal card.
 *
 * Read from the surface's LIVE data model (not from the action that created the
 * card) so it tracks that card's own provider picker: the caption said
 * "1 credit" while the picker was set to Higgsfield, which the server charges 2
 * for (audit F4). The number comes from providerPricing — the same module the
 * studio's Generate button reads — so there is one price rule, not three.
 *
 * A card whose phase has moved on (generating / preview / error) has no
 * `proposal` in its model and correctly shows no price.
 */
function costNoteFor(surface: SurfaceState | undefined): string | null {
  const raw = surface?.dataModel?.proposal;
  if (raw === null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.tool === 'generate_frame') {
    // `null` status: the copilot has no provider-key read of its own, so it
    // quotes the PLATFORM price. The picker label carries the BYO-key case
    // ("or your connected account" — 0 credits), which such an org knows.
    const cost = providerCostLabel(p.provider === 'higgsfield' ? 'higgsfield' : 'gemini', null);
    return `${cost} (your event’s first 3 AI images are free)`;
  }
  if (p.tool === 'add_head_piece' && p.source === 'generate') {
    return 'up to 11 credits (concept image + 10 for the 3D model — the image is free while your event has free AI images left)';
  }
  return null;
}

/**
 * Generation-failure copy, with the one case the shared mapper cannot get
 * right: `ai_not_configured` on a HIGGSFIELD generation is a missing key on the
 * host's own org, not a platform outage — "our AI service is temporarily
 * unavailable" blamed us for something only they can fix (audit F6).
 */
function frameErrorMessage(code: AiErrorCode, provider: FrameProvider): string {
  if (code === 'ai_not_configured' && provider === 'higgsfield') {
    return 'Higgsfield isn’t connected yet — add your key in Billing → Connected accounts, or switch to Beamwall AI.';
  }
  return aiErrorMessage(code);
}

interface ChatItem extends ChatMessage {
  surfaceId?: string;
  kind?: 'tool_result';
  /** Did the action this result reports actually succeed? Absent on older
   *  persisted transcripts, which are then rendered neutrally rather than
   *  being retro-labelled as successes. */
  ok?: boolean;
  /** This assistant turn is the OFFLINE fallback text, not a model reply. Absent
   *  on older persisted transcripts, which stay rendered as normal replies. */
  offline?: boolean;
  /** Server id of this assistant turn (agent_turns) — the handle thumbs send.
   *  Absent on offline replies, older servers, and older persisted transcripts,
   *  none of which render the thumbs. */
  turnId?: number;
  /** The host's thumbs verdict on this turn, once sent successfully. */
  feedback?: 1 | -1;
}

/** The host-readable text of a [tool_result] pill. Machine-form turns
 *  (`[tool_result] tool=… ok=… — summary`) show the summary only; older
 *  hand-written turns persisted in sessionStorage keep their whole sentence
 *  (toolResultSummary would cut those at their first ' — '). */
function pillText(content: string): string {
  return /^\[tool_result\] tool=/.test(content)
    ? toolResultSummary(content)
    : content.replace(/^\[tool_result\]\s*/, '');
}

/** Plain-text tail of the transcript for a support handoff: the last `n`
 *  turns that carry text, tool results as their host-readable summary. */
function transcriptTail(items: ChatItem[], n: number): string {
  return items
    .filter((m) => m.content.trim().length > 0)
    .slice(-n)
    .map((m) => {
      if (m.kind === 'tool_result') return `Result: ${pillText(m.content)}`;
      return `${m.role === 'user' ? 'Host' : 'Copilot'}: ${m.content}`;
    })
    .join('\n');
}

/** Relabel one Text component inside an A2UI stream — used to turn the shared
 *  gen-error card's "Try again" into "Keep waiting" for a stalled Meshy job
 *  without a second card builder. */
function relabelComponent(msgs: A2uiMessage[], id: string, text: string): A2uiMessage[] {
  return msgs.map((msg) => msg.updateComponents
    ? {
        ...msg,
        updateComponents: {
          ...msg.updateComponents,
          components: msg.updateComponents.components.map((c) => (c.id === id ? { ...c, text } : c)),
        },
      }
    : msg);
}

/** Honest copy for a Meshy job that outlived the client poll: the job is still
 *  running server-side and its credits are already spent, so the ONLY offer is
 *  to keep polling the same job (free). */
const MESHY_STALLED_COPY =
  'Still sculpting on our side — this can take several minutes. Keep waiting here, or check the Library later; nothing is charged twice.';

const STORE_KEY = 'beamwall:copilot:v1';

const GREETING =
  'Ask me anything — how Beamwall works, what’s in your event, or tell me what to change ' +
  '(“add a scavenger-hunt challenge worth 20 points”, “make a card for Grandma”).';

/** First-time helper chips (empty thread only) — each prefills the input so the
 *  host can read, tweak, then send. Drawn from the copilot's real tool set. */
const EXAMPLE_PROMPTS = [
  'Add a photo challenge worth 20 points',
  'Generate a frame that matches my theme',
  'Make me a 3D crown to wear',
];

/** How close to the bottom (px) still counts as "following the conversation". */
const NEAR_BOTTOM_PX = 80;

function loadSaved(key: string): { chat: ChatItem[]; surfaces: Record<string, SurfaceState> } {
  try {
    const all = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>;
    const entry = all[key] as { chat?: ChatItem[]; surfaces?: Record<string, SurfaceState> } | undefined;
    return {
      chat: Array.isArray(entry?.chat) ? entry.chat : [],
      surfaces: entry?.surfaces && typeof entry.surfaces === 'object' ? entry.surfaces : {},
    };
  } catch {
    return { chat: [], surfaces: {} };
  }
}

export default function CopilotChat({
  snapshot,
  onMutated,
  greeting,
  mode = 'default',
  liftAboveKeyboard = true,
}: {
  snapshot: EventSnapshot | null;
  onMutated: () => void;
  /** Opening bubble override (the build phase greets differently). */
  greeting?: string;
  /** 'build' swaps the quick-action chips to the experience-building set. */
  mode?: 'default' | 'build';
  /** Pad the bottom by the mobile keyboard's height. Pass false when the HOST
   *  container already lifts itself above the keyboard (the floating panel). */
  liftAboveKeyboard?: boolean;
}) {
  const storeKey = snapshot?.eventUuid ?? 'platform';
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatItem[]>(() => loadSaved(storeKey).chat);
  // The previous assistant turn's server id + its dropped-proposal count, sent
  // as `lastTurn` with the next ask so telemetry can stamp that row. Not
  // persisted: after a refresh the count is unknown, so nothing is claimed.
  const lastTurnRef = useRef<{ turnId: number; dropped: number } | null>(null);
  // Turn ids with a thumbs request in flight (the pair is disabled meanwhile).
  const [feedbackPending, setFeedbackPending] = useState<Set<number>>(() => new Set());
  const [surfaces, setSurfaces] = useState<Record<string, SurfaceState>>(() => loadSaved(storeKey).surfaces);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reduced = useReducedMotion() ?? false;
  const kbInset = useKeyboardInset();
  // Messages restored from sessionStorage must not replay their entrance
  // animation — only messages added after mount animate in.
  const mountCountRef = useRef(messages.length);
  // Follow the conversation only while the host is already near the bottom —
  // never yank them down while they're reading history.
  const nearBottomRef = useRef(true);
  const handleListScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };
  // Confirm cards flash a brief success check before leaving instead of
  // vanishing on click — sid → true while the flash is showing.
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  // Per-surface generation state (async frame/3D). `runningGen` is a synchronous
  // double-fire latch so a fast double-click on Generate can never double-charge;
  // `genState` holds the prompt (for regenerate) + the generated experience (for
  // apply). Each generation card is independent — no shared plan/epoch needed.
  // `lettering` rides along so Regenerate re-runs the SAME words on the frame —
  // re-rolling the art and silently losing the couple's names would read as a bug.
  // `provider` rides along for the same reason: a Regenerate must not quietly
  // move the host onto a different model (or a different price) than the one
  // their card said it would use.
  // `jobId` is set ONLY while a Meshy job is stalled (outlived the client poll):
  // "Keep waiting" resumes polling that same job instead of paying for a new one.
  const genState = useRef<Record<string, {
    kind: 'frame' | 'headpiece'; prompt: string; experience?: Experience; lettering?: LetteringSpec | null;
    provider?: FrameProvider; jobId?: string;
  }>>({});
  const runningGen = useRef<Set<string>>(new Set());
  // Same latch for APPLY: the card now waits for the publish to answer before it
  // leaves, so without this a second tap would publish-and-pin twice.
  const applyingGen = useRef<Set<string>>(new Set());
  // Surfaces the host dismissed mid-generation — a late async continuation must
  // NOT re-materialise a card the host already closed (F2).
  const dismissedGen = useRef<Set<string>>(new Set());
  // Surfaces we have already asked a QUALITY question about (a brief that is
  // real but vague). A host who presses the button again has seen the question
  // and chosen to go ahead — asking twice is arguing, not helping. Required
  // fields are never in here: those block every time.
  const askedGaps = useRef<Set<string>>(new Set());
  // Live credit balance of THIS event's org (the org generation charges) —
  // shown beside paid-generation proposal cards; refreshed after each spend.
  const [balance, setBalance] = useState<number | null>(null);

  const refreshBalance = async (uuid: string) => {
    const b = await fetchEventCreditBalance(uuid);
    setBalance(b);
  };

  useEffect(() => {
    const uuid = snapshot?.eventUuid;
    if (!uuid) { setBalance(null); return; }
    let alive = true;
    fetchEventCreditBalance(uuid).then((b) => { if (alive) setBalance(b); });
    return () => { alive = false; };
  }, [snapshot?.eventUuid]);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [messages, busy, reduced]);

  // Auto-grow the input up to ~4 lines; also snaps back when send() clears it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    try {
      const all = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>;
      all[storeKey] = { chat: messages, surfaces };
      sessionStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch { /* best-effort */ }
  }, [messages, surfaces, storeKey]);

  const ctx = (): CopilotCtx => ({
    slug: snapshot?.slug ?? '',
    eventUuid: snapshot?.eventUuid ?? '',
    origin: window.location.origin,
  });

  const addSurface = (msgs: A2uiMessage[], sid: string) => {
    setSurfaces((s) => applySurfaceMessages(s, msgs));
    setMessages((m) => [...m, { role: 'assistant', content: '', surfaceId: sid }]);
  };

  /** The snapshot row an update/delete proposal points at, so its confirm card
   *  can NAME the challenge instead of showing the host a bare uuid. */
  const targetChallenge = (action: CopilotAction): ProposalChallenge =>
    action.tool === 'update_challenge' || action.tool === 'delete_challenge'
      ? snapshot?.challenges.find((c) => c.id === action.proposal.challengeId) ?? null
      : null;

  /** Swap the CONTENT of an existing surface in place (the chat message that
   *  references it stays put) — used to drive a generation card through its
   *  proposal → working → preview → error phases. */
  const replaceSurface = (sid: string, msgs: A2uiMessage[]) => setSurfaces((s) => applySurfaceMessages(s, msgs));
  const dropSurfaceById = (sid: string) => setSurfaces((s) => applySurfaceMessages(s, [{ deleteSurface: { surfaceId: sid } }]));
  /** Applied-action exit: overlay a brief success check on the card (input on it
   *  is blocked meanwhile), then remove it — instead of an abrupt vanish. */
  const flashThenDrop = (sid: string) => {
    setFlash((f) => ({ ...f, [sid]: true }));
    window.setTimeout(() => {
      dropSurfaceById(sid);
      setFlash((f) => {
        const { [sid]: _gone, ...rest } = f;
        void _gone;
        return rest;
      });
    }, 700);
  };
  /** Guarded phase swap for a generation card — a no-op once the host dismissed it. */
  const placeGen = (sid: string, msgs: A2uiMessage[]) => { if (!dismissedGen.current.has(sid)) replaceSurface(sid, msgs); };

  /** Tell the MODEL what the host can now see. A landed preview left no trace in
   *  the transcript, so the next turn behaved as if nothing had been generated
   *  (re-proposing the same asset, or denying it existed). Terse on purpose —
   *  this rides the wire like every other [tool_result] turn. */
  const noteGenerated = (tool: 'generate_frame' | 'add_head_piece', prompt: string) => {
    pushResult(tool, { ok: true, summary: `Preview shown, not applied yet (prompt: "${prompt.slice(0, 140)}").` });
  };

  /** Append one [tool_result] turn in the machine form the model reads
   *  (formatToolResult); the pill renders only its summary. Hoisted so the
   *  helpers above it may call it at event time. */
  function pushResult(tool: string, r: { ok: boolean; code?: string; retryable?: boolean; summary: string }) {
    setMessages((m) => [...m, { role: 'user', kind: 'tool_result', ok: r.ok, content: formatToolResult(tool, r) }]);
  }

  /** Read-only tools run instantly from the snapshot — no confirm, no wire. */
  const runReadOnly = (action: CopilotAction) => {
    // Bailing in silence meant the model could answer "here are your stats" and
    // then nothing at all appeared — the host was left staring at a promise.
    if (!snapshot) {
      pushResult(action.tool, {
        ok: false, code: 'no_event', retryable: false,
        summary: 'I can only look that up for one event at a time — pick an event above and ask me again.',
      });
      return;
    }
    const sid = `ro_${++seqRef.current}`;
    if (action.tool === 'get_stats') {
      // A failed snapshot renders every count as 0. Four confident zeroes about
      // an event that is actually full is worse than no answer at all.
      if (snapshot.failed) {
        pushResult(action.tool, {
          ok: false, code: 'network', retryable: true,
          summary: 'I couldn’t read this event just now, so I won’t show you numbers I can’t stand behind — try again in a moment.',
        });
        return;
      }
      addSurface(buildStatsSurface([
        { label: 'Wall posts', value: snapshot.postCount },
        { label: 'Challenges', value: snapshot.challenges.length },
        { label: 'Experiences', value: snapshot.experiences.length },
        { label: 'Cards', value: snapshot.cards.length },
      ], sid), sid);
    } else if (action.tool === 'share_links') {
      const base = `${window.location.origin}/e/${snapshot.slug}`;
      addSurface(buildLinksSurface([
        { title: 'Welcome', url: `${base}/welcome` },
        { title: 'Booth', url: `${base}/booth` },
        { title: 'Wall', url: `${base}/wall` },
        { title: 'Upload', url: `${base}/upload` },
      ], sid), sid);
    } else if (action.tool === 'test_experience') {
      addSurface(buildBoothTestSurface(sid, {
        slug: snapshot.slug,
        status: snapshot.status,
        boothUrl: boothUrl(window.location.origin, snapshot.slug),
      }), sid);
    }
  };

  /** Build-mode "beam-ready" checklist, computed from the live snapshot. */
  const showChecklist = () => {
    if (!snapshot) return;
    // Same reason as get_stats: on a failed read every item computes ○, which
    // would tell a host who has built everything that they have built nothing.
    if (snapshot.failed) {
      pushResult('checklist', {
        ok: false, code: 'network', retryable: true,
        summary: 'I couldn’t read this event just now, so the checklist would be wrong — try again in a moment.',
      });
      return;
    }
    const sid = `chk_${++seqRef.current}`;
    // Count only PUBLISHED experiences — an unapproved/dismissed generation
    // leaves an unpublished row that must not tick the checklist (F7).
    addSurface(buildChecklistSurface(sid, [
      { label: 'Add a frame', done: snapshot.experiences.some((e) => e.kind === 'border' && e.published) },
      { label: 'Add a filter', done: snapshot.experiences.some((e) => e.kind === 'shader' && e.published) },
      { label: 'Add a 3D prop', done: snapshot.experiences.some((e) => e.kind === '3d_attachment' && e.published) },
      { label: 'Add challenges', done: snapshot.challenges.length > 0 },
      { label: 'Go live', done: snapshot.status === 'live' },
    ]), sid);
  };

  /** `topUp` adds a "Top up credits" button (absolute URL — openUrl is http(s)-only). */
  const showGenError = (sid: string, kind: 'frame' | 'headpiece', message: string, retryable: boolean, topUp = false) =>
    placeGen(sid, buildGenErrorSurface(sid, message, {
      kind,
      retryable,
      topUpUrl: topUp ? `${window.location.origin}/host/billing` : undefined,
    }));

  /** FRAME: generate (greenScreen) → chroma-key → preview. Charge happens once
   *  in generateImage (server-metered, first 3 free); apply never re-generates. */
  const startFrameGen = async (
    sid: string,
    prompt: string,
    lettering: LetteringSpec | null = null,
    /** Which model paints it. The A2UI card carries the choice (its
     *  providerPicker always seeds one); this only threads it to the server. */
    provider: FrameProvider = 'gemini',
  ) => {
    if (!snapshot || runningGen.current.has(sid)) return;
    runningGen.current.add(sid);
    dismissedGen.current.delete(sid);
    genState.current[sid] = { kind: 'frame', prompt, lettering, provider };
    placeGen(sid, buildGeneratingSurface(sid, 'Designing your frame…'));
    try {
      const uuid = await resolveEventUuid(snapshot.slug, snapshot.eventUuid);
      if (!uuid) { showGenError(sid, 'frame', aiErrorMessage('event_not_found'), false); return; }
      // 'standalone' lettering is name art with NO frame around it — a single
      // centred subject, which is the sticker path ('2d_filter'), not a border.
      const standalone = lettering?.placement === 'standalone';
      const res = await generateImage(uuid, {
        prompt,
        kind: standalone ? '2d_filter' : 'border',
        transparentBackground: standalone,
        greenScreen: true,
        // Absent for gemini (the server default), so the body of every frame
        // generation made before this option existed is unchanged.
        ...(provider === 'higgsfield' ? { provider } : {}),
        ...(lettering ? { lettering } : {}),
      });
      if (res.error || !res.data?.experience) {
        const code = (res.error ?? 'internal') as AiErrorCode;
        // Provider-aware: a missing Higgsfield key must not read as a platform
        // outage the host can only wait out (audit F6).
        showGenError(sid, 'frame', frameErrorMessage(code, provider), retryableGenError(code), code === 'insufficient_credits');
        return;
      }
      const { experience, keyed } = await processGeneratedFrame(res.data.experience, snapshot.slug);
      genState.current[sid] = { kind: 'frame', prompt, lettering, provider, experience };
      if (!keyed) {
        showGenError(sid, 'frame', 'Generated, but the transparent cutout didn’t come through cleanly — Regenerate for a fresh version.', true);
        return;
      }
      placeGen(sid, buildFramePreviewSurface(sid, { experienceId: experience.id, assetUrl: experience.asset_url ?? '' }));
      noteGenerated('generate_frame', prompt);
    } catch (e) {
      console.error('[copilot] startFrameGen', e);
      showGenError(sid, 'frame', 'Frame generation failed — try again.', true);
    } finally {
      runningGen.current.delete(sid);
      if (snapshot?.eventUuid) void refreshBalance(snapshot.eventUuid);
    }
  };

  /** 3D PROP: Gemini concept image (1cr) → image→3D (10cr) → poll → preview.
   *  The same two-step the studio Director uses; apply never re-generates. */
  const startPieceGen = async (sid: string, prompt: string) => {
    if (!snapshot || runningGen.current.has(sid)) return;
    runningGen.current.add(sid);
    dismissedGen.current.delete(sid);
    genState.current[sid] = { kind: 'headpiece', prompt };
    placeGen(sid, buildGeneratingSurface(sid, 'Sculpting your 3D prop… this can take a minute.'));
    try {
      const uuid = await resolveEventUuid(snapshot.slug, snapshot.eventUuid);
      if (!uuid) { showGenError(sid, 'headpiece', aiErrorMessage('event_not_found'), false); return; }
      // Wearable geometry lives in the CONCEPT, because Meshy's image->3D copies
      // what it sees: a concept showing the piece on a face produces a mesh with
      // a face fused into it. The old prompt said only "a single centered
      // object … product shot", which is how masks came back as solid lumps.
      const concept = await generateImage(uuid, {
        prompt: buildConceptPrompt(prompt),
        kind: '2d_filter',
        artDirection: false, // buildConceptPrompt is already complete + 3D-specific
        nameHint: prompt,    // …and far too long to name the Library row after
      });
      if (concept.error || !concept.data?.experience?.asset_url) {
        const code = (concept.error ?? 'internal') as AiErrorCode;
        showGenError(sid, 'headpiece', aiErrorMessage(code), retryableGenError(code), code === 'insufficient_credits');
        return;
      }
      // Raw brief: image->3D takes no text prompt, so this only names the
      // experience (ai-job-status truncates it to 40 chars).
      const g = await generate3d(uuid, { mode: 'image', imageUrl: concept.data.experience.asset_url, prompt });
      if (g.error || !g.data?.job) {
        const code = (g.error ?? 'internal') as AiErrorCode;
        showGenError(sid, 'headpiece', aiErrorMessage(code), retryableGenError(code), code === 'insufficient_credits');
        return;
      }
      await pollPieceJob(sid, prompt, g.data.job.id);
    } catch (e) {
      console.error('[copilot] startPieceGen', e);
      showGenError(sid, 'headpiece', '3D generation failed — try again.', true);
    } finally {
      runningGen.current.delete(sid);
      if (snapshot?.eventUuid) void refreshBalance(snapshot.eventUuid);
    }
  };

  /** Poll ONE Meshy job to its end (first run AND "Keep waiting" resumes).
   *  Every exit clears `jobId` except the stall, which keeps it so the card's
   *  button resumes THIS job. Caller owns the runningGen latch. */
  const pollPieceJob = async (sid: string, prompt: string, jobId: string) => {
    const cur = genState.current[sid];
    if (cur) delete cur.jobId;
    let experience: Experience | undefined;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      const p = await pollJob(jobId);
      const job = p.data?.job;
      if (job?.status === 'succeeded') { experience = p.data?.experience; break; }
      if (job?.status === 'failed' || job?.status === 'refunded') {
        showGenError(sid, 'headpiece', job.error ? `Generation failed — credits refunded. (${job.error})` : 'Generation failed — credits refunded.', true);
        return;
      }
      // Real progress when the job reports it (0 is a legitimate value, so
      // check the type, never truthiness): a card that read the same static
      // line for four minutes looked hung.
      const pct = typeof p.data?.progress === 'number' ? p.data.progress : null;
      if (pct !== null) {
        placeGen(sid, buildGeneratingSurface(sid, `Sculpting your 3D prop… ${Math.round(pct)}% — this can take a minute.`));
      }
    }
    if (!experience) {
      // Client-side poll timeout, NOT a failure: the Meshy job is still running
      // server-side and its credits are already spent. The card's button is
      // "Keep waiting" (same job, free) — never a regenerate, which would spend
      // ~11 credits on a second job. Nothing else re-polls a job once every
      // poller has given up, so "it will land in your Library" would be a lie.
      genState.current[sid] = { kind: 'headpiece', prompt, jobId };
      placeGen(sid, relabelComponent(
        buildGenErrorSurface(sid, MESHY_STALLED_COPY, { kind: 'headpiece', retryable: true }),
        'retryLabel', 'Keep waiting',
      ));
      return;
    }
    genState.current[sid] = { kind: 'headpiece', prompt, experience };
    placeGen(sid, buildHeadPiecePreviewSurface(sid, {
      experienceId: experience.id,
      thumbUrl: experience.thumbnail_url ?? null,
      label: prompt,
    }));
    noteGenerated('add_head_piece', prompt);
  };

  /** Stalled Meshy job → keep polling the SAME job. Free; never regenerates. */
  const resumePieceGen = async (sid: string, prompt: string, jobId: string) => {
    if (!snapshot || runningGen.current.has(sid)) return;
    runningGen.current.add(sid);
    dismissedGen.current.delete(sid);
    placeGen(sid, buildGeneratingSurface(sid, 'Still sculpting your 3D prop… checking the same job.'));
    try {
      await pollPieceJob(sid, prompt, jobId);
    } catch (e) {
      console.error('[copilot] resumePieceGen', e);
      // The job is untouched by a client-side error — offer to keep waiting again.
      genState.current[sid] = { kind: 'headpiece', prompt, jobId };
      placeGen(sid, relabelComponent(
        buildGenErrorSurface(sid, MESHY_STALLED_COPY, { kind: 'headpiece', retryable: true }),
        'retryLabel', 'Keep waiting',
      ));
    } finally {
      runningGen.current.delete(sid);
    }
  };

  /** Approve a generated asset: publish + pin as booth default (NO regen). */
  const applyGenerated = async (event: A2uiActionEvent) => {
    const sid = event.surfaceId;
    // The card now stays mounted until the publish resolves (see below), so it
    // needs the same synchronous double-fire latch Generate has.
    if (applyingGen.current.has(sid)) return;
    const g = genState.current[sid];
    const kind = event.context.kind === 'headpiece' ? 'headpiece' : 'frame';
    const experienceId = String(event.context.experienceId ?? g?.experience?.id ?? '');
    delete genState.current[sid];
    if (!experienceId) {
      dropSurfaceById(sid);
      pushResult(kind === 'frame' ? 'generate_frame' : 'add_head_piece', {
        ok: false, code: 'not_found', retryable: false,
        summary: 'The generated asset was lost — please generate it again.',
      });
      return;
    }
    applyingGen.current.add(sid);
    let result;
    if (kind === 'frame') {
      result = await applyGeneratedFrame(ctx(), experienceId);
    } else {
      // Fit the raw Meshy GLB to head size (scale 1 renders ~1cm) — same as the
      // studio Director's measure-then-add. Best-effort: an unmeasurable model
      // (or a post-refresh apply with no cached asset) still applies at its baked
      // scale; the host can fine-tune placement in the studio 3D editor.
      let fitScale: number | null = null;
      let glbUrl = g?.experience?.asset_url ?? null;
      if (!glbUrl) {
        // Post-refresh: genState is gone — re-read the row so we can still fit.
        try {
          const { supabase } = await import('../../lib/supabase');
          const { data } = await supabase.from('experiences').select('asset_url').eq('id', experienceId).maybeSingle();
          glbUrl = (data?.asset_url as string | null) ?? null;
        } catch { /* best-effort */ }
      }
      if (glbUrl) { try { fitScale = await measureGlbFitScale(glbUrl); } catch { /* best-effort fit */ } }
      result = await applyGeneratedPiece(ctx(), experienceId, fitScale);
    }
    applyingGen.current.delete(sid);
    // The success flash used to fire BEFORE this await, so a publish that FAILED
    // still played its ✓ animation and the card slid away as though applied —
    // the host walked off believing their paid-for asset was live on the booth.
    // The ✓ is now the publish's own answer; a failure just closes the card and
    // the amber result line beneath says what to do instead.
    if (result.ok) flashThenDrop(sid); else dropSurfaceById(sid);
    pushResult(kind === 'frame' ? 'generate_frame' : 'add_head_piece', result);
    if (result.ok) onMutated();
  };

  /**
   * Regenerate the same surface (an explicit new spend). The host's "Tweak it"
   * note is folded into the stored prompt — re-running the IDENTICAL prompt was
   * only ever a re-roll of the dice, never "make it warmer". startFrameGen /
   * startPieceGen store the revised prompt back onto the card, so successive
   * tweaks COMPOUND instead of each one starting from the original brief.
   */
  const regenerate = (event: A2uiActionEvent) => {
    const g = genState.current[event.surfaceId];
    if (!g) {
      // genState is a ref (not persisted) — after a refresh the prompt is gone,
      // so a restored card's Regenerate/Try-again would be a dead button (F1).
      dropSurfaceById(event.surfaceId);
      pushResult(event.context.kind === 'headpiece' ? 'add_head_piece' : 'generate_frame', {
        ok: false, code: 'not_found', retryable: false,
        summary: 'I lost the details for that one — tell me what to make and I’ll generate a fresh version.',
      });
      return;
    }
    // A stalled Meshy job: the card's button is "Keep waiting" — resume THAT
    // job. Never re-submit a paid generation from here.
    if (g.kind === 'headpiece' && g.jobId) {
      void resumePieceGen(event.surfaceId, g.prompt, g.jobId);
      return;
    }
    const feedback = String(event.context.feedback ?? '').trim();
    const prompt = feedback ? `${g.prompt}. Revision: ${feedback}` : g.prompt;
    if (g.kind === 'frame') void startFrameGen(event.surfaceId, prompt, g.lettering ?? null, g.provider ?? 'gemini');
    else void startPieceGen(event.surfaceId, prompt);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatItem[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    const wire: ChatMessage[] = next.map(({ role, content: c }) => ({ role, content: c }));
    const res = await askCopilot(wire, snapshot, {
      surface: mode === 'build' ? 'build' : 'platform',
      lastTurn: lastTurnRef.current,
    }); // never throws
    lastTurnRef.current = res.turnId !== null ? { turnId: res.turnId, dropped: res.dropped } : null;
    // `offline` marks a reply the built-in fallback wrote, not the model — it
    // reads exactly like a real answer otherwise, and a host who cannot tell
    // "the AI said no" from "the AI is unreachable" stops trusting both.
    setMessages((m) => [...m, {
      role: 'assistant', content: res.reply, offline: res.source === 'offline',
      ...(res.turnId !== null ? { turnId: res.turnId } : {}),
    }]);
    // The prose almost always claims the dropped proposals happened. Say so —
    // specifically, per reason, so the host knows what to change.
    const byReason = (...reasons: string[]) => res.droppedReasons.filter((d) => reasons.includes(d.reason));
    const ghosts = byReason('unknown_id');
    if (ghosts.length > 0) {
      pushResult(ghosts[0].tool, {
        ok: false, code: 'unknown_id', retryable: false,
        summary: 'I couldn’t match one of those to an existing challenge/experience — tell me the exact name and I’ll redo it.',
      });
    }
    const overCap = byReason('over_cap');
    if (overCap.length > 0) {
      pushResult(overCap[0].tool, { ok: false, code: 'invalid', retryable: false, summary: 'I can do three at a time — ask again for the rest.' });
    }
    const malformed = byReason('unknown_tool', 'invalid_args');
    if (malformed.length > 0) {
      pushResult(malformed[0].tool, {
        ok: false, code: 'invalid', retryable: false,
        summary: malformed.length === 1
          ? 'I couldn’t act on that one — tell me the exact challenge name and I’ll redo it.'
          : `I couldn’t act on ${malformed.length} of those — tell me the exact challenge names and I’ll redo them.`,
      });
    }
    for (const action of res.actions) {
      if (action.tool === 'get_stats' || action.tool === 'share_links' || action.tool === 'test_experience') {
        runReadOnly(action);
      } else {
        const sid = `prop_${++seqRef.current}`;
        addSurface(buildProposalSurface(action, sid, targetChallenge(action)), sid);
      }
    }
    setBusy(false);
  };

  const handleSurfaceAction = async (event: A2uiActionEvent) => {
    if (flash[event.surfaceId]) return; // card is mid success-flash — already handled
    if (event.name === 'cancel_action') {
      dropSurfaceById(event.surfaceId);
      dismissedGen.current.add(event.surfaceId); // keep a late gen continuation from re-opening it (F2)
      delete genState.current[event.surfaceId];
      askedGaps.current.delete(event.surfaceId);
      return;
    }
    if (event.name !== 'confirm_action' && event.name !== 'apply_generated'
      && event.name !== 'regenerate_generated' && event.name !== 'open_go_live_card') return;

    // Every tool here acts on the selected event; with none selected ctx().slug
    // is empty and any write hits the tenant RLS wall (403). Guard the whole
    // confirm path — including async generation, which runs before executeAction
    // — with one clear prompt to pick an event first.
    //
    // This guard sits ABOVE the apply/regenerate branches on purpose: they used
    // to return before reaching it, so on a snapshot-less panel "Try again" and
    // "Regenerate" were dead buttons — a tap, no card change, no message, and a
    // host who had just been charged for a generation with nothing to show.
    if (!snapshot) {
      dropSurfaceById(event.surfaceId);
      const guardTool = (event.context.proposal as { tool?: unknown } | undefined)?.tool;
      pushResult(typeof guardTool === 'string' ? guardTool : event.name, {
        ok: false, code: 'no_event', retryable: false,
        summary: 'Pick which event this is for first — select one of your events, then ask me again.',
      });
      return;
    }

    if (event.name === 'apply_generated') { await applyGenerated(event); return; }
    if (event.name === 'regenerate_generated') { regenerate(event); return; }
    // The booth-test card's Go-live button OPENS the confirm card instead of
    // publishing on the spot — the host reads what going live means first.
    if (event.name === 'open_go_live_card') { openProposal({ tool: 'go_live' }); return; }

    const proposal = (event.context.proposal ?? {}) as Record<string, unknown> & { tool?: string };
    const tool = proposal.tool;
    if (typeof tool !== 'string') return;

    // Does the card actually carry everything the action needs? The fields are
    // host-editable, and the generation tools below skip normalizeActions
    // entirely, so without this a cleared box became a flat "that didn't look
    // valid" and a two-word brief became a paid-for generic frame.
    //
    // A REQUIRED gap always stops us. A quality gap (a real but vague brief) is
    // asked once — press again and the host gets what they asked for. The card
    // stays mounted either way, because their typing is in it.
    const gaps = proposalGaps(tool, proposal);
    if (gaps.length > 0) {
      const spending = tool === 'generate_frame' || (tool === 'add_head_piece' && proposal.source === 'generate');
      const hard = requiredGaps(gaps);
      const alreadyAsked = askedGaps.current.has(event.surfaceId);
      if (hard.length > 0 || !alreadyAsked) {
        askedGaps.current.add(event.surfaceId);
        pushResult(tool, {
          ok: false, code: 'gap', retryable: true,
          summary: gapPrompt(hard.length > 0 ? hard : gaps, { spending, canProceed: hard.length === 0 }),
        });
        return;
      }
    }

    // Generation tools DON'T execute a mutation — they kick off async generation
    // IN PLACE (the same surface swaps proposal → working → preview), so the
    // charge point stays single and apply never re-generates.
    if (tool === 'generate_frame') {
      // The lettering fields are host-editable, so they go through the SAME
      // validator as model output. An empty/partial box → null = no lettering.
      // The provider pill is host-editable on the card, so it is coerced here
      // the same way the lettering box is — anything but 'higgsfield' means the
      // platform's own model, which is also the absent-field default.
      void startFrameGen(
        event.surfaceId,
        String(proposal.prompt ?? ''),
        normalizeLettering(proposal.lettering),
        proposal.provider === 'higgsfield' ? 'higgsfield' : 'gemini',
      );
      return;
    }
    if (tool === 'add_head_piece' && proposal.source === 'generate') {
      void startPieceGen(event.surfaceId, String(proposal.prompt ?? ''));
      return;
    }

    // Re-validate the (host-editable) proposal through the SAME gate as the
    // propose path before executing — the confirm card's data model is
    // two-way-bound and must not be trusted verbatim (defense in depth).
    const [validated] = normalizeActions([proposal], snapshot);
    if (!validated) {
      dropSurfaceById(event.surfaceId);
      pushResult(tool, {
        ok: false, code: 'invalid', retryable: false,
        summary: 'That didn’t look valid, so nothing changed — tell me again and I’ll redo it.',
      });
      return;
    }
    // The success flash used to fire here, BEFORE executeAction — so a failing
    // action still played its confirmation animation. Drop the card now, and
    // let the result message carry the outcome.
    dropSurfaceById(event.surfaceId);
    const result = await executeAction(validated, ctx());
    pushResult(validated.tool, result);
    if (result.ok && result.card) {
      const sid = `card_${++seqRef.current}`;
      addSurface(buildCardLinkSurface(result.card, sid), sid);
    }
    if (result.ok) onMutated();
    if (result.ok && result.handoff) runHandoff(result.handoff);
  };

  /** Handoff tools ran nothing server-side (executeAction returns `handoff`);
   *  the chat does the hand-off itself — a navigation or the support dialog. */
  const runHandoff = (handoff: NonNullable<ExecResult['handoff']>) => {
    if (!snapshot) return;
    if (handoff.kind === 'scene_director') {
      // /host/events/:id is the event UUID (EventStudio loads `.eq('id', id)`);
      // StudioShell opens the Director prefilled from `?scene=`.
      useCopilotStore.getState().close(); // the floating panel would hide the studio
      navigate(`/host/events/${snapshot.eventUuid}/studio?scene=${encodeURIComponent(handoff.brief)}`);
      return;
    }
    // 'host_rail' is an existing support_tickets.source value (CHECK-constrained);
    // the subject prefix is what marks the ticket as a copilot hand-off.
    openSupportDialog({
      source: 'host_rail',
      eventSlug: snapshot.slug,
      subject: `[Copilot handoff] ${handoff.summary.slice(0, 60)}`,
      body: `${handoff.summary}\n\n${transcriptTail(messages, 6)}`,
    });
  };

  const handleSurfaceData = (surfaceId: string, path: string, value: unknown) => {
    setSurfaces((s) => {
      const surf = s[surfaceId];
      if (!surf) return s;
      const model = setPath(surf.dataModel, path, value);
      const dataModel =
        model !== null && typeof model === 'object' && !Array.isArray(model)
          ? (model as Record<string, unknown>)
          : {};
      return { ...s, [surfaceId]: { ...surf, dataModel } };
    });
  };

  /** Thumbs on an assistant turn: optimistic mark, one request, quiet revert
   *  on failure (this chat has no toasts by design). The pair is disabled
   *  while in flight and once a verdict has landed. */
  const giveFeedback = async (turnId: number, value: 1 | -1) => {
    if (feedbackPending.has(turnId)) return;
    setFeedbackPending((s) => new Set(s).add(turnId));
    const mark = (fb: 1 | -1 | undefined) =>
      setMessages((m) => m.map((it) => (it.turnId === turnId ? { ...it, feedback: fb } : it)));
    mark(value);
    const ok = await sendFeedback(turnId, value); // never throws
    if (!ok) mark(undefined);
    setFeedbackPending((s) => { const n = new Set(s); n.delete(turnId); return n; });
  };

  /** Inject a client-built proposal card (no AI round-trip) — the build-mode
   *  chips use this so the whole flow works even before the edge-fn redeploy. */
  const openProposal = (action: CopilotAction) => {
    const sid = `prop_${++seqRef.current}`;
    addSurface(buildProposalSurface(action, sid, targetChallenge(action)), sid);
  };

  /** Quick-action chips: the experience-building set in build mode, else the
   *  original platform-copilot set. */
  const quickChips = (): { label: string; run: () => void }[] => {
    if (!snapshot) return [];
    if (mode === 'build') {
      const chips: { label: string; run: () => void }[] = [
        { label: '🖼 Frame', run: () => openProposal({ tool: 'generate_frame', proposal: { prompt: `An elegant frame for "${snapshot.name}" — refined ornament hugging the edges, centre fully clear` } }) },
        { label: '🎨 Filter', run: () => openProposal({ tool: 'set_filter', proposal: { shaderId: DEFAULT_FILTER_ID } }) },
        { label: '👑 3D prop', run: () => openProposal({ tool: 'add_head_piece', proposal: { source: 'builtin', pieceId: DEFAULT_PIECE_ID } }) },
        { label: '🏆 Challenge', run: () => openProposal({ tool: 'add_challenge', proposal: { title: 'New photo mission', emoji: '⭐', points: 10, description: '' } }) },
        { label: '🎁 Pack', run: () => send('Design a themed pack of 5 photo challenges that fit this event.') },
        { label: '📱 Test', run: () => runReadOnly({ tool: 'test_experience' }) },
        { label: '📋 Checklist', run: showChecklist },
        { label: '✨ Recommend', run: () => send('Recommend a frame and a filter that fit this event, and propose them.') },
      ];
      if (snapshot.status !== 'live') {
        chips.splice(6, 0, { label: '🚀 Go live', run: () => openProposal({ tool: 'go_live' }) });
      }
      return chips;
    }
    return [
      { label: '📊 Stats', run: () => runReadOnly({ tool: 'get_stats' }) },
      { label: '🔗 Share links', run: () => runReadOnly({ tool: 'share_links' }) },
      { label: '🏆 New challenge', run: () => openProposal({ tool: 'add_challenge', proposal: { title: 'New photo mission', emoji: '⭐', points: 10, description: '' } }) },
      { label: '💌 New card', run: () => openProposal({ tool: 'create_card', proposal: { cardTitle: `Memories for ${snapshot.name}`, recipientName: '', cardTemplate: 'storybook', deadline: '' } }) },
      // AI round-trip on purpose: the model designs a THEMED set from the live
      // event snapshot, then it arrives as one confirm card.
      { label: '🎁 Challenge pack', run: () => send('Design a themed pack of 5 photo challenges that fit this event.') },
    ];
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 gap-2.5"
      /* Mobile soft keyboard: this chat is also mounted INLINE (on
         /host/concierge and /host/new's build phase), where nothing else lifts
         it — so the input row sat under the keyboard the moment it was tapped.
         OFF inside the floating panel, which already raises its own bottom edge
         by the same amount: doing both would strand the input a whole keyboard
         above the keyboard. Desktop reads 0 either way. */
      style={liftAboveKeyboard && kbInset > 0 ? { paddingBottom: `calc(1rem + ${kbInset}px)` } : undefined}
    >
      <div ref={scrollRef} onScroll={handleListScroll} className="flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white/[0.02] border border-white/10 p-3.5 flex flex-col gap-2.5">
        <div className="max-w-[90%] self-start rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-brand-fg/90">
          {greeting ?? GREETING}
        </div>
        {/* First-visit helper — example prompts that prefill the input so a new
            host can read, tweak, then send. Gone once the thread has messages. */}
        {messages.length === 0 && (
          <div className="self-start flex flex-col items-start gap-1.5 px-0.5">
            <p className="font-sans text-[10px] text-brand-muted/50">Try one of these:</p>
            {EXAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => { setInput(p); inputRef.current?.focus(); }}
                className="rounded-full border border-[color:var(--color-accent)]/25 bg-[color:var(--color-accent)]/[0.07] px-3 py-1.5 font-sans text-[11px] text-brand-fg/85 hover:bg-[color:var(--color-accent)]/15 transition-colors text-left"
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => {
          // Restored messages render in place; only newly added ones animate in.
          const entrance = reduced || i < mountCountRef.current ? false : { opacity: 0, y: 10 };
          if (m.kind === 'tool_result') {
            return (
              <motion.div
                key={i}
                initial={entrance}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className={`self-center rounded-full px-3 py-1 font-mono text-[10px] ${
                  m.ok === false
                    ? 'bg-amber-400/10 border border-amber-300/30 text-amber-200/90'
                    : 'bg-white/[0.04] border border-white/10 text-brand-muted/70'
                }`}
              >
                {/* Every tool result used to be prefixed "✓ " regardless of
                    whether it worked, so a failed action read as a success.
                    The machine prefix (tool=… code=…) is for the model only. */}
                {(m.ok === false ? '✕ ' : m.ok === true ? '✓ ' : '') + pillText(m.content)}
              </motion.div>
            );
          }
          if (m.role === 'user') {
            return (
              <motion.div
                key={i}
                initial={entrance}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="max-w-[90%] self-end rounded-2xl rounded-tr-md bg-[color:var(--color-accent)]/15 border border-[color:var(--color-accent)]/30 px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-brand-fg"
                style={{ boxShadow: '0 2px 6px -2px rgba(0,0,0,0.5), 0 10px 26px -18px rgba(var(--accent-rgb),0.8), inset 0 1px 0 rgba(255,255,255,0.18)' }}
              >
                {m.content}
              </motion.div>
            );
          }
          // Recomputed on every render (the picker writes straight into the
          // surface's data model), so flipping provider re-prices the caption.
          const costNote = m.surfaceId ? costNoteFor(surfaces[m.surfaceId]) : null;
          return (
            <motion.div
              key={i}
              initial={entrance}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="group max-w-[92%] self-start flex flex-col gap-2"
            >
              {m.content && (
                /* An offline reply is the built-in fallback, not the assistant
                   thinking — amber says "this is a service notice", so a host
                   never mistakes "I can't reach the AI" for a considered no. */
                <div
                  className={
                    m.offline
                      ? 'rounded-2xl rounded-tl-md border border-amber-300/25 bg-amber-400/[0.07] px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-amber-100/90'
                      : 'liquid-glass-inset rounded-2xl rounded-tl-md px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-brand-fg/90'
                  }
                >
                  {m.offline && (
                    <span className="block font-label uppercase tracking-luxe text-[8.5px] text-amber-300/80 mb-1">
                      Offline · built-in guide
                    </span>
                  )}
                  {m.content}
                </div>
              )}
              {/* Thumbs — only on a real model reply the server recorded
                  (turnId). Quiet: on pointer devices it appears on hover/focus
                  of the bubble; on touch it is always visible. A landed verdict
                  stays visible either way. */}
              {m.content && m.turnId !== undefined && !m.offline && (
                <div
                  className={`flex items-center gap-0.5 -mt-1 transition-opacity motion-reduce:transition-none ${
                    m.feedback === undefined
                      ? 'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100'
                      : ''
                  }`}
                >
                  {([[1, 'Helpful', ThumbsUp], [-1, 'Not helpful', ThumbsDown]] as const).map(([value, label, Icon]) => (
                    <button
                      key={label}
                      type="button"
                      aria-label={label}
                      aria-pressed={m.feedback === value}
                      disabled={m.feedback !== undefined || feedbackPending.has(m.turnId as number)}
                      onClick={() => { haptic('tap'); void giveFeedback(m.turnId as number, value); }}
                      className={`pressable liquid-glass-inset min-w-11 min-h-11 rounded-full flex items-center justify-center transition-colors disabled:cursor-default ${
                        m.feedback === value
                          ? 'text-[color:var(--color-accent)]'
                          : 'text-brand-muted/50 hover:text-brand-fg disabled:opacity-40'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              )}
              {costNote && (
                <p className="font-sans text-[10px] text-brand-muted/55 px-1">
                  {costNote}
                  {balance !== null && (
                    <> · you have {balance} credit{balance === 1 ? '' : 's'}</>
                  )}
                </p>
              )}
              {m.surfaceId && surfaces[m.surfaceId] && (
                <div className={`relative ${flash[m.surfaceId] ? 'pointer-events-none' : ''}`}>
                  <A2uiSurface
                    surface={surfaces[m.surfaceId]}
                    onAction={handleSurfaceAction}
                    onDataChange={handleSurfaceData}
                    busy={busy}
                  />
                  {/* Success flash — a brief check over the card when its action
                      applies, so it reads as "done", not "gone". */}
                  <AnimatePresence>
                    {flash[m.surfaceId] && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduced ? 0 : 0.18 }}
                        className="absolute inset-0 z-10 rounded-2xl bg-[color:var(--color-brand-bg)]/60 backdrop-blur-[2px] flex items-center justify-center"
                      >
                        <motion.span
                          initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                          className="w-9 h-9 rounded-full bg-[color:var(--color-accent)]/20 ring-1 ring-[color:var(--color-accent)]/40 flex items-center justify-center"
                        >
                          <Check className="w-5 h-5 text-[color:var(--color-accent)]" />
                        </motion.span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          );
        })}
        {busy && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="liquid-glass-inset self-start flex items-center gap-2 rounded-2xl rounded-tl-md px-3.5 py-3"
          >
            {/* Three dots breathing in sequence reads as "composing" in a way a
                spinner never does. Static under reduced motion. */}
            <span className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="block h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent)]"
                  animate={reduced ? { opacity: 0.6 } : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                  transition={reduced ? { duration: 0 } : { duration: 1.1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                />
              ))}
            </span>
            <span className="font-sans text-[11px] text-brand-muted/60">Thinking…</span>
          </motion.div>
        )}
      </div>

      {/* Quick actions — launch widgets instantly, no AI round-trip. */}
      {snapshot && (
        <div className="shrink-0 flex flex-wrap gap-1.5">
          {quickChips().map((q) => (
            <button
              key={q.label}
              onClick={() => { haptic('tap'); q.run(); }}
              disabled={busy}
              className="pressable liquid-glass-inset rounded-full px-3.5 min-h-11 font-sans text-[10.5px] text-brand-muted/80 hover:text-brand-fg transition-colors disabled:opacity-40"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      <div className="shrink-0 flex items-end gap-2">
        {/* Multiline-friendly: Enter sends, Shift+Enter adds a line; the field
            grows to ~4 lines then scrolls (auto-grow effect above). */}
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              // The Enter key is the "enter button" — it gets the same
              // acknowledgement as tapping send.
              if (input.trim() && !busy) haptic('tap');
              send(input);
            }
          }}
          maxLength={2000}
          placeholder={snapshot ? `Ask about “${snapshot.name}” or tell me what to change…` : 'Ask how Beamwall works…'}
          className="liquid-glass-inset flex-1 resize-none hide-scrollbar rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug text-brand-fg placeholder:text-brand-muted/40 outline-none transition-shadow focus:shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-6px_rgba(var(--accent-rgb),0.9)]"
        />
        <button
          onClick={() => { if (input.trim() && !busy) haptic('tap'); send(input); }}
          disabled={!input.trim() || busy}
          aria-label={busy ? 'Waiting for reply' : 'Send'}
          className="pressable shrink-0 w-11 h-11 rounded-full bg-foil glow-accent flex items-center justify-center text-[color:var(--on-accent)] disabled:opacity-40"
          style={{ boxShadow: '0 4px 16px -6px rgba(var(--accent-rgb),0.9), inset 0 1px 0 rgba(255,255,255,0.4)' }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
