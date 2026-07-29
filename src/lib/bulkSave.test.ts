/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The network is injected, so these run in the node-env suite with no server,
 * no DOM and no Supabase import.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  collectFiles,
  archiveOf,
  canShareFiles,
  shareFiles,
  ArchiveTooBigError,
  MAX_ARCHIVE_BYTES,
  CollectedFile,
} from './bulkSave';
import { KeepsakeItem } from './keepsake';

const items = (n: number, kind: 'image' | 'video' = 'image'): KeepsakeItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    url: `https://x.test/posts/shot-${i}.${kind === 'video' ? 'webm' : 'png'}`,
    kind,
    createdAt: new Date('2026-07-29T20:00:00').getTime() + i,
  }));

/** A fetch stub that returns `size` bytes, or fails per the map. */
function stubFetch(opts: { size?: number; fail?: Record<string, number | 'network'> } = {}) {
  const size = opts.size ?? 8;
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    for (const [needle, mode] of Object.entries(opts.fail ?? {})) {
      if (href.includes(needle)) {
        if (mode === 'network') throw new TypeError('Failed to fetch');
        return new Response(null, { status: mode as number });
      }
    }
    return new Response(new Uint8Array(size).fill(7));
  }) as unknown as typeof fetch;
}

describe('collectFiles', () => {
  it('downloads every item and names them uniquely', async () => {
    const res = await collectFiles(items(3), { filePrefix: 'Hope Gala', fetchImpl: stubFetch() });
    expect(res.files).toHaveLength(3);
    expect(res.failures).toEqual([]);
    expect(res.totalBytes).toBe(24);
    expect(new Set(res.files.map((f) => f.name)).size).toBe(3);
    expect(res.files[0].name).toMatch(/^Hope-Gala_2026-07-29_1\.png$/);
  });

  it('reports progress from 0 through the total', async () => {
    const seen: string[] = [];
    await collectFiles(items(3), {
      filePrefix: 'E',
      fetchImpl: stubFetch(),
      onProgress: (d, t) => seen.push(`${d}/${t}`),
    });
    expect(seen).toEqual(['0/3', '1/3', '2/3', '3/3']);
  });

  it('sets a content type matching the media, not the guess', async () => {
    const res = await collectFiles(items(1, 'video'), { filePrefix: 'E', fetchImpl: stubFetch() });
    expect(res.files[0].type).toBe('video/webm');
  });

  it('keeps the batch when one item 404s', async () => {
    const res = await collectFiles(items(3), {
      filePrefix: 'E',
      fetchImpl: stubFetch({ fail: { 'shot-1': 404 } }),
    });
    expect(res.files.map((f) => f.id)).toEqual(['p0', 'p2']);
    expect(res.failures).toEqual([{ id: 'p1', reason: 'this one is no longer available' }]);
  });

  it('distinguishes a server fault from a dropped connection', async () => {
    const res = await collectFiles(items(2), {
      filePrefix: 'E',
      fetchImpl: stubFetch({ fail: { 'shot-0': 500, 'shot-1': 'network' } }),
    });
    expect(res.files).toEqual([]);
    expect(res.failures.map((f) => f.reason)).toEqual([
      'the event server had a problem',
      'the connection dropped',
    ]);
  });

  it('never lets a failure look like a success', async () => {
    const res = await collectFiles(items(2), {
      filePrefix: 'E',
      fetchImpl: stubFetch({ fail: { shot: 'network' } }),
    });
    expect(res.files).toHaveLength(0);
    expect(res.failures).toHaveLength(2);
    expect(res.totalBytes).toBe(0);
  });

  it('stops on abort and returns what it already has', async () => {
    const ctrl = new AbortController();
    let n = 0;
    const impl = vi.fn(async () => {
      if (++n === 2) ctrl.abort();
      return new Response(new Uint8Array(4));
    }) as unknown as typeof fetch;
    const res = await collectFiles(items(5), {
      filePrefix: 'E',
      fetchImpl: impl,
      signal: ctrl.signal,
    });
    expect(res.aborted).toBe(true);
    expect(res.files.length).toBeGreaterThan(0);
    expect(res.files.length).toBeLessThan(5);
  });

  it('refuses a batch that would not fit in memory', async () => {
    // A fake response whose arrayBuffer reports a huge length without actually
    // allocating 1.5 GB — the guard reads `.byteLength`, nothing else.
    const huge = Math.ceil(MAX_ARCHIVE_BYTES / 2) + 1;
    const fake = (async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(huge),
    })) as unknown as typeof fetch;
    await expect(
      collectFiles(items(3), { filePrefix: 'E', fetchImpl: fake }),
    ).rejects.toBeInstanceOf(ArchiveTooBigError);
  });

  it('reports every item as failed rather than throwing when there is no fetch', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Object.defineProperty(globalThis, 'fetch', { value: undefined, configurable: true });
    try {
      const res = await collectFiles(items(2), { filePrefix: 'E' });
      expect(res.files).toEqual([]);
      expect(res.failures.map((f) => f.id)).toEqual(['p0', 'p1']);
      expect(res.failures[0].reason).toBe('downloads are unavailable here');
    } finally {
      if (original) Object.defineProperty(globalThis, 'fetch', original);
    }
  });

  it('handles an empty selection', async () => {
    const res = await collectFiles([], { filePrefix: 'E', fetchImpl: stubFetch() });
    expect(res).toEqual({ files: [], failures: [], totalBytes: 0, aborted: false });
  });
});

describe('archiveOf', () => {
  it('packs collected files into a zip Blob', async () => {
    const res = await collectFiles(items(2), { filePrefix: 'E', fetchImpl: stubFetch({ size: 16 }) });
    const blob = archiveOf(res.files);
    expect(blob.type).toBe('application/zip');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    // Raw bytes are stored, so the archive is larger than its payload.
    expect(blob.size).toBeGreaterThan(32);
  });

  it('produces a valid empty archive rather than throwing', () => {
    const blob = archiveOf([]);
    expect(blob.size).toBe(22); // EOCD only
  });
});

describe('canShareFiles', () => {
  const withNav = async (nav: unknown, fn: () => void | Promise<void>) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    try {
      await fn();
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  };

  it('is false when the browser has no share API at all', async () => {
    await withNav({}, () => {
      expect(canShareFiles()).toBe(false);
    });
  });

  it('is false when share exists but canShare does not', async () => {
    await withNav({ share: () => Promise.resolve() }, () => {
      expect(canShareFiles()).toBe(false);
    });
  });

  it('is false when canShare rejects files — the desktop-Safari case', async () => {
    await withNav({ share: () => Promise.resolve(), canShare: () => false }, () => {
      expect(canShareFiles()).toBe(false);
    });
  });

  it('is true only when a real file probe is accepted', async () => {
    await withNav(
      { share: () => Promise.resolve(), canShare: (d: ShareData) => Array.isArray(d.files) && d.files.length > 0 },
      () => {
        expect(canShareFiles()).toBe(true);
      },
    );
  });

  it('is false when canShare throws', async () => {
    await withNav(
      { share: () => Promise.resolve(), canShare: () => { throw new Error('nope'); } },
      () => {
        expect(canShareFiles()).toBe(false);
      },
    );
  });
});

describe('shareFiles', () => {
  const files: CollectedFile[] = [
    { id: 'a', name: 'a.png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
  ];
  const withNav = async (nav: unknown, fn: () => Promise<void>) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    try {
      await fn();
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  };

  it('reports unsupported without calling share', async () => {
    const share = vi.fn();
    await withNav({ share, canShare: () => false }, async () => {
      expect(await shareFiles(files, {})).toBe('unsupported');
      expect(share).not.toHaveBeenCalled();
    });
  });

  it('passes real File objects through', async () => {
    let received: ShareData | null = null;
    await withNav(
      {
        canShare: () => true,
        share: async (d: ShareData) => { received = d; },
      },
      async () => {
        expect(await shareFiles(files, { title: 'Your moments' })).toBe('shared');
      },
    );
    const data = received as unknown as ShareData;
    expect(data.files?.[0]).toBeInstanceOf(File);
    expect(data.files?.[0].name).toBe('a.png');
    expect(data.title).toBe('Your moments');
  });

  it('treats a user cancel as its own outcome, not an error', async () => {
    await withNav(
      {
        canShare: () => true,
        share: async () => {
          const e = new Error('cancelled');
          e.name = 'AbortError';
          throw e;
        },
      },
      async () => {
        expect(await shareFiles(files, {})).toBe('cancelled');
      },
    );
  });

  it('reports a genuine share failure distinctly, so the UI can offer the zip', async () => {
    await withNav(
      { canShare: () => true, share: async () => { throw new Error('boom'); } },
      async () => {
        expect(await shareFiles(files, {})).toBe('failed');
      },
    );
  });
});
