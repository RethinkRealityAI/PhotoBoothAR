/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A minimal ZIP writer, STORE method only, with zero dependencies.
 *
 * Why this exists: "Download all" on /me used to fire one synthetic anchor
 * click per photo, 600 ms apart. Mobile Safari permits exactly one
 * programmatic download per user gesture and silently drops the rest, so the
 * guest got their first photo and a spinner that never finished. One file is
 * the only shape of bulk download a phone browser reliably accepts, and one
 * file means an archive.
 *
 * STORE (no compression) rather than DEFLATE, for two reasons:
 *   1. JPEG, PNG and WebM are already entropy-coded. Deflating them costs CPU
 *      on a phone and typically GROWS the payload by the deflate block headers.
 *   2. STORE needs no compressor, so this file stays ~150 lines of byte
 *      layout instead of pulling in a dependency the project forbids.
 *
 * Format (PKWARE APPNOTE 6.3.x, the classic non-ZIP64 subset):
 *   [local file header + name + data] × n
 *   [central directory header + name] × n
 *   [end of central directory record]
 * Every multi-byte field is little-endian.
 *
 * ZIP64 is deliberately NOT implemented. Instead `buildZip` throws
 * `ZipLimitError` the moment a size, offset or count would overflow its
 * 32/16-bit field, so an archive that cannot be represented is refused loudly
 * rather than written subtly corrupt. Callers degrade to per-file saving.
 */

/** Thrown when the archive would exceed the classic (non-ZIP64) limits. */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

export interface ZipEntry {
  /** Path inside the archive. Sanitise with `zipSafeName` first. */
  name: string;
  data: Uint8Array;
  /** Modification time stamped into the entry. Defaults to now. */
  date?: Date;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Version 2.0 — the minimum that understands the UTF-8 general-purpose flag. */
const VERSION = 20;
/** Bit 11: filenames are UTF-8, not CP437. Every modern extractor honours it. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;

const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, the polynomial ZIP mandates)
// ---------------------------------------------------------------------------

/**
 * Reversed-polynomial table for 0xEDB88320. Built once, lazily — a guest who
 * never presses "save all" should not pay for 1 KB of table on page load.
 */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      // `>>> 1` is mandatory: `>> 1` sign-extends and corrupts the high bit.
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 of a byte range, as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * A filename safe to put in an archive and to write to a real filesystem.
 *
 * Strips path separators (a `../` in an entry name is the classic zip-slip),
 * control characters and the Windows-reserved set, collapses whitespace, and
 * caps the length so long guest captions cannot produce an unopenable entry.
 */
export function zipSafeName(name: string, fallback = 'file'): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    // Collapse dot runs: with the separators already replaced `../../x` cannot
    // traverse, but a name still full of `..` looks like an attack to some
    // extractors and gets rejected outright.
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\-\s]+/, '')
    .slice(0, 120)
    .trim();
  return cleaned || fallback;
}

/**
 * Make every name unique by suffixing ` (2)`, ` (3)` … before the extension.
 *
 * Two captures a guest took a second apart can produce the same base name, and
 * a ZIP with duplicate entries extracts to a single overwritten file on most
 * tools — the guest would silently lose a photo.
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const key = raw.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return raw;
    const dot = raw.lastIndexOf('.');
    const stem = dot > 0 ? raw.slice(0, dot) : raw;
    const ext = dot > 0 ? raw.slice(dot) : '';
    return `${stem} (${n + 1})${ext}`;
  });
}

// ---------------------------------------------------------------------------
// DOS date/time
// ---------------------------------------------------------------------------

/**
 * MS-DOS packed time/date, the only timestamp the base ZIP record carries.
 *
 * Two-second resolution and a 1980 epoch are the format's, not ours — a date
 * before 1980 cannot be represented, so it clamps rather than writing a
 * negative year that would render as garbage in Finder.
 */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Assemble entries into a complete ZIP archive.
 *
 * The output is a single contiguous Uint8Array — the whole archive is held in
 * memory, which is the right trade for a keepsake gallery (tens of megabytes)
 * and the reason `ZipLimitError` exists for anything larger.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length > U16_MAX) {
    throw new ZipLimitError(`too many files for a ZIP (${entries.length} > ${U16_MAX})`);
  }

  const encoder = new TextEncoder();
  const prepared = entries.map((e) => {
    const nameBytes = encoder.encode(e.name);
    if (nameBytes.length > U16_MAX) {
      throw new ZipLimitError(`file name too long: ${e.name.slice(0, 40)}…`);
    }
    if (e.data.length > U32_MAX) {
      throw new ZipLimitError(`file too large for a ZIP: ${e.name}`);
    }
    return {
      nameBytes,
      data: e.data,
      crc: crc32(e.data),
      ...dosDateTime(e.date ?? new Date()),
    };
  });

  // Size the buffer exactly, so there is no copy at the end.
  let localSize = 0;
  let centralSize = 0;
  for (const p of prepared) {
    localSize += 30 + p.nameBytes.length + p.data.length;
    centralSize += 46 + p.nameBytes.length;
  }
  const total = localSize + centralSize + 22;
  if (total > U32_MAX) {
    throw new ZipLimitError('archive would exceed 4 GB (ZIP64 is not implemented)');
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;

  const u16 = (v: number) => { view.setUint16(off, v, true); off += 2; };
  const u32 = (v: number) => { view.setUint32(off, v >>> 0, true); off += 4; };
  const bytes = (b: Uint8Array) => { out.set(b, off); off += b.length; };

  // ── Local file headers + data ──
  const offsets: number[] = [];
  for (const p of prepared) {
    offsets.push(off);
    u32(LOCAL_SIG);
    u16(VERSION);
    u16(FLAG_UTF8);
    u16(METHOD_STORE);
    u16(p.time);
    u16(p.date);
    u32(p.crc);
    u32(p.data.length); // compressed == uncompressed under STORE
    u32(p.data.length);
    u16(p.nameBytes.length);
    u16(0); // extra field length
    bytes(p.nameBytes);
    bytes(p.data);
  }

  // ── Central directory ──
  const centralStart = off;
  prepared.forEach((p, i) => {
    u32(CENTRAL_SIG);
    u16(VERSION); // version made by
    u16(VERSION); // version needed to extract
    u16(FLAG_UTF8);
    u16(METHOD_STORE);
    u16(p.time);
    u16(p.date);
    u32(p.crc);
    u32(p.data.length);
    u32(p.data.length);
    u16(p.nameBytes.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    bytes(p.nameBytes);
  });

  // ── End of central directory ──
  // Capture the directory's size BEFORE writing the EOCD: `off` is a running
  // cursor, and reading it inside the record would include the EOCD's own
  // bytes, making the directory look 12 bytes longer than it is.
  const writtenCentralSize = off - centralStart;
  u32(EOCD_SIG);
  u16(0); // this disk
  u16(0); // disk with the central directory
  u16(prepared.length);
  u16(prepared.length);
  u32(writtenCentralSize);
  u32(centralStart);
  u16(0); // comment length

  return out;
}

/** Convenience: a ready-to-download Blob with the correct MIME type. */
export function zipBlob(entries: ZipEntry[]): Blob {
  const bytes = buildZip(entries);
  // `bytes.buffer` is exactly this array's storage (buildZip allocates it),
  // so passing the view is safe and avoids a second full-size copy.
  return new Blob([bytes], { type: 'application/zip' });
}
