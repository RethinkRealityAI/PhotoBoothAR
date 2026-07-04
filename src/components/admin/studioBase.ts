/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Studio base path — where the admin screens are mounted.
 *
 * Defaults to '/admin' so legacy VITE_EVENT builds (AdminGate at /admin/*)
 * work without wrapping anything. The host studio (EventStudio) provides
 * `/host/events/<uuid>` so the same screens navigate correctly when re-homed.
 */
import { createContext, useContext } from 'react';

export const StudioBaseContext = createContext('/admin');

export function useStudioBase(): string {
  return useContext(StudioBaseContext);
}
