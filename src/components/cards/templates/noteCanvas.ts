/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * noteCanvas — a written note (or a video's stand-in) drawn onto a canvas,
 * for the 3D templates that need a texture rather than DOM: the Carousel's
 * ring and the Constellation's tiles.
 *
 * Drawn on a canvas, not as an SVG data URL, because an <img> of an SVG
 * cannot reach the page's web fonts — the message would fall back to a
 * system face. Here the display face is awaited (document.fonts.load) and
 * then painted, so a note on the ring reads in the same Bricolage as the
 * rest of the card.
 *
 * Colours come from `readCardPalette(el)`: the live semantic tokens on the
 * element the template renders into, so the event look repaints the notes
 * too. Browser-only (canvas + computed style); never imported by tests.
 */
import { BEAMWALL_CARD_PALETTE } from '../../../lib/cardPresentation';

export interface NotePalette {
  bg: string;
  fg: string;
  accent: string;
  /** "r, g, b" */
  accentRgb: string;
  fontDisplay: string;
  fontText: string;
}

const FALLBACK_DISPLAY = "'Bricolage Grotesque Variable', ui-sans-serif, system-ui, sans-serif";
const FALLBACK_TEXT = "'Geist Variable', ui-sans-serif, system-ui, sans-serif";

/** The live palette at `el` (semantic tokens), each value falling back to Beamwall's. */
export function readCardPalette(el: Element | null): NotePalette {
  const cs = el ? getComputedStyle(el) : null;
  const get = (name: string) => (cs ? cs.getPropertyValue(name).trim() : '');
  const rgb = get('--accent-rgb');
  return {
    bg: get('--color-brand-bg') || BEAMWALL_CARD_PALETTE.bg,
    fg: get('--color-brand-fg') || BEAMWALL_CARD_PALETTE.fg,
    accent: get('--color-accent') || BEAMWALL_CARD_PALETTE.accent,
    accentRgb: /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(rgb) ? rgb : BEAMWALL_CARD_PALETTE.accentRgb,
    fontDisplay: get('--font-serif') || FALLBACK_DISPLAY,
    fontText: get('--font-sans') || FALLBACK_TEXT,
  };
}

export interface NoteSpec {
  kind: 'text' | 'video';
  message: string | null;
  name: string | null;
  durationSeconds?: number | null;
}

/** Greedy word wrap at `maxWidth`; returns lines (words longer than a line are kept whole). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line === '' ? w : `${line} ${w}`;
    if (ctx.measureText(next).width <= maxWidth || line === '') line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Paint a note: a deep field with a soft accent glow, a frosted paper card
 * with a lit rim and faint rules, a glowing quote mark, the message in the
 * display face (shrunk to fit), and the signature. A video stand-in gets a
 * glowing play disc instead of a quote and message.
 */
export function drawNote(spec: NoteSpec, palette: NotePalette, width = 540, height = 720): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  const W = width;
  const H = height;
  const a = palette.accentRgb;

  // Field + glow.
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, H * 0.38, 0, W * 0.5, H * 0.38, H * 0.7);
  glow.addColorStop(0, `rgba(${a},0.42)`);
  glow.addColorStop(1, `rgba(${a},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Frosted paper.
  const m = W * 0.07;
  roundRect(ctx, m, m, W - 2 * m, H - 2 * m, W * 0.06);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  for (let y = m + H * 0.12; y < H - m; y += H * 0.055) {
    ctx.beginPath();
    ctx.moveTo(m, y);
    ctx.lineTo(W - m, y);
    ctx.stroke();
  }
  ctx.restore();
  roundRect(ctx, m, m, W - 2 * m, H - 2 * m, W * 0.06);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Inner hairline: the letterpress double rule.
  roundRect(ctx, m + 12, m + 12, W - 2 * m - 24, H - 2 * m - 24, W * 0.045);
  ctx.strokeStyle = `rgba(${a},0.35)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const name = (spec.name ?? '').trim() || 'A friend';

  if (spec.kind === 'video') {
    const cx = W / 2;
    const cy = H * 0.44;
    const r = W * 0.13;
    const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.4);
    halo.addColorStop(0, `rgba(${a},0.75)`);
    halo.addColorStop(1, `rgba(${a},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 2.5, cy - r * 2.5, r * 5, r * 5);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.3, cy - r * 0.45);
    ctx.lineTo(cx + r * 0.5, cy);
    ctx.lineTo(cx - r * 0.3, cy + r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = palette.fg;
    ctx.font = `600 ${Math.round(W * 0.07)}px ${palette.fontDisplay}`;
    ctx.fillText('Video message', W / 2, H * 0.66);
    ctx.globalAlpha = 0.75;
    ctx.font = `400 ${Math.round(W * 0.05)}px ${palette.fontText}`;
    ctx.fillText(`from ${name}`, W / 2, H * 0.73);
    ctx.globalAlpha = 1;
    return canvas;
  }

  // Quote mark.
  ctx.save();
  ctx.shadowColor = `rgba(${a},0.9)`;
  ctx.shadowBlur = 24;
  ctx.fillStyle = palette.accent;
  ctx.font = `600 ${Math.round(W * 0.2)}px ${palette.fontDisplay}`;
  ctx.fillText('“', W / 2, m + H * 0.17);
  ctx.restore();

  // Message, shrunk until it fits the paper.
  const msg = (spec.message ?? '').replace(/\s+/g, ' ').trim();
  const maxW = W - 2 * m - W * 0.14;
  const top = m + H * 0.22;
  const bottom = H - m - H * 0.16;
  let size = Math.round(W * 0.085);
  let lines: string[] = [];
  for (; size >= 18; size -= 2) {
    ctx.font = `600 ${size}px ${palette.fontDisplay}`;
    lines = wrap(ctx, msg, maxW);
    if (lines.length * size * 1.25 <= bottom - top) break;
  }
  ctx.fillStyle = palette.fg;
  const lh = size * 1.25;
  const blockH = lines.length * lh;
  let y = top + Math.max(0, (bottom - top - blockH) / 2) + size;
  for (const line of lines) {
    ctx.fillText(line, W / 2, y);
    y += lh;
  }

  // Signature.
  ctx.globalAlpha = 0.85;
  ctx.font = `500 ${Math.round(W * 0.05)}px ${palette.fontDisplay}`;
  ctx.fillText(`— ${name}`, W / 2, H - m - H * 0.07);
  ctx.globalAlpha = 1;
  return canvas;
}

/** Wait (briefly) for the display face so the note is painted in it. */
export async function fontsReady(palette: NotePalette): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`600 40px ${palette.fontDisplay}`),
        document.fonts.load(`400 20px ${palette.fontText}`),
      ]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    // A font that will not load is not worth a missing note: paint anyway.
  }
}
