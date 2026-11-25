import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyTarget,
  applyTemplate,
  cardSize,
  contrastRatio,
  defaultDesign,
  exportFileName,
  formatCardDate,
  normalizeDesign,
  normalizeLink,
  QR_OCCASIONS,
  QR_SIZES,
  QR_TEMPLATES,
  targetUrl,
  TARGET_INFO,
  templateById,
  type QrCardDesign,
} from './model';
import { fitText, MIN_QR_IN, planCard, planImages, type CardOp, type Measure, type Rect } from './layout';
import { qrMatrix, qrRuns } from './qrMatrix';
import { buildPdf, pdfString } from './pdf';

/** A stand-in for canvas measureText: proportional, a little wider in capitals. */
const measure: Measure = (text, _font, size) => {
  let w = 0;
  for (const ch of text) w += ch === ' ' ? 0.28 : /[A-Z]/.test(ch) ? 0.68 : 0.52;
  return w * size;
};

const EVENT = { name: 'Adaeze & Tunde', date: '2026-07-12' };
const URL_ = 'https://beamwall.app/e/ada-tunde/welcome';

const inside = (r: Rect, W: number, H: number) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= W + 0.01 && r.y + r.h <= H + 0.01;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const textRect = (op: Extract<CardOp, { kind: 'text' }>): Rect => ({ x: op.x, y: op.y, w: op.w, h: op.lines.length * op.size * op.lineHeight });

describe('template library', () => {
  it('has unique ids and at least two looks for every major occasion', () => {
    const ids = QR_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of ['wedding', 'birthday', 'anniversary', 'retirement', 'corporate', 'launch', 'christmas', 'halloween', 'graduation'] as const) {
      expect(QR_TEMPLATES.filter((t) => t.occasion === o).length, o).toBeGreaterThanOrEqual(2);
    }
    for (const t of QR_TEMPLATES) expect(QR_OCCASIONS).toContain(t.occasion);
  });

  it('ships the art every template paints', () => {
    for (const t of QR_TEMPLATES) {
      if (t.layout === 'glow') { expect(t.art).toBeNull(); continue; }
      expect(t.art, t.id).not.toBeNull();
      expect(existsSync(join(process.cwd(), 'public', t.art as string)), `${t.id} → ${t.art}`).toBe(true);
    }
    expect(existsSync(join(process.cwd(), 'public/mascot/beamy-greet.webp'))).toBe(true);
  });

  it('prints every code dark-on-light with scanner-safe contrast', () => {
    for (const t of QR_TEMPLATES) {
      expect(contrastRatio(t.palette.qrInk, t.palette.qrTile), t.id).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('design model', () => {
  it('starts from the event and the welcome link', () => {
    const d = defaultDesign(EVENT);
    expect(d.copy.names).toBe('Adaeze & Tunde');
    expect(d.copy.date).toMatch(/12 July 2026/);
    expect(d.target).toBe('welcome');
    expect(d.copy.message).toBe(TARGET_INFO.welcome.message);
  });

  it('formats dates without shifting a day across time zones', () => {
    expect(formatCardDate('2026-07-12')).toMatch(/Sunday.*12 July 2026/);
    expect(formatCardDate('2026-07-12T23:30:00-05:00')).toMatch(/12 July 2026/);
    expect(formatCardDate('')).toBe('');
    expect(formatCardDate(null)).toBe('');
    expect(formatCardDate('soon')).toBe('');
  });

  it('normalizes anything stored back into a valid design', () => {
    expect(normalizeDesign(null, EVENT)).toEqual(defaultDesign(EVENT));
    expect(normalizeDesign('junk', EVENT)).toEqual(defaultDesign(EVENT));
    const d = normalizeDesign({ templateId: 'nope', orientation: 'sideways', size: '9x9', accent: 'red', target: 'moon', copy: { headline: 42, names: 'x'.repeat(500) } }, EVENT);
    expect(d.templateId).toBe(QR_TEMPLATES[0].id);
    expect(d.orientation).toBe('portrait');
    expect(d.size).toBe('5x7');
    expect(d.accent).toBeNull();
    expect(d.target).toBe('welcome');
    expect(d.copy.headline).toBe(QR_TEMPLATES[0].copy.headline);
    expect(d.copy.names.length).toBe(60);
    const round = normalizeDesign(JSON.parse(JSON.stringify({ ...defaultDesign(EVENT, 'pumpkin-moon'), accent: '#ABCDEF', orientation: 'landscape' })), EVENT);
    expect(round.templateId).toBe('pumpkin-moon');
    expect(round.accent).toBe('#ABCDEF');
    expect(round.orientation).toBe('landscape');
  });

  it('keeps words the host wrote when the template changes', () => {
    const d = defaultDesign(EVENT, 'garden-vows');
    const swapped = applyTemplate(d, 'pumpkin-moon');
    expect(swapped.copy.headline).toBe(templateById('pumpkin-moon').copy.headline);
    const own = applyTemplate({ ...d, copy: { ...d.copy, headline: 'Our day' } }, 'pumpkin-moon');
    expect(own.copy.headline).toBe('Our day');
    expect(own.copy.kicker).toBe(templateById('pumpkin-moon').copy.kicker);
  });

  it('swaps the message with the link only while it is still the default', () => {
    const d = defaultDesign(EVENT);
    expect(applyTarget(d, 'upload').copy.message).toBe(TARGET_INFO.upload.message);
    const own: QrCardDesign = { ...d, copy: { ...d.copy, message: 'Mine' } };
    expect(applyTarget(own, 'upload').copy.message).toBe('Mine');
  });

  it('only encodes real web links', () => {
    expect(normalizeLink('beamwall.app/e/x')).toBe('https://beamwall.app/e/x');
    expect(normalizeLink(' https://a.co ')).toBe('https://a.co/');
    expect(normalizeLink('javascript:alert(1)')).toBeNull();
    expect(normalizeLink('localhost')).toBeNull();
    expect(normalizeLink('')).toBeNull();
    expect(targetUrl('booth', 'https://beamwall.app/e/x/', '')).toBe('https://beamwall.app/e/x/booth');
    expect(targetUrl('custom', 'https://beamwall.app/e/x', 'rsvp.example.com')).toBe('https://rsvp.example.com/');
    expect(targetUrl('welcome', null, '')).toBeNull();
  });

  it('names downloads after the couple, size and orientation', () => {
    expect(exportFileName(defaultDesign(EVENT), 'pdf')).toBe('adaeze-tunde-qr-card-5x7-portrait.pdf');
    expect(exportFileName({ ...defaultDesign(null), copy: { ...defaultDesign(null).copy, names: '', headline: '' } }, 'png')).toBe('beamwall-qr-card-5x7-portrait.png');
  });
});

describe('fitText', () => {
  const font = { family: 'X', weight: 400, style: 'normal' as const };
  it('shrinks until the text fits its lines', () => {
    const f = fitText('A rather long headline for a small card', font, 40, 20, 2, 300, measure);
    expect(f.lines.length).toBeLessThanOrEqual(2);
    expect(f.size).toBeLessThanOrEqual(40);
    for (const l of f.lines) expect(measure(l, font, f.size)).toBeLessThanOrEqual(300.01);
  });
  it('cuts with an ellipsis instead of overflowing at the floor size', () => {
    const f = fitText('word '.repeat(80), font, 20, 18, 2, 200, measure);
    expect(f.lines.length).toBe(2);
    expect(f.lines[1].endsWith('…')).toBe(true);
    for (const l of f.lines) expect(measure(l, font, f.size)).toBeLessThanOrEqual(200.01);
  });
  it('returns nothing for empty text', () => {
    expect(fitText('   ', font, 20, 10, 2, 100, measure).lines).toEqual([]);
  });
});

describe('planCard (every template × orientation × size)', () => {
  const longCopy = {
    kicker: 'You are warmly invited to scan',
    headline: 'Share every photo from our wonderful celebration',
    names: 'Oluwadamilola & Christopher-Alexander',
    date: 'Saturday 12 September 2026',
    message: 'Scan the code with your phone camera to open the photo booth, try the looks, and send your favourite shots to the big screen.',
    footer: '#DamiAndChrisForever2026',
  };
  for (const t of QR_TEMPLATES) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (const size of QR_SIZES.map((s) => s.id)) {
        for (const copy of ['default', 'long'] as const) {
          it(`${t.id} ${orientation} ${size} ${copy}`, () => {
            const base = { ...defaultDesign(EVENT, t.id), orientation, size };
            const d = copy === 'long' ? { ...base, copy: longCopy } : base;
            const plan = planCard(d, t, URL_, measure);
            const { w: W, h: H } = cardSize(size, orientation);
            expect(plan.w).toBe(W);
            expect(plan.h).toBe(H);
            // The code: square, big enough, on the card, painted once.
            expect(plan.qr.w).toBeCloseTo(plan.qr.h, 5);
            expect(plan.qr.w).toBeGreaterThanOrEqual(MIN_QR_IN * 100 - 0.01);
            expect(inside(plan.qr, W, H)).toBe(true);
            expect(plan.ops.filter((o) => o.kind === 'qr')).toHaveLength(1);
            for (const op of plan.ops) {
              if (op.kind === 'text') {
                const r = textRect(op);
                expect(inside(r, W, H), `${op.role} leaves the card`).toBe(true);
                expect(overlap(r, plan.qr), `${op.role} covers the code`).toBe(false);
                for (const l of op.lines) expect(measure(l.toUpperCase() === l ? l : l, op.font, op.size)).toBeLessThanOrEqual(op.w * 1.5);
              }
              if (op.kind === 'image') expect(overlap(op.rect, plan.qr), 'Beamy covers the code').toBe(false);
            }
            // Text blocks never overlap each other.
            const texts = plan.ops.filter((o): o is Extract<CardOp, { kind: 'text' }> => o.kind === 'text').map(textRect);
            for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
              expect(overlap(texts[i], texts[j]), `text ${i} overlaps text ${j}`).toBe(false);
            }
            if (t.art !== null) expect(planImages(plan)).toContain(t.art);
          });
        }
      }
    }
  }
});

describe('qrMatrix', () => {
  it('encodes with finder patterns in three corners', () => {
    const m = qrMatrix(URL_);
    expect(m.size).toBeGreaterThanOrEqual(21);
    const finder = (r0: number, c0: number) => {
      for (let i = 0; i < 7; i++) {
        expect(m.dark(r0, c0 + i)).toBe(true);
        expect(m.dark(r0 + 6, c0 + i)).toBe(true);
        expect(m.dark(r0 + i, c0)).toBe(true);
        expect(m.dark(r0 + i, c0 + 6)).toBe(true);
      }
      expect(m.dark(r0 + 1, c0 + 1)).toBe(false);
      expect(m.dark(r0 + 3, c0 + 3)).toBe(true);
    };
    finder(0, 0);
    finder(0, m.size - 7);
    finder(m.size - 7, 0);
  });
  it('runs cover exactly the dark modules', () => {
    const m = qrMatrix('https://beamwall.app');
    let dark = 0;
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.dark(r, c)) dark++;
    expect(qrRuns(m).reduce((s, x) => s + x.len, 0)).toBe(dark);
  });
});

describe('buildPdf', () => {
  it('writes a well-formed single page with a correct xref', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const bytes = buildPdf({ wIn: 5, hIn: 7, unitsPerIn: 100, jpeg, jpegW: 1500, jpegH: 2100, qr: { ink: '#14121C', rects: [{ x: 100, y: 100, w: 10, h: 10 }] }, title: 'Ada & Tunde (QR) — card' });
    const latin = new TextDecoder('latin1').decode(bytes);
    expect(latin.startsWith('%PDF-1.4')).toBe(true);
    expect(latin.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(latin).toContain('/MediaBox [0 0 360 504]');
    expect(latin).toContain('/Width 1500 /Height 2100');
    // Vector module: x 100u = 72pt, y flipped: 504 - (110 * 0.72) = 424.8
    expect(latin).toContain('72 424.8 7.2 7.2 re');
    const startxref = Number(/startxref\n(\d+)/.exec(latin)?.[1]);
    expect(latin.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...latin.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(6);
    entries.forEach((off, i) => expect(latin.slice(off, off + 7)).toBe(`${i + 1} 0 obj`));
  });
  it('escapes and strips the title', () => {
    expect(pdfString('A (b) \\ c — é')).toBe('(A \\(b\\) \\\\ c  e)');
  });
});

describe('withPngDpi', () => {
  it('inserts a valid pHYs chunk after IHDR', async () => {
    const { withPngDpi, crc32 } = await import('./png');
    const sharp = (await import('sharp')).default;
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer());
    const out = withPngDpi(png, 300);
    const meta = await sharp(Buffer.from(out)).metadata();
    expect(meta.density).toBe(300);
    expect(meta.width).toBe(4);
    // Idempotent: stamping twice leaves exactly one pHYs.
    const twice = withPngDpi(out, 300);
    expect(twice.length).toBe(out.length);
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    expect(withPngDpi(new Uint8Array([1, 2, 3]), 300)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
