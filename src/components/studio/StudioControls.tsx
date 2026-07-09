/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small themed studio controls shared by the docks: a liquid-glass range
 * slider (replaces the legacy GoldSlider) and a pill toggle. Kept token-only
 * (accent / brand-*) so the studio matches the platform, not the gold theme.
 */
import type { ReactNode } from 'react';

export function StudioSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => v.toFixed(2),
  compact = false,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  compact?: boolean;
}) {
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline">
        <span className="font-label uppercase tracking-widest text-[9px] text-brand-muted/70">{label}</span>
        {!compact && <span className="font-mono text-[9px] text-accent-2">{format(value)}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="studio-range w-full h-1 appearance-none rounded-full cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${pct}%, rgba(255,255,255,0.10) ${pct}%, rgba(255,255,255,0.10) 100%)`,
        }}
      />
    </div>
  );
}

export function StudioToggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 border transition-all text-left ${
        value ? 'border-accent/40 bg-accent/10' : 'border-white/10 bg-white/[0.03] opacity-70 hover:opacity-100'
      }`}
    >
      <span
        className={`relative w-8 h-[18px] rounded-full shrink-0 transition-colors ${value ? 'bg-accent/70' : 'bg-white/15'}`}
      >
        <span
          className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${value ? 'translate-x-[16px]' : 'translate-x-0.5'}`}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-label text-[10px] uppercase tracking-widest text-brand-fg">{label}</span>
        {hint && <span className="block font-sans text-[10px] text-brand-muted/60 leading-snug">{hint}</span>}
      </span>
    </button>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="font-label uppercase tracking-widest text-[9px] text-brand-muted/60 mb-2">{children}</p>;
}
