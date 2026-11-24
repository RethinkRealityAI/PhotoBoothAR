/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LookThumb — one look's picture, shared by the platform strip and the
 * "More looks" sheet so the two can never show the same look differently.
 *
 * Frames and 3D pieces show their real thumbnail; effects show the guest's own
 * face through the actual shader (FilterThumb), over a quiet brand-tinted
 * fallback for when the live engine cannot run. No gradient fills: the brand
 * keeps gradients off controls, and the live preview carries the identity.
 */
import { Box, Palette, Square, Wand2 } from 'lucide-react';
import FilterThumb from './FilterThumb';
import type { LookItem } from '../../lib/lookStrip';
import type { LookTab } from '../../lib/lookTerms';
import { isWorldLook } from '../../lib/world/worldLooks';

/** One icon per tab (lib/lookTerms) — chips, sheet headings, fallbacks. */
export const TAB_ICON: Record<LookTab, typeof Square> = {
  frames: Square,
  props: Box,
  paint: Palette,
  effects: Wand2,
};

/** Fills its (relative, overflow-hidden) parent. */
export default function LookThumb({ item }: { item: LookItem }) {
  const { exp, category } = item;
  if (category === 'effect') {
    return (
      <FilterThumb shaderId={item.shaderId ?? 'none'}>
        <span
          className="flex h-full w-full items-center justify-center"
          style={{ background: 'rgba(var(--accent-rgb), 0.16)' }}
        >
          <Wand2 className="h-5 w-5 text-brand-fg/70" />
        </span>
      </FilterThumb>
    );
  }
  if (isWorldLook(exp)) return <WorldThumb exp={item.exp} />;
  const src = exp.thumbnail_url ?? (category === 'frame' ? exp.asset_url : null);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        className={exp.thumbnail_url ? 'h-full w-full object-cover' : 'h-full w-full object-contain p-1'}
      />
    );
  }
  const Icon = TAB_ICON[item.tab];
  return (
    <span
      className="flex h-full w-full items-center justify-center"
      style={{ background: 'rgba(var(--accent-rgb), 0.12)' }}
    >
      <Icon className="h-5 w-5 text-brand-fg/70" strokeWidth={1.6} />
    </span>
  );
}

/**
 * A "3D" Props tile that stands a Frame up in the room: "AR" on top, the
 * Frame's own art standing on a floor grid underneath, in the event's accent.
 */
function WorldThumb({ exp }: { exp: LookItem['exp'] }) {
  const art = exp.thumbnail_url ?? exp.config.world?.frameUrl ?? null;
  return (
    <span className="relative flex h-full w-full flex-col items-center justify-end overflow-hidden" style={{ background: 'rgba(9,11,20,0.7)' }}>
      <svg viewBox="0 0 60 60" className="absolute inset-0 h-full w-full" aria-hidden preserveAspectRatio="none">
        <g stroke="var(--color-accent)" strokeWidth="0.8" opacity="0.55" fill="none">
          <path d="M4 58 L22 40 M16 58 L26 40 M30 58 L30 40 M44 58 L34 40 M56 58 L38 40" />
          <path d="M12 50 H48 M8 54 H52 M17 45 H43 M21 41.5 H39" />
        </g>
      </svg>
      {art && (
        <img
          src={art}
          alt=""
          draggable={false}
          className="relative mb-[13%] h-[50%] w-auto rounded-[2px] object-cover"
          style={{ aspectRatio: '9 / 16', boxShadow: '0 0 0 1px rgba(255,255,255,0.55), 0 3px 6px rgba(0,0,0,0.6)' }}
        />
      )}
      <span
        className="absolute left-1/2 top-[9%] -translate-x-1/2 rounded-full px-1.5 py-[1px] font-sans text-[10px] font-bold leading-[1.3] tracking-wide"
        style={{ background: 'var(--color-accent)', color: 'var(--on-accent)' }}
      >
        AR
      </span>
    </span>
  );
}
