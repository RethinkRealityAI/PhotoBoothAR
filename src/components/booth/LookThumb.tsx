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
import { Box, Square, Wand2 } from 'lucide-react';
import FilterThumb from './FilterThumb';
import type { LookItem } from '../../lib/lookStrip';
import type { DeckCategory } from '../../lib/boothDeck';

export const CATEGORY_ICON: Record<DeckCategory, typeof Square> = {
  frame: Square,
  prop: Box,
  effect: Wand2,
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
  const Icon = CATEGORY_ICON[category];
  return (
    <span
      className="flex h-full w-full items-center justify-center"
      style={{ background: 'rgba(var(--accent-rgb), 0.12)' }}
    >
      <Icon className="h-5 w-5 text-brand-fg/70" strokeWidth={1.6} />
    </span>
  );
}
