/**
 * Love notes — anniversaries, proposals, Valentine's. Hand-built paper scene
 * (see paper.mjs). Layers: gate (a wall of paper roses with a heart cut into
 * it — the 'heart' iris opens through it), back (a moonlit rose garden with a
 * bench, heart lanterns and a pond), mid (a rose cluster for each corner).
 */
import { W, H, rng, svg, layer, leaf, band, grain } from './paper.mjs';

const ROSES = ['#C8344F', '#E0566E', '#F08AA0', '#B02844', '#F6B3C2'];
const LEAVES = ['#2F5E4A', '#3D7058', '#4C8266', '#27503F'];

const f = (n) => Math.round(n * 10) / 10;

/** A paper rose seen from above: rings of petals, darker towards the heart. */
function rose(x, y, r, fill, rand) {
  let out = `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rand() * 360)})">`;
  const rings = [
    [1, 7, 0.5],
    [0.74, 6, 0.42],
    [0.5, 5, 0.34],
  ];
  rings.forEach(([s, n, w], ri) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 360 + ri * 23;
      out += `<ellipse cx="0" cy="${f(-r * s * 0.5)}" rx="${f(r * w)}" ry="${f(r * s * 0.55)}" fill="${fill}" transform="rotate(${f(a)})"/>`;
    }
    out += `<circle r="${f(r * s * 0.62)}" fill="rgba(0,0,0,${0.08 + ri * 0.06})"/>`;
  });
  out += `<path d="M0 0 m${f(-r * 0.18)} 0 a${f(r * 0.18)} ${f(r * 0.18)} 0 1 1 ${f(r * 0.3)} ${f(r * 0.06)}" stroke="rgba(0,0,0,0.25)" stroke-width="${f(Math.max(1.5, r * 0.05))}" fill="none"/>`;
  return out + '</g>';
}

function heart(x, y, s, fill) {
  return `<path transform="translate(${f(x)} ${f(y)}) scale(${f(s)})" d="M0 8 C-14 -2 -12 -14 -5 -14 C-2 -14 0 -12 0 -9 C0 -12 2 -14 5 -14 C12 -14 14 -2 0 8 Z" fill="${fill}"/>`;
}

function heartLantern(x, y, s) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
    <circle r="34" fill="#FFD9A8" opacity="0.28" filter="url(#soft)"/>
    <path d="M0 -28 L0 -12" stroke="#6B4A3A" stroke-width="2"/>
    <path d="M0 22 C-26 4 -24 -14 -11 -14 C-5 -14 0 -10 0 -6 C0 -10 5 -14 11 -14 C24 -14 26 4 0 22 Z" fill="#FFC8A8"/>
    <path d="M0 16 C-16 4 -15 -8 -8 -8 C-4 -8 0 -5 0 -2 C0 -5 4 -8 8 -8 C15 -8 16 4 0 16 Z" fill="#FFE9C8"/>
  </g>`;
}

export function back() {
  const r = rng(140214);
  const sky = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2156"/><stop offset="0.42" stop-color="#6B3F7A"/><stop offset="0.7" stop-color="#D9809A"/><stop offset="0.82" stop-color="#F6C2B4"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // Stars.
  for (let i = 0; i < 60; i++) {
    const x = r() * W;
    const y = r() * 760;
    b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + r() * 1.8)}" fill="#FFF3E0" opacity="${f(0.4 + r() * 0.6)}"/>`;
  }
  // Paper moon, a halo behind it.
  b += `<circle cx="610" cy="430" r="190" fill="#FFE4D0" opacity="0.18" filter="url(#soft)"/>`;
  b += layer(1, `<circle cx="610" cy="430" r="118" fill="#FFF1DE"/><circle cx="580" cy="400" r="20" fill="#F6DCC6"/><circle cx="650" cy="470" r="13" fill="#F6DCC6"/><circle cx="640" cy="395" r="9" fill="#F6DCC6"/>`);
  // Far hedges and trees.
  b += layer(1, band(960, 24, 3.2, '#5A3A6E', r, 0.3));
  b += layer(1, band(1020, 30, 2.4, '#4A3260', r, 1.4));
  // The pond, with the moon on it.
  b += layer(1, `<ellipse cx="450" cy="1190" rx="380" ry="70" fill="#7D5A8E"/><ellipse cx="450" cy="1190" rx="330" ry="52" fill="#9A76A6"/>`);
  b += `<ellipse cx="600" cy="1190" rx="70" ry="9" fill="#FFF1DE" opacity="0.55"/><ellipse cx="590" cy="1208" rx="44" ry="5" fill="#FFF1DE" opacity="0.35"/>`;
  // Rose arch framing the garden.
  const arch = `<path d="M90 1600 L90 620 C90 330 810 330 810 620 L810 1600 L760 1600 L760 625 C760 390 140 390 140 625 L140 1600 Z" fill="#3B2A4E"/>`;
  b += layer(2, arch);
  let archRoses = '';
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    // Along the arch: up the left post, over the top, down the right post.
    let x;
    let y;
    if (t < 0.3) {
      x = 115;
      y = 1350 - (t / 0.3) * 730;
    } else if (t < 0.7) {
      const a = Math.PI - ((t - 0.3) / 0.4) * Math.PI;
      x = 450 + Math.cos(a) * 335;
      y = 625 - Math.sin(a) * 250;
    } else {
      x = 785;
      y = 620 + ((t - 0.7) / 0.3) * 730;
    }
    x += (r() - 0.5) * 40;
    y += (r() - 0.5) * 30;
    archRoses += leaf(x + 10, y + 14, 46, 15, -60 + r() * 120, LEAVES[i % LEAVES.length]);
    if (i % 2 === 0) archRoses += rose(x, y, 20 + r() * 14, ROSES[i % ROSES.length], r);
  }
  b += layer(2, archRoses);
  // String of heart lanterns across the arch.
  b += `<path d="M150 700 Q450 860 750 700" stroke="#3B2A4E" stroke-width="2.5" fill="none"/>`;
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const x = 150 + t * 600;
    const y = 700 + Math.sin(t * Math.PI) * 80 + 28;
    b += layer(1, heartLantern(x, y, 0.9 + (i % 2) * 0.15));
  }
  // The lawn and path.
  b += layer(2, band(1260, 14, 1.2, '#5B7A5E', r, 0.4));
  b += layer(2, `<path d="M380 1600 C410 1460 430 1330 445 1262 L475 1262 C490 1330 520 1460 560 1600 Z" fill="#E8C8C0"/>`);
  // The bench for two, with a little gift and a letter on it.
  b += layer(3, `<g transform="translate(450 1262) scale(1.35)">
    <rect x="-150" y="-70" width="300" height="16" rx="5" fill="#F3E3D6"/>
    <rect x="-150" y="-46" width="300" height="16" rx="5" fill="#F3E3D6"/>
    <rect x="-160" y="-14" width="320" height="18" rx="6" fill="#FFF1E4"/>
    <rect x="-140" y="4" width="14" height="52" fill="#D9C2B4"/><rect x="126" y="4" width="14" height="52" fill="#D9C2B4"/>
    <rect x="-120" y="-24" width="64" height="12" rx="2" fill="#FFFFFF" transform="rotate(-6 -88 -18)"/>
    <path d="M-120 -24 L-88 -14 L-56 -24" stroke="#E0566E" stroke-width="2" fill="none" transform="rotate(-6 -88 -18)"/>
    ${heart(-88, -16, 0.5, '#E0566E')}
    <rect x="60" y="-46" width="50" height="40" rx="4" fill="#E0566E"/><rect x="80" y="-46" width="10" height="40" fill="#FFE1A8"/><rect x="56" y="-54" width="58" height="12" rx="3" fill="#E0566E"/>
  </g>`);
  // Rose bushes and fallen petals in the foreground.
  let fg = '';
  for (let i = 0; i < 16; i++) {
    const x = 40 + r() * 820;
    const y = 1380 + r() * 220;
    if (x > 360 && x < 560) continue;
    for (let k = 0; k < 3; k++) fg += leaf(x + (r() - 0.5) * 50, y + 20, 60 + r() * 30, 20, -50 + r() * 100, LEAVES[(i + k) % LEAVES.length]);
    fg += rose(x, y, 22 + r() * 12, ROSES[i % ROSES.length], r);
  }
  b += layer(2, fg);
  let petals = '';
  for (let i = 0; i < 26; i++) petals += heart(380 + r() * 180, 1300 + r() * 290, 0.6 + r() * 0.5, ROSES[i % ROSES.length]);
  b += layer(1, petals);
  b += grain();
  return svg(b, sky);
}

export function gate() {
  const r = rng(1402);
  const bg = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7A1F38"/><stop offset="1" stop-color="#4E1226"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#g)"/>`;
  // Rows of roses and leaves, deep to near, so the wall has depth.
  for (let row = 0; row < 3; row++) {
    let body = '';
    for (let i = 0; i < 60; i++) {
      const x = r() * W;
      const y = r() * H;
      body += leaf(x + 14, y + 18, 70 + r() * 40, 22, r() * 360, LEAVES[(i + row) % LEAVES.length]);
    }
    for (let i = 0; i < 46; i++) {
      body += rose(r() * W, r() * H, 34 + r() * 26 + row * 6, ROSES[(i + row) % ROSES.length], r);
    }
    b += layer(row + 1, body);
  }
  // A ribbon tied across the wall, with a bow and a note "for you".
  b += layer(2, `<path d="M0 1060 C220 1010 680 1110 900 1050 L900 1086 C680 1146 220 1046 0 1096 Z" fill="#F6D3B4"/>`);
  b += layer(3, `<g transform="translate(450 1072)">
    <path d="M0 0 C-60 -70 -120 -40 -96 0 C-120 40 -60 70 0 0 Z" fill="#F0C3A0"/>
    <path d="M0 0 C60 -70 120 -40 96 0 C120 40 60 70 0 0 Z" fill="#F0C3A0"/>
    <path d="M-8 6 L-40 110 L-14 96 L0 120 Z M8 6 L40 110 L14 96 L0 120 Z" fill="#E8B48E"/>
    <circle r="16" fill="#E8B48E"/>
  </g>`);
  b += grain(0.14);
  return svg(b, bg);
}

export function mid() {
  const r = rng(29);
  let leaves = '';
  for (let i = 0; i < 16; i++) leaves += leaf(40 + r() * 300, 900, 200 + r() * 260, 46 + r() * 20, -15 + r() * 80, LEAVES[i % LEAVES.length]);
  let roses = '';
  const spots = [
    [150, 760, 70],
    [300, 820, 56],
    [80, 610, 52],
    [240, 650, 40],
    [380, 720, 34],
  ];
  spots.forEach(([x, y, s], i) => {
    roses += rose(x, y, s, ROSES[i % ROSES.length], r);
  });
  const body = layer(3, leaves) + layer(3, roses);
  return svg(body, '', { width: 600, height: 900 });
}
