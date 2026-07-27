/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/support — the customer's side of the desk.
 *
 * Two panes at md+: the thread list, and the conversation. Below md the list
 * collapses and the open thread takes the screen, because a phone cannot show
 * both and the conversation is what someone came here for.
 *
 * A host sees tickets for their whole org — including ones a GUEST filed
 * against one of their events, which is the routing the platform owner chose
 * (023 stamps org_id from the event so the host can act on it without waiting
 * for us). Internal operator notes are excluded by the RLS policy in 023 and
 * again by the query in support.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, Plus, Send, Loader2 } from 'lucide-react';
import StatusPill from '../../components/ui/StatusPill';
import LoadError from '../../components/ui/LoadError';
import { usePageTitle } from '../../lib/usePageTitle';
import { listState } from '../../lib/listState';
import { useSupportStore } from '../../lib/supportStore';
import { haptic } from '../../lib/haptics';
import { categoryDef, unreadForCustomer } from '../../lib/supportModel';
import {
  fetchMyTicketsResult, fetchTicketResult, replyToTicket, markTicketRead,
  type SupportTicket, type SupportMessage,
} from '../../lib/support';

function when(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function HostSupport() {
  usePageTitle('Support — Beamwall');
  const [params, setParams] = useSearchParams();
  const openDialog = useSupportStore((s) => s.open);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const selectedId = params.get('t');
  const [thread, setThread] = useState<{ ticket: SupportTicket | null; messages: SupportMessage[] }>({
    ticket: null, messages: [],
  });
  const [threadFailed, setThreadFailed] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetchMyTicketsResult();
    setTickets(res.data);
    setFailed(res.failed);
    setLoaded(true);
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    setThreadFailed(false);
    const res = await fetchTicketResult(id);
    setThread({ ticket: res.ticket, messages: res.messages });
    setThreadFailed(res.failed);
    setThreadLoading(false);
    // Opening the thread IS reading it.
    if (!res.failed && res.ticket !== null) {
      markTicketRead(id);
      setTickets((list) => list.map((t) =>
        t.id === id ? { ...t, customer_unread: false, customer_last_read_at: new Date().toISOString() } : t));
    }
  }, []);

  useEffect(() => {
    if (selectedId === null) { setThread({ ticket: null, messages: [] }); return; }
    void loadThread(selectedId);
  }, [selectedId, loadThread]);

  const select = (id: string | null) => {
    haptic('tap');
    if (id === null) { params.delete('t'); } else { params.set('t', id); }
    setParams(params, { replace: true });
  };

  async function send() {
    const text = reply.trim();
    if (text === '' || selectedId === null || sending) return;
    setSending(true);
    setReplyError(null);
    const { error } = await replyToTicket(selectedId, text);
    setSending(false);
    if (error !== null) {
      setReplyError(
        error === 'network'
          ? "That didn't send — check your connection and try again."
          : "That didn't send. Please try again, or email dapo@rethinkreality.ai.",
      );
      return;
    }
    setReply('');
    await loadThread(selectedId);
    await loadList();
  }

  const state = listState({ count: tickets.length, loaded, failed });

  return (
    <div className="min-h-full app-bg px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className={selectedId !== null ? 'hidden md:block' : ''}>
            <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Support</h1>
            <p className="font-sans text-sm text-brand-muted/60 mt-1">
              Every report you've sent us, and what we said back.
            </p>
          </div>
          {selectedId !== null && (
            <button
              onClick={() => select(null)}
              className="pressable md:hidden inline-flex items-center gap-2 rounded-xl px-3 min-h-11 bg-white/[0.04] text-brand-muted/70 font-label uppercase tracking-luxe text-[10px]"
            >
              <ArrowLeft className="w-4 h-4" /> All requests
            </button>
          )}
          <button
            onClick={() => { haptic('tap'); openDialog({ source: 'host_rail' }); }}
            className="pressable shrink-0 inline-flex items-center gap-2 rounded-xl px-4 min-h-11 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px]"
          >
            <Plus className="w-4 h-4" /> New request
          </button>
        </header>

        <div className="grid md:grid-cols-[320px_1fr] gap-4">
          {/* ── List ── */}
          <div className={`space-y-2 ${selectedId !== null ? 'hidden md:block' : ''}`}>
            {state === 'loading' && (
              <div className="liquid-glass rounded-2xl p-8 flex justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
              </div>
            )}
            {state === 'failed' && (
              <LoadError what="your requests" code="" onRetry={() => void loadList()} />
            )}
            {state === 'empty' && (
              <div className="liquid-glass rounded-2xl p-8 text-center">
                <LifeBuoy className="w-7 h-7 mx-auto text-brand-muted/30 mb-3" />
                <p className="font-sans text-sm text-brand-muted/60 leading-relaxed">
                  Nothing here — which is the good outcome. If something breaks, tell us
                  and it'll show up here.
                </p>
              </div>
            )}
            {state === 'ready' && tickets.map((t) => {
              const active = t.id === selectedId;
              const unread = unreadForCustomer(t);
              return (
                <button
                  key={t.id}
                  onClick={() => select(t.id)}
                  className={`pressable w-full text-left rounded-2xl p-3.5 border transition-colors ${
                    active
                      ? 'bg-white/[0.08] border-[color:var(--color-accent)]/40'
                      : 'liquid-glass border-transparent hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <StatusPill status={t.status} />
                    {unread && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)]" aria-label="Unread reply" />
                    )}
                    <span className="ml-auto font-sans text-[10px] text-brand-muted/40">{t.public_ref}</span>
                  </div>
                  <p className={`font-sans text-sm truncate ${unread ? 'text-brand-fg font-medium' : 'text-brand-fg/80'}`}>
                    {t.subject}
                  </p>
                  <p className="font-sans text-[11px] text-brand-muted/50 mt-0.5">
                    {categoryDef(t.category).label} · {when(t.last_message_at)}
                  </p>
                </button>
              );
            })}
          </div>

          {/* ── Thread ── */}
          <div className={selectedId === null ? 'hidden md:block' : ''}>
            {selectedId === null ? (
              <div className="liquid-glass rounded-2xl p-10 text-center h-full flex flex-col items-center justify-center">
                <p className="font-sans text-sm text-brand-muted/50">
                  Pick a request to read the conversation.
                </p>
              </div>
            ) : threadFailed ? (
              <LoadError what="this conversation" code="" onRetry={() => void loadThread(selectedId)} />
            ) : threadLoading && thread.ticket === null ? (
              <div className="liquid-glass rounded-2xl p-10 flex justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
              </div>
            ) : thread.ticket === null ? (
              <div className="liquid-glass rounded-2xl p-10 text-center">
                <p className="font-sans text-sm text-brand-muted/60">That request no longer exists.</p>
              </div>
            ) : (
              <div className="liquid-glass rounded-2xl p-5 md:p-6">
                <div className="flex items-start gap-3 pb-4 mb-4 border-b border-white/[0.07]">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-serif text-lg text-brand-fg">{thread.ticket.subject}</h2>
                    <p className="font-sans text-[11px] text-brand-muted/50 mt-1">
                      {thread.ticket.public_ref} · {categoryDef(thread.ticket.category).label} ·
                      {' '}opened {when(thread.ticket.created_at)}
                    </p>
                  </div>
                  <StatusPill status={thread.ticket.status} />
                </div>

                <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
                  {thread.messages.map((m) => {
                    const mine = m.author_kind === 'customer';
                    return (
                      <div key={m.id} className={mine ? 'pl-6' : 'pr-6'}>
                        <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/40 mb-1.5">
                          {mine ? 'You' : 'Beamwall'} · {when(m.created_at)}
                        </p>
                        <div className={`rounded-2xl px-4 py-3 font-sans text-sm leading-relaxed whitespace-pre-wrap ${
                          mine
                            ? 'bg-white/[0.05] text-brand-fg/85'
                            : 'bg-[color:var(--color-accent)]/10 border border-[color:var(--color-accent)]/20 text-brand-fg'
                        }`}>
                          {m.body}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {thread.ticket.status === 'closed' ? (
                  <p className="font-sans text-xs text-brand-muted/50 mt-5 pt-4 border-t border-white/[0.07]">
                    This request is closed. Start a new one if you need anything else.
                  </p>
                ) : (
                  <div className="mt-5 pt-4 border-t border-white/[0.07]">
                    <label htmlFor="support-reply" className="sr-only">Your reply</label>
                    <textarea
                      id="support-reply"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Write a reply…"
                      maxLength={10_000}
                      className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3.5 py-3 text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-[color:var(--color-accent)]/50 min-h-20 resize-y"
                    />
                    {replyError !== null && (
                      <p className="font-sans text-xs text-amber-300 mt-2" role="alert">{replyError}</p>
                    )}
                    <button
                      onClick={() => void send()}
                      disabled={reply.trim() === '' || sending}
                      className="pressable mt-2.5 inline-flex items-center gap-2 rounded-xl px-4 min-h-11 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {sending ? 'Sending' : 'Send reply'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
