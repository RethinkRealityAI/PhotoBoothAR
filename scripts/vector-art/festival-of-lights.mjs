/**
 * Festival of lights — Diwali, and any night lit by lamps. Hand-built paper
 * scene (see paper.mjs). Layers: gate (carved courtyard doors hung with a
 * marigold toran — they swing open), back (a lamp-lit courtyard under
 * fireworks, with a rangoli on the floor), mid (marigold strands and a star
 * lantern hanging into each top corner).
 */
import { W, H, rng, svg, layer, grain } from './paper.mjs';

const f = (n) => Math.round(n * 10) / 10;
const MARIGOLD = ['#FF9F1C', '#FFB627', '#F77F00', '#FFC93C'];
const JEWEL = ['#E63973', '#7B2CBF', '#00A6A6', '#FFB627', '#F25C05'];

function marigold(x, y, r, fill) {
  let out = `<g transform="translate(${f(x)} ${f(y)})">`;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    out += `<circle cx="${f(Math.cos(a) * r * 0.55)}" cy="${f(Math.sin(a) * r * 0.55)}" r="${f(r * 0.5)}" fill="${fill}"/>`;
  }
  out += `<circle r="${f(r * 0.55)}" fill="rgba(0,0,0,0.12)"/><circle r="${f(r * 0.3)}" fill="${fill}"/>`;
  return out + '</g>';
}

/** A strand of marigolds hanging from (x,y), `n` flowers long. */
function strand(x, y, n, r, rand, sway = 0) {
  let out = `<path d="M${f(x)} ${f(y)} q${f(sway)} ${f(n * r * 0.9)} ${f(sway * 0.6)} ${f(n * r * 1.7)}" stroke="#7A4A1E" stroke-width="2" fill="none"/>`;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    out += marigold(x + Math.sin(t * Math.PI) * sway * 0.6, y + i * r * 1.7, r * (0.9 + rand() * 0.2), MARIGOLD[(i + Math.floor(x)) % MARIGOLD.length]);
  }
  out += `<path d="M${f(x)} ${f(y + n * r * 1.7)} l-6 18 l6 -5 l6 5 Z" fill="#E63973"/>`;
  return out;
}

/** A clay diya with its flame (the flame glows; the life layer flickers over it). */
function diya(x, y, s) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
    <circle cx="0" cy="-26" r="26" fill="#FFB347" opacity="0.32" filter="url(#soft)"/>
    <path d="M0 -40 C8 -28 7 -18 0 -14 C-7 -18 -8 -28 0 -40 Z" fill="#FFD166"/>
    <path d="M0 -32 C4 -26 3 -20 0 -18 C-3 -20 -4 -26 0 -32 Z" fill="#FFF4D6"/>
    <path d="M-30 -14 C-24 6 24 6 30 -14 Z" fill="#C2552B"/>
    <path d="M-30 -14 L30 -14 C26 -10 -26 -10 -30 -14 Z" fill="#E07A3F"/>
    <path d="M-22 -6 L-14 -2 M-6 -2 L2 0 M10 -2 L18 -6" stroke="#FFC93C" stroke-width="2"/>
  </g>`;
}

/** A paper star lantern (kandil) with a tassel. */
function kandil(x, y, s, fill, trim) {
  let pts = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? 22 : 50;
    pts += `${f(Math.cos(a) * rr)},${f(Math.sin(a) * rr)} `;
  }
  let inner = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? 12 : 28;
    inner += `${f(Math.cos(a) * rr)},${f(Math.sin(a) * rr)} `;
  }
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
    <circle r="60" fill="${fill}" opacity="0.3" filter="url(#soft)"/>
    <polygon points="${pts}" fill="${fill}"/>
    <polygon points="${inner}" fill="${trim}" opacity="0.85"/>
    <circle r="7" fill="#FFF4D6"/>
    <path d="M0 50 L0 90" stroke="${trim}" stroke-width="3"/>
    <path d="M-7 86 L7 86 L4 120 L-4 120 Z" fill="${trim}"/>
  </g>`;
}

/** A rangoli seen at an angle: rings of petals, squashed vertically. */
function rangoli(cx, cy, R, squash) {
  let out = `<g transform="translate(${cx} ${cy}) scale(1 ${squash})">`;
  out += `<circle r="${R}" fill="#FFF4E0"/><circle r="${R * 0.94}" fill="#7B2CBF"/>`;
  const rings = [
    [0.94, 16, '#E63973', 0.2],
    [0.72, 12, '#FFB627', 0.24],
    [0.5, 10, '#00A6A6', 0.28],
    [0.3, 8, '#F25C05', 0.32],
  ];
  for (const [rr, n, col, w] of rings) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 360;
      out += `<ellipse cx="0" cy="${f(-R * rr * 0.72)}" rx="${f(R * w * 0.35)}" ry="${f(R * rr * 0.3)}" fill="${col}" transform="rotate(${a})"/>`;
    }
    out += `<circle r="${f(R * rr * 0.42)}" fill="#FFF4E0" opacity="0.25"/>`;
  }
  out += `<circle r="${R * 0.12}" fill="#FFC93C"/>`;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    out += `<circle cx="${f(Math.cos(a) * R * 1.06)}" cy="${f(Math.sin(a) * R * 1.06)}" r="${f(R * 0.035)}" fill="#FFF4E0"/>`;
  }
  return out + '</g>';
}

/** A scalloped Mughal-style arch opening (for the courtyard wall). */
function archWindow(x, y, w, h, fill) {
  const hw = w / 2;
  return `<path d="M${f(x - hw)} ${f(y)} L${f(x - hw)} ${f(y - h + hw * 0.9)} C${f(x - hw)} ${f(y - h + hw * 0.2)} ${f(x - hw * 0.35)} ${f(y - h + hw * 0.1)} ${f(x)} ${f(y - h - hw * 0.2)} C${f(x + hw * 0.35)} ${f(y - h + hw * 0.1)} ${f(x + hw)} ${f(y - h + hw * 0.2)} ${f(x + hw)} ${f(y - h + hw * 0.9)} L${f(x + hw)} ${f(y)} Z" fill="${fill}"/>`;
}

export function back() {
  const r = rng(1031);
  const sky = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140B33"/><stop offset="0.5" stop-color="#2D1458"/><stop offset="0.75" stop-color="#5B1E5E"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  for (let i = 0; i < 50; i++) b += `<circle cx="${f(r() * W)}" cy="${f(r() * 600)}" r="${f(0.8 + r() * 1.4)}" fill="#FFF1D0" opacity="${f(0.3 + r() * 0.6)}"/>`;
  // City of domes and towers on the horizon, lit windows.
  let city = '';
  const roofs = [
    [60, 860, 90], [180, 820, 70], [300, 880, 110], [460, 800, 130], [620, 860, 90], [760, 830, 100], [870, 870, 70],
  ];
  for (const [x, top, w] of roofs) {
    city += `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${1000 - top}" fill="#24104A"/>`;
    city += `<path d="M${x - w / 2} ${top} C${x - w / 2} ${top - w * 0.7} ${x} ${top - w * 0.8} ${x} ${top - w} C${x} ${top - w * 0.8} ${x + w / 2} ${top - w * 0.7} ${x + w / 2} ${top} Z" fill="#24104A"/>`;
    for (let k = 0; k < 4; k++) city += `<rect x="${f(x - w / 2 + 10 + r() * (w - 26))}" y="${f(top + 16 + r() * 90)}" width="7" height="12" rx="3" fill="#FFC93C" opacity="${f(0.5 + r() * 0.5)}"/>`;
  }
  b += layer(1, city);
  // The courtyard wall with three arches, the middle one open to the city.
  let wall = `<rect x="0" y="930" width="${W}" height="420" fill="#B8456A"/>`;
  wall += `<rect x="0" y="930" width="${W}" height="22" fill="#D4627F"/>`;
  b += layer(2, wall);
  b += archWindow(150, 1300, 170, 290, '#5B1E5E') + archWindow(750, 1300, 170, 290, '#5B1E5E') + archWindow(450, 1330, 240, 340, '#3A1560');
  // Inner glow in the arches (lamps inside).
  b += `<ellipse cx="150" cy="1220" rx="60" ry="80" fill="#FFB347" opacity="0.28" filter="url(#soft)"/><ellipse cx="750" cy="1220" rx="60" ry="80" fill="#FFB347" opacity="0.28" filter="url(#soft)"/>`;
  // Marigold torans along the wall top, swagged between the arches.
  let toran = '';
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    const x = t * W;
    const y = 952 + Math.abs(Math.sin(t * Math.PI * 3)) * 40;
    toran += marigold(x, y, 13, MARIGOLD[i % MARIGOLD.length]);
  }
  b += layer(1, toran);
  // Hanging strands down the wall.
  let strands = '';
  for (const x of [40, 270, 630, 860]) strands += strand(x, 960, 7, 13, r, 4);
  b += layer(1, strands);
  // Star lanterns hanging from the top of the frame.
  const lanterns = [
    [120, 560, 1.5, '#7B2CBF', '#FFC93C'],
    [290, 400, 1.9, '#E63973', '#FFC93C'],
    [470, 250, 1.3, '#00A6A6', '#FFC93C'],
    [640, 470, 1.7, '#FFB627', '#E63973'],
    [800, 330, 1.35, '#F25C05', '#FFF1D0'],
  ];
  b += `<path d="${lanterns.map(([x, y, s]) => `M${x} 0 L${x} ${y - 50 * s}`).join(' ')}" stroke="#C99A3E" stroke-width="2"/>`;
  b += layer(1, lanterns.map(([x, y, s, c, t]) => kandil(x, y, s, c, t)).join(''));
  // The floor and the steps lined with diyas.
  b += layer(2, `<rect x="0" y="1330" width="${W}" height="270" fill="#E7B37A"/><rect x="0" y="1330" width="${W}" height="16" fill="#F2C98F"/>`);
  b += layer(2, `<rect x="-10" y="1300" width="${W + 20}" height="34" fill="#F2C98F"/><rect x="-10" y="1300" width="${W + 20}" height="8" fill="#FFE0B0"/>`);
  let lamps = '';
  for (let i = 0; i < 9; i++) lamps += diya(50 + i * 100, 1302, 0.85);
  b += layer(1, lamps);
  // The rangoli on the floor.
  b += layer(1, rangoli(450, 1470, 230, 0.36));
  // Diyas round the rangoli and petals on the floor.
  let ring = '';
  for (let i = 0; i < 10; i++) {
    const a = Math.PI + (i / 9) * Math.PI * -1;
    ring += diya(450 + Math.cos(a) * 300, 1470 + Math.sin(a) * -100 + 40, 0.9);
  }
  b += layer(1, ring);
  let petals = '';
  for (let i = 0; i < 40; i++) petals += `<ellipse cx="${f(r() * W)}" cy="${f(1360 + r() * 240)}" rx="5" ry="3" fill="${MARIGOLD[i % 4]}" transform="rotate(${f(r() * 180)} 0 0)"/>`;
  b += petals;
  b += grain();
  return svg(b, sky);
}

export function gate() {
  const r = rng(888);
  const bg = `<linearGradient id="wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5A2A16"/><stop offset="0.5" stop-color="#7A3A1E"/><stop offset="1" stop-color="#5A2A16"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#wood)"/>`;
  // Two door leaves, each with carved panels and brass studs.
  for (const side of [0, 1]) {
    const x0 = side ? 470 : 30;
    let leaf = '';
    const panels = [
      [x0, 260, 400, 380],
      [x0, 690, 400, 300],
      [x0, 1040, 400, 470],
    ];
    for (const [x, y, w, h] of panels) {
      leaf += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#8C4524"/>`;
      leaf += `<rect x="${x + 22}" y="${y + 22}" width="${w - 44}" height="${h - 44}" rx="8" fill="#6B3219"/>`;
      leaf += archWindow(x + w / 2, y + h - 40, w - 120, h - 110, '#9E5530');
      leaf += archWindow(x + w / 2, y + h - 60, w - 180, h - 160, '#B8683A');
      // A lotus in each arch.
      const lx = x + w / 2;
      const ly = y + h - 90;
      for (let i = -2; i <= 2; i++) leaf += `<ellipse cx="${lx}" cy="${ly - 26}" rx="11" ry="30" fill="#FFC93C" transform="rotate(${i * 26} ${lx} ${ly})"/>`;
      for (let i = 0; i < 6; i++) {
        leaf += `<circle cx="${x + 12 + (i % 2) * (w - 24)}" cy="${y + 12 + Math.floor(i / 2) * ((h - 24) / 2)}" r="7" fill="#E8B04B"/>`;
      }
    }
    // A brass ring handle by the seam.
    const hx = side ? 500 : 400;
    leaf += `<circle cx="${hx}" cy="900" r="16" fill="#E8B04B"/><circle cx="${hx}" cy="940" r="30" fill="none" stroke="#E8B04B" stroke-width="7"/>`;
    b += layer(2, leaf);
  }
  // The seam where the doors meet.
  b += `<rect x="446" y="0" width="8" height="${H}" fill="rgba(0,0,0,0.35)"/>`;
  // A marigold toran across the top, with mango-leaf drops and bells.
  let toran = '';
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    toran += marigold(t * W, 120 + Math.abs(Math.sin(t * Math.PI * 4)) * 60, 22, MARIGOLD[i % MARIGOLD.length]);
  }
  for (let i = 0; i < 9; i++) {
    const x = 50 + i * 100;
    toran += `<path d="M${x} 180 C${x + 16} 200 ${x + 14} 240 ${x} 260 C${x - 14} 240 ${x - 16} 200 ${x} 180 Z" fill="#3E8E4A"/>`;
  }
  b += layer(3, toran);
  let hang = '';
  for (const x of [60, 840]) hang += strand(x, 150, 14, 20, r, 6);
  b += layer(3, hang);
  // A small rangoli on the threshold, and diyas either side of the door.
  b += layer(2, rangoli(450, 1560, 150, 0.35));
  b += layer(2, diya(160, 1560, 1.4) + diya(740, 1560, 1.4));
  b += grain(0.14);
  return svg(b, bg);
}

export function mid() {
  const r = rng(77);
  let body = '';
  // Strands of marigolds hanging from the top edge, longest at the corner.
  [[30, 18], [90, 15], [150, 12], [215, 9], [280, 7], [345, 5]].forEach(([x, n], i) => {
    body += strand(x, -10, n, 21, r, i % 2 ? 6 : -4);
  });
  body = layer(3, body);
  body += layer(2, `<path d="M420 0 L420 300" stroke="#C99A3E" stroke-width="3"/>` + kandil(420, 360, 1.3, JEWEL[0], '#FFC93C'));
  return svg(body, '', { width: 600, height: 900 });
}
