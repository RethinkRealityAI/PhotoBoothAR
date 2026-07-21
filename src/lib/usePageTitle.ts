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
