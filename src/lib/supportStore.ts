/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global open/close state for the report-an-issue dialog, so the single
 * globally-mounted dialog (App.tsx) can be opened from anywhere — the host
 * rail, the event studio bar, the guest booth menu, the error boundaries, the
 * landing footer — without each surface owning a copy of the dialog.
 *
 * Mirrors copilotStore.ts, with one addition: the opener passes a `prefill`
 * describing WHERE it was opened from, which is how the dialog can lead with
 * the right category pill instead of making the user classify their own bug.
 */
import { create } from 'zustand';
import type { SupportCategory, SupportSource } from './supportModel';

export interface SupportPrefill {
  source: SupportSource;
  /** Slug of the event in context, when there is one. */
  eventSlug?: string | null;
  category?: SupportCategory;
  subject?: string;
  body?: string;
  /** Extra context merged into the (redacted) diagnostics — e.g. an error message. */
  diagnostics?: Record<string, unknown>;
}

interface SupportUiState {
  isOpen: boolean;
  prefill: SupportPrefill | null;
  open: (prefill?: SupportPrefill) => void;
  close: () => void;
}

const DEFAULT_PREFILL: SupportPrefill = { source: 'host_rail' };

export const useSupportStore = create<SupportUiState>((set) => ({
  isOpen: false,
  prefill: null,
  open: (prefill) => set({ isOpen: true, prefill: prefill ?? DEFAULT_PREFILL }),
  close: () => set({ isOpen: false, prefill: null }),
}));

/** Imperative opener for non-React call sites (the class ErrorBoundary). */
export function openSupportDialog(prefill?: SupportPrefill): void {
  useSupportStore.getState().open(prefill);
}
