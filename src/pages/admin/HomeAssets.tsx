/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/home-assets — the homepage ASSET manager: the films in each film
 * section, the looks Beamy wears (hero + AR step, by category), the 3D props
 * floating in the scene, the live-wall and keepsake photos, the challenge
 * photo and the demo event the real QR code opens.
 *
 * Storage: `landing_content.home` (see src/lib/homeAssets.ts), so it shares
 * the /admin/landing draft → publish flow. That row holds the WHOLE homepage
 * blob, so this screen never saves its own stale copy of the other sections:
 * every save re-reads the server draft and replaces only `home` in it.
 *
 * Every slot is an override. Empty = the page's built-in asset, stated in the
 * UI, so clearing a slot can never blank a section of the public page.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Info,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import ConfirmModal from '../../components/ui/ConfirmModal';
import LoadError from '../../components/ui/LoadError';
import HomeAssetPicker, { AssetThumb, type PickedAsset } from '../../components/admin/HomeAssetPicker';
import { fetchLandingContentAdmin, publishLandingContent, saveLandingDraft } from '../../lib/admin';
import { normalizeLandingContent } from '../../lib/landingContent';
import {
  FIT_PRESETS,
  FIT_WIDTH_MAX,
  FIT_WIDTH_MIN,
  HOME_FILM_IDS,
  HOME_LOOK_CATEGORIES,
  KEEPSAKE_PHOTOS_MAX,
  LOOKS_MAX,
  SCENE_PROPS_MAX,
  WALL_MIN_PHOTOS,
  WALL_PHOTOS_MAX,
  countOverrides,
  lookUrlKind,
  normalizeHomeAssets,
  resolveAssetUrl,
  slugifyLookId,
  type AssetKind,
  type FitPresetId,
  type HomeAssets,
  type HomeFilmId,
  type HomeLook,
  type HomeLookCategory,
} from '../../lib/homeAssets';

const input =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-[color:var(--color-accent)]/50';
const labelCls = 'font-label uppercase tracking-luxe text-[10px] text-brand-muted/60';
const chipBtn =
  'pressable inline-flex items-center gap-1 rounded-full px-3 min-h-11 font-label uppercase tracking-luxe text-[10px] border bg-white/[0.03] border-white/10 text-brand-muted/80 hover:text-brand-fg transition-colors disabled:opacity-40';
const iconBtn =
  'pressable grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-brand-muted/80 hover:text-brand-fg disabled:opacity-30';

const FILM_LABEL: Record<HomeFilmId, string> = {
  booth: 'Booth film',
  wall: 'Live wall film',
  challenges: 'Challenges film',
  cards: 'Keepsake film',
};
const CATEGORY_LABEL: Record<HomeLookCategory, string> = { frame: 'Frames', filter: 'Filters', prop: 'Props', effect: 'Effects' };
const CATEGORY_ONE: Record<HomeLookCategory, string> = { frame: 'frame', filter: 'filter', prop: 'prop', effect: 'effect' };

const canon = (h: HomeAssets) => JSON.stringify(normalizeHomeAssets(h));

/** A bundled prop's .webp sits beside its .glb; anything else has no thumbnail. */
function modelThumb(url: string): string | undefined {
  return url.startsWith('/models/props/') ? url.replace(/\.glb$/i, '.webp') : undefined;
}
function fileLabel(url: string): string {
  const last = decodeURIComponent(url.split('/').pop() ?? url);
  return last.replace(/^[0-9a-f-]{36}-/i, '');
}

/* ── Small building blocks ──────────────────────────────────────────── */

function Section({ title, hint, children, defaultOpen = false, badge }: {
  title: string; hint?: string; children: ReactNode; defaultOpen?: boolean; badge?: string;
}) {
  return (
    <details open={defaultOpen} className="group liquid-glass rounded-2xl">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 min-h-11">
        <h2 className="font-serif text-lg text-brand-fg">{title}</h2>
        {badge !== undefined && (
          <span className="rounded-full bg-[color:var(--color-accent)]/15 px-2 py-0.5 font-sans text-[11px] text-brand-fg/85">{badge}</span>
        )}
        {hint !== undefined && <span className="hidden sm:inline font-sans text-[11px] text-brand-muted/60">{hint}</span>}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-brand-muted/60 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  );
}

function DefaultNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-white/[0.06] px-3 py-2.5 font-sans text-xs leading-relaxed text-brand-muted/70">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-muted/50" />
      <span>{children}</span>
    </p>
  );
}

interface PickerRequest {
  title: string;
  accept: AssetKind[];
  category?: HomeLookCategory;
  multiple?: boolean;
  onPick: (a: PickedAsset[]) => void;
}

/** One URL slot (a film, a poster, the challenge photo). */
function SingleSlot({ label, kind, value, onChange, openPicker }: {
  label: string; kind: AssetKind; value: string | undefined;
  onChange: (url: string | undefined) => void; openPicker: (r: PickerRequest) => void;
}) {
  const thumb = value === undefined ? undefined : kind === 'image' ? value : kind === 'model' ? modelThumb(value) : undefined;
  return (
    <div className="rounded-xl border border-white/[0.06] p-3">
      <span className={labelCls}>{label}</span>
      <div className="mt-2 flex items-center gap-3">
        <div className="w-20 shrink-0">
          {value !== undefined && kind === 'video' ? (
            <video src={value} muted playsInline preload="metadata" className="aspect-square w-full rounded-lg object-cover bg-black/40" />
          ) : (
            <AssetThumb thumb={thumb} kind={kind} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-xs text-brand-fg/85">{value === undefined ? 'Built-in' : fileLabel(value)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              className={chipBtn}
              onClick={() => openPicker({ title: `Choose: ${label}`, accept: [kind], onPick: (a) => onChange(a[0]?.url) })}
            >
              {value === undefined ? 'Choose' : 'Replace'}
            </button>
            {value !== undefined && (
              <button className={chipBtn} onClick={() => onChange(undefined)}>
                <RotateCcw className="h-3 w-3" /> Use built-in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** An ordered list of URLs (scene props, wall photos, keepsake photos). */
function UrlList({ urls, kind, max, addLabel, onChange, openPicker, title }: {
  urls: string[]; kind: AssetKind; max: number; addLabel: string; title: string;
  onChange: (urls: string[]) => void; openPicker: (r: PickerRequest) => void;
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
        <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
          {urls.map((u, i) => (
            <li key={u} className="rounded-xl border border-white/10 bg-white/[0.03] p-1.5">
              <AssetThumb thumb={kind === 'image' ? u : modelThumb(u)} kind={kind} />
              <p className="mt-1 truncate font-sans text-[10px] text-brand-muted/70" title={fileLabel(u)}>
                {i + 1}. {fileLabel(u)}
              </p>
              <div className="mt-1 flex justify-between">
                <button aria-label="Move earlier" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button aria-label="Remove" className={iconBtn} onClick={() => onChange(urls.filter((_, j) => j !== i))}>
                  <X className="h-3.5 w-3.5" />
                </button>
                <button aria-label="Move later" className={iconBtn} disabled={i === urls.length - 1} onClick={() => move(i, 1)}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={chipBtn}
          disabled={urls.length >= max}
          onClick={() =>
            openPicker({
              title,
              accept: [kind],
              category: kind === 'model' ? 'prop' : undefined,
              multiple: true,
              onPick: (a) => onChange([...urls, ...a.map((p) => p.url).filter((u) => !urls.includes(u))].slice(0, max)),
            })
          }
        >
          <Plus className="h-3 w-3" /> {addLabel}
        </button>
        {urls.length > 0 && (
          <button className={chipBtn} onClick={() => onChange([])}>
            <RotateCcw className="h-3 w-3" /> Use built-in
          </button>
        )}
        <span className="font-sans text-[11px] text-brand-muted/60">
          {urls.length}/{max}
        </span>
      </div>
    </div>
  );
}

/** The editor for a look list: category tabs, tiles, and a detail panel. */
function LooksEditor({ looks, onChange, openPicker, which }: {
  looks: HomeLook[]; which: string;
  onChange: (looks: HomeLook[]) => void; openPicker: (r: PickerRequest) => void;
}) {
  const [tab, setTab] = useState<HomeLookCategory | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = tab === 'all' ? looks : looks.filter((l) => l.category === tab);
  const open = looks.find((l) => l.id === openId) ?? null;

  const patch = (id: string, p: Partial<HomeLook>) => onChange(looks.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const move = (id: string, d: -1 | 1) => {
    const i = looks.findIndex((l) => l.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= looks.length) return;
    const next = looks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (cat: HomeLookCategory) =>
    openPicker({
      title: `Add ${CATEGORY_ONE[cat]}s to the ${which}`,
      accept: cat === 'prop' ? ['model'] : cat === 'frame' ? ['image'] : ['image', 'video'],
      category: cat,
      multiple: true,
      onPick: (picked) => {
        const taken = new Set(looks.map((l) => l.id));
        const fresh = picked.map((p): HomeLook => {
          const base: HomeLook = p.look ?? { id: '', name: p.name, category: cat, url: p.url, ...(p.thumb ? { thumb: p.thumb } : {}) };
          let id = slugifyLookId(base.id || `${cat}-${p.name}`) || cat;
          for (let n = 2; taken.has(id); n++) id = `${slugifyLookId(base.id || `${cat}-${p.name}`)}-${n}`;
          taken.add(id);
          const fit = cat === 'prop' ? base.fit ?? FIT_PRESETS.crown.fit : undefined;
          return { ...base, id, category: cat, ...(fit ? { fit } : {}) };
        });
        onChange([...looks, ...fresh].slice(0, LOOKS_MAX));
        setTab(cat);
      },
    });

  const presetOf = (l: HomeLook): FitPresetId | undefined =>
    (Object.keys(FIT_PRESETS) as FitPresetId[]).find((k) => {
      const f = FIT_PRESETS[k].fit;
      return l.fit !== undefined && f.at.every((n, i) => n === l.fit!.at[i]) && f.align === l.fit.align;
    });

  return (
    <div>
      <div role="tablist" aria-label="Category" className="flex flex-wrap gap-1.5">
        {(['all', ...HOME_LOOK_CATEGORIES] as const).map((c) => {
          const n = c === 'all' ? looks.length : looks.filter((l) => l.category === c).length;
          return (
            <button
              key={c}
              role="tab"
              aria-selected={tab === c}
              onClick={() => setTab(c)}
              className={`pressable min-h-11 rounded-full px-4 font-label uppercase tracking-luxe text-[10px] border transition-colors ${
                tab === c
                  ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg'
                  : 'bg-white/[0.03] border-white/10 text-brand-muted/70 hover:text-brand-fg'
              }`}
            >
              {c === 'all' ? 'All' : CATEGORY_LABEL[c]} <span className="opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
          {shown.map((l) => (
            <li key={l.id}>
              <button
                onClick={() => setOpenId(openId === l.id ? null : l.id)}
                aria-expanded={openId === l.id}
                className={`pressable w-full rounded-xl border p-1.5 text-left transition-colors ${
                  openId === l.id ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                }`}
              >
                <AssetThumb thumb={l.thumb ?? (l.category === 'frame' ? l.url : undefined)} kind={lookUrlKind(l.url, l.category) ?? 'image'} url={l.url} />
                <span className="mt-1 block truncate font-sans text-[11px] text-brand-fg/85">
                  {looks.indexOf(l) + 1}. {l.name}
                </span>
                <span className="block font-sans text-[10px] text-brand-muted/60">{CATEGORY_LABEL[l.category]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open !== null && (
        <div className="mt-3 rounded-2xl border border-[color:var(--color-accent)]/30 bg-white/[0.02] p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-sans text-sm font-semibold text-brand-fg">{open.name}</h3>
            <span className="font-sans text-[11px] text-brand-muted/60">{CATEGORY_LABEL[open.category]}</span>
            <div className="ml-auto flex gap-1.5">
              <button aria-label="Move earlier" className={iconBtn} disabled={looks[0]?.id === open.id} onClick={() => move(open.id, -1)}>
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <button aria-label="Move later" className={iconBtn} disabled={looks[looks.length - 1]?.id === open.id} onClick={() => move(open.id, 1)}>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label={`Remove ${open.name}`}
                className={iconBtn}
                onClick={() => {
                  onChange(looks.filter((l) => l.id !== open.id));
                  setOpenId(null);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>Name (for screen readers)</span>
              <input className={`${input} mt-1`} value={open.name} maxLength={80} onChange={(e) => patch(open.id, { name: e.target.value })} />
            </label>
            <label className="block">
              <span className={labelCls}>Beamy's line while wearing it (optional)</span>
              <input
                className={`${input} mt-1`}
                value={open.line ?? ''}
                maxLength={140}
                placeholder="e.g. Real 3D filters, like this crown."
                onChange={(e) => patch(open.id, { line: e.target.value === '' ? undefined : e.target.value })}
              />
            </label>
          </div>
          {open.category === 'prop' && (
            <div>
              <span className={labelCls}>Where it sits on Beamy</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(Object.keys(FIT_PRESETS) as FitPresetId[]).map((k) => (
                  <button
                    key={k}
                    aria-pressed={presetOf(open) === k}
                    onClick={() => patch(open.id, { fit: { ...FIT_PRESETS[k].fit, width: open.fit?.width ?? FIT_PRESETS[k].fit.width } })}
                    className={`${chipBtn} ${presetOf(open) === k ? '!border-[color:var(--color-accent)]/60 !text-brand-fg' : ''}`}
                  >
                    {FIT_PRESETS[k].label}
                  </button>
                ))}
              </div>
              <label className="mt-3 block">
                <span className={labelCls}>Size</span>
                <input
                  type="range"
                  min={FIT_WIDTH_MIN}
                  max={FIT_WIDTH_MAX}
                  step={0.01}
                  value={open.fit?.width ?? FIT_PRESETS.crown.fit.width}
                  onChange={(e) => patch(open.id, { fit: { ...(open.fit ?? FIT_PRESETS.crown.fit), width: Number(e.target.value) } })}
                  className="mt-2 w-full min-h-11 accent-[color:var(--color-accent)]"
                />
              </label>
              <p className="font-sans text-[11px] text-brand-muted/60">
                Check it on the live page after publishing; fine-tuning beyond these presets is done in code.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(tab === 'all' ? HOME_LOOK_CATEGORIES : [tab]).map((c) => (
          <button key={c} className={chipBtn} disabled={looks.length >= LOOKS_MAX} onClick={() => add(c)}>
            <Plus className="h-3 w-3" /> Add {CATEGORY_ONE[c]}
          </button>
        ))}
        {looks.length > 0 && (
          <button className={chipBtn} onClick={() => { onChange([]); setOpenId(null); }}>
            <RotateCcw className="h-3 w-3" /> Use built-in looks
          </button>
        )}
      </div>
    </div>
  );
}

/* ── The page ───────────────────────────────────────────────────────── */

export default function AdminHomeAssets() {
  const toast = useToast();
  const [home, setHome] = useState<HomeAssets | null>(null);
  const [serverJson, setServerJson] = useState('');
  const [publishedJson, setPublishedJson] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [slugText, setSlugText] = useState('');

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

  useEffect(() => {
    void load();
  }, [load]);

  const localJson = useMemo(() => (home === null ? '' : canon(home)), [home]);
  const unsaved = home !== null && localJson !== serverJson;
  const differsFromLive = home !== null && localJson !== publishedJson;
  const patch = (p: Partial<HomeAssets>) => setHome((h) => (h === null ? h : { ...h, ...p }));
  const patchFilm = (id: HomeFilmId, key: 'video' | 'poster', url: string | undefined) =>
    setHome((h) => {
      if (h === null) return h;
      const film = { ...(h.films[id] ?? {}) };
      if (url === undefined) delete film[key];
      else film[key] = url;
      return { ...h, films: { ...h.films, [id]: film } };
    });

  /** Saves ONLY `home` into the server's current draft (never a stale copy of
   *  the other sections, which /admin/landing edits). */
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
  const slugValid = slugText.trim() === '' || /^[a-z0-9][a-z0-9-]{1,62}$/.test(slugText.trim().toLowerCase());
  const n = home === null ? 0 : countOverrides(normalizeHomeAssets(home));

  return (
    <div className="min-h-full px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="sticky top-0 z-20 -mx-4 mb-5 px-4 py-3 md:-mx-8 md:px-8 liquid-glass-raised rounded-b-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Homepage assets</h1>
              <p className="font-sans text-xs text-brand-muted/70 mt-0.5">
                {version !== null && <>Live v{version} · </>}
                {home === null
                  ? 'Loading…'
                  : unsaved
                    ? 'Unsaved changes'
                    : differsFromLive
                      ? 'Saved draft, not live yet'
                      : 'Matches the live page'}
                {home !== null && <> · {n === 0 ? 'all built-in' : `${n} custom`}</>}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <a
                href="/beamy"
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg"
              >
                <ExternalLink className="w-3.5 h-3.5" /> View page
              </a>
              <button
                onClick={() => void onSave()}
                disabled={busy || home === null || !unsaved || !slugValid}
                className="pressable min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg disabled:opacity-40"
              >
                Save draft
              </button>
              <button
                onClick={() => setConfirmPublish(true)}
                disabled={busy || home === null || !slugValid || (!unsaved && !differsFromLive)}
                className="pressable min-h-11 px-4 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40"
              >
                Publish
              </button>
            </div>
          </div>
        </header>

        {loadErr !== null && <LoadError what="the homepage assets" code={loadErr} onRetry={() => void load()} />}

        <div className="mb-4">
          <DefaultNote>
            Anything you leave empty keeps the page's built-in asset, so clearing a slot never blanks a section. Pick from the
            Studio library, the built-in props and frames, or upload new files. Changes go live only when you publish, and
            publishing also takes any saved draft text from the Landing editor live.
          </DefaultNote>
        </div>

        {home === null ? (
          loadErr === null && (
            <div className="liquid-glass rounded-2xl p-10 text-center">
              <p className="font-sans text-sm text-brand-muted/60">Loading the homepage assets…</p>
            </div>
          )
        ) : (
          <div className="space-y-3">
            <Section title="Films" hint="the video in each film section" defaultOpen
              badge={Object.keys(home.films).length > 0 ? `${Object.values(home.films).filter((f) => f && (f.video || f.poster)).length} custom` : undefined}>
              <div className="grid md:grid-cols-2 gap-3">
                {HOME_FILM_IDS.map((id) => (
                  <div key={id} className="rounded-2xl border border-white/[0.06] p-3 space-y-2">
                    <h3 className="font-sans text-sm font-semibold text-brand-fg">{FILM_LABEL[id]}</h3>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    <SingleSlot label="Video" kind="video" value={home.films[id]?.video} onChange={(u) => patchFilm(id, 'video', u)} openPicker={openPicker} />
                    <SingleSlot label="Poster image" kind="image" value={home.films[id]?.poster} onChange={(u) => patchFilm(id, 'poster', u)} openPicker={openPicker} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Hero looks" hint="what Beamy tries on in the hero" badge={home.heroLooks.length ? `${home.heroLooks.length}` : undefined}>
              {home.heroLooks.length === 0 && <DefaultNote>Using the built-in hero looks. Add looks to replace the whole list.</DefaultNote>}
              <LooksEditor which="hero" looks={home.heroLooks} onChange={(l) => patch({ heroLooks: l })} openPicker={openPicker} />
            </Section>

            <Section title="AR step looks" hint="frames, filters, props and effects visitors tap through" badge={home.arLooks.length ? `${home.arLooks.length}` : undefined}>
              {home.arLooks.length === 0 && (
                <DefaultNote>Using the built-in AR step looks. Keep these different from the hero so the page never repeats itself. Frames added here become the frames carousel.</DefaultNote>
              )}
              <LooksEditor which="AR step" looks={home.arLooks} onChange={(l) => patch({ arLooks: l })} openPicker={openPicker} />
            </Section>

            <Section title="3D scene props" hint="the props floating around Beamy" badge={home.sceneProps.length ? `${home.sceneProps.length}` : undefined}>
              <DefaultNote>
                Replaces the floating props in order: the first file takes the first spot, and so on. Spots you leave out keep
                their built-in prop. Their positions and sizes are set by the page.
              </DefaultNote>
              <UrlList title="Add 3D scene props" urls={home.sceneProps} kind="model" max={SCENE_PROPS_MAX} addLabel="Add props"
                onChange={(u) => patch({ sceneProps: u })} openPicker={openPicker} />
            </Section>

            <Section title="Live wall photos" hint="the photos filling the hero wall" badge={home.wallPhotos.length ? `${home.wallPhotos.length}` : undefined}>
              <DefaultNote>
                The wall shows 9 at a time and swaps in spares, so it needs at least {WALL_MIN_PHOTOS} photos.
                {home.wallPhotos.length > 0 && home.wallPhotos.length < WALL_MIN_PHOTOS && (
                  <strong className="text-amber-300/90"> Add {WALL_MIN_PHOTOS - home.wallPhotos.length} more, or the page keeps the built-in photos.</strong>
                )}
              </DefaultNote>
              <UrlList title="Add wall photos" urls={home.wallPhotos} kind="image" max={WALL_PHOTOS_MAX} addLabel="Add photos"
                onChange={(u) => patch({ wallPhotos: u })} openPicker={openPicker} />
            </Section>

            <Section title="Keepsake photos" hint="the shots that compile into the keepsake video" badge={home.keepsakePhotos.length ? `${home.keepsakePhotos.length}` : undefined}>
              <UrlList title="Add keepsake photos" urls={home.keepsakePhotos} kind="image" max={KEEPSAKE_PHOTOS_MAX} addLabel="Add photos"
                onChange={(u) => patch({ keepsakePhotos: u })} openPicker={openPicker} />
            </Section>

            <Section title="Challenge & demo event" hint="the challenge photo and where the QR code goes">
              <div className="grid md:grid-cols-2 gap-3">
                <SingleSlot label="Challenge photo" kind="image" value={home.challengePhoto} onChange={(u) => patch({ challengePhoto: u })} openPicker={openPicker} />
                <div className="rounded-xl border border-white/[0.06] p-3">
                  <label className="block">
                    <span className={labelCls}>Demo event (the event's link name)</span>
                    <input
                      className={`${input} mt-2`}
                      value={slugText}
                      placeholder="e.g. beamy-demo"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-invalid={!slugValid}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSlugText(v);
                        const s = v.trim().toLowerCase();
                        patch({ demoEventSlug: s === '' ? undefined : s });
                      }}
                    />
                  </label>
                  {!slugValid ? (
                    <p className="mt-2 font-sans text-xs text-amber-300/90">Use lowercase letters, numbers and dashes, like beamy-demo.</p>
                  ) : home.demoEventSlug ? (
                    <a href={`/e/${home.demoEventSlug}/welcome`} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-sans text-xs text-brand-fg/85 underline">
                      <ExternalLink className="h-3 w-3" /> Open /e/{home.demoEventSlug}/welcome
                    </a>
                  ) : (
                    <p className="mt-2 font-sans text-xs text-brand-muted/60">Empty: the QR code opens the page's built-in demo event.</p>
                  )}
                </div>
              </div>
            </Section>
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
              picker.onPick(a.filter((p) => p.kind === 'builtin' || picker.accept.some((k) => resolveAssetUrl(p.url, k) !== undefined)));
              setPicker(null);
            }}
          />
        )}

        {confirmPublish && (
          <ConfirmModal
            title="Publish the homepage assets?"
            body={
              <>
                Every visitor to the homepage sees these assets right away.
                {unsaved && ' Your unsaved changes here are saved into the draft first.'} Any saved draft text from the
                Landing editor goes live too.
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

