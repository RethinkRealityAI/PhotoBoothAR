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

describe('createXr8SessionManager — frame lock plumbing', () => {
  afterEach(() => vi.unstubAllGlobals());

  class FakeCanvas { width = 90; height = 160; }
  class FakeVideo {}
  /** A WebGL stand-in that records what each texture was last filled with. */
  const fakeGl = (name: string) => {
    let bound: unknown = null;
    let flip = true;
    const filled = new Map<unknown, unknown>();
    return {
      name, filled,
      TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, TEXTURE_BINDING_2D: 4, UNPACK_FLIP_Y_WEBGL: 5,
      getParameter: (p: number) => (p === 4 ? bound : flip),
      bindTexture: (_t: number, tex: unknown) => { bound = tex; },
      pixelStorei: (_p: number, v: boolean) => { flip = v; },
      texImage2D: (...a: unknown[]) => { filled.set(bound, a[a.length - 1]); },
      get bound() { return bound; },
      get flip() { return flip; },
    };
  };

  it('fills the compute AND draw textures with the same frame, restores the draw context, and maps each draw texture to its upload', async () => {
    vi.stubGlobal('HTMLCanvasElement', FakeCanvas);
    vi.stubGlobal('HTMLVideoElement', FakeVideo);
    const { createXr8SessionManager } = await import('./xr8Session');
    const source = new FakeCanvas() as unknown as HTMLCanvasElement;
    const sm = createXr8SessionManager(source, 1);
    const m = sm.manager as any;
    const draw = fakeGl('draw'), compute = fakeGl('compute');
    const prior = { id: 'app texture' };
    draw.bindTexture(1, prior);
    const texA = { id: 'drawA' }, texB = { id: 'drawB' };

    expect(sm.frameForTexture(texA)).toBeUndefined();
    const first = m.frameStartResult({ repeatFrame: false, drawCtx: draw, computeCtx: compute, drawTexture: texA, computeTexture: { id: 'cA' } });
    expect(compute.filled.get(compute.bound)).toBe(source);
    expect(draw.filled.get(texA)).toBe(source);
    expect(draw.bound).toBe(prior); // binding restored
    expect(draw.flip).toBe(true); // UNPACK_FLIP_Y restored (uploaded unflipped)
    expect(sm.frameForTexture(texA)).toEqual({ videoTime: first.videoTime, stagedMs: sm.lastStagedMs });
    expect(sm.uploads).toBe(1);

    await new Promise((r) => setTimeout(r, 5));
    m.hasNewFrame(); // advances the placeholder clock
    const second = m.frameStartResult({ repeatFrame: false, drawCtx: draw, computeCtx: compute, drawTexture: texB, computeTexture: { id: 'cB' } });
    // The result handed back with texA is still the FIRST upload, not the latest one.
    expect(sm.frameForTexture(texA)?.videoTime).toBe(first.videoTime);
    expect(sm.frameForTexture(texB)?.videoTime).toBe(second.videoTime);
    expect(second.videoTime).not.toBe(first.videoTime);

    // A repeat frame uploads nothing and changes no mapping.
    const before = draw.filled.size;
    m.frameStartResult({ repeatFrame: true, drawCtx: draw, computeCtx: compute, drawTexture: texA, computeTexture: { id: 'cA' } });
    expect(sm.uploads).toBe(2);
    expect(draw.filled.size).toBe(before);
    expect(sm.frameForTexture(texA)?.videoTime).toBe(first.videoTime);
  });
});
