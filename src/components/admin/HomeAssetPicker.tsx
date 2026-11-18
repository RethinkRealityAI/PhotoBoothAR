/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The asset chooser behind every slot on /admin/home-assets. Four sources, one
 * grid: the shared Studio library (admin-api list_library_items), the props
 * and frames bundled with the app, files already uploaded for the homepage
 * (assets/_platform/landing/), and a fresh upload. Every pick is re-checked
 * through resolveAssetUrl for the slot's kinds before it is handed back, so a
 * wrong-kind file can never land in a slot.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, Film, ImageIcon, Upload } from 'lucide-react';
import Modal from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { fetchLibraryItems, type LibraryItemRow } from '../../lib/adminLibrary';
import { listLandingMedia, uploadLandingMedia, type LandingMediaItem } from '../../lib/landingMedia';
import {
  BUILTIN_ASSETS,
  categoryForLibraryKind,
  lookFromBuiltin,
  lookFromLibraryItem,
  resolveAssetUrl,
  type AssetKind,
  type HomeLook,
  type HomeLookCategory,
} from '../../lib/homeAssets';

/** One choosable asset: always a URL; a look when it came from a look source. */
export interface PickedAsset {
  url: string;
  kind: AssetKind;
  name: string;
  thumb?: string;
  look?: HomeLook;
}

type Source = 'library' | 'builtin' | 'uploads';

const SOURCE_LABEL: Record<Source, string> = { library: 'Studio library', builtin: 'Built-in', uploads: 'Uploaded' };

const ACCEPT_ATTR: Record<AssetKind, string> = {
  image: 'image/png,image/webp,image/jpeg,image/gif,image/avif',
  video: 'video/mp4,video/webm',
  model: '.glb,model/gltf-binary',
};

function kindOf(url: string | null | undefined, accept: AssetKind[]): AssetKind | undefined {
  return accept.find((k) => resolveAssetUrl(url, k) !== undefined);
}

/** File name without its extension — uploadLandingMedia appends the extension
 *  itself, so passing "crown.glb" would store "…-crown.glb.glb". */
function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Browsers report '' for .glb; give it a type so the stored extension is right. */
function retype(file: File): File {
  if (file.type === '' && /\.glb$/i.test(file.name)) return new File([file], file.name, { type: 'model/gltf-binary' });
  return file;
}

export default function HomeAssetPicker({
  title,
  accept,
  category,
  multiple = false,
  onPick,
  onClose,
}: {
  title: string;
  /** The asset kinds this slot takes. */
  accept: AssetKind[];
  /** Look slots: the category picks are filed under (library items keep the
   *  category their kind maps to unless this is set). */
  category?: HomeLookCategory;
  multiple?: boolean;
  onPick: (assets: PickedAsset[]) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source>('library');
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
    return () => {
      live = false;
    };
  }, []);

  const options = useMemo((): PickedAsset[] => {
    const asLookPick = (look: HomeLook | null): PickedAsset | null => {
      if (look === null) return null;
      const kind = kindOf(look.url, accept);
      return kind === undefined ? null : { url: look.url, kind, name: look.name, thumb: look.thumb, look };
    };
    if (source === 'library') {
      // A look slot only offers items OF that category (frames for frames…):
      // a 3D prop's thumbnail is an image, but it is not a frame. Filters and
      // effects share their sources (shader / sticker / scene items).
      const fits = (kind: string) => {
        if (category === undefined) return true;
        const own = categoryForLibraryKind(kind);
        const loose = (c: HomeLookCategory) => c === 'filter' || c === 'effect';
        return own === category || (loose(own) && loose(category));
      };
      return (library ?? [])
        .filter((item) => fits(item.kind))
        .map((item) => {
          const cat = category ?? categoryForLibraryKind(item.kind);
          const look = lookFromLibraryItem(item, cat);
          if (look !== null) return asLookPick(look);
          if (category !== undefined) return null;
          // Plain URL slots (wall photos…) can still take a library item's image.
          const url = [item.assetUrl, item.thumbnailUrl].find((u) => kindOf(u, accept) !== undefined);
          if (url == null) return null;
          return { url, kind: kindOf(url, accept)!, name: item.name, thumb: resolveAssetUrl(item.thumbnailUrl, 'image') };
        })
        .filter((p): p is PickedAsset => p !== null);
    }
    if (source === 'builtin') {
      return BUILTIN_ASSETS.filter((a) => category === undefined || a.category === category)
        .map((a) => {
          const look = lookFromBuiltin(a);
          const pick = asLookPick(look);
          if (pick !== null) return pick;
          const kind = kindOf(a.url, accept);
          return kind === undefined ? null : { url: a.url, kind, name: a.name, thumb: a.thumb };
        })
        .filter((p): p is PickedAsset => p !== null);
    }
    return (uploads ?? [])
      .map((u): PickedAsset | null => {
        const kind = kindOf(u.url, accept);
        if (kind === undefined) return null;
        return { url: u.url, kind, name: stem(u.name.replace(/^[0-9a-f-]{36}-/i, '')), thumb: kind === 'image' ? u.url : undefined };
      })
      .filter((p): p is PickedAsset => p !== null);
  }, [source, library, uploads, accept, category]);

  const isSelected = (p: PickedAsset) => selected.some((s) => s.url === p.url);
  const toggle = (p: PickedAsset) => {
    if (!multiple) {
      onPick([p]);
      return;
    }
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
      const kind = url === null ? undefined : kindOf(url, accept);
      if (url === null || kind === undefined) {
        toast.push(
          url === null ? `Couldn't upload ${raw.name}. Nothing was changed.` : `${raw.name} isn't a file this slot takes.`,
          'error',
        );
        continue;
      }
      done.push({ url, kind, name: stem(raw.name), thumb: kind === 'image' ? url : undefined });
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
                source === s
                  ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg'
                  : 'bg-white/[0.03] border-white/10 text-brand-muted/70 hover:text-brand-fg'
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
          {uploading > 0 ? `Uploading ${uploading}…` : multiple ? 'Upload new files' : 'Upload new'}
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
          <p className="py-10 text-center font-sans text-sm text-brand-muted/60">
            Nothing here fits this slot yet. Try another source, or upload a file.
          </p>
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
                  <AssetThumb thumb={p.thumb} kind={p.kind} />
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

/** A square preview: the image when there is one, else an icon for the kind. */
export function AssetThumb({ thumb, kind, className = '' }: { thumb?: string; kind: AssetKind; className?: string }) {
  const Icon = kind === 'model' ? Box : kind === 'video' ? Film : ImageIcon;
  return (
    <span
      className={`relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] ${className}`}
    >
      {thumb !== undefined ? (
        <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <Icon className="h-7 w-7 text-brand-muted/50" />
      )}
      {kind !== 'image' && thumb !== undefined && (
        <Icon className="absolute bottom-1 right-1 h-3.5 w-3.5 text-white/80 drop-shadow" />
      )}
    </span>
  );
}
