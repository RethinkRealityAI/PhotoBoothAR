import { afterEach, describe, expect, it, vi } from 'vitest';
import { XR8_REQUIRED_FILES, isRealAsset, loadXr8 } from './xr8Session';

describe('isRealAsset — the index.html-at-200 trap', () => {
  it('rejects the SPA fallback page for a script and for a model', () => {
    expect(isRealAsset(200, 'text/html; charset=utf-8', 'js')).toBe(false);
    expect(isRealAsset(200, 'text/html', 'binary')).toBe(false);
  });
  it('accepts real scripts and models, rejects non-2xx', () => {
    expect(isRealAsset(200, 'application/javascript', 'js')).toBe(true);
    expect(isRealAsset(200, 'text/javascript; charset=utf-8', 'js')).toBe(true);
    expect(isRealAsset(200, 'application/octet-stream', 'binary')).toBe(true);
    expect(isRealAsset(404, 'application/javascript', 'js')).toBe(false);
    expect(isRealAsset(200, 'application/json', 'js')).toBe(false);
  });
});

describe('loadXr8 — rejects instead of hanging', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects without a browser', async () => {
    await expect(loadXr8('/xr8/', 50)).rejects.toThrow(/browser/);
  });

  it('rejects when the server answers a missing model with index.html, naming the file and the fix; a later call retries', async () => {
    const appended: unknown[] = [];
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('document', { querySelector: () => null, createElement: () => ({}), head: { appendChild: (s: unknown) => appended.push(s) } });
    const fetchMock = vi.fn(async (url: string) => ({
      status: 200,
      headers: { get: () => (url.endsWith('face-mesh-model.tflite') ? 'text/html' : url.endsWith('.js') ? 'application/javascript' : 'application/octet-stream') },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadXr8('/xr8/', 200)).rejects.toThrow(/face-mesh-model\.tflite missing .*copy:xr8/);
    expect(appended).toHaveLength(0); // never injected a script after a failed check
    expect(fetchMock).toHaveBeenCalledTimes(XR8_REQUIRED_FILES.length);
    await expect(loadXr8('/xr8/', 200)).rejects.toThrow(/face-mesh-model/);
    expect(fetchMock).toHaveBeenCalledTimes(XR8_REQUIRED_FILES.length * 2); // not a cached rejection
  });

  it('times out when xrloaded never fires', async () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('document', {
      querySelector: () => null,
      createElement: () => ({ addEventListener() {}, dataset: {} }),
      head: { appendChild() {} },
    });
    vi.stubGlobal('fetch', async (url: string) => ({
      status: 200, headers: { get: () => (url.endsWith('.js') ? 'application/javascript' : 'application/octet-stream') },
    }));
    await expect(loadXr8('/xr8/', 60)).rejects.toThrow(/xr\.js load timed out/);
  });
});
