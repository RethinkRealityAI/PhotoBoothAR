/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallMusic — the background music a host can play on the live wall.
 *
 * Every track is a PUBLIC DOMAIN (CC0) recording from FreePD.com, the public
 * domain library Kevin MacLeod founded. FreePD has since closed; the files
 * were taken from the Internet Archive's mirror of it (archive.org/details/freepd),
 * loudness-matched to -18 LUFS and re-encoded (128 kb/s). CC0 means: free
 * for commercial use, no attribution required, no fee. Credit is still shown
 * on the wall's "Now playing" line, because it is courteous and costs nothing.
 * Provenance per track: public/wall-music/LICENSES.md (wallMusic.test.ts pins
 * the two together). A new track needs the same record, or it does not ship.
 *
 * Only Kevin MacLeod's own public-domain uploads and Alexander Nakarada's
 * FreePD releases are used, never FreePD's mixed "Page 2" contributor uploads.
 *
 * Stored on the wall's own settings row as `WallSettings.music`, raw, and
 * always read through `normalizeWallMusic`. Absent = no music, exactly the
 * wall it was before. PURE: no DOM, no audio element.
 */

export type WallMusicMood = 'ambient' | 'chill' | 'lounge' | 'upbeat';
export const WALL_MUSIC_MOODS: readonly WallMusicMood[] = ['ambient', 'chill', 'lounge', 'upbeat'];

/** What the host picks: one mood, or a mix of all of them. */
export type WallMusicPlaylist = 'mix' | WallMusicMood;
export const WALL_MUSIC_PLAYLISTS: readonly WallMusicPlaylist[] = ['mix', ...WALL_MUSIC_MOODS];

export const WALL_PLAYLIST_META: Readonly<Record<WallMusicPlaylist, { label: string; blurb: string }>> = {
  mix: { label: 'A bit of everything', blurb: 'Ambient, chill, lounge and upbeat, shuffled together.' },
  ambient: { label: 'Ambient', blurb: 'Soft, dreamy pads. Barely there, never in the way.' },
  chill: { label: 'Chill', blurb: 'Easy grooves for mingling and drinks.' },
  lounge: { label: 'Lounge', blurb: 'Smooth jazz and late-night cool.' },
  upbeat: { label: 'Upbeat', blurb: 'Bright and sunny, a little more energy.' },
};

export interface WallTrackLicense {
  kind: 'cc0';
  /** Where it came from. */
  source: string;
  /** The archived copy we took it from. */
  url: string;
  attributionRequired: false;
  commercialUse: true;
}

export interface WallTrack {
  id: string;
  title: string;
  artist: string;
  mood: WallMusicMood;
  durationSec: number;
  /** Served path (public/). */
  file: string;
  license: WallTrackLicense;
}

function freepd(path: string): WallTrackLicense {
  return {
    kind: 'cc0',
    source: 'FreePD.com (public domain), via the Internet Archive mirror',
    url: `https://archive.org/download/freepd/${encodeURIComponent(path).replace(/%2F/g, '/')}.mp3`,
    attributionRequired: false,
    commercialUse: true,
  };
}

const t = (id: string, title: string, artist: string, mood: WallMusicMood, durationSec: number, src: string): WallTrack => ({
  id, title, artist, mood, durationSec, file: `/wall-music/${id}.mp3`, license: freepd(src),
});

export const WALL_TRACKS: readonly WallTrack[] = [
  t('infinite-wonder', 'Infinite Wonder', 'Kevin MacLeod', 'ambient', 190.09, 'misc/Infinite Wonder'),
  t('icicles-melting', 'Icicles Melting', 'Kevin MacLeod', 'ambient', 178.1, 'misc/Icicles Melting'),
  t('kalimba-relaxation', 'Kalimba Relaxation', 'Kevin MacLeod', 'ambient', 428.09, 'misc/Kalimba Relaxation Music'),
  t('space-ambience', 'Space Ambience', 'Alexander Nakarada', 'ambient', 275.72, 'electronic/Space Ambience'),
  t('meditating-beat', 'Meditating Beat', 'Kevin MacLeod', 'chill', 157.26, 'electronic/Meditating Beat'),
  t('be-chillin', 'Be Chillin', 'Alexander Nakarada', 'chill', 202.58, 'upbeat/Be Chillin'),
  t('midnight-green-house', 'Midnight in the Green House', 'Kevin MacLeod', 'chill', 212.09, 'world/Midnight in the Green House'),
  t('bass-meant-jazz', 'Bass Meant Jazz', 'Kevin MacLeod', 'lounge', 279.77, 'misc/Bass Meant Jazz'),
  t('night-in-venice', 'Night in Venice', 'Kevin MacLeod', 'lounge', 218.17, 'romantic/Night in Venice'),
  t('sunday-dub', 'Sunday Dub', 'Kevin MacLeod', 'lounge', 209.5, 'misc/Sunday Dub'),
  t('city-sunshine', 'City Sunshine', 'Kevin MacLeod', 'upbeat', 185.03, 'upbeat/City Sunshine'),
  t('screen-saver', 'Screen Saver', 'Kevin MacLeod', 'upbeat', 182.1, 'upbeat/Screen Saver'),
];

export interface WallMusic {
  enabled: boolean;
  playlist: WallMusicPlaylist;
  /** 0..1, the wall's master level (each screen can still mute itself). */
  volume: number;
}

export const DEFAULT_WALL_MUSIC: WallMusic = { enabled: false, playlist: 'mix', volume: 0.6 };

/** Total coercion of the stored value. Anything unreadable = music off. */
export function normalizeWallMusic(raw: unknown): WallMusic {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_WALL_MUSIC };
  const r = raw as Record<string, unknown>;
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume)
    ? Math.min(1, Math.max(0, r.volume))
    : DEFAULT_WALL_MUSIC.volume;
  return {
    enabled: r.enabled === true,
    playlist: WALL_MUSIC_PLAYLISTS.includes(r.playlist as WallMusicPlaylist)
      ? (r.playlist as WallMusicPlaylist)
      : DEFAULT_WALL_MUSIC.playlist,
    volume,
  };
}

export function tracksFor(playlist: WallMusicPlaylist): WallTrack[] {
  return WALL_TRACKS.filter((x) => playlist === 'mix' || x.mood === playlist);
}

/** Small seeded PRNG (mulberry32), so a shuffle is reproducible in tests. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The play order for a playlist: a seeded shuffle, and in a mix no two tracks
 * of the same mood back to back where that can be avoided, so the room never
 * gets three ambient pads in a row and then three upbeat tracks.
 */
export function wallPlayOrder(playlist: WallMusicPlaylist, seed: number): WallTrack[] {
  const rand = prng(seed);
  const pool = tracksFor(playlist);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (playlist !== 'mix') return pool;
  const out: WallTrack[] = [];
  const left = [...pool];
  while (left.length > 0) {
    // Take the next track of whichever OTHER mood has the most left, so the
    // biggest mood is spread out instead of piling up at the end.
    const prev = out[out.length - 1];
    const remaining = new Map<WallMusicMood, number>();
    for (const x of left) remaining.set(x.mood, (remaining.get(x.mood) ?? 0) + 1);
    let best = -1;
    for (let k = 0; k < left.length; k++) {
      if (left[k].mood === prev?.mood) continue;
      if (best === -1 || (remaining.get(left[k].mood) ?? 0) > (remaining.get(left[best].mood) ?? 0)) best = k;
    }
    out.push(left.splice(best === -1 ? 0 : best, 1)[0]);
  }
  return out;
}

/** "Infinite Wonder · Kevin MacLeod" — the wall's Now playing line. */
export function nowPlayingLabel(track: WallTrack): string {
  return `${track.title} · ${track.artist}`;
}
