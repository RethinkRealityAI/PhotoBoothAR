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
 */
import { useMemo, useState } from 'react';
import { Check, Loader2, Star } from 'lucide-react';
import { BORDER_MAP, frameDataUrl, frameDisplayName } from '../../lib/borders';
import { FILTER_SHADERS } from '../../lib/shaders';
import { FILTER_LOOKS, effectiveDefaultFrame, looksConfigPatch, rankLooks, selectionFromConfig, type LooksSelection } from '../../lib/themeMatch';
import { templateById } from '../../lib/eventTemplates';
import { normalizeHex } from '../../lib/themeDerive';
import { updateEventConfig } from '../../lib/host';

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

export default function LooksPicker({ eventUuid, config, eventType, accentHex, onSaved, title = 'Pick your frames & filters', openingLookName }: Props) {
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

      <h3 className="mt-5 text-[13px] font-semibold uppercase tracking-wide text-brand-muted">
        Frames <span className="font-normal normal-case">· {sel.borderIds.length} on</span>
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
                  <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
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
        Filters <span className="font-normal normal-case">· {sel.shaderIds.length} on</span>
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
