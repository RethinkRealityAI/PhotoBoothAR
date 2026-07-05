import { describe, it, expect } from 'vitest';
import { keyForPath } from './navRouting';

describe('keyForPath — legacy root builds (basePath = "")', () => {
  it('maps each guest route to its nav key', () => {
    expect(keyForPath('/booth', '')).toBe('booth');
    expect(keyForPath('/wall', '')).toBe('wall');
    expect(keyForPath('/challenges', '')).toBe('challenges');
    expect(keyForPath('/upload', '')).toBe('upload');
    expect(keyForPath('/me', '')).toBe('photos');
    expect(keyForPath('/gallery', '')).toBe('photos');
  });
  it('treats the root and the experience deep-link as the booth', () => {
    expect(keyForPath('/', '')).toBe('booth');
    expect(keyForPath('/experience/abc', '')).toBe('booth');
  });
  it('returns null for unrelated routes', () => {
    expect(keyForPath('/host/new', '')).toBeNull();
    expect(keyForPath('/login', '')).toBeNull();
  });
});

describe('keyForPath — runtime tenant builds (basePath = "/e/<slug>")', () => {
  const bp = '/e/jenna-jake';
  it('strips the tenant prefix before matching', () => {
    expect(keyForPath(`${bp}/wall`, bp)).toBe('wall');
    expect(keyForPath(`${bp}/challenges`, bp)).toBe('challenges');
    expect(keyForPath(`${bp}/upload`, bp)).toBe('upload');
    expect(keyForPath(`${bp}/me`, bp)).toBe('photos');
    expect(keyForPath(`${bp}/booth`, bp)).toBe('booth');
  });
  it('treats the bare event index as the booth', () => {
    expect(keyForPath(bp, bp)).toBe('booth');
    expect(keyForPath(`${bp}/`, bp)).toBe('booth');
  });
  it('does not confuse a slug that contains a keyword', () => {
    // /e/wall-party/upload → upload, not wall
    expect(keyForPath('/e/wall-party/upload', '/e/wall-party')).toBe('upload');
  });
});
