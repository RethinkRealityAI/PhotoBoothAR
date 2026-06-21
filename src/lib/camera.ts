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
 * Acquire a camera stream at the best resolution the device will grant,
 * stepping down through tiers so we never hard-fail on over-constrained specs.
 */
export async function getCameraStream(opts: CameraOptions = {}): Promise<MediaStream> {
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

  let lastErr: unknown;
  for (const facing of facingVariants) {
    for (const tier of tiers) {
      const video: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, ...tier }
        : { facingMode: facing, ...tier };
      try {
        return await navigator.mediaDevices.getUserMedia({ video, audio: withAudio });
      } catch (e) {
        lastErr = e;
        // If audio is the blocker, retry this tier without audio before stepping down.
        if (withAudio) {
          try {
            return await navigator.mediaDevices.getUserMedia({ video, audio: false });
          } catch (e2) {
            lastErr = e2;
          }
        }
      }
    }
  }
  // Last resort — let the browser pick anything.
  try {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: withAudio });
  } catch (e) {
    lastErr = e;
  }
  throw lastErr;
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
