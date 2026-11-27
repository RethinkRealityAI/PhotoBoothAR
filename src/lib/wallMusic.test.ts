import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WALL_MUSIC_MOODS, WALL_MUSIC_PLAYLISTS, WALL_PLAYLIST_META, WALL_TRACKS, normalizeWallMusic, tracksFor, wallPlayOrder,
} from './wallMusic';

const PUBLIC = join(__dirname, '..', '..', 'public');
const licenses = readFileSync(join(PUBLIC, 'wall-music', 'LICENSES.md'), 'utf8');

describe('live wall music library', () => {
  it('has every track on disk, a real encode', () => {
    expect(new Set(WALL_TRACKS.map((t) => t.id)).size).toBe(WALL_TRACKS.length);
    for (const t of WALL_TRACKS) {
      expect(t.file).toBe(`/wall-music/${t.id}.mp3`);
      const path = join(PUBLIC, t.file);
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(1_000_000);
    }
  });

  it('licenses every track CC0, recorded in LICENSES.md', () => {
    for (const t of WALL_TRACKS) {
      expect(t.license.kind).toBe('cc0');
      expect(t.license.attributionRequired).toBe(false);
      expect(t.license.commercialUse).toBe(true);
      expect(t.license.url.startsWith('https://archive.org/download/freepd/')).toBe(true);
      expect(licenses).toContain(`## ${t.title} (\`${t.id}\`)`);
      expect(licenses).toContain(`- Artist: ${t.artist}`);
    }
  });

  it('gives every mood at least two tracks and copy for every playlist', () => {
    for (const m of WALL_MUSIC_MOODS) expect(tracksFor(m).length).toBeGreaterThanOrEqual(2);
    for (const p of WALL_MUSIC_PLAYLISTS) expect(WALL_PLAYLIST_META[p].label.length).toBeGreaterThan(0);
  });

  it('reads absent or broken settings as music off', () => {
    expect(normalizeWallMusic(undefined)).toEqual({ enabled: false, playlist: 'mix', volume: 0.6 });
    expect(normalizeWallMusic({ enabled: 'yes', playlist: 'metal', volume: 9 })).toEqual({ enabled: false, playlist: 'mix', volume: 1 });
    expect(normalizeWallMusic({ enabled: true, playlist: 'lounge', volume: 0 })).toEqual({ enabled: true, playlist: 'lounge', volume: 0 });
  });

  it('shuffles reproducibly and keeps a mix varied', () => {
    expect(wallPlayOrder('mix', 7).map((t) => t.id)).toEqual(wallPlayOrder('mix', 7).map((t) => t.id));
    for (let seed = 0; seed < 30; seed++) {
      const order = wallPlayOrder('mix', seed);
      expect(order.length).toBe(WALL_TRACKS.length);
      for (let i = 1; i < order.length; i++) expect(order[i].mood).not.toBe(order[i - 1].mood);
    }
    expect(wallPlayOrder('ambient', 3).every((t) => t.mood === 'ambient')).toBe(true);
  });
});
