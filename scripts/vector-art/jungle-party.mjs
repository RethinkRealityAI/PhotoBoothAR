/**
 * Jungle party — a kids' birthday in a sunny jungle clearing. Hand-built
 * paper scene (see paper.mjs). Layers: gate (a wall of leaves that slides
 * apart), back (the clearing with the party), mid (a leaf cluster that
 * hangs in each foreground corner).
 */
import { W, H, rng, svg, layer, leaf, frond, flower, band, bunting, grain } from './paper.mjs';

const GREENS = ['#1F7A4D', '#2C8C57', '#3FA266', '#57B474', '#2A6E46', '#368F5B'];
const FLOWERS = ['#FF6B6B', '#FF9F43', '#F368E0', '#FFD23F'];

function canopy(rand, side, y0, count, scale = 1) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = side === 'left' ? -20 + rand() * 170 : W + 20 - rand() * 170;
    const y = y0 + rand() * 520;
    const L = (170 + rand() * 170) * scale;
    const deg = side === 'left' ? 25 + rand() * 70 : -25 - rand() * 70;
    out += leaf(x, y, L, L * (0.26 + rand() * 0.12), deg, GREENS[Math.floor(rand() * GREENS.length)]);
  }
  return out;
}

function toucan(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-10 60 C-40 40 -42 -10 -14 -30 C10 -46 34 -30 34 0 C34 30 20 54 -10 60 Z" fill="#1E1E2A"/>
    <path d="M6 -26 C22 -22 30 -6 28 10 C16 4 6 -8 6 -26 Z" fill="#FFF4D6"/>
    <path d="M24 -24 C70 -30 104 -16 108 -6 C80 -2 48 2 26 -2 Z" fill="#FF8A1E"/>
    <path d="M26 -2 C52 -2 84 -4 108 -6 C96 4 60 8 30 6 Z" fill="#F15A24"/>
    <path d="M104 -10 L112 -6 L104 -2 Z" fill="#1E1E2A"/>
    <circle cx="16" cy="-18" r="7" fill="#7FD1FF"/><circle cx="17" cy="-18" r="3" fill="#1E1E2A"/>
    <path d="M-10 60 L-26 92 L-2 66 Z" fill="#1E1E2A"/>
    <path d="M-4 58 L-6 70 M6 56 L6 68" stroke="#F5A623" stroke-width="4" stroke-linecap="round"/>
  </g>`;
}

function cake(x, y) {
  return `
    <g transform="translate(${x} ${y})">
      <path d="M-120 40 C-120 20 120 20 120 40 L112 120 C112 136 -112 136 -112 120 Z" fill="#9B6A43"/>
      <ellipse cx="0" cy="38" rx="120" ry="20" fill="#C89466"/>
      <ellipse cx="0" cy="38" rx="96" ry="14" fill="none" stroke="#9B6A43" stroke-width="3"/>
      <ellipse cx="0" cy="38" rx="64" ry="9" fill="none" stroke="#9B6A43" stroke-width="3"/>
    </g>
    <g transform="translate(${x} ${y + 30})" filter="url(#lift1)">
      <rect x="-86" y="-70" width="172" height="80" rx="14" fill="#FFB3C7"/>
      <path d="M-86 -52 C-60 -34 -40 -60 -16 -40 C8 -22 30 -58 54 -38 C70 -26 80 -44 86 -50 L86 -70 L-86 -70 Z" fill="#FFF3E0"/>
      <rect x="-58" y="-128" width="116" height="62" rx="12" fill="#8FD4C1"/>
      <path d="M-58 -112 C-40 -96 -22 -118 0 -100 C20 -86 38 -114 58 -100 L58 -128 L-58 -128 Z" fill="#FFF3E0"/>
      ${[-36, -12, 12, 36].map((cx, i) => `<rect x="${cx - 4}" y="-166" width="8" height="38" rx="3" fill="${FLOWERS[i]}"/><path d="M${cx} -182 C${cx + 8} -172 ${cx + 5} -166 ${cx} -164 C${cx - 5} -166 ${cx - 8} -172 ${cx} -182 Z" fill="#FFD23F"/>`).join('')}
    </g>`;
}

function gift(x, y, w, h, fill, ribbon) {
  return `<g transform="translate(${x} ${y})" filter="url(#lift1)"><rect x="${-w / 2}" y="${-h}" width="${w}" height="${h}" rx="5" fill="${fill}"/><rect x="${-w / 2 - 4}" y="${-h - 12}" width="${w + 8}" height="16" rx="4" fill="${fill}"/><rect x="-6" y="${-h - 12}" width="12" height="${h + 12}" fill="${ribbon}"/><path d="M0 ${-h - 12} C-22 ${-h - 40} -30 ${-h - 10} 0 ${-h - 12} C30 ${-h - 10} 22 ${-h - 40} 0 ${-h - 12}Z" fill="${ribbon}"/></g>`;
}

function tiedBalloon(x, y, ax, ay, fill) {
  return `<path d="M${x} ${y + 40} Q${(x + ax) / 2 + 20} ${(y + ay) / 2} ${ax} ${ay}" stroke="rgba(255,255,255,0.8)" stroke-width="2" fill="none"/>
  <g filter="url(#lift1)"><ellipse cx="${x}" cy="${y}" rx="34" ry="42" fill="${fill}"/><path d="M${x - 5} ${y + 41} L${x + 5} ${y + 41} L${x} ${y + 48}Z" fill="${fill}"/><ellipse cx="${x - 12}" cy="${y - 16}" rx="8" ry="13" fill="rgba(255,255,255,0.35)" transform="rotate(-20 ${x - 12} ${y - 16})"/></g>`;
}

export function back() {
  const r = rng(20261122);
  const sky = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6CC8C0"/><stop offset="0.45" stop-color="#BFE6C9"/><stop offset="0.62" stop-color="#FFE7A6"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // Paper sun, in rings.
  b += layer(1, `<circle cx="450" cy="640" r="190" fill="#FFF0B8"/><circle cx="450" cy="640" r="150" fill="#FFE48A"/><circle cx="450" cy="640" r="108" fill="#FFD45E"/>`);
  // Distant hills and jungle line.
  b += layer(1, band(860, 26, 2.2, '#8FD1A8', r, 0.4));
  b += layer(1, band(930, 34, 3.1, '#6DBF8E', r, 1.7));
  b += layer(2, band(1010, 30, 2.6, '#4FA874', r, 2.6));
  // Tree trunks framing the clearing.
  b += layer(2, `<path d="M40 1600 C70 1300 30 1000 110 700 L170 700 C120 1000 170 1300 150 1600 Z" fill="#7A4E2E"/><path d="M860 1600 C830 1300 870 1000 790 700 L730 700 C780 1000 730 1300 750 1600 Z" fill="#7A4E2E"/>`);
  // Bunting between the trees.
  b += layer(1, bunting(120, 760, 780, 760, 70, ['#FF6B6B', '#FFD23F', '#5ED1C6', '#FF9F43', '#A98BFF']));
  b += layer(1, bunting(140, 860, 760, 870, 50, ['#A98BFF', '#FF6B6B', '#FFD23F', '#5ED1C6'], 7));
  // Canopy and vines.
  b += layer(2, canopy(r, 'left', 120, 16) + canopy(r, 'right', 120, 16));
  for (const vx of [210, 330, 600, 700]) {
    const len = 260 + r() * 260;
    b += layer(1, `<path d="M${vx} 0 Q${vx + 20} ${len / 2} ${vx - 6} ${len}" stroke="#2E7A4C" stroke-width="5" fill="none"/>` +
      Array.from({ length: 6 }, (_, i) => leaf(vx + (i % 2 ? 6 : -6), (len * (i + 1)) / 7, 46, 14, i % 2 ? 130 : -130, GREENS[i % GREENS.length])).join('') +
      flower(vx - 6, len + 8, 18, FLOWERS[Math.floor(r() * FLOWERS.length)]));
  }
  // The clearing.
  b += layer(2, band(1150, 22, 1.4, '#86C95F', r, 0.2));
  b += layer(2, band(1250, 18, 1.8, '#6DB24F', r, 1.1));
  // Toucan on a branch.
  b += layer(2, `<path d="M120 1060 C200 1050 260 1068 330 1050" stroke="#6A4327" stroke-width="16" fill="none" stroke-linecap="round"/>` + leaf(300, 1052, 60, 18, 60, '#3FA266'));
  b += layer(2, toucan(215, 990, 1.05));
  // Party on a tree stump.
  b += layer(3, cake(470, 1230));
  b += tiedBalloon(640, 980, 560, 1250, '#FF6B6B') + tiedBalloon(700, 1040, 565, 1252, '#5ED1C6') + tiedBalloon(600, 1080, 562, 1254, '#FFD23F');
  b += layer(2, gift(300, 1330, 80, 70, '#A98BFF', '#FFD23F') + gift(660, 1350, 96, 80, '#FF9F43', '#FFFFFF') + gift(380, 1360, 60, 52, '#5ED1C6', '#FF6B6B'));
  // Flowers and grass tufts.
  for (let i = 0; i < 14; i++) {
    const x = 60 + r() * 780;
    const y = 1390 + r() * 180;
    b += layer(1, leaf(x, y, 60 + r() * 50, 24, -30 + r() * 60, GREENS[i % GREENS.length]) + (i % 3 === 0 ? flower(x + 10, y - 50, 16, FLOWERS[i % FLOWERS.length]) : ''));
  }
  b += grain();
  return svg(b, sky);
}

export function gate() {
  const r = rng(77);
  const bg = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B5E3B"/><stop offset="1" stop-color="#0F4029"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#g)"/>`;
  // Rows of big leaves, deep to near, so the wall has depth.
  for (let row = 0; row < 4; row++) {
    let leaves = '';
    for (let i = 0; i < 26; i++) {
      const x = r() * W;
      const y = r() * (H + 200);
      const L = 220 + r() * 220;
      const side = x < W / 2 ? 1 : -1;
      leaves += leaf(x, y, L, L * (0.3 + r() * 0.1), side * (10 + r() * 60) + (r() - 0.5) * 30, GREENS[(i + row) % GREENS.length]);
    }
    b += layer(Math.min(3, row + 1), leaves);
  }
  for (let i = 0; i < 4; i++) b += layer(2, frond(i < 2 ? 40 : 860, 300 + i * 360, 520, i < 2 ? 55 : -55, '#2C8C57', r));
  // Flowers tucked in.
  let fl = '';
  for (let i = 0; i < 18; i++) fl += flower(60 + r() * 780, 80 + r() * 1440, 18 + r() * 14, FLOWERS[i % FLOWERS.length]);
  b += layer(2, fl);
  // A seam down the middle, where it parts.
  b += `<rect x="447" y="0" width="6" height="${H}" fill="rgba(0,0,0,0.18)"/>`;
  b += grain(0.14);
  return svg(b, bg);
}

export function mid() {
  const r = rng(5);
  let b = '';
  b += layer(3, frond(160, 900, 620, 35, '#236E44', r, 16));
  let l = '';
  for (let i = 0; i < 12; i++) l += leaf(60 + r() * 220, 900, 260 + r() * 220, 70 + r() * 30, -10 + r() * 80, GREENS[i % GREENS.length]);
  b += layer(3, l);
  b += layer(2, flower(260, 640, 34, '#FF6B6B') + flower(140, 720, 26, '#FFD23F') + flower(330, 760, 22, '#F368E0'));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900">${b.length ? '' : ''}${svgDefsOnly()}${b}</svg>`;
}

function svgDefsOnly() {
  return svg('').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}
