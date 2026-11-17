import { describe, it, expect } from 'vitest';
import {
  FACE_ENGINE_SESSION_KEY,
  builtinDefaultMode,
  fallbackModeFor,
  hasFaceExpressionTrigger,
  modeNeedsMediapipe,
  modeNeedsXr8,
  parseFaceTrackingMode,
  readFaceEngineOverride,
  resolveFaceTrackingMode,
  trackingReadoutEnabled,
  type SessionStore,
} from './engineSelect';

function memStore(init: Record<string, string> = {}): SessionStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}
const throwingStore: SessionStore = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

describe('parseFaceTrackingMode', () => {
  it('accepts the three modes, trimmed and case-insensitive', () => {
    expect(parseFaceTrackingMode('mediapipe')).toBe('mediapipe');
    expect(parseFaceTrackingMode('xr8')).toBe('xr8');
    expect(parseFaceTrackingMode(' Hybrid ')).toBe('hybrid');
  });
  it('rejects everything else as null', () => {
    for (const v of [undefined, null, '', 'eighthwall', '8thwall', 1, true, {}, ['xr8']]) {
      expect(parseFaceTrackingMode(v)).toBeNull();
    }
  });
});

describe('resolveFaceTrackingMode', () => {
  it('legacy is mediapipe ALWAYS — URL, config and env cannot override it', () => {
    expect(resolveFaceTrackingMode({ legacy: true })).toEqual({ mode: 'mediapipe', source: 'legacy' });
    expect(resolveFaceTrackingMode({ legacy: true, url: 'xr8', config: 'hybrid', env: 'xr8', hasFaceTriggers: true }))
      .toEqual({ mode: 'mediapipe', source: 'legacy' });
  });
  it('platform default is xr8', () => {
    expect(builtinDefaultMode(false)).toBe('xr8');
    expect(builtinDefaultMode(true)).toBe('mediapipe');
    expect(resolveFaceTrackingMode({ legacy: false })).toEqual({ mode: 'xr8', source: 'default' });
  });
  it('the DEFAULT auto-upgrades to hybrid when the filter has face-expression triggers', () => {
    expect(resolveFaceTrackingMode({ legacy: false, hasFaceTriggers: true })).toEqual({ mode: 'hybrid', source: 'default-hybrid' });
  });
  it('an EXPLICIT xr8 is honoured as-is, even with face triggers', () => {
    expect(resolveFaceTrackingMode({ legacy: false, url: 'xr8', hasFaceTriggers: true })).toEqual({ mode: 'xr8', source: 'url' });
    expect(resolveFaceTrackingMode({ legacy: false, config: 'xr8', hasFaceTriggers: true })).toEqual({ mode: 'xr8', source: 'config' });
    expect(resolveFaceTrackingMode({ legacy: false, env: 'xr8', hasFaceTriggers: true })).toEqual({ mode: 'xr8', source: 'env' });
  });
  it('order: URL → config → env → default', () => {
    expect(resolveFaceTrackingMode({ legacy: false, url: 'mediapipe', config: 'hybrid', env: 'xr8' }).mode).toBe('mediapipe');
    expect(resolveFaceTrackingMode({ legacy: false, config: 'hybrid', env: 'mediapipe' })).toEqual({ mode: 'hybrid', source: 'config' });
    expect(resolveFaceTrackingMode({ legacy: false, env: 'mediapipe' })).toEqual({ mode: 'mediapipe', source: 'env' });
  });
  it('invalid values at any level fall through to the next', () => {
    expect(resolveFaceTrackingMode({ legacy: false, url: 'nope', config: 42, env: '' })).toEqual({ mode: 'xr8', source: 'default' });
    expect(resolveFaceTrackingMode({ legacy: false, url: 'nope', config: 'mediapipe' }).source).toBe('config');
  });
});

describe('fallback + needs', () => {
  it('both 8th Wall modes fall back to mediapipe; mediapipe has nothing below', () => {
    expect(fallbackModeFor('xr8')).toBe('mediapipe');
    expect(fallbackModeFor('hybrid')).toBe('mediapipe');
    expect(fallbackModeFor('mediapipe')).toBeNull();
  });
  it('engine needs per mode', () => {
    expect([modeNeedsXr8('mediapipe'), modeNeedsXr8('xr8'), modeNeedsXr8('hybrid')]).toEqual([false, true, true]);
    expect([modeNeedsMediapipe('mediapipe'), modeNeedsMediapipe('xr8'), modeNeedsMediapipe('hybrid')]).toEqual([true, false, true]);
  });
});

describe('hasFaceExpressionTrigger', () => {
  it('true only for face sources', () => {
    expect(hasFaceExpressionTrigger([{ source: 'smile' }])).toBe(true);
    expect(hasFaceExpressionTrigger([{ source: 'fistClench' }, { source: 'wink' }])).toBe(true);
    expect(hasFaceExpressionTrigger([{ source: 'pinch' }, { source: 'handToTemple' }])).toBe(false);
    expect(hasFaceExpressionTrigger([])).toBe(false);
    expect(hasFaceExpressionTrigger(null)).toBe(false);
  });
});

describe('readFaceEngineOverride', () => {
  it('a valid URL value wins and is remembered for the tab', () => {
    const s = memStore();
    expect(readFaceEngineOverride('?faceEngine=hybrid', s)).toBe('hybrid');
    expect(s.data[FACE_ENGINE_SESSION_KEY]).toBe('hybrid');
    // A later page without the param still sees it.
    expect(readFaceEngineOverride('', s)).toBe('hybrid');
  });
  it('an invalid URL value is ignored and never stored', () => {
    const s = memStore();
    expect(readFaceEngineOverride('?faceEngine=javascript:alert(1)', s)).toBeNull();
    expect(s.data[FACE_ENGINE_SESSION_KEY]).toBeUndefined();
  });
  it('an invalid remembered value is ignored', () => {
    expect(readFaceEngineOverride('', memStore({ [FACE_ENGINE_SESSION_KEY]: 'garbage' }))).toBeNull();
  });
  it('throwing / absent storage never throws', () => {
    expect(readFaceEngineOverride('?faceEngine=xr8', throwingStore)).toBe('xr8');
    expect(readFaceEngineOverride('', throwingStore)).toBeNull();
    expect(readFaceEngineOverride('?faceEngine=mediapipe', null)).toBe('mediapipe');
    expect(readFaceEngineOverride('', null)).toBeNull();
  });
});

describe('trackingReadoutEnabled', () => {
  it('only for testers', () => {
    expect(trackingReadoutEnabled('', memStore())).toBe(false);
    expect(trackingReadoutEnabled('?trackdebug', memStore())).toBe(true);
    expect(trackingReadoutEnabled('?faceEngine=xr8', memStore())).toBe(true);
    expect(trackingReadoutEnabled('', memStore({ [FACE_ENGINE_SESSION_KEY]: 'xr8' }))).toBe(true);
    expect(trackingReadoutEnabled('', throwingStore)).toBe(false);
  });
});
