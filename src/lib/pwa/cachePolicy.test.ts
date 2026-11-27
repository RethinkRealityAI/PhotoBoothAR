import { describe, expect, it } from 'vitest';
import { cacheNames, isStorable, staleAssetUrls, staleCacheNames, strategyFor, type RequestFacts } from './cachePolicy';

const env = { origin: 'https://beamwall.app', supabaseOrigin: 'https://p.supabase.co' };
const get = (url: string, over: Partial<RequestFacts> = {}) =>
  strategyFor({ method: 'GET', url, mode: 'cors', hasRange: false, ...over }, env);

describe('what the worker never touches', () => {
  it('leaves every Supabase API alone: REST, Auth, Realtime, Functions', () => {
    for (const path of [
      '/rest/v1/events?select=id&slug=eq.x',
      '/auth/v1/token?grant_type=refresh_token',
      '/auth/v1/user',
      '/functions/v1/submit-post',
      '/realtime/v1/websocket',
    ]) {
      expect(get(`https://p.supabase.co${path}`)).toEqual({ type: 'pass' });
    }
  });

  it('leaves guest photos, private buckets, signed links and resized images alone', () => {
    for (const path of [
      '/storage/v1/object/public/posts/ev/abc.jpg',
      '/storage/v1/object/public/cards/c/1.png',
      '/storage/v1/object/sign/support/a.png?token=t',
      '/storage/v1/object/public/assets/ev/frame.png?token=t',
      '/storage/v1/render/image/public/assets/ev/frame.png?width=200',
      '/storage/v1/object/public/assets/ev/clip.mp4',
    ]) {
      expect(get(`https://p.supabase.co${path}`)).toEqual({ type: 'pass' });
    }
  });

  it('leaves writes, media seeks, analytics and its own files alone', () => {
    expect(strategyFor({ method: 'POST', url: 'https://beamwall.app/assets/a-1.js', mode: 'cors', hasRange: false }, env)).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/models/cap.glb', { hasRange: true })).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/ingest/e/?v=1')).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/ingest/static/array.js')).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/sw.js')).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/manifest.webmanifest')).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/app.webmanifest')).toEqual({ type: 'pass' });
  });

  it('leaves other origins, odd schemes and variant (query) requests alone', () => {
    expect(get('https://example.com/a.png')).toEqual({ type: 'pass' });
    expect(get('https://cdn.jsdelivr.net/npm/some-lib/dist/x.js')).toEqual({ type: 'pass' });
    expect(get('data:image/png;base64,AAAA')).toEqual({ type: 'pass' });
    expect(get('blob:https://beamwall.app/1-2')).toEqual({ type: 'pass' });
    expect(get('not a url')).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/models/cap.glb?v=2')).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/some/api')).toEqual({ type: 'pass' });
    expect(get('https://beamwall.app/clips/a.mp4')).toEqual({ type: 'pass' });
  });

  it('touches nothing on Supabase when the build has no project', () => {
    const s = strategyFor(
      { method: 'GET', url: 'https://p.supabase.co/storage/v1/object/public/assets/a.png', mode: 'cors', hasRange: false },
      { origin: 'https://beamwall.app', supabaseOrigin: '' },
    );
    expect(s).toEqual({ type: 'pass' });
  });
});

describe('what the worker keeps', () => {
  it('page loads go to the network first, on every route', () => {
    for (const path of ['/', '/e/x/booth', '/host', '/models/thing.glb']) {
      expect(get(`https://beamwall.app${path}`, { mode: 'navigate' })).toEqual({ type: 'shell' });
    }
  });

  it('hashed build files are kept for good', () => {
    expect(get('https://beamwall.app/assets/Booth-Dx3k.js')).toEqual({ type: 'cacheFirst', cache: 'assets' });
    expect(get('https://beamwall.app/assets/index-a1.css')).toEqual({ type: 'cacheFirst', cache: 'assets' });
  });

  it('the tracking engines live in the versioned vendor cache', () => {
    for (const path of ['/mediapipe/wasm/vision_wasm_internal.wasm', '/xr8/xr.js', '/three/draco/draco_decoder.wasm']) {
      expect(get(`https://beamwall.app${path}`)).toEqual({ type: 'cacheFirst', cache: 'vendor' });
    }
  });

  it('standalone art is served from the device and refreshed behind it', () => {
    for (const path of ['/models/face_landmarker.task', '/models/baseball-cap.glb', '/fonts/geist-var-latin.woff2', '/events/foreverwedo/hero.webp', '/fonts/fonts.css']) {
      expect(get(`https://beamwall.app${path}`)).toEqual({ type: 'refresh', cache: 'static' });
    }
    expect(get('https://p.supabase.co/storage/v1/object/public/assets/ev/u-frame.png')).toEqual({ type: 'refresh', cache: 'media' });
    expect(get('https://p.supabase.co/storage/v1/object/public/assets/ev/u-crown.glb.glb')).toEqual({ type: 'refresh', cache: 'media' });
  });

  it('keeps the pinned world-tracking engine, and only a pinned version', () => {
    expect(get('https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js')).toEqual({ type: 'cacheFirst', cache: 'assets' });
    expect(get('https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@latest/dist/xr.js')).toEqual({ type: 'pass' });
    expect(get('https://cdn.jsdelivr.net/npm/@8thwall/engine-binary/dist/xr.js')).toEqual({ type: 'pass' });
  });
});

describe('what may be stored', () => {
  it('only complete, readable successes', () => {
    expect(isStorable({ status: 200, type: 'basic', contentType: 'application/wasm' })).toBe(true);
    expect(isStorable({ status: 200, type: 'cors', contentType: null })).toBe(true);
    expect(isStorable({ status: 206, type: 'basic', contentType: 'video/mp4' })).toBe(false);
    expect(isStorable({ status: 404, type: 'basic', contentType: 'text/plain' })).toBe(false);
    expect(isStorable({ status: 0, type: 'opaque', contentType: null })).toBe(false);
    expect(isStorable({ status: 200, type: 'opaqueredirect', contentType: null })).toBe(false);
  });

  it('never the index.html a host answers a missing file with', () => {
    expect(isStorable({ status: 200, type: 'basic', contentType: 'text/html; charset=UTF-8' })).toBe(false);
    expect(isStorable({ status: 200, type: 'basic', contentType: ' Text/HTML' })).toBe(false);
  });
});

describe('cache upkeep', () => {
  it('a new engine set is a new cache, and the old one is dropped', () => {
    const before = Object.values(cacheNames('aaa'));
    expect(cacheNames('bbb').vendor).not.toBe(cacheNames('aaa').vendor);
    expect(staleCacheNames(before, 'bbb')).toEqual([cacheNames('aaa').vendor]);
    expect(staleCacheNames(before, 'aaa')).toEqual([]);
  });

  it('never deletes a cache that is not ours', () => {
    expect(staleCacheNames(['workbox-precache', 'bw-old-v0', 'posthog'], 'aaa')).toEqual(['bw-old-v0']);
  });

  it('drops hashed files the current build no longer ships, keeps the CDN engine', () => {
    const cached = [
      'https://beamwall.app/assets/Booth-old.js',
      'https://beamwall.app/assets/Booth-new.js',
      'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/dist/xr.js',
      'garbage',
    ];
    expect(staleAssetUrls(cached, new Set(['/assets/Booth-new.js']), 'https://beamwall.app')).toEqual([
      'https://beamwall.app/assets/Booth-old.js',
      'garbage',
    ]);
  });
});
