/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * authBeamy — what Beamy says and does beside the sign-in and sign-up forms.
 * Pure and DOM-free (tested in node); AuthShell drives the timing and
 * BeamyActor plays the clip.
 *
 * Copy rule: describe the idea (AR looks, a live photo wall, all in the
 * browser), never name another company's app. authBeamy.test.ts fails if a
 * competitor's trademark ever appears in a line.
 */

/** signin/signup, plus 'reset' for the forgot- and new-password pages. */
export type AuthBeamyPage = 'signin' | 'signup' | 'reset';

/** Clips in public/mascot/beamy.glb that return Beamy to his rest pose. */
export type GreeterClip = 'Idle' | 'Wave' | 'Hop' | 'SideEye' | 'Dance';

export interface BeamyLine {
  text: string;
  clip: GreeterClip;
}

/** Each line fits two lines of the phone bubble (≤ 60 characters). */
export const BEAMY_LINES: Record<AuthBeamyPage, readonly BeamyLine[]> = {
  signin: [
    { text: 'Welcome back! Glad you’re on board.', clip: 'Wave' },
    { text: 'Your own AR photo booth, right in the browser.', clip: 'Hop' },
    { text: 'Crowns, shades and sparkles, live on every face.', clip: 'Dance' },
    { text: 'No app for your guests. They just scan and play.', clip: 'SideEye' },
    { text: 'Every snap beams straight onto your live wall.', clip: 'Hop' },
    { text: 'Ready when you are. Let’s light up the room!', clip: 'Wave' },
  ],
  signup: [
    { text: 'Hi, I’m Beamy! Glad you’re on board.', clip: 'Wave' },
    { text: 'Let’s build your own AR photo booth. No app needed.', clip: 'Hop' },
    { text: 'AR looks, 3D props and challenges guests love.', clip: 'Dance' },
    { text: 'Guests scan a code, strike a pose, and they’re in.', clip: 'SideEye' },
    { text: 'Every photo lands live on the big screen.', clip: 'Hop' },
    { text: 'Plus digital keepsakes they’ll actually keep.', clip: 'Wave' },
  ],
  reset: [
    { text: 'Locked out? Let’s get you back on board.', clip: 'Wave' },
    { text: 'Happens to the best of us. It only takes a minute.', clip: 'SideEye' },
    { text: 'Your events and photos are right where you left them.', clip: 'Hop' },
    { text: 'New password, same booth. Nearly there!', clip: 'Wave' },
  ],
};

/** How long each line stays up. Slower when motion is reduced. */
export const BEAT_MS = 5200;
export const REDUCED_BEAT_MS = 7400;

export function beatMs(reduced: boolean): number {
  return reduced ? REDUCED_BEAT_MS : BEAT_MS;
}

/**
 * The clip to play for a line. Reduced motion keeps Beamy's story (he still
 * waves and glances) but drops the bouncy moves (lib/beamyMotion: content is
 * softened, never switched off).
 */
export function beatClip(clip: GreeterClip, reduced: boolean): GreeterClip {
  if (!reduced) return clip;
  if (clip === 'Hop' || clip === 'Dance') return 'Wave';
  return clip;
}

export function nextLineIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return (index + 1) % count;
}
