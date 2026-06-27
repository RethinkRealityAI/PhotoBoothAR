/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detola & Wuyi lockup — the couple's ornate gold "DW" crest, supplied as a
 * transparent PNG (extracted from their wedding monogram). The full crest (with
 * the "DETOLA & WUYI" lettering) is the wordmark; the crest-only mark is used
 * wherever a compact emblem appears.
 */
import crest from './dw-crest.png';
import emblem from './dw-emblem.png';

const WORDMARK_HEIGHT: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 84,
  md: 132,
  lg: 196,
  xl: 260,
};

export function DetolaWuyiWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <img
      src={crest}
      alt="Detola & Wuyi"
      className="object-contain select-none"
      style={{ height: WORDMARK_HEIGHT[size], width: 'auto', maxWidth: '90vw' }}
    />
  );
}

/** Bare crest emblem (no names) for small brand marks. */
export function DetolaWuyiEmblem({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <img
      src={emblem}
      alt=""
      className={`object-contain select-none ${className ?? ''}`}
      style={{ height: size, width: 'auto' }}
      aria-hidden
    />
  );
}

/** Compact mark for nav bars: crest emblem + names. */
export function DetolaWuyiMark() {
  return (
    <div className="flex items-center gap-3 select-none">
      <img src={emblem} alt="" className="object-contain" style={{ height: 40, width: 'auto' }} aria-hidden />
      <span className="font-serif italic text-xl tracking-tight text-foil-static">Detola &amp; Wuyi</span>
    </div>
  );
}
