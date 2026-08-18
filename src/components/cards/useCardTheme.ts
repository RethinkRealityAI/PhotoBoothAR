/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useCardTheme — replays a keepsake's theme snapshot on the public card pages.
 *
 * `/c/:publicId` and its contribute page render OUTSIDE EventProvider, so they
 * have no runtime theme to inherit (see lib/cardTheme.ts for why the card
 * carries its own). This hook is the DOM half: it writes the snapshot's
 * variables inline on :root — the same layer store.applyBranding uses, so the
 * card looks like the event did — and removes every one of them on unmount, so
 * navigating on to a platform page never leaves an event's colours behind.
 */
import { useEffect } from 'react';
import { normalizeCardTheme, type CardTheme } from '../../lib/cardTheme';

const FONT_LINK_ID = 'bw-card-font';

/**
 * @param raw the card's `theme` jsonb exactly as the edge function returned it
 * @returns the parsed snapshot (null when unusable), for copy that wants the
 *          event name — the caller renders, the hook only paints.
 */
export function useCardTheme(raw: unknown): CardTheme | null {
  const theme = normalizeCardTheme(raw);
  // Identity of `theme` changes every render (fresh parse), so the effect keys
  // off the serialized snapshot instead — the values are what matter.
  const key = theme ? JSON.stringify(theme) : '';

  useEffect(() => {
    if (!key) return;
    const parsed = JSON.parse(key) as CardTheme;
    const root = document.documentElement;
    const applied = Object.keys(parsed.vars);
    for (const [name, value] of Object.entries(parsed.vars)) {
      root.style.setProperty(name, value);
    }

    let link: HTMLLinkElement | null = null;
    if (parsed.fontHref && !document.querySelector(`link[href="${parsed.fontHref}"]`)) {
      link = document.createElement('link');
      link.id = FONT_LINK_ID;
      link.rel = 'stylesheet';
      link.href = parsed.fontHref;
      document.head.appendChild(link);
    }

    return () => {
      for (const name of applied) root.style.removeProperty(name);
      link?.remove();
    };
  }, [key]);

  return theme;
}
