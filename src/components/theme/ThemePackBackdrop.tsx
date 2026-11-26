/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Paints a theme pack's backdrop (lib/themePacks `pack.backdrop`) by id.
 * One lookup for every surface that shows it — the welcome page, the booth
 * splash, the live wall (via EventBackground) and the host's thumbnail — so
 * a preview cannot drift from the page. A new pack adds one entry here.
 */
import { useCallback, useEffect, useState, type ComponentType, type ReactElement } from 'react';
import { RotateCcw } from 'lucide-react';
import { themePackById, type EventTheme } from '../../lib/themePacks';
import IslandGoldenHour, { type BackdropProps } from './packs/IslandGoldenHour';

const BACKDROPS: Record<string, ComponentType<BackdropProps>> = {
  'island-golden-hour': IslandGoldenHour,
};

/** True when the theme's pack has a backdrop to paint. */
export function hasThemeBackdrop(theme: EventTheme | undefined): boolean {
  const pack = theme ? themePackById(theme.pack) : undefined;
  return pack !== undefined && BACKDROPS[pack.backdrop] !== undefined;
}

export default function ThemePackBackdrop({ theme, compact = false, intro = false, fullMotion = false }: { theme: EventTheme } & BackdropProps) {
  const pack = themePackById(theme.pack);
  const Backdrop = pack ? BACKDROPS[pack.backdrop] : undefined;
  return Backdrop ? <Backdrop compact={compact} intro={intro} fullMotion={fullMotion} /> : null;
}

/** How long the entrance runs before the Replay chip offers to run it again. */
export const BACKDROP_INTRO_MS = 3400;

/**
 * The welcome page and booth splash: plays the entrance, and hands back a
 * Replay chip that runs it again. A replay remounts the scene (so every
 * transition starts from the top) and moves it in full even under
 * prefers-reduced-motion, because the guest asked for it.
 */
export function useBackdropReplay(): { key: number; fullMotion: boolean; chip: (className?: string) => ReactElement } {
  const [key, setKey] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const t = window.setTimeout(() => setReady(true), BACKDROP_INTRO_MS);
    return () => window.clearTimeout(t);
  }, [key]);
  const replay = useCallback(() => setKey((k) => k + 1), []);
  const chip = (className = '') => (
    <button
      type="button"
      onClick={replay}
      aria-label="Replay the scene"
      title="Replay the scene"
      data-ready={ready ? '' : undefined}
      className={`tp-replay pressable ${className}`}
    >
      <RotateCcw className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
  return { key, fullMotion: key > 0, chip };
}
