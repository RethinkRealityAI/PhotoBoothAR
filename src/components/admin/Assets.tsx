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
import GalaBackground from '../ui/GalaBackground';
import { listAssets, uploadAsset, deleteAsset, type StoredAsset } from '../../lib/db';

function isImage(a: StoredAsset): boolean {
  if (a.mimetype?.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|svg|gif)$/i.test(a.name);
}
function is3D(a: StoredAsset): boolean {
  return /\.(glb|gltf)$/i.test(a.name);
}
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
    <div className="group relative rounded-2xl border border-gold-400/12 bg-noir-800/40 overflow-hidden flex flex-col">
      {/* Preview */}
      <div
        className="relative h-36 flex items-center justify-center"
        style={{ background: 'repeating-conic-gradient(#15110a 0% 25%, #1d160c 0% 50%) 50% / 18px 18px' }}
      >
        {isImage(asset) ? (
          <img src={asset.url} alt={asset.name} className="max-w-full max-h-full object-contain p-2" loading="lazy" />
        ) : is3D(asset) ? (
          <div className="flex flex-col items-center gap-1.5 text-emerald-300/70"><Box className="w-8 h-8" /><span className="font-label text-[8px] uppercase tracking-widest">3D Model</span></div>
        ) : (
          <FileQuestion className="w-8 h-8 text-champagne/40" />
        )}
      </div>

      {/* Meta */}
      <div className="p-3 flex flex-col gap-2">
        <p className="font-sans text-[11px] text-ivory/85 truncate" title={asset.name}>{asset.name}</p>
        <div className="flex items-center justify-between text-[9px] font-label uppercase tracking-widest text-champagne/35">
          <span>{prettySize(asset.size)}</span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={copy}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 glass rounded-lg text-[9px] font-label uppercase tracking-widest text-champagne/55 hover:text-gold-300 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy URL'}
          </button>
          {confirmDel ? (
            <div className="flex gap-0.5">
              <button onClick={remove} disabled={busy} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setConfirmDel(false)} className="p-1.5 rounded-lg glass text-champagne/40 hover:text-ivory transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)} title="Delete asset" className="p-1.5 glass rounded-lg text-champagne/30 hover:text-red-400 transition-colors">
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
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <GalaBackground density={26} />
      <div className="relative z-10 p-6 md:p-8 flex flex-col gap-8">

        {/* Header */}
        <header className="flex items-center justify-between gap-3 animate-rise-in flex-wrap">
          <div>
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 mb-1">AR Studio</p>
            <h1 className="font-serif italic text-3xl gold-foil-static">Assets Library</h1>
            <p className="font-sans text-xs text-champagne/45 mt-1">
              {loading ? 'Loading…' : `${visible.length} asset${visible.length === 1 ? '' : 's'}${thumbCount > 0 ? ` · ${thumbCount} thumbnail${thumbCount === 1 ? '' : 's'} hidden` : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowThumbs((v) => !v)}
              className={`px-3 py-2 rounded-xl text-[9px] font-label uppercase tracking-widest transition-colors ${showThumbs ? 'bg-gold-400/20 text-gold-300' : 'glass text-champagne/40 hover:text-gold-300'}`}
            >
              {showThumbs ? 'Hide thumbnails' : 'Show thumbnails'}
            </button>
            <button onClick={load} disabled={loading} className="p-2 glass rounded-xl text-champagne/40 hover:text-gold-300 transition-colors disabled:opacity-30">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-foil text-noir-900 font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-gold hover:scale-[1.02] transition-transform disabled:opacity-50"
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
              <div key={i} className="h-56 glass rounded-2xl border border-gold-400/10 animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="glass rounded-2xl border border-gold-400/10 p-12 text-center flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gold-400/10 border border-gold-400/25 flex items-center justify-center">
              <ImageIcon className="w-7 h-7 text-gold-400/60" />
            </div>
            <p className="font-serif italic text-2xl gold-foil-static">No assets yet</p>
            <p className="font-sans text-sm text-champagne/40 max-w-sm">
              Upload borders, stickers or 3D models here — or they'll appear automatically when you upload one inside an experience.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="px-6 py-3 bg-foil text-noir-900 font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-gold"
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
