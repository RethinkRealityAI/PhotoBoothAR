/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Camera acquisition helpers: highest-quality stream with graceful fallback,
 * front/back switching, and multi-camera detection.
 */

export type Facing = 'user' | 'environment';

export interface CameraOptions {
  facingMode?: Facing;
  withAudio?: boolean;
  deviceId?: string;
}

/**
 * Thrown BEFORE getUserMedia is ever called when the environment cannot
 * provide a camera at all: an insecure (non-HTTPS) context, or a webview /
 * ancient browser with no mediaDevices. Calling getUserMedia in those
 * environments throws an untyped TypeError (or nothing at all), which the
 * booth could only render as a generic "Camera Unavailable" with retry —
 * a dead end, because retrying can never work there.
 */
export class CameraUnavailableError extends Error {
  readonly kind: 'insecure-context' | 'no-media-devices';
  constructor(kind: 'insecure-context' | 'no-media-devices') {
    super(
      kind === 'insecure-context'
        ? 'Camera requires a secure (https) context'
        : 'navigator.mediaDevices is not available in this browser',
    );
    this.name = 'CameraUnavailableError';
    this.kind = kind;
  }
}

/** The failure vocabulary the booth's error screen renders. */
export type CameraFailure =
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'NotReadableError'
  | 'OverconstrainedError'
  | 'webview'          // insecure context / no mediaDevices — retry cannot help
  | 'unknown';

/** Map a getUserMedia rejection (or our own pre-flight throw) to the booth's
 *  error vocabulary. Pure — unit-tested in camera.test.ts. */
export function classifyCameraError(err: unknown): CameraFailure {
  if (err instanceof CameraUnavailableError) return 'webview';
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'NotAllowedError';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'NotFoundError';
    case 'NotReadableError':
    case 'TrackStartError': // Chrome's legacy name for the same condition
      return 'NotReadableError';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'OverconstrainedError';
    default:
      return 'unknown';
  }
}

/**
 * True when the UA string looks like a known in-app browser (Instagram,
 * Facebook, Messenger, LINE, Google app, TikTok, Snapchat…). Used ONLY to
 * choose friendlier wording ("tap ⋯ and open in Safari/Chrome") on the error
 * screen — never as a gate: plenty of webviews can use the camera, and the
 * pre-flight guard above is the actual detector for the ones that cannot.
 */
export function isLikelyInAppBrowser(ua: string): boolean {
  return /\b(Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|GSA\/|Snapchat|musical_ly|TikTok|; wv\))/i.test(ua);
}

/** Pre-flight: throw the TYPED error instead of letting getUserMedia produce
 *  an anonymous TypeError in webviews / insecure contexts. */
function assertCameraCapable(): void {
  // Order matters: an insecure context is usually WHY mediaDevices is missing,
  // and its remedy ("open the https link") is more actionable.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new CameraUnavailableError('insecure-context');
  }
  if (
    typeof navigator === 'undefined' ||
    navigator.mediaDevices === undefined ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    throw new CameraUnavailableError('no-media-devices');
  }
}

/**
 * Acquire a camera stream at the best resolution the device will grant,
 * stepping down through tiers so we never hard-fail on over-constrained specs.
 */
export async function getCameraStream(opts: CameraOptions = {}): Promise<MediaStream> {
  assertCameraCapable();
  const { facingMode = 'user', withAudio = false, deviceId } = opts;

  const tiers: MediaTrackConstraints[] = [
    { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    {},
  ];

  // Try `exact` facing first (forces the actual front/back switch on phones),
  // then fall back to `ideal` if the device can't honour the exact request.
  const facingVariants: MediaTrackConstraints['facingMode'][] = deviceId
    ? [undefined as unknown as MediaTrackConstraints['facingMode']]
    : [{ exact: facingMode }, { ideal: facingMode }];

  // Acquire VIDEO on its own (audio:false). Bundling audio into this request
  // means a mic permission/hardware hiccup throws away the whole stream and the
  // recording silently ends up without sound; keeping them separate makes the
  // video robust and lets us add audio independently below.
  let stream: MediaStream | null = null;
  let lastErr: unknown;
  outer: for (const facing of facingVariants) {
    for (const tier of tiers) {
      const video: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, ...tier }
        : { facingMode: facing, ...tier };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        break outer;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  // Last resort — let the browser pick anything.
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } catch (e) {
      throw e ?? lastErr;
    }
  }

  // Add a microphone track when requested. Failure here is non-fatal — the guest
  // simply records without sound rather than losing the camera entirely.
  if (withAudio) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const track = mic.getAudioTracks()[0];
      if (track) stream.addTrack(track);
    } catch (e) {
      console.warn('[camera] microphone unavailable — recording without audio', e);
    }
  }

  return stream;
}

export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

/** True when the device has more than one camera (so a flip button is useful). */
export async function hasMultipleCameras(): Promise<boolean> {
  return (await listVideoInputs()).length > 1;
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Resolution actually granted (useful for sizing capture/record canvases). */
export function streamResolution(stream: MediaStream): { width: number; height: number } {
  const track = stream.getVideoTracks()[0];
  const s = track?.getSettings();
  return { width: s?.width ?? 1280, height: s?.height ?? 720 };
}
