/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Looks step. Two decisions, side by side with a live try-on stage:
 *
 *   Pick & choose  the frames, 3D props, face paint and effects a guest can
 *                  try one at a time (tap a tile: it goes on the stage and into
 *                  the booth). An occasion dropdown and shelf pills narrow
 *                  each tab; frames scroll sideways, the rest scroll down.
 *   Filters        one tap that puts on a whole look: ready-made ones, the
 *                  library's, or one the host builds from a frame, props,
 *                  face paint and an effect, all on one screen.
 *
 * The first filter is what the booth opens with (the host can change it).
 * Writes go through lib/wizard (allow-lists, catalogue links, studio-shaped
 * experience rows), so everything here is also editable in the Studio.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, Sparkles, Star, Trash2, Wand2, X } from 'lucide-react';
import FilterThumb from '../../../../components/booth/FilterThumb';
import { FaceThumb, facePaintThumbDataUrl } from '../../../../components/studio/FacePaintBuilder';
import type { Experience } from '../../../../types';
import { experienceToDraft } from '../../../../lib/studio/draftMapping';
import { buildStarterDraft } from '../../../../lib/studio/starterScenes';
import { BUNDLED_PROP_MAP } from '../../../../lib/studio/bundledProps';
import { setOpeningLook } from '../../../../lib/host';
import { linkCatalogItem, unlinkCatalogItem } from '../../../../lib/db';
import {
  CUSTOM_FILTER_MAX_PROPS, LOOK_CATEGORIES, LOOK_TAGS, NO_LOOK_FILTER, buildLookCatalog, composeDraft, countPicked,
  customFilterError, customFilterRow, eventFilters, filterLooks, groupLooks, isPicked, occasionTag, paintSpec,
  readyFilters, setCategory, starterRow, tagsIn, togglePick, wizardRefOf,
  type EventFilter, type LookCategory, type LookFilter, type LookPicks, type LookTag, type WizardLook,
} from '../../../../lib/wizard/looks';
import {
  addFilterRow, applyPicks, currentPicks, fetchLooksData, removeFilterRow, type LooksData,
} from '../../../../lib/wizard/wizardApi';
import { StepPanel, StepShell, TabPanel, WizardTabs, type TabDef } from '../chrome';
import { stepDef } from '../../../../lib/wizard/wizardModel';
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
  if (look.source === 'paint') {
    const spec = paintSpec(look.ref);
    return (
      <span className="wz-tile-art aspect-square bg-[radial-gradient(70%_70%_at_50%_40%,rgba(255,255,255,0.22),rgba(255,255,255,0.03))]">
        {spec && <FaceThumb spec={spec} logo={null} size={160} className="absolute inset-0 h-full w-full" />}
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

/**
 * A sideways shelf with arrow buttons for mouse users (trackpads and phones
 * just swipe). `rows` = 2 for frames, 1 inside the filter builder.
 */
function Shelf({ label, meta, rows, children }: { label: string; meta?: string; rows: 1 | 2; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    sync();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync, children]);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  const scrolls = !(edge.start && edge.end);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[13px] font-semibold text-white/85 min-w-0 truncate">
          {label}{meta && <span className="font-normal text-white/50"> · {meta}</span>}
        </p>
        {scrolls && (
          <span className="ml-auto hidden sm:flex items-center gap-1">
            <button type="button" onClick={() => page(-1)} disabled={edge.start} aria-label={`Scroll ${label} back`} className="wz-arrow"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => page(1)} disabled={edge.end} aria-label={`Scroll ${label} forward`} className="wz-arrow"><ChevronRight className="h-4 w-4" /></button>
          </span>
        )}
      </div>
      <div ref={ref} onScroll={sync} className={rows === 2 ? 'wz-strip-2' : 'wz-strip-1'}>{children}</div>
    </div>
  );
}

/** Occasion dropdown + shelf pills (+ "Picked") over one tab. */
function FilterBar({ looks, picks, filter, onChange, eventTag, noun }: {
  looks: readonly WizardLook[];
  picks: LookPicks;
  filter: LookFilter;
  onChange: (f: LookFilter) => void;
  eventTag: LookTag | null;
  noun: string;
}) {
  const tags = tagsIn(looks, eventTag);
  // Shelf pills count within the chosen occasion, so a pill never leads to nothing.
  const inTag = filterLooks(looks, { ...NO_LOOK_FILTER, tag: filter.tag }, picks);
  const groups = groupLooks(inTag);
  const picked = countPicked(picks, inTag);
  const label = (id: LookTag) => LOOK_TAGS.find((t) => t.id === id)?.label ?? id;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
      {tags.length > 0 && (
        <label className="wz-select shrink-0">
          <span className="sr-only">Occasion</span>
          <select
            value={filter.tag ?? ''}
            onChange={(e) => onChange({ ...filter, tag: (e.target.value || null) as LookTag | null, group: null })}
          >
            <option value="">All occasions</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {label(t)}{t === eventTag ? ' · your event' : ''} ({looks.filter((l) => l.tags?.includes(t)).length})
              </option>
            ))}
          </select>
          <ChevronDown className="h-4 w-4 pointer-events-none" aria-hidden />
        </label>
      )}
      <div className="wz-pills" role="group" aria-label={`Show ${noun}s`}>
        <button type="button" className="wz-pill" aria-pressed={filter.group === null && !filter.onlyPicked} onClick={() => onChange({ ...filter, group: null, onlyPicked: false })}>
          All <span className="opacity-60">{inTag.length}</span>
        </button>
        {groups.length > 1 && groups.map((g) => (
          <button key={g.group} type="button" className="wz-pill" aria-pressed={filter.group === g.group} onClick={() => onChange({ ...filter, group: g.group, onlyPicked: false })}>
            {g.group} <span className="opacity-60">{g.looks.length}</span>
          </button>
        ))}
        <button type="button" className="wz-pill" aria-pressed={filter.onlyPicked} onClick={() => onChange({ ...filter, group: null, onlyPicked: !filter.onlyPicked })}>
          <Check className="h-3.5 w-3.5" aria-hidden /> Picked <span className="opacity-60">{picked}</span>
        </button>
      </div>
    </div>
  );
}

/* ── Try-on state ─────────────────────────────────────────────────── */

interface TryOn {
  frame: WizardLook | null;
  effect: WizardLook | null;
  paint: WizardLook | null;
  /** Props on the stage (last two tapped). */
  props: WizardLook[];
}

const NO_TRY_ON: TryOn = { frame: null, effect: null, paint: null, props: [] };

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
    paintId: t.paint?.ref ?? null,
  });
}

function tryOnCaption(t: TryOn): string {
  const parts = [t.frame?.name, ...t.props.map((p) => p.name), t.paint?.name, t.effect?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Nothing on yet';
}

/* ── Custom filter builder ─────────────────────────────────────────── */

interface Builder {
  name: string;
  frame: WizardLook | null;
  effect: WizardLook | null;
  paint: WizardLook | null;
  props: WizardLook[];
}

type BuilderSlot = 'frame' | 'props' | 'paint' | 'effect';

type FilterView = 'booth' | 'add' | 'own';

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
  const sections: { slot: BuilderSlot; label: string; hint: string; looks: WizardLook[] }[] = [
    { slot: 'frame', label: 'Frame', hint: 'Pick one', looks: catalog.frames.filter((l) => l.source === 'frame' || (l.source === 'library' && libRows.has(l.ref))) },
    { slot: 'props', label: '3D props', hint: `Up to ${CUSTOM_FILTER_MAX_PROPS}`, looks: catalog.props },
    { slot: 'paint', label: 'Face paint', hint: 'Pick one', looks: catalog.paint },
    { slot: 'effect', label: 'Effect', hint: 'Pick one', looks: catalog.effects.filter((l) => l.source === 'effect') },
  ];
  const isOn = (slot: BuilderSlot, l: WizardLook) =>
    slot === 'props' ? value.props.some((p) => p.key === l.key) : value[slot]?.key === l.key;
  const tap = (slot: BuilderSlot, l: WizardLook) => {
    if (slot !== 'props') { onChange({ ...value, [slot]: value[slot]?.key === l.key ? null : l }); return; }
    const has = value.props.some((p) => p.key === l.key);
    if (has) onChange({ ...value, props: value.props.filter((p) => p.key !== l.key) });
    else if (value.props.length < CUSTOM_FILTER_MAX_PROPS) onChange({ ...value, props: [...value.props, l] });
  };
  const chosen = (slot: BuilderSlot) =>
    slot === 'props' ? (value.props.length > 0 ? value.props.map((p) => p.name).join(', ') : null) : value[slot]?.name ?? null;
  return (
    <div className="wz-card-inset wz-enter">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center h-10 w-10 rounded-full bg-white/12 shrink-0"><Wand2 className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="wz-display text-[19px] leading-tight">Make your own combo</p>
          <p className="mt-0.5 text-[13px] text-white/70">Combine a frame, props, face paint and an effect into one tap. Everything you pick shows on the preview.</p>
        </div>
        <button type="button" onClick={onCancel} className="grid place-items-center h-10 w-10 rounded-full hover:bg-white/10 shrink-0" aria-label="Close the combo builder"><X className="h-5 w-5" /></button>
      </div>
      <label htmlFor="wz-fname" className="wz-label mt-4">Name</label>
      <input id="wz-fname" className="wz-input" maxLength={40} placeholder="Party royalty" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      <div className="mt-4 flex flex-col gap-4">
        {sections.map((sec) => (
          <Shelf key={sec.slot} rows={1} label={sec.label} meta={chosen(sec.slot) ?? sec.hint}>
            {sec.looks.map((l) => <LookTile key={l.key} look={l} on={isOn(sec.slot, l)} onTap={() => tap(sec.slot, l)} />)}
          </Shelf>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-[13.5px] text-[#FFD2DA]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="pressable rounded-full px-4 min-h-11 text-[14px]">Cancel</button>
        <button type="button" onClick={onSave} disabled={saving} className="pressable bg-foil inline-flex items-center gap-2 rounded-full px-5 min-h-11 text-[14px] font-semibold disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save combo
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
  // The Filters tab sits beside the four look types in the same tab row.
  const [onFilters, setOnFilters] = useState(false);
  const [filter, setFilter] = useState<LookFilter>(NO_LOOK_FILTER);
  const [stage, setStage] = useState<Stage>({ kind: 'pick', tryOn: NO_TRY_ON });
  // The last pick-and-choose try-on, kept while a filter is on the stage so
  // tapping a tile or opening the builder carries on from it, not from blank.
  const lastTryOn = useRef<TryOn>(NO_TRY_ON);
  if (stage.kind === 'pick') lastTryOn.current = stage.tryOn;
  const [builder, setBuilder] = useState<Builder | null>(null);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [busyFilter, setBusyFilter] = useState<string | null>(null);
  /** Inside the Filters tab: what is on the booth, adding ready-made ones, or
   *  making one (null = the default: the booth list once there is one). */
  const [filterView, setFilterView] = useState<FilterView | null>(null);
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
    // Start the stage the way a guest would see it: a frame and a crown (the
    // neon shades that used to sit beside it were retired 2026-11-23).
    const cat = buildLookCatalog(d.library, d.categoryNames);
    const frame = cat.frames.find((l) => isPicked(p, l)) ?? cat.frames[0] ?? null;
    const props = ['prop-royal-crown']
      .map((id) => cat.props.find((l) => l.source === 'classic' && l.ref === id))
      .filter((l): l is WizardLook => l !== undefined);
    setStage({ kind: 'pick', tryOn: { ...NO_TRY_ON, frame, props } });
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
      const res = await applyPicks(evRef.current, d, target, facePaintThumbDataUrl);
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

  const empty = picks !== null && picks.frames.length + picks.effects.length + picks.library.length + picks.classics.length + picks.paints.length === 0;
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
      if (look.category === 'paint') return { kind: 'pick', tryOn: { ...t, paint: wasOn ? (t.paint?.key === look.key ? null : t.paint) : look } };
      const rest = t.props.filter((p) => p.key !== look.key);
      return { kind: 'pick', tryOn: { ...t, props: wasOn ? rest : [...rest, look].slice(-2) } };
    });
  };

  /** "Add all" / "Clear" act on what the dropdown and pills leave showing. */
  const bulk = (looks: readonly WizardLook[], on: boolean) => {
    if (!picks) return;
    dirty.current = true;
    setPicks(setCategory(picks, looks, on));
  };
  const switchTab = (c: LookCategory) => { setOnFilters(false); setTab(c); setFilter(NO_LOOK_FILTER); };
  const eventTag = occasionTag(ev.event_type);

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
    paintId: b.paint?.ref ?? null,
    library: [b.frame, ...b.props].flatMap((l) => (l && l.source === 'library' && libRows.get(l.ref) ? [libRows.get(l.ref)!] : [])),
  });

  const onBuilderChange = (b: Builder) => {
    setBuilder(b);
    setBuilderError(null);
    setStage({ kind: 'filter', id: 'builder', name: b.name.trim() || 'Your combo', draft: composeDraft(builderSpec(b)) });
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
    setFilterView('booth');
  };

  const stageDraft = useMemo(
    () => (stage.kind === 'pick' ? tryOnDraft(stage.tryOn, libRows) : stage.draft),
    [stage, libRows],
  );
  const caption = stage.kind === 'pick' ? tryOnCaption(stage.tryOn) : stage.name;

  if (!data || !catalog || !picks) {
    return (
      <StepShell
        sheetLabel={stepDef('looks').title}
        panel={(
          <StepPanel step="looks">
            <div className="h-64 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin" aria-label="Loading the looks" /></div>
          </StepPanel>
        )}
        preview={<div className="wz-stage w-[min(100%,220px)] lg:w-full" aria-hidden />}
      />
    );
  }

  const all = catalog[tab];
  const list = filterLooks(all, filter, picks);
  const shownPicked = countPicked(picks, list);
  const filtered = filter.tag !== null || filter.group !== null || filter.onlyPicked;
  const noun = LOOK_CATEGORIES.find((c) => c.id === tab)?.noun ?? 'look';
  const ready = readyFilters();
  const mainTab: LookCategory | 'filters' = onFilters ? 'filters' : tab;
  const mainTabs: TabDef<LookCategory | 'filters'>[] = [
    ...LOOK_CATEGORIES.map((c) => {
      const n = countPicked(picks, catalog[c.id]);
      return { id: c.id, label: c.label, short: c.short, count: n, ariaLabel: `${c.label}, ${n} on` };
    }),
    { id: 'filters', label: 'Combos', count: filters.length, ariaLabel: `Combos, ${filters.length} on` },
  ];
  const view: FilterView = filterView ?? (filters.length > 0 ? 'booth' : 'add');
  const startBuilder = () => onBuilderChange({
    name: '',
    frame: lastTryOn.current.frame,
    effect: lastTryOn.current.effect,
    paint: lastTryOn.current.paint,
    props: lastTryOn.current.props,
  });
  const pickView = (v: FilterView) => {
    setFilterView(v);
    // Making one starts from what is on the preview, as the old button did.
    if (v === 'own' && builder === null) startBuilder();
  };

  const controls = (
          <StepPanel
            step="looks"
            tabs={(
              <WizardTabs<LookCategory | 'filters'>
                idBase="wz-looks"
                label="Look type"
                className="wz-tabs-fit"
                value={mainTab}
                onChange={(id) => (id === 'filters' ? setOnFilters(true) : switchTab(id))}
                tabs={mainTabs}
              />
            )}
            notice={loadFailed ? (
              <p role="alert" className="mb-4 rounded-2xl bg-[rgba(255,120,140,0.18)] px-4 py-3 text-[14px] flex flex-wrap items-center gap-3">
                We couldn’t load the shared library, so only the built-in looks are showing.
                <button type="button" onClick={() => void load()} className="underline underline-offset-2 min-h-11">Try again</button>
              </p>
            ) : undefined}
          >
            <TabPanel idBase="wz-looks" value={mainTab}>
            {!onFilters && (<>
            <div>
              <FilterBar key={tab} looks={all} picks={picks} filter={filter} onChange={setFilter} eventTag={eventTag} noun={noun} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-[12.5px] text-white/65">
              <p className="min-w-0">
                {tab === 'frames'
                  ? 'Borders go round the edge of the photo. Overlays sit on top of it.'
                  : tab === 'paint'
                    ? 'Painted right onto the face, and it moves with it.'
                    : tab === 'effects'
                      ? 'A camera effect over the whole picture.'
                      : 'Worn on the head and face, and they follow every move.'}
              </p>
              <div className="ml-auto flex items-center gap-0.5 shrink-0 text-[13px] text-white">
                <button type="button" onClick={() => bulk(list, true)} className="rounded-full px-3 min-h-11 hover:bg-white/10 disabled:opacity-45" disabled={list.length === 0 || shownPicked === list.length}>
                  {filtered ? 'Add these' : 'Add all'}
                </button>
                <button type="button" onClick={() => bulk(list, false)} className="rounded-full px-3 min-h-11 hover:bg-white/10 disabled:opacity-45" disabled={shownPicked === 0}>
                  Clear
                </button>
              </div>
            </div>
            {list.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-white/6 px-5 py-8 text-center">
                <p className="text-[14.5px]">{filter.onlyPicked ? `No ${noun}s picked yet.` : `No ${noun}s match.`}</p>
                <button type="button" onClick={() => setFilter(NO_LOOK_FILTER)} className="mt-2 text-[13.5px] underline underline-offset-2">Show all {noun}s</button>
              </div>
            ) : tab === 'frames' ? (
              <div className="mt-4 flex flex-col gap-5">
                {groupLooks(list).map((g) => (
                  <Shelf key={g.group} rows={g.looks.length > 4 ? 2 : 1} label={g.group} meta={`${countPicked(picks, g.looks)} of ${g.looks.length} on`}>
                    {g.looks.map((l) => <LookTile key={l.key} look={l} on={isPicked(picks, l)} onTap={() => tapLook(l)} />)}
                  </Shelf>
                ))}
              </div>
            ) : (
              <div className="wz-scrollgrid mt-4" tabIndex={0} aria-label={`${LOOK_CATEGORIES.find((c) => c.id === tab)?.label} to pick from`}>
                {groupLooks(list).map((g) => (
                  <div key={g.group} className="wz-scrollgrid-group">
                    <p className="wz-scrollgrid-head">
                      {g.group} <span className="font-normal text-white/50">· {countPicked(picks, g.looks)} of {g.looks.length} on</span>
                    </p>
                    <div className="wz-grid">
                      {g.looks.map((l) => <LookTile key={l.key} look={l} on={isPicked(picks, l)} onTap={() => tapLook(l)} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            </>)}

            {/* Filters: a whole look in one tap — on the booth · add · make one */}
            {onFilters && (<>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <WizardTabs<FilterView>
                idBase="wz-filters"
                label="Combos"
                className="wz-tabs-even wz-tabs-3 sm:!inline-grid sm:!w-auto"
                value={view}
                onChange={pickView}
                tabs={[
                  { id: 'booth', label: 'On your booth', short: 'Yours', count: filters.length },
                  { id: 'add', label: 'Ready-made', short: 'Add' },
                  { id: 'own', label: 'Make your own', short: 'Make' },
                ]}
              />
              <p className="min-w-0 text-[12.5px] text-white/65">A whole look in one tap. The first one is what the booth opens with.</p>
            </div>

            <TabPanel idBase="wz-filters" value={view} className="mt-4">
            {view === 'booth' && (filters.length === 0 ? (
              <div className="rounded-[20px] bg-white/6 px-5 py-8 text-center">
                <p className="text-[14.5px]">No combos on your booth yet.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => pickView('add')} className="pressable liquid-glass-raised rounded-full px-4 min-h-11 text-[14px]">Add a ready-made one</button>
                  <button type="button" onClick={() => pickView('own')} className="pressable liquid-glass-raised rounded-full px-4 min-h-11 text-[14px]">Make your own</button>
                </div>
              </div>
            ) : (
              <div>
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
                          <button type="button" onClick={() => void setOpening(f.id)} className="rounded-full px-3 min-h-11 text-[12.5px] hover:bg-white/10">Open with this</button>
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
            ))}

            {view === 'add' && (<>
            <div>
              <p className="text-[13px] font-semibold text-white/85 mb-2">Ready-made</p>
              <div className="wz-strip-1">
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
                <p className="text-[13px] font-semibold text-white/85 mb-2">From the library</p>
                <div className="wz-strip-1">
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
            </>)}

            {view === 'own' && (builder ? (
              <FilterBuilder
                catalog={catalog}
                libRows={libRows}
                value={builder}
                onChange={onBuilderChange}
                onSave={() => void saveBuilder()}
                onCancel={() => { setBuilder(null); setBuilderError(null); setFilterView('add'); }}
                saving={busyFilter === 'builder'}
                error={builderError}
              />
            ) : (
              <button
                type="button"
                onClick={startBuilder}
                className="w-full rounded-[22px] border-2 border-dashed border-white/30 hover:border-white/70 transition px-5 py-5 flex items-center gap-3 text-left"
              >
                <span className="grid place-items-center h-11 w-11 rounded-full bg-white text-[#1A1740] shrink-0"><Plus className="h-5 w-5" aria-hidden /></span>
                <span>
                  <span className="block text-[15.5px] font-semibold">Make your own combo</span>
                  <span className="block text-[13px] text-white/70">Combine a frame, props, face paint and an effect into one tap. Starts from what’s on the preview.</span>
                </span>
              </button>
            ))}
            </TabPanel>
            </>)}
            </TabPanel>
            {note && <p role="status" className="mt-3 text-[13px] text-[#FFE1A8]">{note}</p>}
          </StepPanel>
  );
  const previewNode = (
    <div className="flex flex-col items-center w-full">
          <LookStage draft={stageDraft} caption={caption} />
          <p className="mt-3 text-center text-[12.5px] text-white/65">
            {countPicked(picks, [...catalog.frames, ...catalog.props, ...catalog.paint, ...catalog.effects])} looks to pick from · {filters.length} {filters.length === 1 ? 'filter' : 'filters'}
          </p>
    </div>
  );

  return <StepShell panel={controls} preview={previewNode} sheetLabel={stepDef('looks').title} />;
}

/** Bundled prop names for the Launch summary. */
export function classicName(id: string): string {
  return BUNDLED_PROP_MAP[id]?.name ?? id;
}
