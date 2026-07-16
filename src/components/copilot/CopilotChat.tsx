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
import { Loader2, Send } from 'lucide-react';
import {
  askCopilot, executeAction, normalizeActions, applyGeneratedFrame, applyGeneratedPiece,
  type CopilotAction, type CopilotCtx,
} from '../../lib/copilot';
import {
  buildCardLinkSurface, buildLinksSurface, buildProposalSurface, buildStatsSurface,
  buildGeneratingSurface, buildFramePreviewSurface, buildHeadPiecePreviewSurface,
  buildGenErrorSurface, buildBoothTestSurface, buildChecklistSurface,
} from '../../lib/copilotSurfaces';
import {
  applySurfaceMessages, setPath,
  type A2uiActionEvent, type A2uiMessage, type SurfaceState,
} from '../../lib/a2ui';
import {
  generateImage, generate3d, pollJob, resolveEventUuid, aiErrorMessage, type AiErrorCode,
} from '../../lib/ai';
import { processGeneratedFrame } from '../../lib/studio/frameProcessing';
import { measureGlbFitScale } from '../../lib/studio/glbThumb';
import { boothUrl } from '../../lib/copilotBooth';
import { FILTER_SHADERS } from '../../lib/shaders';
import { HEAD_PIECES } from '../../lib/headPieces';
import type { ChatMessage } from '../../lib/eventDesigner';
import type { EventSnapshot } from '../../lib/eventSnapshot';
import type { Experience } from '../../types';
import A2uiSurface from '../a2ui/A2uiSurface';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const POLL_MS = 5000;
const MAX_POLLS = 60; // ~5 minutes — matches the studio Director's Meshy poll
const DEFAULT_FILTER_ID = FILTER_SHADERS.find((s) => s.id !== 'none')?.id ?? 'none';
const DEFAULT_PIECE_ID = HEAD_PIECES[0]?.id ?? '';

/** A retry is pointless (and unfair) for these hard, non-transient failures. */
function retryableGenError(code: AiErrorCode): boolean {
  return code !== 'insufficient_credits' && code !== 'upgrade_required' && code !== 'unauthorized' && code !== 'forbidden';
}

interface ChatItem extends ChatMessage {
  surfaceId?: string;
  kind?: 'tool_result';
}

const STORE_KEY = 'beamwall:copilot:v1';

const GREETING =
  'Ask me anything — how Beamwall works, what’s in your event, or tell me what to change ' +
  '(“add a scavenger-hunt challenge worth 20 points”, “make a card for Grandma”).';

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
}: {
  snapshot: EventSnapshot | null;
  onMutated: () => void;
  /** Opening bubble override (the build phase greets differently). */
  greeting?: string;
  /** 'build' swaps the quick-action chips to the experience-building set. */
  mode?: 'default' | 'build';
}) {
  const storeKey = snapshot?.eventUuid ?? 'platform';
  const [messages, setMessages] = useState<ChatItem[]>(() => loadSaved(storeKey).chat);
  const [surfaces, setSurfaces] = useState<Record<string, SurfaceState>>(() => loadSaved(storeKey).surfaces);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Per-surface generation state (async frame/3D). `runningGen` is a synchronous
  // double-fire latch so a fast double-click on Generate can never double-charge;
  // `genState` holds the prompt (for regenerate) + the generated experience (for
  // apply). Each generation card is independent — no shared plan/epoch needed.
  const genState = useRef<Record<string, { kind: 'frame' | 'headpiece'; prompt: string; experience?: Experience }>>({});
  const runningGen = useRef<Set<string>>(new Set());
  // Surfaces the host dismissed mid-generation — a late async continuation must
  // NOT re-materialise a card the host already closed (F2).
  const dismissedGen = useRef<Set<string>>(new Set());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

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

  /** Swap the CONTENT of an existing surface in place (the chat message that
   *  references it stays put) — used to drive a generation card through its
   *  proposal → working → preview → error phases. */
  const replaceSurface = (sid: string, msgs: A2uiMessage[]) => setSurfaces((s) => applySurfaceMessages(s, msgs));
  const dropSurfaceById = (sid: string) => setSurfaces((s) => applySurfaceMessages(s, [{ deleteSurface: { surfaceId: sid } }]));
  /** Guarded phase swap for a generation card — a no-op once the host dismissed it. */
  const placeGen = (sid: string, msgs: A2uiMessage[]) => { if (!dismissedGen.current.has(sid)) replaceSurface(sid, msgs); };

  /** Read-only tools run instantly from the snapshot — no confirm, no wire. */
  const runReadOnly = (action: CopilotAction) => {
    if (!snapshot) return;
    const sid = `ro_${++seqRef.current}`;
    if (action.tool === 'get_stats') {
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

  const showGenError = (sid: string, kind: 'frame' | 'headpiece', message: string, retryable: boolean) =>
    placeGen(sid, buildGenErrorSurface(sid, message, { kind, retryable }));

  /** FRAME: generate (greenScreen) → chroma-key → preview. Charge happens once
   *  in generateImage (server-metered, first 3 free); apply never re-generates. */
  const startFrameGen = async (sid: string, prompt: string) => {
    if (!snapshot || runningGen.current.has(sid)) return;
    runningGen.current.add(sid);
    dismissedGen.current.delete(sid);
    genState.current[sid] = { kind: 'frame', prompt };
    placeGen(sid, buildGeneratingSurface(sid, 'Designing your frame…'));
    try {
      const uuid = await resolveEventUuid(snapshot.slug, snapshot.eventUuid);
      if (!uuid) { showGenError(sid, 'frame', aiErrorMessage('event_not_found'), false); return; }
      const res = await generateImage(uuid, { prompt, kind: 'border', transparentBackground: false, greenScreen: true });
      if (res.error || !res.data?.experience) {
        const code = (res.error ?? 'internal') as AiErrorCode;
        showGenError(sid, 'frame', aiErrorMessage(code), retryableGenError(code));
        return;
      }
      const { experience, keyed } = await processGeneratedFrame(res.data.experience, snapshot.slug);
      genState.current[sid] = { kind: 'frame', prompt, experience };
      if (!keyed) {
        showGenError(sid, 'frame', 'Generated, but the transparent cutout didn’t come through cleanly — Regenerate for a fresh version.', true);
        return;
      }
      placeGen(sid, buildFramePreviewSurface(sid, { experienceId: experience.id, assetUrl: experience.asset_url ?? '' }));
    } catch (e) {
      console.error('[copilot] startFrameGen', e);
      showGenError(sid, 'frame', 'Frame generation failed — try again.', true);
    } finally {
      runningGen.current.delete(sid);
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
      const concept = await generateImage(uuid, {
        prompt: `${prompt} — a single centered object, isolated on a plain neutral studio background, product shot, no frame, no border, no text`,
        kind: '2d_filter',
      });
      if (concept.error || !concept.data?.experience?.asset_url) {
        const code = (concept.error ?? 'internal') as AiErrorCode;
        showGenError(sid, 'headpiece', aiErrorMessage(code), retryableGenError(code));
        return;
      }
      const g = await generate3d(uuid, { mode: 'image', imageUrl: concept.data.experience.asset_url, prompt });
      if (g.error || !g.data?.job) {
        const code = (g.error ?? 'internal') as AiErrorCode;
        showGenError(sid, 'headpiece', aiErrorMessage(code), retryableGenError(code));
        return;
      }
      let experience: Experience | undefined;
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS);
        const p = await pollJob(g.data.job.id);
        const job = p.data?.job;
        if (job?.status === 'succeeded') { experience = p.data?.experience; break; }
        if (job?.status === 'failed' || job?.status === 'refunded') {
          showGenError(sid, 'headpiece', job.error ? `Generation failed — credits refunded. (${job.error})` : 'Generation failed — credits refunded.', true);
          return;
        }
      }
      if (!experience) {
        // Client-side poll timeout — the Meshy job usually still finishes
        // server-side, so DON'T offer a retry (it would re-spend ~11 credits on
        // a fresh job); point the host to the Library where it'll land (F5).
        showGenError(sid, 'headpiece', 'Your 3D model is taking longer than usual — it will finish and appear in your studio Library shortly.', false);
        return;
      }
      genState.current[sid] = { kind: 'headpiece', prompt, experience };
      placeGen(sid, buildHeadPiecePreviewSurface(sid, {
        experienceId: experience.id,
        thumbUrl: experience.thumbnail_url ?? null,
        label: prompt,
      }));
    } catch (e) {
      console.error('[copilot] startPieceGen', e);
      showGenError(sid, 'headpiece', '3D generation failed — try again.', true);
    } finally {
      runningGen.current.delete(sid);
    }
  };

  /** Approve a generated asset: publish + pin as booth default (NO regen). */
  const applyGenerated = async (event: A2uiActionEvent) => {
    const sid = event.surfaceId;
    const g = genState.current[sid];
    const kind = event.context.kind === 'headpiece' ? 'headpiece' : 'frame';
    const experienceId = String(event.context.experienceId ?? g?.experience?.id ?? '');
    dropSurfaceById(sid);
    delete genState.current[sid];
    if (!experienceId) {
      setMessages((m) => [...m, { role: 'user', kind: 'tool_result', content: '[tool_result] The generated asset was lost — please generate it again.' }]);
      return;
    }
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
    setMessages((m) => [...m, { role: 'user', kind: 'tool_result', content: `[tool_result] ${result.summary}` }]);
    if (result.ok) onMutated();
  };

  /** Regenerate the same surface with its stored prompt (an explicit new spend). */
  const regenerate = (event: A2uiActionEvent) => {
    const g = genState.current[event.surfaceId];
    if (!g) {
      // genState is a ref (not persisted) — after a refresh the prompt is gone,
      // so a restored card's Regenerate/Try-again would be a dead button (F1).
      dropSurfaceById(event.surfaceId);
      setMessages((m) => [...m, { role: 'user', kind: 'tool_result', content: '[tool_result] I lost the details for that one — tell me what to make and I’ll generate a fresh version.' }]);
      return;
    }
    if (g.kind === 'frame') void startFrameGen(event.surfaceId, g.prompt);
    else void startPieceGen(event.surfaceId, g.prompt);
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatItem[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    const wire: ChatMessage[] = next.map(({ role, content: c }) => ({ role, content: c }));
    const res = await askCopilot(wire, snapshot); // never throws
    setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
    for (const action of res.actions) {
      if (action.tool === 'get_stats' || action.tool === 'share_links' || action.tool === 'test_experience') {
        runReadOnly(action);
      } else {
        const sid = `prop_${++seqRef.current}`;
        addSurface(buildProposalSurface(action, sid), sid);
      }
    }
    setBusy(false);
  };

  const handleSurfaceAction = async (event: A2uiActionEvent) => {
    if (event.name === 'cancel_action') {
      dropSurfaceById(event.surfaceId);
      dismissedGen.current.add(event.surfaceId); // keep a late gen continuation from re-opening it (F2)
      delete genState.current[event.surfaceId];
      return;
    }
    if (event.name === 'apply_generated') { await applyGenerated(event); return; }
    if (event.name === 'regenerate_generated') { regenerate(event); return; }
    if (event.name !== 'confirm_action') return;

    const proposal = (event.context.proposal ?? {}) as Record<string, unknown> & { tool?: string };
    const tool = proposal.tool;
    if (typeof tool !== 'string') return;

    // Every tool here acts on the selected event; with none selected ctx().slug
    // is empty and any write hits the tenant RLS wall (403). Guard the whole
    // confirm path — including async generation, which runs before executeAction
    // — with one clear prompt to pick an event first.
    if (!snapshot) {
      dropSurfaceById(event.surfaceId);
      setMessages((m) => [...m, { role: 'user', kind: 'tool_result', content: '[tool_result] Pick an event in the panel above first, then I’ll set that up for you.' }]);
      return;
    }

    // Generation tools DON'T execute a mutation — they kick off async generation
    // IN PLACE (the same surface swaps proposal → working → preview), so the
    // charge point stays single and apply never re-generates.
    if (tool === 'generate_frame') { void startFrameGen(event.surfaceId, String(proposal.prompt ?? '')); return; }
    if (tool === 'add_head_piece' && proposal.source === 'generate') {
      void startPieceGen(event.surfaceId, String(proposal.prompt ?? ''));
      return;
    }

    // Re-validate the (host-editable) proposal through the SAME gate as the
    // propose path before executing — the confirm card's data model is
    // two-way-bound and must not be trusted verbatim (defense in depth).
    const [validated] = normalizeActions([proposal], snapshot);
    dropSurfaceById(event.surfaceId);
    if (!validated) {
      setMessages((m) => [...m, { role: 'user', kind: 'tool_result', content: '[tool_result] That didn’t look valid, so nothing changed — tell me again and I’ll redo it.' }]);
      return;
    }
    const result = await executeAction(validated, ctx());
    setMessages((m) => [...m, { role: 'user', kind: 'tool_result', content: `[tool_result] ${result.summary}` }]);
    if (result.ok && result.card) {
      const sid = `card_${++seqRef.current}`;
      addSurface(buildCardLinkSurface(result.card, sid), sid);
    }
    if (result.ok) onMutated();
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

  /** Inject a client-built proposal card (no AI round-trip) — the build-mode
   *  chips use this so the whole flow works even before the edge-fn redeploy. */
  const openProposal = (action: CopilotAction) => {
    const sid = `prop_${++seqRef.current}`;
    addSurface(buildProposalSurface(action, sid), sid);
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
    <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 gap-2.5">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white/[0.02] border border-white/10 p-3.5 flex flex-col gap-2.5">
        <div className="max-w-[90%] self-start rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-brand-fg/90">
          {greeting ?? GREETING}
        </div>
        {messages.map((m, i) => {
          if (m.kind === 'tool_result') {
            return (
              <div key={i} className="self-center rounded-full bg-white/[0.04] border border-white/10 px-3 py-1 font-mono text-[10px] text-brand-muted/70">
                {m.content.replace(/^\[tool_result\]\s*/, '✓ ')}
              </div>
            );
          }
          if (m.role === 'user') {
            return (
              <div key={i} className="max-w-[90%] self-end rounded-2xl rounded-tr-md bg-[color:var(--color-accent)]/15 border border-[color:var(--color-accent)]/30 px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-brand-fg">
                {m.content}
              </div>
            );
          }
          return (
            <div key={i} className="max-w-[92%] self-start flex flex-col gap-2">
              {m.content && (
                <div className="rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-brand-fg/90">
                  {m.content}
                </div>
              )}
              {m.surfaceId && surfaces[m.surfaceId] && (
                <A2uiSurface
                  surface={surfaces[m.surfaceId]}
                  onAction={handleSurfaceAction}
                  onDataChange={handleSurfaceData}
                  busy={busy}
                />
              )}
            </div>
          );
        })}
        {busy && (
          <div className="self-start flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-muted/60" />
            <span className="font-sans text-[11px] text-brand-muted/60">Thinking…</span>
          </div>
        )}
      </div>

      {/* Quick actions — launch widgets instantly, no AI round-trip. */}
      {snapshot && (
        <div className="shrink-0 flex flex-wrap gap-1.5">
          {quickChips().map((q) => (
            <button
              key={q.label}
              onClick={q.run}
              disabled={busy}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-sans text-[10.5px] text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.07] transition-colors disabled:opacity-40"
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      <div className="shrink-0 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
          maxLength={2000}
          placeholder={snapshot ? `Ask about “${snapshot.name}” or tell me what to change…` : 'Ask how Beamwall works…'}
          className="flex-1 rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-2.5 text-[13px] text-brand-fg placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || busy}
          aria-label="Send"
          className="shrink-0 w-10 h-10 rounded-full bg-foil glow-accent flex items-center justify-center text-white transition active:scale-95 disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
