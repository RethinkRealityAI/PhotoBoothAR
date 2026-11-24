/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * React half of railCollapse.ts: the remembered collapsed state of one side
 * menu. Collapsing is a DESKTOP affordance only; each caller keeps its own
 * phone layout (top bar, menu, drawer or sheet) untouched.
 */
import { useCallback, useState } from 'react';
import { readRailCollapsed, writeRailCollapsed, type RailStore, type RailSurface } from './railCollapse';
import { haptic } from './haptics';

function railStore(): RailStore | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function useRailCollapsed(surface: RailSurface) {
  const [collapsed, setState] = useState<boolean>(() => readRailCollapsed(railStore(), surface));
  const setCollapsed = useCallback(
    (next: boolean) => {
      setState(next);
      writeRailCollapsed(railStore(), surface, next);
    },
    [surface],
  );
  const toggle = useCallback(() => {
    haptic('tap');
    setState((prev) => {
      writeRailCollapsed(railStore(), surface, !prev);
      return !prev;
    });
  }, [surface]);
  return { collapsed, setCollapsed, toggle };
}
