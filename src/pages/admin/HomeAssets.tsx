/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/home-assets ("Homepage") — the asset manager for the homepage "/"
 * (BeamyPage): what Beamy tries on in the hero; the AR step's frames, 3D
 * props, filters and effects (order, names, a frame's occasion, Beamy's line,
 * and each prop's anchor, size and offset on him, with a live preview); the
 * floating scene props; and the photos of the live wall, the keepsake album,
 * the virtual-celebrations card and the challenge step; plus the demo event
 * the real QR code opens. The homepage's words stay in code.
 *
 * Storage: `landing_content.home` (lib/homeAssets), so it shares the
 * /admin/landing draft → publish flow. That row holds the WHOLE landing blob,
 * so this screen never saves a stale copy of the other sections: every save
 * re-reads the server draft and replaces only `home` in it.
 *
 * Every slot is an override. Empty = the page's built-in asset, said in the
 * UI, so clearing a slot can never blank a section of the public page.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, Eye, Info, Move, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import ConfirmModal from '../../components/ui/ConfirmModal';
import LoadError from '../../components/ui/LoadError';
import HomeAssetPicker, { AssetThumb, type PickedAsset } from '../../components/admin/HomeAssetPicker';
import { fetchLandingContentAdmin, publishLandingContent, saveLandingDraft } from '../../lib/admin';
import { normalizeLandingContent } from '../../lib/landingContent';
import { AR_CATEGORIES, HOME_ASSET_DEFAULTS, arTitle, lookThumb } from '../../lib/beamyAssets';
import {
  ANCHOR_IDS, ANCHOR_PRESETS, AR_LOOKS_MAX, FIT_AT_MAX,
  HERO_LOOKS_MAX, KEEPSAKE_MIN_PHOTOS, KEEPSAKE_PHOTOS_MAX, LINE_MAX, NAME_MAX, OCCASION_MAX, SCENE_PROPS_MAX, SLUG_RE,
  VIRTUAL_PHOTOS_MAX, WALL_MIN_PHOTOS, WALL_PHOTOS_MAX,
  anchorOf, countOverrides, lookUrlKind, normalizeHomeAssets, presetFit, resolveAssetUrl, slugifyLookId,
  type AnchorId, type AssetKind, type HomeLook, type HomeOverrides, type LookCategory, type PropFit,
} from '../../lib/homeAssets';
import { editableDefaults } from '../../lib/homeAssetSources';
import { FIT_REACH, fitBounds } from '../../lib/beamyFitAdjust';

const BeamyPreview = lazy(() => import('../../components/admin/BeamyPreview'));
const BeamyAdjust = lazy(() => import('../../components/admin/BeamyAdjust'));

const input =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-[color:var(--color-accent)]/50';
const labelCls = 'font-label uppercase tracking-luxe text-[10px] text-brand-muted/70';
const chipBtn =
  'pressable inline-flex items-center gap-1 rounded-full px-3 min-h-11 font-label uppercase tracking-luxe text-[10px] border bg-white/[0.03] border-white/10 text-brand-muted/80 hover:text-brand-fg transition-colors disabled:opacity-40';
const iconBtn =
  'pressable grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-brand-muted/80 hover:text-brand-fg disabled:opacity-30';
const tabCls = (on: boolean) =>
  `pressable min-h-11 rounded-full px-4 font-label uppercase tracking-luxe text-[10px] border transition-colors ${
    on ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg' : 'bg-white/[0.03] border-white/10 text-brand-muted/70 hover:text-brand-fg'
  }`;

const CATEGORY_LABEL: Record<LookCategory, string> = { frame: 'Frames', prop: '3D props', filter: 'Filters', effect: 'Effects' };
const CATEGORY_ONE: Record<LookCategory, string> = { frame: 'frame', prop: '3D prop', filter: 'filter', effect: 'effect' };
/** The hero's floating-prop spots, in the stage's order (pages/beamy/BeamyStage CRYSTALS). */
const SCENE_SPOT_NAMES = [
  'Hero box, top-left corner', 'Hero box, bottom-right corner', 'Beside him, front right',
  'Behind him, left (laptops)', 'Behind him, right, raised (laptops)', 'Hero box, upper middle, small (laptops)', 'Hero box, lower left, small (laptops)',
];

const canon = (h: HomeOverrides) => JSON.stringify(normalizeHomeAssets(h));

function fileLabel(url: string): string {
  const last = decodeURIComponent(url.split('/').pop() ?? url);
  return last.replace(/^[0-9a-f-]{36}-/i, '');
}
/** A picture for any look tile: its own thumb, the library's, the frame itself. */
function tileThumb(l: HomeLook): string | undefined {
  if (l.thumb !== undefined) return l.thumb;
  if (l.category === 'frame') return lookThumb(l) ?? l.url;
  if (l.category === 'prop') return l.url.startsWith('/models/') ? (lookThumb(l) ?? undefined) : undefined;
  return /\.(webp|png|jpe?g)$/i.test(l.url) ? l.url : undefined;
}

/* ── Building blocks ────────────────────────────────────────────────── */

function Section({ title, hint, children, defaultOpen = false, badge }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean; badge?: string }) {
  return (
    <details open={defaultOpen} className="group liquid-glass rounded-2xl">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 min-h-11">
        <h2 className="font-serif text-lg text-brand-fg">{title}</h2>
        {badge !== undefined && <span className="rounded-full bg-[color:var(--color-accent)]/15 px-2 py-0.5 font-sans text-[11px] text-brand-fg/85">{badge}</span>}
        {hint !== undefined && <span className="hidden md:inline truncate font-sans text-[11px] text-brand-muted/70">{hint}</span>}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-brand-muted/60 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] px-3 py-2.5 font-sans text-xs leading-relaxed text-brand-muted/80">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-muted/60" />
      <span>{children}</span>
    </p>
  );
}

interface PickerRequest {
  title: string;
  accept: AssetKind[];
  category?: LookCategory;
  multiple?: boolean;
  onPick: (a: PickedAsset[]) => void;
}

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; show: string }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2">
        <span className={labelCls}>{label}</span>
        <span className="font-sans text-[11px] tabular-nums text-brand-muted/80">{show}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full min-h-11 accent-[color:var(--color-accent)]" />
    </label>
  );
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cm = (m: number) => `${m >= 0 ? '+' : ''}${(m * 100).toFixed(1)} cm`;

/**
 * Where a prop sits on Beamy: an anchor preset (head, face, neck, ears), then
 * size and offset relative to it. The sliders are centred on the chosen
 * anchor, so nudging never flips to another anchor's ranges. "Adjust on
 * Beamy" opens the direct-manipulation mode (components/admin/BeamyAdjust)
 * on the SAME fit, with the same ranges (lib/beamyFitAdjust fitBounds).
 */
function FitEditor({ fit, onChange, lookId, look, mode, onAdjusting }: {
  fit: PropFit | undefined;
  onChange: (f: PropFit) => void;
  lookId: string;
  /** The look the adjust mode shows him wearing (its fit is replaced live). */
  look: HomeLook;
  mode: 'hero' | 'ar';
  onAdjusting: (on: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<AnchorId>(() => anchorOf(fit));
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => { setAnchor(anchorOf(fit)); /* a different look: read its anchor */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookId]);
  const p = ANCHOR_PRESETS[anchor].fit;
  const f = fit ?? presetFit(anchor);
  const set = (q: Partial<PropFit>) => onChange({ ...f, ...q });
  const setAt = (i: 0 | 1 | 2, v: number) => {
    const at: [number, number, number] = [f.at[0], f.at[1], f.at[2]];
    at[i] = clampN(v, -FIT_AT_MAX, FIT_AT_MAX);
    set({ at });
  };
  const bounds = fitBounds(anchor);
  const [wMin, wMax] = bounds.width;
  const R = FIT_REACH;
  const adjust = (on: boolean) => { setAdjusting(on); onAdjusting(on); };
  return (
    <div className="space-y-3">
      <div>
        <span className={labelCls}>Anchor on Beamy</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ANCHOR_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={anchor === id}
              onClick={() => { setAnchor(id); onChange(presetFit(id)); }}
              className={`${chipBtn} ${anchor === id ? '!border-[color:var(--color-accent)]/60 !bg-[color:var(--color-accent)]/15 !text-brand-fg' : ''}`}>
              {ANCHOR_PRESETS[id].label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 font-sans text-[11px] text-brand-muted/70">Picking an anchor resets size and offset to its starting point.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
        <Slider label="Size" value={clampN(f.width, wMin, wMax)} min={wMin} max={wMax} step={0.001} onChange={(v) => set({ width: v })} show={`${Math.round((f.width / p.width) * 100)}%`} />
        <Slider label="Up / down" value={clampN(f.at[1], p.at[1] - R, p.at[1] + R)} min={p.at[1] - R} max={p.at[1] + R} step={0.002} onChange={(v) => setAt(1, v)} show={cm(f.at[1] - p.at[1])} />
        <Slider label="Back / forward" value={clampN(f.at[2], p.at[2] - R, p.at[2] + R)} min={p.at[2] - R} max={p.at[2] + R} step={0.002} onChange={(v) => setAt(2, v)} show={cm(f.at[2] - p.at[2])} />
        <Slider label="Left / right" value={clampN(f.at[0], p.at[0] - R, p.at[0] + R)} min={p.at[0] - R} max={p.at[0] + R} step={0.002} onChange={(v) => setAt(0, v)} show={cm(f.at[0] - p.at[0])} />
        <Slider label="Tilt" value={f.tilt ?? 0} min={bounds.tilt[0]} max={bounds.tilt[1]} step={0.01} onChange={(v) => set({ tilt: v })} show={`${Math.round(((f.tilt ?? 0) * 180) / Math.PI)}°`} />
        <Slider label="Rotate" value={f.roll ?? 0} min={bounds.roll[0]} max={bounds.roll[1]} step={0.01} onChange={(v) => set({ roll: v })} show={`${Math.round(((f.roll ?? 0) * 180) / Math.PI)}°`} />
        {anchor === 'ears' && (
          <Slider label="Ear spacing" value={f.pair ?? p.pair ?? 0.4} min={bounds.pair[0]} max={bounds.pair[1]} step={0.005} onChange={(v) => set({ pair: v })} show={`${((f.pair ?? 0) * 100).toFixed(0)} cm`} />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => adjust(true)}
          className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full bg-foil px-4 font-label uppercase tracking-luxe text-[10px] text-[color:var(--on-accent)]">
          <Move className="h-3.5 w-3.5" /> Adjust on Beamy
        </button>
        <button type="button" className={chipBtn} onClick={() => onChange(presetFit(anchor))}><RotateCcw className="h-3 w-3" /> Reset placement</button>
      </div>
      {adjusting && (
        <Suspense fallback={null}>
          <BeamyAdjust look={look} fit={f} anchor={anchor} mode={mode} onFit={onChange}
            onDone={() => adjust(false)} onCancel={() => adjust(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** One URL slot (the challenge photo). */
function SingleSlot({ label, kind, value, fallback, onChange, openPicker }: {
  label: string; kind: AssetKind; value: string | undefined; fallback?: string;
  onChange: (url: string | undefined) => void; openPicker: (r: PickerRequest) => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] p-3">
      <span className={labelCls}>{label}</span>
      <div className="mt-2 flex items-center gap-3">
        <div className="w-20 shrink-0"><AssetThumb thumb={value ?? fallback} kind={kind} /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-xs text-brand-fg/85">{value === undefined ? 'Built-in' : fileLabel(value)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className={chipBtn} onClick={() => openPicker({ title: `Choose: ${label}`, accept: [kind], onPick: (a) => onChange(a[0]?.url) })}>
              {value === undefined ? 'Choose' : 'Replace'}
            </button>
            {value !== undefined && <button className={chipBtn} onClick={() => onChange(undefined)}><RotateCcw className="h-3 w-3" /> Use built-in</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** An ordered list of photos (wall, keepsake album, virtual card). */
function PhotoList({ urls, max, title, onChange, openPicker }: {
  urls: string[]; max: number; title: string; onChange: (urls: string[]) => void; openPicker: (r: PickerRequest) => void;
}) {
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= urls.length) return;
    const next = urls.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div>
      {urls.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
          {urls.map((u, i) => (
            <li key={u} className="rounded-xl border border-white/10 bg-white/[0.03] p-1.5">
              <AssetThumb thumb={u} kind="image" />
              <p className="mt-1 truncate font-sans text-[10px] text-brand-muted/70" title={fileLabel(u)}>{i + 1}. {fileLabel(u)}</p>
              <div className="mt-1 flex justify-between">
                <button aria-label="Move earlier" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                <button aria-label="Remove" className={iconBtn} onClick={() => onChange(urls.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
                <button aria-label="Move later" className={iconBtn} disabled={i === urls.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={chipBtn} disabled={urls.length >= max}
          onClick={() => openPicker({ title, accept: ['image'], multiple: true, onPick: (a) => onChange([...urls, ...a.map((p) => p.url).filter((u) => !urls.includes(u))].slice(0, max)) })}>
          <Plus className="h-3 w-3" /> Add photos
        </button>
        {urls.length > 0 && <button className={chipBtn} onClick={() => onChange([])}><RotateCcw className="h-3 w-3" /> Use built-in</button>}
        <span className="font-sans text-[11px] text-brand-muted/70">{urls.length}/{max}</span>
      </div>
    </div>
  );
}

/** A fresh look from a pick, with an id unique in `taken`. */
function lookFromPick(p: PickedAsset, cat: LookCategory, taken: Set<string>): HomeLook | null {
  const base: HomeLook = p.look ?? { id: '', name: p.name, category: cat, url: p.url, ...(p.thumb !== undefined ? { thumb: p.thumb } : {}) };
  if (lookUrlKind(base.url, cat) === undefined) return null;
  const stem = slugifyLookId(base.id !== '' ? base.id : `${cat}-${p.name}`) || cat;
  let id = stem;
  for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`;
  taken.add(id);
  return { ...base, id, category: cat, ...(cat === 'prop' && base.fit === undefined ? { fit: presetFit('crown') } : {}) };
}

/**
 * A look list: the built-in list (read-only, previewable) until the owner
 * customises it; then category tabs, tiles, and a detail panel to rename,
 * reorder, remove and place each look.
 */
function LooksEditor({ which, looks, defaults, categories, max, onChange, openPicker, onPreview, previewId, onAdjusting }: {
  which: 'hero' | 'ar';
  looks: HomeLook[];
  defaults: HomeLook[];
  categories: LookCategory[];
  max: number;
  onChange: (looks: HomeLook[]) => void;
  openPicker: (r: PickerRequest) => void;
  onPreview: (l: HomeLook | null) => void;
  previewId: string | null;
  /** The adjust mode opened / closed (the page parks its side preview meanwhile). */
  onAdjusting: (on: boolean) => void;
}) {
  const custom = looks.length > 0;
  const list = custom ? looks : defaults;
  const [tab, setTab] = useState<LookCategory>(categories[0]);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = list.filter((l) => l.category === tab);
  const open = custom ? (looks.find((l) => l.id === openId) ?? null) : null;

  const patch = (id: string, p: Partial<HomeLook>) => {
    const next = looks.map((l) => (l.id === id ? { ...l, ...p } : l));
    onChange(next);
    const now = next.find((l) => l.id === id);
    if (now !== undefined) onPreview(now);
  };
  /** Swap with the previous / next look of the same category (the page orders within a category). */
  const move = (id: string, d: -1 | 1) => {
    const i = looks.findIndex((l) => l.id === id);
    if (i < 0) return;
    let j = i + d;
    while (j >= 0 && j < looks.length && looks[j].category !== looks[i].category) j += d;
    if (j < 0 || j >= looks.length) return;
    const next = looks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (cat: LookCategory) =>
    openPicker({
      title: `Add ${CATEGORY_ONE[cat]}s`,
      accept: cat === 'prop' ? ['model'] : cat === 'frame' ? ['image'] : ['image', 'video'],
      category: cat,
      multiple: true,
      onPick: (picked) => {
        const base = custom ? looks : editableDefaults()[which === 'hero' ? 'heroLooks' : 'arLooks'];
        const taken = new Set(base.map((l) => l.id));
        const fresh = picked.map((p) => lookFromPick(p, cat, taken)).filter((l): l is HomeLook => l !== null);
        onChange([...base, ...fresh].slice(0, max));
        setTab(cat);
        if (fresh[0] !== undefined) { setOpenId(fresh[0].id); onPreview(fresh[0]); }
      },
    });
  const startCustom = () => onChange(editableDefaults()[which === 'hero' ? 'heroLooks' : 'arLooks']);
  const idxInCat = (l: HomeLook) => list.filter((x) => x.category === l.category).indexOf(l);
  const nInCat = (l: HomeLook) => list.filter((x) => x.category === l.category).length;

  return (
    <div className="space-y-3">
      {!custom && (
        <Note>
          Showing the built-in {which === 'hero' ? 'hero looks' : 'AR step looks'}. Tap one to preview it on Beamy. Customize to
          reorder, rename, remove or re-place them; a customized list then replaces the built-in one until you reset it, so a later
          change to the built-in looks will not show until then.
        </Note>
      )}
      {categories.length > 1 && (
        <div role="tablist" aria-label="Category" className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button key={c} role="tab" aria-selected={tab === c} onClick={() => setTab(c)} className={tabCls(tab === c)}>
              {CATEGORY_LABEL[c]} <span className="opacity-60">{list.filter((l) => l.category === c).length}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="font-sans text-xs text-brand-muted/70">No {CATEGORY_LABEL[tab].toLowerCase()} in this list. The page shows only its None stop here.</p>
      ) : (
        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5">
          {shown.map((l) => {
            const sel = (custom ? openId : previewId) === l.id;
            return (
              <li key={l.id}>
                <button
                  onClick={() => {
                    if (custom) setOpenId(openId === l.id ? null : l.id);
                    onPreview(l);
                  }}
                  aria-pressed={sel}
                  className={`pressable w-full rounded-xl border p-1.5 text-left transition-colors ${sel ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
                >
                  <AssetThumb thumb={tileThumb(l)} kind={lookUrlKind(l.url, l.category) ?? 'image'} url={l.url} />
                  <span className="mt-1 block truncate font-sans text-[11px] text-brand-fg/85">{idxInCat(l) + 1}. {l.name}</span>
                  {l.category === 'frame' && <span className="block truncate font-sans text-[10px] text-brand-muted/70">{arTitle('frame', l)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open !== null && (
        <div className="rounded-2xl border border-[color:var(--color-accent)]/30 bg-white/[0.02] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate font-sans text-sm font-semibold text-brand-fg">{open.name}</h3>
            <span className="font-sans text-[11px] text-brand-muted/70">{CATEGORY_ONE[open.category]} · {idxInCat(open) + 1} of {nInCat(open)}</span>
            <div className="ml-auto flex gap-1.5">
              <button aria-label="Move earlier" className={iconBtn} disabled={idxInCat(open) === 0} onClick={() => move(open.id, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button aria-label="Move later" className={iconBtn} disabled={idxInCat(open) === nInCat(open) - 1} onClick={() => move(open.id, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
              <button aria-label={`Remove ${open.name}`} className={iconBtn}
                disabled={looks.length <= 1}
                onClick={() => { onChange(looks.filter((l) => l.id !== open.id)); setOpenId(null); onPreview(null); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>Name</span>
              <input className={`${input} mt-1`} value={open.name} maxLength={NAME_MAX} onChange={(e) => patch(open.id, { name: e.target.value })} />
            </label>
            {open.category === 'frame' && which === 'ar' && (
              <label className="block">
                <span className={labelCls}>Occasion (the title over the frame)</span>
                <input className={`${input} mt-1`} value={open.occasion ?? ''} maxLength={OCCASION_MAX} placeholder={open.name}
                  onChange={(e) => patch(open.id, { occasion: e.target.value === '' ? undefined : e.target.value })} />
              </label>
            )}
            {which === 'hero' && (
              <label className="block sm:col-span-2">
                <span className={labelCls}>Beamy's line while he wears it</span>
                <input className={`${input} mt-1`} value={open.line ?? ''} maxLength={LINE_MAX} placeholder="e.g. Real 3D filters, right in the browser."
                  onChange={(e) => patch(open.id, { line: e.target.value === '' ? undefined : e.target.value })} />
              </label>
            )}
          </div>
          {open.category === 'prop' && <FitEditor lookId={open.id} fit={open.fit} onChange={(fit) => patch(open.id, { fit })} look={open} mode={which} onAdjusting={onAdjusting} />}
          {open.category === 'frame' && which === 'hero' && (
            <div className="space-y-2">
              <span className={labelCls}>Worn with a 3D prop</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-sans text-xs text-brand-fg/85">{open.with !== undefined ? fileLabel(open.with) : 'None'}</span>
                <button className={chipBtn} onClick={() => openPicker({
                  title: 'Choose the prop worn with this frame', accept: ['model'], category: 'prop',
                  onPick: (a) => { const p = a[0]; if (p !== undefined) patch(open.id, { with: p.url, fit: p.look?.fit ?? presetFit('crown') }); },
                })}>{open.with !== undefined ? 'Replace' : 'Add a prop'}</button>
                {open.with !== undefined && <button className={chipBtn} onClick={() => patch(open.id, { with: undefined, fit: undefined })}><X className="h-3 w-3" /> Remove</button>}
              </div>
              {open.with !== undefined && <FitEditor lookId={`${open.id}:with`} fit={open.fit} onChange={(fit) => patch(open.id, { fit })} look={open} mode={which} onAdjusting={onAdjusting} />}
            </div>
          )}
          {(open.category === 'filter' || open.category === 'effect') && (
            <p className="font-sans text-[11px] text-brand-muted/70">
              {open.url.startsWith('tint:') || open.url.startsWith('fx:') ? 'A built-in look the page draws itself.' : 'A picture or clip: the page shows it on its stop.'}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {!custom ? (
          <button className={chipBtn} onClick={startCustom}>Customize these looks</button>
        ) : (
          <button className={chipBtn} onClick={() => { onChange([]); setOpenId(null); }}><RotateCcw className="h-3 w-3" /> Reset to built-in</button>
        )}
        <button className={chipBtn} disabled={list.length >= max} onClick={() => add(tab)}><Plus className="h-3 w-3" /> Add {CATEGORY_ONE[tab]}</button>
      </div>
    </div>
  );
}

/* ── The page ───────────────────────────────────────────────────────── */

export default function AdminHomeAssets() {
  const toast = useToast();
  const [home, setHome] = useState<HomeOverrides | null>(null);
  const [serverJson, setServerJson] = useState('');
  const [publishedJson, setPublishedJson] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [slugText, setSlugText] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [preview, setPreview] = useState<{ look: HomeLook | null; mode: 'hero' | 'ar' }>({ look: HOME_ASSET_DEFAULTS.arLooks.find((l) => l.category === 'prop') ?? null, mode: 'ar' });

  const load = useCallback(async () => {
    setLoadErr(null);
    const { data, error } = await fetchLandingContentAdmin();
    if (error !== null || data === null) {
      setLoadErr(error ?? 'internal');
      return;
    }
    const h = normalizeLandingContent(data.draft).home;
    setHome(h);
    setSlugText(h.demoEventSlug ?? '');
    setServerJson(canon(h));
    setPublishedJson(canon(normalizeLandingContent(data.published).home));
    setVersion(data.version);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const localJson = useMemo(() => (home === null ? '' : canon(home)), [home]);
  const unsaved = home !== null && localJson !== serverJson;
  const differsFromLive = home !== null && localJson !== publishedJson;
  const patch = (p: Partial<HomeOverrides>) => setHome((h) => (h === null ? h : { ...h, ...p }));

  /** Saves ONLY `home` into the server's current draft (never a stale copy of the other sections /admin/landing edits). */
  async function saveHome(): Promise<boolean> {
    if (home === null) return false;
    const fresh = await fetchLandingContentAdmin();
    if (fresh.error !== null || fresh.data === null) {
      toast.push(`Couldn't read the current draft: ${fresh.error ?? 'internal'}. Nothing was saved.`, 'error');
      return false;
    }
    const next = { ...normalizeLandingContent(fresh.data.draft), home: normalizeHomeAssets(home) };
    const { error } = await saveLandingDraft(next as unknown as Record<string, unknown>);
    if (error !== null) {
      toast.push(`Couldn't save the draft: ${error}`, 'error');
      return false;
    }
    setServerJson(localJson);
    return true;
  }

  async function onSave() {
    setBusy(true);
    const ok = await saveHome();
    setBusy(false);
    if (ok) toast.push('Draft saved. It is not live until you publish.', 'success');
  }

  async function onPublish() {
    setConfirmPublish(false);
    setBusy(true);
    if (unsaved && !(await saveHome())) {
      setBusy(false);
      return;
    }
    const { data, error } = await publishLandingContent();
    setBusy(false);
    if (error !== null) {
      toast.push(`Publish failed: ${error}`, 'error');
      return;
    }
    setPublishedJson(localJson);
    if (data !== null) setVersion(data.version);
    toast.push(`Published. The homepage now serves v${data?.version ?? '?'}.`, 'success');
  }

  const openPicker = (r: PickerRequest) => setPicker(r);
  const slugValid = slugText.trim() === '' || SLUG_RE.test(slugText.trim().toLowerCase());
  const n = home === null ? 0 : countOverrides(normalizeHomeAssets(home));
  const D = HOME_ASSET_DEFAULTS;
  const arCats = AR_CATEGORIES.map((c) => c.id);

  return (
    <div className="min-h-full px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="sticky top-0 z-20 -mx-4 mb-5 px-4 py-3 md:-mx-8 md:px-8 liquid-glass-raised rounded-b-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Homepage</h1>
              <p className="font-sans text-xs text-brand-muted/80 mt-0.5">
                {version !== null && <>Live v{version} · </>}
                {home === null ? (loadErr !== null ? 'Couldn’t load. Nothing can be edited until it does.' : 'Loading…') : unsaved ? 'Unsaved changes' : differsFromLive ? 'Saved draft, not live yet' : 'Matches the live page'}
                {home !== null && <> · {n === 0 ? 'all built-in' : `${n} custom`}</>}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <a href="/" target="_blank" rel="noreferrer"
                className="pressable inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg">
                <ExternalLink className="w-3.5 h-3.5" /> View page
              </a>
              <button onClick={() => void onSave()} disabled={busy || home === null || !unsaved || !slugValid}
                className="pressable min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg disabled:opacity-40">
                Save draft
              </button>
              <button onClick={() => setConfirmPublish(true)} disabled={busy || home === null || !slugValid || (!unsaved && !differsFromLive)}
                className="pressable min-h-11 px-4 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40">
                Publish
              </button>
            </div>
          </div>
        </header>

        {loadErr !== null && <LoadError what="the homepage assets" code={loadErr} onRetry={() => void load()} />}

        <div className="mb-4">
          <Note>
            This edits the homepage at "/". Anything you leave empty keeps the page's built-in asset, so clearing a slot never blanks a
            section. Pick from the built-in props and frames, the Studio library, or upload new files. The page's words stay as they
            are. Changes go live only when you publish, and publishing also takes any saved draft from the Landing editor (/classic) live.
          </Note>
        </div>

        {home === null ? (
          loadErr === null && (
            <div className="liquid-glass rounded-2xl p-10 text-center">
              <p className="font-sans text-sm text-brand-muted/70">Loading the homepage assets…</p>
            </div>
          )
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <aside className="min-w-0 lg:order-2">
              {/* Sticky on a plain wrapper: .liquid-glass sets position: relative (index.css). */}
              <div className="lg:sticky lg:top-28">
              <div className="liquid-glass rounded-2xl p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Eye className="h-4 w-4 text-brand-muted/70" />
                  <h2 className="font-sans text-sm font-semibold text-brand-fg">Live preview</h2>
                </div>
                {/* Parked while the adjust mode has him (one 3D stage at a time, kinder to phones). */}
                {adjusting ? (
                  <div className="grid h-[340px] place-items-center rounded-2xl border border-white/10 bg-white/[0.02] px-6 text-center font-sans text-xs text-brand-muted/70">
                    Beamy is in the adjust window.
                  </div>
                ) : (
                  <Suspense fallback={<div className="h-[340px] rounded-2xl border border-white/10 bg-white/[0.02]" />}>
                    <BeamyPreview look={preview.look} mode={preview.mode} />
                  </Suspense>
                )}
                <p className="mt-2 font-sans text-[11px] leading-relaxed text-brand-muted/70">
                  Tap a look to see it on Beamy. Placement changes show here as you move the sliders.
                </p>
              </div>
              </div>
            </aside>

            <div className="min-w-0 space-y-3">
              <Section title="Hero looks" hint="what Beamy tries on when the page opens" defaultOpen badge={home.heroLooks.length > 0 ? 'custom' : undefined}>
                <Note>The first look is the one he lands in and takes his selfie wearing. The hero shows frames and 3D props.</Note>
                <LooksEditor which="hero" looks={home.heroLooks} defaults={D.heroLooks} categories={['frame', 'prop']} max={HERO_LOOKS_MAX}
                  onChange={(l) => patch({ heroLooks: l })} openPicker={openPicker}
                  previewId={preview.mode === 'hero' ? (preview.look?.id ?? null) : null}
                  onPreview={(look) => setPreview({ look, mode: 'hero' })} onAdjusting={setAdjusting} />
              </Section>

              <Section title="AR step" hint="the frames, 3D props, filters and effects visitors swipe through" defaultOpen badge={home.arLooks.length > 0 ? 'custom' : undefined}>
                <LooksEditor which="ar" looks={home.arLooks} defaults={D.arLooks} categories={arCats} max={AR_LOOKS_MAX}
                  onChange={(l) => patch({ arLooks: l })} openPicker={openPicker}
                  previewId={preview.mode === 'ar' ? (preview.look?.id ?? null) : null}
                  onPreview={(look) => setPreview({ look, mode: 'ar' })} onAdjusting={setAdjusting} />
              </Section>

              <Section title="3D scene props" hint="the props floating around the hero" badge={home.sceneProps.some((u) => u !== '') ? 'custom' : undefined}>
                <Note>Each spot keeps its place and size on the page; you choose the prop that floats there.</Note>
                <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {D.sceneProps.slice(0, SCENE_PROPS_MAX).map((def, i) => {
                    const own = home.sceneProps[i] !== undefined && home.sceneProps[i] !== '' ? home.sceneProps[i] : undefined;
                    const url = own ?? def;
                    const setSpot = (u: string | undefined) => {
                      const next = Array.from({ length: D.sceneProps.length }, (_, k) => home.sceneProps[k] ?? '');
                      next[i] = u ?? '';
                      patch({ sceneProps: next });
                    };
                    return (
                      <li key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-1.5">
                        <AssetThumb thumb={url.startsWith('/models/') ? url.replace(/\.glb$/, '.webp') : undefined} kind="model" />
                        <p className="mt-1 truncate font-sans text-[10px] text-brand-muted/80">{SCENE_SPOT_NAMES[i] ?? `Spot ${i + 1}`}</p>
                        <p className="truncate font-sans text-[11px] text-brand-fg/85">{own !== undefined ? fileLabel(own) : `Built-in: ${fileLabel(def)}`}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <button className={chipBtn} onClick={() => openPicker({ title: `Prop for: ${SCENE_SPOT_NAMES[i] ?? `spot ${i + 1}`}`, accept: ['model'], onPick: (a) => setSpot(a[0]?.url) })}>Replace</button>
                          {own !== undefined && <button aria-label="Use the built-in prop" className={iconBtn} onClick={() => setSpot(undefined)}><RotateCcw className="h-3.5 w-3.5" /></button>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Section>

              <Section title="Live wall photos" hint="the photos filling the hero's wall" badge={home.wallPhotos.length >= WALL_MIN_PHOTOS ? `${home.wallPhotos.length}` : undefined}>
                <Note>
                  The wall shows 9 at a time and swaps in spares, so it needs at least {WALL_MIN_PHOTOS} photos.
                  {home.wallPhotos.length > 0 && home.wallPhotos.length < WALL_MIN_PHOTOS && (
                    <strong className="text-amber-300/90"> Add {WALL_MIN_PHOTOS - home.wallPhotos.length} more, or the page keeps its built-in photos.</strong>
                  )}
                </Note>
                <PhotoList title="Add wall photos" urls={home.wallPhotos} max={WALL_PHOTOS_MAX} onChange={(u) => patch({ wallPhotos: u })} openPicker={openPicker} />
              </Section>

              <Section title="Keepsake album" hint="the shots that fly into the keepsake film" badge={home.keepsakePhotos.length >= KEEPSAKE_MIN_PHOTOS ? `${home.keepsakePhotos.length}` : undefined}>
                <Note>
                  The album shows six photos.
                  {home.keepsakePhotos.length > 0 && home.keepsakePhotos.length < KEEPSAKE_MIN_PHOTOS && (
                    <strong className="text-amber-300/90"> Add {KEEPSAKE_MIN_PHOTOS - home.keepsakePhotos.length} more, or the page keeps its built-in album.</strong>
                  )}
                </Note>
                <PhotoList title="Add album photos" urls={home.keepsakePhotos} max={KEEPSAKE_PHOTOS_MAX} onChange={(u) => patch({ keepsakePhotos: u })} openPicker={openPicker} />
              </Section>

              <Section title="Virtual celebrations" hint="the photos on step 6's card" badge={home.virtualPhotos.length > 0 ? `${home.virtualPhotos.length}` : undefined}>
                <Note>Only the photos on the card change here; its words stay as they are. Empty keeps the wall's own picks.</Note>
                <PhotoList title="Add card photos" urls={home.virtualPhotos} max={VIRTUAL_PHOTOS_MAX} onChange={(u) => patch({ virtualPhotos: u })} openPicker={openPicker} />
              </Section>

              <Section title="Challenge photo and demo event" hint="the challenge step's photo and where the QR code goes">
                <div className="grid md:grid-cols-2 gap-3">
                  <SingleSlot label="Challenge photo" kind="image" value={home.challengePhoto} onChange={(u) => patch({ challengePhoto: u })} openPicker={openPicker} />
                  <div className="rounded-xl border border-white/[0.06] p-3">
                    <label className="block">
                      <span className={labelCls}>Demo event (the event's link name)</span>
                      <input className={`${input} mt-2`} value={slugText} placeholder={D.demoEventSlug ?? 'demo'} autoCapitalize="none" spellCheck={false}
                        aria-invalid={!slugValid}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSlugText(v);
                          const s = v.trim().toLowerCase();
                          patch({ demoEventSlug: s === '' ? undefined : s });
                        }} />
                    </label>
                    {!slugValid ? (
                      <p className="mt-2 font-sans text-xs text-amber-300/90">Use lowercase letters, numbers and dashes, like beamy-demo.</p>
                    ) : (
                      <a href={`/e/${home.demoEventSlug ?? D.demoEventSlug ?? 'demo'}/welcome`} target="_blank" rel="noreferrer"
                        className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-sans text-xs text-brand-fg/85 underline">
                        <ExternalLink className="h-3 w-3" /> Open /e/{home.demoEventSlug ?? D.demoEventSlug ?? 'demo'}/welcome
                      </a>
                    )}
                  </div>
                </div>
              </Section>
            </div>
          </div>
        )}

        {picker !== null && (
          <HomeAssetPicker
            title={picker.title}
            accept={picker.accept}
            category={picker.category}
            multiple={picker.multiple}
            onClose={() => setPicker(null)}
            onPick={(a) => {
              picker.onPick(a.filter((p) => (picker.category !== undefined ? lookUrlKind(p.url, picker.category) !== undefined : picker.accept.some((k) => resolveAssetUrl(p.url, k) !== undefined))));
              setPicker(null);
            }}
          />
        )}

        {confirmPublish && (
          <ConfirmModal
            title="Publish the homepage?"
            body={
              <>
                Every visitor to the homepage sees these assets right away.
                {unsaved && ' Your unsaved changes here are saved into the draft first.'} Any saved draft from the Landing editor
                (/classic) goes live too.
              </>
            }
            confirmLabel="Publish now"
            onConfirm={() => void onPublish()}
            onCancel={() => setConfirmPublish(false)}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
