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
  askCopilot, executeAction, type CopilotAction, type CopilotCtx,
} from '../../lib/copilot';
import {
  buildCardLinkSurface, buildLinksSurface, buildProposalSurface, buildStatsSurface,
} from '../../lib/copilotSurfaces';
import {
  applySurfaceMessages, setPath,
  type A2uiActionEvent, type A2uiMessage, type SurfaceState,
} from '../../lib/a2ui';
import type { ChatMessage } from '../../lib/eventDesigner';
import type { EventSnapshot } from '../../lib/eventSnapshot';
import A2uiSurface from '../a2ui/A2uiSurface';

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
}: {
  snapshot: EventSnapshot | null;
  onMutated: () => void;
}) {
  const storeKey = snapshot?.eventUuid ?? 'platform';
  const [messages, setMessages] = useState<ChatItem[]>(() => loadSaved(storeKey).chat);
  const [surfaces, setSurfaces] = useState<Record<string, SurfaceState>>(() => loadSaved(storeKey).surfaces);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    }
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
      if (action.tool === 'get_stats' || action.tool === 'share_links') {
        runReadOnly(action);
      } else {
        const sid = `prop_${++seqRef.current}`;
        addSurface(buildProposalSurface(action, sid), sid);
      }
    }
    setBusy(false);
  };

  const handleSurfaceAction = async (event: A2uiActionEvent) => {
    const dropSurface = () =>
      setSurfaces((s) => applySurfaceMessages(s, [{ deleteSurface: { surfaceId: event.surfaceId } }]));

    if (event.name === 'cancel_action') {
      dropSurface();
      return;
    }
    if (event.name !== 'confirm_action') return;

    const proposal = (event.context.proposal ?? {}) as Record<string, unknown> & { tool?: string };
    const tool = proposal.tool;
    if (typeof tool !== 'string') return;
    const action = { tool, proposal } as unknown as CopilotAction;

    dropSurface();
    const result = await executeAction(action, ctx());
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

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 pt-3 gap-2.5">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white/[0.02] border border-white/10 p-3.5 flex flex-col gap-2.5">
        <div className="max-w-[90%] self-start rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5 font-sans text-[12.5px] leading-relaxed text-brand-fg/90">
          {GREETING}
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
          {([
            { label: '📊 Stats', run: () => runReadOnly({ tool: 'get_stats' }) },
            { label: '🔗 Share links', run: () => runReadOnly({ tool: 'share_links' }) },
            {
              label: '🏆 New challenge',
              run: () => {
                const sid = `prop_${++seqRef.current}`;
                addSurface(buildProposalSurface({
                  tool: 'add_challenge',
                  proposal: { title: 'New photo mission', emoji: '⭐', points: 10, description: '' },
                }, sid), sid);
              },
            },
            {
              label: '💌 New card',
              run: () => {
                const sid = `prop_${++seqRef.current}`;
                addSurface(buildProposalSurface({
                  tool: 'create_card',
                  proposal: { cardTitle: `Memories for ${snapshot.name}`, recipientName: '', cardTemplate: 'storybook', deadline: '' },
                }, sid), sid);
              },
            },
            {
              // AI round-trip on purpose: the model designs a THEMED set from
              // the live event snapshot, then it arrives as one confirm card.
              label: '🎁 Challenge pack',
              run: () => send('Design a themed pack of 5 photo challenges that fit this event.'),
            },
          ] as { label: string; run: () => void }[]).map((q) => (
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
