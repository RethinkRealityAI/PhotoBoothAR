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
  /**
   * Carries baked legacy-event branding (SCAGO / Hope Gala / Jenna & Jake /
   * Detola & Wuyi text or marks). Legacy events' configs still resolve these
   * by id (catalog.ts / BORDER_MAP — never remove or rename them), but the
   * self-serve studio library hides them (AssetsDock filters on this flag).
   */
  legacy?: true;
  /** Occasions this frame suits (event template ids) — drives "Recommended"
   *  ordering in themeMatch.ts. Generic frames only; absent = no preference. */
  occasions?: string[];
  /** Which colour family the art is drawn in, so `recolorFrameSvg` can map it
   *  onto an event palette. Absent = fixed colours (every legacy frame). */
  recolor?: FrameRecolor;
  /** The art's dominant colour as drawn (colour-affinity ranking). */
  tone?: string;
}

/* ---- Recolouring (platform events only) ----------------------------
 * The built-in art is drawn in two colour families: the gold ramp (GOLD_DEFS
 * + the fleur highlight + the crown outline) and the neon trio. A frame that
 * declares `recolor` has each of its family's colour stops swapped for a shade
 * of the event palette AT RENDER TIME — `svg` itself is never rewritten, so
 * every caller that reads `b.svg` directly (legacy sites, the landing page,
 * starter scenes) is byte-identical, and so is `frameDataUrl(b)` with no
 * palette. Only an event config that carries `arContent.framePalette` (written
 * by the platform create flow / LooksPicker) ever sees a recoloured frame. */

export type FrameRecolor = 'gold' | 'neon';

/** The colours a recolourable frame takes on. `accent2` is optional; it is
 *  derived from `accent` when absent. */
export interface FramePalette {
  accent: string;
  accent2?: string | null;
}

/** Every colour stop of each family, exactly as written in the art above. */
export const FRAME_COLOR_TOKENS: Record<FrameRecolor, string[]> = {
  gold: ['#B8860B', '#E8C766', '#FBF3D9', '#D4AF37', '#A67C1F', '#7E5C14'],
  neon: ['#FF2D9B', '#19E3FF', '#C6FF1A'],
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;

// Local HSL helpers (same maths as studio/colorways.ts rgbToHsl/hslToHex):
// borders.ts sits in the landing page's import graph, and pulling the studio
// colour module (and its finish/asset imports) in for 20 lines is not worth it.
function hexToHslTriple(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, l];
}

function hslHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

/**
 * token → replacement for one family under a palette. Null when the palette
 * has no valid accent (the caller then renders the art unchanged).
 * Gold ramp: base = accent, light = accent2 (or a lighter accent), highlight =
 * a near-white tint, the three deep stops = progressively darker accent.
 * Neon trio: magenta = accent, cyan = accent2 (or the complement), lime = a
 * quarter-turn hue so the equalizer keeps three distinct bars.
 */
export function frameColorMap(family: FrameRecolor, palette: FramePalette | null | undefined): Record<string, string> | null {
  if (!palette || typeof palette.accent !== 'string' || !HEX6.test(palette.accent)) return null;
  const accent = palette.accent.toUpperCase();
  const a2 = typeof palette.accent2 === 'string' && HEX6.test(palette.accent2) ? palette.accent2.toUpperCase() : null;
  const [h, s, l] = hexToHslTriple(accent);
  if (family === 'gold') {
    return {
      '#D4AF37': accent,
      '#E8C766': a2 ?? hslHex(h, s, Math.min(l + 0.17, 0.85)),
      '#FBF3D9': hslHex(h, Math.min(s, 0.8), 0.92),
      '#B8860B': hslHex(h, s, Math.max(l - 0.2, 0.12)),
      '#A67C1F': hslHex(h, s, Math.max(l - 0.22, 0.1)),
      '#7E5C14': hslHex(h, s, Math.max(l - 0.32, 0.06)),
    };
  }
  return {
    '#FF2D9B': accent,
    '#19E3FF': a2 ?? hslHex(h + 180, s, l),
    '#C6FF1A': hslHex(h + 90, s, l),
  };
}

/** Replace colour tokens via `map`; an unmapped hex is left exactly as written. */
export function replaceColorTokens(svgString: string, map: Record<string, string>): string {
  return svgString.replace(/#[0-9A-Fa-f]{6}\b/g, (hex) => map[hex.toUpperCase()] ?? hex);
}

/** The frame's SVG under an event palette. No palette, no `recolor`, or an
 *  invalid accent → `b.svg` itself (the identical string, not a copy). */
export function recolorFrameSvg(b: BuiltinBorder, palette?: FramePalette | null): string {
  if (!b.recolor) return b.svg;
  const map = frameColorMap(b.recolor, palette);
  return map ? replaceColorTokens(b.svg, map) : b.svg;
}

/** The data URL every renderer hands to <img>/drawImage. With no palette this
 *  is exactly `toDataUrl(b.svg)` — today's bytes. */
export function frameDataUrl(b: BuiltinBorder, palette?: FramePalette | null): string {
  return toDataUrl(recolorFrameSvg(b, palette));
}

/** The name to show next to a frame drawn under `palette`. A gold-family frame
 *  that has really been recoloured no longer is gold, so "Gold"/"Golden" is
 *  dropped from its name ("Gold Confetti" → "Confetti"). Anything not actually
 *  recoloured keeps its name exactly. */
export function frameDisplayName(b: BuiltinBorder, palette?: FramePalette | null): string {
  if (b.recolor !== 'gold' || !frameColorMap(b.recolor, palette)) return b.name;
  const stripped = b.name.replace(/\bGold(en)?\b/g, '').replace(/\s+/g, ' ').trim();
  return stripped || b.name;
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

/* ---- Festival / Jenna & Jake neon frames ------------------------- */

const jjNeonFrame = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <filter id="neon-glow-outer" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="neon-glow-inner" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- Outer magenta tube border -->
  <rect x="24" y="24" width="1032" height="1872" rx="36" ry="36" fill="none" stroke="#FF2D9B" stroke-width="16" filter="url(#neon-glow-outer)" opacity="0.95"/>
  <!-- Inner cyan tube border -->
  <rect x="50" y="50" width="980" height="1820" rx="22" ry="22" fill="none" stroke="#19E3FF" stroke-width="8" filter="url(#neon-glow-inner)" opacity="0.90"/>
</svg>`;

const jjLowerThird = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="holo-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FF2D9B"/>
      <stop offset="50%" stop-color="#19E3FF"/>
      <stop offset="100%" stop-color="#7A2BFF"/>
    </linearGradient>
    <filter id="text-glow">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- Bottom band background -->
  <rect x="0" y="1680" width="1080" height="180" fill="#0B0220" opacity="0.82"/>
  <!-- Top edge accent line -->
  <line x1="0" y1="1682" x2="1080" y2="1682" stroke="#FF2D9B" stroke-width="3" opacity="0.9"/>
  <!-- Holographic text shadow -->
  <text x="540" y="1800" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="90" font-weight="900" letter-spacing="8" fill="url(#holo-grad)" filter="url(#text-glow)" opacity="0.6">JENNA &amp; JAKE</text>
  <!-- Holographic text main -->
  <text x="540" y="1800" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="90" font-weight="900" letter-spacing="8" fill="url(#holo-grad)">JENNA &amp; JAKE</text>
</svg>`;

const jjEqualizer = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <filter id="eq-glow">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- EQ bars — 14 bars, varying heights, alternating magenta/cyan/lime -->
  <g filter="url(#eq-glow)" opacity="0.95">
    <rect x="40"  y="1760" width="62" height="120" rx="6" fill="#FF2D9B"/>
    <rect x="120" y="1720" width="62" height="160" rx="6" fill="#19E3FF"/>
    <rect x="200" y="1790" width="62" height="90"  rx="6" fill="#C6FF1A"/>
    <rect x="280" y="1700" width="62" height="180" rx="6" fill="#FF2D9B"/>
    <rect x="360" y="1750" width="62" height="130" rx="6" fill="#19E3FF"/>
    <rect x="440" y="1730" width="62" height="150" rx="6" fill="#C6FF1A"/>
    <rect x="520" y="1770" width="62" height="110" rx="6" fill="#FF2D9B"/>
    <rect x="600" y="1710" width="62" height="170" rx="6" fill="#19E3FF"/>
    <rect x="680" y="1755" width="62" height="125" rx="6" fill="#C6FF1A"/>
    <rect x="760" y="1740" width="62" height="140" rx="6" fill="#FF2D9B"/>
    <rect x="840" y="1775" width="62" height="105" rx="6" fill="#19E3FF"/>
    <rect x="920" y="1715" width="62" height="165" rx="6" fill="#C6FF1A"/>
    <rect x="978" y="1745" width="62" height="135" rx="6" fill="#FF2D9B"/>
  </g>
</svg>`;

/* ---- Detola & Wuyi wedding frames (gold on transparent, no event-locked text) ---- */

const dwClassicFrame = svg(`
  <rect x="46" y="46" width="988" height="1828" rx="28" fill="none" stroke="url(#gold)" stroke-width="9"/>
  <rect x="70" y="70" width="940" height="1780" rx="20" fill="none" stroke="url(#gold)" stroke-width="2.5"/>
  ${CORNER(70, 70, 1, 1)}
  ${CORNER(1010, 70, -1, 1)}
  ${CORNER(70, 1850, 1, -1)}
  ${CORNER(1010, 1850, -1, -1)}
`);

const dwMonogramFrame = svg(`
  <rect x="46" y="46" width="988" height="1828" rx="28" fill="none" stroke="url(#gold)" stroke-width="8"/>
  <rect x="68" y="68" width="944" height="1784" rx="20" fill="none" stroke="url(#gold)" stroke-width="2"/>
  ${CORNER(70, 70, 1, 1)}
  ${CORNER(1010, 70, -1, 1)}
  ${FLEUR(540, 152, 0.7)}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="1740" font-size="66" font-weight="700" letter-spacing="6" fill="url(#gold)" stroke="#2A2208" stroke-width="1.2" filter="url(#soft)">DETOLA &amp; WUYI</text>
    <text x="540" y="1740" font-size="66" font-weight="700" letter-spacing="6" fill="url(#gold)">DETOLA &amp; WUYI</text>
    <text x="540" y="1806" font-family="Arial, Helvetica, sans-serif" font-size="30" letter-spacing="14" fill="#E9D9B8">27 · 06 · 2026</text>
  </g>
`);

const dwBanner = svg(`
  ${FLEUR(540, 1492, 0.72)}
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="1656" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" letter-spacing="18" fill="#E9D9B8" opacity="0.95">THE WEDDING OF</text>
    <text x="540" y="1764" font-size="74" font-weight="700" letter-spacing="6" fill="url(#gold)" stroke="#2A2208" stroke-width="1.5" filter="url(#soft)">DETOLA &amp; WUYI</text>
    <text x="540" y="1764" font-size="74" font-weight="700" letter-spacing="6" fill="url(#gold)">DETOLA &amp; WUYI</text>
    <text x="540" y="1836" font-style="italic" font-size="54" fill="url(#gold)">27 June 2026</text>
  </g>
  ${FLEUR(258, 1726, 0.58)}
  ${FLEUR(822, 1726, 0.58)}
`);

const dwCorners = svg(`
  ${CORNER(70, 70, 1, 1)}
  ${CORNER(1010, 70, -1, 1)}
  ${CORNER(70, 1850, 1, -1)}
  ${CORNER(1010, 1850, -1, -1)}
  ${FLEUR(540, 112, 0.58)}
  ${FLEUR(540, 1808, 0.58)}
`);

/* ---- Generic (de-branded) variants of the gala art — no event text ------- */

const classicGoldPlainFrame = svg(`
  <rect x="46" y="46" width="988" height="1828" rx="28" fill="none" stroke="url(#gold)" stroke-width="9"/>
  <rect x="70" y="70" width="940" height="1780" rx="20" fill="none" stroke="url(#gold)" stroke-width="2.5"/>
  ${CORNER(70, 70, 1, 1)}
  ${CORNER(1010, 70, -1, 1)}
  ${CORNER(70, 1850, 1, -1)}
  ${CORNER(1010, 1850, -1, -1)}
  ${FLEUR(540, 1790, 0.7)}
`);

const hexPlainFrame = svg(`
  <g fill="none" stroke="url(#gold)">
    <polygon points="540,70 980,330 980,1590 540,1850 100,1590 100,330" stroke-width="8"/>
    <polygon points="540,110 940,348 940,1572 540,1810 140,1572 140,348" stroke-width="2"/>
  </g>
  ${FLEUR(540, 250, 0.8)}
  ${FLEUR(540, 1670, 0.7)}
`);

const decoPlainFrame = svg(`
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
`);

const minimalPlainFrame = svg(`
  <rect x="38" y="38" width="1004" height="1844" rx="22" fill="none" stroke="url(#gold)" stroke-width="3"/>
`);

const crownPlainSticker = svg(`
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
`);

export const BUILTIN_BORDERS: BuiltinBorder[] = [
  { id: 'frame-classic', name: 'Classic Gold', kind: 'border', svg: classicFrame, legacy: true },
  { id: 'frame-hexagon', name: 'Hexagon (Invitation)', kind: 'border', svg: hexFrame, legacy: true },
  { id: 'frame-deco', name: 'Art Deco', kind: 'border', svg: decoFrame, legacy: true },
  { id: 'frame-minimal', name: 'Minimal Inset', kind: 'border', svg: minimalFrame, legacy: true },
  { id: 'sticker-hopegala', name: 'Hope Gala & Awards', kind: '2d_filter', svg: hopeGalaBanner, legacy: true },
  { id: 'sticker-hopegala-top', name: 'Gala Header', kind: '2d_filter', svg: hopeGalaTop, legacy: true },
  { id: 'sticker-crown', name: 'Golden Crown', kind: '2d_filter', svg: crownSticker, legacy: true },
  { id: 'overlay-confetti', name: 'Gold Confetti', kind: '2d_filter', svg: confettiBottom, recolor: 'gold', tone: '#D4AF37', occasions: ['birthday', 'party', 'wedding'] },
  { id: 'jj-neon-frame', name: 'Neon Tube Frame', kind: 'border', svg: jjNeonFrame, recolor: 'neon', tone: '#FF2D9B', occasions: ['party', 'birthday'] },
  { id: 'jj-lower-third', name: 'JJ Lower Third', kind: 'border', svg: jjLowerThird, legacy: true },
  { id: 'jj-equalizer', name: 'Neon Equalizer', kind: 'border', svg: jjEqualizer, recolor: 'neon', tone: '#FF2D9B', occasions: ['party', 'birthday'] },
  { id: 'dw-frame-monogram', name: 'Detola & Wuyi Frame', kind: 'border', svg: dwMonogramFrame, legacy: true },
  { id: 'dw-banner', name: 'Detola & Wuyi Banner', kind: '2d_filter', svg: dwBanner, legacy: true },
  { id: 'dw-frame-classic', name: 'Gold Border', kind: 'border', svg: dwClassicFrame, recolor: 'gold', tone: '#D4AF37', occasions: ['wedding', 'gala', 'corporate'] },
  { id: 'dw-corners', name: 'Gold Corners', kind: '2d_filter', svg: dwCorners, recolor: 'gold', tone: '#D4AF37', occasions: ['wedding', 'gala'] },
  // Generic de-branded variants of the flagged gala art — same gold language,
  // zero event text; these ARE the self-serve template library additions.
  { id: 'frame-classic-gold', name: 'Classic Gold', kind: 'border', svg: classicGoldPlainFrame, recolor: 'gold', tone: '#D4AF37', occasions: ['wedding', 'gala', 'corporate'] },
  { id: 'frame-hexagon-plain', name: 'Hexagon', kind: 'border', svg: hexPlainFrame, recolor: 'gold', tone: '#D4AF37', occasions: ['gala', 'corporate'] },
  { id: 'frame-deco-plain', name: 'Art Deco', kind: 'border', svg: decoPlainFrame, recolor: 'gold', tone: '#D4AF37', occasions: ['gala', 'corporate', 'party'] },
  { id: 'frame-minimal-plain', name: 'Minimal Inset', kind: 'border', svg: minimalPlainFrame, recolor: 'gold', tone: '#D4AF37', occasions: ['corporate', 'wedding'] },
  { id: 'sticker-crown-plain', name: 'Golden Crown', kind: '2d_filter', svg: crownPlainSticker, recolor: 'gold', tone: '#D4AF37', occasions: ['birthday', 'party'] },
];

export const BORDER_MAP: Record<string, BuiltinBorder> = Object.fromEntries(
  BUILTIN_BORDERS.map((b) => [b.id, b]),
);

/**
 * The subset of built-ins with NO event-locked text (no "Hope Gala", "Detola &
 * Wuyi", etc.) — safe to offer as-is for ANY event, or to riff on as a style
 * template. Curated display names keep the picker clean (the legacy ids carry
 * event-specific prefixes). The others stay available in the studio; they're
 * only excluded from the concierge's "add as-is" so a guest never sees another
 * event's name on their frame.
 */
export const GENERIC_FRAMES: { id: string; name: string }[] = [
  { id: 'dw-frame-classic', name: 'Classic Gold Border' },
  { id: 'dw-corners', name: 'Gold Corner Flourishes' },
  { id: 'jj-neon-frame', name: 'Neon Tube Frame' },
  { id: 'jj-equalizer', name: 'Neon Equalizer' },
  { id: 'overlay-confetti', name: 'Gold Confetti' },
  { id: 'frame-classic-gold', name: 'Classic Gold' },
  { id: 'frame-hexagon-plain', name: 'Hexagon' },
  { id: 'frame-deco-plain', name: 'Art Deco' },
  { id: 'frame-minimal-plain', name: 'Minimal Inset' },
  { id: 'sticker-crown-plain', name: 'Golden Crown' },
];

export const GENERIC_FRAME_IDS = new Set(GENERIC_FRAMES.map((f) => f.id));
