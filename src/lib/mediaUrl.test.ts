import { describe, it, expect } from 'vitest';
import { pixelWidth, transformedUrl } from './mediaUrl';

const PUBLIC = 'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/posts/hope-gala/abc.jpg';

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
