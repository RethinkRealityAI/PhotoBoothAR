/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * usePageTitle — sets document.title for the mounted page and restores the
 * previous title on unmount, so SPA route changes read correctly in the tab,
 * in history, and to screen readers.
 *
 * Platform surfaces only (Landing, legal, auth, host, admin): event-scoped
 * routes must NOT use this — EventProvider owns the title there
 * (applyEventTheme / resetPlatformTheme in src/events/EventContext.tsx).
 */
import { useEffect } from 'react';

export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** The one production origin (netlify.toml 301s the old netlify.app host here). */
export const SITE_ORIGIN = 'https://beamwall.app';

/**
 * usePageMeta — the mounted route's canonical URL and meta description, set
 * while mounted and restored after. index.html cannot carry a canonical: one
 * HTML file serves every SPA route, so a fixed "/" would call every page a
 * duplicate of the homepage. The public marketing pages declare their own
 * here instead. Never on legacy (VITE_EVENT) builds: those sites are not
 * beamwall.app and must keep their frozen head.
 */
export function usePageMeta(path: string, description?: string): void {
  useEffect(() => {
    if (import.meta.env.VITE_EVENT) return;
    const head = document.head;
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const createdLink = link === null;
    const prevHref = link?.getAttribute('href') ?? null;
    if (link === null) {
      link = document.createElement('link');
      link.rel = 'canonical';
      head.appendChild(link);
    }
    link.setAttribute('href', `${SITE_ORIGIN}${path}`);
    const desc = description !== undefined ? head.querySelector<HTMLMetaElement>('meta[name="description"]') : null;
    const prevDesc = desc?.getAttribute('content') ?? null;
    if (desc !== null && description !== undefined) desc.setAttribute('content', description);
    return () => {
      if (createdLink) link?.remove();
      else if (prevHref !== null) link?.setAttribute('href', prevHref);
      if (desc !== null && prevDesc !== null) desc.setAttribute('content', prevDesc);
    };
  }, [path, description]);
}
