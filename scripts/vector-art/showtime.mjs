/**
 * showtime.mjs — Showtime: red velvet curtains part onto a spotlit stage
 * under a marquee of bulbs and a sky of gold stars.
 *
 * The gate is a LIVE gate (src/lib/liveGates.ts 'curtains'): drawn piece by
 * piece in the app so the curtains gather fold by fold as they are pulled.
 * Its still gate.webp is written by scripts/render-live-gates.mjs; gate()
 * here is only the placeholder render-vector-art needs.
 */
import { W, H, rng, layer, grain, svg } from './paper.mjs';

const f = (n) => Math.round(n * 10) / 10;

function star5(cx, cy, r, fill, rot = -90) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = ((rot + i * 36) * Math.PI) / 180;
    const rr = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)} `;
  }
  return `<path d="${d}Z" fill="${fill}"/>`;
}

function bulb(x, y, r = 9) {
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${r * 2.6}" fill="url(#bulbGlow)"/><circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="#FFF4CF"/>`;
}

const extra = `
  <linearGradient id="hall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A0710"/><stop offset="0.55" stop-color="#3A0C1D"/><stop offset="1" stop-color="#22060F"/></linearGradient>
  <radialGradient id="wallGlow" cx="0.5" cy="0.45" r="0.55"><stop offset="0" stop-color="#7A1E3A" stop-opacity="0.9"/><stop offset="1" stop-color="#7A1E3A" stop-opacity="0"/></radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset="0.5" stop-color="#E2B04F"/><stop offset="1" stop-color="#A9761F"/></linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6B3A1F"/><stop offset="1" stop-color="#2E160B"/></linearGradient>
  <radialGradient id="bulbGlow"><stop offset="0" stop-color="#FFE9A8" stop-opacity="0.85"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6DC" stop-opacity="0.55"/><stop offset="1" stop-color="#FFF6DC" stop-opacity="0.05"/></linearGradient>
  <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFF1C9" stop-opacity="0.85"/><stop offset="1" stop-color="#FFF1C9" stop-opacity="0"/></radialGradient>
  <linearGradient id="velvetSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5E0B18"/><stop offset="0.2" stop-color="#B0213A"/><stop offset="0.4" stop-color="#5E0B18"/><stop offset="0.6" stop-color="#B0213A"/><stop offset="0.8" stop-color="#5E0B18"/><stop offset="1" stop-color="#8E1A2E"/></linearGradient>`;

export function back() {
  const r = rng(4242);
  let body = `<rect width="${W}" height="${H}" fill="url(#hall)"/><rect width="${W}" height="${H}" fill="url(#wallGlow)"/>`;
  // A sky of paper stars on the back wall.
  let stars = '';
  for (let i = 0; i < 70; i++) {
    const x = r() * W;
    const y = 160 + r() * 820;
    stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1 + r() * 2.2)}" fill="#FFE9B8" opacity="${f(0.35 + r() * 0.6)}"/>`;
  }
  body += stars;
  body += layer(1, [
    [210, 420, 46], [690, 360, 38], [455, 250, 30], [140, 760, 26], [770, 700, 32], [330, 600, 20], [600, 560, 22],
  ].map(([x, y, s]) => star5(x, y, s, 'url(#gold)', -90 + (x % 30))).join(''));
  // The proscenium: a gold arch ringed with marquee bulbs.
  const arch = `M70 1220 L70 360 Q70 170 260 170 L640 170 Q830 170 830 360 L830 1220`;
  body += layer(2, `<path d="${arch}" fill="none" stroke="url(#gold)" stroke-width="34"/><path d="${arch}" fill="none" stroke="#7A4E12" stroke-width="4" transform="translate(0 16)" opacity="0.5"/>`);
  let bulbs = '';
  for (let i = 0; i <= 14; i++) bulbs += bulb(70, 1200 - i * 58);
  for (let i = 0; i <= 14; i++) bulbs += bulb(830, 1200 - i * 58);
  for (let i = 0; i <= 8; i++) bulbs += bulb(260 + i * 47.5, 170);
  bulbs += bulb(130, 230) + bulb(770, 230) + bulb(180, 190) + bulb(720, 190);
  body += bulbs;
  // Tied-back side curtains inside the arch.
  const side = (x0, dir) =>
    `<path d="M${x0} 200 L${x0 + dir * 150} 200 Q${x0 + dir * 60} 700 ${x0 + dir * 120} 1240 L${x0} 1240 Z" fill="url(#velvetSide)"/>` +
    `<path d="M${x0 + dir * 40} 760 q${dir * 40} -20 ${dir * 70} 10" stroke="url(#gold)" stroke-width="10" fill="none" stroke-linecap="round"/>`;
  body += layer(2, side(88, 1) + side(812, -1));
  // Spotlight beams and the pool of light centre stage.
  body += `<path d="M120 0 L240 0 L560 1300 L360 1300 Z" fill="url(#beam)" opacity="0.6"/><path d="M780 0 L660 0 L340 1300 L540 1300 Z" fill="url(#beam)" opacity="0.6"/>`;
  // The stage floor: boards in perspective with a gold lip.
  let boards = `<path d="M0 1240 L${W} 1240 L${W} ${H} L0 ${H} Z" fill="url(#floor)"/>`;
  for (let i = -8; i <= 8; i++) {
    boards += `<path d="M${450 + i * 40} 1240 L${450 + i * 150} ${H}" stroke="#2A1208" stroke-width="2" opacity="0.6"/>`;
  }
  boards += `<rect x="0" y="1232" width="${W}" height="16" fill="url(#gold)"/>`;
  body += layer(3, boards);
  body += `<ellipse cx="450" cy="1330" rx="300" ry="70" fill="url(#pool)"/>`;
  // Footlights.
  let foot = '';
  for (let i = 0; i < 9; i++) foot += bulb(90 + i * 90, 1262, 7);
  body += foot;
  body += grain(0.12);
  return svg(body, extra);
}

/** Hanging gold stars for the top corners (mirrored in the app). */
export function mid() {
  const hang = [
    [80, 360, 58],
    [220, 220, 44],
    [340, 420, 36],
  ];
  let body = `<path d="${hang.map(([x, y, s]) => `M${x} 0 L${x} ${y - s}`).join(' ')}" stroke="#E2B04F" stroke-width="3"/>`;
  body += layer(3, hang.map(([x, y, s]) => star5(x, y, s, 'url(#gold)') + star5(x, y, s * 0.42, '#FFF4CF')).join(''));
  return svg(body, extra, { width: 600, height: 900 });
}

/** Placeholder only: the real gate is drawn live (see the file comment). */
export function gate() {
  return back();
}
