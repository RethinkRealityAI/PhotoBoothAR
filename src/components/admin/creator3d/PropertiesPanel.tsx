/**
 * RIGHT PANEL: numeric transform sliders kept in sync with the gizmo.
 * Offset XYZ, Rotation XYZ, uniform Scale.
 * Also: Name input, Published + Featured toggles.
 */
import { ChangeEvent } from 'react';
import { Upload, Image as ImageIcon, X } from 'lucide-react';
import { AnchorConfig } from '../../../types';

interface Props {
  name: string;
  isPublished: boolean;
  featured: boolean;
  anchorConfig: Partial<AnchorConfig>;
  saving: boolean;
  thumbnailUrl?: string | null;
  onThumbnailUpload?: (file: File) => void;
  onThumbnailClear?: () => void;
  onNameChange: (v: string) => void;
  onPublishedChange: (v: boolean) => void;
  onFeaturedChange: (v: boolean) => void;
  onTransformChange: (patch: Partial<AnchorConfig>) => void;
  onSave: () => void;
  onBack: () => void;
}

type XYZ = { x: number; y: number; z: number };

function SliderGroup({
  label,
  value,
  onChange,
  min = -8,
  max = 8,
  step = 0.05,
  unit = '',
}: {
  label: string;
  value: XYZ;
  onChange: (v: XYZ) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-label text-[9px] uppercase tracking-luxe text-champagne/50">{label}</p>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <div key={axis} className="flex items-center gap-2">
          <span className="font-label text-[10px] w-3 text-gold-500 uppercase shrink-0">{axis}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value[axis]}
            onChange={(e) => onChange({ ...value, [axis]: parseFloat(e.target.value) })}
            className="flex-1 accent-gold-400 h-1"
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={parseFloat(value[axis].toFixed(3))}
            onChange={(e) => onChange({ ...value, [axis]: parseFloat(e.target.value) || 0 })}
            className="w-16 bg-noir-800/80 border border-gold-700/25 rounded text-right
                       font-sans text-[10px] text-ivory/80 px-1.5 py-0.5 focus:outline-none
                       focus:border-gold-400/60"
          />
          {unit && <span className="font-sans text-[9px] text-ivory/30 shrink-0">{unit}</span>}
        </div>
      ))}
    </div>
  );
}

export default function PropertiesPanel({
  name,
  isPublished,
  featured,
  anchorConfig,
  saving,
  thumbnailUrl,
  onThumbnailUpload,
  onThumbnailClear,
  onNameChange,
  onPublishedChange,
  onFeaturedChange,
  onTransformChange,
  onSave,
  onBack,
}: Props) {
  const handleThumbInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onThumbnailUpload?.(file);
    e.target.value = '';
  };
  const offset   = anchorConfig.offset   ?? { x: 0, y: 0, z: 0 };
  const rotation = anchorConfig.rotation ?? { x: 0, y: 0, z: 0 };
  const scale    = anchorConfig.scale    ?? 1;

  function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
      <button
        onClick={() => onChange(!value)}
        className={[
          'flex items-center gap-2 w-full rounded-lg px-3 py-2 border transition-all',
          value
            ? 'border-gold-500/50 bg-gold-400/10'
            : 'border-gold-700/20 bg-noir-800/40 opacity-60',
        ].join(' ')}
      >
        <div className={['w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors',
          value ? 'bg-gold-400 border-gold-400' : 'bg-transparent border-ivory/30'].join(' ')} />
        <span className="font-label text-[10px] uppercase tracking-luxe text-ivory/70">{label}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="px-4 py-3 border-b border-gold-700/20">
        <p className="font-label text-[10px] uppercase tracking-luxe text-champagne/50">Properties</p>
      </div>

      <div className="flex-1 overflow-y-auto hide-scrollbar px-4 py-4 space-y-5">
        {/* ── name ── */}
        <div>
          <label className="block font-label text-[9px] uppercase tracking-luxe text-champagne/50 mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Experience name…"
            className="w-full bg-noir-800/80 border border-gold-700/25 rounded-lg
                       font-sans text-sm text-ivory/90 placeholder-ivory/25
                       px-3 py-2 focus:outline-none focus:border-gold-400/60 transition-colors"
          />
        </div>

        {/* ── booth icon ── */}
        <div>
          <label className="block font-label text-[9px] uppercase tracking-luxe text-champagne/50 mb-1.5">
            Booth Icon (optional)
          </label>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-noir-800 border border-gold-700/25 flex items-center justify-center shrink-0">
              {thumbnailUrl
                ? <img src={thumbnailUrl} alt="icon" className="w-full h-full object-cover" />
                : <ImageIcon className="w-5 h-5 text-gold-400/40" />}
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <label className="flex items-center gap-2 px-3 py-2 bg-noir-800/70 border border-gold-700/25 rounded-lg cursor-pointer hover:border-gold-400/50 transition-colors text-xs text-champagne/65">
                <Upload className="w-3.5 h-3.5 text-gold-300 shrink-0" />
                {thumbnailUrl ? 'Replace icon' : 'Upload icon'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={handleThumbInput} />
              </label>
              {thumbnailUrl && (
                <button
                  onClick={() => onThumbnailClear?.()}
                  className="flex items-center justify-center gap-1.5 px-3 py-1 bg-noir-800/60 border border-gold-700/20 rounded-lg text-[9px] font-label uppercase tracking-widest text-red-400/70 hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" /> Remove icon
                </button>
              )}
            </div>
          </div>
          <p className="text-[9px] text-ivory/30 mt-1.5 leading-relaxed">
            Shown as this piece's icon in the booth picker. If empty, a crown icon is used.
          </p>
        </div>

        {/* ── offset ── */}
        <SliderGroup
          label="Offset (cm)"
          value={offset}
          onChange={(v) => onTransformChange({ offset: v })}
          min={-20}
          max={20}
          step={0.1}
        />

        {/* ── rotation ── */}
        <SliderGroup
          label="Rotation (rad)"
          value={rotation}
          onChange={(v) => onTransformChange({ rotation: v })}
          min={-Math.PI}
          max={Math.PI}
          step={0.01}
          unit="rad"
        />

        {/* ── scale ── slider goes to 15; type any value up to 100 ── */}
        <div>
          <p className="font-label text-[9px] uppercase tracking-luxe text-champagne/50 mb-1.5">Scale</p>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.05}
              max={15}
              step={0.05}
              value={Math.min(scale, 15)}
              onChange={(e) => onTransformChange({ scale: parseFloat(e.target.value) })}
              className="flex-1 accent-gold-400 h-1"
            />
            <input
              type="number"
              min={0.01}
              max={100}
              step={0.05}
              value={parseFloat(scale.toFixed(3))}
              onChange={(e) => onTransformChange({ scale: parseFloat(e.target.value) || 1 })}
              className="w-16 bg-noir-800/80 border border-gold-700/25 rounded text-right
                         font-sans text-[10px] text-ivory/80 px-1.5 py-0.5
                         focus:outline-none focus:border-gold-400/60"
            />
          </div>
        </div>

        {/* divider */}
        <div className="border-t border-gold-700/15" />

        {/* ── toggles ── */}
        <div className="space-y-2">
          <Toggle label="Published" value={isPublished} onChange={onPublishedChange} />
          <Toggle label="Featured"  value={featured}    onChange={onFeaturedChange} />
        </div>
      </div>

      {/* ── footer actions ── */}
      <div className="px-4 py-4 border-t border-gold-700/20 space-y-2 shrink-0">
        <button
          onClick={onSave}
          disabled={saving}
          className="w-full bg-foil glow-accent text-noir-900 font-label text-xs uppercase
                     tracking-luxe rounded-xl py-2.5 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Experience'}
        </button>
        <button
          onClick={onBack}
          className="w-full glass text-ivory/60 font-label text-xs uppercase
                     tracking-luxe rounded-xl py-2 hover:text-ivory/90 transition-colors"
        >
          ← Library
        </button>
      </div>
    </div>
  );
}
