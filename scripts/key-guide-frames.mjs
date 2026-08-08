/**
 * key-guide-frames — turn vendored green-screen frame art into the transparent
 * 1080×1920 PNGs the /guides download gallery ships, plus 540w webp thumbnails
 * that KEEP that transparency so the page can say what the hole is.
 *
 * Input:  scripts/guide-frames.json  { frames: [{ id, raw }] }
 *         where raw is a repo-relative PNG under src/assets/guides/_raw/
 *         (vendored there by the fetch-remote-assets workflow).
 * Output: public/guides/frames/<id>.png        (real alpha, 1080×1920)
 *         public/guides/frames/thumb/<id>.webp (540w, real alpha)
 *
 * The thumbs used to be flattened onto the page's own near-black — which made
 * every face window render as a black void, indistinguishable from black
 * ARTWORK on the dark designs, and it is the first thing a host has to
 * understand about a frame. They now carry alpha (~20% more bytes, still
 * 16-50 KB) and the gallery paints a chequerboard behind them.
 *
 * The actual keying is src/lib/studio/chromaKey.ts — the same tested
 * YCbCr-chroma + despill + contain-fit pipeline the product's AI Frame Studio
 * uses (ffmpeg -vf chromakey is RGB-distance and leaves a green fringe, so it
 * is deliberately NOT used; ffmpeg here is only the PNG↔raw-RGBA codec).
 * chromaKey.ts is TS, so it is esbuild-bundled to a temp module first.
 *
 * Honesty gate: a frame whose keyedFraction < MIN_KEYED_FRACTION never matched
 * its backdrop — no output is written, the raw is kept for inspection, and a
 * warning is printed. The guides test suite asserts every shipped FRAME_PACK id
 * has its PNG, so a gated frame turns CI red instead of shipping green.
 *
 * Runs both locally (ffmpeg via @ffmpeg-installer in node_modules) and in the
 * fetch-remote-assets workflow (apt ffmpeg). Idempotent: an existing PNG is
 * never re-keyed (that half consumes the raw); its thumb IS re-derived every
 * run, because a thumb is a pure function of a committed lossless PNG, so it
 * can never drift from the frame it stands for.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(repo, 'scripts', 'guide-frames.json');
const RAW_DIR = join(repo, 'src', 'assets', 'guides', '_raw');
const OUT_DIR = join(repo, 'public', 'guides', 'frames');
const THUMB_DIR = join(OUT_DIR, 'thumb');
const W = 1080;
const H = 1920;

function bin(name, pkgPath) {
  const vendored = join(repo, 'node_modules', pkgPath);
  if (process.env[name.toUpperCase()]) return process.env[name.toUpperCase()];
  if (existsSync(vendored)) return vendored;
  return name; // system binary (the GitHub runner apt-installs ffmpeg)
}
const FFMPEG = bin('ffmpeg', '@ffmpeg-installer/linux-x64/ffmpeg');
const FFPROBE = bin('ffprobe', '@ffprobe-installer/linux-x64/ffprobe');

const MAX_RAW_BYTES = 128 * 1024 * 1024; // 2K RGBA ≈ 16.5 MB; huge headroom

function run(cmd, args, input) {
  return execFileSync(cmd, args, { input, maxBuffer: MAX_RAW_BYTES });
}

function probeSize(file) {
  const out = run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]).toString().trim();
  const [w, h] = out.split(',').map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error(`ffprobe returned unusable dimensions "${out}" for ${file}`);
  }
  return { w, h };
}

/**
 * The gallery thumbnail: 540w webp, alpha intact, derived from the committed
 * transparent PNG. libwebp carries the alpha channel straight through — the
 * flattening that used to happen here was an explicit colour overlay, not a
 * codec limit.
 */
function writeThumb(srcPng, outWebp) {
  run(FFMPEG, [
    '-v', 'error', '-y', '-i', srcPng,
    '-vf', 'scale=540:-2',
    '-frames:v', '1', '-update', '1', '-c:v', 'libwebp', '-q:v', '82', outWebp,
  ]);
}

async function loadChromaKey() {
  const esbuild = await import('esbuild');
  const outfile = join(tmpdir(), `chroma-key-bundle-${process.pid}.mjs`);
  await esbuild.build({
    entryPoints: [join(repo, 'src', 'lib', 'studio', 'chromaKey.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outfile, { force: true });
  return mod;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
if (frames.length === 0) {
  console.log('guide-frames.json lists no frames — nothing to key.');
  process.exit(0);
}

const { processFrameImage, MIN_KEYED_FRACTION } = await loadChromaKey();
mkdirSync(THUMB_DIR, { recursive: true });

const failures = [];
let keyed = 0;
let skipped = 0;

for (const { id, raw } of frames) {
  if (!id || !raw) {
    failures.push(`malformed entry: ${JSON.stringify({ id, raw })}`);
    continue;
  }
  const outPng = join(OUT_DIR, `${id}.png`);
  const outThumb = join(THUMB_DIR, `${id}.webp`);
  if (existsSync(outPng)) {
    // Keying is the half that consumes the raw, so a committed PNG is never
    // re-keyed. The thumb is re-derived: ~50ms, no generation loss (the source
    // is the committed lossless PNG, unlike the mp4 re-encode trap in
    // fetch-remote-assets), and it means a recipe change here reaches every
    // shipped thumb on the next run instead of only the next new frame.
    writeThumb(outPng, outThumb);
    skipped++;
    continue;
  }
  const rawAbs = join(repo, raw);
  if (!existsSync(rawAbs)) {
    failures.push(`${id}: raw not vendored yet (${raw})`);
    continue;
  }
  try {
    const { w, h } = probeSize(rawAbs);
    const rgba = run(FFMPEG, [
      '-v', 'error', '-i', rawAbs,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
    ]);
    if (rgba.length !== w * h * 4) {
      throw new Error(`decoded ${rgba.length} bytes, expected ${w * h * 4} (${w}x${h})`);
    }
    const img = { data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width: w, height: h };
    const { image, keyedFraction, keyColor } = processFrameImage(img, W, H);
    if (keyedFraction < MIN_KEYED_FRACTION) {
      failures.push(
        `${id}: keyedFraction ${keyedFraction.toFixed(4)} < ${MIN_KEYED_FRACTION} — backdrop never matched, raw kept for inspection`,
      );
      continue;
    }
    run(FFMPEG, [
      '-v', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-',
      '-frames:v', '1', '-update', '1', outPng,
    ], Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length));
    writeThumb(outPng, outThumb);
    // Success — every variant of this id has served its purpose.
    if (existsSync(RAW_DIR)) {
      for (const f of readdirSync(RAW_DIR)) {
        if (f.startsWith(`${id}__`)) unlinkSync(join(RAW_DIR, f));
      }
    }
    keyed++;
    console.log(`✓ ${id} (keyedFraction ${keyedFraction.toFixed(3)}, key rgb(${keyColor.join(',')}))`);
  } catch (err) {
    failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\nkeyed ${keyed} · already done ${skipped} · failed ${failures.length}`);
for (const f of failures) console.log(`::warning title=guide-frame not keyed::${f}`);
// Exit 0 even on failures: good frames must still be committed by the workflow.
// Enforcement lives in the guides test suite (file-existence per FRAME_PACK id).
