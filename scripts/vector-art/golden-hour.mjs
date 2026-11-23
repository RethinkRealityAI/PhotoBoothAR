/**
 * Golden hour — milestone birthdays, retirements, dinner parties, any
 * evening worth toasting. Hand-built paper scene (see paper.mjs). Layers:
 * gate (three panels of gold drapery strung with fairy lights — the 'rise'
 * gateway lifts them like a stage curtain), back (a long table set for
 * dinner on a hillside at sunset, under festoon lights), mid (tall golden
 * grasses and wildflowers for each bottom corner).
 */
import { W, H, rng, svg, layer, leaf, band, grain } from './paper.mjs';

const f = (n) => Math.round(n * 10) / 10;
const BLOOMS = ['#FFFFFF', '#F7C6A3', '#E8836B', '#F4D35E', '#C98BB9'];

function bulb(x, y, s = 1) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})"><circle r="16" fill="#FFD98A" opacity="0.35" filter="url(#soft)"/><path d="M-3 -10 L3 -10 L3 -5 L-3 -5 Z" fill="#4A3A2A"/><ellipse cx="0" cy="2" rx="6" ry="8" fill="#FFF1C4"/></g>`;
}

/** Festoon lights sagging from (x1,y1) to (x2,y2). */
function festoon(x1, y1, x2, y2, sag, n) {
  const pt = (t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * sag];
  let out = `<path d="M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + sag * 2} ${x2} ${y2}" stroke="#3A2C22" stroke-width="2" fill="none"/>`;
  for (let i = 1; i < n; i++) {
    const [x, y] = pt(i / n);
    out += bulb(x, y + 10);
  }
  return out;
}

function candle(x, y, h) {
  return `<rect x="${x - 4}" y="${y - h}" width="8" height="${h}" rx="2" fill="#FFF6E6"/><path d="M${x} ${y - h - 16} C${x + 5} ${y - h - 8} ${x + 4} ${y - h - 2} ${x} ${y - h} C${x - 4} ${y - h - 2} ${x - 5} ${y - h - 8} ${x} ${y - h - 16} Z" fill="#FFC857"/><circle cx="${x}" cy="${y - h - 8}" r="14" fill="#FFC857" opacity="0.35" filter="url(#soft)"/>`;
}

function bouquet(x, y, s, rand) {
  let out = `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})"><path d="M-12 0 L12 0 L9 26 L-9 26 Z" fill="#D9E4DC" opacity="0.85"/>`;
  for (let i = 0; i < 4; i++) out += leaf((rand() - 0.5) * 16, 0, 26 + rand() * 10, 7, -50 + i * 33, '#6E8B5A');
  for (let i = 0; i < 6; i++) out += `<circle cx="${f((rand() - 0.5) * 30)}" cy="${f(-10 - rand() * 18)}" r="${f(6 + rand() * 4)}" fill="${BLOOMS[i % BLOOMS.length]}"/>`;
  return out + '</g>';
}

function grass(x, y, h, deg, fill) {
  return `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})" d="M-3 0 C-4 ${f(-h * 0.5)} -1 ${f(-h * 0.85)} 2 ${f(-h)} C2 ${f(-h * 0.85)} 4 ${f(-h * 0.5)} 3 0 Z" fill="${fill}"/>`;
}

/** A head of wheat-like grass. */
function seedHead(x, y, h, deg, fill) {
  let out = `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})"><path d="M0 0 L0 ${f(-h)}" stroke="${fill}" stroke-width="3"/>`;
  for (let i = 0; i < 7; i++) {
    const yy = -h + i * 11;
    out += `<ellipse cx="-5" cy="${yy}" rx="4" ry="8" fill="${fill}" transform="rotate(-25 -5 ${yy})"/><ellipse cx="5" cy="${yy + 4}" rx="4" ry="8" fill="${fill}" transform="rotate(25 5 ${yy + 4})"/>`;
  }
  return out + '</g>';
}

export function back() {
  const r = rng(5050);
  const sky = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4E5A9A"/><stop offset="0.3" stop-color="#C98BB9"/><stop offset="0.5" stop-color="#F7A072"/><stop offset="0.64" stop-color="#FFD58A"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // The sun setting, in paper rings, half behind the far hills.
  b += `<circle cx="450" cy="900" r="260" fill="#FFE3A3" opacity="0.4" filter="url(#soft)"/>`;
  b += layer(1, `<circle cx="450" cy="900" r="170" fill="#FFE9B8"/><circle cx="450" cy="900" r="128" fill="#FFD67A"/><circle cx="450" cy="900" r="88" fill="#FFC04D"/>`);
  // Long paper clouds.
  b += layer(1, `<path d="M40 420 C80 380 180 380 220 410 C260 390 340 400 360 430 L40 430 Z" fill="#F6C1B0" opacity="0.9"/><path d="M560 560 C600 520 700 520 740 550 C780 530 860 540 880 570 L560 570 Z" fill="#F9CFA4" opacity="0.9"/>`);
  // Rolling hills, far to near.
  b += layer(1, band(900, 30, 1.4, '#B9748C', r, 0.6));
  b += layer(1, band(980, 36, 1.8, '#9C6A7E', r, 2.0));
  b += layer(2, band(1070, 26, 1.2, '#C9A15A', r, 1.1));
  // Rows of vines on the near hill.
  let rows = '';
  for (let i = 0; i < 8; i++) rows += `<path d="M${-40 + i * 130} 1600 Q${100 + i * 90} 1250 ${300 + i * 45} 1090" stroke="#8C7A3E" stroke-width="10" fill="none" opacity="0.55"/>`;
  b += rows;
  // Two old trees framing the table, and the festoon lights between them.
  b += layer(2, `<path d="M30 1600 C60 1300 40 1000 90 720 L130 720 C110 1000 140 1300 120 1600 Z" fill="#4A3426"/><path d="M870 1600 C840 1300 860 1000 810 720 L770 720 C790 1000 760 1300 780 1600 Z" fill="#4A3426"/>`);
  let crowns = '';
  for (let i = 0; i < 44; i++) {
    const left = i % 2 === 0;
    const x = left ? 40 + r() * 200 : W - 40 - r() * 200;
    crowns += leaf(x, 520 + r() * 280, 110 + r() * 70, 36, (left ? 1 : -1) * (30 + r() * 100), ['#6E7F3E', '#8A8F45', '#A39248', '#5E6E36'][i % 4], 'rgba(255,255,255,0.18)');
  }
  b += layer(2, crowns);
  b += layer(1, festoon(110, 760, 790, 760, 70, 10) + festoon(110, 880, 790, 880, 46, 9));
  // The long table, in perspective, with a runner, candles and flowers.
  b += layer(3, `<path d="M300 1150 L600 1150 L760 1430 L140 1430 Z" fill="#FFF4E4"/><path d="M140 1430 L760 1430 L760 1452 L140 1452 Z" fill="#E7D3BA"/><path d="M420 1150 L480 1150 L520 1430 L380 1430 Z" fill="#E8B76A" opacity="0.8"/>`);
  let tableTop = '';
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const y = 1180 + t * 230;
    const s = 0.7 + t * 0.6;
    tableTop += candle(450 + (i % 2 ? 18 : -18) * s, y, 30 * s);
    tableTop += bouquet(450 + (i % 2 ? -26 : 26) * s, y - 4, s, r);
    for (const side of [-1, 1]) {
      const px = 450 + side * (110 + t * 190);
      tableTop += `<ellipse cx="${f(px)}" cy="${f(y)}" rx="${f(22 * s)}" ry="${f(9 * s)}" fill="#FFFFFF" stroke="#D9C2A0" stroke-width="2"/>`;
      tableTop += `<path d="M${f(px + side * 32 * s)} ${f(y - 30 * s)} l${f(-8 * s)} 0 l${f(4 * s)} ${f(18 * s)} Z" fill="#F7E2C2" opacity="0.9"/>`;
    }
  }
  b += layer(1, tableTop);
  // Table legs and chairs.
  b += layer(2, `<rect x="160" y="1452" width="16" height="110" fill="#8A6A4A"/><rect x="724" y="1452" width="16" height="110" fill="#8A6A4A"/>`);
  let chairs = '';
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const x = 450 + side * (190 + i * 70);
      const y = 1230 + i * 90;
      chairs += `<rect x="${x - 16}" y="${y - 50}" width="32" height="52" rx="5" fill="#C9A47A"/><rect x="${x - 12}" y="${y - 44}" width="24" height="5" fill="#E9D3B4"/><rect x="${x - 12}" y="${y - 32}" width="24" height="5" fill="#E9D3B4"/>`;
    }
  }
  b += layer(1, chairs);
  // Wildflowers along the bottom.
  let fg = '';
  for (let i = 0; i < 130; i++) {
    const x = r() * W;
    const y = 1500 + r() * 90;
    fg += grass(x, y, 60 + r() * 60, -20 + r() * 40, ['#B58C3E', '#D9B25E', '#8C7A3E'][i % 3]);
    if (i % 4 === 0) fg += `<circle cx="${f(x)}" cy="${f(y - 50 - r() * 30)}" r="${f(6 + r() * 4)}" fill="${BLOOMS[i % BLOOMS.length]}"/>`;
  }
  b += layer(1, fg);
  b += grain();
  return svg(b, sky);
}

export function gate() {
  const bg = `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A5A1E"/><stop offset="1" stop-color="#5E3A12"/></linearGradient>
  <linearGradient id="fold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E9B556"/><stop offset="0.45" stop-color="#FFE2A0"/><stop offset="1" stop-color="#C98E35"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#g)"/>`;
  // Gold drapery in vertical folds. Three panels (300px each) so each one
  // lifts as its own piece of curtain.
  for (let p = 0; p < 3; p++) {
    let panel = '';
    const x0 = p * 300;
    for (let i = 0; i < 6; i++) {
      const x = x0 + i * 50;
      panel += `<path d="M${x} 0 C${x + 8} 500 ${x - 6} 1100 ${x + 4} ${H} L${x + 54} ${H} C${x + 44} 1100 ${x + 58} 500 ${x + 50} 0 Z" fill="url(#fold)"/>`;
    }
    // A swag gathered at the top of each panel.
    panel += `<path d="M${x0} 0 L${x0 + 300} 0 L${x0 + 300} 70 C${x0 + 220} 150 ${x0 + 80} 150 ${x0} 70 Z" fill="#D9A04A"/>`;
    panel += `<path d="M${x0} 70 C${x0 + 80} 150 ${x0 + 220} 150 ${x0 + 300} 70" stroke="#FFE2A0" stroke-width="5" fill="none"/>`;
    // Gold tassel at each swag.
    panel += `<circle cx="${x0 + 150}" cy="140" r="12" fill="#B8862E"/><path d="M${x0 + 140} 146 L${x0 + 160} 146 L${x0 + 166} 196 L${x0 + 134} 196 Z" fill="#B8862E"/>`;
    b += layer(2, panel);
  }
  // Strands of fairy lights hanging down the folds.
  let lights = '';
  for (let i = 0; i < 12; i++) {
    const x = 37 + i * 75;
    const len = 700 + ((i * 337) % 600);
    lights += `<path d="M${x} 0 L${x + ((i % 3) - 1) * 10} ${len}" stroke="rgba(80,50,20,0.35)" stroke-width="1.5"/>`;
    for (let y = 120 + (i % 3) * 30; y < len; y += 90) lights += `<circle cx="${f(x + ((i % 3) - 1) * 10 * (y / len))}" cy="${y}" r="16" fill="#FFF1C4" opacity="0.35" filter="url(#soft)"/><circle cx="${f(x + ((i % 3) - 1) * 10 * (y / len))}" cy="${y}" r="4.5" fill="#FFF8DC"/>`;
  }
  b += lights;
  b += grain(0.12);
  return svg(b, bg);
}

export function mid() {
  const r = rng(808);
  let body = '';
  for (let i = 0; i < 40; i++) body += grass(20 + r() * 380, 900, 260 + r() * 360, -8 + r() * 40, ['#B58C3E', '#D9B25E', '#8C7A3E', '#C9A15A'][i % 4]);
  for (let i = 0; i < 10; i++) body += seedHead(30 + r() * 330, 900, 380 + r() * 260, -6 + r() * 34, '#E3BC6A');
  let blooms = '';
  for (let i = 0; i < 9; i++) {
    const x = 40 + r() * 320;
    const y = 520 + r() * 300;
    for (let k = 0; k < 5; k++) blooms += `<ellipse cx="${f(x)}" cy="${f(y - 9)}" rx="6" ry="10" fill="${BLOOMS[i % BLOOMS.length]}" transform="rotate(${k * 72} ${f(x)} ${f(y)})"/>`;
    blooms += `<circle cx="${f(x)}" cy="${f(y)}" r="5" fill="#F4B942"/>`;
  }
  return svg(layer(3, body) + layer(2, blooms), '', { width: 600, height: 900 });
}
