/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The keepsake collage — every photo from a night stitched into one image the
 * guest can save, entirely in their own browser.
 *
 * WHY IT IS CLIENT-SIDE. A server render would be the obvious build, and it is
 * the wrong one: a recap link is handed to every guest at an event, so the cost
 * of the beautiful thing would scale with the guest list rather than with the
 * sale. Everything here runs on the device that asked for it, so a thousand
 * downloads cost exactly nothing and need no provider, no credits and no queue.
 *
 * THE SPLIT, which is the same one `photoStrip.ts` already makes: this file is
 * layout arithmetic — where each print goes, how far it is turned, where the
 * name plate sits — and it is pure, so every number is checked in the node-env
 * suite. The imperative half at the bottom (`loadCollageImage`, `paintCollage`,
 * `collagePngBlob`) owns the canvas and nothing else.
 *
 * NO RANDOMNESS. The scatter template turns and nudges each print, but every
 * value comes from a hash of the post's own id, so the same album always
 * produces the same collage — a guest who downloads it twice gets the same
 * picture, and the tests can assert exact coordinates.
 */
import { hexToRgba } from './photoStrip';
import { coverRect } from './montage';

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export type CollageTemplate = 'mosaic' | 'filmstrip' | 'scatter';

/** Offer order in the picker. */
export const COLLAGE_TEMPLATES: readonly CollageTemplate[] = ['mosaic', 'filmstrip', 'scatter'];

export const COLLAGE_LABELS: Record<CollageTemplate, string> = {
  mosaic: 'Mosaic',
  filmstrip: 'Filmstrip',
  scatter: 'Scatter',
};

/** One line each, in the guest's terms — the picker shows these under the name. */
export const COLLAGE_BLURBS: Record<CollageTemplate, string> = {
  mosaic: 'Every moment, edge to edge.',
  filmstrip: 'Angled strips, like contact sheets.',
  scatter: 'Prints tossed across the table.',
};

/**
 * How many photos each template can carry before it stops being a keepsake and
 * starts being a contact sheet. The mosaic reads fine denser than the other two
 * because its cells are a grid; a scatter of sixteen turned prints is mush.
 */
export function collageCapacity(template: CollageTemplate): number {
  return template === 'mosaic' ? 16 : 12;
}

/** The exported PNG's pixel size — portrait 4:5, which is what phone galleries
 *  and every social surface crop to most kindly. */
export const COLLAGE_WIDTH = 1600;
export const COLLAGE_HEIGHT = 2000;

/**
 * The card's ground, the app's own `--color-void-900`.
 *
 * A canvas cannot read a CSS custom property, so the value has to be a literal
 * SOMEWHERE. It lives here — beside the geometry it grounds — rather than being
 * retyped by each surface that paints a collage, because two surfaces drifting
 * to two different blacks is exactly the kind of thing nobody notices until a
 * host puts the guest page and the emailed image side by side.
 */
export const COLLAGE_BASE = '#05060B';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export interface CollagePlacement {
  /** Left edge of the UNROTATED box, canvas px. */
  x: number;
  /** Top edge of the UNROTATED box, canvas px. */
  y: number;
  w: number;
  h: number;
  /** Radians, turned about the box's own centre. 0 for square-on templates. */
  rotation: number;
  /** The id this placement's jitter was derived from — echoed so a caller can
   *  prove a layout is the one it asked for. */
  seed: string;
}

export interface CollagePlate {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Filmstrip only: the backing band a run of frames is mounted on, so the
 *  painter can lay the film stock and its sprocket holes under them. */
export interface CollageStrip {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export interface CollageLayout {
  template: CollageTemplate;
  width: number;
  height: number;
  cells: CollagePlacement[];
  plate: CollagePlate;
  strips: CollageStrip[];
  /**
   * Print border, as a FRACTION of each placement's own width — the scatter's
   * polaroid mat. A fraction rather than pixels because scattered prints differ
   * in size and a constant pixel mat would make the small ones look framed and
   * the big ones look bled. 0 when the template mounts photos flush.
   */
  mat: number;
  /** The deeper lip under a polaroid, same units as `mat`. */
  matBottom: number;
  /** Photo corner radius, px. */
  radius: number;
}

/* ------------------------------------------------------------------ */
/* Deterministic jitter                                                */
/* ------------------------------------------------------------------ */

/**
 * A stable 0..1 from a string, FNV-1a.
 *
 * `salt` lets one id drive several independent values (turn, x-nudge, y-nudge,
 * size) without any of them correlating — hashing `id` alone and slicing the
 * result would tie a print's rotation to its position.
 */
export function seededUnit(seed: string, salt = 0): number {
  let h = 0x811c9dc5 ^ (salt >>> 0);
  const s = `${seed}#${salt}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // FNV prime, via shifts: Math.imul keeps this in 32-bit territory.
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Seeded value in [-1, 1]. */
function seededSigned(seed: string, salt: number): number {
  return seededUnit(seed, salt) * 2 - 1;
}

/** Seeds for placements the caller gave no ids for (previews, tests). */
function seedsFor(count: number, seeds?: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(seeds?.[i] ?? `slot-${i}`);
  return out;
}

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/**
 * Place `count` photos on a `width` × `height` canvas.
 *
 * `seeds` are the post ids, and only the scatter template consults them; the
 * mosaic and the filmstrip are fully determined by the count, so passing ids is
 * optional everywhere. Count is clamped to the template's capacity here rather
 * than at the call site — a caller that forgets `pickCollagePhotos` gets a
 * crowded-but-correct collage instead of prints stacked off the canvas.
 */
export function collageLayout(
  count: number,
  width: number,
  height: number,
  template: CollageTemplate,
  seeds?: readonly string[],
): CollageLayout {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const n = Math.max(0, Math.min(Math.floor(count), collageCapacity(template)));
  const ids = seedsFor(n, seeds);
  if (template === 'filmstrip') return filmstripLayout(n, w, h, ids);
  if (template === 'scatter') return scatterLayout(n, w, h, ids);
  return mosaicLayout(n, w, h, ids);
}

/**
 * MOSAIC — a tight grid over a reserved name plate.
 *
 * The grid is the one template that promises no overlap at all, including with
 * the plate: the plate's band is subtracted from the usable height BEFORE the
 * cells are divided out, so a full sixteen can never creep under the title.
 * A short last row is centred, which is what stops a 5-of-7 layout reading like
 * a mistake.
 */
function mosaicLayout(n: number, w: number, h: number, ids: string[]): CollageLayout {
  const pad = Math.round(w * 0.045);
  const plateH = Math.round(h * 0.1);
  const gap = Math.max(2, Math.round(w * 0.014));
  const gridW = w - pad * 2;
  const gridH = h - pad * 2 - plateH;

  const cells: CollagePlacement[] = [];
  if (n > 0 && gridW > 0 && gridH > 0) {
    // Columns that keep cells nearest to square on this canvas. Capped at 5 so
    // a 16-photo mosaic never shrinks a face past recognition.
    const cols = Math.max(1, Math.min(5, Math.round(Math.sqrt((n * gridW) / gridH))));
    const rows = Math.ceil(n / cols);
    const cellW = (gridW - gap * (cols - 1)) / cols;
    const cellH = (gridH - gap * (rows - 1)) / rows;
    for (let i = 0; i < n; i += 1) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      // Items on the final row, so a short row can be centred under the rest.
      const inRow = Math.min(cols, n - row * cols);
      const rowW = inRow * cellW + gap * (inRow - 1);
      const rowX = pad + (gridW - rowW) / 2;
      cells.push({
        x: rowX + col * (cellW + gap),
        y: pad + row * (cellH + gap),
        w: cellW,
        h: cellH,
        rotation: 0,
        seed: ids[i],
      });
    }
  }

  return {
    template: 'mosaic',
    width: w,
    height: h,
    cells,
    plate: { x: pad, y: h - pad - plateH, w: gridW, h: plateH, rotation: 0 },
    strips: [],
    mat: 0,
    matBottom: 0,
    radius: Math.round(w * 0.012),
  };
}

/**
 * FILMSTRIP — two or three angled runs of frames on film stock.
 *
 * Each run is laid out horizontally first and then turned as a whole about its
 * band centre, so the frames stay in a straight line along the strip rather
 * than fanning: a placement's centre is the rotation of its flat centre about
 * the band, and its own `rotation` is the band's angle. Runs deliberately
 * over-run the canvas edges — a strip that stops politely inside the frame
 * reads as a row of pictures, not as film.
 */
function filmstripLayout(n: number, w: number, h: number, ids: string[]): CollageLayout {
  const pad = Math.round(w * 0.04);
  const plateH = Math.round(h * 0.11);
  const stripCount = n <= 4 ? Math.max(1, Math.min(2, n)) : 3;
  const bandArea = h - pad * 2 - plateH;
  const slotH = bandArea / Math.max(1, stripCount);
  // Bands are taller than their slot so consecutive strips overlap slightly —
  // the overlap is the whole look.
  const bandH = slotH * 1.06;
  const bandW = w * 1.32;
  // Alternating lean, shallowest in the middle so the stack reads as a fan.
  const ANGLES = [-7, 5, -3.5];

  const strips: CollageStrip[] = [];
  const cells: CollagePlacement[] = [];

  for (let s = 0; s < stripCount; s += 1) {
    const cy = pad + slotH * (s + 0.5);
    const rot = ANGLES[s % ANGLES.length] * DEG;
    strips.push({ cx: w / 2, cy, w: bandW, h: bandH, rotation: rot });

    // Frames spread evenly across the strips, earlier strips taking the
    // remainder so a 5-photo filmstrip is 2/2/1 rather than 1/2/2.
    const base = Math.floor(n / stripCount);
    const extra = n % stripCount;
    const inStrip = base + (s < extra ? 1 : 0);
    if (inStrip <= 0) continue;

    const margin = bandH * 0.13; // sprocket gutter, top and bottom
    const frameH = bandH - margin * 2;
    const gap = frameH * 0.06;
    const frameW = frameH * 0.74; // portrait, the shape a booth actually shoots
    const runW = inStrip * frameW + gap * (inStrip - 1);
    const startX = w / 2 - runW / 2;

    for (let i = 0; i < inStrip; i += 1) {
      const flatCx = startX + i * (frameW + gap) + frameW / 2;
      // Turn the frame's centre about the band centre; the frame carries the
      // same angle, so the run stays straight.
      const dx = flatCx - w / 2;
      const cx = w / 2 + dx * Math.cos(rot);
      const cyy = cy + dx * Math.sin(rot);
      cells.push({
        x: cx - frameW / 2,
        y: cyy - frameH / 2,
        w: frameW,
        h: frameH,
        rotation: rot,
        seed: ids[cells.length] ?? `slot-${cells.length}`,
      });
    }
  }

  return {
    template: 'filmstrip',
    width: w,
    height: h,
    cells,
    plate: { x: pad, y: h - pad - plateH, w: w - pad * 2, h: plateH, rotation: 0 },
    strips,
    mat: 0,
    matBottom: 0,
    radius: Math.round(w * 0.006),
  };
}

/**
 * SCATTER — polaroid prints tipped across the canvas.
 *
 * A coarse grid decides roughly where each print lives, then every print is
 * nudged, turned and resized by values hashed from its own post id. The grid
 * underneath is what stops the pile clumping into one corner, which is the
 * failure mode of scattering from pure noise; the hash is what makes it
 * reproducible. Prints overlap on purpose, so this template promises only that
 * every centre stays inside the safe area.
 */
function scatterLayout(n: number, w: number, h: number, ids: string[]): CollageLayout {
  const pad = Math.round(w * 0.035);
  const plateH = Math.round(h * 0.105);
  const areaW = w - pad * 2;
  const areaH = h - pad * 2 - plateH * 0.45; // prints may drift over the caption
  const MAX_TILT = 11 * DEG;

  const cells: CollagePlacement[] = [];
  if (n > 0 && areaW > 0 && areaH > 0) {
    const cols = Math.max(1, Math.min(4, Math.round(Math.sqrt((n * areaW) / areaH))));
    const rows = Math.ceil(n / cols);
    const cellW = areaW / cols;
    const cellH = areaH / rows;
    for (let i = 0; i < n; i += 1) {
      const seed = ids[i];
      const row = Math.floor(i / cols);
      const col = i % cols;
      // Size first: prints differ by ±11% so the pile has depth.
      const printW = cellW * (1.06 + 0.22 * seededUnit(seed, 1));
      const printH = printW * 1.135; // square photo + the deep bottom lip
      const jitterX = seededSigned(seed, 2) * cellW * 0.22;
      const jitterY = seededSigned(seed, 3) * cellH * 0.2;
      const cx = clamp(pad + cellW * (col + 0.5) + jitterX, pad, w - pad);
      const cy = clamp(pad + cellH * (row + 0.5) + jitterY, pad, h - pad);
      cells.push({
        x: cx - printW / 2,
        y: cy - printH / 2,
        w: printW,
        h: printH,
        rotation: seededSigned(seed, 4) * MAX_TILT,
        seed,
      });
    }
  }

  return {
    template: 'scatter',
    width: w,
    height: h,
    cells,
    plate: {
      x: w * 0.16,
      y: h - pad - plateH,
      w: w * 0.68,
      h: plateH,
      // A caption card set down at a slight angle, like the prints above it.
      rotation: -1.6 * DEG,
    },
    strips: [],
    mat: 0.055,
    matBottom: 0.19,
    radius: Math.round(w * 0.004),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The photo window inside a placement, once the print's mat is taken off. */
export function photoRect(
  cell: CollagePlacement,
  layout: Pick<CollageLayout, 'mat' | 'matBottom'>,
): { x: number; y: number; w: number; h: number } {
  const m = cell.w * layout.mat;
  const b = cell.w * layout.matBottom;
  return { x: cell.x + m, y: cell.y + m, w: cell.w - m * 2, h: cell.h - m - b };
}

/* ------------------------------------------------------------------ */
/* Choosing what goes in                                               */
/* ------------------------------------------------------------------ */

/**
 * Trim an album down to what the template can hold.
 *
 * The guest's OWN photos come first and are never dropped for someone else's:
 * a keepsake that quietly cut you out of it is worse than no keepsake. Within
 * each half the input order (the wall's newest-first) is preserved, so a live
 * event's collage keeps refreshing to the latest moments.
 */
export function pickCollagePhotos<T extends { id: string }>(
  photos: readonly T[],
  ownIds: ReadonlySet<string>,
  template: CollageTemplate,
): T[] {
  const cap = collageCapacity(template);
  const mine: T[] = [];
  const theirs: T[] = [];
  const seen = new Set<string>();
  for (const p of photos) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    (ownIds.has(p.id) ? mine : theirs).push(p);
  }
  return [...mine, ...theirs].slice(0, cap);
}

/** File name for the saved collage. */
export function collageFileName(prefix: string, template: CollageTemplate): string {
  const clean = (prefix || 'event').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean || 'event'}-${template}.png`;
}

/* ------------------------------------------------------------------ */
/* The imperative half — canvas only below this line                   */
/* ------------------------------------------------------------------ */

export interface CollageArt {
  /** Card base colour under the wash. */
  background: string;
  /** Hairlines, plate rules and the title. */
  accent: string;
  /** Event accent palette ([0] dominant) painted as the ambience. */
  palette?: string[];
  /** Event name, set in the plate. */
  title: string;
  /** The small line under it — a count, a date. Omitted when there is none. */
  subtitle?: string;
  /** Quiet credit in the corner. Omitted to leave it off. */
  mark?: string;
}

/**
 * Decode one photo for the canvas.
 *
 * `crossOrigin='anonymous'` is load-bearing, not decoration: a cross-origin
 * image drawn without it TAINTS the canvas, and `toBlob` then throws, so the
 * download button would fail at the last step having already looked like it
 * worked. The same procedure the wall's arrival ceremony follows
 * (components/wall/ArrivalBeam.tsx). A photo that will not decode resolves
 * null and its slot is left as the card's own background — one missing print
 * must never cost the whole collage.
 */
export function loadCollageImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Decode a whole album, keeping slot order (failures stay null in place). */
export function loadCollageImages(urls: readonly string[]): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(urls.map(loadCollageImage));
}

/**
 * Paint a laid-out collage into a 2D context.
 *
 * Synchronous by design: every image is already decoded, so the preview canvas
 * and the full-resolution export run the exact same code with nothing async in
 * between — what the guest saw is what the guest saves.
 */
export function paintCollage(
  ctx: CanvasRenderingContext2D,
  layout: CollageLayout,
  images: readonly (HTMLImageElement | null)[],
  art: CollageArt,
): void {
  const { width: w, height: h } = layout;
  paintAmbience(ctx, w, h, art.background, art.palette ?? [art.accent]);

  // Film stock first, so frames sit on top of their own strips.
  for (const strip of layout.strips) paintFilmStock(ctx, strip, art.accent);

  layout.cells.forEach((cell, i) => {
    const img = images[i] ?? null;
    paintCell(ctx, cell, layout, img, art);
  });

  paintPlate(ctx, layout, art);
}

function paintCell(
  ctx: CanvasRenderingContext2D,
  cell: CollagePlacement,
  layout: CollageLayout,
  img: HTMLImageElement | null,
  art: CollageArt,
): void {
  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (cell.rotation !== 0) ctx.rotate(cell.rotation);
  ctx.translate(-cell.w / 2, -cell.h / 2);

  const hasMat = layout.mat > 0;
  // Prints get a soft shadow so the pile has depth; flush grids do not, or the
  // gutters turn grey.
  if (hasMat) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = cell.w * 0.09;
    ctx.shadowOffsetY = cell.w * 0.018;
    ctx.fillStyle = '#f4efe6';
    roundedRect(ctx, 0, 0, cell.w, cell.h, layout.radius);
    ctx.fill();
    ctx.restore();
  }

  // The window is taken from `photoRect`, the same tested function the preview
  // and the tests use — asked at the cell's own origin, because the context is
  // already translated there. Recomputing the mat arithmetic inline is how a
  // painter and its layout drift apart.
  const { x: mx, y: my, w: pw, h: ph } = photoRect({ ...cell, x: 0, y: 0 }, layout);
  const rad = hasMat ? layout.radius * 0.6 : layout.radius;

  if (img && img.width > 0 && img.height > 0) {
    ctx.save();
    roundedRect(ctx, mx, my, pw, ph, rad);
    ctx.clip();
    const r = coverRect(img.width, img.height, pw, ph);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, mx, my, pw, ph);
    ctx.restore();
  } else {
    // An empty slot reads as a deliberate blank frame rather than a hole.
    ctx.fillStyle = hexToRgba(art.accent, 0.07);
    roundedRect(ctx, mx, my, pw, ph, rad);
    ctx.fill();
  }

  ctx.strokeStyle = hexToRgba(art.accent, hasMat ? 0.25 : 0.5);
  ctx.lineWidth = Math.max(1, cell.w * 0.006);
  roundedRect(ctx, mx, my, pw, ph, rad);
  ctx.stroke();
  ctx.restore();
}

/** The band under a filmstrip run: dark stock plus its two sprocket gutters. */
function paintFilmStock(ctx: CanvasRenderingContext2D, strip: CollageStrip, accent: string): void {
  ctx.save();
  ctx.translate(strip.cx, strip.cy);
  ctx.rotate(strip.rotation);
  const x = -strip.w / 2;
  const y = -strip.h / 2;

  ctx.fillStyle = 'rgba(9,9,12,0.92)';
  ctx.fillRect(x, y, strip.w, strip.h);

  // Sprockets: rounded slots marching the length of both gutters.
  const holeH = strip.h * 0.075;
  const holeW = holeH * 1.5;
  const pitch = holeW * 2.1;
  const topY = y + strip.h * 0.028;
  const botY = y + strip.h - strip.h * 0.028 - holeH;
  ctx.fillStyle = hexToRgba(accent, 0.22);
  for (let hx = x + pitch * 0.4; hx < x + strip.w - holeW; hx += pitch) {
    roundedRect(ctx, hx, topY, holeW, holeH, holeH * 0.35);
    ctx.fill();
    roundedRect(ctx, hx, botY, holeW, holeH, holeH * 0.35);
    ctx.fill();
  }

  ctx.strokeStyle = hexToRgba(accent, 0.3);
  ctx.lineWidth = Math.max(1, strip.h * 0.006);
  ctx.strokeRect(x, y, strip.w, strip.h);
  ctx.restore();
}

/** The name plate: event title in the platform serif, with a rule and a line
 *  under it. Georgia stands in for the web font — a canvas cannot wait on a
 *  font load, and the serif silhouette is what carries the look. */
function paintPlate(ctx: CanvasRenderingContext2D, layout: CollageLayout, art: CollageArt): void {
  const p = layout.plate;
  ctx.save();
  ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
  if (p.rotation !== 0) ctx.rotate(p.rotation);

  if (layout.template === 'scatter') {
    // A caption card, so the handwritten line has something to sit on.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = p.h * 0.32;
    ctx.shadowOffsetY = p.h * 0.05;
    ctx.fillStyle = '#f4efe6';
    roundedRect(ctx, -p.w / 2, -p.h / 2, p.w, p.h, p.h * 0.12);
    ctx.fill();
    ctx.restore();
  }

  const onCard = layout.template === 'scatter';
  const titleSize = Math.round(p.h * (art.subtitle ? 0.4 : 0.5));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = onCard ? '#2a2118' : art.accent;
  ctx.font = `italic 600 ${titleSize}px Georgia, "Times New Roman", serif`;
  const titleY = art.subtitle ? -p.h * 0.1 : 0;
  ctx.fillText(fit(ctx, art.title, p.w * 0.9), 0, titleY);

  if (art.subtitle) {
    const subSize = Math.round(p.h * 0.17);
    ctx.font = `${subSize}px Georgia, "Times New Roman", serif`;
    ctx.fillStyle = onCard ? 'rgba(42,33,24,0.62)' : hexToRgba(art.accent, 0.62);
    ctx.fillText(fit(ctx, art.subtitle, p.w * 0.9), 0, titleY + titleSize * 0.85);
  }

  if (!onCard) {
    // A hairline rule above the plate ties it to the grid it closes.
    ctx.strokeStyle = hexToRgba(art.accent, 0.28);
    ctx.lineWidth = Math.max(1, layout.width * 0.0015);
    ctx.beginPath();
    ctx.moveTo(-p.w * 0.34, -p.h * 0.44);
    ctx.lineTo(p.w * 0.34, -p.h * 0.44);
    ctx.stroke();
  }
  ctx.restore();

  if (art.mark) {
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = hexToRgba(art.accent, 0.42);
    ctx.font = `${Math.round(layout.width * 0.016)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(art.mark, layout.width - layout.width * 0.03, layout.height - layout.width * 0.018);
    ctx.restore();
  }
}

/** Shrink a string until it fits `maxWidth`, then ellipsise — a long event name
 *  must not run off the plate and out of the picture. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** Base fill, vertical wash and two radial glows from the event palette — the
 *  canvas approximation of the app's liquid-glass ground, matching the strip
 *  compositor so a collage and a photo strip look like the same product. */
function paintAmbience(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  palette: string[],
): void {
  const a0 = palette[0] ?? '#E8C766';
  const a1 = palette[1] ?? a0;
  const a2 = palette[2] ?? a1;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, hexToRgba(a2, 0.22));
  wash.addColorStop(0.5, hexToRgba(a0, 0.05));
  wash.addColorStop(1, hexToRgba(a1, 0.18));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  let glow = ctx.createRadialGradient(w * 0.2, h * 0.05, 0, w * 0.2, h * 0.05, w);
  glow.addColorStop(0, hexToRgba(a0, 0.24));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  glow = ctx.createRadialGradient(w * 0.86, h * 0.96, 0, w * 0.86, h * 0.96, w * 0.85);
  glow.addColorStop(0, hexToRgba(a1, 0.18));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/** Manual rounded-rect path — `ctx.roundRect` is still missing from some
 *  in-app browsers guests open recap links inside. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * Render the export-resolution PNG.
 *
 * Returns null rather than throwing on the two failures that can actually
 * happen — a browser that refuses a 2D context, and a canvas tainted because
 * one photo's host did not answer with CORS headers. Both mean "no file", and
 * the caller must say so instead of handing the guest a broken download.
 */
export async function collagePngBlob(
  images: readonly (HTMLImageElement | null)[],
  layout: CollageLayout,
  art: CollageArt,
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintCollage(ctx, layout, images, art);
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      // SecurityError: a tainted canvas. Nothing to recover — report the miss.
      resolve(null);
    }
  });
}
