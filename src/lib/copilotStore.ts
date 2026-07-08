/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tiny global open/close state for the Platform Copilot panel, so the
 * globally-mounted panel (App.tsx) can be opened from anywhere — the FAB,
 * the HostLayout rail, and the EventStudio nav.
 */
import { create } from 'zustand';

interface CopilotUiState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useCopilotStore = create<CopilotUiState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
