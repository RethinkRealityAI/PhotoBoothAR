/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The asset chooser behind every slot on /admin/home-assets. Three sources,
 * one grid: the shared Studio library (admin-api list_library_items), the
 * props, frames, filters and effects bundled with the homepage, and files
 * already uploaded for the landing pages (assets/_platform/landing/); plus a
 * fresh upload. Every pick is re-checked through lib/homeAssets
 * resolveAssetUrl / lookUrlKind for the slot before it is handed back, so a
 * wrong-kind file can never land in a slot.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, Film, ImageIcon, Sparkles, Upload } from 'lucide-react';
import Modal from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { fetchLibraryItems, type LibraryItemRow } from '../../lib/adminLibrary';
import { listLandingMedia, uploadLandingMedia, type LandingMediaItem } from '../../lib/landingMedia';
import { lookUrlKind, resolveAssetUrl, tintSwatch, type AssetKind, type HomeLook, type LookCategory, type LookUrlKind } from '../../lib/homeAssets';
import {
  BUILTIN_ASSETS, BUILTIN_EFFECT_LOOKS, categoryForLibraryKind, fitForProp, lookFromBuiltin, lookFromLibraryItem,
} from '../../lib/homeAssetSources';

/** One choosable asset: always a URL; a ready look when it came from a look source. */
export interface PickedAsset {
  url: string;
  /** 'builtin' = a file-less `tint:` / `fx:` look. */
  kind: LookUrlKind;
  name: string;
  thumb?: string;
  look?: HomeLook;
}

type Source = 'builtin' | 'library' | 'uploads';
const SOURCE_LABEL: Record<Source, string> = { builtin: 'Built-in', library: 'Studio library', uploads: 'Uploaded' };

const ACCEPT_ATTR: Record<AssetKind, string> = {
  image: 'image/png,image/webp,image/jpeg',
  video: 'video/mp4,video/webm',
  model: '.glb,model/gltf-binary',
};

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

/** An uploaded file as a pick (a look when the slot is a look slot). */
function filePick(url: string, kind: AssetKind, name: string, category: LookCategory | undefined): PickedAsset {
  const thumb = kind === 'image' ? url : undefined;
  if (category === undefined) return { url, kind, name, thumb };
  const look: HomeLook = { id: '', name, category, url, ...(thumb !== undefined ? { thumb } : {}), ...(category === 'prop' ? { fit: fitForProp(url, name) } : {}) };
  return { url, kind, name, thumb, look };
}

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
  const [source, setSource] = useState<Source>('builtin');
  const [library, setLibrary] = useState<LibraryItemRow[] | null>(null);
  const [libraryErr, setLibraryErr] = useState(false);
  const [uploads, setUploads] = useState<LandingMediaItem[] | null>(null);
  const [uploadsErr, setUploadsErr] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [selected, setSelected] = useState<PickedAsset[]>([]);

  useEffect(() => {
    let live = true;
    void fetchLibraryItems().then(({ data, error }) => {
      if (!live) return;
      if (error !== null || data === null) setLibraryErr(true);
      else setLibrary(data.items.filter((i) => i.state === 'listed'));
    });
    void listLandingMedia().then(({ rows, failed }) => {
      if (!live) return;
      setUploads(rows);
      setUploadsErr(failed);
    });
    return () => { live = false; };
  }, []);

  const options = useMemo((): PickedAsset[] => {
    const asPick = (look: HomeLook | null): PickedAsset | null => {
      if (look === null) return null;
      const k = category !== undefined ? lookUrlKind(look.url, category) : kindOf(look.url, accept);
      if (k === undefined) return null;
      return { url: look.url, kind: k, name: look.name, thumb: look.thumb, look: category !== undefined ? { ...look, category } : undefined };
    };
    const keep = (p: PickedAsset | null): p is PickedAsset => p !== null;
    if (source === 'library') {
      // A look slot offers only items OF that category (a 3D prop's thumbnail
      // is an image, but it is not a frame). Filters and effects share sources.
      const loose = (c: LookCategory) => c === 'filter' || c === 'effect';
      const fits = (kind: string) => {
        if (category === undefined) return true;
        const own = categoryForLibraryKind(kind);
        return own === category || (loose(own) && loose(category));
      };
      return (library ?? []).filter((item) => fits(item.kind)).map((item) => {
        if (category !== undefined) return asPick(lookFromLibraryItem(item, category));
        // A plain slot (wall photos, scene props) takes the item's file directly.
        const url = [item.modelUrl, item.assetUrl, item.thumbnailUrl].find((u) => kindOf(u, accept) !== undefined);
        return url == null ? null : { url, kind: kindOf(url, accept)!, name: item.name, thumb: resolveAssetUrl(item.thumbnailUrl, 'image') };
      }).filter(keep);
    }
    if (source === 'builtin') {
      const effects = category === 'filter' || category === 'effect' ? BUILTIN_EFFECT_LOOKS.filter((l) => l.category === category).map(asPick).filter(keep) : [];
      const files = BUILTIN_ASSETS
        .filter((a) => (category === undefined ? kindOf(a.url, accept) !== undefined : a.category === category))
        .map((a) => (category !== undefined ? asPick(lookFromBuiltin(a)) : { url: a.url, kind: kindOf(a.url, accept)!, name: a.name, thumb: a.thumb }))
        .filter(keep);
      return [...effects, ...files];
    }
    return (uploads ?? []).map((u) => {
      const k = kindOf(u.url, accept);
      return k === undefined ? null : filePick(u.url, k, stem(u.name.replace(/^[0-9a-f-]{36}-/i, '')), category);
    }).filter(keep);
  }, [source, library, uploads, accept, category]);

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
      done.push(filePick(url, k, stem(raw.name), category));
    }
    if (done.length === 0) return;
    // A fresh upload is the obvious intent: hand it straight back.
    onPick(multiple ? [...selected, ...done] : done.slice(0, 1));
  }

  const loading = (source === 'library' && library === null && !libraryErr) || (source === 'uploads' && uploads === null);
  const failed = (source === 'library' && libraryErr) || (source === 'uploads' && uploadsErr);

  return (
    <Modal title={title} onClose={onClose} maxWidthClass="max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Where to pick from" className="flex flex-wrap gap-1.5">
          {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={source === s}
              onClick={() => setSource(s)}
              className={`pressable min-h-11 rounded-full px-4 font-label uppercase tracking-luxe text-[10px] border transition-colors ${
                source === s ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg' : 'bg-white/[0.03] border-white/10 text-brand-muted/70 hover:text-brand-fg'
              }`}
            >
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading > 0}
          className="pressable ml-auto min-h-11 rounded-full px-4 inline-flex items-center gap-1.5 bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-50"
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

      <div className="mt-4 min-h-[12rem]">
        {loading ? (
          <p className="py-10 text-center font-sans text-sm text-brand-muted/60">Loading…</p>
        ) : failed ? (
          <p className="py-10 text-center font-sans text-sm text-amber-300/90">
            Couldn't load the {SOURCE_LABEL[source].toLowerCase()} list. Try another source, or upload a file.
          </p>
        ) : options.length === 0 ? (
          <p className="py-10 text-center font-sans text-sm text-brand-muted/60">Nothing here fits this slot yet. Try another source, or upload a file.</p>
        ) : (
          <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
            {options.map((p) => (
              <li key={p.url}>
                <button
                  onClick={() => toggle(p)}
                  aria-pressed={multiple ? isSelected(p) : undefined}
                  className={`pressable group relative w-full rounded-xl border p-1.5 text-left transition-colors ${
                    isSelected(p) ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                  }`}
                >
                  <AssetThumb thumb={p.thumb} kind={p.kind} url={p.url} />
                  <span className="mt-1.5 block truncate font-sans text-[11px] text-brand-fg/85">{p.name}</span>
                  {isSelected(p) && (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-[color:var(--color-accent)] text-[color:var(--on-accent)]">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {multiple && (
        <div className="mt-4 flex items-center gap-3">
          <span className="font-sans text-xs text-brand-muted/60">{selected.length} selected</span>
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
