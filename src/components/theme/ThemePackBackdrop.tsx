/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Paints a theme pack's backdrop (lib/themePacks `pack.backdrop`) by id.
 * One lookup for every surface that shows it — the welcome page, the booth
 * splash, the live wall (via EventBackground) and the host's thumbnail — so
 * a preview cannot drift from the page. A new pack adds one entry here.
 */
import type { ComponentType } from 'react';
import { themePackById, type EventTheme } from '../../lib/themePacks';
import IslandGoldenHour from './packs/IslandGoldenHour';

const BACKDROPS: Record<string, ComponentType<{ compact?: boolean }>> = {
  'island-golden-hour': IslandGoldenHour,
};

/** True when the theme's pack has a backdrop to paint. */
export function hasThemeBackdrop(theme: EventTheme | undefined): boolean {
  const pack = theme ? themePackById(theme.pack) : undefined;
  return pack !== undefined && BACKDROPS[pack.backdrop] !== undefined;
}

export default function ThemePackBackdrop({ theme, compact = false }: { theme: EventTheme; compact?: boolean }) {
  const pack = themePackById(theme.pack);
  const Backdrop = pack ? BACKDROPS[pack.backdrop] : undefined;
  return Backdrop ? <Backdrop compact={compact} /> : null;
}
