/**
 * Pumpkin moon — Halloween. Hand-built paper scene for the QR card
 * templates (see ../vector-art/paper.mjs for the shared kit): a dusk sky
 * going violet to ember, a huge harvest moon with bats crossing it, a crooked
 * house on the hill with lit windows, a bare tree framing the left edge, a
 * picket graveyard and a patch of glowing jack-o'-lanterns in front.
 *
 * Stage 900x1600, seeded, so a rebuild is byte-stable.
 */
import { W, H, rng, svg, layer, leaf, grain, band } from '../vector-art/paper.mjs';

const f = (n) => Math.round(n * 10) / 10;

/** A bat with wings spread, centred at (x,y), span s. */
function bat(x, y, s, fill, flap = 0) {
  const w = s / 2;
  const lift = flap * s * 0.18;
  const d = `M0 0 C${f(-w * 0.2)} ${f(-s * 0.12)} ${f(-w * 0.5)} ${f(-s * 0.2 - lift)} ${f(-w)} ${f(-s * 0.1 - lift)}
    C${f(-w * 0.82)} ${f(s * 0.02)} ${f(-w * 0.7)} ${f(s * 0.02)} ${f(-w * 0.6)} ${f(s * 0.08)}
    C${f(-w * 0.5)} ${f(s * 0.0)} ${f(-w * 0.38)} ${f(s * 0.02)} ${f(-w * 0.3)} ${f(s * 0.1)}
    C${f(-w * 0.2)} ${f(s * 0.04)} ${f(-w * 0.1)} ${f(s * 0.06)} 0 ${f(s * 0.12)}
    C${f(w * 0.1)} ${f(s * 0.06)} ${f(w * 0.2)} ${f(s * 0.04)} ${f(w * 0.3)} ${f(s * 0.1)}
    C${f(w * 0.38)} ${f(s * 0.02)} ${f(w * 0.5)} ${f(s * 0.0)} ${f(w * 0.6)} ${f(s * 0.08)}
    C${f(w * 0.7)} ${f(s * 0.02)} ${f(w * 0.82)} ${f(s * 0.02)} ${f(w)} ${f(-s * 0.1 - lift)}
    C${f(w * 0.5)} ${f(-s * 0.2 - lift)} ${f(w * 0.2)} ${f(-s * 0.12)} 0 0 Z`;
  return `<g transform="translate(${f(x)} ${f(y)})"><path d="${d}" fill="${fill}"/>
    <path d="M${f(-s * 0.05)} ${f(-s * 0.02)} L${f(-s * 0.07)} ${f(-s * 0.1)} L${f(-s * 0.02)} ${f(-s * 0.05)} L${f(s * 0.02)} ${f(-s * 0.05)} L${f(s * 0.07)} ${f(-s * 0.1)} L${f(s * 0.05)} ${f(-s * 0.02)} Z" fill="${fill}"/></g>`;
}

/** A jack-o'-lantern sitting on the ground at (x, base), width w. */
function pumpkin(x, base, w, lit, rand) {
  const h = w * (0.72 + rand() * 0.12);
  const cy = base - h / 2;
  const ribs = 5;
  let body = '';
  for (let i = 0; i < ribs; i++) {
    const t = (i - (ribs - 1) / 2) / ((ribs - 1) / 2);
    const rx = (w / 2) * (1 - Math.abs(t) * 0.45);
    const cx = x + t * w * 0.3;
    const shade = Math.abs(t) > 0.6 ? '#C2521A' : Math.abs(t) > 0.2 ? '#DB6A22' : '#EE8430';
    body += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(h / 2)}" fill="${shade}"/>`;
  }
  body += `<path d="M${f(x - 4)} ${f(base - h + 4)} C${f(x - 6)} ${f(base - h - 18)} ${f(x + 10)} ${f(base - h - 30)} ${f(x + 16)} ${f(base - h - 26)} L${f(x + 6)} ${f(base - h + 6)} Z" fill="#4E5B2A"/>`;
  if (lit) {
    const ey = cy - h * 0.12;
    const glow = '#FFD46A';
    body += `<ellipse cx="${f(x)}" cy="${f(cy)}" rx="${f(w * 0.75)}" ry="${f(h * 0.7)}" fill="#FFB347" opacity="0.18" filter="url(#soft)"/>`;
    body += `<path d="M${f(x - w * 0.27)} ${f(ey + 10)} L${f(x - w * 0.17)} ${f(ey - 14)} L${f(x - w * 0.07)} ${f(ey + 10)} Z" fill="${glow}"/>`;
    body += `<path d="M${f(x + w * 0.07)} ${f(ey + 10)} L${f(x + w * 0.17)} ${f(ey - 14)} L${f(x + w * 0.27)} ${f(ey + 10)} Z" fill="${glow}"/>`;
    const my = cy + h * 0.16;
    let mouth = `M${f(x - w * 0.3)} ${f(my)} Q${f(x)} ${f(my + h * 0.3)} ${f(x + w * 0.3)} ${f(my)}`;
    mouth += ` L${f(x + w * 0.2)} ${f(my + 4)} L${f(x + w * 0.14)} ${f(my - 6)} L${f(x + w * 0.07)} ${f(my + 6)} L${f(x)} ${f(my - 4)} L${f(x - w * 0.07)} ${f(my + 6)} L${f(x - w * 0.14)} ${f(my - 6)} L${f(x - w * 0.2)} ${f(my + 4)} Z`;
    body += `<path d="${mouth}" fill="${glow}"/>`;
  }
  return body;
}

/** A gnarled bare branch from (x,y): recursive forks, seeded. */
function branch(x, y, len, deg, width, fill, rand, depth) {
  const a = ((deg - 90) * Math.PI) / 180;
  const bend = (rand() - 0.5) * len * 0.35;
  const ex = x + Math.cos(a) * len;
  const ey = y + Math.sin(a) * len;
  const mx = (x + ex) / 2 + Math.cos(a + Math.PI / 2) * bend;
  const my = (y + ey) / 2 + Math.sin(a + Math.PI / 2) * bend;
  let out = `<path d="M${f(x)} ${f(y)} Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}" stroke="${fill}" stroke-width="${f(width)}" fill="none" stroke-linecap="round"/>`;
  if (depth > 0) {
    const kids = depth > 2 ? 2 : 2 + (rand() > 0.5 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      const spread = 22 + rand() * 26;
      const d2 = deg + (i - (kids - 1) / 2) * spread + (rand() - 0.5) * 14;
      out += branch(ex, ey, len * (0.62 + rand() * 0.16), d2, width * 0.62, fill, rand, depth - 1);
    }
  }
  return out;
}

function house(x, base, fill, light) {
  // A crooked two-storey house with a tower, every line a touch off-true.
  let s = `<path d="M${x - 120} ${base} L${x - 118} ${base - 150} L${x - 140} ${base - 150} L${x - 60} ${base - 250} L${x + 22} ${base - 156} L${x + 6} ${base - 154} L${x + 8} ${base} Z" fill="${fill}"/>`;
  s += `<path d="M${x + 4} ${base} L${x + 6} ${base - 210} L${x - 8} ${base - 212} L${x + 46} ${base - 330} L${x + 100} ${base - 206} L${x + 86} ${base - 206} L${x + 84} ${base} Z" fill="${fill}"/>`;
  s += `<path d="M${x + 46} ${base - 330} L${x + 48} ${base - 372}" stroke="${fill}" stroke-width="5"/>`;
  s += `<rect x="${x - 70}" y="${base - 120}" width="22" height="30" fill="${light}"/><rect x="${x - 104}" y="${base - 120}" width="22" height="30" fill="${light}" opacity="0.7"/>`;
  s += `<rect x="${x + 32}" y="${base - 260}" width="26" height="34" rx="13" fill="${light}"/>`;
  s += `<rect x="${x + 28}" y="${base - 150}" width="22" height="28" fill="${light}" opacity="0.85"/>`;
  s += `<circle cx="${x - 60}" cy="${base - 196}" r="12" fill="${light}" opacity="0.9"/>`;
  s += `<ellipse cx="${x - 10}" cy="${base - 150}" rx="190" ry="130" fill="${light}" opacity="0.08" filter="url(#soft)"/>`;
  return s;
}

export function back() {
  const r = rng(1031);
  const sky = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#170B2E"/><stop offset="0.38" stop-color="#3A1656"/>
      <stop offset="0.62" stop-color="#7A2E5C"/><stop offset="0.8" stop-color="#D9663A"/><stop offset="1" stop-color="#F2A04A"/></linearGradient>
    <radialGradient id="moon" cx="0.42" cy="0.4" r="0.7"><stop offset="0" stop-color="#FFF6D8"/><stop offset="0.7" stop-color="#FBE3A6"/><stop offset="1" stop-color="#F2C778"/></radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFE7A8" stop-opacity="0.55"/><stop offset="1" stop-color="#FFE7A8" stop-opacity="0"/></radialGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // Stars, thinning toward the glow at the horizon.
  for (let i = 0; i < 90; i++) {
    const y = r() * 760;
    b += `<circle cx="${f(r() * W)}" cy="${f(y)}" r="${f(0.8 + r() * 1.8)}" fill="#FFF3D6" opacity="${f(0.35 + r() * 0.5 * (1 - y / 900))}"/>`;
  }
  // The harvest moon.
  b += `<circle cx="560" cy="470" r="360" fill="url(#halo)"/>`;
  b += layer(1, `<circle cx="560" cy="470" r="210" fill="url(#moon)"/>
    <circle cx="500" cy="410" r="34" fill="#F0CF86" opacity="0.55"/><circle cx="618" cy="520" r="46" fill="#F0CF86" opacity="0.45"/>
    <circle cx="640" cy="390" r="18" fill="#F0CF86" opacity="0.5"/><circle cx="520" cy="560" r="20" fill="#F0CF86" opacity="0.4"/>`);
  // Soft cloud wisps drifting over the moon's lower edge.
  b += `<ellipse cx="520" cy="600" rx="260" ry="26" fill="#6A2C6E" opacity="0.5" filter="url(#soft)"/>`;
  b += `<ellipse cx="700" cy="560" rx="180" ry="18" fill="#6A2C6E" opacity="0.4" filter="url(#soft)"/>`;
  // Bats crossing the moon.
  let bats = '';
  const batSpots = [[430, 330, 70], [520, 270, 54], [610, 330, 44], [700, 250, 60], [360, 420, 40], [760, 400, 34], [250, 300, 48]];
  batSpots.forEach(([x, y, s], i) => { bats += bat(x, y, s, '#160A22', (i % 3) / 2); });
  b += layer(1, bats);
  // Far hills.
  b += layer(1, band(1010, 26, 1.3, '#4A1E52', r, 0.6));
  // The hill with the house.
  b += layer(2, `<path d="M${W} 1080 C780 930 640 900 520 960 C440 1000 360 1060 300 1120 L${W} 1120 Z" fill="#2A0F33"/>` + house(680, 960, '#2A0F33', '#FFC765'));
  // Mid ground.
  b += layer(2, band(1120, 22, 1.6, '#30123A', r, 1.4));
  // Graveyard fence and stones.
  let yard = '';
  for (let i = 0; i < 16; i++) {
    const x = 330 + i * 34;
    const y = 1150 + Math.sin(i * 0.7) * 6;
    yard += `<path d="M${x} ${f(y)} L${x} ${f(y - 64)} L${x + 6} ${f(y - 76)} L${x + 12} ${f(y - 64)} L${x + 12} ${f(y)} Z" fill="#1E0B26"/>`;
  }
  yard += `<rect x="330" y="1104" width="550" height="7" fill="#1E0B26"/><rect x="330" y="1130" width="550" height="7" fill="#1E0B26"/>`;
  yard += `<path d="M150 1190 L150 1132 Q178 1100 206 1132 L206 1190 Z" fill="#3B1F47"/><path d="M168 1150 L188 1150 M178 1138 L178 1170" stroke="#5E3B6B" stroke-width="5"/>`;
  yard += `<path d="M236 1196 L236 1150 Q258 1126 280 1150 L280 1196 Z" fill="#3B1F47"/>`;
  b += layer(2, yard);
  // Low fog.
  b += `<path d="M0 1180 C160 1150 300 1200 460 1176 C620 1152 760 1196 ${W} 1170 L${W} 1240 L0 1240 Z" fill="#B47AB0" opacity="0.22" filter="url(#soft)"/>`;
  // The pumpkin patch.
  b += layer(2, band(1250, 18, 2.2, '#24102B', r, 0.3));
  let patch = '';
  const vine = '#3E4A22';
  patch += `<path d="M0 1330 C140 1290 260 1360 420 1320 C560 1286 700 1350 ${W} 1310" stroke="${vine}" stroke-width="7" fill="none"/>`;
  for (let i = 0; i < 18; i++) patch += leaf(40 + i * 48 + r() * 20, 1320 + Math.sin(i) * 18, 50 + r() * 26, 22, -60 + r() * 120, i % 2 ? '#4E5B2A' : '#3E4A22', 'rgba(255,255,255,0.12)');
  b += layer(2, patch);
  const pumpkins = [[150, 1440, 190, true], [400, 1470, 140, false], [600, 1450, 210, true], [800, 1480, 130, true], [290, 1555, 120, false], [720, 1580, 150, false]];
  let pk = '';
  for (const [x, base, w, lit] of pumpkins) pk += pumpkin(x, base, w, lit, r);
  b += layer(3, pk);
  // The bare tree framing the left edge.
  let tree = `<path d="M-30 ${H} C10 1300 -10 1000 50 780 C66 720 62 650 46 590 C62 560 84 560 96 590 C116 670 122 740 108 810 C74 1000 110 1300 90 ${H} Z" fill="#12061A"/>`;
  tree += branch(70, 640, 220, 40, 22, '#12061A', r, 4);
  tree += branch(60, 760, 170, 70, 16, '#12061A', r, 3);
  tree += branch(50, 600, 180, 8, 16, '#12061A', r, 3);
  b += layer(3, tree);
  b += grain(0.14);
  return svg(b, sky);
}
