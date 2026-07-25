/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared modal shell (lifted from host EventsList's QRModal): a dismissible
 * glass-strong dialog centered over a blurred scrim.
 *
 * It is a real dialog: Escape closes it, focus moves in and is trapped while
 * it is open, and focus returns to whatever opened it. Before that it was a
 * keyboard trap — every admin confirmation, including the credit-adjustment
 * and ban dialogs, could be opened but not operated or dismissed without a
 * mouse.
 *
 * Scrim clicks close by default but can be opted out of (`dismissOnScrim`),
 * because a stray click used to discard a half-typed credit adjustment.
 */
import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '../../lib/useDialog';

export default function Modal({
  title,
  onClose,
  children,
  maxWidthClass = 'max-w-md',
  dismissOnScrim = true,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
  /** Set false for dialogs holding unsaved input, where a stray scrim click
   *  would silently discard what the user typed. */
  dismissOnScrim?: boolean;
}) {
  const { panelRef, dialogProps } = useDialog<HTMLDivElement>(onClose, title);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={dismissOnScrim ? onClose : undefined}
    >
      <div
        ref={panelRef}
        {...dialogProps}
        className={`glass-strong rounded-3xl p-6 md:p-8 w-full ${maxWidthClass} animate-rise-in max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 mb-5">
            <h2 className="font-serif text-xl text-foil-static">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
