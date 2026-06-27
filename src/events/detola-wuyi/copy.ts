/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detola & Wuyi wedding event copy. These are the shipped defaults; every field
 * is overridable at runtime from the admin Branding page.
 */
import type { EventCopy } from '../types';

export const detolaWuyiCopy: EventCopy = {
  eyebrow: 'DETOLA & WUYI · 2026',
  eventName: 'Detola & Wuyi',
  tagline: 'Capture your moment from our celebration',
  fullName: "Detola & Wuyi's Wedding · 27 June 2026",
  thankYou: 'Thank you for celebrating with us!',
  steps: [
    { title: 'Scan QR', body: 'Point your camera at the code on the screen.' },
    { title: 'Choose a Look', body: 'Pick an elegant filter or a gold frame.' },
    { title: 'Strike a Pose', body: 'Snap a photo or record a short clip.' },
    { title: 'Share the Joy', body: 'Send it to the live wall for everyone to see.' },
  ],
  onboardingSteps: [
    { eyebrow: 'Step One', title: 'Choose Your Look', body: 'Pick an elegant Effect — soft glow, golden shimmer or timeless film — then layer it with a gold frame to match the celebration.' },
    { eyebrow: 'Step Two', title: 'Flip & Adorn', body: 'Switch between the front and back cameras, then add a tasteful 3D accessory — tracked live to your face by our AI as you move.' },
    { eyebrow: 'Step Three', title: 'Photo or Video', body: 'Tap the shutter for a single photo, or switch to Video to capture up to 30 seconds of the moment — sound, motion and all your effects.' },
    { eyebrow: 'Step Four', title: 'Send to the Wall', body: 'Set a hands-free timer (3s, 5s or 10s) for the perfect pose, then send your moment to the live wall for all the guests to enjoy.' },
    { eyebrow: 'Step Five', title: 'Take the Challenges', body: 'Snap the wedding challenges — one with the couple, one with each of them, one with your table, one with family — and climb the leaderboard!' },
  ],
  filePrefix: 'DetolaWuyi2026',
  shareTitle: "Detola & Wuyi's Wedding 2026",
  momentTitle: 'My Detola & Wuyi Moment',
  shareText: "My moment from Detola & Wuyi's wedding celebration!",
};
