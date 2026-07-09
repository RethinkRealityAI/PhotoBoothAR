/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEV-ONLY studio harness. Renders the unified StudioShell inside a registered
 * code event (no Supabase auth, no network) so the editor can be driven and
 * screenshotted at any viewport during development / Playwright verification.
 *
 * Registered ONLY when import.meta.env.DEV is true (see App.tsx), so it never
 * ships to production and never bypasses the real /host auth gate.
 */
import EventProvider from '../events/EventContext';
import { StudioBaseContext } from '../components/admin/studioBase';
import StudioShell from '../components/studio/StudioShell';

export default function StudioHarness() {
  return (
    <StudioBaseContext.Provider value="/dev/studio">
      <EventProvider slug="hope-gala" basePath="">
        <StudioShell />
      </EventProvider>
    </StudioBaseContext.Provider>
  );
}
