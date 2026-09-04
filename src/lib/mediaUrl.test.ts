import { describe, it, expect } from 'vitest';
import { pixelWidth, publicObjectPath, transformedUrl } from './mediaUrl';

const PUBLIC = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/posts/hope-gala/abc.jpg';
const ORIGIN = 'https://zrtftliozslrjomxbfrr.supabase.co';

describe('transformedUrl', () => {
  it('rewrites a Supabase public object URL to the render endpoint', () => {
    const out = transformedUrl(PUBLIC, { width: 240 });
    expect(out).toBe(
      'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/render/image/public/posts/hope-gala/abc.jpg'
      + '?width=240&quality=70&resize=cover',
    );
  });

  it('keeps the path intact, including nested folders', () => {
    const out = transformedUrl(PUBLIC, { width: 100 });
    expect(out).toContain('/public/posts/hope-gala/abc.jpg?');
  });

  it('refuses a video — the image transformer would 400 on it', () => {
    for (const ext of ['mp4', 'webm', 'mov']) {
      const v = PUBLIC.replace('.jpg', `.${ext}`);
      expect(transformedUrl(v, { width: 240 })).toBeNull();
    }
  });

  it('returns null for anything not a Supabase public object URL', () => {
    expect(transformedUrl('https://example.com/photo.jpg', { width: 240 })).toBeNull();
    expect(transformedUrl('data:image/png;base64,AAAA', { width: 240 })).toBeNull();
    expect(transformedUrl('blob:http://localhost/abc', { width: 240 })).toBeNull();
  });

  it('returns null for empty, null and undefined rather than throwing', () => {
    expect(transformedUrl('', { width: 240 })).toBeNull();
    expect(transformedUrl(null, { width: 240 })).toBeNull();
    expect(transformedUrl(undefined, { width: 240 })).toBeNull();
  });

  it('does not double-transform an already-transformed URL', () => {
    const once = transformedUrl(PUBLIC, { width: 240 })!;
    expect(transformedUrl(once, { width: 480 })).toBeNull();
  });

  it('leaves a URL that already has a query string alone', () => {
    // Not one we built — merging parameters we don't understand is worse than
    // serving the original.
    expect(transformedUrl(`${PUBLIC}?token=x`, { width: 240 })).toBeNull();
  });

  it('clamps quality into the range the transformer accepts', () => {
    expect(transformedUrl(PUBLIC, { width: 10, quality: 1 })).toContain('quality=20');
    expect(transformedUrl(PUBLIC, { width: 10, quality: 500 })).toContain('quality=100');
  });

  it('rounds a fractional width — a layout measurement is never an integer', () => {
    expect(transformedUrl(PUBLIC, { width: 240.6 })).toContain('width=241');
  });

  it('never emits a width below 1', () => {
    expect(transformedUrl(PUBLIC, { width: 0 })).toContain('width=1');
    expect(transformedUrl(PUBLIC, { width: -50 })).toContain('width=1');
  });

  it('honours the resize mode', () => {
    expect(transformedUrl(PUBLIC, { width: 10, resize: 'contain' })).toContain('resize=contain');
  });
});

describe('publicObjectPath', () => {
  // The shape submit-post writes: `<slug>/<sessionId>/<uuid>.<ext>`.
  const KEY = 'hope-gala/s_ab12cd34/9f1c8f2e-0000-4000-8000-abcdefabcdef.jpg';
  const URL_FOR_KEY = `${ORIGIN}/storage/v1/object/public/posts/${KEY}`;

  it('recovers the object key a post URL was built from', () => {
    expect(publicObjectPath(URL_FOR_KEY, 'posts', ORIGIN)).toBe(KEY);
  });

  it('accepts an origin with a trailing slash (SUPABASE_URL is written both ways)', () => {
    expect(publicObjectPath(URL_FOR_KEY, 'posts', `${ORIGIN}/`)).toBe(KEY);
  });

  it('drops a query string or fragment', () => {
    expect(publicObjectPath(`${URL_FOR_KEY}?v=2`, 'posts', ORIGIN)).toBe(KEY);
    expect(publicObjectPath(`${URL_FOR_KEY}#top`, 'posts', ORIGIN)).toBe(KEY);
  });

  it('refuses a URL from another origin, even one carrying the marker', () => {
    // An indexOf-based reader hands back a key here — the whole reason the
    // origin is matched as a literal prefix.
    expect(
      publicObjectPath(`https://evil.example.com/x?u=/storage/v1/object/public/posts/${KEY}`, 'posts', ORIGIN),
    ).toBeNull();
    expect(publicObjectPath(`https://evil.example.com/storage/v1/object/public/posts/${KEY}`, 'posts', ORIGIN))
      .toBeNull();
  });

  it('refuses another bucket', () => {
    expect(publicObjectPath(URL_FOR_KEY, 'assets', ORIGIN)).toBeNull();
    expect(publicObjectPath(`${ORIGIN}/storage/v1/object/public/assets/hope-gala/ai/x.png`, 'posts', ORIGIN))
      .toBeNull();
  });

  it('refuses a signed/authenticated URL — that is a different endpoint', () => {
    expect(publicObjectPath(`${ORIGIN}/storage/v1/object/sign/posts/${KEY}`, 'posts', ORIGIN)).toBeNull();
  });

  it('refuses a traversal, an empty key and a missing input rather than throwing', () => {
    expect(publicObjectPath(`${ORIGIN}/storage/v1/object/public/posts/../secrets/x.jpg`, 'posts', ORIGIN))
      .toBeNull();
    expect(publicObjectPath(`${ORIGIN}/storage/v1/object/public/posts/`, 'posts', ORIGIN)).toBeNull();
    expect(publicObjectPath('', 'posts', ORIGIN)).toBeNull();
    expect(publicObjectPath(null, 'posts', ORIGIN)).toBeNull();
    expect(publicObjectPath(undefined, 'posts', ORIGIN)).toBeNull();
    expect(publicObjectPath(URL_FOR_KEY, '', ORIGIN)).toBeNull();
    expect(publicObjectPath(URL_FOR_KEY, 'posts', '')).toBeNull();
  });

  it('leaves percent escapes alone — decoding could only ever manufacture a traversal', () => {
    expect(publicObjectPath(`${ORIGIN}/storage/v1/object/public/posts/a/%2e%2e/b.jpg`, 'posts', ORIGIN))
      .toBe('a/%2e%2e/b.jpg');
  });

  it('round-trips with transformedUrl input (both read the same marker)', () => {
    expect(publicObjectPath(PUBLIC, 'posts', ORIGIN)).toBe('hope-gala/abc.jpg');
  });
});

describe('pixelWidth', () => {
  it('scales by DPR', () => {
    expect(pixelWidth(200, 2)).toBe(400);
  });

  it('caps DPR at 2 — 3x throws away most of the saving', () => {
    expect(pixelWidth(200, 3)).toBe(400);
  });

  it('treats a sub-1 DPR as 1', () => {
    expect(pixelWidth(200, 0.5)).toBe(200);
  });

  it('never asks the transformer to upscale past the source', () => {
    expect(pixelWidth(900, 2, 1080)).toBe(1080);
  });

  it('rounds to a whole pixel', () => {
    expect(pixelWidth(100.4, 1)).toBe(100);
  });
});
