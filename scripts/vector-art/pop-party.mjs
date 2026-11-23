/**
 * pop-party.mjs — Pop party: the recipient pops a wall of balloons and finds
 * a bright candy-striped party room behind it — bunting and curly streamers
 * overhead, a paper star garland, and a three-tier birthday cake glowing on a
 * scalloped party table between stacks of wrapped gifts and party hats.
 *
 * The gate is a LIVE gate: the balloon wall is drawn piece by piece in the
 * app so every balloon can be popped on its own. gate() here is only the
 * placeholder render-vector-art needs.
 *
 * The title plate sits at roughly y 480-650, so that band is left as calm
 * striped wall under the room's warm glow — all the busy detail lives above
 * (bunting, streamers, garland) and below (the table).
 */
import { W, H, rng, layer, grain, bunting, svg } from './paper.mjs';

const f = (n) => Math.round(n * 10) / 10;

const SUN = '#FFD36B';
const MINT = '#5ED1C6';
const PERI = '#7C83D6';
const LILAC = '#C9A8FF';
const CORAL = '#F07B6B';
const PINK = '#FF9DB4';
const CREAM = '#FFF6EC';
const CONFETTI = [SUN, MINT, PERI, LILAC, CORAL, PINK];

const extra = `
  <linearGradient id="ppWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC9D2"/><stop offset="0.6" stop-color="#FFE1E2"/><stop offset="1" stop-color="#FFD3CF"/></linearGradient>
  <radialGradient id="ppGlow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFF7E0" stop-opacity="0.95"/><stop offset="0.55" stop-color="#FFF1DA" stop-opacity="0.45"/><stop offset="1" stop-color="#FFF1DA" stop-opacity="0"/></radialGradient>
  <radialGradient id="ppFlame"><stop offset="0" stop-color="#FFF6C8" stop-opacity="0.95"/><stop offset="1" stop-color="#FFD36B" stop-opacity="0"/></radialGradient>
  <linearGradient id="ppCloth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F38A7B"/><stop offset="1" stop-color="#D9604F"/></linearGradient>
  <linearGradient id="ppShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.12"/><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#000" stop-opacity="0.10"/></linearGradient>
  <radialGradient id="ppVignette" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#B8475A" stop-opacity="0"/><stop offset="1" stop-color="#B8475A" stop-opacity="0.28"/></radialGradient>`;

function star5(cx, cy, r, fill, rot = -90) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = ((rot + i * 36) * Math.PI) / 180;
    const rr = i % 2 ? r * 0.48 : r;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)} `;
  }
  return `<path d="${d}Z" fill="${fill}"/>`;
}

/** A curly ribbon streamer: a trochoid that loops as it falls. */
function curl(x0, y0, len, amp, fill, phase = 0, loops = 5, width = 9) {
  const steps = 140;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * loops + phase;
    const k = i / steps;
    const a = amp * (1 - k * 0.35);
    const x = x0 + Math.sin(t) * a;
    const y = y0 + k * len + Math.cos(t) * a * 0.55;
    d += `${i ? 'L' : 'M'}${f(x)} ${f(y)} `;
  }
  return `<path d="${d}" stroke="${fill}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" stroke="rgba(255,255,255,0.35)" stroke-width="${f(width * 0.3)}" fill="none" stroke-linecap="round" transform="translate(-1.5 -1.5)"/>`;
}

/** A swag streamer: a twisted paper ribbon sagging between two points. */
function swag(x1, y1, x2, y2, sag, fill, twists = 9) {
  const steps = 90;
  let top = '';
  let bot = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * sag;
    const w = 4 + Math.abs(Math.sin(t * Math.PI * twists)) * 10;
    top += `${i ? 'L' : 'M'}${f(x)} ${f(y - w)} `;
    bot = `L${f(x)} ${f(y + w)} ` + bot;
  }
  return `<path d="${top}${bot}Z" fill="${fill}"/>`;
}

function candle(x, y, h, fill) {
  return `<circle cx="${x}" cy="${y - h - 14}" r="26" fill="url(#ppFlame)"/>` +
    `<rect x="${x - 5}" y="${y - h}" width="10" height="${h}" rx="3" fill="${fill}"/>` +
    `<path d="M${x - 5} ${y - h + 8} L${x + 5} ${y - h + 2} M${x - 5} ${y - h + 20} L${x + 5} ${y - h + 14} M${x - 5} ${y - h + 32} L${x + 5} ${y - h + 26}" stroke="#fff" stroke-width="2.5" opacity="0.8"/>` +
    `<path d="M${x} ${y - h - 26} C${x + 8} ${y - h - 14} ${x + 6} ${y - h - 6} ${x} ${y - h - 4} C${x - 6} ${y - h - 6} ${x - 8} ${y - h - 14} ${x} ${y - h - 26} Z" fill="#FFB43C"/>` +
    `<path d="M${x} ${y - h - 18} C${x + 4} ${y - h - 12} ${x + 3} ${y - h - 8} ${x} ${y - h - 7} C${x - 3} ${y - h - 8} ${x - 4} ${y - h - 12} ${x} ${y - h - 18} Z" fill="#FFF3B0"/>`;
}

/** A cake tier: body, a drippy icing top and a row of sprinkles/dots. */
function tier(cx, top, w, h, body, icing, rand, dots) {
  const x0 = cx - w / 2;
  let drip = `M${x0} ${top + 4} L${x0} ${top + 18}`;
  const n = Math.round(w / 34);
  for (let i = 0; i < n; i++) {
    const xa = x0 + (i / n) * w;
    const xb = x0 + ((i + 1) / n) * w;
    const dl = 14 + rand() * 22;
    drip += ` C${f(xa + 2)} ${f(top + 18 + dl)} ${f(xb - 2)} ${f(top + 18 + dl)} ${f(xb)} ${top + 18}`;
  }
  drip += ` L${x0 + w} ${top + 4} Q${x0 + w} ${top - 6} ${x0 + w - 12} ${top - 6} L${x0 + 12} ${top - 6} Q${x0} ${top - 6} ${x0} ${top + 4} Z`;
  let out = `<rect x="${x0}" y="${top}" width="${w}" height="${h}" rx="12" fill="${body}"/>`;
  out += `<rect x="${x0}" y="${top}" width="${w}" height="${h}" rx="12" fill="url(#ppShade)"/>`;
  out += `<path d="${drip}" fill="${icing}"/>`;
  for (let i = 0; i < dots.count; i++) {
    const x = x0 + 18 + ((i + 0.5) / dots.count) * (w - 36);
    out += `<circle cx="${f(x)}" cy="${f(top + h - 18)}" r="${dots.r}" fill="${dots.colors[i % dots.colors.length]}"/>`;
  }
  return out;
}

function cake(rand) {
  const cx = 450;
  let c = '';
  // Cake stand: plate on a pedestal.
  c += `<path d="M395 1238 L505 1238 L486 1200 L414 1200 Z" fill="#FFFFFF"/><path d="M395 1238 L505 1238 L486 1200 L414 1200 Z" fill="url(#ppShade)"/>`;
  c += `<ellipse cx="${cx}" cy="1198" rx="200" ry="18" fill="#FFFFFF"/><ellipse cx="${cx}" cy="1194" rx="200" ry="14" fill="#F6EDF7"/>`;
  c += tier(cx, 1080, 330, 112, PINK, CREAM, rand, { count: 9, r: 6, colors: [MINT, SUN, PERI] });
  c += tier(cx, 990, 250, 94, MINT, CREAM, rand, { count: 7, r: 5.5, colors: [CORAL, SUN, LILAC] });
  c += tier(cx, 912, 172, 82, LILAC, '#FFF0F6', rand, { count: 5, r: 5, colors: [SUN, CORAL, MINT] });
  // A ruffle of piped icing round each tier's base.
  for (const [y, w] of [[1192, 330], [1084, 250], [994, 172]]) {
    let beads = '';
    const n = Math.round(w / 16);
    for (let i = 0; i <= n; i++) beads += `<circle cx="${f(cx - w / 2 + (i / n) * w)}" cy="${y - 2}" r="7.5" fill="${CREAM}"/>`;
    c += beads;
  }
  // A cherry-and-star topper.
  c += star5(cx, 878, 20, SUN);
  c += [-58, -29, 29, 58].map((dx, i) => candle(cx + dx, 914, 40 + (i % 2) * 8, [CORAL, PERI, SUN, MINT][i])).join('');
  return c;
}

function gift(x, base, w, h, fill, ribbon, lid = fill) {
  const y = base - h;
  return `<rect x="${f(x - w / 2)}" y="${f(y)}" width="${w}" height="${h}" rx="5" fill="${fill}"/>` +
    `<rect x="${f(x - w / 2)}" y="${f(y)}" width="${w}" height="${h}" rx="5" fill="url(#ppShade)"/>` +
    `<rect x="${f(x - w / 2 - 6)}" y="${f(y - 14)}" width="${w + 12}" height="20" rx="5" fill="${lid}"/>` +
    `<rect x="${f(x - 7)}" y="${f(y - 14)}" width="14" height="${h + 14}" fill="${ribbon}"/>` +
    `<path d="M${x} ${f(y - 14)} C${f(x - 30)} ${f(y - 50)} ${f(x - 40)} ${f(y - 10)} ${x} ${f(y - 14)} C${f(x + 40)} ${f(y - 10)} ${f(x + 30)} ${f(y - 50)} ${x} ${f(y - 14)} Z" fill="${ribbon}"/>` +
    `<path d="M${x} ${f(y - 12)} L${f(x - 14)} ${f(y + 16)} M${x} ${f(y - 12)} L${f(x + 14)} ${f(y + 16)}" stroke="${ribbon}" stroke-width="6" stroke-linecap="round"/>` +
    `<circle cx="${x}" cy="${f(y - 14)}" r="7" fill="${ribbon}"/>`;
}

/** A dotted gift: polka dots over the box body. */
function dots(x, base, w, h, color) {
  let o = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const px = x - w / 2 + ((c + 0.5 + (r % 2) * 0.5) / 4.5) * w;
      const py = base - h + ((r + 0.6) / 4.4) * h;
      if (Math.abs(px - x) > 12) o += `<circle cx="${f(px)}" cy="${f(py)}" r="4.5" fill="${color}"/>`;
    }
  }
  return o;
}

function hat(x, y, s, rot, fill, stripe, pom) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M-34 0 L0 -96 L34 0 Q0 12 -34 0 Z" fill="${fill}"/>
    <path d="M-23 -30 L23 -30 L17 -46 L-17 -46 Z M-11 -62 L11 -62 L6 -76 L-6 -76 Z" fill="${stripe}"/>
    <path d="M-34 0 Q0 12 34 0 L34 4 Q0 18 -34 4 Z" fill="${stripe}"/>
    <circle cy="-98" r="12" fill="${pom}"/><circle cx="-4" cy="-102" r="4" fill="rgba(255,255,255,0.5)"/>
  </g>`;
}

/** A pleated paper fan rosette for the side walls. */
function rosette(cx, cy, r, a, b, center) {
  let o = '';
  const n = 24;
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI * 2;
    const t1 = ((i + 1) / n) * Math.PI * 2;
    o += `<path d="M${cx} ${cy} L${f(cx + Math.cos(t0) * r)} ${f(cy + Math.sin(t0) * r)} L${f(cx + Math.cos(t1) * r)} ${f(cy + Math.sin(t1) * r)} Z" fill="${i % 2 ? a : b}"/>`;
  }
  return o + `<circle cx="${cx}" cy="${cy}" r="${f(r * 0.3)}" fill="${center}"/><circle cx="${cx}" cy="${cy}" r="${f(r * 0.16)}" fill="${CREAM}"/>`;
}

function confetti(rand, n, x0, x1, y0, y1, avoid) {
  let o = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    if (avoid && x > avoid[0] && x < avoid[1] && y > avoid[2] && y < avoid[3]) continue;
    const c = CONFETTI[Math.floor(rand() * CONFETTI.length)];
    const rot = f(rand() * 180);
    const kind = rand();
    if (kind < 0.45) o += `<rect x="${f(x - 7)}" y="${f(y - 3)}" width="14" height="6" rx="1.5" fill="${c}" transform="rotate(${rot} ${f(x)} ${f(y)})"/>`;
    else if (kind < 0.75) o += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(3 + rand() * 3)}" fill="${c}"/>`;
    else o += `<path d="M${f(x - 9)} ${f(y)} q4.5 -7 9 0 t9 0" stroke="${c}" stroke-width="3.5" fill="none" stroke-linecap="round" transform="rotate(${rot} ${f(x)} ${f(y)})"/>`;
  }
  return o;
}

export function back() {
  const r = rng(51026);
  let b = `<rect width="${W}" height="${H}" fill="url(#ppWall)"/>`;
  // Candy-stripe wallpaper: soft pink/cream with a fine pin-stripe.
  let stripes = '';
  for (let x = -10; x < W; x += 72) {
    stripes += `<rect x="${x}" y="0" width="36" height="${H}" fill="#FFF1EA" opacity="0.75"/>`;
    stripes += `<rect x="${x + 52}" y="0" width="3" height="${H}" fill="#FFB7C3" opacity="0.6"/>`;
  }
  b += stripes;
  // Warm glow behind the title and the cake.
  b += `<ellipse cx="450" cy="760" rx="520" ry="560" fill="url(#ppGlow)"/>`;
  b += `<rect width="${W}" height="${H}" fill="url(#ppVignette)"/>`;
  // Side wall rosettes, below the title band and clear of the centre.
  b += layer(1, rosette(96, 820, 74, '#FFD36B', '#FFE59C', CORAL) + rosette(806, 790, 64, '#9FE3DA', MINT, PERI) + rosette(150, 965, 44, LILAC, '#DCC6FF', SUN) + rosette(760, 948, 50, '#FFB8A8', CORAL, MINT));
  // Paper star garland: a sagging string with hanging stars.
  const gx = (t) => 60 + t * 780;
  const gy = (t) => 330 + Math.sin(t * Math.PI) * 70;
  let garland = `<path d="M60 330 Q450 470 840 330" stroke="#C9768A" stroke-width="2" fill="none"/>`;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const drop = 22 + (i % 2) * 16;
    garland += `<path d="M${f(gx(t))} ${f(gy(t))} L${f(gx(t))} ${f(gy(t) + drop)}" stroke="#C9768A" stroke-width="1.5"/>`;
  }
  b += garland;
  let stars = '';
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const drop = 22 + (i % 2) * 16;
    const s = 15 + (i % 3) * 4;
    stars += star5(gx(t), gy(t) + drop + s * 0.8, s, [SUN, MINT, CORAL, LILAC, PERI][i % 5], -90 + (i % 2 ? 8 : -8));
  }
  b += layer(1, stars);
  // Twisted swag streamers across the top, then two rows of bunting.
  b += layer(1, swag(-20, 40, 470, 60, 120, MINT, 12) + swag(430, 60, 920, 40, 120, LILAC, 12));
  b += layer(1, swag(-20, 120, 920, 110, 110, SUN, 22));
  b += layer(2, bunting(-20, 20, 920, 20, 70, [CORAL, SUN, MINT, PERI, PINK, LILAC], 12));
  // Curly streamers dangling from the ceiling at the sides.
  b += layer(2, curl(40, 0, 420, 22, CORAL, 0.3, 6) + curl(120, 0, 300, 18, PERI, 1.4, 5) + curl(200, 0, 220, 15, SUN, 2.1, 4, 8) +
    curl(860, 0, 420, 22, MINT, 1.1, 6) + curl(780, 0, 300, 18, PINK, 0.2, 5) + curl(700, 0, 220, 15, LILAC, 2.6, 4, 8));
  // Confetti on the wall — sparse through the title band, never in it.
  b += confetti(r, 80, 20, 880, 150, 1150, [170, 730, 440, 690]);
  // The party table: cloth with a scalloped hem and candy stripes on the skirt.
  let table = `<rect x="-10" y="1238" width="${W + 20}" height="${H - 1238 + 10}" fill="url(#ppCloth)"/>`;
  for (let x = 0; x < W; x += 60) table += `<rect x="${x + 18}" y="1270" width="24" height="${H - 1270}" fill="#FFD9D0" opacity="0.35"/>`;
  let hem = `M-10 1238 L${W + 10} 1238 L${W + 10} 1282`;
  for (let x = W; x >= -30; x -= 50) hem += ` Q${x - 25} 1318 ${x - 50} 1282`;
  hem += ' Z';
  table += `<path d="${hem}" fill="#FFF4EA"/>`;
  for (let x = 25; x < W; x += 50) table += `<circle cx="${x - 25 + (W % 50)}" cy="1304" r="5" fill="${SUN}"/>`;
  table += `<rect x="-10" y="1232" width="${W + 20}" height="10" rx="4" fill="#FFF8F0"/>`;
  b += layer(3, table);
  // Gift stacks either side.
  const giftsL = gift(150, 1240, 150, 110, PERI, SUN) + dots(150, 1240, 150, 110, '#A7ACEB') +
    gift(150, 1116, 112, 84, SUN, CORAL) + gift(150, 1018, 72, 56, MINT, '#FFFFFF') + gift(262, 1240, 76, 64, LILAC, MINT);
  const giftsR = gift(752, 1240, 160, 124, MINT, CORAL) + dots(752, 1240, 160, 124, '#8FE0D7') +
    gift(752, 1102, 118, 88, CORAL, '#FFFFFF') + gift(640, 1240, 70, 58, SUN, PERI);
  b += layer(2, giftsL + giftsR);
  // The cake, centre stage.
  b += layer(3, cake(r));
  // Party hats tipped on the table.
  b += layer(2, hat(318, 1238, 0.78, -14, CORAL, SUN, MINT) + hat(586, 1238, 0.72, 12, PERI, '#FFFFFF', SUN));
  // Confetti scattered over the tablecloth and spilling down the skirt.
  b += confetti(r, 60, 20, 880, 1330, 1580);
  b += grain(0.12);
  return svg(b, extra);
}

/** Honeycomb paper ball: a disc with longitude ridges and a soft highlight. */
function honeycomb(cx, cy, rr, fill, ridge) {
  let o = `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${fill}"/>`;
  for (const k of [0.22, 0.5, 0.78]) {
    o += `<ellipse cx="${cx}" cy="${cy}" rx="${f(rr * k)}" ry="${rr}" fill="none" stroke="${ridge}" stroke-width="2.2"/>`;
  }
  for (const k of [-0.5, 0, 0.5]) {
    const y = cy + rr * k;
    const half = Math.sqrt(rr * rr - (rr * k) ** 2);
    o += `<path d="M${f(cx - half)} ${f(y)} Q${cx} ${f(y + rr * 0.12)} ${f(cx + half)} ${f(y)}" stroke="${ridge}" stroke-width="1.4" fill="none" opacity="0.7"/>`;
  }
  o += `<path d="M${f(cx - rr * 0.7)} ${f(cy - rr * 0.35)} A${rr} ${rr} 0 0 1 ${f(cx - rr * 0.1)} ${f(cy - rr * 0.95)}" stroke="rgba(255,255,255,0.55)" stroke-width="${f(rr * 0.1)}" fill="none" stroke-linecap="round"/>`;
  o += `<rect x="${cx - 8}" y="${f(cy - rr - 6)}" width="16" height="10" rx="3" fill="${ridge}"/>`;
  return o;
}

/** Tissue pom-pom: rings of soft petals from the outside in. */
function pompom(cx, cy, rr, shades, rand) {
  let o = '';
  const rings = [[1, 18], [0.72, 14], [0.45, 10], [0.2, 6]];
  rings.forEach(([k, n], ri) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 360 + ri * 11 + rand() * 8;
      const len = rr * k;
      const w = Math.max(8, len * 0.42);
      o += `<g transform="translate(${cx} ${cy}) rotate(${f(a)})"><path d="M0 0 C${f(w)} ${f(-len * 0.3)} ${f(w * 0.8)} ${f(-len)} 0 ${f(-len)} C${f(-w * 0.8)} ${f(-len)} ${f(-w)} ${f(-len * 0.3)} 0 0 Z" fill="${shades[ri % shades.length]}"/></g>`;
    }
  });
  return o;
}

/** Hanging pom-poms, honeycomb balls and curly streamers for the top corners (mirrored in the app). */
export function mid() {
  const r = rng(7713);
  const hang = [
    { x: 78, y: 300, kind: 'honey', r: 74, fill: CORAL, ridge: '#C9584A' },
    { x: 196, y: 175, kind: 'pom', r: 62, shades: ['#FFB7C6', PINK, '#FFD3DD', '#FFFFFF'] },
    { x: 300, y: 380, kind: 'honey', r: 54, fill: MINT, ridge: '#36A89D' },
    { x: 398, y: 150, kind: 'pom', r: 44, shades: [SUN, '#FFE49E', '#FFF1C9', '#FFFFFF'] },
    { x: 165, y: 520, kind: 'pom', r: 40, shades: [LILAC, '#DCC6FF', '#EEE2FF', '#FFFFFF'] },
  ];
  let strings = '';
  for (const h of hang) strings += `<path d="M${h.x} 0 L${h.x} ${h.y - h.r}" stroke="#E7A9B6" stroke-width="2.5"/>`;
  let b = strings;
  // Curly streamers between the balls.
  b += layer(2, curl(30, 0, 560, 16, PERI, 0.6, 7, 8) + curl(250, 0, 260, 14, LILAC, 1.9, 4, 7) + curl(350, 0, 470, 14, CORAL, 0.1, 6, 7) + curl(460, 0, 220, 12, MINT, 2.4, 4, 6));
  // A few stars and confetti caught in the strings, behind the balls.
  b += layer(1, star5(250, 560, 18, SUN) + star5(60, 470, 14, MINT) + star5(420, 300, 13, CORAL));
  b += confetti(r, 18, 20, 440, 80, 640);
  // Back-row balls a little softer, front row with the full lift.
  const draw = (h) => (h.kind === 'honey' ? honeycomb(h.x, h.y, h.r, h.fill, h.ridge) : pompom(h.x, h.y, h.r, h.shades, r));
  b += layer(2, [hang[1], hang[3]].map(draw).join(''));
  b += layer(3, [hang[0], hang[2], hang[4]].map(draw).join(''));
  return svg(b, extra, { width: 600, height: 900 });
}

/** Placeholder only: the real gate (the balloon wall) is drawn live. */
export function gate() {
  return back();
}
