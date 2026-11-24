/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copy settings (/admin/library) — take one prop's settings and paste them onto
 * one or many other library items, so colourways of the same piece are set up
 * once instead of one by one.
 *
 *   From   one single-piece prop (the open item, or the one picked here).
 *   Copy   any of three groups: Fit & placement · Look · Behaviour.
 *   Onto   a checklist. Likely variants of the source (same piece in another
 *          colour, matched by name, file name and model size) come first and
 *          are ticked for you; everything else is searchable below.
 *
 * Writes go through admin-api copy_library_settings, IN PLACE (the same rule as
 * Save fit): every event using a target gets the change. A dry run first says
 * exactly what will change, and when any target is used by an event the admin
 * confirms with that count before anything is written.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Search, Sparkles } from 'lucide-react';
import Modal from '../../ui/Modal';
import {
  copyLibrarySettings, copyStatusText, libraryErrorText, type CopyResult,
} from '../../../lib/adminLibrary';
import {
  suggestVariants, type SettingsGroup, type VariantCandidate,
} from '../../../../supabase/functions/admin-api/librarySettings.ts';

export interface CopyItem {
  id: string;
  name: string;
  kind: string;
  thumb: string | null;
  copyable: boolean;
  modelSize: number | null;
  fileName: string | null;
  linkCount: number;
}

const GROUPS: ReadonlyArray<{ id: SettingsGroup; label: string; hint: string }> = [
  { id: 'fit', label: 'Fit & placement', hint: 'Where it sits, its size and tilt, and whether your head hides parts of it.' },
  { id: 'look', label: 'Look', hint: 'Material finish and colour wash.' },
  { id: 'behaviour', label: 'Behaviour', hint: 'Idle animation, face triggers and tracking mode.' },
];

const LABEL = 'font-label uppercase tracking-luxe text-[10px] text-brand-muted/60';
const PRIMARY_BTN =
  'pressable inline-flex items-center justify-center gap-1.5 rounded-full bg-foil text-[color:var(--on-accent)] px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold disabled:opacity-40';
const SOFT_BTN =
  'pressable inline-flex items-center justify-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.11] px-3.5 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/85 transition-colors disabled:opacity-40';

function Thumb({ item }: { item: CopyItem }) {
  return item.thumb ? (
    <img src={item.thumb} alt="" className="w-11 h-11 rounded-lg object-contain bg-white/[0.04] shrink-0" loading="lazy" />
  ) : (
    <span className="w-11 h-11 rounded-lg bg-white/[0.04] shrink-0" aria-hidden />
  );
}

const candidate = (i: CopyItem): VariantCandidate => ({ id: i.id, name: i.name, kind: i.kind, fileName: i.fileName, modelSize: i.modelSize });

type Phase =
  | { at: 'pick' }
  | { at: 'checking' }
  | { at: 'confirm'; results: CopyResult[]; events: number }
  | { at: 'copying' }
  | { at: 'done'; results: CopyResult[]; applied: number };

export default function CopySettingsModal({
  items, sourceId: initialSource, targetIds: initialTargets, onClose, onApplied,
}: {
  /** Every library item (non-copyable ones are shown, disabled, with a reason). */
  items: readonly CopyItem[];
  sourceId: string | null;
  /** Pre-ticked targets (a bulk selection). Empty = tick the likely variants. */
  targetIds: readonly string[];
  onClose: () => void;
  /** Called after a real write with the ids that changed. */
  onApplied: (changedIds: string[]) => void;
}) {
  const copyable = useMemo(() => items.filter((i) => i.copyable), [items]);
  const [sourceId, setSourceId] = useState<string | null>(
    initialSource && copyable.some((i) => i.id === initialSource) ? initialSource : null,
  );
  const source = copyable.find((i) => i.id === sourceId) ?? null;
  const [groups, setGroups] = useState<SettingsGroup[]>(['fit']);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ at: 'pick' });

  const suggested = useMemo(
    () => (source ? suggestVariants(candidate(source), copyable.map(candidate)) : []),
    [source, copyable],
  );
  const [targets, setTargets] = useState<Set<string>>(() => new Set(initialTargets.filter((t) => t !== initialSource)));
  // A new source re-ticks ITS variants, unless the admin arrived with a selection.
  useEffect(() => {
    if (initialTargets.length > 0) {
      setTargets((t) => { const n = new Set(t); if (sourceId) n.delete(sourceId); return n; });
      return;
    }
    setTargets(new Set(suggested));
  }, [sourceId, suggested, initialTargets.length]);

  const q = query.trim().toLowerCase();
  const others = items.filter((i) => i.id !== sourceId && !suggested.includes(i.id));
  const shownOthers = q ? others.filter((i) => i.name.toLowerCase().includes(q)) : others.filter((i) => targets.has(i.id));
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const picked = [...targets].filter((id) => byId.get(id)?.copyable && id !== sourceId);
  const eventsUsing = picked.reduce((n, id) => n + (byId.get(id)?.linkCount ?? 0), 0);

  const toggle = (id: string) => setTargets((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (g: SettingsGroup) => setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  const run = async (dryRun: boolean) => {
    if (!source) return;
    setError(null);
    setPhase({ at: dryRun ? 'checking' : 'copying' });
    const { data, error: err } = await copyLibrarySettings({ sourceId: source.id, targetIds: picked, groups, dryRun });
    if (err || !data) {
      setError(libraryErrorText(err ?? 'unknown'));
      setPhase({ at: 'pick' });
      return;
    }
    if (dryRun) {
      const willChange = data.results.filter((r) => r.status === 'changed');
      const events = willChange.reduce((n, r) => n + (byId.get(r.id)?.linkCount ?? 0), 0);
      if (willChange.length > 0 && events === 0 && data.results.every((r) => r.status === 'changed')) {
        // Nothing live is affected and nothing is skipped: no need to stop and ask.
        await run(false);
        return;
      }
      setPhase({ at: 'confirm', results: data.results, events });
      return;
    }
    setPhase({ at: 'done', results: data.results, applied: data.applied });
    const changed = data.results.filter((r) => r.status === 'changed').map((r) => r.id);
    if (changed.length > 0) onApplied(changed);
  };

  const groupWords = GROUPS.filter((g) => groups.includes(g.id)).map((g) => g.label.toLowerCase()).join(', ');

  const resultList = (results: CopyResult[]) => (
    <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
      {results.map((r) => {
        const it = byId.get(r.id);
        const ok = r.status === 'changed' || r.status === 'same';
        return (
          <li key={r.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-2 py-1.5">
            {it && <Thumb item={it} />}
            <div className="min-w-0 flex-1">
              <p className="font-sans text-sm text-brand-fg truncate">{it?.name ?? 'Unknown item'}</p>
              <p className={`font-sans text-[11px] ${ok ? 'text-brand-muted/70' : 'text-amber-200/90'}`}>
                {phase.at === 'confirm' && r.status === 'changed' ? 'Will be updated' : copyStatusText(r.status)}
                {r.notes?.includes('colours_skipped') ? ' · recoloured parts kept (a different model)' : ''}
              </p>
            </div>
            {r.status === 'changed' && phase.at === 'done' && <Check className="w-4 h-4 text-emerald-300 shrink-0" aria-hidden />}
          </li>
        );
      })}
    </ul>
  );

  if (phase.at === 'confirm') {
    const n = phase.results.filter((r) => r.status === 'changed').length;
    return (
      <Modal title="Check before copying" onClose={onClose} maxWidthClass="max-w-lg" dismissOnScrim={false}>
        <p className="font-sans text-sm text-brand-fg/85 leading-relaxed mb-4">
          {n === 0
            ? 'Nothing would change: every item already matches or was skipped.'
            : `${n} item${n === 1 ? '' : 's'} will get ${source?.name ?? 'the source'}’s ${groupWords}.`}
          {phase.events > 0 && n > 0 && (
            <> They are used by <span className="text-brand-fg font-semibold">{phase.events} event{phase.events === 1 ? '' : 's'}</span>, which get the change straight away.</>
          )}
        </p>
        {resultList(phase.results)}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setPhase({ at: 'pick' })} className={SOFT_BTN}>Back</button>
          {n > 0 && (
            <button type="button" onClick={() => void run(false)} className={PRIMARY_BTN}>
              <Copy className="w-3.5 h-3.5" aria-hidden /> Copy to {n}
            </button>
          )}
        </div>
      </Modal>
    );
  }

  if (phase.at === 'done') {
    return (
      <Modal title={phase.applied > 0 ? `Copied to ${phase.applied} item${phase.applied === 1 ? '' : 's'}` : 'Nothing changed'} onClose={onClose} maxWidthClass="max-w-lg">
        {resultList(phase.results)}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setPhase({ at: 'pick' })} className={SOFT_BTN}>Copy more</button>
          <button type="button" onClick={onClose} className={PRIMARY_BTN}>Done</button>
        </div>
      </Modal>
    );
  }

  const busy = phase.at === 'checking' || phase.at === 'copying';
  const row = (item: CopyItem) => (
    <label key={item.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 min-h-14 ${item.copyable ? 'cursor-pointer hover:bg-white/[0.04]' : 'opacity-50'}`}>
      <input
        type="checkbox"
        className="w-5 h-5 accent-[color:var(--color-accent)] shrink-0"
        checked={item.copyable && targets.has(item.id)}
        disabled={!item.copyable || busy}
        onChange={() => toggle(item.id)}
      />
      <Thumb item={item} />
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-sm text-brand-fg truncate">{item.name}</span>
        <span className="block font-sans text-[11px] text-brand-muted/60">
          {!item.copyable ? 'A scene or frame, so settings cannot be pasted here' : item.linkCount > 0 ? `${item.linkCount} event${item.linkCount === 1 ? '' : 's'} use it` : 'Not used by any event yet'}
        </span>
      </span>
    </label>
  );

  return (
    <Modal title="Copy settings" onClose={onClose} maxWidthClass="max-w-2xl" dismissOnScrim={false}>
      <div className="flex flex-col gap-5">
        <section>
          <span className={LABEL}>Copy from</span>
          <div className="mt-2 flex items-center gap-3">
            {source && <Thumb item={source} />}
            <select
              aria-label="The item to copy settings from"
              value={sourceId ?? ''}
              onChange={(e) => setSourceId(e.target.value || null)}
              disabled={busy}
              className="flex-1 min-w-0 px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25"
            >
              <option value="">Choose a prop…</option>
              {copyable.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
        </section>

        <section>
          <span className={LABEL}>What to copy</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {GROUPS.map((g) => {
              const on = groups.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() => toggleGroup(g.id)}
                  className={`pressable text-left rounded-2xl border px-3.5 py-3 min-h-11 transition-colors ${
                    on ? 'border-[color:var(--color-accent)] bg-white/[0.07]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="flex items-center gap-2 font-sans text-sm text-brand-fg">
                    <span className={`w-4 h-4 rounded grid place-items-center border ${on ? 'bg-[color:var(--color-accent)] border-transparent' : 'border-white/30'}`}>
                      {on && <Check className="w-3 h-3 text-[color:var(--on-accent)]" aria-hidden />}
                    </span>
                    {g.label}
                  </span>
                  <span className="mt-1 block font-sans text-[11px] text-brand-muted/65 leading-snug">{g.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <span className={LABEL}>Paste onto</span>
          {source && suggested.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-sans text-xs text-brand-fg/80">
                  <Sparkles className="w-3.5 h-3.5" aria-hidden /> Looks like other colours of {source.name}
                </p>
                <button
                  type="button"
                  className="font-sans text-[11px] text-brand-muted/70 hover:text-brand-fg min-h-11 px-2"
                  onClick={() => setTargets((t) => {
                    const n = new Set(t);
                    const all = suggested.every((id) => n.has(id));
                    for (const id of suggested) { if (all) n.delete(id); else n.add(id); }
                    return n;
                  })}
                >
                  {suggested.every((id) => targets.has(id)) ? 'Untick all' : 'Tick all'}
                </button>
              </div>
              <div className="mt-1 flex flex-col">
                {suggested.map((id) => { const it = byId.get(id); return it ? row(it) : null; })}
              </div>
            </div>
          )}
          <div className="mt-3 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/50" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={source && suggested.length > 0 ? 'Add others: search the library' : 'Search the library'}
              aria-label="Search the library for items to paste onto"
              className="w-full pl-9 pr-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-base sm:text-sm text-brand-fg focus:outline-none focus:border-white/25"
            />
          </div>
          <div className="mt-1 flex flex-col max-h-64 overflow-y-auto pr-1">
            {shownOthers.slice(0, 60).map((it) => row(it))}
            {q && shownOthers.length === 0 && <p className="font-sans text-xs text-brand-muted/60 px-2 py-3">Nothing matches “{query}”.</p>}
          </div>
        </section>

        {error && <p role="alert" className="font-sans text-xs text-rose-200">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="font-sans text-xs text-brand-muted/70">
            {!source ? 'Choose what to copy from.' : groups.length === 0 ? 'Choose at least one group.' : picked.length === 0
              ? 'Tick the items to paste onto.'
              : `${picked.length} item${picked.length === 1 ? '' : 's'}${eventsUsing > 0 ? ` · used by ${eventsUsing} event${eventsUsing === 1 ? '' : 's'}` : ''}`}
          </p>
          <button
            type="button"
            disabled={!source || groups.length === 0 || picked.length === 0 || busy}
            onClick={() => void run(true)}
            className={PRIMARY_BTN}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
            {busy ? 'Copying…' : picked.length > 0 ? `Copy to ${picked.length}` : 'Copy'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
