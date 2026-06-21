/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Curated, gala-themed SVG borders & overlays (1080x1920, transparent).
 * Self-contained data URLs — safe to drawImage onto a canvas without tainting.
 */
import { scagoMarkInner } from './scagoMark';

const GOLD_DEFS = `
  <defs>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#B8860B"/>
      <stop offset="35%" stop-color="#E8C766"/>
      <stop offset="50%" stop-color="#FBF3D9"/>
      <stop offset="70%" stop-color="#D4AF37"/>
      <stop offset="100%" stop-color="#A67C1F"/>
    </linearGradient>
    <linearGradient id="goldV" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#E8C766"/>
      <stop offset="50%" stop-color="#FBF3D9"/>
      <stop offset="100%" stop-color="#A67C1F"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="1.2"/></filter>
  </defs>`;

const FLEUR = (x: number, y: number, s: number, rot = 0) => `
  <g transform="translate(${x},${y}) scale(${s}) rotate(${rot})" fill="url(#gold)">
    <path d="M0,-30 C8,-14 22,-8 30,0 C22,8 8,14 0,30 C-8,14 -22,8 -30,0 C-22,-8 -8,-14 0,-30 Z"/>
    <circle cx="0" cy="0" r="5" fill="#FBF3D9"/>
  </g>`;

const CORNER = (x: number, y: number, flipX: number, flipY: number) => `
  <g transform="translate(${x},${y}) scale(${flipX},${flipY})" fill="none" stroke="url(#gold)" stroke-width="5">
    <path d="M0,160 C0,70 70,0 160,0" />
    <path d="M22,160 C22,84 84,22 160,22" stroke-width="2.5"/>
    <path d="M60,60 C90,40 130,40 160,40" stroke-width="2"/>
    <circle cx="60" cy="60" r="6" fill="url(#gold)" stroke="none"/>
    ${FLEUR(95, 95, 0.7, 45)}
  </g>`;

function svg(inner: string, viewBox = '0 0 1080 1920') {
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${GOLD_DEFS}${inner}</svg>`;
}

export function toDataUrl(svgString: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svgString.replace(/\n\s*/g, ' '));
}

export interface BuiltinBorder {
  id: string;
  name: string;
  kind: 'border' | '2d_filter';
  svg: string;
}

/* ---- Borders / frames -------------------------------------------- */

const classicFrame = svg(`
  <rect x="46" y="46" width="988" height="1828" rx="28" fill="none" stroke="url(#gold)" stroke-width="9"/>
  <rect x="70" y="70" width="940" height="1780" rx="20" fill="none" stroke="url(#gold)" stroke-width="2.5"/>
  ${CORNER(70, 70, 1, 1)}
  ${CORNER(1010, 70, -1, 1)}
  ${CORNER(70, 1850, 1, -1)}
  ${CORNER(1010, 1850, -1, -1)}
  ${scagoMarkInner(540, 1560, 168, 'classic')}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="1688" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="18" fill="#E9D9B8">SCAGO</text>
    <text x="540" y="1792" font-size="100" font-weight="700" letter-spacing="6" fill="url(#gold)" stroke="#3A2A0E" stroke-width="1.5" filter="url(#soft)">HOPE GALA</text>
    <text x="540" y="1792" font-size="100" font-weight="700" letter-spacing="6" fill="url(#gold)">HOPE GALA</text>
    <text x="540" y="1856" font-style="italic" font-size="52" fill="url(#gold)">&amp; Awards · 2026</text>
  </g>
`);

const hexFrame = svg(`
  <g fill="none" stroke="url(#gold)">
    <polygon points="540,70 980,330 980,1590 540,1850 100,1590 100,330" stroke-width="8"/>
    <polygon points="540,110 940,348 940,1572 540,1810 140,1572 140,348" stroke-width="2"/>
  </g>
  ${scagoMarkInner(540, 250, 150, 'hex')}
  ${FLEUR(540, 1560, 0.7)}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="1684" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" letter-spacing="16" fill="#E9D9B8">SCAGO · THE 2026</text>
    <text x="540" y="1772" font-size="88" font-weight="700" letter-spacing="6" fill="url(#gold)" stroke="#3A2A0E" stroke-width="1.4" filter="url(#soft)">HOPE GALA</text>
    <text x="540" y="1772" font-size="88" font-weight="700" letter-spacing="6" fill="url(#gold)">HOPE GALA</text>
    <text x="540" y="1830" font-style="italic" font-size="48" fill="url(#gold)">&amp; Awards</text>
  </g>
`);

const decoFrame = svg(`
  <g fill="none" stroke="url(#gold)" stroke-width="4">
    <rect x="60" y="60" width="960" height="1800" />
    <line x1="60" y1="150" x2="1020" y2="150"/>
    <line x1="60" y1="1770" x2="1020" y2="1770"/>
    <path d="M60,60 L200,60 L200,120 M1020,60 L880,60 L880,120 M60,1860 L200,1860 L200,1800 M1020,1860 L880,1860 L880,1800"/>
    <g stroke-width="2">
      <path d="M540,70 l30,40 l-30,40 l-30,-40 z"/>
      <path d="M540,1850 l30,-40 l-30,-40 l-30,40 z"/>
    </g>
  </g>
  <g text-anchor="middle">
    <text x="540" y="124" font-family="Georgia, 'Times New Roman', serif" font-size="46" font-weight="700" letter-spacing="10" fill="url(#gold)">HOPE GALA</text>
  </g>
  ${scagoMarkInner(540, 1610, 150, 'deco')}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="1744" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" letter-spacing="14" fill="#E9D9B8">SCAGO · HOPE GALA</text>
    <text x="540" y="1814" font-style="italic" font-size="56" fill="url(#gold)">&amp; Awards</text>
    <text x="540" y="1856" font-family="Arial, Helvetica, sans-serif" font-size="24" letter-spacing="12" fill="#E9D9B8">2026</text>
  </g>
`);

const minimalFrame = svg(`
  <rect x="38" y="38" width="1004" height="1844" rx="22" fill="none" stroke="url(#gold)" stroke-width="3"/>
  ${scagoMarkInner(540, 1788, 64, 'minimal')}
  <g text-anchor="middle">
    <text x="540" y="1858" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="38" fill="url(#gold)">SCAGO · Hope Gala &amp; Awards 2026</text>
  </g>
`);

/* ---- Overlays / scatter ------------------------------------------ */

function star(x: number, y: number, s: number, fill = 'url(#gold)', op = 0.9) {
  return `<g transform="translate(${x},${y}) scale(${s})" opacity="${op}"><path d="M0,-12 L3,-3 L12,0 L3,3 L0,12 L-3,3 L-12,0 L-3,-3 Z" fill="${fill}"/></g>`;
}

const confettiBottom = svg(`
  ${Array.from({ length: 26 })
    .map((_, i) => {
      const x = 40 + ((i * 41) % 1000);
      const y = 1500 + ((i * 137) % 380);
      const s = 0.6 + ((i * 7) % 10) / 8;
      const rot = (i * 53) % 360;
      const fill = i % 3 === 0 ? '#FBF3D9' : 'url(#gold)';
      return `<rect x="${x}" y="${y}" width="${10 * s}" height="${16 * s}" rx="2" transform="rotate(${rot} ${x} ${y})" fill="${fill}" opacity="0.85"/>`;
    })
    .join('')}
`);

/* ---- Branded gala stickers (full-frame, Georgia serif so they render on canvas) ---- */

const hopeGalaBanner = svg(`
  ${scagoMarkInner(540, 1540, 150, 'banner')}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="1664" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="18" fill="#E9D9B8" opacity="0.95">SCAGO · THE 2026</text>
    <text x="540" y="1772" font-size="100" font-weight="700" letter-spacing="6" fill="url(#gold)" stroke="#3A2A0E" stroke-width="1.5" filter="url(#soft)">HOPE GALA</text>
    <text x="540" y="1772" font-size="100" font-weight="700" letter-spacing="6" fill="url(#gold)">HOPE GALA</text>
    <text x="540" y="1844" font-style="italic" font-size="64" fill="url(#gold)">&amp; Awards</text>
  </g>
  ${FLEUR(252, 1730, 0.62)}
  ${FLEUR(828, 1730, 0.62)}
`);

const hopeGalaTop = svg(`
  ${scagoMarkInner(540, 132, 132, 'top')}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="296" font-size="60" font-weight="700" letter-spacing="6" fill="url(#gold)" stroke="#3A2A0E" stroke-width="1.2" filter="url(#soft)">SCAGO · HOPE GALA &amp; AWARDS</text>
    <text x="540" y="296" font-size="60" font-weight="700" letter-spacing="6" fill="url(#gold)">SCAGO · HOPE GALA &amp; AWARDS</text>
    <text x="540" y="352" font-style="italic" font-size="36" fill="#E9D9B8" opacity="0.92">Sickle Cell Awareness Group of Ontario · 2026</text>
  </g>
`);

const crownSticker = svg(`
  <g transform="translate(540, 250)">
    <path d="M -180 60 L -185 -50 L -90 28 L 0 -78 L 90 28 L 185 -50 L 180 60 Z" fill="url(#gold)" stroke="#7E5C14" stroke-width="3"/>
    <rect x="-192" y="58" width="384" height="46" rx="10" fill="url(#gold)" stroke="#7E5C14" stroke-width="3"/>
    <circle cx="-185" cy="-50" r="15" fill="#FBF3D9"/>
    <circle cx="0" cy="-78" r="18" fill="#FBF3D9"/>
    <circle cx="185" cy="-50" r="15" fill="#FBF3D9"/>
    <circle cx="-95" cy="82" r="11" fill="#9C1B33"/>
    <circle cx="0" cy="82" r="12" fill="#1E4D8C"/>
    <circle cx="95" cy="82" r="11" fill="#1E7A4D"/>
    ${star(0, -150, 1.6, 'url(#gold)', 0.95)}
  </g>
  ${scagoMarkInner(540, 470, 132, 'crown')}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="606" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" letter-spacing="16" fill="#E9D9B8">SCAGO</text>
    <text x="540" y="676" font-size="62" font-weight="700" letter-spacing="5" fill="url(#gold)" stroke="#3A2A0E" stroke-width="1.2" filter="url(#soft)">HOPE GALA</text>
    <text x="540" y="676" font-size="62" font-weight="700" letter-spacing="5" fill="url(#gold)">HOPE GALA</text>
    <text x="540" y="730" font-style="italic" font-size="40" fill="url(#gold)">&amp; Awards · 2026</text>
  </g>
`);

export const BUILTIN_BORDERS: BuiltinBorder[] = [
  { id: 'frame-classic', name: 'Classic Gold', kind: 'border', svg: classicFrame },
  { id: 'frame-hexagon', name: 'Hexagon (Invitation)', kind: 'border', svg: hexFrame },
  { id: 'frame-deco', name: 'Art Deco', kind: 'border', svg: decoFrame },
  { id: 'frame-minimal', name: 'Minimal Inset', kind: 'border', svg: minimalFrame },
  { id: 'sticker-hopegala', name: 'Hope Gala & Awards', kind: '2d_filter', svg: hopeGalaBanner },
  { id: 'sticker-hopegala-top', name: 'Gala Header', kind: '2d_filter', svg: hopeGalaTop },
  { id: 'sticker-crown', name: 'Golden Crown', kind: '2d_filter', svg: crownSticker },
  { id: 'overlay-confetti', name: 'Gold Confetti', kind: '2d_filter', svg: confettiBottom },
];

export const BORDER_MAP: Record<string, BuiltinBorder> = Object.fromEntries(
  BUILTIN_BORDERS.map((b) => [b.id, b]),
);
