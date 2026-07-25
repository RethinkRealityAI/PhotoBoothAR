/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What makes an overlay a dialog rather than a keyboard trap.
 *
 * Escape closes it, focus moves inside and cannot Tab out, and focus returns to
 * whatever opened it when it goes. Extracted from Modal so the overlays that are
 * genuinely NOT card-shaped — the booth's bottom sheet, the manager console's
 * side drawer, a full-bleed photo viewer — can be real dialogs without being
 * forced into a centred-card layout they were never meant to have. Reshaping
 * eight working overlays to reuse one container would have been a much larger
 * and riskier change than sharing the behaviour.
 *
 * Returns a ref to put on the panel, and the props that describe it to a screen
 * reader. The panel needs `tabIndex={-1}` (included in the returned props) so
 * focus has somewhere to land when the dialog has no controls of its own.
 */
import { useCallback, useEffect, useRef } from 'react';

/** Focusable descendants, in DOM order, for the focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  role: 'dialog';
  'aria-modal': true;
  'aria-label'?: string;
  tabIndex: -1;
}

/**
 * @param enabled false while the dialog is closed. Several of these overlays are
 *   rendered conditionally inside a parent that is always mounted (an
 *   AnimatePresence sheet, a lightbox), and a hook cannot be called
 *   conditionally — so the hook is called always and does nothing until the
 *   dialog is actually on screen. Without this it would install a global Escape
 *   handler and steal focus while closed.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  label?: string,
  enabled = true,
): { panelRef: React.RefObject<T | null>; dialogProps: DialogProps } {
  const panelRef = useRef<T | null>(null);
  // Whatever had focus when the dialog opened, so it can be given back.
  const openerRef = useRef<HTMLElement | null>(null);

  const focusablesIn = useCallback((): HTMLElement[] => {
    const panel = panelRef.current;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = focusablesIn()[0];
    (first ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusablesIn();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends so Tab can never walk out of the dialog into the page
      // behind it.
      if (e.shiftKey && (active === firstItem || !panelRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      openerRef.current?.focus();
    };
  }, [onClose, focusablesIn, enabled]);

  return {
    panelRef,
    dialogProps: { role: 'dialog', 'aria-modal': true, 'aria-label': label, tabIndex: -1 },
  };
}
