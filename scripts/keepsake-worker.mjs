#!/usr/bin/env node
/**
 * keepsake-worker — renders the next-day keepsake films and hands each event
 * back to send-keepsakes to be emailed. Run by .github/workflows/keepsake-
 * films.yml on a schedule; safe to run by hand (`npm run keepsake:worker`).
 *
 * WHAT IT HOLDS: one shared secret (KEEPSAKE_WORKER_SECRET) and the function
 * URL. No Supabase key, no guest email address, ever. send-keepsakes decides
 * what is due, who gets mailed and what the email says; this script only
 * turns a payload of public photo URLs into an MP4 + a poster frame and PUTs
 * them to the two signed upload URLs it was handed.
 *
 * THE LOGS ARE PUBLIC (the repo is public, so are its Actions logs). Nothing
 * identifying is printed: no slug, no event name, no URL, no guest name — only
 * item numbers, outcomes and timings.
 *
 * Env:
 *   KEEPSAKE_WORKER_SECRET   required
 *   KEEPSAKE_FUNCTION_URL    default https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/send-keepsakes
 *   HYPERFRAMES_BROWSER_PATH a Chrome/Chromium binary (the runner's google-chrome)
 *   KEEPSAKE_DRY_RUN=1       render locally from a payload file instead (see --payload)
 *
 * Local render check, no network to the function:
 *   node scripts/keepsake-worker.mjs --payload <payload.json> --out <dir>
 * (in this mode a photo `url` that is not https is read from disk, relative to
 * the payload file, so a test film needs no network at all.)
 *
 * THEME + MUSIC: the payload's `keepsake: { theme, music }` (send-keepsakes
 * fills it from events.config.keepsakes) is normalised with the SAME function
 * the edge fn uses (send-keepsakes/autopilot.ts, imported directly — Node 22
 * strips the types), so an absent or unknown value means beamwall + glow. The
 * track is read from this checkout (public/keepsake-music/<id>.mp3, bpm from
 * tracks.json), its bpm handed to the composition for beat-cut timing, and
 * mixed under the film in the web encode. A missing or unreadable track, or a
 * mix that fails, NEVER fails the film: it renders silent and says so in the log.
 */
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { bakeBundle } from '../hyperframes/keepsake-film/build-render.mjs';
import { filmChoice, filmThemeColors } from '../supabase/functions/send-keepsakes/autopilot.ts';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = resolve(new URL('..', import.meta.url).pathname);

const FUNCTION_URL =
  process.env.KEEPSAKE_FUNCTION_URL || 'https://zrtftliozslrjomxbfrr.supabase.co/functions/v1/send-keepsakes';
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 30_000;
const RENDER_TIMEOUT_MS = 25 * 60 * 1000;
/** Fewer usable photos than this after downloading and the film is not made. */
const MIN_PHOTOS = 3;
/** The poster frame: inside the first photo scene (the title card runs ~4.3-5s). */
const POSTER_AT_S = 7.4;
const MUSIC_DIR = join(ROOT, 'public', 'keepsake-music');
/** The music bed's fade at the very end of the film, and its short fade-in. */
const MUSIC_FADE_OUT_S = 2;
const MUSIC_FADE_IN_S = 0.5;

function ffmpegPath() {
  return process.env.HYPERFRAMES_FFMPEG_PATH || require('@ffmpeg-installer/ffmpeg').path;
}

function renderEnv() {
  return {
    ...process.env,
    HYPERFRAMES_FFMPEG_PATH: ffmpegPath(),
    HYPERFRAMES_FFPROBE_PATH: process.env.HYPERFRAMES_FFPROBE_PATH || require('@ffprobe-installer/ffprobe').path,
    HYPERFRAMES_NO_TELEMETRY: '1',
  };
}

async function callFunction(body) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-keepsake-worker': process.env.KEEPSAKE_WORKER_SECRET ?? '' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(140_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new Error(`function ${body.op} → ${res.status} ${json?.error ?? ''}`.trim());
  return json;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LOCAL_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

/** Download every photo into the bundle so the render never waits on the
 *  network mid-frame. A photo that fails is dropped, not fatal. `localBase`
 *  (the --payload dry run only) reads non-https urls from disk instead. */
async function localisePhotos(payload, dir, localBase = null) {
  const kept = [];
  for (const [i, c] of payload.contributions.entries()) {
    try {
      if (localBase !== null && typeof c.url === 'string' && !c.url.startsWith('https://')) {
        const ext = (c.url.split('.').pop() ?? '').toLowerCase();
        if (!LOCAL_EXT.has(ext)) throw new Error(`type ${ext || 'unknown'}`);
        const name = `photo-${i}.${ext}`;
        await copyFile(resolve(localBase, c.url), join(dir, name));
        kept.push({ ...c, url: name });
        continue;
      }
      if (typeof c.url !== 'string' || !c.url.startsWith('https://')) throw new Error('not https');
      const res = await fetch(c.url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      const ext = EXT[type];
      if (!ext) throw new Error(`type ${type || 'unknown'}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > PHOTO_MAX_BYTES) throw new Error(`size ${buf.length}`);
      const name = `photo-${i}.${ext}`;
      await writeFile(join(dir, name), buf);
      kept.push({ ...c, url: name });
    } catch (e) {
      console.log(`  photo ${i + 1}: dropped (${e instanceof Error ? e.message : e})`);
    }
  }
  return { ...payload, contributions: kept };
}

/**
 * The chosen track, or null for a silent film. Never throws: 'none', an id
 * missing from the manifest, or a file that cannot be read all come back null
 * — the last two loudly, because the host picked music and is not getting it.
 */
export async function resolveMusic(musicId) {
  if (musicId === 'none') return null;
  try {
    const manifest = JSON.parse(await readFile(join(MUSIC_DIR, 'tracks.json'), 'utf8'));
    const track = (manifest.tracks ?? []).find((t) => t.id === musicId);
    if (!track) throw new Error('not in tracks.json');
    const bpm = Number(track.bpm);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 200) throw new Error('bad bpm');
    const path = join(MUSIC_DIR, `${musicId}.mp3`);
    await access(path, fsConstants.R_OK);
    if ((await stat(path)).size === 0) throw new Error('empty file');
    return { id: musicId, bpm, path };
  } catch (e) {
    console.log(`  !! MUSIC UNAVAILABLE (${musicId}): ${e instanceof Error ? e.message : e} — rendering a SILENT film`);
    return null;
  }
}

async function probeDuration(file) {
  const { stdout } = await run(renderEnv().HYPERFRAMES_FFPROBE_PATH, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { timeout: 60_000 });
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error('unreadable film duration');
  return d;
}

const VIDEO_ENCODE = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
const ENCODE_OPTS = { timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 };

/**
 * Web encode: 720p, crf 27, faststart so it starts playing before it has
 * finished downloading on a phone. With a track: loop/trim it to the film,
 * fade in briefly, fade out over the last 2 s, gently loudness-normalise, AAC.
 * Returns whether the music made it in.
 */
async function encodeWeb(raw, film, music) {
  if (music) {
    try {
      const d = await probeDuration(raw);
      const out = Math.max(0, d - MUSIC_FADE_OUT_S).toFixed(3);
      const audio =
        `[1:a]atrim=0:${d.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:st=0:d=${MUSIC_FADE_IN_S},afade=t=out:st=${out}:d=${MUSIC_FADE_OUT_S},` +
        'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[a]';
      await run(ffmpegPath(), [
        '-y', '-i', raw, '-stream_loop', '-1', '-i', music.path,
        '-filter_complex', `[0:v]scale=1280:-2[v];${audio}`,
        '-map', '[v]', '-map', '[a]', ...VIDEO_ENCODE,
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-t', d.toFixed(3), film,
      ], ENCODE_OPTS);
      return true;
    } catch (e) {
      console.log(`  !! MUSIC MIX FAILED (${music.id}): ${(e instanceof Error ? e.message : String(e)).slice(0, 200)} — encoding SILENT`);
    }
  }
  await run(ffmpegPath(), ['-y', '-i', raw, '-vf', 'scale=1280:-2', ...VIDEO_ENCODE, '-an', film], ENCODE_OPTS);
  return false;
}

/** payload → { film: <path to web mp4>, poster: <path to jpg> } inside `work`. */
export async function renderFilm(payload, work, { localBase = null } = {}) {
  const bundle = join(work, 'bundle');
  await mkdir(bundle, { recursive: true });
  // One normaliser for the edge fn and the worker (autopilot.ts): an absent or
  // unknown choice is beamwall + glow. The theme's palette always drives the
  // film; the bpm goes in so the composition can cut on the beat.
  const choice = filmChoice(payload.keepsake);
  const music = await resolveMusic(choice.music);
  const themed = {
    ...payload,
    card: { ...(payload.card ?? {}), theme: filmThemeColors(choice.theme) },
    keepsake: choice,
    ...(music ? { music: { id: music.id, bpm: music.bpm } } : {}),
  };
  const local = await localisePhotos(themed, bundle, localBase);
  if (local.contributions.length < MIN_PHOTOS) throw new Error('too_few_photos_downloaded');
  bakeBundle(local, bundle);

  const raw = join(work, 'raw.mp4');
  const film = join(work, 'keepsake.mp4');
  const poster = join(work, 'poster.jpg');
  const hyperframes = join(ROOT, 'node_modules', '.bin', 'hyperframes');
  await run(hyperframes, ['render', bundle, '--output', raw, '--fps', '30', '--quality', 'high', '--quiet'], {
    env: renderEnv(),
    timeout: RENDER_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const withMusic = await encodeWeb(raw, film, music);
  console.log(`  theme ${choice.theme} · music ${withMusic ? choice.music : 'none (silent)'}`);
  await run(ffmpegPath(), [
    '-y', '-ss', String(POSTER_AT_S), '-i', raw, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', poster,
  ], { timeout: 2 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  return { film, poster };
}

async function put(signedUrl, file, contentType) {
  const body = await readFile(file);
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'true', 'cache-control': 'max-age=3600' },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`upload ${res.status}`);
}

async function main() {
  const args = process.argv.slice(2);
  const payloadArg = args.indexOf('--payload');
  if (payloadArg !== -1) {
    // Local check: render one payload file, no function calls.
    const payloadPath = resolve(args[payloadArg + 1]);
    const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
    const out = resolve(args[args.indexOf('--out') + 1] ?? join(tmpdir(), 'keepsake-out'));
    const t0 = Date.now();
    const { film, poster } = await renderFilm(payload, out, { localBase: dirname(payloadPath) });
    console.log(`rendered in ${Math.round((Date.now() - t0) / 1000)}s → ${film} (${(await stat(film)).size} bytes), ${poster}`);
    return;
  }

  if (!process.env.KEEPSAKE_WORKER_SECRET) {
    console.log('KEEPSAKE_WORKER_SECRET is not set — nothing to do.');
    return;
  }
  const { items } = await callFunction({ op: 'due' });
  console.log(`${items.length} event(s) due`);
  let failures = 0;
  for (const [n, item] of items.entries()) {
    const label = `event ${n + 1}/${items.length}`;
    if (!item.film) {
      const r = await callFunction({ op: 'finish', eventUuid: item.eventUuid, result: 'skipped' });
      console.log(`${label}: no film (free plan or too few photos) · emailed ${r.sent}, failed ${r.failed}`);
      continue;
    }
    const work = await mkdtemp(join(tmpdir(), 'keepsake-'));
    const t0 = Date.now();
    let result = 'ready';
    let error;
    try {
      const { film, poster } = await renderFilm(item.film.payload, work);
      await put(item.film.upload.film.signedUrl, film, 'video/mp4');
      await put(item.film.upload.poster.signedUrl, poster, 'image/jpeg');
    } catch (e) {
      result = 'failed';
      error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      failures += 1;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    // Always report back: a failed film still gets the guests their photos.
    try {
      const r = await callFunction({ op: 'finish', eventUuid: item.eventUuid, result, ...(error ? { error } : {}) });
      console.log(`${label}: film ${r.film} in ${Math.round((Date.now() - t0) / 1000)}s · emailed ${r.sent}, failed ${r.failed}`);
    } catch (e) {
      failures += 1;
      console.log(`${label}: finish failed (${e instanceof Error ? e.message : e}) — it will be retried once the claim goes stale`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`worker failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
