/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * qrCards/qrMatrix — the code as a grid of modules, and as horizontal runs
 * (one rectangle per run of dark modules), which is what both the canvas and
 * the PDF draw. Runs keep the PDF small and leave no hairline seams between
 * neighbouring modules when a viewer anti-aliases.
 *
 * Error correction Q (25% recoverable): a printed card gets scuffed, folded
 * and photographed at an angle.
 */
import { create } from 'qrcode/lib/core/qrcode';

export interface QrMatrix { size: number; dark: (row: number, col: number) => boolean }

export function qrMatrix(text: string): QrMatrix {
  const { modules } = create(text, { errorCorrectionLevel: 'Q' });
  return { size: modules.size, dark: (r, c) => modules.data[r * modules.size + c] === 1 };
}

export interface QrRun { row: number; col: number; len: number }

export function qrRuns(m: QrMatrix): QrRun[] {
  const out: QrRun[] = [];
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark(r, c)) { c++; continue; }
      const start = c;
      while (c < m.size && m.dark(r, c)) c++;
      out.push({ row: r, col: start, len: c - start });
    }
  }
  return out;
}

/** Quiet zone, in modules, kept clear inside the white tile. */
export const QUIET_MODULES = 3;

/** The module size and the grid's origin inside a tile of side `tile`. */
export function moduleGeometry(tile: { x: number; y: number; w: number }, size: number): { mod: number; x0: number; y0: number } {
  const mod = tile.w / (size + 2 * QUIET_MODULES);
  return { mod, x0: tile.x + QUIET_MODULES * mod, y0: tile.y + QUIET_MODULES * mod };
}
