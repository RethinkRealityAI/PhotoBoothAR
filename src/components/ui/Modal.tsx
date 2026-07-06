/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared modal shell (lifted from host EventsList's QRModal): a dismissible
 * glass-strong dialog centered over a blurred scrim. Click-outside and the
 * built-in close button both call onClose; content clicks don't bubble.
 */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({
  title,
  onClose,
  children,
  maxWidthClass = 'max-w-md',
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={`glass-strong rounded-3xl p-6 md:p-8 w-full ${maxWidthClass} animate-rise-in max-h-[85vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 mb-5">
            <h2 className="font-serif text-xl text-foil-static">{title}</h2>
            <button
              onClick={onClose}
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
