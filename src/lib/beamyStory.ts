/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyStory — what each "How it works" step shows around Beamy. Pure,
 * DOM-free, tested in node. The scenes themselves are DOM (StoryScenes.tsx);
 * this is their copy, the looks the AR step cycles, and the scan code art.
 */
import type { BeamyLook } from './beamyLooks';
import { AR_FRAME_GEO, HOME_ASSET_DEFAULTS, arOrder, toBeamyLook } from './beamyAssets';
import { sequence, type Sequence } from './beamyMotion';

/** The scenes' words. Decorative (the caption panel carries each step's text). */
export const STORY_SCENE = {
  qr: {
    /** The event's splash screen, written on the phone after the scan. */
    welcome: 'Welcome to', couple: 'Ade & Tunji’s', booth: 'immersive wedding booth', start: 'Tap to start',
    scan: 'Point your camera', hint: 'No app needed', real: 'Scan it for real',
  },
  wall: { captured: 'Photo captured', sent: 'Sent to the wall' },
  medal: {
    eyebrow: 'New challenge alert',
    mission: 'Selfie with the bride',
    points: '+50 pts',
    doneEyebrow: 'Challenge complete',
    done: 'Ada completed the challenge',
    board: 'Leaderboard',
    /** The board before the shot lands; the sender then jumps to #1 with the mission's points. */
    rows: [['Table 4', 40], ['The Okafors', 30], ['Uncle Femi', 20]] as [string, number][],
    sender: 'Ada',
    sent: 'Sent by Ada',
    winPts: 50,
  },
  keepsake: { album: 'Your digital album', count: '48 photos', film: 'Your night, auto-made', length: '0:30', making: 'Making your film' },
} as const;

/** Every line a scene puts on screen, for the copy rules. */
export function storySceneLines(): string[] {
  const s = STORY_SCENE;
  return [
    s.qr.welcome, s.qr.couple, s.qr.booth, s.qr.start, s.qr.scan, s.qr.hint, s.qr.real, s.wall.captured, s.wall.sent,
    s.medal.eyebrow, s.medal.mission, s.medal.points, s.medal.doneEyebrow, s.medal.done, s.medal.board,
    ...s.medal.rows.map((r) => r[0]), s.medal.sender, s.medal.sent, s.keepsake.album, s.keepsake.count, s.keepsake.film, s.keepsake.making,
  ];
}

/**
 * Each scene's order (ms after its step comes up). Pieces appear only at
 * their cue, so a scene unfolds as a story, never all at once:
 *   qr       the code waits; a glass phone glides over it and hovers (the
 *            code shows through); it scans; the code dissolves into it; the
 *            phone turns solid on the event's splash; it steps aside and the
 *            real code comes back to be scanned for real.
 *   wall     the phone flashes (a shot); "Photo captured"; that photo flies
 *            to Beamy; he catches it; he beams it; it lands on the wall.
 *            Loops with the next guest's shot.
 *   medal    the alert; Ada's selfie; "Sent by Ada"; the alert turns into
 *            "Ada completed the challenge"; the board appears; Ada climbs
 *            to #1 with the points.
 *   keepsake the album; its photos fly into the film; it makes itself; it plays.
 */
export const STORY_SEQ = {
  qr: sequence([['hover', 500], ['scan', 1700], ['dissolve', 3000], ['splash', 3600], ['rest', 5600]]),
  wall: sequence([['flash', 700], ['toast', 1200], ['fly', 2200], ['receive', 3200], ['beam', 3800], ['land', 5100]], 8600),
  medal: sequence([['alert', 400], ['photo', 1500], ['sent', 2600], ['done', 3700], ['board', 4800], ['rank', 5600]]),
  keepsake: sequence([['album', 300], ['fly', 1300], ['making', 1800], ['play', 4800]]),
} satisfies Record<'qr' | 'wall' | 'medal' | 'keepsake', Sequence>;

/** The wearable looks of the AR step's picker (its frames and props), in picker order. None repeats the hero's. */
export const STORY_LOOKS: BeamyLook[] = arOrder(HOME_ASSET_DEFAULTS.arLooks)
  .filter((l) => l.category === 'frame' || l.category === 'prop')
  .map((l) => toBeamyLook(l, l.category === 'frame' ? AR_FRAME_GEO : undefined));

/** The AR step's own words (its picker is real, interactive UI, not decoration). */
export const AR_COPY = {
  line: 'Your photo booth can have a variety of filters, props and effects, tailored to capture the essence of your event.',
  pick: 'Swipe or tap the arrows to try a look on Beamy',
  prev: 'Previous',
  next: 'Next',
} as const;

/** A look's small picture: the library's own .webp beside a prop, the guide pack's thumb for a frame. */
export function lookThumb(l: BeamyLook): string | null {
  if (l.url === undefined) return null;
  if (l.kind === 'prop') return l.url.replace(/\.glb$/, '.webp');
  const i = l.url.lastIndexOf('/');
  return `${l.url.slice(0, i)}/thumb/${l.url.slice(i + 1).replace(/\.png$/, '.webp')}`;
}

/**
 * Scan-code art: an n×n grid with the three finder squares in place and a
 * seeded scatter of modules elsewhere. It only has to read as a QR code; it
 * encodes nothing (it is a picture of the guest's step, not a working link).
 */
export function qrModules(n = 21, seed = 7): boolean[][] {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const finder = (x: number, y: number): boolean | null => {
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const dx = x - fx;
      const dy = y - fy;
      if (dx < -1 || dy < -1 || dx > 7 || dy > 7) continue;
      if (dx === -1 || dy === -1 || dx === 7 || dy === 7) return false; // quiet ring
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      return ring !== 2;
    }
    return null;
  };
  const grid: boolean[][] = [];
  for (let y = 0; y < n; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < n; x++) {
      const f = finder(x, y);
      row.push(f ?? rnd() > 0.5);
    }
    grid.push(row);
  }
  return grid;
}
