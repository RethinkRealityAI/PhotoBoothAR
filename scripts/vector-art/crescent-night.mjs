/**
 * Crescent night — Eid, Ramadan iftars, any evening under a new moon.
 * Hand-built paper scene (see paper.mjs). Layers: gate (a carved lattice
 * screen; an arch opens through it), back (a courtyard at dusk: a crescent
 * moon over domes and minarets, lanterns, palms and a reflecting pool), mid
 * (lanterns hanging into each top corner).
 */
import { W, H, rng, svg, layer, leaf, grain } from './paper.mjs';

const f = (n) => Math.round(n * 10) / 10;

/** An eight-pointed star (two squares) centred at (x,y), radius r. */
function star8(x, y, r, fill, stroke = 'none', sw = 0) {
  let d = '';
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
    const rr = i % 2 ? r * 0.72 : r;
    d += `${i ? 'L' : 'M'}${f(x + Math.cos(a) * rr)} ${f(y + Math.sin(a) * rr)} `;
  }
  return `<path d="${d}Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

/** A pierced metal lantern (fanous) hanging from a chain at (x,y). */
function fanous(x, y, s, body, glass) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
    <ellipse cx="0" cy="40" rx="70" ry="80" fill="${glass}" opacity="0.28" filter="url(#soft)"/>
    <path d="M0 -40 L0 -10" stroke="${body}" stroke-width="3"/>
    <circle cy="-8" r="6" fill="${body}"/>
    <path d="M-14 0 L14 0 L24 18 L-24 18 Z" fill="${body}"/>
    <path d="M-24 18 L24 18 L30 70 L0 92 L-30 70 Z" fill="${glass}"/>
    <path d="M-24 18 L-30 70 L0 92 L0 18 Z" fill="rgba(0,0,0,0.14)"/>
    <path d="M-12 30 L-12 70 M0 26 L0 84 M12 30 L12 70" stroke="${body}" stroke-width="3" opacity="0.8"/>
    <path d="M-30 70 L0 92 L30 70" stroke="${body}" stroke-width="4" fill="none"/>
    <path d="M0 92 L0 112" stroke="${body}" stroke-width="3"/>
    <circle cy="116" r="5" fill="${body}"/>
  </g>`;
}

function dome(x, base, w, fill, finial) {
  const h = w * 0.95;
  return `<path d="M${f(x - w / 2)} ${f(base)} C${f(x - w / 2)} ${f(base - h * 0.75)} ${f(x - w * 0.12)} ${f(base - h * 0.85)} ${f(x)} ${f(base - h)} C${f(x + w * 0.12)} ${f(base - h * 0.85)} ${f(x + w / 2)} ${f(base - h * 0.75)} ${f(x + w / 2)} ${f(base)} Z" fill="${fill}"/>
  <path d="M${f(x)} ${f(base - h)} L${f(x)} ${f(base - h - 34)}" stroke="${finial}" stroke-width="4"/>
  <path d="M${f(x + 4)} ${f(base - h - 50)} a10 10 0 1 0 0 16 a8 8 0 1 1 0 -16 Z" fill="${finial}"/>`;
}

function minaret(x, base, h, fill, finial) {
  const w = 34;
  return `<rect x="${x - w / 2}" y="${base - h}" width="${w}" height="${h}" fill="${fill}"/>
  <rect x="${x - w / 2 - 8}" y="${base - h * 0.62}" width="${w + 16}" height="10" fill="${fill}"/>
  <rect x="${x - w / 2 - 8}" y="${base - h - 6}" width="${w + 16}" height="10" fill="${fill}"/>
  <path d="M${x - w / 2} ${base - h} L${x} ${base - h - 70} L${x + w / 2} ${base - h} Z" fill="${fill}"/>
  <path d="M${x} ${base - h - 70} L${x} ${base - h - 96}" stroke="${finial}" stroke-width="3"/>`;
}

function palm(x, base, h, fill, rand) {
  let out = `<path d="M${x} ${base} C${x + 14} ${base - h * 0.5} ${x - 6} ${base - h * 0.8} ${x + 8} ${base - h}" stroke="${fill}" stroke-width="16" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 8; i++) {
    const deg = -100 + i * 28 + (rand() - 0.5) * 10;
    out += leaf(x + 8, base - h, 150 + rand() * 40, 20, deg, fill, 'rgba(255,255,255,0.08)');
  }
  return out;
}

export function back() {
  const r = rng(1447);
  const sky = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E1A3D"/><stop offset="0.45" stop-color="#1F3768"/><stop offset="0.66" stop-color="#3F6E8C"/><stop offset="0.76" stop-color="#E7A86B"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  for (let i = 0; i < 70; i++) b += `<circle cx="${f(r() * W)}" cy="${f(r() * 780)}" r="${f(0.7 + r() * 1.6)}" fill="#FFF6DE" opacity="${f(0.35 + r() * 0.6)}"/>`;
  for (const [x, y, s] of [[180, 220, 14], [760, 380, 10], [120, 520, 9]]) b += star8(x, y, s, '#FFE6A8');
  // The crescent moon, with a halo.
  b += `<circle cx="600" cy="360" r="200" fill="#FFE6A8" opacity="0.16" filter="url(#soft)"/>`;
  b += layer(1, `<path d="M640 230 A150 150 0 1 0 700 500 A120 120 0 1 1 640 230 Z" fill="#FFE9B0"/>`);
  // The skyline: domes and minarets, near and far.
  let far = '';
  far += minaret(90, 1060, 380, '#15244A', '#E8C77A') + minaret(810, 1060, 330, '#15244A', '#E8C77A');
  far += `<rect x="200" y="900" width="500" height="160" fill="#15244A"/>`;
  far += dome(450, 900, 300, '#15244A', '#E8C77A') + dome(260, 920, 130, '#15244A', '#E8C77A') + dome(640, 920, 130, '#15244A', '#E8C77A');
  for (let i = 0; i < 7; i++) {
    const x = 240 + i * 70;
    far += `<path d="M${x - 16} 1040 L${x - 16} 990 C${x - 16} 970 ${x} 960 ${x} 955 C${x} 960 ${x + 16} 970 ${x + 16} 990 L${x + 16} 1040 Z" fill="#F4C36B" opacity="${f(0.55 + r() * 0.4)}"/>`;
  }
  b += layer(1, far);
  // Palms either side.
  b += layer(2, palm(70, 1250, 380, '#1C3A3A', r) + palm(830, 1240, 330, '#1C3A3A', r));
  // The courtyard: a low wall, then the pool, then the tiled floor.
  b += layer(2, `<rect x="0" y="1060" width="${W}" height="70" fill="#D9B48A"/><rect x="0" y="1060" width="${W}" height="12" fill="#EBC9A0"/>`);
  let tiles = '';
  for (let i = 0; i < 12; i++) tiles += star8(38 + i * 76, 1098, 18, 'none', '#2F7A8A', 3);
  b += tiles;
  b += layer(2, `<rect x="0" y="1130" width="${W}" height="470" fill="#E8C9A2"/>`);
  // The reflecting pool, with the moon and lanterns in it.
  b += layer(1, `<path d="M300 1160 L600 1160 L700 1600 L200 1600 Z" fill="#2F7A8A"/><path d="M318 1176 L582 1176 L676 1600 L224 1600 Z" fill="#3E93A3"/>`);
  b += `<path d="M560 1220 a30 30 0 1 0 10 40 a24 24 0 1 1 -10 -40 Z" fill="#FFE9B0" opacity="0.6"/>`;
  for (let i = 0; i < 5; i++) b += `<ellipse cx="${f(380 + r() * 140)}" cy="${f(1300 + i * 60)}" rx="${f(30 + r() * 40)}" ry="3" fill="#FFF6DE" opacity="0.35"/>`;
  // Floor stars.
  let floor = '';
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 6; i++) {
      const x = 40 + i * 70 + (row % 2) * 35;
      if (x > 200) continue;
      floor += star8(x, 1200 + row * 100, 22 + row * 4, 'none', '#C99A5E', 3);
      floor += star8(W - x, 1200 + row * 100, 22 + row * 4, 'none', '#C99A5E', 3);
    }
  }
  b += floor;
  // Lanterns on the floor beside the pool.
  b += layer(2, fanous(120, 1290, 1.7, '#B8862E', '#FFC36B') + fanous(780, 1330, 1.9, '#B8862E', '#FFB04A') + fanous(240, 1420, 1.2, '#B8862E', '#7FD1C4') + fanous(680, 1450, 1.05, '#B8862E', '#F28C6B'));
  // Lanterns hanging from the top.
  const hang = [
    [250, 160, 1.15, '#FFC36B'],
    [430, 70, 0.85, '#7FD1C4'],
    [780, 220, 1, '#F28C6B'],
  ];
  b += `<path d="${hang.map(([x, y]) => `M${x} 0 L${x} ${y - 40}`).join(' ')}" stroke="#B8862E" stroke-width="2"/>`;
  b += layer(1, hang.map(([x, y, s, g]) => fanous(x, y, s, '#B8862E', g)).join(''));
  b += grain();
  return svg(b, sky);
}

export function gate() {
  const bg = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#123C4A"/><stop offset="1" stop-color="#0C2A36"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#g)"/>`;
  // A lattice of eight-pointed stars, gold on deep teal: one layer of rings,
  // one of stars, so the screen reads as pierced and layered.
  let back = '';
  let front = '';
  const step = 112;
  for (let y = -step / 2; y < H + step; y += step) {
    for (let x = -step / 2; x < W + step; x += step) {
      back += `<circle cx="${x}" cy="${y}" r="${step * 0.36}" fill="#0A2430"/>`;
      front += star8(x, y, step * 0.42, 'none', '#D9B06A', 5);
      front += star8(x, y, step * 0.22, '#1E5566');
      front += `<rect x="${x + step / 2 - 6}" y="${y + step / 2 - 6}" width="12" height="12" transform="rotate(45 ${x + step / 2} ${y + step / 2})" fill="#D9B06A"/>`;
    }
  }
  b += back;
  b += layer(1, front);
  // A carved border round the screen.
  b += layer(2, `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#B8862E" stroke-width="40"/><rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="#E8C77A" stroke-width="6"/>`);
  b += grain(0.14);
  return svg(b, bg);
}

export function mid() {
  let body = '';
  const hang = [
    [90, 330, 2.1, '#FFC36B'],
    [250, 170, 1.6, '#7FD1C4'],
  ];
  body += `<path d="${hang.map(([x, y, s]) => `M${x} 0 L${x} ${y - 40 * s}`).join(' ')}" stroke="#B8862E" stroke-width="3"/>`;
  body += layer(3, hang.map(([x, y, s, g]) => fanous(x, y, s, '#B8862E', g)).join(''));
  return svg(body, '', { width: 600, height: 900 });
}
