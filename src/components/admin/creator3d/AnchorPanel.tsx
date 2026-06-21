/**
 * LEFT PANEL: asset upload zone + anchor picker list.
 * Styled gold-on-noir, glass panel.
 */
import { useRef, DragEvent } from 'react';
import { Upload, RefreshCw, Crown } from 'lucide-react';
import { ANCHOR_PRESETS } from '../../../lib/faceRig';
import { HEAD_PIECES } from '../../../lib/headPieces';
import { HeadAnchor } from '../../../types';

interface Props {
  assetUrl: string | null;
  assetName: string | null;
  proceduralId?: string | null;
  uploading: boolean;
  anchor: HeadAnchor;
  onUpload: (file: File) => void;
  onAnchorSelect: (a: HeadAnchor) => void;
  onSelectPreset: (id: string) => void;
}

export default function AnchorPanel({
  assetUrl,
  assetName,
  proceduralId,
  uploading,
  anchor,
  onUpload,
  onAnchorSelect,
  onSelectPreset,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const file = Array.from(files).find((f) =>
      /\.(glb|gltf)$/i.test(f.name)
    );
    if (file) onUpload(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── header ── */}
      <div className="px-4 py-3 border-b border-gold-700/20">
        <p className="font-label text-[10px] uppercase tracking-luxe text-champagne/50">Asset</p>
      </div>

      {/* ── upload zone ── */}
      <div className="px-3 py-4 border-b border-gold-700/15">
        <div
          className="relative rounded-xl border border-dashed border-gold-600/40 bg-noir-800/60
                     flex flex-col items-center justify-center gap-2 px-3 py-5 cursor-pointer
                     hover:border-gold-400/70 hover:bg-noir-800/90 transition-colors group"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".glb,.gltf"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          {uploading ? (
            <>
              <RefreshCw size={20} className="text-gold-400 animate-spin" />
              <span className="font-label text-[10px] tracking-luxe text-gold-400 uppercase">Uploading…</span>
            </>
          ) : assetUrl ? (
            <>
              <div className="w-10 h-10 rounded-full bg-foil glow-gold flex items-center justify-center">
                <span className="font-serif italic text-noir-900 text-sm">3D</span>
              </div>
              <span className="font-label text-[10px] tracking-luxe text-ivory/70 uppercase text-center break-all line-clamp-2">
                {assetName ?? 'Model loaded'}
              </span>
              <span className="font-sans text-[9px] text-gold-500/60 group-hover:text-gold-400 transition-colors">
                Click to replace
              </span>
            </>
          ) : (
            <>
              <Upload size={20} className="text-gold-600/60 group-hover:text-gold-400 transition-colors" />
              <span className="font-label text-[10px] tracking-luxe text-ivory/50 uppercase text-center">
                Drop a .glb/.gltf<br/>or click to browse
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── head-piece presets ── */}
      <div className="px-3 py-3 border-b border-gold-700/15">
        <p className="font-label text-[10px] uppercase tracking-luxe text-champagne/50 mb-2 flex items-center gap-1.5">
          <Crown size={11} className="text-gold-400/70" /> Head Piece Presets
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {HEAD_PIECES.map((p) => {
            const active = proceduralId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelectPreset(p.id)}
                className={[
                  'rounded-lg px-2 py-2 text-left transition-all border',
                  active
                    ? 'bg-gold-400/15 border-gold-400/50 text-gold-300'
                    : 'bg-noir-800/50 border-gold-700/20 text-ivory/60 hover:border-gold-500/40 hover:text-ivory/90',
                ].join(' ')}
              >
                <span className="font-label text-[9px] uppercase tracking-wide leading-tight block">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── anchor list ── */}
      <div className="px-4 py-3 border-b border-gold-700/20 shrink-0">
        <p className="font-label text-[10px] uppercase tracking-luxe text-champagne/50">Anchor Point</p>
      </div>
      <div className="flex-1 overflow-y-auto hide-scrollbar py-1">
        {ANCHOR_PRESETS.map((p) => {
          const active = p.id === anchor;
          return (
            <button
              key={p.id}
              onClick={() => onAnchorSelect(p.id)}
              className={[
                'w-full text-left px-4 py-2.5 transition-all flex flex-col gap-0.5',
                active
                  ? 'bg-gold-400/10 border-l-2 border-gold-400'
                  : 'border-l-2 border-transparent hover:bg-gold-700/10 hover:border-gold-700/50',
              ].join(' ')}
            >
              <span
                className={[
                  'font-label text-[11px] uppercase tracking-luxe',
                  active ? 'text-gold-400' : 'text-ivory/80',
                ].join(' ')}
              >
                {p.label}
              </span>
              <span className="font-sans text-[10px] text-ivory/35 leading-tight">{p.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
