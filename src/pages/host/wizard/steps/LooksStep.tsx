/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Step 4 — the looks. Two decisions, side by side with a live try-on stage:
 *
 *   Pick & choose  the frames, 3D props and effects a guest can try one at a
 *                  time (tap a tile: it goes on the stage and into the booth).
 *   Filters        one tap that puts on a whole look: ready-made ones, the
 *                  library's, or one the host builds from a frame, an effect
 *                  and up to four props.
 *
 * The first filter is what the booth opens with (the host can change it).
 * Writes go through lib/wizard (allow-lists, catalogue links, studio-shaped
 * experience rows), so everything here is also editable in the Studio.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Plus, Sparkles, Star, Trash2, Wand2, X } from 'lucide-react';
import FilterThumb from '../../../../components/booth/FilterThumb';
import type { Experience } from '../../../../types';
import { experienceToDraft } from '../../../../lib/studio/draftMapping';
import { buildStarterDraft } from '../../../../lib/studio/starterScenes';
import { BUNDLED_PROP_MAP } from '../../../../lib/studio/bundledProps';
import { setOpeningLook } from '../../../../lib/host';
import { linkCatalogItem, unlinkCatalogItem } from '../../../../lib/db';
import {
  CUSTOM_FILTER_MAX_PROPS, LOOK_CATEGORIES, buildLookCatalog, composeDraft, countPicked, customFilterError,
  customFilterRow, eventFilters, groupLooks, isPicked, readyFilters, setCategory, starterRow, togglePick,
  wizardRefOf, type EventFilter, type LookCategory, type LookPicks, type WizardLook,
} from '../../../../lib/wizard/looks';
import {
  addFilterRow, applyPicks, currentPicks, fetchLooksData, removeFilterRow, type LooksData,
} from '../../../../lib/wizard/wizardApi';
import { StepHeading } from '../chrome';
import { useWizard } from '../wizardContext';
import LookStage from '../LookStage';

const SAMPLE_FACE = '/starters/soft-portrait.webp';

/* ── Tiles ─────────────────────────────────────────────────────────── */

function LookArt({ look }: { look: WizardLook }) {
  if (look.category === 'effects' && look.source === 'effect') {
    return (
      <span className="wz-tile-art aspect-square">
        <FilterThumb shaderId={look.ref}>
          <span className="absolute inset-0 bg-[radial-gradient(70%_70%_at_40%_35%,#B9B6FF,#4840C6_60%,#2B2A8C)]" />
          <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-white/80" aria-hidden />
        </FilterThumb>
      </span>
    );
  }
  if (look.category === 'frames') {
    return (
      <span className="wz-tile-art aspect-[3/4]">
        <img src={SAMPLE_FACE} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" loading="lazy" />
        {look.thumb && <img src={look.thumb} alt="" className="absolute inset-0 h-full w-full object-contain" loading="lazy" />}
      </span>
    );
  }
  return (
    <span className="wz-tile-art aspect-square bg-[radial-gradient(70%_70%_at_50%_40%,rgba(255,255,255,0.28),rgba(255,255,255,0.04))]">
      {look.thumb
        ? <img src={look.thumb} alt="" className="absolute inset-0 h-full w-full object-contain p-1.5" loading="lazy" />
        : <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-white/70" aria-hidden />}
    </span>
  );
}

function LookTile({ look, on, onTap }: { look: WizardLook; on: boolean; onTap: () => void }) {
  return (
    <button type="button" className="wz-tile" aria-pressed={on} onClick={onTap} title={look.name}>
      <span className="wz-check" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
      <LookArt look={look} />
      <span className="wz-tile-name">{look.name}</span>
    </button>
  );
}

/* ── Try-on state ─────────────────────────────────────────────────── */

interface TryOn {
  frame: WizardLook | null;
  effect: WizardLook | null;
  /** Props on the stage (last two tapped). */
  props: WizardLook[];
}

type Stage =
  | { kind: 'pick'; tryOn: TryOn }
  | { kind: 'filter'; id: string; name: string; draft: ReturnType<typeof composeDraft> };

function tryOnDraft(t: TryOn, libRows: Map<string, Experience>) {
  const library = [t.frame, ...t.props].flatMap((l) => (l && l.source === 'library' && libRows.get(l.ref) ? [libRows.get(l.ref)!] : []));
  return composeDraft({
    frameId: t.frame?.source === 'frame' ? t.frame.ref : null,
    effectId: t.effect?.ref ?? null,
    classics: t.props.filter((p) => p.source === 'classic').map((p) => p.ref),
    library,
  });
}

function tryOnCaption(t: TryOn): string {
  const parts = [t.frame?.name, ...t.props.map((p) => p.name), t.effect?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Nothing on yet';
}

/* ── Custom filter builder ─────────────────────────────────────────── */

interface Builder {
  name: string;
  frame: WizardLook | null;
  effect: WizardLook | null;
  props: WizardLook[];
}

function FilterBuilder({ catalog, libRows, value, onChange, onSave, onCancel, saving, error }: {
  catalog: Record<LookCategory, WizardLook[]>;
  libRows: Map<string, Experience>;
  value: Builder;
  onChange: (b: Builder) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<LookCategory>('frames');
  const frames = catalog.frames.filter((l) => l.source === 'frame' || (l.source === 'library' && libRows.has(l.ref)));
  const list = tab === 'frames' ? frames : tab === 'props' ? catalog.props : catalog.effects.filter((l) => l.source === 'effect');
  const isOn = (l: WizardLook) => (tab === 'frames' ? value.frame?.key === l.key : tab === 'effects' ? value.effect?.key === l.key : value.props.some((p) => p.key === l.key));
  const tap = (l: WizardLook) => {
    if (tab === 'frames') onChange({ ...value, frame: value.frame?.key === l.key ? null : l });
    else if (tab === 'effects') onChange({ ...value, effect: value.effect?.key === l.key ? null : l });
    else {
      const has = value.props.some((p) => p.key === l.key);
      if (has) onChange({ ...value, props: value.props.filter((p) => p.key !== l.key) });
      else if (value.props.length < CUSTOM_FILTER_MAX_PROPS) onChange({ ...value, props: [...value.props, l] });
    }
  };
  return (
    <div className="mt-4 rounded-[24px] bg-[rgba(15,13,51,0.28)] p-4 sm:p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] wz-enter">
      <div className="flex items-center gap-2">
        <Wand2 className="h-5 w-5" aria-hidden />
        <p className="wz-display text-[19px]">Make your own filter</p>
        <button type="button" onClick={onCancel} className="ml-auto grid place-items-center h-10 w-10 rounded-full hover:bg-white/10" aria-label="Close the filter builder"><X className="h-5 w-5" /></button>
      </div>
      <label htmlFor="wz-fname" className="wz-label mt-4">Name</label>
      <input id="wz-fname" className="wz-input" maxLength={40} placeholder="Party royalty" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="wz-tabs" role="tablist">
          {LOOK_CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} className="wz-tab" onClick={() => setTab(c.id)}>
              {c.label}
              <span className="wz-count">{c.id === 'frames' ? (value.frame ? 1 : 0) : c.id === 'effects' ? (value.effect ? 1 : 0) : value.props.length}</span>
            </button>
          ))}
        </div>
        <p className="text-[12.5px] text-white/65">{tab === 'props' ? `Up to ${CUSTOM_FILTER_MAX_PROPS} props` : 'Pick one'}</p>
      </div>
      <div className="mt-3 wz-shelf max-h-[340px] lg:overflow-y-auto">
        {list.map((l) => <LookTile key={l.key} look={l} on={isOn(l)} onTap={() => tap(l)} />)}
      </div>
      {error && <p role="alert" className="mt-3 text-[13.5px] text-[#FFD2DA]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="pressable rounded-full px-4 min-h-11 text-[14px]">Cancel</button>
        <button type="button" onClick={onSave} disabled={saving} className="pressable bg-foil inline-flex items-center gap-2 rounded-full px-5 min-h-11 text-[14px] font-semibold disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save filter
        </button>
      </div>
    </div>
  );
}

/* ── The step ─────────────────────────────────────────────────────── */

export default function LooksStep() {
  const w = useWizard();
  const { ev } = w;
  const [data, setData] = useState<LooksData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [picks, setPicks] = useState<LookPicks | null>(null);
  const [tab, setTab] = useState<LookCategory>('frames');
  const [stage, setStage] = useState<Stage>({ kind: 'pick', tryOn: { frame: null, effect: null, props: [] } });
  // The last pick-and-choose try-on, kept while a filter is on the stage so
  // tapping a tile or opening the builder carries on from it, not from blank.
  const lastTryOn = useRef<TryOn>({ frame: null, effect: null, props: [] });
  if (stage.kind === 'pick') lastTryOn.current = stage.tryOn;
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [busyFilter, setBusyFilter] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const evRef = useRef(ev);
  evRef.current = ev;
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async () => {
    setLoadFailed(false);
    const d = await fetchLooksData(ev.slug);
    if (d.failed) setLoadFailed(true);
    setData(d);
    const p = currentPicks(evRef.current, d);
    setPicks(p);
    // Start the stage the way a guest would see it: a frame, a hat, shades.
    const cat = buildLookCatalog(d.library, d.categoryNames);
    const frame = cat.frames.find((l) => isPicked(p, l)) ?? cat.frames[0] ?? null;
    const props = ['prop-royal-crown', 'prop-neon-shades']
      .map((id) => cat.props.find((l) => l.source === 'classic' && l.ref === id))
      .filter((l): l is WizardLook => l !== undefined);
    setStage({ kind: 'pick', tryOn: { frame, effect: null, props } });
  }, [ev.slug]);
  useEffect(() => { void load(); }, [load]);

  const catalog = useMemo(() => (data ? buildLookCatalog(data.library, data.categoryNames) : null), [data]);
  const libRows = useMemo(() => new Map((data?.library ?? []).map((r) => [r.id, r as Experience])), [data]);

  /* Picks autosave: serialised, so two quick taps never race each other. */
  const saving = useRef<Promise<boolean> | null>(null);
  const queued = useRef<LookPicks | null>(null);
  const dirty = useRef(false);
  const savePicks = useCallback(async (): Promise<boolean> => {
    if (saving.current) { await saving.current; }
    const target = queued.current;
    const d = dataRef.current;
    if (!target || !d) return true;
    queued.current = null;
    const run = (async () => {
      w.reportSave('saving');
      const res = await applyPicks(evRef.current, d, target);
      w.setEv(res.ev);
      evRef.current = res.ev;
      setData(res.data);
      dataRef.current = res.data;
      w.reportSave(res.failures === 0 ? 'saved' : 'error');
      if (res.failures > 0) setNote(`${res.failures} change${res.failures === 1 ? '' : 's'} didn’t save. We’ll try again when you continue.`);
      else setNote(null);
      if (res.failures > 0) queued.current = target;
      return res.failures === 0;
    })();
    saving.current = run;
    const ok = await run;
    saving.current = null;
    return ok;
  }, [w]);

  useEffect(() => {
    if (!picks || !dirty.current) return;
    queued.current = picks;
    const t = setTimeout(() => void savePicks(), 900);
    return () => clearTimeout(t);
  }, [picks, savePicks]);

  useEffect(() => {
    w.setBeforeContinue(async () => {
      if (!dirty.current) {
        // First visit with no taps: still write the explicit list the host saw.
        const d = dataRef.current;
        if (d && picks) queued.current = picks;
      }
      return savePicks();
    });
    return () => w.setBeforeContinue(null);
  }, [w, savePicks, picks]);

  const empty = picks !== null && picks.frames.length + picks.effects.length + picks.library.length + picks.classics.length === 0;
  useEffect(() => { w.setBlocked(empty ? 'Pick at least one look for guests.' : null); }, [empty]); // eslint-disable-line react-hooks/exhaustive-deps

  const tapLook = (look: WizardLook) => {
    if (!picks) return;
    const wasOn = isPicked(picks, look);
    dirty.current = true;
    setPicks(togglePick(picks, look));
    // Turning a look ON puts it on the stage; turning it off takes it off.
    setStage((s) => {
      const t: TryOn = s.kind === 'pick' ? s.tryOn : lastTryOn.current;
      if (look.category === 'frames') return { kind: 'pick', tryOn: { ...t, frame: wasOn ? (t.frame?.key === look.key ? null : t.frame) : look } };
      if (look.category === 'effects') return { kind: 'pick', tryOn: { ...t, effect: wasOn ? (t.effect?.key === look.key ? null : t.effect) : look } };
      const rest = t.props.filter((p) => p.key !== look.key);
      return { kind: 'pick', tryOn: { ...t, props: wasOn ? rest : [...rest, look].slice(-2) } };
    });
  };

  const bulk = (cat: LookCategory, on: boolean) => {
    if (!picks || !catalog) return;
    dirty.current = true;
    setPicks(setCategory(picks, catalog[cat], on));
  };

  /* Filters */
  const linkedComposites = useMemo(
    () => (data ? data.library.filter((r) => r.kind === 'composite' && data.linkedIds.includes(r.id)) : []),
    [data],
  );
  const filters: EventFilter[] = useMemo(() => (data ? eventFilters(data.eventRows, linkedComposites) : []), [data, linkedComposites]);
  const libraryComposites = useMemo(() => (data ? data.library.filter((r) => r.kind === 'composite') : []), [data]);
  const openingId = typeof ev.config.defaultExperienceId === 'string' ? ev.config.defaultExperienceId : null;
  const opening = filters.find((f) => f.id === openingId) ?? null;

  const setOpening = async (id: string | null) => {
    w.reportSave('saving');
    const res = await setOpeningLook({ slug: ev.slug, eventUuid: ev.id }, id);
    w.reportSave(res.ok ? 'saved' : 'error');
    if (res.ok) w.setEv({ ...evRef.current, config: { ...evRef.current.config, defaultExperienceId: id } });
    return res.ok;
  };

  /** After adding the event's first filter, the booth opens on it. */
  const afterAdd = async (id: string) => {
    if (!opening) await setOpening(id);
  };

  const showFilter = (f: { id: string; name: string }, row: Experience | null, starterId?: string) => {
    const draft = starterId ? buildStarterDraft(starterId) : row ? experienceToDraft(row) : null;
    if (draft) setStage({ kind: 'filter', id: f.id, name: f.name, draft });
  };

  const toggleStarter = async (sceneId: string, name: string) => {
    if (!data) return;
    const existing = data.eventRows.find((r) => wizardRefOf(r) === `starter:${sceneId}`);
    setBusyFilter(`starter:${sceneId}`);
    w.reportSave('saving');
    if (existing) {
      const ok = await removeFilterRow(ev.slug, existing.id);
      if (ok) {
        setData({ ...data, eventRows: data.eventRows.filter((r) => r.id !== existing.id) });
        if (openingId === existing.id) await setOpening(null);
      }
      w.reportSave(ok ? 'saved' : 'error');
    } else {
      const draft = starterRow(sceneId);
      const row = draft ? await addFilterRow(ev.slug, draft) : null;
      if (row) {
        setData((d) => (d ? { ...d, eventRows: [...d.eventRows, row] } : d));
        showFilter({ id: row.id, name }, null, sceneId);
        await afterAdd(row.id);
      }
      w.reportSave(row ? 'saved' : 'error');
    }
    setBusyFilter(null);
  };

  const toggleComposite = async (row: Experience) => {
    if (!data) return;
    const on = data.linkedIds.includes(row.id);
    setBusyFilter(row.id);
    w.reportSave('saving');
    const ok = on ? await unlinkCatalogItem(ev.slug, row.id) : await linkCatalogItem(ev.slug, row.id);
    if (ok) {
      setData({ ...data, linkedIds: on ? data.linkedIds.filter((x) => x !== row.id) : [...data.linkedIds, row.id] });
      if (!on) { showFilter(row, row); await afterAdd(row.id); }
      else if (openingId === row.id) await setOpening(null);
    }
    w.reportSave(ok ? 'saved' : 'error');
    setBusyFilter(null);
  };

  const removeCustom = async (id: string) => {
    if (!data) return;
    setBusyFilter(id);
    w.reportSave('saving');
    const ok = await removeFilterRow(ev.slug, id);
    if (ok) {
      setData({ ...data, eventRows: data.eventRows.filter((r) => r.id !== id) });
      if (openingId === id) await setOpening(null);
    }
    w.reportSave(ok ? 'saved' : 'error');
    setBusyFilter(null);
  };

  const builderSpec = (b: Builder) => ({
    name: b.name,
    frameId: b.frame?.source === 'frame' ? b.frame.ref : null,
    effectId: b.effect?.ref ?? null,
    classics: b.props.filter((p) => p.source === 'classic').map((p) => p.ref),
    library: [b.frame, ...b.props].flatMap((l) => (l && l.source === 'library' && libRows.get(l.ref) ? [libRows.get(l.ref)!] : [])),
  });

  const onBuilderChange = (b: Builder) => {
    setBuilder(b);
    setBuilderError(null);
    setStage({ kind: 'filter', id: 'builder', name: b.name.trim() || 'Your filter', draft: composeDraft(builderSpec(b)) });
  };

  const saveBuilder = async () => {
    if (!builder || !data) return;
    const spec = builderSpec(builder);
    const why = customFilterError(spec);
    if (why) { setBuilderError(why); return; }
    setBusyFilter('builder');
    w.reportSave('saving');
    const draft = customFilterRow(spec);
    const row = draft ? await addFilterRow(ev.slug, draft) : null;
    setBusyFilter(null);
    if (!row) { w.reportSave('error'); setBuilderError('That didn’t save. Check your connection and try again.'); return; }
    setData((d) => (d ? { ...d, eventRows: [...d.eventRows, row] } : d));
    w.reportSave('saved');
    await afterAdd(row.id);
    setBuilder(null);
  };

  const stageDraft = useMemo(
    () => (stage.kind === 'pick' ? tryOnDraft(stage.tryOn, libRows) : stage.draft),
    [stage, libRows],
  );
  const caption = stage.kind === 'pick' ? tryOnCaption(stage.tryOn) : stage.name;

  if (!data || !catalog || !picks) {
    return (
      <>
        <StepHeading step="looks" />
        <div className="h-64 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" aria-label="Loading the looks" /></div>
      </>
    );
  }

  const list = catalog[tab];
  const pickedCount = countPicked(picks, list);
  const ready = readyFilters();

  return (
    <>
      <StepHeading step="looks" />
      {loadFailed && (
        <p role="alert" className="mb-4 rounded-2xl bg-[rgba(255,120,140,0.18)] px-4 py-3 text-[14.5px] flex flex-wrap items-center gap-3">
          We couldn’t load the shared library, so only the built-in looks are showing.
          <button type="button" onClick={() => void load()} className="underline underline-offset-2">Try again</button>
        </p>
      )}
      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.8fr)] gap-6 lg:gap-8 items-start">
        <div className="flex flex-col gap-5 min-w-0 order-2 lg:order-1">
          {/* Pick & choose */}
          <section className="liquid-glass rounded-[28px] p-5 sm:p-6 wz-enter" aria-labelledby="wz-pick-title">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="wz-pick-title" className="wz-display text-[22px]">Pick & choose</h2>
              <p className="text-[13.5px] text-white/70">Guests try these on one at a time. Tap to add or remove.</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="wz-tabs" role="tablist" aria-label="Look type">
                {LOOK_CATEGORIES.map((c) => (
                  <button key={c.id} type="button" role="tab" aria-selected={tab === c.id} className="wz-tab" onClick={() => setTab(c.id)}>
                    {c.label}
                    <span className="wz-count">{countPicked(picks, catalog[c.id])}</span>
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-1 text-[13.5px]">
                <button type="button" onClick={() => bulk(tab, true)} className="rounded-full px-3 min-h-10 hover:bg-white/10 disabled:opacity-50" disabled={pickedCount === list.length}>Add all</button>
                <button type="button" onClick={() => bulk(tab, false)} className="rounded-full px-3 min-h-10 hover:bg-white/10 disabled:opacity-50" disabled={pickedCount === 0}>Clear</button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-5">
              {groupLooks(list).map((g) => (
                <div key={g.group}>
                  <p className="text-[13px] font-semibold text-white/80 mb-2">
                    {g.group} <span className="font-normal text-white/50">· {countPicked(picks, g.looks)} of {g.looks.length}</span>
                  </p>
                  <div className="wz-shelf">
                    {g.looks.map((l) => <LookTile key={l.key} look={l} on={isPicked(picks, l)} onTap={() => tapLook(l)} />)}
                  </div>
                </div>
              ))}
            </div>
            {note && <p role="status" className="mt-3 text-[13px] text-[#FFE1A8]">{note}</p>}
          </section>

          {/* Filters */}
          <section className="liquid-glass rounded-[28px] p-5 sm:p-6 wz-enter" style={{ animationDelay: '60ms' }} aria-labelledby="wz-filters-title">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="wz-filters-title" className="wz-display text-[22px]">Filters</h2>
              <p className="text-[13.5px] text-white/70">A whole look in one tap: frame, effect and props together.</p>
            </div>

            {filters.length > 0 && (
              <div className="mt-4">
                <p className="text-[13px] font-semibold text-white/80 mb-2">On your booth</p>
                <ul className="flex flex-col gap-2">
                  {filters.map((f) => {
                    const row = data.eventRows.find((r) => r.id === f.id) ?? linkedComposites.find((r) => r.id === f.id) ?? null;
                    return (
                      <li key={f.id} className="flex items-center gap-3 rounded-2xl bg-white/7 p-2 pr-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
                        <button type="button" onClick={() => showFilter(f, row, f.starterId)} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label={`Preview ${f.name}`}>
                          <span className="h-14 w-11 rounded-xl overflow-hidden bg-white/10 shrink-0">
                            {f.thumb && <img src={f.thumb} alt="" className="h-full w-full object-cover" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[14.5px] font-medium truncate">{f.name}</span>
                            <span className="block text-[12px] text-white/60">{f.kind === 'custom' ? 'Yours' : f.kind === 'library' ? 'From the library' : f.kind === 'power' ? 'Power-up' : 'Ready-made'}</span>
                          </span>
                        </button>
                        {opening?.id === f.id ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white text-[#1A1740] px-2.5 py-1 text-[12px] font-semibold"><Star className="h-3 w-3" aria-hidden /> Opens first</span>
                        ) : (
                          <button type="button" onClick={() => void setOpening(f.id)} className="rounded-full px-3 min-h-9 text-[12.5px] hover:bg-white/10">Open with this</button>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${f.name}`}
                          disabled={busyFilter !== null}
                          onClick={() => void (f.kind === 'library' && row ? toggleComposite(row) : f.starterId ? toggleStarter(f.starterId, f.name) : removeCustom(f.id))}
                          className="grid place-items-center h-10 w-10 rounded-full hover:bg-white/10"
                        >
                          {busyFilter === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="mt-5">
              <p className="text-[13px] font-semibold text-white/80 mb-2">Ready-made</p>
              <div className="wz-shelf">
                {ready.map((s) => {
                  const on = data.eventRows.some((r) => wizardRefOf(r) === `starter:${s.id}`);
                  const busy = busyFilter === `starter:${s.id}`;
                  return (
                    <button key={s.id} type="button" className="wz-tile" aria-pressed={on} disabled={busyFilter !== null && !busy} onClick={() => void toggleStarter(s.id, s.name)} title={s.blurb}>
                      <span className="wz-check" aria-hidden>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                      <span className="wz-tile-art aspect-[3/4]"><img src={s.preview} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" /></span>
                      <span className="wz-tile-name">{s.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {libraryComposites.length > 0 && (
              <div className="mt-5">
                <p className="text-[13px] font-semibold text-white/80 mb-2">From the library</p>
                <div className="wz-shelf">
                  {libraryComposites.map((r) => {
                    const on = data.linkedIds.includes(r.id);
                    return (
                      <button key={r.id} type="button" className="wz-tile" aria-pressed={on} disabled={busyFilter !== null && busyFilter !== r.id} onClick={() => void toggleComposite(r)}>
                        <span className="wz-check" aria-hidden>{busyFilter === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                        <span className="wz-tile-art aspect-[3/4]">{r.thumbnail_url && <img src={r.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}</span>
                        <span className="wz-tile-name">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {builder ? (
              <FilterBuilder
                catalog={catalog}
                libRows={libRows}
                value={builder}
                onChange={onBuilderChange}
                onSave={() => void saveBuilder()}
                onCancel={() => { setBuilder(null); setBuilderError(null); }}
                saving={busyFilter === 'builder'}
                error={builderError}
              />
            ) : (
              <button
                type="button"
                onClick={() => onBuilderChange({
                  name: '',
                  frame: lastTryOn.current.frame,
                  effect: lastTryOn.current.effect,
                  props: lastTryOn.current.props,
                })}
                className="mt-5 w-full rounded-[22px] border-2 border-dashed border-white/30 hover:border-white/70 transition px-5 py-5 flex items-center gap-3 text-left"
              >
                <span className="grid place-items-center h-11 w-11 rounded-full bg-white text-[#1A1740] shrink-0"><Plus className="h-5 w-5" aria-hidden /></span>
                <span>
                  <span className="block text-[15.5px] font-semibold">Make your own filter</span>
                  <span className="block text-[13px] text-white/70">Starts from your last try-on. Add a frame, an effect and up to {CUSTOM_FILTER_MAX_PROPS} props.</span>
                </span>
              </button>
            )}
          </section>
        </div>

        <div className="order-1 lg:order-2 lg:sticky lg:top-[88px] wz-enter">
          <LookStage draft={stageDraft} caption={caption} />
          <p className="mt-3 text-center text-[12.5px] text-white/65">
            {countPicked(picks, [...catalog.frames, ...catalog.props, ...catalog.effects])} looks to pick from · {filters.length} {filters.length === 1 ? 'filter' : 'filters'}
          </p>
        </div>
      </div>
    </>
  );
}

/** Bundled prop names for the Launch summary. */
export function classicName(id: string): string {
  return BUNDLED_PROP_MAP[id]?.name ?? id;
}
