/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LooksPicker — "Pick your frames & filters". A thumbnail grid of the
 * ready-made frames and a tile row of filters, best match first (themeMatch
 * rankLooks: occasion, then colour). Each tile is an on/off toggle; one
 * selected frame is the default the booth opens with. Saving writes
 * events.config.arContent borderIds/shaderIds (+ framePalette) and
 * defaultExperienceId through updateEventConfig.
 *
 * Self-contained on purpose: it only needs the event's uuid and current
 * config, so the post-create screen and the studio library tab can both
 * mount it. It does NOT touch the wall-settings default frame (Booth.tsx
 * prefers that one when set) — a host who set one there keeps it.
 *
 * With `library` set it also shows "Ready-made looks": the shared Beamwall
 * library (experiences rows with is_global), laid out for this event by
 * libraryMatch.libraryShelves (a fitting season first, then occasion and
 * colour). Those switch on and off STRAIGHT AWAY through event_catalog_links
 * (no Save) — the same links the booth catalog reads (store.fetchExperiences
 * → fetchLinkedGlobalExperiences → buildCatalog), so a look switched on here
 * is in the guest's picker; the "N on" counts include them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RefreshCw, Sparkles, Star } from 'lucide-react';
import { BORDER_MAP, frameDataUrl, frameDisplayName } from '../../lib/borders';
import { FILTER_SHADERS } from '../../lib/shaders';
import { FILTER_LOOKS, effectiveDefaultFrame, looksConfigPatch, rankLooks, selectionFromConfig, type LooksSelection } from '../../lib/themeMatch';
import { templateById } from '../../lib/eventTemplates';
import { normalizeHex } from '../../lib/themeDerive';
import { updateEventConfig } from '../../lib/host';
import { fetchLibraryForEventResult, linkCatalogItem, unlinkCatalogItem } from '../../lib/db';
import { boothTabOf, capShelves, isThumbnailSrc, libraryKindLabel, libraryShelves, type LibraryShelf } from '../../lib/libraryMatch';
import { useToast } from '../ui/Toast';
import type { Experience } from '../../types';

interface Props {
  eventUuid: string;
  config: Record<string, unknown> | null | undefined;
  /** Template id or events.event_type — used for the "Recommended" order. */
  eventType?: string | null;
  /** The event colour; recolourable frames can take it on. */
  accentHex?: string | null;
  /** Called with the merged config after a successful save. */
  onSaved?: (nextConfig: Record<string, unknown>) => void;
  /** Heading level text; omit for the default. */
  title?: string;
  /** Name of the look the booth opens with when it is not one of these
   *  frames (an AI frame, a library pick); null/absent → a generic note. */
  openingLookName?: string | null;
  /** The host's OWN frames (AI-made / uploaded rows). Shown first and counted
   *  in "Frames · N on" — guests see the published ones, so a host who made
   *  an AI frame was told "4 on" while the booth offered 5. Their on/off lives
   *  on the row (Your own below), so the tiles here only report it. Absent
   *  (the create flow) → nothing changes. */
  ownFrames?: OwnFrame[];
  /** Show the shared library's ready-made looks for this event. Absent →
   *  nothing changes (no read, no section). */
  library?: LibraryOptions;
}

export interface LibraryOptions {
  /** events.slug — event_catalog_links keys on the slug, not the uuid. */
  eventSlug: string;
  /** events.event_type for the occasion match; defaults to `eventType`. */
  occasion?: string | null;
  /** Name / brief text — a "Christmas party" surfaces the Christmas shelf. */
  text?: string | null;
  /** events.starts_at — a December date surfaces the Christmas shelf. */
  date?: string | null;
  /** The create screen: render nothing when the library is empty (no empty
   *  promise). A FAILED read still says so — it is not an empty library. */
  hideWhenEmpty?: boolean;
}

/** How many ready-made looks show before "Show all". */
const LIBRARY_INITIAL = 6;

type LibraryState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; rows: Experience[]; linked: Set<string> };

export interface OwnFrame {
  id: string;
  name: string;
  imageUrl: string | null;
  /** Published — guests can pick it. */
  on: boolean;
}

const FILTER_NAMES: Record<string, string> = Object.fromEntries(FILTER_SHADERS.map((s) => [s.id, s.name]));

/** A stand-in guest behind each frame so a transparent frame reads as a
 *  frame, not an empty tile. Same figure and fill as FrameTruthPreview's
 *  single centred guest (cx .5, cy .42, r .15 of the 9:16 screen). */
function StandInGuest() {
  return (
    <svg viewBox="0 0 90 160" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
      <g fill="rgba(236,226,214,0.55)">
        <ellipse cx="45" cy="67.2" rx="13.5" ry="16.5" />
        <ellipse cx="45" cy="107.7" rx="28.4" ry="21.6" />
      </g>
    </svg>
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * The shared library + this event's links. `slug === null` → never reads.
 * Toggling is optimistic: the tile flips at once and flips BACK (with an
 * inline line and a toast) when the write fails, so the screen never claims a
 * look is in the booth when it is not.
 */
function useEventLibrary(slug: string | null) {
  const { push } = useToast();
  const [state, setState] = useState<LibraryState>({ status: 'loading' });
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (slug === null) return;
    let alive = true;
    setState({ status: 'loading' });
    fetchLibraryForEventResult(slug)
      .then((r) => {
        if (!alive) return;
        setState(r.failed ? { status: 'failed' } : { status: 'ready', rows: r.rows, linked: new Set(r.linkedIds) });
      })
      .catch((e: unknown) => {
        console.error('[looks] library read', e);
        if (alive) setState({ status: 'failed' });
      });
    return () => { alive = false; };
  }, [slug, nonce]);

  const reload = useCallback(() => { setError(null); setNonce((n) => n + 1); }, []);

  const setLinked = (id: string, on: boolean) =>
    setState((s) => {
      if (s.status !== 'ready') return s;
      const linked = new Set(s.linked);
      if (on) linked.add(id); else linked.delete(id);
      return { ...s, linked };
    });

  const toggleLook = async (exp: Experience) => {
    if (slug === null || state.status !== 'ready' || pending.has(exp.id)) return;
    const wasOn = state.linked.has(exp.id);
    setError(null);
    setLinked(exp.id, !wasOn);
    setPending((p) => new Set(p).add(exp.id));
    let ok = false;
    try {
      ok = wasOn ? await unlinkCatalogItem(slug, exp.id) : await linkCatalogItem(slug, exp.id);
    } catch (e) {
      console.error('[looks] link toggle', e);
    }
    setPending((p) => { const n = new Set(p); n.delete(exp.id); return n; });
    if (!ok) {
      setLinked(exp.id, wasOn);
      const msg = wasOn
        ? `Couldn’t switch off “${exp.name}” — it is still on for guests. Check your connection and try again.`
        : `Couldn’t add “${exp.name}” — nothing changed. Check your connection and try again.`;
      setError(msg);
      push(msg, 'error');
    }
  };

  return { state, pending, error, reload, toggle: toggleLook };
}

/** "Ready-made looks" — the shared library, best fit first. */
function ReadyMadeLooks({
  state, pending, error, onRetry, onToggle, ctx, hideWhenEmpty,
}: {
  state: LibraryState;
  pending: ReadonlySet<string>;
  error: string | null;
  onRetry: () => void;
  onToggle: (exp: Experience) => void;
  ctx: { eventType?: string | null; accentHex?: string | null; text?: string | null; date?: string | null };
  hideWhenEmpty: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const shelves: LibraryShelf<Experience>[] =
    state.status === 'ready' ? libraryShelves(state.rows, ctx, state.linked) : [];
  const total = shelves.reduce((n, s) => n + s.items.length, 0);
  if (state.status === 'ready' && total === 0 && hideWhenEmpty) return null;

  const onCount = state.status === 'ready' ? shelves.reduce((n, s) => n + s.items.filter((i) => state.linked.has(i.id)).length, 0) : 0;
  const capped = showAll ? { shelves, hidden: 0 } : capShelves(shelves, LIBRARY_INITIAL);
  const anySeasonal = shelves.some((s) => s.label !== null);

  return (
    <div className="mt-5" aria-labelledby="ready-made-title" role="group">
      <h3 id="ready-made-title" className="text-[13px] font-semibold uppercase tracking-wide text-brand-muted">
        Ready-made looks{state.status === 'ready' && total > 0 && <span className="font-normal normal-case"> · {onCount} on</span>}
      </h3>

      {state.status === 'loading' && (
        <p className="mt-2 flex min-h-[44px] items-center gap-2 text-[13px] text-brand-muted" role="status">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> Loading ready-made looks…
        </p>
      )}

      {state.status === 'failed' && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2" role="alert">
          <p className="min-w-0 flex-1 text-[13px] leading-snug text-amber-300">
            Couldn’t load the ready-made looks. That’s a connection problem, not an empty library.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 px-4 text-[13px] font-semibold text-brand-fg hover:bg-white/5"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && total === 0 && (
        <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-[13px] text-brand-muted">
          More ready-made looks are on the way. In the meantime, pick from the frames below or make one with AI.
        </p>
      )}

      {state.status === 'ready' && total > 0 && (
        <>
          <p className="mt-1 text-[13px] text-brand-muted">
            Designed to suit your event. Tap one to add it — guests can pick it straight away, no need to save.
          </p>
          {capped.shelves.map((shelf, si) => (
            <div key={shelf.id ?? `rest-${si}`}>
              {(shelf.label !== null || anySeasonal) && (
                <h4 className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-brand-fg">
                  {shelf.label !== null && <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" aria-hidden />}
                  {shelf.label ?? 'More looks'}
                </h4>
              )}
              <ul className="mt-2 grid grid-cols-3 gap-2.5 @xl:grid-cols-5 @5xl:grid-cols-7" role="list">
                {shelf.items.map((exp) => {
                  const on = state.linked.has(exp.id);
                  const busy = pending.has(exp.id);
                  const kind = libraryKindLabel(exp);
                  const thumb = isThumbnailSrc(exp.thumbnail_url) ? exp.thumbnail_url : null;
                  const frame = thumb === null && isThumbnailSrc(exp.asset_url) && exp.kind !== '3d_attachment' ? exp.asset_url : null;
                  return (
                    <li key={exp.id} className="flex flex-col gap-1">
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-busy={busy || undefined}
                        aria-label={`${exp.name}, ${kind}${on ? ', on for guests' : ', off'}`}
                        disabled={busy}
                        onClick={() => onToggle(exp)}
                        className={`relative aspect-[9/16] w-full overflow-hidden rounded-xl border-2 transition ${
                          on ? 'border-[var(--color-accent)]' : 'border-white/10 opacity-75 hover:opacity-100'
                        }`}
                        style={{ background: 'radial-gradient(70% 45% at 50% 38%, #2a2a33, #0c0c10 75%)' }}
                      >
                        <span className="absolute inset-0 grid place-items-center text-brand-muted" aria-hidden>
                          <Sparkles className="h-5 w-5" />
                        </span>
                        {frame !== null && <StandInGuest />}
                        {(thumb ?? frame) !== null && (
                          <img
                            src={(thumb ?? frame) as string}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                            className={`absolute inset-0 h-full w-full ${thumb !== null ? 'object-cover' : 'object-contain'}`}
                          />
                        )}
                        {on && (
                          <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--on-accent,#000)]">
                            <Check className="h-4 w-4" aria-hidden />
                          </span>
                        )}
                        {busy && (
                          <span className="absolute inset-0 grid place-items-center bg-black/40">
                            <Loader2 className="h-5 w-5 text-white motion-safe:animate-spin" aria-hidden />
                          </span>
                        )}
                      </button>
                      <span className="line-clamp-1 text-[11px] text-brand-fg">{exp.name}</span>
                      <span className="line-clamp-1 text-[11px] text-brand-muted">{on ? `${kind} · on` : kind}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {(capped.hidden > 0 || showAll) && total > LIBRARY_INITIAL && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="mt-3 inline-flex min-h-[44px] items-center rounded-xl border border-white/15 px-4 text-[13px] font-semibold text-brand-fg hover:bg-white/5"
            >
              {showAll ? 'Show fewer' : `Show all ${total} looks`}
            </button>
          )}
        </>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-[13px] text-red-300">{error}</p>
      )}
    </div>
  );
}

export default function LooksPicker({ eventUuid, config, eventType, accentHex, onSaved, title = 'Pick your frames & filters', openingLookName, ownFrames = [], library }: Props) {
  const ownOn = ownFrames.filter((f) => f.on).length;
  const lib = useEventLibrary(library?.eventSlug ?? null);
  // Linked ready-made looks the booth shows under Frames / Filters (a combined
  // look is a Frame there), so "Frames · N on" matches what guests can pick.
  const linkedOn = useMemo(() => {
    const n = { frames: 0, filters: 0 };
    if (lib.state.status !== 'ready') return n;
    for (const r of lib.state.rows) {
      if (!lib.state.linked.has(r.id)) continue;
      const tab = boothTabOf(r.kind);
      if (tab === 'frames') n.frames += 1;
      else if (tab === 'filters') n.filters += 1;
    }
    return n;
  }, [lib.state]);
  const openingId = typeof config?.defaultExperienceId === 'string' ? config.defaultExperienceId : null;
  const accent = normalizeHex(accentHex);
  const ranked = useMemo(() => rankLooks({ eventType, accentHex: accent }), [eventType, accent]);
  const template = templateById(eventType ?? undefined);
  const recommended = useMemo(
    () => ({ frames: new Set(template?.borderIds ?? []), filters: new Set(template?.shaderIds ?? []) }),
    [template],
  );

  const initial = useMemo<LooksSelection>(() => {
    const s = selectionFromConfig(config);
    // An empty allow-list means the booth shows EVERYTHING — say so honestly
    // by starting with every tile on, rather than every tile off.
    return {
      borderIds: s.borderIds.length > 0 ? s.borderIds : [...ranked.frameIds],
      shaderIds: s.shaderIds.length > 0 ? s.shaderIds : [...ranked.filterIds],
      frameId: s.frameId,
      palette: s.palette,
    };
    // Only the first render's config seeds the picker; later saves are local.
  }, []);

  const [sel, setSel] = useState<LooksSelection>(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const dirty = JSON.stringify(sel) !== JSON.stringify(initial) || status === 'error';

  const matchColour = sel.palette !== null;
  const palette = sel.palette;
  // An AI frame the event already opens with is kept unless the host picks one here.
  const defaultFrame = effectiveDefaultFrame(sel, config?.defaultExperienceId);
  // effectiveDefaultFrame returns null exactly when another look keeps the
  // opening slot (or nothing is on) — say which, so the host is not left
  // wondering why none of these frames is starred.
  const otherOpensFirst = defaultFrame === null && sel.borderIds.length > 0;
  const canSave = sel.borderIds.length > 0 && sel.shaderIds.length > 0 && !saving;

  const update = (next: Partial<LooksSelection>) => {
    setStatus('idle');
    setSel((s) => ({ ...s, ...next }));
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const finalSel: LooksSelection = { ...sel, frameId: defaultFrame };
    const patch = looksConfigPatch(config, finalSel);
    const ok = await updateEventConfig(eventUuid, patch);
    setSaving(false);
    setStatus(ok ? 'saved' : 'error');
    if (ok) onSaved?.({ ...(config ?? {}), ...patch });
  };

  return (
    // A size container: the frame grid's column count follows THIS card's
    // width, so the same picker reads well in the narrow create screen and
    // the full-width Frames & filters tab (viewport breakpoints made 9:16
    // tiles ~460px tall at 1440).
    <section aria-labelledby="looks-picker-title" className="@container liquid-glass rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="looks-picker-title" className="text-base font-semibold text-brand-fg">{title}</h2>
          <p className="mt-1 text-[13px] text-brand-muted">
            Tap to switch a frame or filter on or off. Guests can pick from everything you leave on.
          </p>
        </div>
        {accent && (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-white/10 px-3 text-[13px] text-brand-fg">
            <input
              type="checkbox"
              checked={matchColour}
              onChange={(e) => update({ palette: e.target.checked ? { accent } : null })}
              className="h-5 w-5 accent-[var(--color-accent)]"
            />
            <span className="inline-block h-4 w-4 rounded-full border border-white/30" style={{ background: accent }} aria-hidden />
            Match frames to my colour
          </label>
        )}
      </div>

      {library && (
        <ReadyMadeLooks
          state={lib.state}
          pending={lib.pending}
          error={lib.error}
          onRetry={lib.reload}
          onToggle={lib.toggle}
          ctx={{ eventType: library.occasion ?? eventType, accentHex: accent, text: library.text, date: library.date }}
          hideWhenEmpty={library.hideWhenEmpty === true}
        />
      )}

      <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-brand-muted">
        Frames <span className="font-normal normal-case">· {sel.borderIds.length + ownOn + linkedOn.frames} on</span>
      </h3>
      {otherOpensFirst && (
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] leading-snug text-brand-muted">
          <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-current text-[var(--color-accent)]" aria-hidden />
          <span>
            <span className="font-semibold text-brand-fg">
              {openingLookName ? `“${openingLookName}”` : 'Your own frame'} opens first.
            </span>{' '}
            Guests can still pick any frame below. To open with one of these instead, tap “Open with this” on it and save.
          </span>
        </p>
      )}
      <ul className="mt-2 grid grid-cols-3 gap-2.5 @xl:grid-cols-5 @5xl:grid-cols-7" role="list">
        {ownFrames.map((f) => {
          const opens = f.on && f.id === openingId;
          return (
            <li key={f.id} className="flex flex-col gap-1">
              <div
                role="img"
                aria-label={`${f.name}, your frame${f.on ? ', on' : ', off'}${opens ? ', opens first' : ''}`}
                className={`relative aspect-[9/16] w-full overflow-hidden rounded-xl border-2 ${
                  f.on ? 'border-[var(--color-accent)]' : 'border-white/10 opacity-55'
                }`}
                style={{ background: 'radial-gradient(70% 45% at 50% 38%, #2a2a33, #0c0c10 75%)' }}
              >
                <StandInGuest />
                {f.imageUrl && <img src={f.imageUrl} alt="" className="absolute inset-0 h-full w-full object-contain" loading="lazy" />}
                {f.on && (
                  <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--on-accent,#000)]">
                    <Check className="h-4 w-4" aria-hidden />
                  </span>
                )}
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  Yours
                </span>
              </div>
              <span className="line-clamp-1 text-[11px] text-brand-fg">{f.name}</span>
              <span className="flex min-h-[44px] items-center justify-center gap-1 text-center text-[11px] text-brand-muted">
                {opens ? (
                  <><Star className="h-3.5 w-3.5 fill-current" aria-hidden /> Opens first</>
                ) : f.on ? 'On for guests' : 'Off — switch on under Your own'}
              </span>
            </li>
          );
        })}
        {ranked.frameIds.map((id) => {
          const b = BORDER_MAP[id];
          if (!b) return null;
          const on = sel.borderIds.includes(id);
          const isDefault = on && id === defaultFrame;
          const name = frameDisplayName(b, matchColour ? palette : null);
          return (
            <li key={id} className="flex flex-col gap-1">
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${name}${on ? ', on' : ', off'}${isDefault ? ', opens first' : ''}`}
                onClick={() => update({ borderIds: toggle(sel.borderIds, id) })}
                className={`relative aspect-[9/16] w-full overflow-hidden rounded-xl border-2 transition ${
                  on ? 'border-[var(--color-accent)]' : 'border-white/10 opacity-55 hover:opacity-80'
                }`}
                style={{ background: 'radial-gradient(70% 45% at 50% 38%, #2a2a33, #0c0c10 75%)' }}
              >
                <StandInGuest />
                <img src={frameDataUrl(b, matchColour ? palette : null)} alt="" className="absolute inset-0 h-full w-full" loading="lazy" />
                {on && (
                  <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--on-accent,#000)]">
                    <Check className="h-4 w-4" aria-hidden />
                  </span>
                )}
                {recommended.frames.has(id) && (
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    Recommended
                  </span>
                )}
              </button>
              <span className="line-clamp-1 text-[11px] text-brand-fg">{name}</span>
              {on && (
                <button
                  type="button"
                  onClick={() => update({ frameId: id })}
                  aria-pressed={isDefault}
                  className={`flex min-h-[44px] items-center justify-center gap-1 rounded-lg text-[11px] ${
                    isDefault ? 'bg-white/10 font-semibold text-brand-fg' : 'text-brand-muted hover:text-brand-fg'
                  }`}
                >
                  <Star className={`h-3.5 w-3.5 ${isDefault ? 'fill-current' : ''}`} aria-hidden />
                  {isDefault ? 'Opens first' : 'Open with this'}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-brand-muted">
        Filters <span className="font-normal normal-case">· {sel.shaderIds.length + linkedOn.filters} on</span>
      </h3>
      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" role="list">
        {ranked.filterIds.map((id) => {
          const on = sel.shaderIds.includes(id);
          const tone = FILTER_LOOKS[id]?.tone ?? '#888888';
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => update({ shaderIds: toggle(sel.shaderIds, id) })}
                className={`flex min-h-[48px] w-full items-center gap-2 rounded-xl border-2 px-3 text-left text-[13px] transition ${
                  on ? 'border-[var(--color-accent)] text-brand-fg' : 'border-white/10 text-brand-muted opacity-70 hover:opacity-100'
                }`}
              >
                <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: `radial-gradient(circle at 35% 35%, #fff8, ${tone})` }} aria-hidden />
                <span className="min-w-0 flex-1 line-clamp-1">{FILTER_NAMES[id] ?? id}</span>
                {recommended.filters.has(id) && <span className="sr-only">Recommended</span>}
                {on && <Check className="h-4 w-4 shrink-0 text-[var(--color-accent)]" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSave || !dirty}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 px-5 text-sm font-semibold text-brand-fg hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Save frames &amp; filters
        </button>
        <p role="status" aria-live="polite" className="text-[13px]">
          {sel.borderIds.length === 0 || sel.shaderIds.length === 0 ? (
            <span className="text-amber-300">Keep at least one frame and one filter on.</span>
          ) : status === 'saved' ? (
            <span className="text-emerald-300">Saved — your booth uses these now.</span>
          ) : status === 'error' ? (
            <span className="text-red-300">Couldn’t save. Check your connection and try again.</span>
          ) : null}
        </p>
      </div>
    </section>
  );
}
