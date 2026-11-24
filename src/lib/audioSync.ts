/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lip-sync for booth clips: delay the recorded SOUND by the age of the recorded
 * PICTURE (lib/pictureClock.ts measures that age).
 *
 * A booth clip is the composite canvas plus the microphone. The microphone is
 * live; the picture is the camera's frame after the camera's own delay and, on
 * 3D looks, after the face tracker's (frame-lock). Recorded as-is, the sound
 * leads the picture by that age: lips move after the words. Speeding the
 * picture up has a floor (the camera and the tracker both take time), so the
 * sound is held back to meet it instead: microphone -> DelayNode -> the track
 * the recorder gets. Nothing is played to the speaker.
 *
 * The decisions (how much delay, when to change it mid-clip) are pure and
 * tested in node; AudioSync below is the thin Web Audio wrapper around them.
 *
 * Safety: the recorder only uses the delayed track while its AudioContext is
 * actually running (`ready()`). A context the browser kept suspended would
 * record silence, so in that case the booth records the raw microphone exactly
 * as it did before this file existed.
 */

/** DelayNode ceiling; a picture older than this is a stall, not a delay to match. */
export const AUDIO_SYNC_MAX_MS = 600;
/**
 * Added to the picture age. The parts nothing in the browser can measure sit
 * here: the camera's sensor-to-browser time that `captureTime` leaves out on
 * some phones (picture older than measured) against the microphone's own
 * capture time (sound older than assumed). They pull opposite ways. Tune on a
 * phone with `?avtrim=`, then move the number here.
 */
export const AUDIO_SYNC_BIAS_MS = 0;
/**
 * The Web Audio hop itself delays the sound: microphone -> AudioContext ->
 * recorder waits for the context's next render buffer. That is about one
 * buffer (AudioContext.baseLatency), so the DelayNode is set that much
 * shorter. Used when a context does not report its buffer.
 */
export const AUDIO_HOP_FALLBACK_MS = 20;

/** How much the Web Audio hop alone delays the sound, from the context's reported buffer (seconds). */
export function audioHopMs(baseLatencySec: number | undefined): number {
  if (typeof baseLatencySec !== 'number' || !Number.isFinite(baseLatencySec) || baseLatencySec <= 0) return AUDIO_HOP_FALLBACK_MS;
  return Math.min(150, baseLatencySec * 1000);
}
/** While recording, a wanted change smaller than this is left alone (no audible retune). */
export const AUDIO_SYNC_DEADBAND_MS = 45;
/** While recording, the delay moves at most this fast: 40 ms/s is a 4% pitch shift, barely audible. */
export const AUDIO_SYNC_SLEW_MS_PER_S = 40;
/** Outside a recording the delay just follows; changes under this are noise. */
const IDLE_STEP_MS = 5;

export const AV_SYNC_URL_PARAM = 'avsync';
export const AV_TRIM_URL_PARAM = 'avtrim';

/** The sound delay that lines a clip up with a picture `ageMs` old. 0 when the age is unknown. */
export function audioDelayForPicture(ageMs: number | null, trimMs = 0): number {
  if (ageMs === null || !Number.isFinite(ageMs)) return 0;
  const want = ageMs + AUDIO_SYNC_BIAS_MS + (Number.isFinite(trimMs) ? trimMs : 0);
  return Math.min(AUDIO_SYNC_MAX_MS, Math.max(0, want));
}

export interface DelayChange {
  targetMs: number;
  /** Seconds to glide there; 0 = jump (nobody is listening yet). */
  rampSec: number;
}

/**
 * Should the delay move from `currentMs` toward `wantedMs`? Before a recording
 * it simply follows. During one it holds inside the deadband and otherwise
 * glides at the slew limit, so the correction is never heard as a jump.
 */
export function planDelayChange(currentMs: number, wantedMs: number, recording: boolean): DelayChange | null {
  if (!Number.isFinite(currentMs) || !Number.isFinite(wantedMs)) return null;
  const diff = Math.abs(wantedMs - currentMs);
  if (!recording) return diff >= IDLE_STEP_MS ? { targetMs: wantedMs, rampSec: 0 } : null;
  if (diff <= AUDIO_SYNC_DEADBAND_MS) return null;
  return { targetMs: wantedMs, rampSec: diff / AUDIO_SYNC_SLEW_MS_PER_S };
}

export interface AvSyncUrl {
  /** `?avsync=0|off` → false, `?avsync=1|on` → true, absent/other → null (use the default). */
  enabled: boolean | null;
  /** `?avtrim=<signed ms>`: extra sound delay (negative = less). 0 when absent/invalid. */
  trimMs: number;
}

export function parseAvSyncUrl(search: string): AvSyncUrl {
  let enabled: boolean | null = null;
  let trimMs = 0;
  try {
    const p = new URLSearchParams(search);
    const e = (p.get(AV_SYNC_URL_PARAM) ?? '').trim().toLowerCase();
    if (e === '0' || e === 'off') enabled = false;
    else if (e === '1' || e === 'on') enabled = true;
    const raw = p.get(AV_TRIM_URL_PARAM);
    const t = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
    if (Number.isFinite(t) && Math.abs(t) <= AUDIO_SYNC_MAX_MS) trimMs = Math.round(t);
  } catch {
    /* malformed query: defaults */
  }
  return { enabled, trimMs };
}

/**
 * On by default everywhere except iOS/iPadOS: WebKit's Web Audio has its own
 * microphone-route traps and this shipped the day of an event with no iPhone to
 * test on, so iPhones keep recording the raw microphone until one is checked
 * (`?avsync=1` turns it on there for that test).
 */
export function audioSyncDefaultOn(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return false;
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return false; // iPadOS desktop UA
  return true;
}

/* ------------------------------------------------------------------ */
/* Web Audio wrapper (browser only)                                    */
/* ------------------------------------------------------------------ */

export interface AudioSyncStatus {
  /** 'on' = the delayed track is usable; 'waiting' = the context is not running yet. */
  state: 'on' | 'waiting';
  /** Total sound delay (DelayNode + hop). */
  delayMs: number;
  /** Of that, the Web Audio hop's own share. */
  hopMs: number;
}

let current: AudioSync | null = null;

/** For the tester readout: the live sync, or null when none exists. */
export function getAudioSyncStatus(): AudioSyncStatus | null {
  return current === null ? null : { state: current.ready() ? 'on' : 'waiting', delayMs: current.delayMs, hopMs: current.hopMs };
}

export class AudioSync {
  private ctx: AudioContext;
  private delay: DelayNode;
  private dest: MediaStreamAudioDestinationNode;
  private source: MediaStreamAudioSourceNode | null = null;
  private sourceId = '';
  private disposed = false;
  /** Delay the hop adds on its own; the DelayNode carries the rest. */
  readonly hopMs: number;

  /** Throws when Web Audio cannot build the graph; use createAudioSync. */
  constructor(mic: MediaStreamTrack, initialMs: number) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.delay = this.ctx.createDelay(AUDIO_SYNC_MAX_MS / 1000 + 0.1);
    this.hopMs = audioHopMs(this.ctx.baseLatency);
    this.delay.delayTime.value = this.nodeMs(initialMs) / 1000;
    this.dest = this.ctx.createMediaStreamDestination();
    this.delay.connect(this.dest); // never ctx.destination: nothing reaches the speaker
    this.bind(mic);
    this.resume();
  }

  /** The delayed microphone, for the recorder. */
  get track(): MediaStreamTrack | null {
    return this.dest.stream.getAudioTracks()[0] ?? null;
  }

  /** id of the microphone track currently feeding the delay. */
  get micId(): string {
    return this.sourceId;
  }

  /** Total sound delay right now: the DelayNode plus the hop. */
  get delayMs(): number {
    return this.delay.delayTime.value * 1000 + this.hopMs;
  }

  /** DelayNode setting that makes the TOTAL delay `totalMs`. */
  private nodeMs(totalMs: number): number {
    return Math.min(AUDIO_SYNC_MAX_MS, Math.max(0, totalMs - this.hopMs));
  }

  /** The delayed track carries sound right now (a suspended context records silence). */
  ready(): boolean {
    const t = this.track;
    return !this.disposed && this.ctx.state === 'running' && t !== null && t.readyState === 'live';
  }

  /** Call from a tap: browsers start an AudioContext only after a gesture. */
  resume(): void {
    if (this.disposed || this.ctx.state === 'running') return;
    void this.ctx.resume().catch(() => { /* stays suspended: ready() says so */ });
  }

  /** Feed a (new) microphone track through the delay. */
  bind(mic: MediaStreamTrack): void {
    if (this.disposed || mic.id === this.sourceId) return;
    const next = this.ctx.createMediaStreamSource(new MediaStream([mic]));
    this.source?.disconnect();
    next.connect(this.delay);
    this.source = next;
    this.sourceId = mic.id;
  }

  /** Move the TOTAL delay toward `wantedMs` (planDelayChange decides whether and how fast). */
  setTarget(wantedMs: number, recording: boolean): void {
    if (this.disposed) return;
    const nodeNow = this.delay.delayTime.value * 1000;
    const plan = planDelayChange(nodeNow, this.nodeMs(wantedMs), recording);
    if (plan === null) return;
    const p = this.delay.delayTime;
    const now = this.ctx.currentTime;
    try {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      if (plan.rampSec > 0) p.linearRampToValueAtTime(plan.targetMs / 1000, now + plan.rampSec);
      else p.setValueAtTime(plan.targetMs / 1000, now);
    } catch {
      /* keep the current delay */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (current === this) current = null;
    try { this.source?.disconnect(); } catch { /* gone */ }
    try { this.delay.disconnect(); } catch { /* gone */ }
    for (const t of this.dest.stream.getTracks()) t.stop();
    void this.ctx.close().catch(() => { /* already closed */ });
  }
}

/** Build the delayed microphone, or null where Web Audio can't (the booth then records the raw mic). */
export function createAudioSync(mic: MediaStreamTrack, initialMs: number): AudioSync | null {
  if (typeof AudioContext === 'undefined' || typeof MediaStream === 'undefined') return null;
  try {
    const s = new AudioSync(mic, initialMs);
    current?.dispose();
    current = s;
    return s;
  } catch (e) {
    console.warn('[audioSync] unavailable, recording the raw microphone', e);
    return null;
  }
}
