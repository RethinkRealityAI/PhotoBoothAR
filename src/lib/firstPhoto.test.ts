import { describe, expect, it } from 'vitest';
import { MAX_FIRST_PHOTO_WATCHES, coverWithPost, firstPhotoWatchSlugs, isCelebratablePost } from './firstPhoto';

describe('firstPhotoWatchSlugs', () => {
  it('watches only live events with a known count of zero', () => {
    expect(firstPhotoWatchSlugs([
      { id: '1', slug: 'a', status: 'live', count: 0 },
      { id: '2', slug: 'b', status: 'live', count: 3 },
      { id: '3', slug: 'c', status: 'draft', count: 0 },
      { id: '4', slug: 'd', status: 'live', count: undefined },
      { id: '5', slug: 'e', status: 'ended', count: 0 },
    ])).toEqual(['a']);
  });

  it('never treats an unknown count as zero', () => {
    expect(firstPhotoWatchSlugs([{ id: '1', slug: 'a', status: 'live', count: undefined }])).toEqual([]);
  });

  it('caps the number of watched events', () => {
    const list = Array.from({ length: 6 }, (_, i) => ({ id: String(i), slug: `s${i}`, status: 'live', count: 0 }));
    expect(firstPhotoWatchSlugs(list)).toHaveLength(MAX_FIRST_PHOTO_WATCHES);
    expect(firstPhotoWatchSlugs(list)[0]).toBe('s0');
  });
});

describe('isCelebratablePost', () => {
  it('skips hidden and missing posts', () => {
    expect(isCelebratablePost({ hidden: false })).toBe(true);
    expect(isCelebratablePost({ hidden: true })).toBe(false);
    expect(isCelebratablePost(null)).toBe(false);
  });
});

describe('coverWithPost', () => {
  it('starts a cover from nothing', () => {
    expect(coverWithPost(undefined, { image_url: 'u1', media_type: 'image' })).toEqual({ count: 1, thumbs: ['u1'] });
  });

  it('puts the new photo first, keeps four, and does not mutate', () => {
    const before = { count: 4, thumbs: ['a', 'b', 'c', 'd'] };
    const after = coverWithPost(before, { image_url: 'n', media_type: 'image' });
    expect(after).toEqual({ count: 5, thumbs: ['n', 'a', 'b', 'c'] });
    expect(before).toEqual({ count: 4, thumbs: ['a', 'b', 'c', 'd'] });
  });

  it('counts a video but never uses it as a thumbnail', () => {
    expect(coverWithPost({ count: 0, thumbs: [] }, { image_url: 'v.mp4', media_type: 'video' })).toEqual({ count: 1, thumbs: [] });
  });
});
