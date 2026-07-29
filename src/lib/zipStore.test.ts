/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * These tests assert the ZIP byte layout field by field, because a hand-rolled
 * binary container that is *almost* right produces an archive every extractor
 * rejects — and the guest would only find out the morning after the event.
 * The archive is also validated end-to-end by Python's `zipfile` outside the
 * suite (see the wave report); this file is the fast regression net.
 */
import { describe, it, expect } from 'vitest';
import {
  crc32,
  buildZip,
  zipBlob,
  zipSafeName,
  uniqueNames,
  dosDateTime,
  ZipLimitError,
} from './zipStore';

const enc = new TextEncoder();
const u8 = (s: string) => enc.encode(s);

function u16At(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}
function u32At(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

describe('crc32', () => {
  it('matches the published IEEE check value for "123456789"', () => {
    expect(crc32(u8('123456789'))).toBe(0xcbf43926);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('matches the classic pangram vector', () => {
    expect(crc32(u8('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('handles bytes above 0x7f without sign extension', () => {
    // A `>> 1` instead of `>>> 1` in the table build corrupts exactly here.
    expect(crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBe(0xffffffff);
    expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d);
  });

  it('returns an unsigned 32-bit value', () => {
    const v = crc32(u8('beamwall'));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('dosDateTime', () => {
  it('packs a known date', () => {
    const { time, date } = dosDateTime(new Date(2026, 6, 29, 13, 45, 20));
    // date = ((2026-1980) << 9) | (7 << 5) | 29
    expect(date).toBe((46 << 9) | (7 << 5) | 29);
    // time = (13 << 11) | (45 << 5) | (20 / 2)
    expect(time).toBe((13 << 11) | (45 << 5) | 10);
  });

  it('clamps years before the 1980 DOS epoch instead of going negative', () => {
    const { date } = dosDateTime(new Date(1970, 0, 1));
    expect(date).toBe((0 << 9) | (1 << 5) | 1);
    expect(date).toBeGreaterThan(0);
  });

  it('keeps both fields inside 16 bits', () => {
    const { time, date } = dosDateTime(new Date(2099, 11, 31, 23, 59, 59));
    expect(time).toBeLessThanOrEqual(0xffff);
    expect(date).toBeLessThanOrEqual(0xffff);
  });
});

describe('zipSafeName', () => {
  it('strips path separators so an entry cannot escape the archive', () => {
    const out = zipSafeName('../../etc/passwd');
    expect(out).toBe('etc-passwd');
    // The properties that actually matter, asserted directly rather than
    // inferred from the string above.
    expect(out).not.toContain('/');
    expect(out).not.toContain('\\');
    expect(out.startsWith('.')).toBe(false);
    expect(zipSafeName('a\\b')).toBe('a-b');
    expect(zipSafeName('..\\..\\windows\\system32')).toBe('windows-system32');
  });

  it('removes control characters', () => {
    expect(zipSafeName('go\u0007od\u0000name')).toBe('goodname');
  });
  it('replaces the Windows-reserved set', () => {
    expect(zipSafeName('a:b*c?d"e<f>g|h')).toBe('a-b-c-d-e-f-g-h');
  });

  it('falls back when nothing survives', () => {
    expect(zipSafeName('...', 'moment')).toBe('moment');
    expect(zipSafeName('')).toBe('file');
  });

  it('caps runaway names', () => {
    expect(zipSafeName('x'.repeat(400)).length).toBe(120);
  });
});

describe('uniqueNames', () => {
  it('leaves distinct names alone', () => {
    expect(uniqueNames(['a.jpg', 'b.jpg'])).toEqual(['a.jpg', 'b.jpg']);
  });

  it('suffixes duplicates before the extension', () => {
    expect(uniqueNames(['a.jpg', 'a.jpg', 'a.jpg'])).toEqual(['a.jpg', 'a (2).jpg', 'a (3).jpg']);
  });

  it('is case-insensitive, because macOS and Windows filesystems are', () => {
    expect(uniqueNames(['A.jpg', 'a.jpg'])).toEqual(['A.jpg', 'a (2).jpg']);
  });

  it('handles extensionless names', () => {
    expect(uniqueNames(['moment', 'moment'])).toEqual(['moment', 'moment (2)']);
  });

  it('does not treat a leading dot as an extension', () => {
    expect(uniqueNames(['.hidden', '.hidden'])).toEqual(['.hidden', '.hidden (2)']);
  });
});

describe('buildZip byte layout', () => {
  const data = u8('hello beamwall');
  const zip = buildZip([{ name: 'one.txt', data, date: new Date(2026, 6, 29, 12, 0, 0) }]);

  it('starts with the local file header signature', () => {
    expect(u32At(zip, 0)).toBe(0x04034b50);
  });

  it('declares STORE, version 20 and the UTF-8 flag', () => {
    expect(u16At(zip, 4)).toBe(20); // version needed
    expect(u16At(zip, 6)).toBe(0x0800); // general purpose flag: UTF-8 names
    expect(u16At(zip, 8)).toBe(0); // method 0 = stored
  });

  it('writes the real CRC and both sizes', () => {
    expect(u32At(zip, 14)).toBe(crc32(data));
    expect(u32At(zip, 18)).toBe(data.length); // compressed
    expect(u32At(zip, 22)).toBe(data.length); // uncompressed
  });

  it('writes the name length, no extra field, then the name and raw data', () => {
    expect(u16At(zip, 26)).toBe('one.txt'.length);
    expect(u16At(zip, 28)).toBe(0);
    expect(new TextDecoder().decode(zip.slice(30, 37))).toBe('one.txt');
    expect(zip.slice(37, 37 + data.length)).toEqual(data);
  });

  it('is exactly local + central + EOCD bytes long', () => {
    // 30 + name + data | 46 + name | 22
    expect(zip.length).toBe(30 + 7 + data.length + 46 + 7 + 22);
  });

  it('ends with an EOCD naming one entry and pointing at the central directory', () => {
    const eocd = zip.length - 22;
    expect(u32At(zip, eocd)).toBe(0x06054b50);
    expect(u16At(zip, eocd + 8)).toBe(1); // entries on this disk
    expect(u16At(zip, eocd + 10)).toBe(1); // total entries
    const cdSize = u32At(zip, eocd + 12);
    const cdOffset = u32At(zip, eocd + 16);
    expect(cdSize).toBe(46 + 7);
    expect(cdOffset).toBe(30 + 7 + data.length);
    expect(u32At(zip, cdOffset)).toBe(0x02014b50);
    expect(cdOffset + cdSize).toBe(eocd);
  });

  it('points the central directory entry at its own local header', () => {
    const eocd = zip.length - 22;
    const cdOffset = u32At(zip, eocd + 16);
    expect(u32At(zip, cdOffset + 42)).toBe(0); // relative offset of local header
    expect(u32At(zip, cdOffset + 16)).toBe(crc32(data)); // same CRC in both places
  });
});

describe('buildZip with several files', () => {
  const entries = [
    { name: 'a.bin', data: new Uint8Array([1, 2, 3]) },
    { name: 'b.bin', data: new Uint8Array(0) },
    { name: 'ünïcode ✨.txt', data: u8('accented') },
  ];
  const zip = buildZip(entries);

  it('records every entry once in the central directory', () => {
    const eocd = zip.length - 22;
    expect(u16At(zip, eocd + 10)).toBe(3);
  });

  it('gives each entry a local header offset that actually holds one', () => {
    const eocd = zip.length - 22;
    let cd = u32At(zip, eocd + 16);
    for (let i = 0; i < 3; i++) {
      const nameLen = u16At(zip, cd + 28);
      const localOffset = u32At(zip, cd + 42);
      expect(u32At(zip, localOffset)).toBe(0x04034b50);
      cd += 46 + nameLen;
    }
    expect(cd).toBe(eocd);
  });

  it('handles a zero-byte entry without corrupting the following one', () => {
    const eocd = zip.length - 22;
    let cd = u32At(zip, eocd + 16);
    cd += 46 + u16At(zip, cd + 28); // skip a.bin
    expect(u32At(zip, cd + 20)).toBe(0); // b.bin compressed size
    expect(u32At(zip, cd + 16)).toBe(0); // CRC of nothing is 0
  });

  it('stores multi-byte names as UTF-8 with the correct byte length', () => {
    const utf8Len = new TextEncoder().encode('ünïcode ✨.txt').length;
    expect(utf8Len).toBeGreaterThan('ünïcode ✨.txt'.length);
    const eocd = zip.length - 22;
    let cd = u32At(zip, eocd + 16);
    cd += 46 + u16At(zip, cd + 28);
    cd += 46 + u16At(zip, cd + 28);
    expect(u16At(zip, cd + 28)).toBe(utf8Len);
  });

  it('produces an empty but well-formed archive for no entries', () => {
    const empty = buildZip([]);
    expect(empty.length).toBe(22);
    expect(u32At(empty, 0)).toBe(0x06054b50);
    expect(u16At(empty, 10)).toBe(0);
  });
});

describe('buildZip limits', () => {
  it('refuses more entries than the 16-bit count field can hold', () => {
    // Only `.length` is read before the guard throws, so an array-like is
    // enough — allocating 65536 real entries would prove nothing extra.
    expect(() => buildZip({ length: 0x10000 } as never)).toThrow(ZipLimitError);
  });

  it('names the limit it hit, so the UI can say something true', () => {
    try {
      buildZip([{ name: 'x'.repeat(70000), data: new Uint8Array(0) }]);
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ZipLimitError);
      expect((e as Error).message).toContain('name too long');
    }
  });
});

describe('zipBlob', () => {
  it('returns a zip-typed Blob of the same length as the bytes', async () => {
    const entries = [{ name: 'a.txt', data: u8('abc') }];
    const blob = zipBlob(entries);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBe(buildZip(entries).length);
    const round = new Uint8Array(await blob.arrayBuffer());
    expect(u32At(round, 0)).toBe(0x04034b50);
  });
});
