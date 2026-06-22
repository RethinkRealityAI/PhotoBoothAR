/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hope Gala wordmark lockup — elegant serif display with gold-foil treatment
 * and the script "& Awards" flourish from the invitation, crowned by the
 * animated SCAGO emblem.
 */
import ScagoMark from './ScagoMark';

export function HopeGalaWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const scale = {
    sm: { eyebrow: 'text-[9px]', title: 'text-2xl', script: 'text-xl', mark: 36 },
    md: { eyebrow: 'text-[10px]', title: 'text-4xl', script: 'text-3xl', mark: 52 },
    lg: { eyebrow: 'text-xs', title: 'text-6xl', script: 'text-5xl', mark: 76 },
    xl: { eyebrow: 'text-sm', title: 'text-7xl sm:text-8xl', script: 'text-6xl sm:text-7xl', mark: 104 },
  }[size];

  return (
    <div className="flex flex-col items-center text-center leading-none select-none">
      <ScagoMark size={scale.mark} variant="gold" animated className="mb-4 drop-shadow-[0_0_24px_rgba(var(--accent-rgb),0.35)]" title="SCAGO" />
      <span className={`font-label uppercase tracking-luxe text-champagne/70 ${scale.eyebrow} mb-2`}>
        SCAGO · 2026
      </span>
      <span className={`font-serif font-semibold tracking-wide gold-foil ${scale.title}`}>
        HOPE GALA
      </span>
      <span className={`font-script gold-foil-static -mt-1 ${scale.script}`}>&amp; Awards</span>
    </div>
  );
}

/** Bare SCAGO emblem (no text) for small brand marks. */
export function HopeGalaEmblem({ size = 34, className }: { size?: number; className?: string }) {
  return <ScagoMark size={size} variant="gold" animated className={className} title="SCAGO" />;
}

/** Compact mark for nav bars. SCAGO sits ABOVE the Hope Gala wordmark. */
export function HopeGalaMark() {
  return (
    <div className="flex items-center gap-3 select-none">
      <ScagoMark size={36} variant="gold" animated className="shrink-0" title="SCAGO" />
      <div className="flex flex-col leading-none">
        <span className="font-label uppercase tracking-luxe text-[8px] text-champagne/60 mb-1">SCAGO · 2026</span>
        <span className="font-serif italic text-xl tracking-wide text-ivory">Hope Gala &amp; Awards</span>
      </div>
    </div>
  );
}
