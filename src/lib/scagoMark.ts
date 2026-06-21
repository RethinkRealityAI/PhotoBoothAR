/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SCAGO emblem — the Sickle Cell Awareness Group of Ontario mark (a crescent
 * embracing a blood drop), rebuilt as resolution-independent vector art so it
 * can be themed in gala GOLD (default) or authentic RED, and animated.
 *
 * Geometry lives in a 0..100 box. Three renderers share the SAME geometry so
 * the mark is pixel-consistent everywhere it appears:
 *   • scagoMarkSvg()    → a self-contained <svg> string (UI / data-URL)
 *   • scagoMarkInner()  → markup to embed inside a parent <svg> that already
 *                          defines `url(#gold)` (the SVG photo borders)
 *   • drawScagoMark()   → Canvas2D for the booth watermark (isolated offscreen
 *                          so the crescent hole never punches the photo behind)
 *
 * The crescent is the OUTER disc with the INNER disc subtracted. We never hand-
 * compute a lune path: SVG uses a <mask>, Canvas uses destination-out — both
 * exact, both handle the inner disc's right overhang correctly.
 */

/** Blood-drop silhouette (tip up), authored in the same 0..100 box, centred at origin. */
export const SCAGO_DROP_PATH =
  'M0,-21 C9.5,-6 13.5,-1 13.5,7.5 a13.5,13.5 0 1,1 -27,0 C-13.5,-1 -9.5,-6 0,-21 Z';

/** Crescent discs + drop placement, all in the 0..100 box. */
export const SCAGO_GEOM = {
  outer: { cx: 50, cy: 52, r: 45 },
  inner: { cx: 74, cy: 48, r: 41 },
  drop: { cx: 49, cy: 53, scale: 0.94, rot: 6 },
};

export type ScagoVariant = 'gold' | 'red' | 'mono';

const GOLD_STOPS = [
  ['0%', '#B8860B'],
  ['32%', '#E8C766'],
  ['50%', '#FBF3D9'],
  ['70%', '#D4AF37'],
  ['100%', '#9A6F1C'],
] as const;

function gradientFor(variant: ScagoVariant, id: string): string {
  if (variant === 'red') {
    return `<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#C81E33"/><stop offset="55%" stop-color="#B71B2E"/>
      <stop offset="100%" stop-color="#8E1322"/></linearGradient>`;
  }
  if (variant === 'mono') {
    return `<linearGradient id="${id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FBF3D9"/><stop offset="100%" stop-color="#E9D9B8"/></linearGradient>`;
  }
  return `<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
    ${GOLD_STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}
  </linearGradient>`;
}

/**
 * Inner SVG markup for embedding in a parent <svg>. Self-contained mask so the
 * crescent is exact. `fill` defaults to the parent's `url(#gold)`; pass a custom
 * paint to override. `suffix` MUST be unique per placement (mask id collisions).
 * Placed by CENTRE (cx,cy) and overall `size` (box edge length).
 */
export function scagoMarkInner(
  cx: number,
  cy: number,
  size: number,
  suffix: string,
  fill = 'url(#gold)',
): string {
  const s = size / 100;
  const bx = cx - size / 2;
  const by = cy - size / 2;
  const O = SCAGO_GEOM.outer, I = SCAGO_GEOM.inner, D = SCAGO_GEOM.drop;
  const oCx = bx + O.cx * s, oCy = by + O.cy * s, oR = O.r * s;
  const iCx = bx + I.cx * s, iCy = by + I.cy * s, iR = I.r * s;
  const dCx = bx + D.cx * s, dCy = by + D.cy * s;
  const mId = `scagoCres-${suffix}`;
  return `
    <mask id="${mId}" maskUnits="userSpaceOnUse">
      <circle cx="${oCx.toFixed(2)}" cy="${oCy.toFixed(2)}" r="${oR.toFixed(2)}" fill="#fff"/>
      <circle cx="${iCx.toFixed(2)}" cy="${iCy.toFixed(2)}" r="${iR.toFixed(2)}" fill="#000"/>
    </mask>
    <circle cx="${oCx.toFixed(2)}" cy="${oCy.toFixed(2)}" r="${oR.toFixed(2)}" fill="${fill}" mask="url(#${mId})"/>
    <g transform="translate(${dCx.toFixed(2)},${dCy.toFixed(2)}) scale(${(D.scale * s).toFixed(3)}) rotate(${D.rot})">
      <path d="${SCAGO_DROP_PATH}" fill="${fill}"/>
    </g>`;
}

/** Standalone <svg> string for the mark (own gradient). Good for data-URLs. */
export function scagoMarkSvg(size = 100, variant: ScagoVariant = 'gold'): string {
  const gid = `scagoG-${variant}`;
  const O = SCAGO_GEOM.outer, I = SCAGO_GEOM.inner, D = SCAGO_GEOM.drop;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>${gradientFor(variant, gid)}
      <mask id="m-${variant}" maskUnits="userSpaceOnUse">
        <circle cx="${O.cx}" cy="${O.cy}" r="${O.r}" fill="#fff"/>
        <circle cx="${I.cx}" cy="${I.cy}" r="${I.r}" fill="#000"/>
      </mask>
    </defs>
    <circle cx="${O.cx}" cy="${O.cy}" r="${O.r}" fill="url(#${gid})" mask="url(#m-${variant})"/>
    <g transform="translate(${D.cx},${D.cy}) scale(${D.scale}) rotate(${D.rot})">
      <path d="${SCAGO_DROP_PATH}" fill="url(#${gid})"/>
    </g>
  </svg>`;
}

export function scagoMarkDataUrl(size = 100, variant: ScagoVariant = 'gold'): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(scagoMarkSvg(size, variant).replace(/\n\s*/g, ' '));
}

let _dropPath: Path2D | null = null;
function dropPath(): Path2D {
  if (!_dropPath) _dropPath = new Path2D(SCAGO_DROP_PATH);
  return _dropPath;
}

/**
 * Draw the SCAGO mark on a Canvas2D context, centred at (cx,cy) at `size` px.
 * Rendered on an isolated offscreen canvas first so the crescent's destination-
 * out hole only affects the mark, never the photo behind it.
 */
export function drawScagoMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  opts: { fill?: string | CanvasGradient; alpha?: number } = {},
) {
  const off = document.createElement('canvas');
  const pad = 2;
  off.width = Math.ceil(size) + pad * 2;
  off.height = Math.ceil(size) + pad * 2;
  const o = off.getContext('2d');
  if (!o) return;

  const s = size / 100;
  const O = SCAGO_GEOM.outer, I = SCAGO_GEOM.inner, D = SCAGO_GEOM.drop;

  let paint: string | CanvasGradient = opts.fill ?? '#D4AF37';
  if (!opts.fill) {
    const g = o.createLinearGradient(pad, pad, pad + size, pad + size);
    g.addColorStop(0, '#B8860B');
    g.addColorStop(0.5, '#FBF3D9');
    g.addColorStop(1, '#9A6F1C');
    paint = g;
  }

  // crescent: outer disc minus inner disc (isolated → safe destination-out)
  o.save();
  o.translate(pad, pad);
  o.fillStyle = paint;
  o.beginPath();
  o.arc(O.cx * s, O.cy * s, O.r * s, 0, Math.PI * 2);
  o.fill();
  o.globalCompositeOperation = 'destination-out';
  o.beginPath();
  o.arc(I.cx * s, I.cy * s, I.r * s, 0, Math.PI * 2);
  o.fill();
  o.globalCompositeOperation = 'source-over';
  // drop
  o.translate(D.cx * s, D.cy * s);
  o.scale(D.scale * s, D.scale * s);
  o.rotate((D.rot * Math.PI) / 180);
  o.fillStyle = paint;
  o.fill(dropPath());
  o.restore();

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.drawImage(off, cx - size / 2 - pad, cy - size / 2 - pad);
  ctx.restore();
}
