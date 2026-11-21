/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The optional decorative border round the guest welcome page
 * (EventScene.border). Pure CSS (platform.css `[data-page-border]`), never
 * interactive, and its one moving part (the Glow rim) stops under
 * prefers-reduced-motion. `contained` draws it inside its parent instead of
 * the viewport — the host picker's preview uses that.
 */
import type { ScenePageBorder } from '../../lib/sceneThemes';

function Flourish({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 80 80" className={`absolute h-12 w-12 sm:h-16 sm:w-16 ${className}`} fill="none" stroke="#D9B865" aria-hidden>
      <path d="M4 76 V22 Q4 4 22 4 H76" strokeWidth="1.6" strokeOpacity="0.85" />
      <path d="M12 76 V28 Q12 12 28 12 H76" strokeWidth="0.8" strokeOpacity="0.55" />
      <path d="M22 22 q10 -2 12 -12 M22 22 q-2 10 -12 12" strokeWidth="1.2" strokeOpacity="0.8" />
      <circle cx="22" cy="22" r="2.6" fill="#D9B865" stroke="none" />
    </svg>
  );
}

export default function PageBorder({ border, contained = false }: { border: ScenePageBorder; contained?: boolean }) {
  if (border === 'none') return null;
  return (
    <div
      aria-hidden
      data-page-border={border}
      data-contained={contained ? '' : undefined}
      className={`pointer-events-none ${contained ? 'absolute' : 'fixed'} inset-0 z-30`}
    >
      {border === 'glow' && (
        <span className="pb-glow">
          <span />
        </span>
      )}
      {border === 'filmstrip' && (
        <>
          <span className="pb-rail left-0" />
          <span className="pb-rail right-0" />
        </>
      )}
      {border === 'gilded' && (
        <>
          <span className="pb-gild-line" />
          <Flourish className="left-2 top-2 sm:left-3 sm:top-3" />
          <Flourish className="right-2 top-2 rotate-90 sm:right-3 sm:top-3" />
          <Flourish className="bottom-2 right-2 rotate-180 sm:bottom-3 sm:right-3" />
          <Flourish className="bottom-2 left-2 -rotate-90 sm:bottom-3 sm:left-3" />
        </>
      )}
    </div>
  );
}
