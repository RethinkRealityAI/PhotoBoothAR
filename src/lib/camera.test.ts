/**
 * classifyCameraError / isLikelyInAppBrowser — the pure halves of the booth's
 * camera failure taxonomy (src/lib/camera.ts). The DOM half (getUserMedia)
 * cannot run in the node test env; classification is where the copy decisions
 * live, so it is what must not drift.
 */
import { describe, it, expect } from 'vitest';
import { CameraUnavailableError, classifyCameraError, isLikelyInAppBrowser } from './camera';

function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('classifyCameraError', () => {
  it('maps the typed pre-flight error to webview', () => {
    expect(classifyCameraError(new CameraUnavailableError('insecure-context'))).toBe('webview');
    expect(classifyCameraError(new CameraUnavailableError('no-media-devices'))).toBe('webview');
  });

  it('maps permission denials (both spellings)', () => {
    expect(classifyCameraError(named('NotAllowedError'))).toBe('NotAllowedError');
    expect(classifyCameraError(named('PermissionDeniedError'))).toBe('NotAllowedError');
  });

  it('maps missing hardware (both spellings)', () => {
    expect(classifyCameraError(named('NotFoundError'))).toBe('NotFoundError');
    expect(classifyCameraError(named('DevicesNotFoundError'))).toBe('NotFoundError');
  });

  it('maps camera-in-use (NotReadable + Chrome legacy TrackStartError)', () => {
    expect(classifyCameraError(named('NotReadableError'))).toBe('NotReadableError');
    expect(classifyCameraError(named('TrackStartError'))).toBe('NotReadableError');
  });

  it('maps overconstrained (both spellings)', () => {
    expect(classifyCameraError(named('OverconstrainedError'))).toBe('OverconstrainedError');
    expect(classifyCameraError(named('ConstraintNotSatisfiedError'))).toBe('OverconstrainedError');
  });

  it('everything else — including non-Errors — is unknown', () => {
    expect(classifyCameraError(named('AbortError'))).toBe('unknown');
    expect(classifyCameraError(new TypeError('boom'))).toBe('unknown');
    expect(classifyCameraError(undefined)).toBe('unknown');
    expect(classifyCameraError('NotAllowedError')).toBe('unknown'); // string, not an Error
  });
});

describe('isLikelyInAppBrowser', () => {
  it('recognises real in-app UAs', () => {
    expect(isLikelyInAppBrowser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 334.0.4.32.98',
    )).toBe(true);
    expect(isLikelyInAppBrowser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/438.0.0.29.116]',
    )).toBe(true);
    expect(isLikelyInAppBrowser(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36',
    )).toBe(true);
  });

  it('does NOT flag real browsers', () => {
    expect(isLikelyInAppBrowser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    )).toBe(false);
    expect(isLikelyInAppBrowser(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    )).toBe(false);
    expect(isLikelyInAppBrowser('')).toBe(false);
  });
});
