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
import { useEffect } from 'react';
import EventProvider from '../events/EventContext';
import { StudioBaseContext } from '../components/admin/studioBase';
import StudioShell from '../components/studio/StudioShell';
import { faceTrackingStats } from '../lib/faceRig';
import { getLatestHandFrame, handTrackingStats } from '../lib/handRig';
import { getFaceLandmarker } from '../lib/faceTracking';
import { inferenceSource } from '../lib/trackingFrame';

/**
 * DEV-only diagnostics seam for scripts/check-tracking-latency.mjs: the
 * headless harness samples inference timings and sample age through it. Lives
 * here, not in the tracking modules, so production bundles carry no window
 * globals.
 */
declare global {
  interface Window {
    __beamwallTracking?: {
      face: typeof faceTrackingStats;
      hand: typeof handTrackingStats;
      /** The live landmarker (null until loaded) — for direct probes. */
      landmarker: typeof getFaceLandmarker;
      /** The exact image the landmarkers see for a video. */
      inferenceSource: typeof inferenceSource;
      /** Latest raw hand detection (landmarks, world landmarks, labels). */
      handFrame: typeof getLatestHandFrame;
    };
  }
}

export default function StudioHarness() {
  useEffect(() => {
    window.__beamwallTracking = { face: faceTrackingStats, hand: handTrackingStats, landmarker: getFaceLandmarker, inferenceSource, handFrame: getLatestHandFrame };
    return () => { delete window.__beamwallTracking; };
  }, []);
  return (
    <StudioBaseContext.Provider value="/dev/studio">
      <EventProvider slug="hope-gala" basePath="">
        <StudioShell />
      </EventProvider>
    </StudioBaseContext.Provider>
  );
}
