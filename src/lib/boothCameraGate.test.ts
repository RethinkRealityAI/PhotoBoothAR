import { describe, expect, it } from 'vitest';
import { LEGACY_NO_CAMERA_BODY, NO_CAMERA_BODY, noCameraBody, shouldShowOnboarding } from './boothCameraGate';

describe('shouldShowOnboarding', () => {
  it('shows the tutorial once the booth starts with a working (or still-starting) camera', () => {
    expect(shouldShowOnboarding({ started: true, onboardingVisible: true, cameraError: null })).toBe(true);
  });

  it('holds the tutorial back while the camera is denied or missing, so the error is seen first', () => {
    for (const cameraError of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'webview', 'unknown'] as const) {
      expect(shouldShowOnboarding({ started: true, onboardingVisible: true, cameraError })).toBe(false);
    }
  });

  it('never shows before the booth starts or after the guest dismissed it', () => {
    expect(shouldShowOnboarding({ started: false, onboardingVisible: true, cameraError: null })).toBe(false);
    expect(shouldShowOnboarding({ started: true, onboardingVisible: false, cameraError: null })).toBe(false);
  });
});

describe('noCameraBody', () => {
  it('speaks to a phone on the platform and points at the ways out', () => {
    expect(noCameraBody(false)).toBe(NO_CAMERA_BODY);
    expect(NO_CAMERA_BODY).not.toMatch(/connect a camera/i);
    expect(NO_CAMERA_BODY).toMatch(/upload a photo/i);
  });

  it('keeps the frozen legacy wording byte-identical', () => {
    expect(noCameraBody(true)).toBe(LEGACY_NO_CAMERA_BODY);
    expect(LEGACY_NO_CAMERA_BODY).toBe('No camera was detected on this device. Please connect a camera and try again.');
  });
});
