/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * beamyStory — what each "How it works" step shows around Beamy. Pure,
 * DOM-free, tested in node. The scenes themselves are DOM (StoryScenes.tsx);
 * this is their copy, the looks the AR step cycles, and the scan code art.
 */
import { BEAMY_LOOKS, type BeamyLook } from './beamyLooks';

/** The scenes' words. Decorative (the caption panel carries each step's text). */
export const STORY_SCENE = {
  qr: { event: 'Ada & Tunde’s wedding', scan: 'Scan to join', hint: 'No app needed', tent: 'Scan me' },
  wall: { sent: 'Sent to the wall' },
  medal: {
    eyebrow: 'Challenge',
    mission: 'Selfie with the bride',
    points: '+50 pts',
    board: 'Leaderboard',
    rows: [['Table 4', 320], ['The Okafors', 280], ['Uncle Femi', 240]] as [string, number][],
  },
  keepsake: { album: 'Your digital album', count: '48 photos', film: 'Your night, auto-made', length: '0:30' },
} as const;

/** Every line a scene puts on screen, for the copy rules. */
export function storySceneLines(): string[] {
  const s = STORY_SCENE;
  return [
    s.qr.event, s.qr.scan, s.qr.hint, s.qr.tent, s.wall.sent, s.medal.eyebrow, s.medal.mission, s.medal.points, s.medal.board,
    ...s.medal.rows.map((r) => r[0]), s.keepsake.album, s.keepsake.count, s.keepsake.film,
  ];
}

/** The looks the AR step tries on, in order (all of the hero's worn looks). */
export const STORY_LOOKS: BeamyLook[] = BEAMY_LOOKS.filter((l) => l.kind !== 'none');

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
