/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/support — the operator's inbox.
 *
 * The whole point of this screen over an email client: a ticket arrives already
 * joined to WHO sent it, WHICH event it happened at, and — the part email can
 * never do — the stack traces that browser session reported around the same
 * time (support_tickets.session_id is deliberately the same id
 * errorReport.ts mints, see migration 023).
 *
 * Internal notes are written here and are invisible to the customer: the RLS
 * policy in 023 puts `internal = false` in its USING clause, and support.ts
 * repeats the filter. Both are load-bearing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Bug, Inbox, Loader2, Lock, Mail, MailX, Search, Send,
} from 'lucide-react';
import StatusPill from '../../components/ui/StatusPill';
import LoadError from '../../components/ui/LoadError';
import ListMore from '../../components/ui/ListMore';
import { useToast } from '../../components/ui/Toast';
import { listState } from '../../lib/listState';
import { listFootnote, type ListQuery } from '../../lib/serverList';
import { useServerList } from '../../lib/useServerList';
import { categoryDef, SUPPORT_CATEGORIES } from '../../lib/supportModel';
import type { SupportPriority, SupportStatus } from '../../lib/supportModel';
import {
  adminListTickets, adminGetTicket, adminReply, adminSetStatus, adminSetPriority,
  adminMarkRead, type AdminTicketDetail, type SupportTicket,
} from '../../lib/support';
import {
  INBOX_STATUS_FILTERS, CLEARED_FILTERS, activeFilterLabels, filtersAreCleared, inboxEmptyKind,
  keepForFilter, serverQueryIsUnfiltered, serverStatusFor,
  type InboxFilters, type InboxStatusFilter,
} from '../../lib/supportInbox';

/** Where reports come from: the SupportDialog mounts (support_tickets.source). */
const REPORT_SOURCES: Array<{ who: string; where: string }> = [
  { who: 'Hosts', where: 'Support in the dashboard rail, and Report a problem in the Event Studio' },
  { who: 'Guests', where: 'Report a problem in the booth menu, the welcome page and the camera or send error screens' },
  { who: 'Event managers', where: 'Report a problem in the manager console' },
  { who: 'Anyone', where: 'The landing page footer, and the crash screen if the app breaks' },
];

const SETTABLE_STATUS: SupportStatus[] = ['open', 'waiting_on_customer', 'waiting_on_us', 'resolved', 'closed'];
const PRIORITIES: SupportPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Tickets per request — the same page size the other admin lists use. */
const PAGE_SIZE = 50;

function when(iso: string | null): string {
  if (iso === null) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function AdminSupport() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('t');

  const [status, setStatus] = useState<InboxStatusFilter>('needs_action');
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Server-paged, on the same hook the Users/Events/Customers screens use. The
  // inbox used to ask for a flat 100 tickets with no offset and no Load more,
  // so the 101st report was simply unreachable from this screen — and unlike a
  // table of customers, an old ticket is exactly the thing an operator comes
  // here to find. support-api caps a page at 200 regardless of what we ask for.
  const fetchPage = useCallback(async (q: ListQuery) => {
    // serverStatusFor: 'Needs action' asks for every status and is narrowed
    // below (see src/lib/supportInbox.ts for why the server cannot do it).
    const { data, error } = await adminListTickets({
      status: serverStatusFor(status), category, unreadOnly, search: q.search, limit: q.limit, offset: q.offset,
    });
    return { rows: data?.tickets ?? [], hasMore: data?.hasMore ?? false, error };
  }, [status, category, unreadOnly]);
  const list = useServerList<SupportTicket>(fetchPage, PAGE_SIZE);
  // Every mutation below refetches page one rather than patching its row in
  // place: a reply sets the ticket to waiting_on_customer, and a status change
  // is one by definition, so either can move it OUT of the filter that is
  // showing it — which an in-place patch cannot express.
  const reload = list.reload;

  // The hook owns the search term and debounces it; the filter chips sit
  // outside it, so a change to one has to ask for the first page again. Keyed
  // on the filters' VALUES rather than a "have I mounted yet" flag: the hook's
  // own first load is already in flight on mount, and under StrictMode the
  // effect is deliberately run twice against a ref that survives it — a boolean
  // would let that second run fire a duplicate request.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const signature = `${status}|${category}|${unreadOnly}`;
    if (applied.current === signature) return;
    const first = applied.current === null;
    applied.current = signature;
    if (!first) reload();
  }, [status, category, unreadOnly, reload]);

  const [detail, setDetail] = useState<AdminTicketDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const patchRows = list.patchRows;
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const { data, error } = await adminGetTicket(id);
    setDetail(data);
    setDetailErr(error);
    setDetailLoading(false);
    if (data !== null) {
      // Opening it is reading it. Patched in place rather than reloaded: a
      // reload would throw away every page loaded past the first.
      void adminMarkRead(id);
      patchRows((rows) => rows.map((t) => (t.id === id ? { ...t, admin_unread: false } : t)));
    }
  }, [patchRows]);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); return; }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const select = (id: string | null) => {
    if (id === null) params.delete('t'); else params.set('t', id);
    setParams(params, { replace: true });
    setReply('');
    setInternal(false);
  };

  async function send() {
    const text = reply.trim();
    if (text === '' || selectedId === null || sending) return;
    setSending(true);
    const { data, error } = await adminReply(selectedId, text, internal);
    setSending(false);
    if (error !== null) { toast.push(`Reply failed: ${error}`, 'error'); return; }
    // Honest about delivery: the ticket saved either way, the email may not have.
    toast.push(
      internal ? 'Internal note added — the customer cannot see it.'
        : data?.emailed === true ? 'Replied and emailed.'
          : 'Replied. No email went out (no address on file, or email is not configured).',
      internal || data?.emailed === true ? 'success' : 'info',
    );
    setReply('');
    await loadDetail(selectedId);
    reload();
  }

  async function patchStatus(next: SupportStatus) {
    if (selectedId === null) return;
    const { error } = await adminSetStatus(selectedId, next);
    if (error !== null) { toast.push(`Couldn't change status: ${error}`, 'error'); return; }
    await loadDetail(selectedId);
    reload();
  }

  async function patchPriority(next: SupportPriority) {
    if (selectedId === null) return;
    const { error } = await adminSetPriority(selectedId, next);
    if (error !== null) { toast.push(`Couldn't change priority: ${error}`, 'error'); return; }
    await loadDetail(selectedId);
    reload();
  }

  const filters: InboxFilters = { status, category, unreadOnly, search: list.query };
  const visibleRows = list.rows.filter((t) => keepForFilter(status, t.status));
  const state = listState({ count: visibleRows.length, loaded: !list.loading, failed: list.error !== null });

  // "Is there ANY ticket?" — only asked when filters hid everything and the
  // server query itself was filtered (an unfiltered empty answer already says
  // no). One row of the All query; its `total` is the count. A failed probe
  // stays null, and the empty state then avoids claiming either way.
  const [anyTickets, setAnyTickets] = useState<boolean | null>(null);
  const needProbe = state === 'empty' && !serverQueryIsUnfiltered(filters);
  useEffect(() => {
    if (!needProbe) return;
    let alive = true;
    void adminListTickets({ status: '', limit: 1 }).then(({ data, error }) => {
      if (!alive) return;
      if (error !== null || data === null) { setAnyTickets(null); return; }
      const total = data.total ?? null;
      setAnyTickets(total !== null ? total > 0 : data.tickets.length > 0);
    });
    return () => { alive = false; };
  }, [needProbe]);

  const emptyKind = inboxEmptyKind({
    filters, serverRows: list.rows.length, serverHasMore: list.hasMore, anyTickets,
  });
  const activeLabels = activeFilterLabels(filters, (id) => categoryDef(id).label);
  const clearFilters = () => {
    setStatus(CLEARED_FILTERS.status);
    setCategory(CLEARED_FILTERS.category);
    setUnreadOnly(CLEARED_FILTERS.unreadOnly);
    list.setQuery(CLEARED_FILTERS.search);
  };
  // The reader pane only earns its column when there is something to read.
  const showReader = selectedId !== null || state === 'ready' || state === 'loading';
  const chip = 'pressable rounded-full px-3.5 min-h-11 font-label uppercase tracking-luxe text-[11px] border transition-colors';
  const chipOn = 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg';
  const chipOff = 'bg-white/[0.04] border-white/10 text-brand-muted/80 hover:text-brand-fg';

  return (
    <div className="min-h-full px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5">
          <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Support</h1>
          <p className="font-sans text-sm text-brand-muted/60 mt-1">
            Everything customers and guests have reported.
          </p>
        </header>

        {/* Two rows on purpose: the status chips are one decision ("which
            queue"), the rest narrow within it. On one row the search box was
            whatever width was left over and clipped its own placeholder. */}
        <div className="flex flex-col gap-2.5 mb-4">
          <div role="group" aria-label="Ticket status" className="flex flex-wrap items-center gap-2">
            {INBOX_STATUS_FILTERS.map((f) => (
              <button key={f.id} onClick={() => setStatus(f.id)}
                aria-pressed={status === f.id}
                title={f.id === 'needs_action' ? 'New, reopened, or waiting on us — not tickets waiting on the customer' : undefined}
                className={`${chip} ${status === f.id ? chipOn : chipOff}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setUnreadOnly((v) => !v)}
              aria-pressed={unreadOnly}
              className={`${chip} ${unreadOnly ? chipOn : chipOff}`}>
              Unread only
            </button>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className="rounded-full bg-white/[0.04] border border-white/10 px-3.5 min-h-11 font-label uppercase tracking-luxe text-[11px] text-brand-muted/85"
            >
              <option value="">All types</option>
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <label className="relative flex-1 basis-full sm:basis-64 min-w-0 sm:min-w-[16rem] sm:max-w-md sm:ml-auto">
              <span className="sr-only">Search tickets</span>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-muted/60" />
              <input
                type="search"
                value={list.query}
                onChange={(e) => list.setQuery(e.target.value)}
                placeholder="Search ref, subject, email…"
                aria-label="Search tickets by reference, subject, email or event"
                className="w-full rounded-xl bg-white/[0.06] border border-white/10 pl-9 pr-3.5 min-h-11 text-sm text-brand-fg placeholder:text-brand-muted/60 focus:outline-none focus:border-[color:var(--color-accent)]/60"
              />
            </label>
          </div>
        </div>

        {list.error !== null && (
          <LoadError what="tickets" code={list.error} onRetry={reload} />
        )}

        <div className={`grid gap-4 ${showReader ? 'lg:grid-cols-[380px_1fr]' : ''}`}>
          {/* ── Inbox ── */}
          <div className={`space-y-2 ${selectedId !== null ? 'hidden lg:block' : ''}`}>
            {state === 'loading' && (
              <div className="liquid-glass rounded-2xl p-8 flex justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
              </div>
            )}
            {state === 'empty' && emptyKind === 'none-ever' && (
              <div className="liquid-glass rounded-2xl p-6 md:p-10 max-w-2xl mx-auto">
                <Inbox className="w-8 h-8 text-[color:var(--color-accent)]/70 mb-4" aria-hidden />
                <h2 className="font-serif text-xl text-brand-fg">No tickets yet</h2>
                <p className="font-sans text-sm text-brand-muted/70 mt-2 leading-relaxed">
                  When someone reports a problem, it shows up here with their account,
                  the event, and any errors their browser hit around that time.
                </p>
                <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 mt-6 mb-2.5">
                  Where people report from
                </p>
                <ul className="space-y-2">
                  {REPORT_SOURCES.map((s) => (
                    <li key={s.who} className="flex gap-3 font-sans text-sm leading-snug">
                      <span className="shrink-0 w-28 text-brand-fg/85">{s.who}</span>
                      <span className="text-brand-muted/70">{s.where}</span>
                    </li>
                  ))}
                </ul>
                <p className="font-sans text-xs text-brand-muted/55 mt-6 pt-4 border-t border-white/[0.07] leading-relaxed">
                  <Mail className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" aria-hidden />
                  Each new ticket also sends an email to the support address set in the
                  {' '}<code className="text-brand-muted/80">SUPPORT_NOTIFY_EMAIL</code> secret,
                  if email sending is set up.
                </p>
              </div>
            )}
            {state === 'empty' && emptyKind !== 'none-ever' && (
              <div className={`liquid-glass rounded-2xl p-8 text-center ${showReader ? '' : 'max-w-2xl mx-auto'}`}>
                <Inbox className="w-7 h-7 mx-auto text-brand-muted/30 mb-3" aria-hidden />
                <p className="font-sans text-sm text-brand-fg/85">
                  {list.hasMore ? 'Nothing in the newest tickets matches ' : 'No tickets match '}
                  {activeLabels.length > 0 ? activeLabels.join(' · ') : 'these filters'}.
                </p>
                <p className="font-sans text-xs text-brand-muted/55 mt-1.5">
                  {emptyKind === 'filtered'
                    ? 'Other tickets exist. They are hidden by these filters.'
                    : 'These filters may be hiding tickets.'}
                </p>
                {!filtersAreCleared(filters) && (
                  <button onClick={clearFilters}
                    className="pressable mt-4 inline-flex items-center justify-center rounded-xl px-5 min-h-11 bg-white/[0.06] border border-white/10 font-label uppercase tracking-luxe text-[10px] text-brand-fg hover:bg-white/[0.1]">
                    Show all tickets
                  </button>
                )}
              </div>
            )}
            {state === 'ready' && visibleRows.map((t) => (
              <button key={t.id} onClick={() => select(t.id)}
                className={`pressable w-full text-left rounded-2xl p-3.5 border transition-colors ${
                  t.id === selectedId
                    ? 'bg-white/[0.08] border-[color:var(--color-accent)]/40'
                    : 'liquid-glass border-transparent hover:bg-white/[0.05]'
                }`}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <StatusPill status={t.status} />
                  {t.priority !== 'normal' && <StatusPill status={t.priority} />}
                  {t.admin_unread && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)]" aria-label="Unread" />
                  )}
                  <span className="ml-auto font-sans text-[10px] text-brand-muted/40">{t.public_ref}</span>
                </div>
                <p className={`font-sans text-sm truncate ${t.admin_unread ? 'text-brand-fg font-medium' : 'text-brand-fg/80'}`}>
                  {t.subject}
                </p>
                <p className="font-sans text-[11px] text-brand-muted/50 mt-0.5 truncate">
                  {t.org_name ?? (t.created_by === null ? 'Guest' : 'Unknown org')}
                  {' · '}{categoryDef(t.category).label}{' · '}{when(t.last_message_at)}
                </p>
              </button>
            ))}
            <ListMore
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onMore={list.loadMore}
              note={listFootnote(visibleRows.length, list.hasMore, 'ticket')}
            />
          </div>

          {/* ── Detail ── */}
          {showReader && <div className={selectedId === null ? 'hidden lg:block' : ''}>
            {selectedId !== null && (
              <button onClick={() => select(null)}
                className="pressable lg:hidden mb-3 inline-flex items-center gap-2 rounded-xl px-3 min-h-11 bg-white/[0.04] text-brand-muted/70 font-label uppercase tracking-luxe text-[10px]">
                <ArrowLeft className="w-4 h-4" /> Inbox
              </button>
            )}

            {selectedId === null ? (
              <div className="liquid-glass rounded-2xl p-10 text-center h-full flex items-center justify-center">
                <p className="font-sans text-sm text-brand-muted/50">Pick a ticket to read it.</p>
              </div>
            ) : detailErr !== null ? (
              <LoadError what="this ticket" code={detailErr} onRetry={() => void loadDetail(selectedId)} />
            ) : detailLoading && detail === null ? (
              <div className="liquid-glass rounded-2xl p-10 flex justify-center">
                <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-[color:var(--color-accent)] animate-spin" />
              </div>
            ) : detail === null ? (
              <div className="liquid-glass rounded-2xl p-10 text-center">
                <p className="font-sans text-sm text-brand-muted/60">That ticket no longer exists.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="liquid-glass rounded-2xl p-5">
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-serif text-lg text-brand-fg">{detail.ticket.subject}</h2>
                      <p className="font-sans text-[11px] text-brand-muted/50 mt-1">
                        {detail.ticket.public_ref} · {categoryDef(detail.ticket.category).label} ·
                        {' '}from {detail.ticket.reporter_email ?? 'an anonymous guest'} ·
                        {' '}{detail.org?.name ?? 'no org'}
                        {detail.event !== null && <> · at {detail.event.name}</>}
                      </p>
                    </div>
                    <StatusPill status={detail.ticket.status} />
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-white/[0.07]">
                    {SETTABLE_STATUS.map((s) => (
                      <button key={s} onClick={() => void patchStatus(s)}
                        disabled={detail.ticket.status === s}
                        className={`${chip} ${detail.ticket.status === s ? chipOn : chipOff} disabled:opacity-100`}>
                        {s.replace(/_/g, ' ')}
                      </button>
                    ))}
                    <span className="w-px h-5 bg-white/10 mx-1 self-center" />
                    {PRIORITIES.map((p) => (
                      <button key={p} onClick={() => void patchPriority(p)}
                        disabled={detail.ticket.priority === p}
                        className={`${chip} ${detail.ticket.priority === p ? chipOn : chipOff} disabled:opacity-100`}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Diagnostics + the stack traces from the same browser session. */}
                {(Object.keys(detail.ticket.diagnostics ?? {}).length > 0 || detail.recentErrors.length > 0) && (
                  <div className="liquid-glass rounded-2xl p-5">
                    <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/50 mb-3">
                      What their browser was doing
                    </p>
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                      {Object.entries(detail.ticket.diagnostics ?? {}).map(([k, v]) => (
                        <div key={k} className="flex gap-2 font-sans text-[11px] min-w-0">
                          <span className="text-brand-muted/40 shrink-0 w-20">{k}</span>
                          <span className="text-brand-muted/75 break-all">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                    {detail.recentErrors.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-white/[0.07] space-y-2">
                        <p className="font-label uppercase tracking-luxe text-[10px] text-amber-300/70 flex items-center gap-1.5">
                          <Bug className="w-3.5 h-3.5" />
                          {detail.recentErrors.length} error{detail.recentErrors.length === 1 ? '' : 's'} from this session
                        </p>
                        {detail.recentErrors.map((e) => (
                          <p key={e.id} className="font-sans text-[11px] text-amber-100/70 break-all">
                            <span className="text-brand-muted/40">{when(e.created_at)} </span>{e.message}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="liquid-glass rounded-2xl p-5">
                  <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-1">
                    {detail.messages.map((m) => (
                      <div key={m.id} className={m.author_kind === 'admin' ? 'pl-6' : 'pr-6'}>
                        <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/40 mb-1.5 flex items-center gap-1.5">
                          {m.author_kind === 'admin' ? (m.author_email ?? 'You') : 'Customer'} · {when(m.created_at)}
                          {m.internal && (
                            <span className="inline-flex items-center gap-1 text-amber-300/80">
                              <Lock className="w-3 h-3" /> internal
                            </span>
                          )}
                          {m.email_error !== null && m.email_error !== undefined && (
                            <span className="inline-flex items-center gap-1 text-amber-300/80" title={m.email_error}>
                              <MailX className="w-3 h-3" /> not emailed
                            </span>
                          )}
                          {m.email_sent_at !== null && m.email_sent_at !== undefined && (
                            <span className="inline-flex items-center gap-1 text-emerald-400/70">
                              <Mail className="w-3 h-3" /> emailed
                            </span>
                          )}
                        </p>
                        <div className={`rounded-2xl px-4 py-3 font-sans text-sm leading-relaxed whitespace-pre-wrap ${
                          m.internal
                            ? 'bg-amber-400/[0.07] border border-amber-400/25 text-amber-50/85'
                            : m.author_kind === 'admin'
                              ? 'bg-[color:var(--color-accent)]/10 border border-[color:var(--color-accent)]/20 text-brand-fg'
                              : 'bg-white/[0.05] text-brand-fg/85'
                        }`}>
                          {m.body}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 pt-4 border-t border-white/[0.07]">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder={internal ? 'A note only the team can see…' : 'Reply to the customer…'}
                      maxLength={10_000}
                      aria-label={internal ? 'Internal note' : 'Reply to the customer'}
                      className={`w-full rounded-xl px-3.5 py-3 text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none min-h-24 resize-y border ${
                        internal
                          ? 'bg-amber-400/[0.05] border-amber-400/30 focus:border-amber-400/60'
                          : 'bg-white/[0.04] border-white/10 focus:border-[color:var(--color-accent)]/50'
                      }`}
                    />
                    <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                      <label className="inline-flex items-center gap-2 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 cursor-pointer">
                        <input type="checkbox" checked={internal}
                          onChange={(e) => setInternal(e.target.checked)}
                          className="accent-[color:var(--color-accent)]" />
                        Internal note
                      </label>
                      {internal && (
                        <span className="inline-flex items-center gap-1.5 font-sans text-[11px] text-amber-300/80">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Not sent to the customer, and not visible to them.
                        </span>
                      )}
                      <button
                        onClick={() => void send()}
                        disabled={reply.trim() === '' || sending}
                        className="pressable ml-auto inline-flex items-center gap-2 rounded-xl px-4 min-h-11 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40"
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {sending ? 'Sending' : internal ? 'Add note' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>}
        </div>
      </div>
    </div>
  );
}
