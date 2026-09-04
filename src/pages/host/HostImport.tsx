/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/import — bring an already-generated image INTO one of your events.
 *
 * A host who made a frame or sticker somewhere else (their own Higgsfield
 * workspace, most likely) arrives here with the asset's URL in `?src=`. This
 * page previews it, asks which event it belongs to, and hands the URL to the
 * `import-asset` edge function, which fetches it SERVER-side, proves it really
 * is an image, re-hosts it in the assets bucket and creates the same
 * unpublished `experiences` row a generated asset gets. Nothing is charged.
 *
 * The preview sits on a checkerboard on purpose: these assets are supposed to be
 * transparent PNGs, and a transparent frame over a dark card is indistinguishable
 * from a black one.
 *
 * Query params (all optional but `src`):
 *   src     the https image URL to import
 *   kind    'border' | '2d_filter'   (default 'border')
 *   layout  one of the five frame archetypes (border kind only)
 *   name    what to call it in the library (≤40 chars server-side)
 *
 * Auth: HostLayout already gates /host on a session — nothing here re-implements
 * that, and the edge function asserts org membership itself regardless.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Check, Download, ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchMyEvents, type HostEventRow } from '../../lib/host';
import { FRAME_LAYOUT_SPEC, type FrameLayout } from '../../lib/assetPrompt';
import type { Experience } from '../../types';

/** The two kinds `import-asset` accepts (same pair as ai-generate-image). */
type ImportKind = 'border' | '2d_filter';

const KIND_LABELS: Record<ImportKind, string> = {
  border: 'Frame',
  '2d_filter': 'Sticker',
};

/** Host-facing names for the archetypes — the same words AiFramePanel's chips
 *  use, so an asset generated there reads the same when it is imported. */
const LAYOUT_LABELS: Record<FrameLayout, string> = {
  'classic-border': 'Border',
  'full-scene': 'Full scene',
  'duo-scene': 'Two faces',
  'corner-overlay': 'Corners',
  'bottom-third': 'Banner',
};

/** Transparency is the point of these assets — show it. (Same idiom as the
 *  library grid in components/admin/Assets.tsx.) */
const CHECKERBOARD =
  'repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, rgba(255,255,255,0.06) 0% 50%) 50% / 18px 18px';

/** https only, no credentials, no IP literals — the same posture the edge
 *  function enforces server-side, checked here so the host gets a sentence
 *  instead of a round trip. Returns the normalized URL, or null. */
function validImageUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.')) return null;
  return u.toString();
}

function isImportKind(v: string): v is ImportKind {
  return v === 'border' || v === '2d_filter';
}

function isFrameLayout(v: string): v is FrameLayout {
  return Object.prototype.hasOwnProperty.call(FRAME_LAYOUT_SPEC, v);
}

/** Edge-fn error code → a sentence a host can act on. The code itself goes to
 *  console.error for support, exactly as the billing screen does. */
function importErrorMessage(code: string | null): string {
  switch (code) {
    case 'invalid_asset':
      return 'That link isn’t an image we can import.';
    case 'invalid_url':
      return 'That link isn’t a public https image address.';
    case 'fetch_failed':
      return 'We couldn’t download that link — check it opens in a browser without signing in.';
    case 'asset_too_large':
      return 'That image is over 10 MB — export a smaller version and try again.';
    case 'invalid_body':
      return 'Something about that import wasn’t right — check the link and try again.';
    case 'unauthorized':
      return 'Your session has expired — sign in again, then retry.';
    case 'forbidden':
      return 'You don’t have access to that event.';
    case 'event_not_found':
      return 'That event no longer exists — pick another one.';
    case 'network':
      return 'Couldn’t reach Beamwall — check your connection and try again.';
    default:
      return 'Something went wrong on our side — try again in a moment.';
  }
}

/**
 * Invoke `import-asset`. FunctionsHttpError bodies are decoded the same way
 * lib/ai.ts invokeAi does — the pattern is copied rather than imported so this
 * page pulls in none of the AI client's types.
 */
async function importAsset(body: {
  eventUuid: string;
  url: string;
  kind: ImportKind;
  layout?: FrameLayout;
  name?: string;
}): Promise<{ experience: Experience | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('import-asset', { body });
    if (error) {
      if (error instanceof FunctionsHttpError) {
        try {
          const res = (await error.context.json()) as { error?: string };
          return { experience: null, error: res.error ?? 'internal' };
        } catch {
          return { experience: null, error: 'internal' };
        }
      }
      return { experience: null, error: 'network' };
    }
    const exp = (data as { experience?: Experience } | null)?.experience ?? null;
    // A 200 with no row is not a success we can link to a library entry.
    return exp ? { experience: exp, error: null } : { experience: null, error: 'internal' };
  } catch (e) {
    console.error('[import] import-asset', e);
    return { experience: null, error: 'network' };
  }
}

export default function HostImport() {
  const [searchParams] = useSearchParams();
  const srcParam = searchParams.get('src') ?? '';
  const kindParam = (searchParams.get('kind') ?? '').trim();
  const layoutParam = (searchParams.get('layout') ?? '').trim();
  const nameParam = (searchParams.get('name') ?? '').trim();

  const kind: ImportKind = isImportKind(kindParam) ? kindParam : 'border';
  const layout: FrameLayout | null =
    kind === 'border' && isFrameLayout(layoutParam) ? layoutParam : null;

  /** What we will actually import — seeded from ?src=, editable when the link
   *  is missing or malformed so the host is never stuck on a dead page. */
  const [url, setUrl] = useState(() => validImageUrl(srcParam) ?? '');
  const [draftUrl, setDraftUrl] = useState(srcParam);
  const [urlError, setUrlError] = useState<string | null>(
    srcParam && !validImageUrl(srcParam)
      ? 'That link isn’t a public https image address — paste the direct image URL.'
      : null,
  );
  /** The preview <img> could not load it — the server fetch would fail too. */
  const [previewFailed, setPreviewFailed] = useState(false);

  const [events, setEvents] = useState<HostEventRow[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(''); // event uuid
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ event: HostEventRow; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await fetchMyEvents(); // null = load failure → retry state
    setEvents(list);
    // Most recent first (fetchMyEvents orders created_at desc) — preselect it.
    setSelected(list && list.length > 0 ? list[0].id : '');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const useDraftUrl = () => {
    const next = validImageUrl(draftUrl);
    if (!next) {
      setUrlError('That link isn’t a public https image address — paste the direct image URL.');
      return;
    }
    setUrlError(null);
    setPreviewFailed(false);
    setUrl(next);
  };

  const add = async () => {
    if (busy || !url || !selected) return;
    const target = (events ?? []).find((e) => e.id === selected);
    if (!target) { setError('Pick which event this belongs to first.'); return; }
    setBusy(true);
    setError(null);
    const res = await importAsset({
      eventUuid: selected,
      url,
      kind,
      ...(layout ? { layout } : {}),
      ...(nameParam ? { name: nameParam } : {}),
    });
    setBusy(false);
    if (res.error !== null || res.experience === null) {
      console.error('[import] failed:', res.error);
      setError(importErrorMessage(res.error));
      return;
    }
    // Compared to '' explicitly — a blank name must fall through to the label
    // the host asked for, and then to the server's own default.
    const rowName = typeof res.experience.name === 'string' ? res.experience.name.trim() : '';
    const label = rowName !== '' ? rowName : nameParam !== '' ? nameParam : 'Imported asset';
    setDone({ event: target, name: label });
  };

  return (
    /* pb-24 on phones: the floating Copilot FAB is fixed bottom-right on every
       /host/** page and sat on top of this page's last control. */
    <div className="p-6 pb-24 md:p-10 md:pb-10 max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-foil-static">Import an asset</h1>
        <p className="mt-1 font-sans text-xs text-brand-muted/60">
          Add a frame or sticker you generated elsewhere to one of your events — no credits.
        </p>
      </header>

      {done ? (
        /* ── Success ─────────────────────────────────────────────────────── */
        <div className="liquid-glass rounded-3xl p-8 md:p-10 text-center flex flex-col items-center gap-4">
          <span className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <Check className="w-6 h-6 text-emerald-400" />
          </span>
          <div>
            <h2 className="font-serif text-2xl text-brand-fg">Added to {done.event.name}</h2>
            <p className="mt-1.5 font-sans text-xs text-brand-muted/60 leading-relaxed max-w-sm mx-auto">
              “{done.name}” is in that event’s library as a draft — open the studio to place it and publish
              it to your booth.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Link
              to={`/host/events/${done.event.id}/studio`}
              className="pressable flex items-center gap-2 rounded-full bg-foil px-6 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition"
            >
              Open in Studio <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </Link>
            <button
              onClick={() => { setDone(null); setError(null); }}
              className="pressable flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-6 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Import another
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* ── The asset ─────────────────────────────────────────────────── */}
          <div className="liquid-glass rounded-2xl p-5 flex flex-col gap-4">
            <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">The asset</p>

            {url && !previewFailed ? (
              <div className="flex flex-col sm:flex-row gap-4">
                <div
                  className="w-full sm:w-40 shrink-0 aspect-[9/16] rounded-xl border border-white/10 overflow-hidden"
                  style={{ background: CHECKERBOARD }}
                >
                  {/* Checkerboard behind it: a transparent PNG must LOOK transparent. */}
                  <img
                    src={url}
                    alt="Asset preview"
                    onError={() => setPreviewFailed(true)}
                    className="w-full h-full object-contain"
                  />
                </div>
                <dl className="flex-1 min-w-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 content-start">
                  <dt className="font-label uppercase tracking-widest text-[9px] text-brand-muted/40 pt-0.5">Name</dt>
                  <dd className="font-sans text-[12px] text-brand-fg break-words">{nameParam || 'Imported asset'}</dd>
                  <dt className="font-label uppercase tracking-widest text-[9px] text-brand-muted/40 pt-0.5">Type</dt>
                  <dd className="font-sans text-[12px] text-brand-fg">{KIND_LABELS[kind]}</dd>
                  {layout && (
                    <>
                      <dt className="font-label uppercase tracking-widest text-[9px] text-brand-muted/40 pt-0.5">Style</dt>
                      <dd className="font-sans text-[12px] text-brand-fg">{LAYOUT_LABELS[layout]}</dd>
                    </>
                  )}
                  <dt className="font-label uppercase tracking-widest text-[9px] text-brand-muted/40 pt-0.5">Source</dt>
                  <dd className="font-mono text-[10px] text-brand-muted/60 break-all">{url}</dd>
                </dl>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="font-sans text-[12px] text-brand-muted/70 leading-relaxed">
                  {previewFailed
                    ? 'That image wouldn’t load — check the link opens in a browser without signing in, then try again.'
                    : 'Paste the direct link to the image you want to import (https, publicly viewable).'}
                </p>
                <input
                  type="url"
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); useDraftUrl(); } }}
                  placeholder="https://…/frame.png"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2.5 font-mono text-[11px] text-brand-fg placeholder:text-brand-muted/40 outline-none focus:border-accent/50"
                />
                {urlError && <p className="font-sans text-[11px] text-red-300" role="alert">{urlError}</p>}
                <button
                  onClick={useDraftUrl}
                  disabled={!draftUrl.trim()}
                  className="self-start flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" /> Preview it
                </button>
              </div>
            )}
          </div>

          {/* ── Which event ───────────────────────────────────────────────── */}
          <div className="liquid-glass rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Add it to</p>
              <button
                onClick={load}
                disabled={loading}
                aria-label="Refresh events"
                className="pressable p-2 min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
                ))}
              </div>
            ) : events === null ? (
              <div className="py-6 text-center">
                <p className="font-sans text-xs text-brand-muted/70 leading-relaxed mb-4">
                  Couldn’t load your events — check your connection and try again.
                </p>
                <button
                  onClick={load}
                  className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-5 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/90 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            ) : events.length === 0 ? (
              <div className="py-8 text-center">
                <h2 className="font-serif text-xl text-foil-static mb-2">No events yet</h2>
                <p className="font-sans text-xs text-brand-muted/70 leading-relaxed mb-6 max-w-sm mx-auto">
                  An asset has to live in an event. Create one — it takes about a minute — then come back to
                  this link and it will be waiting.
                </p>
                <Link
                  to="/host/new"
                  className="inline-flex items-center gap-2 rounded-full bg-foil px-6 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition"
                >
                  <Plus className="w-4 h-4" /> New event
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Choose an event">
                {events.map((ev) => {
                  const active = ev.id === selected;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelected(ev.id)}
                      className={`w-full flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors ${
                        active
                          ? 'bg-accent/15 ring-1 ring-accent/40'
                          : 'bg-white/[0.03] hover:bg-white/[0.06]'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center ${
                          active ? 'border-accent bg-accent/30' : 'border-white/20'
                        }`}
                      >
                        {active && <Check className="w-2.5 h-2.5 text-brand-fg" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-[13px] text-brand-fg truncate">{ev.name}</span>
                        <span className="block font-mono text-[10px] text-brand-muted/50 truncate">/e/{ev.slug}</span>
                      </span>
                      <span className="shrink-0 font-label uppercase tracking-widest text-[9px] text-brand-muted/40">
                        {ev.status}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-3">
              <p className="flex-1 font-sans text-xs text-red-300" role="alert">{error}</p>
              <button
                onClick={() => setError(null)}
                className="shrink-0 text-red-300/60 hover:text-red-300 text-xs"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          <button
            onClick={add}
            disabled={busy || !url || previewFailed || !selected}
            className="self-start flex items-center gap-2 rounded-full bg-foil px-6 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {busy ? 'Adding…' : 'Add to event'}
          </button>
          <p className="font-sans text-[10px] text-brand-muted/40 leading-relaxed -mt-2">
            We download it once and re-host it in your event’s library, so it keeps working if the original
            link expires. It arrives unpublished — nothing changes for your guests until you publish it.
          </p>
        </div>
      )}
    </div>
  );
}
