/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Jenna & Jake festival lockup — a holographic heart crowned by festival
 * sunglasses, with the names in a holographic foil sweep. The shades are the
 * couple's signature: they wear them at every festival.
 */

/** The heart-and-sunglasses emblem. Holographic neon gradient + glow. */
function HeartGlasses({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 116"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
      style={{ filter: 'drop-shadow(0 0 14px rgba(255,45,155,0.55)) drop-shadow(0 0 26px rgba(25,227,255,0.35))' }}
    >
      <defs>
        <linearGradient id="jj-holo" x1="6" y1="6" x2="114" y2="110" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF2D9B" />
          <stop offset="0.34" stopColor="#19E3FF" />
          <stop offset="0.6" stopColor="#C6FF1A" />
          <stop offset="1" stopColor="#7A2BFF" />
        </linearGradient>
        <linearGradient id="jj-lens" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#19E3FF" stopOpacity="0.85" />
          <stop offset="1" stopColor="#7A2BFF" stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* heart */}
      <path
        d="M60 104 C22 78 9 55 9 35 C9 19 22 9 37 9 C48 9 55 15 60 24 C65 15 72 9 83 9 C98 9 111 19 111 35 C111 55 98 78 60 104 Z"
        stroke="url(#jj-holo)"
        strokeWidth="5"
        strokeLinejoin="round"
        fill="none"
      />

      {/* festival sunglasses across the heart's upper dip */}
      <g stroke="url(#jj-holo)" strokeWidth="4" strokeLinejoin="round">
        <rect x="30" y="34" width="22" height="15" rx="6" fill="url(#jj-lens)" />
        <rect x="68" y="34" width="22" height="15" rx="6" fill="url(#jj-lens)" />
        <path d="M52 39 C57 36 63 36 68 39" fill="none" />
        <path d="M30 38 L22 33" fill="none" strokeLinecap="round" />
        <path d="M90 38 L98 33" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const SIZES = {
  sm: { mark: 46, title: 'text-2xl', eyebrow: 'text-[9px]' },
  md: { mark: 66, title: 'text-4xl', eyebrow: 'text-[10px]' },
  lg: { mark: 94, title: 'text-6xl', eyebrow: 'text-xs' },
  xl: { mark: 122, title: 'text-7xl sm:text-8xl', eyebrow: 'text-sm' },
} as const;

export function JennaJakeWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const s = SIZES[size];
  return (
    <div className="flex flex-col items-center text-center leading-none select-none">
      <HeartGlasses size={s.mark} />
      <span className={`mt-4 font-label uppercase tracking-luxe text-brand-muted/80 ${s.eyebrow} mb-2`}>
        The Wedding Festival
      </span>
      <span className={`font-serif font-extrabold tracking-tight text-foil ${s.title}`}>
        Jenna &amp; Jake
      </span>
    </div>
  );
}

/** Bare heart-and-sunglasses emblem (no text) for small brand marks. */
export function JennaJakeEmblem({ size = 34, className }: { size?: number; className?: string }) {
  return <HeartGlasses size={size} className={className} />;
}

/** Compact mark for nav bars: emblem + names. */
export function JennaJakeMark() {
  return (
    <div className="flex items-center gap-3 select-none">
      <HeartGlasses size={36} />
      <span className="font-serif font-bold text-xl tracking-tight text-foil-static">Jenna &amp; Jake</span>
    </div>
  );
}
