/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/pdf — a one-page, print-ready PDF written by hand (no library):
 * the card's artwork as one 300 dpi JPEG filling the page, and the QR code
 * drawn ON TOP as vector rectangles, so the part a phone has to read stays
 * razor sharp at any size a print shop scales it to.
 *
 * PURE: bytes in, bytes out. The page is the card's trim size exactly.
 */

export interface PdfQr {
  /** Module rectangles in card units, origin top-left: x, y, w, h. */
  rects: { x: number; y: number; w: number; h: number }[];
  /** Module colour, #rrggbb. */
  ink: string;
}

export interface PdfInput {
  /** Trim size in inches. */
  wIn: number;
  hIn: number;
  /** Card units per inch (the plan's coordinate space). */
  unitsPerIn: number;
  jpeg: Uint8Array;
  jpegW: number;
  jpegH: number;
  qr: PdfQr | null;
  title: string;
}

const PT_PER_IN = 72;

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** PDF literal string: ASCII only, with ( ) \ escaped. */
export function pdfString(s: string): string {
  const ascii = s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  return `(${ascii.replace(/[\\()]/g, (m) => `\\${m}`)})`;
}

function rgb(hex: string): string {
  const h = hex.replace('#', '');
  const c = (i: number) => n(parseInt(h.slice(i, i + 2), 16) / 255);
  return `${c(0)} ${c(2)} ${c(4)}`;
}

export function buildPdf(input: PdfInput): Uint8Array {
  const enc = new TextEncoder();
  const W = input.wIn * PT_PER_IN;
  const H = input.hIn * PT_PER_IN;
  const s = PT_PER_IN / input.unitsPerIn;

  let content = `q ${n(W)} 0 0 ${n(H)} 0 0 cm /Im0 Do Q\n`;
  if (input.qr !== null && input.qr.rects.length > 0) {
    content += `${rgb(input.qr.ink)} rg\n`;
    for (const r of input.qr.rects) {
      content += `${n(r.x * s)} ${n(H - (r.y + r.h) * s)} ${n(r.w * s)} ${n(r.h * s)} re\n`;
    }
    content += 'f\n';
  }
  const contentBytes = enc.encode(content);

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array) => { chunks.push(b); pos += b.length; };
  const text = (t: string) => push(enc.encode(t));
  const obj = (id: number, body: () => void) => {
    offsets[id] = pos;
    text(`${id} 0 obj\n`);
    body();
    text('\nendobj\n');
  };

  // Header + a binary comment so transfer tools treat the file as binary.
  text('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  obj(1, () => text('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => text('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => text(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /TrimBox [0 0 ${n(W)} ${n(H)}] ` +
    '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  ));
  obj(4, () => {
    text(`<< /Type /XObject /Subtype /Image /Width ${input.jpegW} /Height ${input.jpegH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${input.jpeg.length} >>\nstream\n`);
    push(input.jpeg);
    text('\nendstream');
  });
  obj(5, () => {
    text(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    text('\nendstream');
  });
  obj(6, () => text(`<< /Title ${pdfString(input.title)} /Producer (Beamwall) /Creator (Beamwall QR cards) >>`));

  const xref = pos;
  let x = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  text(x);

  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
