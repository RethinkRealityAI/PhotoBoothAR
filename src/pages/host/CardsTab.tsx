/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cards tab of the event studio (/host/events/:id/cards) — greeting cards /
 * video guestbook manager. DB events only (renders a notice for the coded
 * legacy events).
 *
 * Per card: copy contribute link (the token is long-lived by design — no
 * one-time reveal needed), open the public viewer, publish / unpublish + send
 * email (entitlement-aware: cardsStandard needs premium/deluxe or Pro — the
 * UpgradeModal opens on upgrade_required), a contributions manager
 * (thumbnails, hide/show, up/down reordering persisted to sort_order), and a
 * "Make event landing" toggle that pins the published card as the /e/:slug
 * guest landing via events.config.primary_card (see EventIndexRedirect in
 * App.tsx).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, Check, Copy, Eye, EyeOff, ExternalLink, Gift, Home, Loader2,
  Mail, Plus, Trash2, X,
} from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import { useEntitlements } from '../../lib/entitlements';
import { updateEventConfig } from '../../lib/host';
import {
  contributeUrl, createCard, deleteCard, deleteContribution, listCards, listContributions,
  publishCard, sendCardEmail, signContributionUrls, unpublishCard, updateContribution,
  viewerPath, type CardRow, type ContributionRow,
} from '../../lib/cards';
import { UpgradeModal } from './UpgradeCard';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-2.5 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

function statusPill(status: string): string {
  switch (status) {
    case 'published': return 'bg-emerald-500/15 text-emerald-400';
    case 'rendered': return 'bg-purple-500/15 text-purple-300';
    default: return 'bg-sky-500/15 text-sky-300'; // collecting
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
      className="flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg transition"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />} {label}
    </button>
  );
}

/* ── Contributions manager ─────────────────────────────────────────── */

function ContributionsManager({ cardId }: { cardId: string }) {
  const [rows, setRows] = useState<ContributionRow[] | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await listContributions(cardId);
    setRows(list);
    const paths = list.map((r) => r.media_path).filter((p): p is string => Boolean(p));
    setThumbs(await signContributionUrls(paths));
  }, [cardId]);

  useEffect(() => { load(); }, [load]);

  const toggleHidden = async (row: ContributionRow) => {
    if (await updateContribution(row.id, { hidden: !row.hidden })) {
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, hidden: !row.hidden } : r)) ?? null);
    }
  };

  const remove = async (row: ContributionRow) => {
    if (!confirm('Remove this contribution? This cannot be undone.')) return;
    if (await deleteContribution(row.id)) {
      setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? null);
    }
  };

  /** Move a contribution up/down and persist sequential sort_order. */
  const move = async (from: number, dir: -1 | 1) => {
    if (!rows || busy) return;
    const to = from + dir;
    if (to < 0 || to >= rows.length) return;
    setBusy(true);
    const next = [...rows];
    [next[from], next[to]] = [next[to], next[from]];
    const reindexed = next.map((r, i) => ({ ...r, sort_order: i }));
    setRows(reindexed);
    await Promise.all(
      reindexed
        .filter((r, i) => rows[i]?.id !== r.id || rows[i]?.sort_order !== r.sort_order)
        .map((r) => updateContribution(r.id, { sort_order: r.sort_order })),
    );
    setBusy(false);
  };

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-brand-muted/50">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="font-sans text-xs">Loading contributions…</span>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-5 text-center font-sans text-xs text-brand-muted/50">
        No contributions yet — share the contribute link to start collecting.
      </p>
    );
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {rows.map((row, i) => {
        const url = row.media_path ? thumbs.get(row.media_path) : undefined;
        return (
          <div
            key={row.id}
            className={`flex gap-3 rounded-xl border p-2.5 transition ${
              row.hidden ? 'border-white/5 bg-white/[0.01] opacity-50' : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <div className="w-16 h-16 shrink-0 overflow-hidden rounded-lg bg-black/40 flex items-center justify-center">
              {row.media_type === 'photo' && url ? (
                <img src={url} alt="" className="w-full h-full object-cover" />
              ) : row.media_type === 'video' && url ? (
                <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
              ) : (
                <span className="font-serif italic text-lg text-gold-300/70">
                  {row.media_type === 'text' ? '“ ”' : '…'}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-sans text-xs text-brand-fg truncate">{row.contributor_name || 'Anonymous'}</p>
              <p className="font-sans text-[10px] text-brand-muted/50 truncate">
                {row.media_type}{row.duration_seconds ? ` · ${Math.round(row.duration_seconds)}s` : ''}
              </p>
              {row.message && (
                <p className="mt-0.5 font-sans text-[10px] text-brand-muted/70 line-clamp-2">{row.message}</p>
              )}
            </div>
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="flex gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || busy}
                  title="Move up"
                  className="p-1 rounded-md bg-white/[0.05] text-brand-muted/60 hover:text-brand-fg disabled:opacity-30 transition"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1 || busy}
                  title="Move down"
                  className="p-1 rounded-md bg-white/[0.05] text-brand-muted/60 hover:text-brand-fg disabled:opacity-30 transition"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => toggleHidden(row)}
                  title={row.hidden ? 'Show on the card' : 'Hide from the card'}
                  className="p-1 rounded-md bg-white/[0.05] text-brand-muted/60 hover:text-brand-fg transition"
                >
                  {row.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => remove(row)}
                  title="Delete contribution"
                  className="p-1 rounded-md bg-white/[0.05] text-brand-muted/60 hover:text-red-400 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Create form ───────────────────────────────────────────────────── */

function CreateCardForm({ eventSlug, onCreated, onClose }: {
  eventSlug: string;
  onCreated: (card: CardRow) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [template, setTemplate] = useState('storybook');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(false);
    const card = await createCard(eventSlug, {
      title,
      recipientName,
      recipientEmail,
      template,
      deadline: deadline ? new Date(`${deadline}T23:59:59`).toISOString() : undefined,
    });
    setBusy(false);
    if (!card) {
      setErr(true);
      return;
    }
    onCreated(card);
  };

  return (
    <div className="rounded-2xl border border-gold-400/25 bg-white/[0.03] p-5 animate-rise-in">
      <div className="flex items-start justify-between gap-3 mb-4">
        <h3 className="font-serif text-lg text-foil-static">New greeting card</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 transition" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Happy 60th, Mum!" className={inputClass} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Recipient name</span>
          <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={80} placeholder="Mum" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Recipient email (optional)</span>
          <input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} type="email" placeholder="mum@example.com" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Template</span>
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className={inputClass}>
            <option value="storybook">Storybook</option>
            <option value="filmstrip">Film strip</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Collection deadline (optional)</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
        </label>
      </div>
      {err && <p className="mt-3 font-sans text-xs text-red-400">Couldn't create the card — please try again.</p>}
      <button
        onClick={submit}
        disabled={!title.trim() || busy}
        className="mt-4 rounded-full bg-foil px-6 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-noir-900 glow-accent transition active:scale-[0.98] disabled:opacity-40 flex items-center gap-2"
      >
        {busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</> : 'Create card'}
      </button>
    </div>
  );
}

/* ── Tab root ──────────────────────────────────────────────────────── */

export default function CardsTab() {
  const { eventId, eventUuid, planTier, source, config, refreshConfig } = useEvent();
  const entitlements = useEntitlements();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [emailSentFor, setEmailSentFor] = useState<string | null>(null);

  const isDb = source === 'db';

  useEffect(() => {
    if (!isDb) return;
    let alive = true;
    listCards(eventId).then((list) => { if (alive) setCards(list); });
    return () => { alive = false; };
  }, [eventId, isDb]);

  const patchCard = (id: string, patch: Partial<CardRow>) => {
    setCards((prev) => prev?.map((c) => (c.id === id ? { ...c, ...patch } : c)) ?? null);
  };

  const doPublish = async (card: CardRow) => {
    // Client-side gate first (mirrors the server check) so free-tier hosts get
    // the upsell instantly; the edge fn re-checks and 403s regardless.
    if (!entitlements.cardsStandard) {
      setUpgradeOpen(true);
      return;
    }
    setBusyCard(card.id);
    setNotice(null);
    const { data, error } = await publishCard(card.id);
    setBusyCard(null);
    if (error === 'upgrade_required') {
      setUpgradeOpen(true);
      return;
    }
    if (error || !data) {
      setNotice('Publishing failed — please try again.');
      return;
    }
    patchCard(card.id, { status: data.card.status, published_at: data.card.publishedAt });
  };

  const doUnpublish = async (card: CardRow) => {
    setBusyCard(card.id);
    setNotice(null);
    const { data, error } = await unpublishCard(card.id);
    if (error || !data) {
      setBusyCard(null);
      setNotice('Unpublishing failed — please try again.');
      return;
    }
    patchCard(card.id, { status: data.card.status, published_at: data.card.publishedAt });
    // If this card was pinned as the event landing, clear the pin too — otherwise
    // /e/:slug guests would be redirected to a now-unpublished card (which 404s).
    // Mirrors setLanding's events.config.primary_card mechanism.
    if (eventUuid && config.primaryCardPublicId === card.public_id) {
      if (await updateEventConfig(eventUuid, { primary_card: null })) await refreshConfig();
    }
    setBusyCard(null);
  };

  const doSendEmail = async (card: CardRow) => {
    setBusyCard(card.id);
    setNotice(null);
    const { error } = await sendCardEmail(card.id);
    setBusyCard(null);
    if (error === 'email_not_configured') {
      setNotice('Email delivery is not switched on for this platform yet — copy the view link instead.');
      return;
    }
    if (error === 'invalid_recipient') {
      setNotice('Add a valid recipient email to this card first.');
      return;
    }
    if (error) {
      setNotice("The email couldn't be sent — please try again.");
      return;
    }
    setEmailSentFor(card.id);
    setTimeout(() => setEmailSentFor(null), 3500);
  };

  const doDelete = async (card: CardRow) => {
    if (!confirm(`Delete “${card.title}” and all its contributions?`)) return;
    if (await deleteCard(card.id)) {
      setCards((prev) => prev?.filter((c) => c.id !== card.id) ?? null);
    }
  };

  const primaryCardId = config.primaryCardPublicId ?? null;
  const setLanding = async (card: CardRow, on: boolean) => {
    if (!eventUuid) return;
    setBusyCard(card.id);
    // Mechanism: events.config.primary_card = { publicId } → surfaced as
    // config.primaryCardPublicId by buildRuntimeConfig → EventIndexRedirect
    // (App.tsx) sends /e/:slug guests straight to /c/:publicId.
    const ok = await updateEventConfig(eventUuid, { primary_card: on ? { publicId: card.public_id } : null });
    if (ok) await refreshConfig();
    setBusyCard(null);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  if (!isDb) {
    return (
      <div className="absolute inset-0 overflow-y-auto app-bg">
        <div className="max-w-lg mx-auto p-10 text-center">
          <Gift className="w-8 h-8 mx-auto text-gold-400/70" />
          <h2 className="mt-4 font-serif text-2xl text-foil-static">Greeting cards</h2>
          <p className="mt-2 font-sans text-sm text-brand-muted/60 leading-relaxed">
            Cards are available for platform events. This coded legacy event manages its content from
            its pinned build.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto app-bg">
      <div className="max-w-3xl mx-auto p-5 md:p-8 flex flex-col gap-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-foil-static">Greeting cards</h2>
            <p className="mt-1 font-sans text-xs text-brand-muted/60">
              Collect messages, photos and videos from everyone — then publish one beautiful card.
            </p>
          </div>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 rounded-full bg-foil px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold text-noir-900 glow-accent transition active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5" /> New card
            </button>
          )}
        </div>

        {notice && (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3">
            <p className="flex-1 font-sans text-xs text-amber-200/90 leading-relaxed">{notice}</p>
            <button onClick={() => setNotice(null)} className="text-amber-200/60 hover:text-amber-200 transition" aria-label="Dismiss">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {creating && (
          <CreateCardForm
            eventSlug={eventId}
            onClose={() => setCreating(false)}
            onCreated={(card) => {
              setCards((prev) => [{ ...card, contribution_count: 0 }, ...(prev ?? [])]);
              setCreating(false);
              setExpanded(card.id);
            }}
          />
        )}

        {/* Card list */}
        {cards === null ? (
          <div className="flex items-center justify-center py-16 text-brand-muted/50">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : cards.length === 0 && !creating ? (
          <div className="rounded-2xl border border-dashed border-white/15 py-14 text-center">
            <Gift className="w-7 h-7 mx-auto text-gold-400/60" />
            <p className="mt-3 font-sans text-sm text-brand-muted/60">
              No cards yet — create one and share the contribute link with friends and family.
            </p>
          </div>
        ) : (
          cards.map((card) => {
            const open = expanded === card.id;
            const published = card.status === 'published' || card.status === 'rendered';
            const isLanding = primaryCardId === card.public_id;
            const busy = busyCard === card.id;
            return (
              <div key={card.id} className="rounded-2xl border border-white/10 bg-white/[0.02]">
                {/* Row header */}
                <button
                  onClick={() => setExpanded(open ? null : card.id)}
                  className="w-full flex flex-wrap items-center gap-3 px-5 py-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-base text-brand-fg truncate">{card.title}</p>
                    <p className="font-sans text-[10px] text-brand-muted/50">
                      {card.recipient_name ? `for ${card.recipient_name} · ` : ''}
                      {card.template} · {card.contribution_count ?? 0}{' '}
                      {(card.contribution_count ?? 0) === 1 ? 'contribution' : 'contributions'}
                      {isLanding ? ' · event landing' : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-label uppercase tracking-widest ${statusPill(card.status)}`}>
                    {card.status}
                  </span>
                </button>

                {open && (
                  <div className="border-t border-white/10 px-5 py-4 flex flex-col gap-4">
                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton text={contributeUrl(card, origin)} label="Contribute link" />
                      <a
                        href={viewerPath(card.public_id)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg transition"
                      >
                        <ExternalLink className="w-3 h-3" /> View card
                      </a>
                      {published ? (
                        <button
                          onClick={() => doUnpublish(card)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg transition disabled:opacity-40"
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <EyeOff className="w-3 h-3" />} Unpublish
                        </button>
                      ) : (
                        <button
                          onClick={() => doPublish(card)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-full bg-foil px-4 py-1.5 font-label uppercase tracking-luxe text-[9px] font-bold text-noir-900 glow-accent transition active:scale-[0.98] disabled:opacity-40"
                        >
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Publish
                        </button>
                      )}
                      {published && card.recipient_email && (
                        <button
                          onClick={() => doSendEmail(card)}
                          disabled={busy}
                          className="flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-fg transition disabled:opacity-40"
                        >
                          {emailSentFor === card.id ? (
                            <><Check className="w-3 h-3 text-emerald-400" /> Sent</>
                          ) : (
                            <><Mail className="w-3 h-3" /> Email {card.recipient_name || 'recipient'}</>
                          )}
                        </button>
                      )}
                      {published && (
                        <button
                          onClick={() => setLanding(card, !isLanding)}
                          disabled={busy}
                          title="Send /e/ guests straight to this card"
                          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] transition disabled:opacity-40 ${
                            isLanding
                              ? 'bg-gold-400/15 text-gold-300 ring-1 ring-gold-400/30'
                              : 'bg-white/[0.06] hover:bg-white/[0.12] text-brand-fg'
                          }`}
                        >
                          <Home className="w-3 h-3" /> {isLanding ? 'Event landing ✓' : 'Make event landing'}
                        </button>
                      )}
                      <button
                        onClick={() => doDelete(card)}
                        className="ml-auto flex items-center gap-1.5 rounded-full bg-white/[0.04] hover:bg-red-500/15 px-3 py-1.5 font-label uppercase tracking-luxe text-[9px] text-brand-muted/50 hover:text-red-400 transition"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>

                    {card.contribution_deadline && (
                      <p className="font-sans text-[10px] text-brand-muted/50">
                        Collecting until {new Date(card.contribution_deadline).toLocaleDateString()}
                      </p>
                    )}

                    {/* Contributions */}
                    <ContributionsManager cardId={card.id} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {upgradeOpen && eventUuid && (
        <UpgradeModal eventUuid={eventUuid} currentTier={planTier} onClose={() => setUpgradeOpen(false)} />
      )}
    </div>
  );
}
