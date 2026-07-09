/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Assets Library — every file uploaded to the Supabase `assets` bucket. Confirms
 * that uploads persist, lets you upload new assets directly, copy their URL, or
 * delete them. Auto-generated camera thumbnails (thumb-*) are hidden by default.
 */
import { useEffect, useState, useCallback, useRef, ChangeEvent } from 'react';
import {
  RefreshCw, Upload, Copy, Check, Trash2, X, Image as ImageIcon, Box, FileQuestion,
} from 'lucide-react';
import { listAssets, uploadAsset, deleteAsset, type StoredAsset } from '../../lib/db';
import { classifyAsset } from '../../lib/studio/dnd';

function prettySize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetCard({ asset, onDeleted }: { asset: StoredAsset; onDeleted: () => void }) {
  const [copied, setCopied] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const cls = classifyAsset(asset.name, asset.mimetype);

  const copy = () => navigator.clipboard.writeText(asset.url).then(() => {
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  });
  const remove = async () => {
    setBusy(true);
    const ok = await deleteAsset(asset.path);
    setBusy(false);
    if (ok) onDeleted();
    else setConfirmDel(false);
  };

  return (
    <div className="group relative rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden flex flex-col">
      {/* Preview */}
      <div
        className="relative h-36 flex items-center justify-center"
        style={{ background: 'repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, rgba(255,255,255,0.06) 0% 50%) 50% / 18px 18px' }}
      >
        {cls === 'image' ? (
          <img src={asset.url} alt={asset.name} className="max-w-full max-h-full object-contain p-2" loading="lazy" />
        ) : cls === 'model' ? (
          <div className="flex flex-col items-center gap-1.5 text-accent-2"><Box className="w-8 h-8" /><span className="font-label text-[8px] uppercase tracking-widest">3D Model</span></div>
        ) : (
          <FileQuestion className="w-8 h-8 text-brand-muted/40" />
        )}
      </div>

      {/* Meta */}
      <div className="p-3 flex flex-col gap-2">
        <p className="font-sans text-[11px] text-brand-fg/85 truncate" title={asset.name}>{asset.name}</p>
        <div className="flex items-center justify-between text-[9px] font-label uppercase tracking-widest text-brand-muted/40">
          <span>{prettySize(asset.size)}</span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={copy}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white/[0.04] rounded-lg text-[9px] font-label uppercase tracking-widest text-brand-muted/60 hover:text-accent-2 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy URL'}
          </button>
          {confirmDel ? (
            <div className="flex gap-0.5">
              <button onClick={remove} disabled={busy} className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setConfirmDel(false)} className="p-1.5 rounded-lg bg-white/[0.04] text-brand-muted/40 hover:text-brand-fg transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)} title="Delete asset" className="p-1.5 bg-white/[0.04] rounded-lg text-brand-muted/30 hover:text-rose-400 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Assets() {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setAssets(await listAssets());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await uploadAsset(file, file.name.replace(/\.[^.]+$/, ''));
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    load();
  }, [load]);

  const visible = assets.filter((a) => showThumbs || !a.name.toLowerCase().startsWith('thumb-'));
  const thumbCount = assets.length - assets.filter((a) => !a.name.toLowerCase().startsWith('thumb-')).length;

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar app-bg">
      <div className="relative z-10 p-6 md:p-8 flex flex-col gap-8">

        {/* Header */}
        <header className="flex items-center justify-between gap-3 animate-rise-in flex-wrap">
          <div>
            <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/40 mb-1">AR Studio</p>
            <h1 className="font-serif italic text-3xl text-foil-static">Assets Library</h1>
            <p className="font-sans text-xs text-brand-muted/45 mt-1">
              {loading ? 'Loading…' : `${visible.length} asset${visible.length === 1 ? '' : 's'}${thumbCount > 0 ? ` · ${thumbCount} thumbnail${thumbCount === 1 ? '' : 's'} hidden` : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowThumbs((v) => !v)}
              className={`px-3 py-2 rounded-xl text-[9px] font-label uppercase tracking-widest transition-colors ${showThumbs ? 'bg-accent/20 text-accent-2' : 'bg-white/[0.04] text-brand-muted/40 hover:text-accent-2'}`}
            >
              {showThumbs ? 'Hide thumbnails' : 'Show thumbnails'}
            </button>
            <button onClick={load} disabled={loading} className="p-2 bg-white/[0.04] rounded-xl text-brand-muted/40 hover:text-accent-2 transition-colors disabled:opacity-30">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-foil text-white font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-accent hover:scale-[1.02] transition-transform disabled:opacity-50"
            >
              {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,.glb,.gltf"
              multiple
              className="sr-only"
              onChange={onUpload}
            />
          </div>
        </header>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-56 liquid-glass rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="liquid-glass rounded-2xl p-12 text-center flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/25 flex items-center justify-center">
              <ImageIcon className="w-7 h-7 text-accent-2" />
            </div>
            <p className="font-serif italic text-2xl text-foil-static">No assets yet</p>
            <p className="font-sans text-sm text-brand-muted/40 max-w-sm">
              Upload borders, stickers or 3D models here — or they'll appear automatically when you upload one inside an experience.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="px-6 py-3 bg-foil text-white font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-accent"
            >
              Upload your first asset
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {visible.map((a) => (
              <AssetCard key={a.path} asset={a} onDeleted={load} />
            ))}
          </div>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
