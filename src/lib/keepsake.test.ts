/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  mediaExtension,
  mediaMimeType,
  keepsakeFileName,
  archiveName,
  summarize,
  summaryLine,
  groupByDay,
  playableVideoIds,
  MAX_CONCURRENT_VIDEOS,
  pickBulkSaveMode,
  formatBytes,
  progressLabel,
  KeepsakeItem,
} from './keepsake';

const at = (iso: string): number => new Date(iso).getTime();

function item(over: Partial<KeepsakeItem> = {}): KeepsakeItem {
  return {
    id: over.id ?? 'p1',
    url: over.url ?? 'https://x.test/a/shot.jpg',
    kind: over.kind ?? 'image',
    createdAt: over.createdAt ?? at('2026-07-29T20:00:00Z'),
  };
}

describe('mediaExtension', () => {
  it('trusts a recognised extension on the URL', () => {
    expect(mediaExtension('https://x/a/b.png', 'image')).toBe('png');
    expect(mediaExtension('https://x/a/b.mp4', 'video')).toBe('mp4');
    expect(mediaExtension('https://x/a/b.webm', 'video')).toBe('webm');
  });

  it('ignores query strings and fragments', () => {
    expect(mediaExtension('https://x/a/b.png?width=260&quality=70', 'image')).toBe('png');
    expect(mediaExtension('https://x/a/b.webm#t=2', 'video')).toBe('webm');
  });

  it('normalises jpeg to jpg', () => {
    expect(mediaExtension('https://x/a/b.jpeg', 'image')).toBe('jpg');
  });

  it('refuses an extension that contradicts the media type', () => {
    // Naming a webm ".png" produces a file Photos imports and cannot play.
    expect(mediaExtension('https://x/a/clip.png', 'video')).toBe('webm');
    expect(mediaExtension('https://x/a/shot.mp4', 'image')).toBe('jpg');
  });

  it('falls back by media type when the URL carries none', () => {
    expect(mediaExtension('https://x/storage/object/abc', 'image')).toBe('jpg');
    expect(mediaExtension('https://x/storage/object/abc', 'video')).toBe('webm');
  });
});

describe('mediaMimeType', () => {
  it('maps each extension we emit', () => {
    expect(mediaMimeType('png')).toBe('image/png');
    expect(mediaMimeType('jpg')).toBe('image/jpeg');
    expect(mediaMimeType('webm')).toBe('video/webm');
    expect(mediaMimeType('mp4')).toBe('video/mp4');
    expect(mediaMimeType('mov')).toBe('video/quicktime');
  });

  it('defaults to jpeg for anything unknown', () => {
    expect(mediaMimeType('zzz')).toBe('image/jpeg');
  });
});

describe('keepsakeFileName', () => {
  it('carries the event, the date and a sequence number', () => {
    const name = keepsakeFileName('Hope Gala', item({ createdAt: at('2026-07-29T20:00:00') }), 0, 3);
    expect(name).toBe('Hope-Gala_2026-07-29_1.jpg');
  });

  it('zero-pads so a phone sorts 1,2,…,10 in capture order', () => {
    const names = Array.from({ length: 12 }, (_, i) =>
      keepsakeFileName('E', item({ createdAt: at('2026-07-29T20:00:00') }), i, 12),
    );
    expect(names[0]).toContain('_01.');
    expect(names[9]).toContain('_10.');
    // Lexical order equals capture order — the point of the padding.
    expect([...names].sort()).toEqual(names);
  });

  it('uses the video extension for clips', () => {
    const name = keepsakeFileName('E', item({ kind: 'video', url: 'https://x/c.webm' }), 0, 1);
    expect(name.endsWith('.webm')).toBe(true);
  });

  it('survives a prefix made entirely of punctuation', () => {
    expect(keepsakeFileName('!!!', item(), 0, 1).startsWith('moment_')).toBe(true);
    expect(keepsakeFileName('', item(), 0, 1).startsWith('moment_')).toBe(true);
  });

  it('does not produce path separators', () => {
    const name = keepsakeFileName('A/B\\C', item(), 0, 1);
    expect(name).not.toContain('/');
    expect(name).not.toContain('\\');
  });
});

describe('archiveName', () => {
  it('slugs the event name', () => {
    expect(archiveName('Hope Gala 2026')).toBe('Hope-Gala-2026-moments.zip');
  });

  it('has a fallback', () => {
    expect(archiveName('')).toBe('moments-moments.zip');
  });
});

describe('summarize / summaryLine', () => {
  it('counts photos and videos', () => {
    const s = summarize([item(), item({ kind: 'video' }), item()]);
    expect(s).toEqual({ total: 3, photos: 2, videos: 1 });
  });

  it('handles an empty gallery', () => {
    expect(summarize([])).toEqual({ total: 0, photos: 0, videos: 0 });
    expect(summaryLine(summarize([]))).toBe('');
  });

  it('singularises', () => {
    expect(summaryLine({ total: 2, photos: 1, videos: 1 })).toBe('1 photo · 1 video');
    expect(summaryLine({ total: 3, photos: 3, videos: 0 })).toBe('3 photos');
    expect(summaryLine({ total: 2, photos: 0, videos: 2 })).toBe('2 videos');
  });
});

describe('groupByDay', () => {
  const now = at('2026-07-29T10:00:00');

  it('labels the current and previous calendar day', () => {
    const groups = groupByDay(
      [
        item({ id: 'a', createdAt: at('2026-07-29T09:00:00') }),
        item({ id: 'b', createdAt: at('2026-07-28T22:00:00') }),
      ],
      now,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
  });

  it('keeps the caller order inside a group', () => {
    const groups = groupByDay(
      [
        item({ id: 'a', createdAt: at('2026-07-29T09:00:00') }),
        item({ id: 'b', createdAt: at('2026-07-29T08:00:00') }),
      ],
      now,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('keeps the order the groups first appear in', () => {
    const groups = groupByDay(
      [
        item({ id: 'a', createdAt: at('2026-07-29T09:00:00') }),
        item({ id: 'b', createdAt: at('2026-07-20T09:00:00') }),
        item({ id: 'c', createdAt: at('2026-07-29T08:00:00') }),
      ],
      now,
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-07-29', '2026-07-20', '2026-07-29']);
  });

  it('gives older days a real date label, not "Today"', () => {
    const groups = groupByDay([item({ createdAt: at('2026-05-02T12:00:00') })], now);
    expect(groups[0].label).not.toBe('Today');
    expect(groups[0].label).not.toBe('Yesterday');
    expect(groups[0].label.length).toBeGreaterThan(4);
  });

  it('returns nothing for nothing', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('playableVideoIds', () => {
  it('caps concurrent playback', () => {
    expect(playableVideoIds(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c']);
    expect(MAX_CONCURRENT_VIDEOS).toBe(3);
  });

  it('plays nothing under reduced motion', () => {
    expect(playableVideoIds(['a', 'b'], { reducedMotion: true })).toEqual([]);
  });

  it('is stable in document order, so a clip does not flicker while scrolling', () => {
    expect(playableVideoIds(['a', 'b', 'c'], { max: 2 })).toEqual(['a', 'b']);
    expect(playableVideoIds(['a', 'b', 'c', 'd'], { max: 2 })).toEqual(['a', 'b']);
  });

  it('handles nothing visible and a zero cap', () => {
    expect(playableVideoIds([])).toEqual([]);
    expect(playableVideoIds(['a'], { max: 0 })).toEqual([]);
  });
});

describe('pickBulkSaveMode', () => {
  it('never zips a single file', () => {
    expect(pickBulkSaveMode({ canShareFiles: true, count: 1 })).toBe('single');
    expect(pickBulkSaveMode({ canShareFiles: false, count: 1 })).toBe('single');
    expect(pickBulkSaveMode({ canShareFiles: false, count: 0 })).toBe('single');
  });

  it('prefers the native share sheet when files can go through it', () => {
    expect(pickBulkSaveMode({ canShareFiles: true, count: 8 })).toBe('share');
  });

  it('falls back to one archive when there is no share sheet', () => {
    expect(pickBulkSaveMode({ canShareFiles: false, count: 8 })).toBe('zip');
  });
});

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('says nothing rather than something wrong', () => {
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(-1)).toBe('');
  });

  it('reports zero as a real value, not as empty', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('progressLabel', () => {
  it('reads as a count', () => {
    expect(progressLabel(3, 8)).toBe('Collecting 3 of 8');
  });

  it('never claims more than the total', () => {
    expect(progressLabel(9, 8)).toBe('Collecting 8 of 8');
    expect(progressLabel(-2, 8)).toBe('Collecting 0 of 8');
  });
});
