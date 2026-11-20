/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The asset chooser behind every slot on /admin/home-assets. Everything the
 * owner has, in one searchable grid (lib/homeAssetCatalog): the props,
 * frames, filters and effects bundled with the homepage; every shared-library
 * row in every state (live, hidden from hosts, withdrawn, host-only) and the
 * bulk-import drafts; every 3D prop and scene made inside an event; and the
 * files uploaded for the landing pages (assets/_platform/landing/); plus a
 * fresh upload. Source tabs, kind chips and a search narrow it down.
 *
 * Only what the slot can render is choosable; everything else is shown dimmed
 * with the reason (a frame offered as a 3D prop, a .gltf, an SVG frame…), so
 * nothing the owner has is silently missing. Every pick is re-checked
 * through lib/homeAssets resolveAssetUrl / lookUrlKind when it lands.
 *
 * All reads are the existing platform-admin paths (admin-api list_* actions,
 * the admin-only `_platform/landing/` storage listing): nothing new is opened.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Box, Check, Film, ImageIcon, Search, Sparkles, Upload } from 'lucide-react';
import Modal from '../ui/Modal';
import { useToast } from '../ui/Toast';
import {
  fetchEventModels, fetchLibraryCategories, fetchLibraryDrafts, fetchLibraryItems, type EventModelRow, type LibraryDraftRow, type LibraryItemRow,
} from '../../lib/adminLibrary';
import type { LibraryCategory } from '../../lib/libraryTaxonomy';
import { listLandingMedia, uploadLandingMedia, type LandingMediaItem } from '../../lib/landingMedia';
import { resolveAssetUrl, tintSwatch, type AssetKind, type LookCategory, type LookUrlKind } from '../../lib/homeAssets';
import {
  CATALOG_SOURCES, CATALOG_SOURCE_LABEL, CATALOG_TYPES, CATALOG_TYPE_LABEL, buildCatalog, filterCatalog, typeCounts, uploadPick,
  type CatalogEntry, type CatalogQuery, type CatalogSourceFilter, type CatalogType, type PickedAsset,
} from '../../lib/homeAssetCatalog';

export type { PickedAsset };

const ACCEPT_ATTR: Record<AssetKind, string> = {
  image: 'image/png,image/webp,image/jpeg',
  video: 'video/mp4,video/webm',
  model: '.glb,model/gltf-binary',
};

const chip = (on: boolean) =>
  `pressable min-h-11 shrink-0 rounded-full px-4 font-label uppercase tracking-luxe text-[10px] border transition-colors ${
    on ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg' : 'bg-white/[0.03] border-white/10 text-brand-muted/70 hover:text-brand-fg'
  }`;

function kindOf(url: string | null | undefined, accept: AssetKind[]): AssetKind | undefined {
  return accept.find((k) => resolveAssetUrl(url, k) !== undefined);
}

/** File name without its extension: uploadLandingMedia appends one itself ("crown.glb" would store "…-crown.glb.glb"). */
function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Browsers report '' for .glb; give it a type so the stored extension is right. */
function retype(file: File): File {
  if (file.type === '' && /\.glb$/i.test(file.name)) return new File([file], file.name, { type: 'model/gltf-binary' });
  return file;
}

/** One list's load: its rows, null while loading, or failed. */
type Load<T> = { rows: T[] | null; failed: boolean };
const loading = <T,>(): Load<T> => ({ rows: null, failed: false });

export default function HomeAssetPicker({
  title, accept, category, multiple = false, onPick, onClose,
}: {
  title: string;
  /** The file kinds this slot takes. */
  accept: AssetKind[];
  /** Look slots: the category picks are filed under. */
  category?: LookCategory;
  multiple?: boolean;
  onPick: (assets: PickedAsset[]) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState<CatalogQuery>({ source: 'all', type: 'all', text: '', fitsOnly: false });
  const [library, setLibrary] = useState<Load<LibraryItemRow>>(loading);
  const [drafts, setDrafts] = useState<Load<LibraryDraftRow>>(loading);
  const [events, setEvents] = useState<Load<EventModelRow>>(loading);
  const [uploads, setUploads] = useState<Load<LandingMediaItem>>(loading);
  const [categories, setCategories] = useState<LibraryCategory[]>([]);
  const [uploading, setUploading] = useState(0);
  const [selected, setSelected] = useState<PickedAsset[]>([]);

  useEffect(() => {
    let live = true;
    // Every state, every access: the admin sees all of it (the picker says which are hidden or host-only).
    void fetchLibraryItems().then(({ data, error }) => {
      if (live) setLibrary(error !== null || data === null ? { rows: [], failed: true } : { rows: data.items, failed: false });
    });
    void fetchLibraryDrafts().then(({ data, error }) => {
      if (live) setDrafts(error !== null || data === null ? { rows: [], failed: true } : { rows: data.drafts, failed: false });
    });
    void fetchEventModels().then(({ data, error }) => {
      if (live) setEvents(error !== null || data === null ? { rows: [], failed: true } : { rows: data.models, failed: false });
    });
    // Shelf names only make search better: a failed read just leaves them out.
    void fetchLibraryCategories().then(({ data }) => { if (live && data !== null) setCategories(data.categories); });
    void listLandingMedia().then(({ rows, failed }) => { if (live) setUploads({ rows, failed }); });
    return () => { live = false; };
  }, []);

  const slot = useMemo(() => ({ accept, category }), [accept, category]);
  const all = useMemo(() => buildCatalog({
    library: library.rows, drafts: drafts.rows, events: events.rows, categories,
    uploads: uploads.rows?.map((u) => ({ url: u.url, name: u.name })) ?? null,
  }, slot), [library.rows, drafts.rows, events.rows, uploads.rows, categories, slot]);
  const shown = useMemo(() => filterCatalog(all, q), [all, q]);
  const counts = useMemo(() => typeCounts(all, q), [all, q]);
  const fitting = shown.filter((e) => e.pick !== null).length;

  const pending = [library, drafts, events, uploads].some((l) => l.rows === null);
  const failedNames = [
    library.failed && 'the library', drafts.failed && 'library drafts', events.failed && 'event pieces', uploads.failed && 'uploads',
  ].filter((x): x is string => typeof x === 'string');

  const isSelected = (p: PickedAsset) => selected.some((s) => s.url === p.url);
  const toggle = (p: PickedAsset) => {
    if (!multiple) { onPick([p]); return; }
    setSelected((s) => (isSelected(p) ? s.filter((x) => x.url !== p.url) : [...s, p]));
  };

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(files.length);
    const done: PickedAsset[] = [];
    for (const raw of files) {
      const file = retype(raw);
      const url = await uploadLandingMedia(file, stem(file.name));
      setUploading((n) => n - 1);
      const k = url === null ? undefined : kindOf(url, accept);
      if (url === null || k === undefined) {
        toast.push(url === null ? `Couldn't upload ${raw.name}. Nothing was changed.` : `${raw.name} isn't a file this slot takes.`, 'error');
        continue;
      }
      done.push(uploadPick(url, k, stem(raw.name), category));
    }
    if (done.length === 0) return;
    // A fresh upload is the obvious intent: hand it straight back.
    onPick(multiple ? [...selected, ...done] : done.slice(0, 1));
  }

  const types = CATALOG_TYPES.filter((t) => counts[t] > 0);

  return (
    <Modal title={title} onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-1 basis-52">
            <span className="sr-only">Search everything</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted/60" />
            <input
              type="search"
              value={q.text}
              onChange={(e) => setQ({ ...q, text: e.target.value })}
              placeholder="Search names, tags, shelves, events"
              className="w-full min-h-11 rounded-full border border-white/10 bg-white/[0.04] pl-9 pr-4 font-sans text-sm text-brand-fg placeholder:text-brand-muted/50 focus:outline-none focus:border-[color:var(--color-accent)]/50"
            />
          </label>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading > 0}
            className="pressable min-h-11 rounded-full px-4 inline-flex items-center gap-1.5 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading > 0 ? `Uploading ${uploading}…` : multiple ? 'Upload files' : 'Upload'}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple={multiple}
            accept={accept.map((k) => ACCEPT_ATTR[k]).join(',')}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void onFiles(files);
            }}
          />
        </div>

        <div role="tablist" aria-label="Where to pick from" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {CATALOG_SOURCES.map((s) => (
            <button key={s} role="tab" aria-selected={q.source === s} onClick={() => setQ({ ...q, source: s as CatalogSourceFilter })} className={chip(q.source === s)}>
              {CATALOG_SOURCE_LABEL[s]}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Kind" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          <button aria-pressed={q.type === 'all'} onClick={() => setQ({ ...q, type: 'all' })} className={chip(q.type === 'all')}>
            All <span className="opacity-60">{counts.all}</span>
          </button>
          {types.map((t) => (
            <button key={t} aria-pressed={q.type === t} onClick={() => setQ({ ...q, type: t as CatalogType })} className={chip(q.type === t)}>
              {CATALOG_TYPE_LABEL[t]} <span className="opacity-60">{counts[t]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-sans text-xs text-brand-fg/85">
            <input type="checkbox" checked={q.fitsOnly} onChange={(e) => setQ({ ...q, fitsOnly: e.target.checked })}
              className="h-4 w-4 accent-[color:var(--color-accent)]" />
            Only what fits this slot
          </label>
          <span className="font-sans text-[11px] text-brand-muted/70">
            {fitting} of {shown.length} fit{pending ? ' · loading more…' : ''}
          </span>
        </div>
        {failedNames.length > 0 && (
          <p className="flex items-start gap-2 font-sans text-xs text-amber-300/90">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Couldn't load {failedNames.join(', ')}. The rest is here; close and reopen to try again.
          </p>
        )}
      </div>

      <div className="mt-4 min-h-[12rem]">
        {shown.length === 0 ? (
          <p className="py-10 text-center font-sans text-sm text-brand-muted/60">
            {pending ? 'Loading…' : q.text !== '' ? 'Nothing matches that search.' : 'Nothing here yet. Try another source, or upload a file.'}
          </p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {shown.map((e) => <Tile key={e.key} e={e} selected={e.pick !== null && isSelected(e.pick)} multiple={multiple} onPick={toggle} />)}
          </ul>
        )}
      </div>

      {multiple && (
        <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex items-center gap-3 border-t border-white/[0.06] bg-black/40 px-6 py-3 backdrop-blur md:-mx-8 md:-mb-8 md:px-8">
          <span className="font-sans text-xs text-brand-muted/70">{selected.length} selected</span>
          <button
            disabled={selected.length === 0}
            onClick={() => onPick(selected)}
            className="pressable ml-auto min-h-11 rounded-xl px-5 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40"
          >
            Add {selected.length > 0 ? selected.length : ''}
          </button>
        </div>
      )}
    </Modal>
  );
}

function Tile({ e, selected, multiple, onPick }: { e: CatalogEntry; selected: boolean; multiple: boolean; onPick: (p: PickedAsset) => void }) {
  const p = e.pick;
  const kind: LookUrlKind = p?.kind ?? (e.type === '3d' || e.type === 'scene' ? 'model' : e.type === 'video' ? 'video' : 'image');
  return (
    <li>
      <button
        type="button"
        onClick={p !== null ? () => onPick(p) : undefined}
        aria-disabled={p === null}
        aria-pressed={multiple && p !== null ? selected : undefined}
        title={p === null ? (e.reason ?? undefined) : e.warn}
        className={`group relative w-full rounded-xl border p-1.5 text-left transition-colors ${
          p === null ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.015]'
            : selected ? 'pressable border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10' : 'pressable border-white/10 bg-white/[0.03] hover:border-white/25'
        }`}
      >
        <span className={p === null ? 'block opacity-45 grayscale' : 'block'}>
          <AssetThumb thumb={e.thumb ?? p?.thumb} kind={kind} url={p?.url} />
        </span>
        <span className={`mt-1.5 block truncate font-sans text-[11px] ${p === null ? 'text-brand-muted/70' : 'text-brand-fg/85'}`}>{e.name}</span>
        <span className="block truncate font-sans text-[10px] text-brand-muted/70">
          {CATALOG_TYPE_LABEL[e.type]}{e.badges.length > 0 ? ` · ${e.badges.join(' · ')}` : ''}
        </span>
        {p === null && e.reason !== null && (
          <span className="mt-0.5 block font-sans text-[10px] leading-snug text-amber-200/80">{e.reason}</span>
        )}
        {p !== null && e.warn !== undefined && (
          <span className="mt-0.5 block font-sans text-[10px] leading-snug text-brand-muted/70">Linked to its event</span>
        )}
        {selected && (
          <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-[color:var(--color-accent)] text-[color:var(--on-accent)]">
            <Check className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
    </li>
  );
}

/** A square preview: the image when there is one, a swatch for a tint, else an icon for the kind. */
export function AssetThumb({ thumb, kind, url, className = '' }: { thumb?: string | null; kind: LookUrlKind; url?: string; className?: string }) {
  const swatch = kind === 'builtin' && url !== undefined ? tintSwatch(url) : undefined;
  if (swatch !== undefined) {
    return (
      <span className={`relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg ${className}`}>
        <span className="h-3/5 w-3/5 rounded-full shadow-[0_0_24px_rgba(255,255,255,0.25)]" style={{ background: swatch }} />
      </span>
    );
  }
  const Icon = kind === 'builtin' ? Sparkles : kind === 'model' ? Box : kind === 'video' ? Film : ImageIcon;
  return (
    <span className={`relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] ${className}`}>
      {thumb != null && thumb !== '' ? (
        <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <Icon className="h-7 w-7 text-brand-muted/50" />
      )}
      {kind === 'builtin' && url !== undefined && url.startsWith('fx:') && (
        <span className="absolute inset-x-0 bottom-1 truncate px-1 text-center font-sans text-[10px] text-brand-muted/80">{url.slice(3)}</span>
      )}
    </span>
  );
}
