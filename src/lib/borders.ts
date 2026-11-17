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
  /** OPT-IN seasonal look. An event's empty allow-list ("show everything")
   *  never includes it (catalog.ts `pick`), and LooksPicker shows it as an
   *  off-by-default tile — it only reaches a booth an explicit list names. */
  seasonal?: Season;
}

/** Seasons an opt-in look can belong to (also the LooksPicker group label). */
export type Season = 'christmas';

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


/* ---- Christmas collection (OPT-IN: `seasonal: 'christmas'`) -------------
 * Hand-built festive art. Every piece is `seasonal`, so an event whose
 * allow-list is empty ("show everything") never gains it — catalog.ts `pick`
 * drops seasonal looks unless an explicit list names them. Gold accents use
 * the GOLD_DEFS ramp (`url(#gold)` / the exact gold tokens), so "Match frames
 * to my colour" recolours only the gold; the reds and greens stay festive.
 * Lettering uses Georgia → generic serif: the SVG is drawn from a data URL,
 * where no webfont can load. Deterministic: no Math.random. */

const n1 = (v: number) => Math.round(v * 10) / 10;

/** Tiny seeded PRNG (mulberry32) so the scattered art is identical every load. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function xsvg(defs: string, inner: string): string {
  return `<svg viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">${GOLD_DEFS}<defs>${defs}</defs>${inner}</svg>`;
}

/** Soft cast shadow: blurred alpha, nudged down, `a` strength, art on top. */
const X_SHADOW = (id: string, blur: number, dy: number, a = 0.45) =>
  `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur}"/><feOffset dy="${dy}"/><feComponentTransfer><feFuncA type="linear" slope="${a}"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

const X_GLOW = (id: string, blur: number) =>
  `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${blur}"/></filter>`;

/* Holly: a leaf (base at origin, tip +x), glossy two-tone, with a vein. */
const LEAF_D = 'M0,0 Q6,-16 20,-24 Q32,-14 44,-29 Q56,-14 68,-25 Q78,-10 89,-15 Q94,-5 106,0 Q94,5 89,15 Q78,10 68,25 Q56,14 44,29 Q32,14 20,24 Q6,16 0,0 Z';
const HOLLY_DEFS = `
  <linearGradient id="lfA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E9A52"/><stop offset=".5" stop-color="#1F6B34"/><stop offset="1" stop-color="#0B3B1B"/></linearGradient>
  <linearGradient id="lfB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2F7F43"/><stop offset=".55" stop-color="#16522A"/><stop offset="1" stop-color="#082C14"/></linearGradient>
  <radialGradient id="bry" cx=".38" cy=".34" r=".7"><stop offset="0" stop-color="#FF8A80"/><stop offset=".35" stop-color="#E0182F"/><stop offset=".8" stop-color="#8E0A19"/><stop offset="1" stop-color="#5A0410"/></radialGradient>
  <g id="hl"><path d="${LEAF_D}" fill="url(#lfA)"/><path d="M0,0 Q6,-16 20,-24 Q32,-14 44,-29 Q56,-14 68,-25 Q78,-10 89,-15 Q94,-5 106,0 Q60,-6 0,0 Z" fill="#FFFFFF" opacity=".13"/><path d="M3,0 Q52,-4 100,0" fill="none" stroke="#9FD8A0" stroke-width="2.2" opacity=".75"/></g>
  <g id="hd"><path d="${LEAF_D}" fill="url(#lfB)"/><path d="M3,0 Q52,-4 100,0" fill="none" stroke="#7CC08A" stroke-width="2" opacity=".6"/></g>
  <g id="bc"><circle r="13" fill="url(#bry)"/><ellipse cx="-4.5" cy="-5" rx="4" ry="2.6" fill="#FFFFFF" opacity=".8" transform="rotate(-35 -4.5 -5)"/><circle cx="4" cy="8" r="1.6" fill="#3A0208" opacity=".7"/></g>`;

function holly(x: number, y: number, s: number, leaves: [number, 'hl' | 'hd'][], berries: [number, number][]): string {
  const l = leaves.map(([rot, kind]) => `<use href="#${kind}" transform="rotate(${rot})"/>`).join('');
  const b = berries.map(([bx, by]) => `<use href="#bc" x="${bx}" y="${by}"/>`).join('');
  return `<g transform="translate(${x},${y}) scale(${s})">${l}${b}</g>`;
}

const hollyCorner = `
  ${holly(330, 58, 1.0, [[-6, 'hl'], [186, 'hd'], [24, 'hd'], [160, 'hl']], [[0, 0], [16, -6], [6, 12]])}
  ${holly(58, 330, 1.0, [[96, 'hl'], [-84, 'hd'], [70, 'hd'], [-110, 'hl']], [[0, 0], [-6, 16], [12, 6]])}
  ${holly(74, 78, 1.9, [[2, 'hd'], [92, 'hd'], [16, 'hl'], [78, 'hl'], [34, 'hd'], [58, 'hd'], [46, 'hl']], [[12, 10], [32, 4], [20, 28], [6, 32], [36, 24], [24, 14]])}`;

const xmasHollyFrame = xsvg(`${HOLLY_DEFS}${X_SHADOW('xs', 5, 7)}`, `
  <rect x="30" y="30" width="1020" height="1860" rx="30" fill="none" stroke="url(#gold)" stroke-width="6"/>
  <rect x="50" y="50" width="980" height="1820" rx="22" fill="none" stroke="url(#gold)" stroke-width="1.6" opacity=".85"/>
  <g filter="url(#xs)">
    ${hollyCorner}
    <g transform="rotate(180 540 960)">${hollyCorner}</g>
    ${holly(1000, 74, 0.9, [[150, 'hl'], [112, 'hd'], [178, 'hd']], [[-6, 6], [-20, 0]])}
    ${holly(80, 1846, 0.9, [[-30, 'hl'], [-68, 'hd'], [2, 'hd']], [[6, -6], [20, 0]])}
  </g>`);

/* String lights: a dark wire swagging round the edge, C9 bulbs that glow. */
const BULB_COLORS: [string, string, string][] = [
  ['r', '#FF5A4E', '#B3101E'],
  ['g', '#7DF28E', '#12823A'],
  ['y', '#FBF3D9', '#D4AF37'],
  ['b', '#7FC6FF', '#1A56C4'],
  ['w', '#FFF6DE', '#FFB547'],
];
const LIGHTS_DEFS = `
  ${BULB_COLORS.map(([k, hi, lo]) => `<radialGradient id="gl${k}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${hi}" stop-opacity=".95"/><stop offset=".45" stop-color="${lo}" stop-opacity=".45"/><stop offset="1" stop-color="${lo}" stop-opacity="0"/></radialGradient><radialGradient id="bg${k}" cx=".42" cy=".62" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".3" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></radialGradient>`).join('')}
  <linearGradient id="sk" x1="0" x2="1"><stop offset="0" stop-color="#0E2414"/><stop offset=".45" stop-color="#3C6B46"/><stop offset="1" stop-color="#0A1C10"/></linearGradient>
  ${BULB_COLORS.map(([k]) => `<g id="b${k}"><circle cy="34" r="46" fill="url(#gl${k})"/><path d="M0,8 C12,8 16,22 14,34 C12,46 4,54 0,57 C-4,54 -12,46 -14,34 C-16,22 -12,8 0,8 Z" fill="url(#bg${k})"/><ellipse cx="-5" cy="27" rx="2.8" ry="9" fill="#FFFFFF" opacity=".8"/><rect x="-8" y="-5" width="16" height="15" rx="3" fill="url(#sk)"/></g>`).join('')}`;

type XPt = [number, number];

/** Drop a bulb every `every` px of arc length along a dense polyline. */
function lightsAlong(pts: XPt[], every: number, startIdx: number, rotBase: number): string {
  let out = '';
  let acc = every / 2;
  let i = startIdx;
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1];
    const [x1, y1] = pts[k];
    acc += Math.hypot(x1 - x0, y1 - y0);
    if (acc >= every) {
      acc -= every;
      const c = BULB_COLORS[i++ % BULB_COLORS.length][0];
      const rot = rotBase + Math.sin(i * 1.7) * 14;
      out += `<use href="#b${c}" transform="translate(${n1(x1)},${n1(y1)}) rotate(${n1(rot)})"/>`;
    }
  }
  return out;
}

function swag(x0: number, x1: number, y: number, sag: number, steps = 40): XPt[] {
  const pts: XPt[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    pts.push([x0 + (x1 - x0) * t, y + sag * 4 * t * (1 - t)]);
  }
  return pts;
}
const polyD = (pts: XPt[]) => 'M' + pts.map(([x, y]) => `${n1(x)},${n1(y)}`).join(' L');

const lightsWire = (() => {
  const top = [...swag(30, 300, 40, 70), ...swag(300, 540, 40, 60).slice(1), ...swag(540, 780, 40, 60).slice(1), ...swag(780, 1050, 40, 70).slice(1)];
  const side = (x: number, dir: number): XPt[] => Array.from({ length: 61 }, (_, k) => [x + dir * 14 * Math.sin(k / 6), 40 + k * 30] as XPt);
  const bottom = [...swag(30, 380, 1880, -46), ...swag(380, 700, 1880, -40).slice(1), ...swag(700, 1050, 1880, -46).slice(1)];
  const left = side(34, 1);
  const right = side(1046, -1);
  const wire = [top, left, right, bottom].map((p) => `<path d="${polyD(p)}"/>`).join('');
  const bulbs = lightsAlong(top, 68, 0, 0) + lightsAlong(left, 92, 2, -90) + lightsAlong(right, 92, 4, 90) + lightsAlong(bottom, 72, 1, 180);
  return { wire, bulbs };
})();

const xmasLightsFrame = xsvg(LIGHTS_DEFS, `
  <g fill="none" stroke="#10261A" stroke-width="4.5" stroke-linecap="round" opacity=".95">${lightsWire.wire}</g>
  <g fill="none" stroke="#4E7A58" stroke-width="1.2" opacity=".55" transform="translate(-1,-1.5)">${lightsWire.wire}</g>
  ${lightsWire.bulbs}`);

/* Candy cane: a striped tube frame with real tube shading, a gold bow on top
 * and two canes standing in the bottom corners. */
const CANE_DEFS = `
  <pattern id="cs" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><rect width="64" height="64" fill="#FFF8F1"/><rect width="26" height="64" fill="#D7142F"/><rect x="38" width="7" height="64" fill="#D7142F"/></pattern>
  <radialGradient id="bw" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#FBF3D9"/><stop offset=".3" stop-color="#E8C766"/><stop offset=".7" stop-color="#D4AF37"/><stop offset="1" stop-color="#7E5C14"/></radialGradient>
  ${X_SHADOW('xs', 6, 8, 0.5)}
  <filter id="hb" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.2"/></filter>`;

/** A rounded-rect ring at inset `i` (radius grows/shrinks with the inset). */
const ring = (i: number, rx: number, extra: string) =>
  `<rect x="${i}" y="${i}" width="${1080 - 2 * i}" height="${1920 - 2 * i}" rx="${rx}" fill="none" ${extra}/>`;

/** Tube shading for any stroked path of width w: dark rim, gloss line, inner rim. */
const caneD = 'M0,0 L0,-300 C0,-372 104,-372 104,-300 L104,-278';
function cane(x: number, y: number, flip: number, rot: number): string {
  return `<g transform="translate(${x},${y}) scale(${flip},1) rotate(${rot})" fill="none" stroke-linecap="round">
    <path d="${caneD}" stroke="#5E0612" stroke-width="40" opacity=".35"/>
    <path d="${caneD}" stroke="url(#cs)" stroke-width="34"/>
    <path d="${caneD}" stroke="#000000" stroke-width="34" opacity=".12" transform="translate(5,2)" stroke-dasharray="0"/>
    <path d="${caneD}" stroke="#FFFFFF" stroke-width="7" opacity=".55" transform="translate(-8,0)" filter="url(#hb)"/>
  </g>`;
}

const goldBow = `
  <g transform="translate(540,52)">
    <path d="M-12,12 C-34,62 -62,112 -84,154 L-54,144 L-40,176 C-22,114 -6,62 8,14 Z" fill="url(#gold)" stroke="#7E5C14" stroke-width="2"/>
    <path d="M12,12 C34,62 62,112 84,154 L54,144 L40,176 C22,114 6,62 -8,14 Z" fill="url(#gold)" stroke="#7E5C14" stroke-width="2"/>
    <path d="M0,0 C-44,-74 -160,-84 -150,-8 C-144,44 -54,34 0,0 Z" fill="url(#bw)" stroke="#7E5C14" stroke-width="2.5"/>
    <path d="M0,0 C44,-74 160,-84 150,-8 C144,44 54,34 0,0 Z" fill="url(#bw)" stroke="#7E5C14" stroke-width="2.5"/>
    <path d="M-4,0 C-44,-44 -116,-50 -120,-14 C-96,-34 -50,-24 -4,0 Z" fill="#7E5C14" opacity=".6"/>
    <path d="M4,0 C44,-44 116,-50 120,-14 C96,-34 50,-24 4,0 Z" fill="#7E5C14" opacity=".6"/>
    <path d="M-6,4 C-50,30 -120,34 -146,4" fill="none" stroke="#7E5C14" stroke-width="3" opacity=".5"/>
    <path d="M6,4 C50,30 120,34 146,4" fill="none" stroke="#7E5C14" stroke-width="3" opacity=".5"/>
    <path d="M-30,-40 C-70,-62 -118,-58 -128,-30" fill="none" stroke="#FBF3D9" stroke-width="4" stroke-linecap="round" opacity=".8"/>
    <path d="M30,-40 C70,-62 118,-58 128,-30" fill="none" stroke="#FBF3D9" stroke-width="4" stroke-linecap="round" opacity=".8"/>
    <ellipse cx="0" cy="2" rx="27" ry="31" fill="url(#bw)" stroke="#7E5C14" stroke-width="2.5"/>
    <ellipse cx="-7" cy="-8" rx="7" ry="11" fill="#FBF3D9" opacity=".7"/>
  </g>`;

const xmasCandyCaneFrame = xsvg(`${CANE_DEFS}${HOLLY_DEFS}`, `
  <g filter="url(#xs)">
    ${ring(36, 44, 'stroke="url(#cs)" stroke-width="42"')}
  </g>
  ${ring(17, 60, 'stroke="#4A0410" stroke-width="5" opacity=".35"')}
  ${ring(28, 52, 'stroke="#FFFFFF" stroke-width="6" opacity=".6" filter="url(#hb)"')}
  ${ring(52, 30, 'stroke="#3A0208" stroke-width="9" opacity=".22"')}
  ${ring(57, 26, 'stroke="#FFFFFF" stroke-width="1.5" opacity=".5"')}
  <g filter="url(#xs)">
    ${cane(118, 1890, 1, -6)}
    ${cane(962, 1890, -1, -6)}
    ${holly(540, 40, 0.9, [[150, 'hd'], [30, 'hd'], [200, 'hl'], [-20, 'hl']], [])}
    ${goldBow}
    ${holly(146, 1612, 0.75, [[-40, 'hl'], [-110, 'hd'], [10, 'hd']], [[0, 0], [14, -8], [4, 15]])}
    ${holly(934, 1612, 0.75, [[220, 'hl'], [290, 'hd'], [170, 'hd']], [[0, 0], [-14, -8], [-4, 15]])}
  </g>`);

/* Snowy pine garland: layered needle tufts along a swag, snow on top, pine
 * cones and glass baubles hanging from it. */
function tuft(id: string, seed: number, cols: string[]): string {
  const r = seeded(seed);
  let d = '';
  const by: Record<string, string> = {};
  for (let k = 0; k < 18; k++) {
    const t = k / 18;
    const x = 4 + t * 66;
    const side = k % 2 === 0 ? -1 : 1;
    const ang = (side * (32 + r() * 26) * Math.PI) / 180;
    const len = 24 + r() * 16 * (1 - t * 0.4);
    const c = cols[Math.floor(r() * cols.length)];
    by[c] = (by[c] ?? '') + `M${n1(x)},0 l${n1(Math.cos(ang) * len)},${n1(Math.sin(ang) * len)}`;
  }
  for (const [c, p] of Object.entries(by)) d += `<path d="${p}" stroke="${c}"/>`;
  return `<g id="${id}" fill="none" stroke-width="3.4" stroke-linecap="round"><path d="M0,0 L74,0" stroke="#4A3220" stroke-width="3"/>${d}</g>`;
}

const PINE_DEFS = `
  ${tuft('t1', 11, ['#0E3A1E', '#14502A', '#1C6434'])}
  ${tuft('t2', 23, ['#1F6B38', '#2A8046', '#16502A'])}
  ${tuft('t3', 37, ['#2E8A4C', '#3FA05C', '#1F6B38'])}
  <radialGradient id="snw" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#F2F7FF"/><stop offset="1" stop-color="#C9D8EC"/></radialGradient>
  <g id="sn"><path d="M-30,4 C-26,-8 -12,-12 -2,-8 C6,-16 22,-12 28,-2 C34,2 30,8 22,8 C8,12 -14,12 -26,9 C-32,8 -33,6 -30,4 Z" fill="url(#snw)"/><ellipse cx="-6" cy="-5" rx="10" ry="3" fill="#FFFFFF"/></g>
  <radialGradient id="cn" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#B07A4A"/><stop offset=".6" stop-color="#6E4325"/><stop offset="1" stop-color="#3A2010"/></radialGradient>
  <g id="cone"><ellipse cx="0" cy="30" rx="17" ry="32" fill="#3A2010"/>${Array.from({ length: 7 })
    .map((_, row) => {
      const y = 6 + row * 9;
      const w = 6 + Math.sin(((row + 0.8) / 7.5) * Math.PI) * 11;
      const n = row % 2 ? 3 : 2;
      return Array.from({ length: n }, (_, c) => {
        const x = -w + (2 * w * c) / (n - 1);
        return `<ellipse cx="${n1(x)}" cy="${y}" rx="8" ry="6" fill="url(#cn)" stroke="#2A160A" stroke-width="1.1"/>`;
      }).join('');
    })
    .join('')}<path d="M-9,4 q9,-12 18,0 q-9,-3 -18,0 Z" fill="#FFFFFF" opacity=".9"/></g>
  <radialGradient id="ornR" cx=".36" cy=".32" r=".72"><stop offset="0" stop-color="#FF9C94"/><stop offset=".3" stop-color="#E0182F"/><stop offset=".8" stop-color="#7A0A16"/><stop offset="1" stop-color="#3E0409"/></radialGradient>
  <radialGradient id="ornG" cx=".36" cy=".32" r=".72"><stop offset="0" stop-color="#FBF3D9"/><stop offset=".3" stop-color="#E8C766"/><stop offset=".75" stop-color="#B8860B"/><stop offset="1" stop-color="#7E5C14"/></radialGradient>
  <radialGradient id="ornE" cx=".36" cy=".32" r=".72"><stop offset="0" stop-color="#9AF0B4"/><stop offset=".3" stop-color="#1E8A48"/><stop offset=".8" stop-color="#0B4022"/><stop offset="1" stop-color="#05200F"/></radialGradient>
  ${X_SHADOW('xs', 6, 9, 0.5)}
  ${X_SHADOW('ss', 2, 3, 0.25)}`;

function bauble(x: number, y: number, r: number, grad: string, thread: number): string {
  return `<g transform="translate(${x},${y})">
    <path d="M0,${-r - thread} L0,${-r}" stroke="url(#gold)" stroke-width="2.2"/>
    <circle r="${r}" fill="url(#${grad})"/>
    <path d="M${n1(-r * 0.92)},${n1(r * 0.1)} Q0,${n1(r * 0.42)} ${n1(r * 0.92)},${n1(r * 0.1)}" fill="none" stroke="#FFFFFF" stroke-width="${n1(r * 0.08)}" opacity=".22"/>
    <ellipse cx="${n1(-r * 0.36)}" cy="${n1(-r * 0.4)}" rx="${n1(r * 0.2)}" ry="${n1(r * 0.12)}" fill="#FFFFFF" opacity=".85" transform="rotate(-38 ${n1(-r * 0.36)} ${n1(-r * 0.4)})"/>
    <circle cx="${n1(r * 0.42)}" cy="${n1(r * 0.48)}" r="${n1(r * 0.1)}" fill="#FFFFFF" opacity=".25"/>
    <rect x="${n1(-r * 0.3)}" y="${n1(-r - 8)}" width="${n1(r * 0.6)}" height="12" rx="2.5" fill="url(#goldV)" stroke="#7E5C14" stroke-width="1"/>
  </g>`;
}

const pineGarland = (() => {
  const r = seeded(7);
  const sagY = (x: number) => 78 + 150 * 4 * ((x + 40) / 1160) * (1 - (x + 40) / 1160);
  const at = (x: number) => [x, sagY(x)] as const;
  let back = '';
  let mid = '';
  let front = '';
  let snow = '';
  for (let k = 0, x = -40; x <= 1120; k++, x += 15) {
    const [, y] = at(x);
    const layer = (cls: string, jitterY: number, s: number) =>
      `<use href="#${cls}" transform="translate(${n1(x + (r() - 0.5) * 10)},${n1(y + jitterY + (r() - 0.5) * 16)}) rotate(${n1(r() * 360)}) scale(${n1(s)})"/>`;
    back += layer('t1', -6, 1.25 + r() * 0.3);
    mid += layer('t2', 4, 1.05 + r() * 0.25);
    if (k % 2 === 0) front += layer('t3', 10, 0.85 + r() * 0.2);
    if (k % 3 === 1 && r() > 0.3) snow += `<use href="#sn" transform="translate(${n1(x + (r() - 0.5) * 20)},${n1(y - 30 + r() * 26)}) rotate(${n1((r() - 0.5) * 30)}) scale(${n1(0.55 + r() * 0.45)})"/>`;
  }
  const cones = [150, 455, 640, 930]
    .map((x, i) => `<use href="#cone" transform="translate(${x},${n1(sagY(x) + 6)}) rotate(${i % 2 ? 14 : -12}) scale(.95)"/>`)
    .join('');
  const baubles = [
    bauble(96, n1(sagY(96) + 74), 30, 'ornR', 24),
    bauble(300, n1(sagY(300) + 96), 38, 'ornG', 38),
    bauble(540, n1(sagY(540) + 104), 46, 'ornR', 40),
    bauble(780, n1(sagY(780) + 96), 38, 'ornG', 38),
    bauble(984, n1(sagY(984) + 74), 30, 'ornR', 24),
    bauble(420, n1(sagY(420) + 60), 22, 'ornE', 14),
    bauble(660, n1(sagY(660) + 60), 22, 'ornE', 14),
  ].join('');
  return `<g filter="url(#xs)">${back}${mid}${front}${cones}</g><g filter="url(#ss)">${snow}</g><g filter="url(#xs)">${baubles}</g>`;
})();

const xmasPineGarland = xsvg(PINE_DEFS, pineGarland);

/* Falling snow overlay: soft flakes, bokeh discs and a few crystals, kept
 * off the face, settling into a drift along the bottom. */
const SNOW_DEFS = `
  <radialGradient id="fk" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity=".85"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
  <radialGradient id="bk" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".18"/><stop offset=".82" stop-color="#EAF2FF" stop-opacity=".28"/><stop offset="1" stop-color="#EAF2FF" stop-opacity="0"/></radialGradient>
  <g id="cr" fill="none" stroke="#FFFFFF" stroke-linecap="round">${[0, 60, 120]
    .map((a) => `<g transform="rotate(${a})"><path d="M0,-20 L0,20 M0,-12 l-6,-6 M0,-12 l6,-6 M0,12 l-6,6 M0,12 l6,6" stroke-width="2.4"/></g>`)
    .join('')}<circle r="3" fill="#FFFFFF"/></g>
  ${X_GLOW('gw', 3)}
  ${X_GLOW('dbl', 5)}
  <linearGradient id="dr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#EEF4FC"/><stop offset="1" stop-color="#C8D7EA"/></linearGradient>
  <linearGradient id="drs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9DB4D3" stop-opacity=".0"/><stop offset="1" stop-color="#8FA8CC" stop-opacity=".65"/></linearGradient>`;

const snowfall = (() => {
  const r = seeded(2025);
  const clear = (x: number, y: number) => ((x - 540) / 380) ** 2 + ((y - 860) / 540) ** 2 < 1;
  let dots = '';
  let bokeh = '';
  let crys = '';
  for (let i = 0; i < 230; i++) {
    const x = r() * 1080;
    const y = r() * 1800;
    const rad = 2.5 + r() ** 2 * 8;
    if (clear(x, y)) continue;
    dots += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(rad)}" opacity="${n1(0.55 + r() * 0.45)}"/>`;
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * 1080;
    const y = r() * 1760;
    if (clear(x, y)) continue;
    bokeh += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(16 + r() * 22)}"/>`;
  }
  for (let i = 0; i < 18; i++) {
    const x = r() * 1080;
    const y = r() * 1700;
    if (clear(x, y)) continue;
    crys += `<use href="#cr" transform="translate(${n1(x)},${n1(y)}) rotate(${n1(r() * 60)}) scale(${n1(0.7 + r() * 0.9)})" opacity="${n1(0.7 + r() * 0.3)}"/>`;
  }
  return { dots, bokeh, crys };
})();

const xmasSnowfall = xsvg(SNOW_DEFS, `
  <g fill="url(#bk)">${snowfall.bokeh}</g>
  <g fill="url(#fk)">${snowfall.dots}</g>
  <g filter="url(#gw)" opacity=".8">${snowfall.crys}</g>
  ${snowfall.crys}
  <g filter="url(#dbl)" opacity=".95">
    <path d="M0,1846 C90,1818 200,1838 300,1830 C430,1818 520,1850 650,1840 C790,1828 900,1812 1080,1838 L1080,1920 L0,1920 Z" fill="url(#dr)"/>
  </g>
  <path d="M0,1872 C140,1850 260,1868 400,1862 C560,1854 700,1880 860,1868 C960,1860 1020,1858 1080,1866 L1080,1920 L0,1920 Z" fill="url(#drs)"/>
  ${star(180, 1846, 0.9)}${star(470, 1838, 0.7)}${star(760, 1844, 1.0)}${star(980, 1836, 0.7)}${star(330, 1888, 0.6)}${star(860, 1892, 0.6)}`);

/* Banner sticker: velvet ribbon, gold serif lettering, holly at the ends. */
function xmasBanner(top: string, main: string, sub: string): string {
  return xsvg(`${HOLLY_DEFS}${X_SHADOW('xs', 6, 8, 0.55)}
    <linearGradient id="rb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E43048"/><stop offset=".18" stop-color="#C8102E"/><stop offset=".75" stop-color="#8A0A1A"/><stop offset="1" stop-color="#5E0612"/></linearGradient>
    <linearGradient id="rt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A30D22"/><stop offset="1" stop-color="#4A0410"/></linearGradient>`, `
  <g filter="url(#xs)">
    <path d="M150,1702 L34,1714 L78,1764 L34,1814 L168,1806 Z" fill="url(#rt)"/>
    <path d="M930,1702 L1046,1714 L1002,1764 L1046,1814 L912,1806 Z" fill="url(#rt)"/>
    <path d="M120,1798 L168,1806 L168,1780 Z" fill="#3E0409"/>
    <path d="M960,1798 L912,1806 L912,1780 Z" fill="#3E0409"/>
    <path d="M120,1676 Q540,1606 960,1676 L960,1798 Q540,1728 120,1798 Z" fill="url(#rb)"/>
    <path d="M120,1676 Q540,1606 960,1676" fill="none" stroke="url(#gold)" stroke-width="6"/>
    <path d="M120,1798 Q540,1728 960,1798" fill="none" stroke="url(#gold)" stroke-width="6"/>
    <path d="M130,1690 Q540,1622 950,1690" fill="none" stroke="#FFFFFF" stroke-width="3" opacity=".25"/>
    ${holly(118, 1736, 0.85, [[200, 'hl'], [150, 'hd'], [250, 'hd']], [[-4, -4], [10, 6], [-10, 12]])}
    ${holly(962, 1736, 0.85, [[-20, 'hl'], [30, 'hd'], [-70, 'hd']], [[4, -4], [-10, 6], [10, 12]])}
  </g>
  <g text-anchor="middle" font-family="Georgia, 'Times New Roman', serif">
    <text x="540" y="1606" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="700" letter-spacing="14" fill="#FBF3D9" filter="url(#xs)">${top}</text>
    <text x="540" y="1746" font-size="92" font-style="italic" font-weight="700" fill="#3A0208" opacity=".55" transform="translate(0,5)">${main}</text>
    <text x="540" y="1746" font-size="92" font-style="italic" font-weight="700" fill="url(#goldV)" stroke="#7E5C14" stroke-width="1.2">${main}</text>
    <text x="540" y="1866" font-size="44" font-style="italic" fill="url(#gold)" filter="url(#xs)">${sub}</text>
  </g>
  ${star(186, 1594, 1.1)}${star(894, 1594, 1.1)}${star(196, 1862, 0.8)}${star(884, 1862, 0.8)}`);
}

const xmasMerryBanner = xmasBanner('SEASON’S GREETINGS', 'Merry Christmas', '&amp; a Happy New Year');
const xmasHolidaysBanner = xmasBanner('WARMEST WISHES', 'Happy Holidays', 'from all of us');

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
  // Christmas collection — OPT-IN (`seasonal`): never shown by an empty
  // allow-list, so no existing event's booth changes. Gold accents recolour.
  { id: 'xmas-holly', name: 'Holly & Berries', kind: 'border', svg: xmasHollyFrame, recolor: 'gold', tone: '#1F6B34', occasions: ['party', 'corporate'], seasonal: 'christmas' },
  { id: 'xmas-lights', name: 'Twinkle Lights', kind: 'border', svg: xmasLightsFrame, recolor: 'gold', tone: '#E0182F', occasions: ['party', 'corporate', 'birthday'], seasonal: 'christmas' },
  { id: 'xmas-candy-cane', name: 'Candy Cane', kind: 'border', svg: xmasCandyCaneFrame, recolor: 'gold', tone: '#D7142F', occasions: ['party', 'birthday'], seasonal: 'christmas' },
  { id: 'xmas-pine-garland', name: 'Snowy Pine Garland', kind: '2d_filter', svg: xmasPineGarland, recolor: 'gold', tone: '#1F6B38', occasions: ['party', 'corporate', 'gala'], seasonal: 'christmas' },
  { id: 'xmas-snowfall', name: 'Falling Snow', kind: '2d_filter', svg: xmasSnowfall, recolor: 'gold', tone: '#C8D7EA', occasions: ['party', 'corporate', 'wedding'], seasonal: 'christmas' },
  { id: 'xmas-banner-merry', name: 'Merry Christmas Banner', kind: '2d_filter', svg: xmasMerryBanner, recolor: 'gold', tone: '#C8102E', occasions: ['party', 'corporate'], seasonal: 'christmas' },
  { id: 'xmas-banner-holidays', name: 'Happy Holidays Banner', kind: '2d_filter', svg: xmasHolidaysBanner, recolor: 'gold', tone: '#C8102E', occasions: ['corporate', 'party'], seasonal: 'christmas' },
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
  // Christmas (opt-in — see BuiltinBorder.seasonal).
  { id: 'xmas-holly', name: 'Holly & Berries' },
  { id: 'xmas-lights', name: 'Twinkle Lights' },
  { id: 'xmas-candy-cane', name: 'Candy Cane' },
  { id: 'xmas-pine-garland', name: 'Snowy Pine Garland' },
  { id: 'xmas-snowfall', name: 'Falling Snow' },
  { id: 'xmas-banner-merry', name: 'Merry Christmas Banner' },
  { id: 'xmas-banner-holidays', name: 'Happy Holidays Banner' },
];

export const GENERIC_FRAME_IDS = new Set(GENERIC_FRAMES.map((f) => f.id));
