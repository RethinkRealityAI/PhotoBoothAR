#!/usr/bin/env node
/**
 * generate-keepsake-music — Beamwall's own keepsake-film music library.
 *
 * A deterministic synthesiser in plain Node: no samples, no third-party audio,
 * no dependencies beyond the ffmpeg binary the video pipeline already ships
 * (@ffmpeg-installer/ffmpeg). Every note is computed here from a seeded PRNG,
 * so Beamwall owns the output outright — no licence fee, no attribution, safe
 * for commercial films. Re-running it reproduces the same tracks.
 *
 * Writes, into public/keepsake-music/:
 *   <id>.mp3       ~48 s, 44.1 kHz stereo, 128 kb/s, mastered to -16 LUFS
 *                  integrated with a -1.5 dBTP ceiling (two-pass loudnorm)
 *   tracks.json    the manifest the film worker reads (bpm, length, the beat
 *                  grid's origin) — src/lib/keepsakeMusic.test.ts pins
 *                  src/lib/keepsakeMusic.ts to it
 *   LICENSES.md    one provenance record per track
 *
 * THE BEAT GRID STARTS AT 0.000 s in every track (bar 1, beat 1 is the first
 * sample). The film composition cuts on beats by multiplying 60/bpm, so a
 * track that started with a pickup or silence would put every cut off-beat.
 *
 * Usage: node scripts/generate-keepsake-music.mjs [--only <id>] [--wav-dir <dir>]
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'public', 'keepsake-music');

const SR = 44100;
const TARGET_LUFS = -16;
const TRUE_PEAK = -1.5;
const BITRATE = '128k';

function ffmpegPath() {
  return process.env.FFMPEG_PATH || process.env.HYPERFRAMES_FFMPEG_PATH || require('@ffmpeg-installer/ffmpeg').path;
}

/* ── Determinism ───────────────────────────────────────────────────────── */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ── The mix bus ───────────────────────────────────────────────────────── */

function makeBus(n) {
  return { L: new Float32Array(n), R: new Float32Array(n) };
}

/** Equal-power pan, p in [-1, 1]. */
function panGains(p) {
  const a = ((p + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** Write a mono signal (generator fn(i) over [start, start+len)) into a bus. */
function addMono(bus, start, len, pan, gain, fn) {
  const [gl, gr] = panGains(pan);
  const n = bus.L.length;
  const s0 = Math.max(0, start);
  const s1 = Math.min(n, start + len);
  for (let i = s0; i < s1; i += 1) {
    const v = fn(i - start) * gain;
    bus.L[i] += v * gl;
    bus.R[i] += v * gr;
  }
}

/* ── Envelopes & filters ───────────────────────────────────────────────── */

/** ADSR value at time t (s) for a note held `hold` seconds. */
function adsr(t, hold, a, d, s, r) {
  let v;
  if (t < a) v = t / a;
  else if (t < a + d) v = 1 - (1 - s) * ((t - a) / d);
  else v = s;
  if (t >= hold) {
    const held = hold < a ? hold / a : hold < a + d ? 1 - (1 - s) * ((hold - a) / d) : s;
    const k = (t - hold) / r;
    v = k >= 1 ? 0 : held * (1 - k) * (1 - k);
  }
  return v;
}

/** One-pole lowpass coefficient for a cutoff in Hz. */
const lpCoef = (hz) => 1 - Math.exp((-2 * Math.PI * Math.min(hz, SR * 0.45)) / SR);

/** PolyBLEP correction for a band-limited sawtooth. */
function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/* ── Instruments ───────────────────────────────────────────────────────── */

/**
 * Warm pad: detuned PolyBLEP saws through two cascaded one-pole lowpasses
 * (12 dB/oct) with a slow cutoff drift, spread across the stereo field.
 */
function pad(bus, rnd, note, t0, hold, o) {
  const { vel = 0.5, cutoff = 1400, attack = 0.8, release = 1.6, voices = 3, detune = 9, spread = 0.7 } = o;
  const len = Math.ceil((hold + release) * SR);
  const start = Math.round(t0 * SR);
  const f = mtof(note);
  for (let v = 0; v < voices; v += 1) {
    const cents = voices === 1 ? 0 : -detune + (2 * detune * v) / (voices - 1);
    const fv = f * Math.pow(2, (cents + (rnd() - 0.5) * 2) / 1200);
    const dt = fv / SR;
    let ph = rnd();
    let y1 = 0;
    let y2 = 0;
    const lfoPh = rnd() * Math.PI * 2;
    const pan = voices === 1 ? 0 : -spread + (2 * spread * v) / (voices - 1);
    addMono(bus, start, len, pan, vel / voices, (i) => {
      const t = i / SR;
      ph += dt;
      if (ph >= 1) ph -= 1;
      const saw = 2 * ph - 1 - polyBlep(ph, dt);
      const c = lpCoef(cutoff * (1 + 0.18 * Math.sin(2 * Math.PI * 0.09 * (t0 + t) + lfoPh)));
      y1 += c * (saw - y1);
      y2 += c * (y1 - y2);
      return y2 * adsr(t, hold, attack, 0.6, 0.85, release);
    });
  }
}

/** Plucked string (Karplus-Strong) — a soft, wooden arp voice. */
function pluck(bus, rnd, note, t0, o) {
  const { vel = 0.4, decay = 0.996, bright = 0.5, pan = 0, length = 1.6 } = o;
  const f = mtof(note);
  const N = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(N);
  // Pre-filtered noise burst: `bright` 1 = raw, 0 = very dark.
  let lp = 0;
  for (let k = 0; k < N; k += 1) {
    lp += (0.15 + 0.85 * bright) * (rnd() * 2 - 1 - lp);
    buf[k] = lp;
  }
  let mean = 0;
  for (let k = 0; k < N; k += 1) mean += buf[k];
  mean /= N;
  for (let k = 0; k < N; k += 1) buf[k] -= mean;
  let idx = 0;
  const len = Math.round(length * SR);
  addMono(bus, Math.round(t0 * SR), len, pan, vel * 1.6, (i) => {
    const a = buf[idx];
    const b = buf[(idx + 1) % N];
    buf[idx] = decay * 0.5 * (a + b);
    idx = (idx + 1) % N;
    const tail = i > len - 2000 ? (len - i) / 2000 : 1;
    const att = i < 40 ? i / 40 : 1;
    return a * tail * att;
  });
}

/**
 * Additive "felt piano": inharmonic partials, higher ones decaying faster,
 * two strings a cent apart for warmth, a short damper release.
 */
function piano(bus, rnd, note, t0, hold, o) {
  const { vel = 0.45, pan = 0, partials = 9 } = o;
  const f = mtof(note);
  const B = 0.00035;
  const release = 0.45;
  const len = Math.ceil((hold + release) * SR);
  const amps = [];
  const freqs = [];
  const decays = [];
  for (let k = 1; k <= partials; k += 1) {
    const fk = k * f * Math.sqrt(1 + B * k * k);
    if (fk > 9000) break;
    // Darker top end at low velocity, like a real hammer.
    amps.push(Math.pow(k, -1.25) * Math.exp(-(k - 1) * (0.55 - vel * 0.35)));
    freqs.push(fk);
    decays.push(0.55 + k * 0.75 + f / 900);
  }
  const phases = freqs.map(() => rnd() * Math.PI * 2);
  addMono(bus, Math.round(t0 * SR), len, pan, vel * 0.55, (i) => {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < freqs.length; k += 1) {
      const w = 2 * Math.PI * freqs[k] * t + phases[k];
      s += amps[k] * Math.exp(-decays[k] * t) * (Math.sin(w) + 0.6 * Math.sin(w * 1.0006));
    }
    const att = t < 0.004 ? t / 0.004 : 1;
    const rel = t > hold ? Math.max(0, 1 - (t - hold) / release) : 1;
    return s * att * rel * rel;
  });
}

/** Round bass: sine + a touch of 2nd harmonic, gentle lowpass. */
function bass(bus, note, t0, hold, o) {
  const { vel = 0.5, release = 0.18, drive = 0.25 } = o;
  const f = mtof(note);
  const len = Math.ceil((hold + release) * SR);
  let y = 0;
  const c = lpCoef(f * 5);
  addMono(bus, Math.round(t0 * SR), len, 0, vel, (i) => {
    const t = i / SR;
    const w = 2 * Math.PI * f * t;
    const s = Math.tanh((Math.sin(w) + drive * Math.sin(2 * w)) * 1.3);
    y += c * (s - y);
    return y * adsr(t, hold, 0.012, 0.25, 0.75, release);
  });
}

function kick(bus, t0, o = {}) {
  const { vel = 0.8, tone = 48, punch = 85 } = o;
  let ph = 0;
  addMono(bus, Math.round(t0 * SR), Math.round(0.55 * SR), 0, vel, (i) => {
    const t = i / SR;
    const f = tone + punch * Math.exp(-t * 32);
    ph += (2 * Math.PI * f) / SR;
    const click = t < 0.002 ? (1 - t / 0.002) * 0.35 : 0;
    return Math.sin(ph) * Math.exp(-t * 6.5) + click;
  });
}

/** Noise percussion: highpassed (hats, shaker) or band-limited (clap, snare). */
function noiseHit(bus, rnd, t0, o) {
  const { vel = 0.2, decay = 40, hp = 6000, lp = 14000, pan = 0, len = 0.3, bursts = 1, body = 0 } = o;
  let l1 = 0;
  let l2 = 0;
  const chp = lpCoef(hp);
  const clp = lpCoef(lp);
  addMono(bus, Math.round(t0 * SR), Math.round(len * SR), pan, vel, (i) => {
    const t = i / SR;
    const n = rnd() * 2 - 1;
    l1 += chp * (n - l1);
    const h = n - l1; // highpass
    l2 += clp * (h - l2); // then lowpass
    let env = Math.exp(-t * decay);
    if (bursts > 1 && t < 0.03) env *= 0.6 + 0.4 * Math.cos(t * 2 * Math.PI * (bursts / 0.03));
    const tone = body > 0 ? body * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30) : 0;
    return (l2 + tone) * env;
  });
}

/* ── Effects ───────────────────────────────────────────────────────────── */

/** Stereo ping-pong feedback delay with a darkening loop. */
function pingPong(src, out, seconds, feedback, wet, damp = 3500) {
  const d = Math.round(seconds * SR);
  const n = src.L.length;
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  let w = 0;
  let fl = 0;
  let fr = 0;
  const c = lpCoef(damp);
  for (let i = 0; i < n; i += 1) {
    const yl = bl[w];
    const yr = br[w];
    fl += c * (yr - fl);
    fr += c * (yl - fr);
    // Mono input enters on the left; the loop crosses channels each repeat.
    bl[w] = (src.L[i] + src.R[i]) * 0.5 + fl * feedback;
    br[w] = fr * feedback;
    w = (w + 1) % d;
    out.L[i] += yl * wet;
    out.R[i] += yr * wet;
  }
}

/**
 * Freeverb-style reverb: 8 lowpass-feedback combs + 4 allpasses per channel,
 * the right channel's delays offset for width.
 */
function reverb(src, out, { room = 0.84, damp = 0.28, wet = 0.3, predelay = 0.018 } = {}) {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const n = src.L.length;
  const pre = Math.round(predelay * SR);
  for (const [chan, offset] of [['L', 0], ['R', 23]]) {
    const input = src[chan];
    const acc = new Float32Array(n);
    for (const base of combs) {
      const d = Math.round(((base + offset) * SR) / 44100);
      const buf = new Float32Array(d);
      let w = 0;
      let store = 0;
      for (let i = 0; i < n; i += 1) {
        const y = buf[w];
        store = y * (1 - damp) + store * damp;
        const x = i >= pre ? input[i - pre] : 0;
        buf[w] = x * 0.015 + store * room;
        w = (w + 1) % d;
        acc[i] += y;
      }
    }
    for (const base of aps) {
      const d = Math.round(((base + offset) * SR) / 44100);
      const buf = new Float32Array(d);
      let w = 0;
      for (let i = 0; i < n; i += 1) {
        const b = buf[w];
        const x = acc[i];
        acc[i] = -x + b;
        buf[w] = x + b * 0.5;
        w = (w + 1) % d;
      }
    }
    const o = out[chan];
    for (let i = 0; i < n; i += 1) o[i] += acc[i] * wet;
  }
}

/* ── Songs ─────────────────────────────────────────────────────────────── */

/**
 * Each song: bpm, a 4-chord loop (pad voicing + bass root), the bar count
 * (the last bar is the tonic that rings out), the tail, and an arranger that
 * places notes bar by bar. `sec` = which section a bar belongs to.
 */
const SONGS = {
  glow: {
    title: 'Afterglow',
    mood: 'Warm, hopeful and cinematic. Fits almost any night.',
    bpm: 84,
    seed: 0x61f7,
    bars: 16,
    tail: 3.6,
    // D add9 · A sus2 · Bm7 · G maj7(9) — then V → I to close.
    loop: [
      { pad: [62, 66, 69, 76], root: 38 },
      { pad: [61, 64, 69, 71], root: 45 },
      { pad: [59, 62, 66, 69], root: 47 },
      { pad: [59, 62, 66, 69 + 2], root: 43 },
    ],
    cadence: [{ pad: [61, 64, 69, 73], root: 45 }, { pad: [62, 66, 69, 74, 78], root: 38 }],
    arrange(ctx, bar, ch, sec) {
      const { beat, t, bus, rnd } = ctx;
      for (const m of ch.pad) pad(bus.pad, rnd, m, t, beat * 4, { vel: 0.3, cutoff: sec === 'intro' ? 900 + bar * 200 : 1700, attack: 1.1, release: 2.2 });
      if (bar >= 2) bass(bus.dry, ch.root, t, beat * 3.6, { vel: 0.22 });
      if (bar >= 2 && sec !== 'end') {
        const tones = [...ch.pad.slice(0, 4)].sort((a, b) => a - b).map((m) => m + 12);
        const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
        pattern.forEach((p, k) => pluck(bus.verbDelay, rnd, tones[p], t + k * beat * 0.5 + rnd() * 0.006, { vel: 0.17 + (k % 2 === 0 ? 0.05 : 0), bright: 0.42, pan: k % 2 ? 0.35 : -0.35, decay: 0.995 }));
      }
      if (sec === 'full') {
        kick(bus.dry, t, { vel: 0.42 });
        kick(bus.dry, t + beat * 2.5, { vel: 0.26 });
        if (bar >= 8) for (const b of [1, 3]) noiseHit(bus.verb, rnd, t + b * beat, { vel: 0.17, decay: 22, hp: 900, lp: 6000, bursts: 3, len: 0.35, body: 0.25 });
        for (let s = 0; s < 8; s += 1) noiseHit(bus.dry, rnd, t + s * beat * 0.5 + (s % 2 ? beat * 0.06 : 0), { vel: s % 2 ? 0.1 : 0.065, decay: 34, hp: 6500, pan: 0.25 });
      }
      if (sec === 'end') kick(bus.dry, t, { vel: 0.45 });
    },
  },
  celebrate: {
    title: 'Raise a Glass',
    mood: 'Bright and upbeat, made for parties and birthdays.',
    bpm: 118,
    seed: 0x2c11,
    bars: 22,
    tail: 3.2,
    // F add9 · Dm7 · Bb maj7 · C sus4.
    loop: [
      { pad: [65, 69, 72, 79], root: 41 },
      { pad: [62, 65, 69, 72], root: 38 },
      { pad: [62, 65, 69, 70 + 2], root: 46 },
      { pad: [60, 65, 67, 72], root: 36 },
    ],
    cadence: [{ pad: [60, 64, 67, 70], root: 36 }, { pad: [65, 69, 72, 77, 81], root: 41 }],
    arrange(ctx, bar, ch, sec) {
      const { beat, t, bus, rnd } = ctx;
      for (const m of ch.pad) pad(bus.pad, rnd, m, t, beat * 4, { vel: 0.24, cutoff: sec === 'intro' ? 1400 + bar * 500 : 2600, attack: 0.25, release: 1.2 });
      if (sec !== 'end') {
        const tones = [...ch.pad].sort((a, b) => a - b).map((m) => m + 12);
        const pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2];
        pattern.forEach((p, k) => pluck(bus.verbDelay, rnd, tones[p], t + k * beat * 0.25 + rnd() * 0.004, { vel: k % 4 === 0 ? 0.2 : 0.13, bright: 0.65, pan: k % 2 ? 0.4 : -0.4, decay: 0.993, length: 0.9 }));
      }
      if (bar >= 2 && sec !== 'end') for (let e = 0; e < 8; e += 1) bass(bus.dry, ch.root + (e % 2 ? 12 : 0), t + e * beat * 0.5, beat * 0.4, { vel: 0.2 });
      if (sec === 'full') {
        for (let b = 0; b < 4; b += 1) kick(bus.dry, t + b * beat, { vel: 0.45, tone: 52 });
        for (const b of [1, 3]) noiseHit(bus.verb, rnd, t + b * beat, { vel: 0.3, decay: 18, hp: 1100, lp: 7000, bursts: 3, len: 0.4, body: 0.15 });
        for (let b = 0; b < 4; b += 1) noiseHit(bus.dry, rnd, t + (b + 0.5) * beat, { vel: 0.13, decay: 16, hp: 7000, pan: 0.3, len: 0.25 });
      }
      if (sec === 'break') noiseHit(bus.verb, rnd, t + beat * 3.5, { vel: 0.12, decay: 4, hp: 3000, len: 0.5 });
      if (sec === 'end') {
        kick(bus.dry, t, { vel: 0.6, tone: 52 });
        noiseHit(bus.verb, rnd, t, { vel: 0.12, decay: 2.2, hp: 5000, len: 2.5, pan: 0 });
      }
    },
  },
  elegance: {
    title: 'Black Tie',
    mood: 'Graceful piano and strings for galas and weddings.',
    bpm: 72,
    seed: 0x5e1e,
    bars: 13,
    tail: 4.6,
    // C maj9 · A m9 · F maj7 · G6.
    loop: [
      { pad: [55, 64, 71, 74], root: 36 },
      { pad: [57, 64, 67, 71], root: 33 },
      { pad: [57, 64, 65, 72], root: 41 },
      { pad: [59, 62, 64, 67], root: 43 },
    ],
    cadence: [{ pad: [59, 62, 65, 67], root: 43 }, { pad: [55, 64, 67, 72, 76], root: 36 }],
    arrange(ctx, bar, ch, sec) {
      const { beat, t, bus, rnd } = ctx;
      for (const m of ch.pad) pad(bus.pad, rnd, m, t, beat * 4, { vel: sec === 'intro' ? 0.17 : 0.22, cutoff: 1700, attack: 1.4, release: 2.6, voices: 4, detune: 7 });
      piano(bus.verb, rnd, ch.root + 12, t, beat * 3.8, { vel: 0.5, pan: -0.2 });
      if (sec !== 'end') {
        const tones = [...ch.pad].sort((a, b) => a - b);
        const up = [tones[0], tones[1], tones[2], tones[3], tones[2] + 12, tones[3], tones[2], tones[1]];
        up.forEach((m, k) => piano(bus.verb, rnd, m, t + k * beat * 0.5 + rnd() * 0.01, beat * 0.9, { vel: 0.26 + (k === 0 ? 0.08 : 0), pan: 0.15 }));
        // A slow top line from bar 4: chord tones an octave up, one per half bar.
        if (bar >= 4) {
          const top = tones.map((m) => m + 12);
          const pick = top[(bar * 3 + 1) % top.length];
          piano(bus.verb, rnd, pick, t, beat * 1.8, { vel: 0.42, pan: 0.1 });
          piano(bus.verb, rnd, top[(bar * 3 + 3) % top.length], t + beat * 2, beat * 1.8, { vel: 0.34, pan: 0.1 });
        }
      } else {
        [...ch.pad].sort((a, b) => a - b).forEach((m, k) => piano(bus.verb, rnd, m, t + k * 0.05, beat * 6, { vel: 0.38, pan: -0.1 + k * 0.06 }));
      }
    },
  },
  tender: {
    title: 'Keep This',
    mood: 'Soft and sentimental, for anniversaries and tributes.',
    bpm: 66,
    seed: 0x7e4d,
    bars: 12,
    tail: 4.6,
    // G add9 · E m7 · C maj7 · D sus4.
    loop: [
      { pad: [55, 59, 62, 69], root: 43 },
      { pad: [55, 59, 62, 64], root: 40 },
      { pad: [55, 59, 64, 67], root: 36 },
      { pad: [55, 57, 62, 67], root: 38 },
    ],
    cadence: [{ pad: [54, 57, 62, 66], root: 38 }, { pad: [55, 59, 62, 67, 71], root: 43 }],
    arrange(ctx, bar, ch, sec) {
      const { beat, t, bus, rnd } = ctx;
      for (const m of ch.pad) pad(bus.pad, rnd, m, t, beat * 4, { vel: 0.2, cutoff: 1300, attack: 1.6, release: 3, voices: 3, detune: 6 });
      bass(bus.dry, ch.root, t, beat * 3.7, { vel: 0.14, drive: 0.1 });
      const tones = [...ch.pad].sort((a, b) => a - b);
      if (sec !== 'end') {
        [0, 2, 1, 3].forEach((p, k) => piano(bus.verb, rnd, tones[p] + 12, t + k * beat + rnd() * 0.012, beat * 1.2, { vel: 0.3, pan: -0.15 }));
        // A music-box line in the second half.
        if (bar >= 6) [3, 2].forEach((p, k) => pluck(bus.verbDelay, rnd, tones[p] + 24, t + (k * 2 + 0.5) * beat, { vel: 0.11, bright: 0.3, pan: 0.3, decay: 0.997, length: 2 }));
      } else {
        tones.forEach((m, k) => piano(bus.verb, rnd, m + 12, t + k * 0.07, beat * 6, { vel: 0.32, pan: -0.15 + k * 0.08 }));
      }
    },
  },
  nightlife: {
    title: 'Late Set',
    mood: 'Deep pulse and shimmer, for clubs and after-parties.',
    bpm: 122,
    seed: 0x3a9b,
    bars: 22,
    tail: 3.4,
    // A m9 · F maj7 · C add9 · G 6.
    loop: [
      { pad: [57, 60, 64, 71], root: 33 },
      { pad: [57, 60, 64, 65], root: 29 },
      { pad: [55, 60, 62, 64], root: 36 },
      { pad: [55, 59, 62, 64], root: 31 },
    ],
    cadence: [{ pad: [56, 59, 62, 64], root: 28 }, { pad: [57, 60, 64, 69, 71], root: 33 }],
    duck: true,
    arrange(ctx, bar, ch, sec) {
      const { beat, t, bus, rnd } = ctx;
      for (const m of ch.pad) pad(bus.pad, rnd, m, t, beat * 4, { vel: 0.26, cutoff: sec === 'intro' ? 500 + bar * 400 : sec === 'break' ? 900 : 1500, attack: 0.4, release: 1.4, voices: 3, detune: 14, spread: 0.9 });
      if (sec !== 'end' && sec !== 'intro') {
        // Sub pulse on the off-beats, pumping against the kick.
        for (let b = 0; b < 4; b += 1) bass(bus.dry, ch.root + 12, t + (b + 0.5) * beat, beat * 0.42, { vel: sec === 'break' ? 0.14 : 0.27, drive: 0.45 });
      }
      if (sec !== 'end') {
        const tones = [...ch.pad].sort((a, b) => a - b).map((m) => m + 24);
        // Shimmer: sparse high plucks on the delay.
        for (const k of [0, 3, 6, 10, 13]) pluck(bus.verbDelay, rnd, tones[k % tones.length], t + k * beat * 0.25, { vel: 0.1, bright: 0.75, pan: k % 2 ? 0.6 : -0.6, decay: 0.994, length: 1 });
      }
      if (sec === 'full' || (sec === 'intro' && bar === 1)) {
        for (let b = 0; b < 4; b += 1) {
          if (sec === 'full') kick(bus.dry, t + b * beat, { vel: 0.55, tone: 46, punch: 95 });
          noiseHit(bus.dry, rnd, t + (b + 0.5) * beat, { vel: 0.14, decay: 14, hp: 7500, pan: 0.2, len: 0.25 });
          noiseHit(bus.dry, rnd, t + (b + 0.25) * beat, { vel: 0.04, decay: 60, hp: 9000, pan: -0.3, len: 0.08 });
          noiseHit(bus.dry, rnd, t + (b + 0.75) * beat, { vel: 0.04, decay: 60, hp: 9000, pan: -0.3, len: 0.08 });
        }
        if (sec === 'full') for (const b of [1, 3]) noiseHit(bus.verb, rnd, t + b * beat, { vel: 0.24, decay: 20, hp: 1200, lp: 7500, bursts: 3, len: 0.35 });
      }
      if (sec === 'end') kick(bus.dry, t, { vel: 0.7, tone: 46, punch: 95 });
    },
  },
};

function sectionOf(bar, bars) {
  if (bar === bars - 1) return 'end';
  if (bar < 2) return 'intro';
  if (bar >= bars - 3) return 'break';
  return 'full';
}

/** Render one song to a stereo Float32 pair. */
function renderSong(id) {
  const song = SONGS[id];
  const rnd = mulberry32(song.seed);
  const beat = 60 / song.bpm;
  const barLen = beat * 4;
  const total = song.bars * barLen + song.tail;
  const n = Math.ceil(total * SR);
  const bus = { dry: makeBus(n), pad: makeBus(n), verb: makeBus(n), verbDelay: makeBus(n) };
  const kicks = [];
  const origKick = kick;
  const ctxKick = (b, t0, o) => {
    kicks.push(t0);
    origKick(b, t0, o);
  };
  for (let bar = 0; bar < song.bars; bar += 1) {
    const sec = sectionOf(bar, song.bars);
    const ch = bar === song.bars - 2 ? song.cadence[0] : bar === song.bars - 1 ? song.cadence[1] : song.loop[bar % song.loop.length];
    const t = bar * barLen;
    // The final chord rings: arrange it with a held bar and the whole tail.
    song.arrange({ beat, t, bus, rnd, kick: ctxKick }, bar, ch, sec);
  }

  // Sidechain-style duck on the pad bus for the club track (from the kick grid).
  if (song.duck) {
    for (let bar = 2; bar < song.bars - 3; bar += 1) for (let b = 0; b < 4; b += 1) kicks.push(bar * barLen + b * beat);
    const env = new Float32Array(n).fill(1);
    for (const k of kicks) {
      const s = Math.round(k * SR);
      const l = Math.round(beat * 0.9 * SR);
      for (let i = 0; i < l && s + i < n; i += 1) {
        const x = i / l;
        env[s + i] = Math.min(env[s + i], 0.35 + 0.65 * x * x);
      }
    }
    for (let i = 0; i < n; i += 1) {
      bus.pad.L[i] *= env[i];
      bus.pad.R[i] *= env[i];
    }
  }

  // Sends: pad → reverb; verb bus → reverb; verbDelay → delay → reverb.
  const out = makeBus(n);
  const verbIn = makeBus(n);
  const delayOut = makeBus(n);
  pingPong(bus.verbDelay, delayOut, beat * 0.75, 0.38, 0.55);
  for (let i = 0; i < n; i += 1) {
    out.L[i] = bus.dry.L[i] + bus.pad.L[i] + bus.verb.L[i] + bus.verbDelay.L[i] + delayOut.L[i];
    out.R[i] = bus.dry.R[i] + bus.pad.R[i] + bus.verb.R[i] + bus.verbDelay.R[i] + delayOut.R[i];
    verbIn.L[i] = bus.pad.L[i] * 0.55 + bus.verb.L[i] + bus.verbDelay.L[i] * 0.6 + delayOut.L[i] * 0.5;
    verbIn.R[i] = bus.pad.R[i] * 0.55 + bus.verb.R[i] + bus.verbDelay.R[i] * 0.6 + delayOut.R[i] * 0.5;
  }
  reverb(verbIn, out, { wet: id === 'nightlife' || id === 'celebrate' ? 0.22 : 0.34, room: id === 'tender' || id === 'elegance' ? 0.88 : 0.84 });

  // Master: DC/rumble highpass, a short fade-in, a long natural fade over the
  // tail (the last chord rings out — never a hard cut), soft saturation.
  const hpC = lpCoef(28);
  let hl = 0;
  let hr = 0;
  // Gentle high tilt (~+3-4 dB above 3 kHz): the synth voices are lowpassed
  // and read dull on phone speakers without it.
  const tilt = id === 'tender' || id === 'elegance' ? 0.75 : 0.5;
  const tC = lpCoef(3000);
  let tl = 0;
  let tr = 0;
  for (let i = 0; i < n; i += 1) {
    tl += tC * (out.L[i] - tl);
    tr += tC * (out.R[i] - tr);
    out.L[i] += tilt * (out.L[i] - tl);
    out.R[i] += tilt * (out.R[i] - tr);
  }
  let peak = 0;
  const fadeIn = 0.25 * SR;
  const tailStart = (song.bars - 1) * barLen;
  for (let i = 0; i < n; i += 1) {
    hl += hpC * (out.L[i] - hl);
    hr += hpC * (out.R[i] - hr);
    let g = i < fadeIn ? i / fadeIn : 1;
    const t = i / SR;
    if (t > tailStart + barLen * 0.5) {
      const k = Math.min(1, (t - tailStart - barLen * 0.5) / (total - tailStart - barLen * 0.5));
      g *= Math.pow(1 - k, 1.6);
    }
    out.L[i] = (out.L[i] - hl) * g;
    out.R[i] = (out.R[i] - hr) * g;
    peak = Math.max(peak, Math.abs(out.L[i]), Math.abs(out.R[i]));
  }
  const norm = 0.7 / (peak || 1);
  for (let i = 0; i < n; i += 1) {
    out.L[i] = Math.tanh(out.L[i] * norm * 1.25) / Math.tanh(1.25);
    out.R[i] = Math.tanh(out.R[i] * norm * 1.25) / Math.tanh(1.25);
  }
  return { L: out.L, R: out.R, durationSec: n / SR, song };
}

/** 32-bit float stereo WAV. */
function wavBytes(L, R) {
  const n = L.length;
  const data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i += 1) {
    data.writeFloatLE(L[i], i * 8);
    data.writeFloatLE(R[i], i * 8 + 4);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 8, 28);
  h.writeUInt16LE(8, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function lastJson(text) {
  const m = text.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!m) throw new Error('loudnorm produced no measurement');
  return JSON.parse(m[m.length - 1]);
}

async function master(wav, mp3) {
  const ff = ffmpegPath();
  const ln = `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=11`;
  const p1 = await run(ff, ['-hide_banner', '-nostats', '-i', wav, '-af', `${ln}:print_format=json`, '-f', 'null', '-'], { maxBuffer: 16 << 20 });
  const m = lastJson(p1.stderr);
  const af = `${ln}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  const p2 = await run(ff, ['-hide_banner', '-nostats', '-y', '-i', wav, '-af', af, '-ar', String(SR), '-c:a', 'libmp3lame', '-b:a', BITRATE, '-map_metadata', '-1', mp3], { maxBuffer: 16 << 20 });
  const o = lastJson(p2.stderr);
  // Measure what actually shipped (the mp3), not the filter's own estimate.
  const p3 = await run(ff, ['-hide_banner', '-nostats', '-i', mp3, '-af', `${ln}:print_format=json`, '-f', 'null', '-'], { maxBuffer: 16 << 20 });
  const f = lastJson(p3.stderr);
  return { mode: o.normalization_type, lufs: Number(f.input_i), truePeak: Number(f.input_tp) };
}

async function gitHead() {
  try {
    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const wavDir = args.includes('--wav-dir') ? resolve(args[args.indexOf('--wav-dir') + 1]) : null;
  await mkdir(OUT, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), 'keepsake-music-'));
  const scriptSha = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex').slice(0, 16);
  const commit = await gitHead();
  const today = new Date().toISOString().slice(0, 10);

  let manifest = { generator: 'scripts/generate-keepsake-music.mjs', tracks: [] };
  try {
    manifest = JSON.parse(await readFile(join(OUT, 'tracks.json'), 'utf8'));
  } catch {
    /* first run */
  }
  const byId = new Map(manifest.tracks.map((t) => [t.id, t]));

  try {
    for (const id of Object.keys(SONGS)) {
      if (only && id !== only) continue;
      const t0 = Date.now();
      const { L, R, durationSec, song } = renderSong(id);
      const wav = join(wavDir ?? tmp, `${id}.wav`);
      if (wavDir) await mkdir(wavDir, { recursive: true });
      await writeFile(wav, wavBytes(L, R));
      const mp3 = join(OUT, `${id}.mp3`);
      const m = await master(wav, mp3);
      const bytes = (await readFile(mp3)).length;
      byId.set(id, {
        id,
        title: song.title,
        mood: song.mood,
        bpm: song.bpm,
        durationSec: Math.round(durationSec * 100) / 100,
        beatOriginSec: 0,
        bars: song.bars,
        file: `/keepsake-music/${id}.mp3`,
        bytes,
        lufs: m.lufs,
        truePeak: m.truePeak,
        loudnorm: m.mode,
        generatedAt: today,
        generatorSha256: scriptSha,
        baseCommit: commit,
      });
      console.log(`${id}: ${durationSec.toFixed(2)}s · ${bytes} bytes · ${m.lufs} LUFS · ${m.truePeak} dBTP (${m.mode}) · ${Date.now() - t0}ms`);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const tracks = Object.keys(SONGS).map((id) => byId.get(id)).filter(Boolean);
  await writeFile(join(OUT, 'tracks.json'), `${JSON.stringify({ generator: 'scripts/generate-keepsake-music.mjs', tracks }, null, 2)}\n`);

  const lines = [
    '# Keepsake film music — licence records',
    '',
    'Every track in this folder is **self-generated** by `scripts/generate-keepsake-music.mjs`,',
    'a deterministic synthesiser written for Beamwall (seeded PRNG, no samples, no',
    'third-party audio, no AI model). Beamwall owns the recordings and the',
    'compositions outright.',
    '',
    '- **No attribution required.**',
    '- **Commercial use allowed** (keepsake films, marketing, anywhere).',
    '- Re-running the generator reproduces the tracks; `generator sha256` below',
    '  identifies the exact script version that wrote each file.',
    '',
    'A sourced track (CC0 or royalty-free-no-attribution) may only be added with',
    'its own record here, its licence text, and a matching `license` entry in',
    '`src/lib/keepsakeMusic.ts`.',
    '',
  ];
  for (const t of tracks) {
    lines.push(
      `## ${t.title} (\`${t.id}\`)`,
      '',
      `- File: \`public${t.file}\` (${t.durationSec}s, ${t.bpm} bpm, ${t.lufs} LUFS, ${t.truePeak} dBTP)`,
      `- Kind: self-generated`,
      `- Generator: \`scripts/generate-keepsake-music.mjs\` (sha256 \`${t.generatorSha256}\`), base commit \`${t.baseCommit}\``,
      `- Licence: owned by Beamwall — no attribution required, commercial use allowed`,
      `- Generated: ${t.generatedAt}`,
      '',
    );
  }
  await writeFile(join(OUT, 'LICENSES.md'), lines.join('\n'));
}

main().catch((e) => {
  console.error(`generate-keepsake-music failed: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
