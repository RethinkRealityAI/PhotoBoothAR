import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEEPSAKE_TRACKS, keepsakeTrack } from './keepsakeMusic';
import { KEEPSAKE_MUSIC_IDS } from './keepsakeSettings';

const PUBLIC = join(__dirname, '..', '..', 'public');
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'keepsake-music', 'tracks.json'), 'utf8')) as {
  tracks: Array<{ id: string; title: string; mood: string; bpm: number; durationSec: number; beatOriginSec: number; file: string }>;
};
const licenses = readFileSync(join(PUBLIC, 'keepsake-music', 'LICENSES.md'), 'utf8');

describe('keepsake music library', () => {
  it('has a track, on disk, for every music id except none', () => {
    for (const id of KEEPSAKE_MUSIC_IDS) {
      if (id === 'none') {
        expect(keepsakeTrack(id)).toBeNull();
        continue;
      }
      const track = keepsakeTrack(id);
      expect(track, id).not.toBeNull();
      expect(track?.file).toBe(`/keepsake-music/${id}.mp3`);
      const path = join(PUBLIC, (track as { file: string }).file);
      expect(existsSync(path), path).toBe(true);
      // A real encode, and small enough for the album page to preview.
      const size = statSync(path).size;
      expect(size).toBeGreaterThan(100_000);
      expect(size).toBeLessThan(900_000);
    }
    expect(KEEPSAKE_TRACKS.length).toBe(KEEPSAKE_MUSIC_IDS.length - 1);
  });

  it('licenses every track for commercial use with no attribution', () => {
    for (const t of KEEPSAKE_TRACKS) {
      expect(t.license.attributionRequired).toBe(false);
      expect(t.license.commercialUse).toBe(true);
      expect(licenses).toContain(`(\`${t.id}\`)`);
    }
  });

  it('matches the generator manifest the film worker reads', () => {
    for (const t of KEEPSAKE_TRACKS) {
      const m = manifest.tracks.find((x) => x.id === t.id);
      expect(m, t.id).toBeDefined();
      expect({ title: t.title, mood: t.mood, bpm: t.bpm, durationSec: t.durationSec, file: t.file }).toEqual({
        title: m?.title,
        mood: m?.mood,
        bpm: m?.bpm,
        durationSec: m?.durationSec,
        file: m?.file,
      });
      // Beat-cut timing assumes beat 1 is the first sample.
      expect(m?.beatOriginSec).toBe(0);
    }
  });
});
