/**
 * deep-blue.mjs — Deep blue: the recipient turns a brass wheel on a ship's
 * porthole, and the porthole opens onto a sunlit reef.
 *
 * Hand-built paper scene (see paper.mjs). Layers:
 *  - gate: the inside wall of a ship's cabin (riveted painted plates over a
 *    wooden wainscot, copper pipes, gauges, a lantern and a coil of rope)
 *    round a big brass PORTHOLE centred at (450,760). The app cuts a circle
 *    of radius 293 there, grows it to open, strokes the rim and draws the
 *    turning wheel itself — so the art paints only the ring outside r=293
 *    and tinted glass inside it (seen in thumbnails and emails).
 *  - back: a sunlit reef through the porthole: god-rays, fan, brain and
 *    branching corals, kelp, a sea turtle, jellyfish, schools of paper fish
 *    and a sandy floor with shells and a starfish. The band y≈480-650 stays
 *    open water for the card's title plate.
 *  - mid: kelp fronds and a coral cluster rising from the bottom edge,
 *    mirrored into both bottom corners by the app.
 */
import { W, H, rng, svg, layer, leaf, band, grain } from './paper.mjs';

const f = (n) => Math.round(n * 10) / 10;

const CX = 450;
const CY = 760;
const HOLE = 293;
const RING = 345;

const CORAL = ['#FF7A6B', '#F25C8A', '#FF9F45', '#9B6FD1', '#FFC94D', '#E8577A'];
const KELP = ['#6E9A3A', '#86AE48', '#4F7D33', '#9BBE55'];

/* ----------------------------------------------------------------- shapes */

/** A ring (annulus) between radii r1 < r2. */
function annulus(cx, cy, r1, r2, fill, extra = '') {
  const c = (r) => `M${f(cx - r)} ${f(cy)} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  return `<path d="${c(r2)} ${c(r1)}" fill="${fill}" fill-rule="evenodd" ${extra}/>`;
}

/** A dome-headed rivet. */
function rivet(x, y, r = 5, base = '#0F2F37', hi = 'rgba(255,255,255,0.22)') {
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${base}"/><circle cx="${f(x - r * 0.3)}" cy="${f(y - r * 0.3)}" r="${f(r * 0.45)}" fill="${hi}"/>`;
}

/** A brass bolt head. */
function bolt(x, y, r = 10) {
  return `<circle cx="${f(x)}" cy="${f(y + 2)}" r="${r}" fill="#5E3E12"/><circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#9A6A24"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.72)}" fill="#C8953E"/><circle cx="${f(x - r * 0.25)}" cy="${f(y - r * 0.3)}" r="${f(r * 0.32)}" fill="#F6DC96"/>`;
}

/** A pressure gauge: brass bezel, cream dial, ticks and a needle. */
function gauge(x, y, r, needleDeg) {
  let ticks = '';
  for (let i = 0; i <= 10; i++) {
    const a = ((-225 + i * 27) * Math.PI) / 180;
    const r1 = r * (i % 5 === 0 ? 0.52 : 0.6);
    ticks += `<line x1="${f(Math.cos(a) * r1)}" y1="${f(Math.sin(a) * r1)}" x2="${f(Math.cos(a) * r * 0.7)}" y2="${f(Math.sin(a) * r * 0.7)}" stroke="#3A2A1A" stroke-width="${i % 5 === 0 ? 3 : 1.6}"/>`;
  }
  const red = ((-225 + 216) * Math.PI) / 180;
  const red2 = ((-225 + 270) * Math.PI) / 180;
  return `<g transform="translate(${f(x)} ${f(y)})">
    <circle r="${r}" fill="url(#brass)"/>
    <circle r="${f(r * 0.86)}" fill="#7A5218"/>
    <circle r="${f(r * 0.8)}" fill="#F4EAD2"/>
    <path d="M${f(Math.cos(red) * r * 0.7)} ${f(Math.sin(red) * r * 0.7)} A${f(r * 0.7)} ${f(r * 0.7)} 0 0 1 ${f(Math.cos(red2) * r * 0.7)} ${f(Math.sin(red2) * r * 0.7)}" stroke="#C8473A" stroke-width="5" fill="none"/>
    ${ticks}
    <g transform="rotate(${needleDeg})"><path d="M-3 6 L0 ${f(-r * 0.62)} L3 6 Z" fill="#B23A2E"/></g>
    <circle r="${f(r * 0.1)}" fill="#3A2A1A"/>
    <path d="M${f(-r * 0.6)} ${f(-r * 0.25)} A${f(r * 0.66)} ${f(r * 0.66)} 0 0 1 ${f(r * 0.1)} ${f(-r * 0.64)}" stroke="rgba(255,255,255,0.55)" stroke-width="${f(r * 0.09)}" fill="none" stroke-linecap="round"/>
  </g>`;
}

/** A ship's lantern hanging from a wall bracket whose mount is at (x,y). */
function lantern(x, y, s) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
    <circle cx="40" cy="96" r="80" fill="#FFC86B" opacity="0.32" filter="url(#soft)"/>
    <rect x="-10" y="-14" width="20" height="28" rx="4" fill="url(#brass)"/>
    <path d="M0 0 L46 0 Q56 0 56 10 L56 18" stroke="#B98A3A" stroke-width="6" fill="none" stroke-linecap="round"/>
    <circle cx="56" cy="26" r="9" fill="none" stroke="#B98A3A" stroke-width="4"/>
    <path d="M30 44 L82 44 L74 34 L38 34 Z" fill="#B98A3A"/>
    <rect x="44" y="28" width="24" height="8" rx="3" fill="#8C6224"/>
    <path d="M34 48 Q34 44 38 44 L74 44 Q78 44 78 48 L84 120 L28 120 Z" fill="#FFD98A"/>
    <ellipse cx="56" cy="88" rx="14" ry="22" fill="#FFF3CF"/>
    <path d="M38 48 L32 120 M56 44 L56 120 M74 48 L80 120" stroke="#9A6E2A" stroke-width="3.5"/>
    <path d="M30 70 L82 70 M28 98 L84 98" stroke="#9A6E2A" stroke-width="3"/>
    <rect x="22" y="118" width="68" height="14" rx="4" fill="#B98A3A"/>
    <rect x="30" y="130" width="52" height="10" rx="3" fill="#8C6224"/>
  </g>`;
}

/** A coil of rope hanging from a wooden cleat at (x,y). */
function ropeCoil(x, y, rand) {
  let out = `<g transform="translate(${f(x)} ${f(y)})">`;
  out += `<rect x="-46" y="-14" width="92" height="22" rx="10" fill="#4A2C16"/><rect x="-10" y="-4" width="20" height="26" fill="#3A2210"/>`;
  for (let i = 0; i < 6; i++) {
    const dx = (i - 2.5) * 13 + (rand() - 0.5) * 6;
    const rx = 58 + (i % 3) * 5;
    const ry = 112 - i * 3;
    const tone = i % 2 ? '#C79B5E' : '#D6AE70';
    out += `<ellipse cx="${f(dx)}" cy="${f(ry + 6)}" rx="${rx}" ry="${ry}" fill="none" stroke="#7E5A2C" stroke-width="18"/>`;
    out += `<ellipse cx="${f(dx)}" cy="${f(ry + 4)}" rx="${rx}" ry="${ry}" fill="none" stroke="${tone}" stroke-width="14"/>`;
    out += `<ellipse cx="${f(dx)}" cy="${f(ry + 4)}" rx="${rx}" ry="${ry}" fill="none" stroke="#8E6834" stroke-width="14" stroke-dasharray="3 9" opacity="0.55"/>`;
  }
  // The binding wrap and the loose tail.
  out += `<rect x="-34" y="10" width="68" height="26" rx="8" fill="#B88A4E"/><path d="M-30 18 L30 18 M-30 28 L30 28" stroke="#7E5A2C" stroke-width="3"/>`;
  out += `<path d="M24 210 C40 250 10 290 34 330" stroke="#7E5A2C" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M24 210 C40 250 10 290 34 330" stroke="#D6AE70" stroke-width="13" fill="none" stroke-linecap="round"/>`;
  return out + '</g>';
}

/** A gate-valve hand wheel (small, on a pipe). */
function valve(x, y, r, fill) {
  let spokes = '';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    spokes += `<line x1="0" y1="0" x2="${f(Math.cos(a) * r)}" y2="${f(Math.sin(a) * r)}" stroke="${fill}" stroke-width="6"/>`;
  }
  return `<g transform="translate(${f(x)} ${f(y)})">${spokes}<circle r="${r}" fill="none" stroke="${fill}" stroke-width="9"/><circle r="9" fill="#6E1F1A"/></g>`;
}

/* ------------------------------------------------------------- reef shapes */

/** A sea fan: a scalloped fan with a lattice of veins, rooted at (x,base). */
function seaFan(x, base, w, h, fill, vein, rand) {
  const n = 9;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI * (1.12 + (i / n) * 0.76);
    const k = 0.86 + rand() * 0.16;
    pts.push([x + Math.cos(a) * (w / 2) * k, base - 40 + Math.sin(a) * h * k]);
  }
  let d = `M${f(x - 10)} ${f(base)} L${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [qx, qy] = pts[i];
    const mx = (px + qx) / 2;
    const my = (py + qy) / 2;
    const ox = mx - x;
    const oy = my - base;
    const L = Math.hypot(ox, oy) || 1;
    d += ` Q${f(mx + (ox / L) * 22)} ${f(my + (oy / L) * 22)} ${f(qx)} ${f(qy)}`;
  }
  d += ` L${f(x + 10)} ${f(base)} Z`;
  let out = `<path d="${d}" fill="${fill}"/>`;
  let veins = '';
  for (const [px, py] of pts) {
    const ex = x + (px - x) * 0.94;
    const ey = base + (py - base) * 0.94;
    veins += `M${f(x)} ${f(base)} Q${f(x + (ex - x) * 0.4 + (rand() - 0.5) * 20)} ${f(base + (ey - base) * 0.55)} ${f(ex)} ${f(ey)} `;
  }
  out += `<path d="${veins}" stroke="${vein}" stroke-width="3" fill="none" opacity="0.8"/>`;
  for (const t of [0.35, 0.58, 0.8]) {
    let arc = '';
    pts.forEach(([px, py], i) => {
      const ax = x + (px - x) * t;
      const ay = base + (py - base) * t;
      arc += `${i ? 'L' : 'M'}${f(ax)} ${f(ay)} `;
    });
    out += `<path d="${arc}" stroke="${vein}" stroke-width="2" fill="none" opacity="0.55"/>`;
  }
  out += `<path d="M${f(x)} ${f(base + 6)} L${f(x)} ${f(base - 50)}" stroke="${vein}" stroke-width="9" stroke-linecap="round"/>`;
  return out;
}

/** A brain coral: a dome with meandering grooves. */
function brainCoral(x, base, w, h, fill, groove) {
  let out = `<path d="M${f(x - w / 2)} ${f(base)} C${f(x - w / 2)} ${f(base - h * 1.3)} ${f(x + w / 2)} ${f(base - h * 1.3)} ${f(x + w / 2)} ${f(base)} Z" fill="${fill}"/>`;
  const rows = 5;
  let g = '';
  for (let k = 0; k < rows; k++) {
    const yy = base - h * ((k + 0.6) / (rows + 0.4));
    const t = (base - yy) / h;
    const half = (w / 2) * Math.sqrt(Math.max(0, 1 - t * t)) * 0.86;
    const steps = 14;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const xx = x - half + (i / steps) * half * 2;
      const wob = Math.sin(i * 1.7 + k * 2.1) * h * 0.05;
      d += `${i ? 'L' : 'M'}${f(xx)} ${f(yy + wob)} `;
    }
    g += `<path d="${d}" stroke="${groove}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  out += g;
  out += `<path d="M${f(x - w * 0.32)} ${f(base - h * 0.72)} Q${f(x - w * 0.1)} ${f(base - h * 0.98)} ${f(x + w * 0.12)} ${f(base - h * 0.95)}" stroke="rgba(255,255,255,0.3)" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  return out;
}

/** Branching (staghorn) coral, grown recursively from (x,y). */
function branchCoral(x, y, len, deg, depth, fill, tip, rand) {
  const a = ((deg - 90) * Math.PI) / 180;
  const ex = x + Math.cos(a) * len;
  const ey = y + Math.sin(a) * len;
  const sw = 6 + depth * 4.5;
  let out = `<path d="M${f(x)} ${f(y)} Q${f((x + ex) / 2 + (rand() - 0.5) * len * 0.3)} ${f((y + ey) / 2)} ${f(ex)} ${f(ey)}" stroke="${fill}" stroke-width="${f(sw)}" stroke-linecap="round" fill="none"/>`;
  if (depth <= 0) return out + `<circle cx="${f(ex)}" cy="${f(ey)}" r="${f(sw * 0.55)}" fill="${tip}"/>`;
  const kids = 2 + (rand() < 0.35 ? 1 : 0);
  for (let i = 0; i < kids; i++) {
    const spread = kids === 2 ? (i ? 1 : -1) * (18 + rand() * 16) : (i - 1) * (24 + rand() * 10);
    out += branchCoral(ex, ey, len * (0.62 + rand() * 0.16), deg + spread, depth - 1, fill, tip, rand);
  }
  return out;
}

/** A cluster of tube sponges. */
function tubes(x, base, s, fill, rim) {
  const specs = [
    [-34, 120, 30],
    [0, 170, 34],
    [36, 96, 28],
  ];
  return specs
    .map(([dx, h, w]) => {
      const tx = x + dx * s;
      const th = h * s;
      const tw = w * s;
      return `<path d="M${f(tx - tw / 2)} ${f(base)} L${f(tx - tw / 2 - 4)} ${f(base - th)} L${f(tx + tw / 2 + 4)} ${f(base - th)} L${f(tx + tw / 2)} ${f(base)} Z" fill="${fill}"/>
      <ellipse cx="${f(tx)}" cy="${f(base - th)}" rx="${f(tw / 2 + 4)}" ry="${f(tw * 0.28)}" fill="${rim}"/>
      <ellipse cx="${f(tx)}" cy="${f(base - th + 1)}" rx="${f(tw / 2 - 2)}" ry="${f(tw * 0.18)}" fill="rgba(40,10,40,0.55)"/>`;
    })
    .join('');
}

/** A sea anemone: a tuft of soft tentacles. */
function anemone(x, base, r, fill, tip, rand) {
  let out = '';
  for (let i = 0; i < 13; i++) {
    const deg = -70 + (i / 12) * 140 + (rand() - 0.5) * 8;
    const a = ((deg - 90) * Math.PI) / 180;
    const L = r * (0.75 + rand() * 0.35);
    const ex = x + Math.cos(a) * L;
    const ey = base - 10 + Math.sin(a) * L;
    out += `<path d="M${f(x)} ${f(base - 10)} Q${f(x + Math.cos(a) * L * 0.5 + 10)} ${f(base - 10 + Math.sin(a) * L * 0.5)} ${f(ex)} ${f(ey)}" stroke="${fill}" stroke-width="9" stroke-linecap="round" fill="none"/><circle cx="${f(ex)}" cy="${f(ey)}" r="5" fill="${tip}"/>`;
  }
  return out + `<ellipse cx="${f(x)}" cy="${f(base - 4)}" rx="${f(r * 0.45)}" ry="14" fill="${fill}"/>`;
}

/** A swaying kelp frond with blades along its stem, rooted at (x,base). */
function kelp(x, base, h, sway, fill, rand, blades = 10, phase = 0) {
  const at = (t) => [x + Math.sin(t * Math.PI * 1.3 + phase) * sway * t, base - h * t];
  let d = '';
  for (let i = 0; i <= 24; i++) {
    const [px, py] = at(i / 24);
    d += `${i ? 'L' : 'M'}${f(px)} ${f(py)} `;
  }
  let out = `<path d="${d}" stroke="${fill}" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (let i = 0; i < blades; i++) {
    const t = 0.1 + (i / blades) * 0.88;
    const [px, py] = at(t);
    const side = i % 2 ? 1 : -1;
    const len = (110 - t * 50) * (0.8 + rand() * 0.4);
    out += leaf(px, py, len, len * 0.2, side * (38 + rand() * 18), fill, 'rgba(255,255,255,0.2)');
    out += `<circle cx="${f(px + side * 3)}" cy="${f(py - 4)}" r="5.5" fill="#C9C45A"/>`;
  }
  return out + leaf(...at(1), 70, 13, 6, fill, 'rgba(255,255,255,0.2)');
}

/** A small paper fish facing right (dir 1) or left (dir -1). */
function fish(x, y, s, fill, dir = 1, stripe = 'rgba(255,255,255,0.55)', tilt = 0) {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(tilt)}) scale(${f(s * dir)} ${f(s)})">
    <path d="M-17 0 L-31 -11 L-27 0 L-31 11 Z" fill="${fill}"/>
    <path d="M-20 0 C-10 -13 10 -13 20 0 C10 13 -10 13 -20 0 Z" fill="${fill}"/>
    <path d="M-2 -10 C2 -16 8 -14 10 -8" fill="${fill}"/>
    <path d="M2 -9 C0 -3 0 3 2 9" stroke="${stripe}" stroke-width="3" fill="none"/>
    <circle cx="12" cy="-2" r="2.6" fill="#fff"/><circle cx="12.6" cy="-2" r="1.4" fill="#1B2430"/>
  </g>`;
}

/** A round, striped reef fish (larger, the 'friendly' kind). */
function roundFish(x, y, s, body, band2, dir = 1) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s * dir)} ${f(s)})">
    <path d="M-30 0 L-48 -18 L-44 0 L-48 18 Z" fill="${body}"/>
    <path d="M-6 -24 C4 -42 22 -38 26 -22 Z M-6 24 C4 40 20 36 24 22 Z" fill="${body}"/>
    <ellipse rx="34" ry="26" fill="${body}"/>
    <path d="M-12 -25 C-4 -10 -4 10 -12 25 L-2 25 C6 10 6 -10 -2 -25 Z" fill="${band2}"/>
    <path d="M14 -22 C20 -10 20 10 14 22 L19 21 C25 10 25 -10 19 -21 Z" fill="${band2}"/>
    <circle cx="22" cy="-6" r="4.5" fill="#fff"/><circle cx="23" cy="-6" r="2.4" fill="#1B2430"/>
  </g>`;
}

/** A school of small fish along a gentle wave. */
function school(cx, cy, n, spanX, spanY, fill, dir, rand, s = 0.8) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const x = cx + (t - 0.5) * spanX + (rand() - 0.5) * 30;
    const y = cy + Math.sin(t * Math.PI * 1.6) * spanY + (rand() - 0.5) * 34;
    out += fish(x, y, s * (0.8 + rand() * 0.35), fill, dir, 'rgba(255,255,255,0.5)', (rand() - 0.5) * 14);
  }
  return out;
}

/** A jellyfish: a scalloped bell and trailing tentacles. */
function jelly(x, y, s, fill, inner, rand) {
  let tent = '';
  for (let i = 0; i < 6; i++) {
    const tx = -32 + i * 12.8;
    const L = 90 + rand() * 60;
    tent += `<path d="M${f(tx)} 4 C${f(tx + 10)} ${f(L * 0.3)} ${f(tx - 10)} ${f(L * 0.6)} ${f(tx + 4)} ${f(L)}" stroke="${fill}" stroke-width="2.4" fill="none" opacity="0.75"/>`;
  }
  const arms = `<path d="M-10 4 C-18 40 4 60 -8 96 M10 4 C18 44 -4 64 8 104" stroke="${inner}" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.8"/>`;
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
    <circle cy="-6" r="70" fill="${fill}" opacity="0.28" filter="url(#soft)"/>
    ${tent}${arms}
    <path d="M-42 4 C-44 -52 44 -52 42 4 Q35 10 28 4 Q21 10 14 4 Q7 10 0 4 Q-7 10 -14 4 Q-21 10 -28 4 Q-35 10 -42 4 Z" fill="${fill}" opacity="0.92"/>
    <path d="M-26 -6 C-26 -34 26 -34 26 -6 Z" fill="${inner}" opacity="0.7"/>
    <path d="M-26 -22 C-20 -34 -6 -38 4 -37" stroke="rgba(255,255,255,0.6)" stroke-width="4" fill="none" stroke-linecap="round"/>
  </g>`;
}

/** A sea turtle swimming, seen from above; heading `deg` (0 = up). */
function turtle(x, y, s, deg) {
  const skin = '#A3BE6E';
  const spots = 'rgba(70,90,40,0.45)';
  const hex = (cx, cy, r) => {
    let d = '';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r * 1.05)} `;
    }
    return `<path d="${d}Z" fill="#94AE58" stroke="#5E7A33" stroke-width="3.5" stroke-linejoin="round"/>`;
  };
  let rim = '';
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    rim += `<line x1="${f(Math.cos(a) * 68)}" y1="${f(Math.sin(a) * 90)}" x2="${f(Math.cos(a) * 80)}" y2="${f(Math.sin(a) * 104)}" stroke="#4E6A2B" stroke-width="3"/>`;
  }
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)}) scale(${f(s)})">
    ${leaf(-56, -40, 150, 30, -112, skin, 'rgba(255,255,255,0.25)')}
    ${leaf(56, -40, 140, 28, 100, skin, 'rgba(255,255,255,0.25)')}
    ${leaf(-44, 70, 70, 20, -150, skin, 'rgba(255,255,255,0.2)')}
    ${leaf(44, 70, 66, 19, 156, skin, 'rgba(255,255,255,0.2)')}
    <path d="M-8 96 L0 124 L8 96 Z" fill="${skin}"/>
    <ellipse cy="-118" rx="27" ry="34" fill="${skin}"/>
    <circle cx="-8" cy="-128" r="4" fill="${spots}"/><circle cx="8" cy="-112" r="5" fill="${spots}"/><circle cx="-10" cy="-104" r="3" fill="${spots}"/>
    <circle cx="-17" cy="-128" r="5" fill="#1B2430"/><circle cx="17" cy="-128" r="5" fill="#1B2430"/>
    <circle cx="-18" cy="-130" r="1.8" fill="#fff"/><circle cx="16" cy="-130" r="1.8" fill="#fff"/>
    <ellipse rx="82" ry="106" fill="#5E7A33"/>
    <ellipse rx="76" ry="100" fill="#7E9A45"/>
    ${rim}
    ${hex(0, -52, 25)}${hex(0, 0, 26)}${hex(0, 52, 24)}
    ${hex(-42, -28, 21)}${hex(42, -28, 21)}${hex(-42, 26, 21)}${hex(42, 26, 21)}
    <path d="M-46 -74 C-30 -94 10 -100 34 -86" stroke="rgba(255,255,255,0.3)" stroke-width="7" fill="none" stroke-linecap="round"/>
  </g>`;
}

function starfish(x, y, r, fill, deg) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.42 : r;
    d += `${i ? 'L' : 'M'}${f(Math.cos(a) * rr)} ${f(Math.sin(a) * rr)} `;
  }
  let dots = '';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    for (const k of [0.3, 0.55, 0.78]) dots += `<circle cx="${f(Math.cos(a) * r * k)}" cy="${f(Math.sin(a) * r * k)}" r="${f(r * 0.05)}" fill="rgba(255,240,220,0.75)"/>`;
  }
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})"><path d="${d}Z" fill="${fill}" stroke="${fill}" stroke-width="${f(r * 0.18)}" stroke-linejoin="round"/>${dots}</g>`;
}

function scallop(x, y, s, fill, ridge, deg) {
  let ridges = '';
  for (let i = 0; i < 7; i++) {
    const a = ((-150 + i * 20) * Math.PI) / 180;
    ridges += `<line x1="0" y1="10" x2="${f(Math.cos(a) * 30)}" y2="${f(10 + Math.sin(a) * 30)}" stroke="${ridge}" stroke-width="2.2"/>`;
  }
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)}) scale(${f(s)})">
    <path d="M0 12 L-30 -6 Q-28 -30 0 -32 Q28 -30 30 -6 Z" fill="${fill}"/>
    ${ridges}
    <path d="M-9 8 L-12 16 L12 16 L9 8 Z" fill="${fill}"/>
  </g>`;
}

function spiralShell(x, y, s, fill, line, deg) {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)}) scale(${f(s)})">
    <path d="M-26 8 C-30 -14 -6 -28 12 -20 C28 -12 30 8 14 14 L-26 14 Z" fill="${fill}"/>
    <path d="M14 14 C2 4 4 -10 14 -10 C22 -10 22 0 16 2" stroke="${line}" stroke-width="2.5" fill="none"/>
    <path d="M-20 10 L-34 18" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>
  </g>`;
}

function bubbles(rand, n, x0, x1, y0, y1, scale = 1) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const r = (2 + rand() * 7) * scale;
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="rgba(220,250,255,0.14)" stroke="rgba(235,252,255,0.75)" stroke-width="${f(Math.max(1, r * 0.22))}"/><circle cx="${f(x - r * 0.35)}" cy="${f(y - r * 0.35)}" r="${f(r * 0.25)}" fill="rgba(255,255,255,0.85)"/>`;
  }
  return out;
}

/** A rising column of bubbles from (x,y). */
function bubbleColumn(x, y, n, rand) {
  let out = '';
  let yy = y;
  for (let i = 0; i < n; i++) {
    const r = 3 + rand() * 5 + i * 0.4;
    yy -= 22 + rand() * 26;
    const xx = x + Math.sin(i * 1.3) * 10 + (rand() - 0.5) * 8;
    out += `<circle cx="${f(xx)}" cy="${f(yy)}" r="${f(r)}" fill="rgba(220,250,255,0.14)" stroke="rgba(235,252,255,0.8)" stroke-width="${f(Math.max(1, r * 0.22))}"/><circle cx="${f(xx - r * 0.35)}" cy="${f(yy - r * 0.35)}" r="${f(r * 0.25)}" fill="rgba(255,255,255,0.85)"/>`;
  }
  return out;
}

/* ------------------------------------------------------------------ layers */

export function back() {
  const r = rng(20261122);
  const extra = `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9BE6E6"/><stop offset="0.16" stop-color="#4FC3D3"/>
      <stop offset="0.45" stop-color="#2496B8"/><stop offset="0.72" stop-color="#18779E"/>
      <stop offset="1" stop-color="#11587E"/></linearGradient>
    <linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFBE0" stop-opacity="0.55"/><stop offset="0.7" stop-color="#FFFBE0" stop-opacity="0.08"/><stop offset="1" stop-color="#FFFBE0" stop-opacity="0"/></linearGradient>
    <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F1DDA8"/><stop offset="1" stop-color="#D9BC82"/></linearGradient>
    <filter id="haze" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
    <radialGradient id="deep" cx="0.5" cy="0.38" r="0.75"><stop offset="0.55" stop-color="#0B3A5A" stop-opacity="0"/><stop offset="1" stop-color="#0B3A5A" stop-opacity="0.45"/></radialGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sea)"/>`;
  // Sunlight from the surface: a bright glow and slanting god-rays.
  b += `<ellipse cx="520" cy="-40" rx="420" ry="220" fill="#FFF7D0" opacity="0.5" filter="url(#soft)"/>`;
  let rays = '';
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 100 + (r() - 0.5) * 50;
    const w0 = 30 + r() * 50;
    const w1 = w0 * (2.4 + r() * 1.2);
    const drift = -60 + (x - 450) * 0.3;
    const len = 1000 + r() * 400;
    rays += `<path d="M${f(x - w0 / 2)} -10 L${f(x + w0 / 2)} -10 L${f(x + drift + w1 / 2)} ${f(len)} L${f(x + drift - w1 / 2)} ${f(len)} Z" fill="url(#ray)" opacity="${f(0.45 + r() * 0.45)}"/>`;
  }
  b += `<g filter="url(#haze)">${rays}</g>`;
  // The rippling surface at the very top.
  let surf = `M0 0 L${W} 0 L${W} 46`;
  for (let i = 18; i >= 0; i--) surf += ` Q${f((i + 0.5) * 50)} ${f(46 + (i % 2 ? 16 : -6))} ${f(i * 50)} 46`;
  b += `<path d="${surf} Z" fill="#D8F7F1" opacity="0.6"/>`;
  for (let i = 0; i < 14; i++) b += `<ellipse cx="${f(r() * W)}" cy="${f(70 + r() * 70)}" rx="${f(20 + r() * 40)}" ry="3" fill="#E9FFFB" opacity="${f(0.25 + r() * 0.3)}"/>`;
  // Distant reef, misty with depth.
  b += `<g opacity="0.55">${band(1060, 30, 2.6, '#3A9FB8', r, 0.4)}</g>`;
  let farReef = '';
  for (const [x, h] of [[90, 120], [220, 80], [700, 110], [820, 140]]) farReef += `<ellipse cx="${x}" cy="1090" rx="${f(h * 0.7)}" ry="${h}" fill="#3A9FB8" opacity="0.5"/>`;
  b += farReef;
  b += layer(1, band(1140, 26, 1.8, '#2D869E', r, 1.6));
  // A far school, silhouetted.
  b += `<g opacity="0.45">${school(250, 1010, 14, 260, 30, '#1E6E88', 1, r, 0.55)}</g>`;
  // Jellyfish drifting in the upper water.
  b += layer(1, jelly(740, 250, 1.05, '#F6A9D0', '#FFD8EC', r) + jelly(130, 330, 0.8, '#C9B2F2', '#EBDFFF', r) + jelly(600, 120, 0.55, '#FFC4B0', '#FFE6DA', r));
  // A school above the title plate, swimming right.
  b += layer(1, school(330, 380, 16, 380, 26, '#FFC94D', 1, r, 0.95));
  // Kelp forests either side, behind the coral.
  let kelpBack = '';
  kelpBack += kelp(60, 1340, 760, 50, KELP[2], r, 13, 0.2);
  kelpBack += kelp(150, 1330, 600, -40, KELP[0], r, 11, 1.3);
  kelpBack += kelp(830, 1340, 720, -50, KELP[2], r, 12, 2.1);
  kelpBack += kelp(745, 1330, 520, 40, KELP[1], r, 9, 0.7);
  b += layer(2, kelpBack);
  // The sea turtle, gliding up and to the right — the scene's centre.
  b += `<ellipse cx="460" cy="1020" rx="210" ry="40" fill="#0D4E6E" opacity="0.18" filter="url(#soft)"/>`;
  b += layer(2, turtle(450, 860, 1.12, 38));
  b += bubbleColumn(520, 760, 4, r);
  // Reef fish near the turtle.
  b += layer(2, roundFish(250, 760, 0.9, '#FF9F45', '#FFF4E0', 1) + roundFish(690, 930, 0.75, '#5BC0EB', '#1F4E9C', -1) + roundFish(300, 1010, 0.62, '#FFD23F', '#2F3E8F', 1));
  // A school sweeping past lower right.
  b += layer(1, school(690, 1090, 13, 300, 34, '#F7F2E6', -1, r, 0.8));
  // The sandy floor.
  b += layer(2, band(1290, 16, 1.4, 'url(#sand)', r, 0.9));
  let ripples = '';
  for (let i = 0; i < 9; i++) {
    const y = 1340 + i * 30 + r() * 10;
    const x = r() * 700;
    ripples += `<path d="M${f(x)} ${f(y)} q40 -8 80 0 t80 0 t80 0" stroke="#C9A96E" stroke-width="2.5" fill="none" opacity="0.55"/>`;
  }
  b += ripples;
  // Caustic light dancing on the sand.
  let caustic = '';
  for (let i = 0; i < 26; i++) caustic += `<ellipse cx="${f(r() * W)}" cy="${f(1320 + r() * 260)}" rx="${f(14 + r() * 26)}" ry="${f(4 + r() * 5)}" fill="#FFF8DC" opacity="${f(0.25 + r() * 0.3)}"/>`;
  b += caustic;
  // The reef: coral clusters left and right, a brain coral in the middle.
  let reef = '';
  reef += seaFan(150, 1330, 260, 300, '#9B6FD1', '#6E45A8', r);
  reef += seaFan(760, 1320, 220, 250, '#F25C8A', '#B83563', r);
  reef += branchCoral(300, 1340, 90, -6, 3, '#FF7A6B', '#FFB3A3', r);
  reef += branchCoral(620, 1340, 80, 10, 3, '#FF9F45', '#FFD39A', r);
  reef += tubes(90, 1360, 0.9, '#E8577A', '#FF8DA8');
  reef += tubes(860, 1370, 0.8, '#6F7BD8', '#A4AEF5');
  b += layer(2, reef);
  let front = '';
  front += brainCoral(450, 1400, 260, 120, '#F2A65A', '#C77A33');
  front += anemone(270, 1430, 70, '#FF8DA8', '#FFE1EA', r);
  front += anemone(650, 1440, 64, '#FFC94D', '#FFF2C2', r);
  front += brainCoral(160, 1480, 170, 80, '#D46FB0', '#A2477F');
  front += brainCoral(760, 1490, 190, 88, '#8FD1A0', '#5AA06E');
  b += layer(3, front);
  // Shells and a starfish on the sand.
  let floor = '';
  floor += starfish(360, 1530, 38, '#F2735A', 14);
  floor += starfish(590, 1555, 26, '#FFB04A', -20);
  floor += scallop(520, 1508, 0.9, '#F6D2C0', '#D9A58E', 12);
  floor += scallop(300, 1585, 0.7, '#FBE4D2', '#E0B49C', -18);
  floor += spiralShell(690, 1580, 0.95, '#F3E1C2', '#C49A6C', -8);
  b += layer(1, floor);
  b += bubbleColumn(300, 1250, 9, r) + bubbleColumn(640, 1260, 6, r);
  b += bubbles(r, 22, 40, 860, 140, 1200, 0.9);
  b += `<rect width="${W}" height="${H}" fill="url(#deep)"/>`;
  b += grain(0.14);
  return svg(b, extra);
}

export function gate() {
  const r = rng(77019);
  const extra = `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E4C57"/><stop offset="1" stop-color="#163B45"/></linearGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7DE95"/><stop offset="0.35" stop-color="#D2A04A"/><stop offset="0.6" stop-color="#94651F"/><stop offset="0.82" stop-color="#D9AE55"/><stop offset="1" stop-color="#F3D488"/></linearGradient>
    <linearGradient id="ring" gradientUnits="userSpaceOnUse" x1="${CX - RING}" y1="${CY - RING}" x2="${CX + RING}" y2="${CY + RING}"><stop offset="0" stop-color="#FBE6A6"/><stop offset="0.3" stop-color="#D7A54C"/><stop offset="0.55" stop-color="#8C5F1F"/><stop offset="0.78" stop-color="#C9963E"/><stop offset="1" stop-color="#F0CF7E"/></linearGradient>
    <linearGradient id="ringIn" gradientUnits="userSpaceOnUse" x1="${CX - RING}" y1="${CY - RING}" x2="${CX + RING}" y2="${CY + RING}"><stop offset="0" stop-color="#6A4512"/><stop offset="0.5" stop-color="#B98A3A"/><stop offset="1" stop-color="#F2D287"/></linearGradient>
    <radialGradient id="glass" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#3C9CC4"/><stop offset="0.45" stop-color="#17597F"/><stop offset="1" stop-color="#06213A"/></radialGradient>
    <linearGradient id="copper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E29A63"/><stop offset="0.5" stop-color="#B8693A"/><stop offset="1" stop-color="#7E4120"/></linearGradient>
    <linearGradient id="copperV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7E4120"/><stop offset="0.45" stop-color="#E29A63"/><stop offset="1" stop-color="#8E4A26"/></linearGradient>
    <radialGradient id="vig" cx="0.5" cy="0.47" r="0.72"><stop offset="0.6" stop-color="#050F14" stop-opacity="0"/><stop offset="1" stop-color="#050F14" stop-opacity="0.5"/></radialGradient>
    <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7DE95"/><stop offset="0.5" stop-color="#C9963E"/><stop offset="1" stop-color="#7E5418"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#wall)"/>`;
  // Painted steel plates, overlapping a little, each a slightly different
  // tone, with rows of rivets along their seams.
  const cols = [0, 300, 600, 900];
  const rows = [0, 430, 900, 1260];
  const tones = ['#1F4F5A', '#1C4852', '#22555F', '#1A444E', '#205059', '#1D4A54'];
  let plates = '';
  let rivets = '';
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < cols.length - 1; i++) {
      const x0 = cols[i] + (j % 2 ? -40 : 0);
      const x1 = cols[i + 1] + (j % 2 ? -40 : 0) + (i === cols.length - 2 ? 60 : 0);
      const y0 = rows[j];
      const y1 = rows[j + 1];
      plates += `<rect x="${x0 + 3}" y="${y0 + 3}" width="${x1 - x0 - 6}" height="${y1 - y0 - 6}" rx="6" fill="${tones[(i + j * 2) % tones.length]}"/>`;
      plates += `<rect x="${x0 + 3}" y="${y0 + 3}" width="${x1 - x0 - 6}" height="5" fill="rgba(255,255,255,0.06)"/>`;
      for (let x = x0 + 22; x < x1 - 10; x += 34) rivets += rivet(x, y0 + 18) + rivet(x, y1 - 18);
      for (let y = y0 + 52; y < y1 - 30; y += 34) rivets += rivet(x0 + 18, y) + rivet(x1 - 18, y);
    }
  }
  b += `<rect width="${W}" height="${H}" fill="#0F2F37"/>` + layer(1, plates) + rivets;
  // Paint wear: soft scuffs and a little verdigris.
  for (let i = 0; i < 18; i++) b += `<ellipse cx="${f(r() * W)}" cy="${f(r() * 1240)}" rx="${f(20 + r() * 60)}" ry="${f(6 + r() * 16)}" fill="#2B6470" opacity="${f(0.18 + r() * 0.2)}" transform="rotate(${f(r() * 40 - 20)} 0 0)"/>`;
  // Copper pipe across the top with an elbow down the right-hand wall.
  let pipes = '';
  pipes += `<rect x="-10" y="96" width="830" height="38" fill="url(#copper)"/>`;
  pipes += `<path d="M820 96 L846 96 Q880 96 880 130 L880 1270 L842 1270 L842 134 L820 134 Z" fill="url(#copperV)"/>`;
  pipes += `<path d="M820 96 Q880 96 880 134 L842 134 Q842 134 820 134 Z" fill="#C97A46"/>`;
  for (const x of [140, 420, 690]) pipes += `<rect x="${x}" y="88" width="30" height="54" rx="5" fill="url(#brass)"/><rect x="${x - 6}" y="80" width="42" height="10" rx="3" fill="#7E5418"/>`;
  for (const y of [300, 640, 980]) pipes += `<rect x="834" y="${y}" width="54" height="28" rx="5" fill="url(#brass)"/>`;
  // Pipe brackets on the wall.
  for (const x of [280, 560]) pipes += `<rect x="${x}" y="90" width="16" height="50" rx="4" fill="#5E3E12"/><rect x="${x - 10}" y="136" width="36" height="12" rx="3" fill="#5E3E12"/>${bolt(x - 2, 142, 5)}${bolt(x + 18, 142, 5)}`;
  // A thin conduit down the left wall.
  pipes += `<rect x="34" y="134" width="20" height="1130" fill="url(#copperV)" opacity="0.9"/><rect x="26" y="114" width="36" height="24" rx="4" fill="url(#brass)"/>`;
  for (const y of [420, 760, 1100]) pipes += `<rect x="28" y="${y}" width="32" height="14" rx="3" fill="url(#brass)"/>`;
  b += layer(2, pipes);
  b += layer(2, valve(861, 520, 34, '#C8473A'));
  // Gauges: one up top-left, a pair lower right.
  b += layer(2, `<rect x="146" y="134" width="10" height="70" fill="url(#copperV)"/>` + gauge(151, 262, 62, 28));
  b += layer(2, `<rect x="760" y="1150" width="80" height="12" fill="url(#copper)"/>` + gauge(760, 1150, 48, -40));
  // Wooden wainscot along the bottom, capped with a brass rail.
  let wood = '';
  const woods = ['#6E4024', '#7B4A2A', '#653A20', '#744526', '#5E3620'];
  for (let i = 0, x = 0; x < W; i++, x += 76) {
    wood += `<rect x="${x}" y="1270" width="74" height="${H - 1270}" fill="${woods[i % woods.length]}"/>`;
    for (let k = 0; k < 4; k++) {
      const gx = x + 10 + r() * 54;
      wood += `<path d="M${f(gx)} 1280 C${f(gx + 6)} 1360 ${f(gx - 6)} 1450 ${f(gx + 3)} ${H}" stroke="rgba(30,14,6,0.28)" stroke-width="${f(1 + r() * 1.5)}" fill="none"/>`;
    }
    wood += `<ellipse cx="${f(x + 20 + r() * 34)}" cy="${f(1330 + r() * 230)}" rx="6" ry="11" fill="rgba(30,14,6,0.3)"/>`;
    wood += `<circle cx="${x + 12}" cy="1300" r="3" fill="#2E1A0C"/><circle cx="${x + 62}" cy="1300" r="3" fill="#2E1A0C"/>`;
  }
  b += layer(1, wood);
  b += layer(2, `<rect x="0" y="1246" width="${W}" height="30" fill="url(#rail)"/><rect x="0" y="1246" width="${W}" height="5" fill="#FCEBB4"/>`);
  // The lantern, lower left; the coil of rope on its cleat, lower right.
  b += layer(2, lantern(96, 1060, 1.05));
  b += layer(2, ropeCoil(640, 1330, r));

  // The porthole. A mounting flange first (riveted, darker), then the brass
  // ring proper, then the bolts. Inside r=293: the tinted glass.
  b += `<circle cx="${CX}" cy="${CY}" r="${RING + 50}" fill="#0E2B33" opacity="0.5" filter="url(#soft)"/>`;
  let flange = `<circle cx="${CX}" cy="${CY}" r="${RING + 34}" fill="#163E48"/>${annulus(CX, CY, RING + 26, RING + 34, '#2A6270')}`;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    flange += rivet(CX + Math.cos(a) * (RING + 17), CY + Math.sin(a) * (RING + 17), 4.5, '#0E2B33', 'rgba(255,255,255,0.28)');
  }
  b += layer(2, flange);
  // Hinge (left) and a latch dog (right) on the ring.
  b += layer(2, `<rect x="${CX - RING - 52}" y="${CY - 70}" width="70" height="140" rx="12" fill="url(#brass)"/>
    <rect x="${CX - RING - 40}" y="${CY - 92}" width="26" height="184" rx="13" fill="#B98A3A"/>
    <rect x="${CX - RING - 36}" y="${CY - 92}" width="8" height="184" rx="4" fill="#F6DC96" opacity="0.7"/>
    ${bolt(CX - RING - 14, CY - 44, 8)}${bolt(CX - RING - 14, CY + 44, 8)}
    <path d="M${CX + RING - 10} ${CY - 34} L${CX + RING + 46} ${CY - 22} Q${CX + RING + 60} ${CY} ${CX + RING + 46} ${CY + 22} L${CX + RING - 10} ${CY + 34} Z" fill="url(#brass)"/>
    <circle cx="${CX + RING + 36}" cy="${CY}" r="14" fill="#8C5F1F"/><circle cx="${CX + RING + 36}" cy="${CY}" r="8" fill="#E9C576"/>`);
  // Tinted glass, with a soft blue glow from the reef beyond.
  let glass = `<circle cx="${CX}" cy="${CY}" r="${HOLE + 4}" fill="url(#glass)"/>`;
  glass += `<circle cx="${CX}" cy="${CY - 40}" r="190" fill="#62D3EA" opacity="0.32" filter="url(#soft)"/>`;
  for (let i = 0; i < 5; i++) {
    const x = CX - 150 + i * 70;
    glass += `<path d="M${x} ${CY - HOLE + 20} L${x + 26} ${CY - HOLE + 20} L${x + 70} ${CY + 120} L${x + 20} ${CY + 120} Z" fill="#BDF3FF" opacity="0.07"/>`;
  }
  glass += `<g opacity="0.35">${fish(CX - 110, CY + 40, 1.1, '#0B3A57', 1)}${fish(CX - 60, CY + 70, 0.9, '#0B3A57', 1)}${fish(CX - 140, CY + 90, 0.8, '#0B3A57', 1)}</g>`;
  glass += `<path d="M${CX - 236} ${CY - 70} A250 250 0 0 1 ${CX - 70} ${CY - 236}" stroke="#FFFFFF" stroke-width="22" fill="none" stroke-linecap="round" opacity="0.22"/>`;
  glass += `<path d="M${CX - 200} ${CY - 20} A210 210 0 0 1 ${CX - 160} ${CY - 130}" stroke="#FFFFFF" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.35"/>`;
  glass += `<path d="M${CX + 190} ${CY + 150} A240 240 0 0 1 ${CX + 90} ${CY + 225}" stroke="#FFFFFF" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.14"/>`;
  b += glass;
  // The brass ring: a sloping inner lip, the broad face, a bright outer bead.
  let ring = annulus(CX, CY, HOLE, RING, 'url(#ring)');
  ring += annulus(CX, CY, HOLE, HOLE + 14, 'url(#ringIn)');
  ring += annulus(CX, CY, RING - 6, RING, '#FCEBB4', 'opacity="0.55"');
  ring += annulus(CX, CY, HOLE + 14, HOLE + 17, '#5E3E12', 'opacity="0.5"');
  ring += `<path d="M${f(CX - 322 * Math.cos(0.5))} ${f(CY - 322 * Math.sin(0.5))} A322 322 0 0 1 ${f(CX + 322 * Math.cos(1.25))} ${f(CY - 322 * Math.sin(1.25))}" stroke="#FFF3C8" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.45"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    ring += bolt(CX + Math.cos(a) * 326, CY + Math.sin(a) * 326, 10);
  }
  b += layer(3, ring);
  b += `<rect width="${W}" height="${H}" fill="url(#vig)"/>`;
  b += grain(0.13);
  return svg(b, extra);
}

/** Kelp and a coral cluster rising from the bottom edge (mirrored in the app). */
export function mid() {
  const r = rng(4417);
  let k = '';
  k += kelp(70, 905, 760, 46, KELP[2], r, 13, 0.4);
  k += kelp(170, 905, 620, -38, KELP[0], r, 11, 1.7);
  k += kelp(30, 905, 500, 30, KELP[3], r, 9, 2.6);
  let c = '';
  c += seaFan(270, 905, 230, 270, '#9B6FD1', '#6E45A8', r);
  c += branchCoral(130, 910, 92, 8, 3, '#FF7A6B', '#FFB3A3', r);
  c += tubes(370, 905, 0.85, '#E8577A', '#FF8DA8');
  let front = '';
  front += brainCoral(210, 905, 220, 100, '#F2A65A', '#C77A33');
  front += anemone(60, 905, 66, '#FFC94D', '#FFF2C2', r);
  front += starfish(320, 880, 24, '#F2735A', 18);
  const body = layer(3, k) + layer(3, c) + layer(3, front) + bubbleColumn(240, 600, 8, r) + bubbleColumn(90, 300, 5, r);
  return svg(body, '', { width: 600, height: 900 });
}
