/**
 * jewel-box.mjs — Jewel box: an ornate lacquered jewellery box. The recipient
 * slides three gold bolts open and its two doors swing apart onto the glowing
 * velvet inside. Hand-built paper scene (see paper.mjs).
 *
 * Layers:
 *  - gate: the closed front — two emerald-lacquer door leaves meeting at a
 *    seam at x=450 (the app halves the image there and swings each half like
 *    a door, so the RIGHT leaf is the left one mirrored and each reads as a
 *    complete panel). The app draws three sliding gold bolts across the seam
 *    at y = 560 / 800 / 1040 (~220px wide, centred on x=450); the art paints
 *    their keepers at x≈294-346 / 554-606 and keeps the strip over the seam at
 *    those heights bare lacquer. The band y≈330-460 is left plain for the
 *    name plate.
 *  - back: the open box — tufted rose-plum velvet, a mirror in the lid,
 *    pearl swags, a crown on a cushion as the centrepiece (450, ~850-1060),
 *    a ring box and loose gems on the ledge, a compartment tray of
 *    paper-cut gems with a big diamond catching the light, and the box's
 *    lacquer lip in front. The title band y≈480-650 is calm velvet + glow.
 *  - mid: pearl strands and two gold chains with pendants hanging into each
 *    top corner (mirrored in the app).
 */
import { W, H, rng, svg, layer, grain } from './paper.mjs';

const f = (n) => Math.round(n * 10) / 10;

// Gem palettes: [light facet, body, dark facet].
const RUBY = ['#FF7A96', '#D3204A', '#74091F'];
const SAPPHIRE = ['#8CB8FF', '#2A55CC', '#0E2268'];
const EMERALD = ['#86F2C0', '#17A26C', '#064C36'];
const AMETHYST = ['#E2B6FF', '#8F42D3', '#481879'];
const CITRINE = ['#FFEBA8', '#F2B33D', '#9C6210'];
const DIAMOND = ['#FFFFFF', '#E3EEF7', '#A6BED2'];

const LIGHT = (-135 * Math.PI) / 180; // light from the upper left

/** Pick a facet colour from the direction its face points. */
function shade(angle, p) {
  const k = Math.cos(angle - LIGHT);
  return k > 0.35 ? p[0] : k < -0.35 ? p[2] : p[1];
}

const poly = (pts) => pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

/** A round brilliant seen from above: octagon girdle, facet ring, table. */
function roundGem(x, y, r, p) {
  const ring = (rr) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = ((i * 45 + 22.5) * Math.PI) / 180;
      return [x + Math.cos(a) * rr, y + Math.sin(a) * rr];
    });
  const o = ring(r);
  const t = ring(r * 0.56);
  let out = `<polygon points="${poly(o)}" fill="${p[2]}"/>`;
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    const mid = (((i + 0.5) * 45 + 22.5) * Math.PI) / 180;
    out += `<polygon points="${poly([o[i], o[j], t[j], t[i]])}" fill="${shade(mid, p)}"/>`;
  }
  out += `<polygon points="${poly(t)}" fill="${p[1]}"/>`;
  out += `<polygon points="${poly([t[4], t[5], t[6], [x, y]])}" fill="${p[0]}" opacity="0.55"/>`;
  out += `<ellipse cx="${f(x - r * 0.22)}" cy="${f(y - r * 0.24)}" rx="${f(r * 0.16)}" ry="${f(r * 0.09)}" fill="#fff" opacity="0.85" transform="rotate(-35 ${f(x - r * 0.22)} ${f(y - r * 0.24)})"/>`;
  out += `<polygon points="${poly(o)}" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="${f(Math.max(0.8, r * 0.05))}"/>`;
  return out;
}

/** A step-cut (emerald cut) stone: chamfered rectangle, two facet steps, table. */
function emeraldCut(x, y, w, h, p) {
  const oct = (sw, sh) => {
    const c = Math.min(sw, sh) * 0.2;
    const hw = sw / 2;
    const hh = sh / 2;
    return [
      [x - hw + c, y - hh], [x + hw - c, y - hh], [x + hw, y - hh + c], [x + hw, y + hh - c],
      [x + hw - c, y + hh], [x - hw + c, y + hh], [x - hw, y + hh - c], [x - hw, y - hh + c],
    ];
  };
  const o = oct(w, h);
  const m = oct(w * 0.76, h * 0.7);
  const t = oct(w * 0.5, h * 0.4);
  // Each edge's outward direction, for shading: top, tr, right, br, bottom, bl, left, tl.
  const dirs = [-90, -45, 0, 45, 90, 135, 180, -135].map((d) => (d * Math.PI) / 180);
  let out = `<polygon points="${poly(o)}" fill="${p[2]}"/>`;
  for (const [a, b] of [[o, m], [m, t]]) {
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      out += `<polygon points="${poly([a[i], a[j], b[j], b[i]])}" fill="${shade(dirs[i], p)}"${b === t ? ' opacity="0.9"' : ''}/>`;
    }
  }
  out += `<polygon points="${poly(t)}" fill="${p[1]}"/>`;
  out += `<path d="M${f(x - w * 0.2)} ${f(y + h * 0.18)} L${f(x - w * 0.05)} ${f(y - h * 0.2)} L${f(x + w * 0.04)} ${f(y - h * 0.2)} L${f(x - w * 0.11)} ${f(y + h * 0.18)} Z" fill="#fff" opacity="0.35"/>`;
  out += `<polygon points="${poly(o)}" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1.2"/>`;
  return out;
}

/** A pear-cut drop, point up, centred on its round end at (x, y). */
function pearGem(x, y, r, p) {
  const d = `M${f(x)} ${f(y - r * 2)} C${f(x + r * 0.5)} ${f(y - r * 1.3)} ${f(x + r)} ${f(y - r * 0.6)} ${f(x + r)} ${f(y)} A${f(r)} ${f(r)} 0 0 1 ${f(x - r)} ${f(y)} C${f(x - r)} ${f(y - r * 0.6)} ${f(x - r * 0.5)} ${f(y - r * 1.3)} ${f(x)} ${f(y - r * 2)} Z`;
  let out = `<path d="${d}" fill="${p[1]}"/>`;
  out += `<path d="M${f(x)} ${f(y - r * 2)} C${f(x - r * 0.5)} ${f(y - r * 1.3)} ${f(x - r)} ${f(y - r * 0.6)} ${f(x - r)} ${f(y)} A${f(r)} ${f(r)} 0 0 0 ${f(x)} ${f(y + r)} L${f(x)} ${f(y - r * 0.2)} Z" fill="${p[0]}" opacity="0.7"/>`;
  out += `<path d="M${f(x)} ${f(y - r * 0.2)} L${f(x)} ${f(y + r)} A${f(r)} ${f(r)} 0 0 0 ${f(x + r)} ${f(y)} Z" fill="${p[2]}" opacity="0.6"/>`;
  out += `<ellipse cx="${f(x - r * 0.35)}" cy="${f(y - r * 0.5)}" rx="${f(r * 0.18)}" ry="${f(r * 0.32)}" fill="#fff" opacity="0.75"/>`;
  out += `<path d="${d}" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1"/>`;
  return out;
}

/** A brilliant diamond in profile: crown facets over a pointed pavilion. */
function diamondSide(cx, cy, w) {
  const G = [-0.5, -0.25, 0, 0.25, 0.5].map((k) => [cx + k * w, cy]);
  const T = [-0.28, -0.093, 0.093, 0.28].map((k) => [cx + k * w, cy - 0.22 * w]);
  const B = [cx, cy + 0.56 * w];
  const crownCols = ['#FFFFFF', '#CFE0EE', '#F4FAFF', '#B7CCE0', '#FFFFFF', '#D6E6F2', '#A9C0D6'];
  const strip = [G[0], T[0], G[1], T[1], G[2], T[2], G[3], T[3], G[4]];
  let out = '';
  for (let i = 0; i < 7; i++) out += `<polygon points="${poly([strip[i], strip[i + 1], strip[i + 2]])}" fill="${crownCols[i]}"/>`;
  out += `<polygon points="${poly([T[0], T[3], [T[3][0], T[3][1] - 0.001], [T[0][0], T[0][1] - 0.001]])}" fill="#fff"/>`;
  const pavCols = ['#9FB8CF', '#E8F2FA', '#C2D5E6', '#7F9BB6'];
  for (let i = 0; i < 4; i++) out += `<polygon points="${poly([G[i], G[i + 1], B])}" fill="${pavCols[i]}"/>`;
  out += `<path d="M${f(G[1][0])} ${f(cy)} L${f(cx - 0.06 * w)} ${f(B[1] - 0.05 * w)} M${f(G[3][0])} ${f(cy)} L${f(cx + 0.06 * w)} ${f(B[1] - 0.05 * w)}" stroke="#fff" stroke-width="1.2" opacity="0.7"/>`;
  out += `<polygon points="${poly([G[0], T[0], T[3], G[4], B])}" fill="none" stroke="rgba(40,60,90,0.35)" stroke-width="1.4"/>`;
  out += `<path d="M${f(G[0][0])} ${f(cy)} L${f(G[4][0])} ${f(cy)}" stroke="#fff" stroke-width="2" opacity="0.9"/>`;
  return out;
}

/** A four-point sparkle. */
function sparkle(x, y, s, fill = '#FFF8E6', op = 1) {
  const q = s * 0.12;
  return `<path d="M${f(x)} ${f(y - s)} C${f(x + q)} ${f(y - q)} ${f(x + q)} ${f(y - q)} ${f(x + s)} ${f(y)} C${f(x + q)} ${f(y + q)} ${f(x + q)} ${f(y + q)} ${f(x)} ${f(y + s)} C${f(x - q)} ${f(y + q)} ${f(x - q)} ${f(y + q)} ${f(x - s)} ${f(y)} C${f(x - q)} ${f(y - q)} ${f(x - q)} ${f(y - q)} ${f(x)} ${f(y - s)} Z" fill="${fill}" opacity="${op}"/>`;
}

/** Points spaced `step` apart along a sagging swag from (x1,y1) to (x2,y2). */
function along(x1, y1, x2, y2, sag, step) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 + 2 * sag;
  const at = (t) => [
    (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2,
    (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2,
  ];
  const pts = [];
  let prev = at(0);
  let acc = step; // place one at the start
  for (let i = 0; i <= 600; i++) {
    const p = at(i / 600);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    if (acc >= step) {
      pts.push([p[0], p[1], Math.atan2(p[1] - prev[1], p[0] - prev[0])]);
      acc = 0;
    }
    prev = p;
  }
  return { pts, d: `M${f(x1)} ${f(y1)} Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}` };
}

function pearl(x, y, r) {
  return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#pearl)"/><circle cx="${f(x - r * 0.33)}" cy="${f(y - r * 0.36)}" r="${f(r * 0.24)}" fill="#fff" opacity="0.9"/>`;
}

function pearlStrand(x1, y1, x2, y2, sag, r) {
  const { pts, d } = along(x1, y1, x2, y2, sag, r * 2.05);
  return `<path d="${d}" stroke="#B8A08F" stroke-width="1.2" fill="none"/>` + pts.map(([x, y]) => pearl(x, y, r)).join('');
}

function goldChain(x1, y1, x2, y2, sag) {
  const { pts } = along(x1, y1, x2, y2, sag, 8);
  return pts
    .map(([x, y, a], i) => {
      const deg = f((a * 180) / Math.PI);
      return i % 2
        ? `<rect x="${f(x - 5)}" y="${f(y - 1.3)}" width="10" height="2.6" rx="1.3" fill="#B8842A" transform="rotate(${deg} ${f(x)} ${f(y)})"/>`
        : `<ellipse cx="${f(x)}" cy="${f(y)}" rx="6" ry="3.4" fill="none" stroke="#F0C766" stroke-width="2.2" transform="rotate(${deg} ${f(x)} ${f(y)})"/>`;
    })
    .join('');
}

/** A gold filigree scroll: a sweep ending in a curl. (x,y) is its root. */
function scroll(x, y, s, rot = 0, flip = 1, w = 3) {
  const d = 'M0 0 C0 -26 22 -44 46 -40 C66 -36 72 -14 58 -4 C46 4 34 -6 40 -16 C44 -22 52 -20 52 -14';
  return `<path d="${d}" transform="translate(${f(x)} ${f(y)}) rotate(${rot}) scale(${f(s * flip)} ${f(s)})" fill="none" stroke="url(#gold)" stroke-width="${f(w / s)}" stroke-linecap="round"/>`;
}

/** A gold rosette with a stone at its heart. */
function rosette(x, y, r, gem) {
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += `<ellipse cx="${f(x)}" cy="${f(y - r * 0.72)}" rx="${f(r * 0.2)}" ry="${f(r * 0.32)}" fill="url(#gold)" transform="rotate(${i * 30} ${f(x)} ${f(y)})"/>`;
  }
  out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.6)}" fill="#7A4E12"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.54)}" fill="url(#gold)"/>`;
  return out + roundGem(x, y, r * 0.42, gem);
}

const extra = `
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFEDB0"/><stop offset="0.45" stop-color="#E4B451"/><stop offset="1" stop-color="#A2701C"/></linearGradient>
  <linearGradient id="goldH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#A2701C"/><stop offset="0.35" stop-color="#FFE8A0"/><stop offset="0.7" stop-color="#E0AC48"/><stop offset="1" stop-color="#9A6818"/></linearGradient>
  <linearGradient id="lacquer" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#082E25"/><stop offset="0.38" stop-color="#14654F"/><stop offset="0.7" stop-color="#0F4A3C"/><stop offset="1" stop-color="#09342A"/></linearGradient>
  <linearGradient id="lacquerV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14654F"/><stop offset="1" stop-color="#082E25"/></linearGradient>
  <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B3D31"/><stop offset="1" stop-color="#062820"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.11"/><stop offset="0.42" stop-color="#fff" stop-opacity="0"/><stop offset="0.62" stop-color="#fff" stop-opacity="0.05"/><stop offset="0.7" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <radialGradient id="pearl" cx="0.38" cy="0.35" r="0.7"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.55" stop-color="#F2E7E1"/><stop offset="1" stop-color="#B9A49C"/></radialGradient>
  <radialGradient id="velvetBg" cx="0.5" cy="0.42" r="0.78"><stop offset="0" stop-color="#B8406F"/><stop offset="0.42" stop-color="#7A1D4D"/><stop offset="0.82" stop-color="#3E0C2B"/><stop offset="1" stop-color="#26061A"/></radialGradient>
  <radialGradient id="warm"><stop offset="0" stop-color="#FFE2A8" stop-opacity="0.75"/><stop offset="0.5" stop-color="#FFC985" stop-opacity="0.25"/><stop offset="1" stop-color="#FFC985" stop-opacity="0"/></radialGradient>
  <radialGradient id="white"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/><stop offset="0.4" stop-color="#E9F4FF" stop-opacity="0.35"/><stop offset="1" stop-color="#E9F4FF" stop-opacity="0"/></radialGradient>
  <linearGradient id="mirror" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7E6EE"/><stop offset="0.45" stop-color="#D7B0C3"/><stop offset="0.7" stop-color="#F3E3EB"/><stop offset="1" stop-color="#B98AA3"/></linearGradient>
  <clipPath id="mirrorClip"><ellipse cx="450" cy="250" rx="232" ry="158"/></clipPath>
  <linearGradient id="cushion" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E5527F"/><stop offset="1" stop-color="#931A47"/></linearGradient>
  <linearGradient id="ledge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5C143B"/><stop offset="1" stop-color="#360A24"/></linearGradient>
  <linearGradient id="pad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6A1A45"/><stop offset="1" stop-color="#8A2A5A"/></linearGradient>
  <linearGradient id="navyVelvet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2F3A93"/><stop offset="1" stop-color="#181E5C"/></linearGradient>`;

/* ------------------------------------------------------------------ gate */

/** A bolt keeper: a gold plate with the slot the app's bolt slides into. */
function keeper(x, y) {
  return `<rect x="${x - 26}" y="${y - 42}" width="52" height="84" rx="7" fill="url(#gold)"/>
    <rect x="${x - 21}" y="${y - 37}" width="42" height="74" rx="5" fill="none" stroke="#8A5A14" stroke-width="1.5" opacity="0.6"/>
    <rect x="${x - 26}" y="${y - 25}" width="52" height="50" rx="4" fill="url(#goldH)"/>
    <rect x="${x - 26}" y="${y - 18}" width="52" height="36" rx="3" fill="#2E1E06"/>
    <rect x="${x - 26}" y="${y - 18}" width="52" height="6" fill="#000" opacity="0.35"/>
    <circle cx="${x}" cy="${y - 33}" r="4.5" fill="#FFE7A3"/><path d="M${x - 3} ${y - 33} L${x + 3} ${y - 33}" stroke="#8A5A14" stroke-width="1.4"/>
    <circle cx="${x}" cy="${y + 33}" r="4.5" fill="#FFE7A3"/><path d="M${x - 3} ${y + 33} L${x + 3} ${y + 33}" stroke="#8A5A14" stroke-width="1.4"/>`;
}

/** A gold strap hinge running in from the outer edge, ending in a fleur. */
function strap(y) {
  return `<rect x="22" y="${y - 8}" width="118" height="16" rx="4" fill="url(#gold)"/>
    <rect x="22" y="${y - 8}" width="118" height="4" fill="#FFF1C4" opacity="0.6"/>
    <circle cx="150" cy="${y}" r="13" fill="url(#gold)"/><circle cx="160" cy="${y - 14}" r="9" fill="url(#gold)"/><circle cx="160" cy="${y + 14}" r="9" fill="url(#gold)"/><circle cx="170" cy="${y}" r="9" fill="url(#gold)"/>
    ${roundGem(152, y, 6, EMERALD)}
    <circle cx="60" cy="${y}" r="3.6" fill="#7A4E12"/><circle cx="110" cy="${y}" r="3.6" fill="#7A4E12"/>
    <rect x="14" y="${y - 22}" width="20" height="44" rx="5" fill="url(#goldH)"/>`;
}

/** An L-shaped gold corner bracket with a scroll, for corner (x,y) facing (sx,sy). */
function corner(x, y, sx, sy) {
  return `<g transform="translate(${x} ${y}) scale(${sx} ${sy})">
    <path d="M0 0 L74 0 L74 12 L12 12 L12 74 L0 74 Z" fill="url(#gold)"/>
    <path d="M18 18 L56 18 M18 18 L18 56" stroke="url(#gold)" stroke-width="3"/>
    ${scroll(26, 26, 0.55, 45, 1, 2.4)}
    <circle cx="6" cy="6" r="3" fill="#7A4E12"/>
  </g>`;
}

/** One door leaf (the left one, x 0-450). The right leaf is this mirrored. */
function doorLeaf() {
  let b = '';
  // The leaf itself, lacquered.
  b += layer(2, `<rect x="8" y="8" width="438" height="1584" rx="6" fill="url(#lacquer)"/>
    <rect x="8" y="8" width="438" height="1584" rx="6" fill="url(#sheen)"/>`);
  // Border lines.
  b += `<rect x="28" y="28" width="402" height="1544" rx="4" fill="none" stroke="url(#gold)" stroke-width="5"/>`;
  b += `<rect x="40" y="40" width="378" height="1520" rx="3" fill="none" stroke="#E4B451" stroke-width="1.4" opacity="0.7"/>`;

  // Top panel: a calm arched panel with a rising sunburst and a citrine rosette.
  const top = 'M72 316 L72 160 Q72 82 150 82 L330 82 Q408 82 408 160 L408 316 Z';
  let tp = `<path d="${top}" fill="url(#panel)"/><path d="${top}" fill="none" stroke="url(#gold)" stroke-width="4"/>`;
  tp += `<path d="M86 304 L86 164 Q86 96 156 96 L324 96 Q394 96 394 164 L394 304 Z" fill="none" stroke="#E4B451" stroke-width="1.2" opacity="0.6"/>`;
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI + (i / 14) * Math.PI;
    tp += `<path d="M240 300 L${f(240 + Math.cos(a) * 150)} ${f(300 + Math.sin(a) * 150)}" stroke="#E4B451" stroke-width="${i % 2 ? 1 : 2}" opacity="${i % 2 ? 0.25 : 0.4}"/>`;
  }
  tp += `<path d="M150 300 A90 90 0 0 1 330 300" fill="none" stroke="url(#gold)" stroke-width="3"/>`;
  tp += rosette(240, 268, 34, CITRINE);
  tp += scroll(196, 278, 0.9, -95, -1) + scroll(284, 278, 0.9, 95, 1);
  b += layer(1, tp);

  // Middle panel: the bolt panel — straps, keepers and two jewelled medallions.
  let mp = `<rect x="72" y="470" width="336" height="660" rx="10" fill="url(#panel)"/>`;
  mp += `<rect x="72" y="470" width="336" height="660" rx="10" fill="none" stroke="url(#gold)" stroke-width="4"/>`;
  mp += `<rect x="86" y="484" width="308" height="632" rx="7" fill="none" stroke="#E4B451" stroke-width="1.2" opacity="0.6"/>`;
  for (const [cy, gem] of [[680, RUBY], [920, SAPPHIRE]]) {
    mp += `<circle cx="210" cy="${cy}" r="64" fill="none" stroke="url(#gold)" stroke-width="5"/>`;
    mp += `<circle cx="210" cy="${cy}" r="54" fill="none" stroke="#E4B451" stroke-width="1.2" opacity="0.7"/>`;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      mp += `<circle cx="${f(210 + Math.cos(a) * 64)}" cy="${f(cy + Math.sin(a) * 64)}" r="${i % 2 ? 2.6 : 4.2}" fill="#FFE7A3"/>`;
    }
    mp += scroll(210, cy - 8, 0.62, -60, -1, 2.4) + scroll(210, cy - 8, 0.62, 60, 1, 2.4);
    mp += scroll(210, cy + 8, 0.62, -120, 1, 2.4) + scroll(210, cy + 8, 0.62, 120, -1, 2.4);
    mp += `<circle cx="210" cy="${cy}" r="27" fill="url(#gold)"/>` + roundGem(210, cy, 21, gem);
    // Little stones either side, clear of the keepers.
    mp += roundGem(118, cy, 7, EMERALD) + roundGem(262, cy - 44, 6, CITRINE) + roundGem(262, cy + 44, 6, CITRINE);
  }
  for (const [x, y] of [[92, 490], [388, 490], [92, 1110], [388, 1110]]) mp += roundGem(x, y, 7, RUBY);
  b += layer(1, mp);
  // Strap hinges and keepers at the three bolt heights.
  b += layer(2, [560, 800, 1040].map((y) => strap(y) + keeper(320, y)).join(''));

  // Bottom panel: an ogee-arched panel with a filigree fan around an emerald.
  const bot = 'M72 1530 L72 1270 C72 1230 150 1210 196 1190 C220 1180 236 1166 240 1150 C244 1166 260 1180 284 1190 C330 1210 408 1230 408 1270 L408 1530 Z';
  let bp = `<path d="${bot}" fill="url(#panel)"/><path d="${bot}" fill="none" stroke="url(#gold)" stroke-width="4"/>`;
  bp += `<path d="M86 1516 L86 1276 C86 1244 156 1226 200 1206 C222 1196 234 1186 240 1174 C246 1186 258 1196 280 1206 C324 1226 394 1244 394 1276 L394 1516 Z" fill="none" stroke="#E4B451" stroke-width="1.2" opacity="0.6"/>`;
  // The fan: paired scrolls climbing from a gold urn.
  for (let i = 0; i <= 8; i++) {
    const a = 180 + (i / 8) * 180;
    bp += `<ellipse cx="240" cy="1458" rx="10" ry="28" fill="url(#gold)" transform="rotate(${f(a + 90)} 240 1494)"/>`;
  }
  bp += `<path d="M196 1494 A44 44 0 0 1 284 1494 Z" fill="#7A4E12"/><path d="M204 1494 A36 36 0 0 1 276 1494 Z" fill="url(#gold)"/>`;
  bp += roundGem(240, 1480, 11, RUBY);
  for (const [y, s] of [[1400, 1.1], [1340, 0.95], [1286, 0.8]]) {
    bp += scroll(240, y, s, -70, -1) + scroll(240, y, s, 70, 1);
  }
  bp += `<path d="M240 1440 L240 1260" stroke="#E4B451" stroke-width="3"/>`;
  bp += emeraldCut(240, 1322, 58, 78, EMERALD);
  bp += `<rect x="207" y="1279" width="66" height="86" rx="10" fill="none" stroke="url(#gold)" stroke-width="4"/>`;
  bp += pearl(240, 1248, 9) + pearl(152, 1400, 6) + pearl(328, 1400, 6);
  for (const [x, y] of [[92, 1510], [388, 1510]]) bp += roundGem(x, y, 7, SAPPHIRE);
  b += layer(1, bp);

  // Escutcheon with a keyhole on the stile by the seam, and a ring pull.
  b += layer(1, `<path d="M414 1176 C404 1176 404 1196 414 1206 L414 1250 L432 1250 L432 1206 C442 1196 442 1176 432 1176 Z" fill="url(#gold)"/>
    <circle cx="423" cy="1200" r="5" fill="#1E1404"/><path d="M420 1203 L426 1203 L428 1222 L418 1222 Z" fill="#1E1404"/>`);

  // Corner brackets on all four corners of the leaf.
  b += layer(1, corner(28, 28, 1, 1) + corner(430, 28, -1, 1) + corner(28, 1572, 1, -1) + corner(430, 1572, -1, -1));
  return b;
}

export function gate() {
  let b = `<rect width="${W}" height="${H}" fill="#04140F"/>`;
  const leaf = doorLeaf();
  b += leaf;
  b += `<g transform="translate(${W} 0) scale(-1 1)">${leaf}</g>`;
  // The seam where the doors meet, with a soft shadow into each leaf.
  b += `<rect x="432" y="0" width="18" height="${H}" fill="url(#seamL)"/><rect x="450" y="0" width="18" height="${H}" fill="url(#seamR)"/>`;
  b += `<rect x="447" y="0" width="6" height="${H}" fill="#020A07"/>`;
  b += `<rect x="446" y="0" width="1.2" height="${H}" fill="#E4B451" opacity="0.5"/><rect x="452.8" y="0" width="1.2" height="${H}" fill="#E4B451" opacity="0.5"/>`;
  b += grain(0.12);
  return svg(
    b,
    extra +
      `<linearGradient id="seamL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient>
  <linearGradient id="seamR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`,
  );
}

/* ------------------------------------------------------------------ back */

function crown() {
  let c = `<ellipse cx="450" cy="958" rx="96" ry="78" fill="#8E1640"/><ellipse cx="450" cy="944" rx="70" ry="52" fill="#B52457" opacity="0.6"/>`;
  const body = 'M352 1012 L330 902 L366 950 L392 872 L422 938 L450 846 L478 938 L508 872 L534 950 L570 902 L548 1012 Z';
  c += `<path d="${body}" fill="url(#gold)"/>`;
  c += `<path d="M366 950 L392 872 L404 902 Z M478 938 L450 846 L462 880 Z M534 950 L570 902 L556 936 Z" fill="#FFF1C4" opacity="0.5"/>`;
  c += `<path d="${body}" fill="none" stroke="#8A5A14" stroke-width="1.5" opacity="0.6"/>`;
  for (const [x, y, r] of [[330, 902, 9], [392, 872, 10], [450, 846, 11], [508, 872, 10], [570, 902, 9]]) c += pearl(x, y - r * 0.6, r);
  c += pearGem(450, 916, 11, RUBY) + pearGem(398, 932, 8, SAPPHIRE) + pearGem(502, 932, 8, SAPPHIRE);
  // The band.
  c += `<rect x="346" y="976" width="208" height="40" rx="8" fill="url(#gold)"/><rect x="346" y="980" width="208" height="5" fill="#FFF1C4" opacity="0.6"/>`;
  c += roundGem(450, 996, 14, EMERALD) + roundGem(400, 996, 10, RUBY) + roundGem(500, 996, 10, RUBY);
  for (const x of [364, 424, 476, 536]) c += pearl(x, 996, 5);
  return c;
}

function cushion() {
  let c = `<path d="M296 1018 Q450 996 604 1018 Q622 1046 604 1074 Q450 1094 296 1074 Q278 1046 296 1018 Z" fill="url(#cushion)"/>`;
  c += `<path d="M296 1018 Q450 996 604 1018 Q622 1046 604 1074 Q450 1094 296 1074 Q278 1046 296 1018 Z" fill="none" stroke="url(#gold)" stroke-width="3"/>`;
  c += `<path d="M320 1046 Q450 1036 580 1046" stroke="#FF8FB0" stroke-width="2" fill="none" opacity="0.35"/>`;
  for (const x of [292, 608]) {
    c += `<circle cx="${x}" cy="1076" r="6" fill="url(#gold)"/><path d="M${x - 7} 1080 L${x + 7} 1080 L${x + 5} 1108 L${x - 5} 1108 Z" fill="url(#gold)"/>`;
  }
  return c;
}

function ringBox(x) {
  let c = '';
  // The open lid behind, lined with satin.
  c += `<path d="M${x - 58} 986 L${x - 54} 900 Q${x} 890 ${x + 54} 900 L${x + 58} 986 Z" fill="url(#navyVelvet)"/>`;
  c += `<path d="M${x - 46} 978 L${x - 43} 912 Q${x} 904 ${x + 43} 912 L${x + 46} 978 Z" fill="#F4E9F1"/>`;
  c += `<path d="M${x - 20} 912 L${x - 32} 978 M${x + 14} 908 L${x + 4} 978" stroke="#fff" stroke-width="6" opacity="0.6"/>`;
  // The ring, half sunk into its slot, and its stone.
  c += `<circle cx="${x}" cy="982" r="22" fill="none" stroke="url(#gold)" stroke-width="7"/>`;
  c += diamondSide(x, 956, 30);
  c += `<circle cx="${x}" cy="950" r="26" fill="url(#white)" opacity="0.7"/>`;
  // The base, in front of the ring's lower half.
  c += `<rect x="${x - 60}" y="986" width="120" height="58" rx="8" fill="url(#navyVelvet)"/>`;
  c += `<rect x="${x - 60}" y="986" width="120" height="6" fill="#4A56B8"/><rect x="${x - 40}" y="989" width="80" height="4" rx="2" fill="#0B0F33"/>`;
  c += `<rect x="${x - 60}" y="1018" width="120" height="3" fill="url(#gold)"/>`;
  return c;
}

export function back() {
  const r = rng(2718);
  let b = `<rect width="${W}" height="${H}" fill="url(#velvetBg)"/>`;

  // Tufted velvet on the back wall: a diamond quilt with buttons.
  let tuft = '';
  const S = 110;
  for (let k = -16; k <= 26; k++) {
    tuft += `M${k * S} 0 L${k * S + 1140} 1140 M${k * S} 0 L${k * S - 1140} 1140 `;
  }
  b += `<path d="${tuft}" stroke="#2A0619" stroke-width="2.2" opacity="0.32" fill="none"/>`;
  b += `<path d="${tuft}" stroke="#F08AB3" stroke-width="1.2" opacity="0.1" fill="none" transform="translate(2 0)"/>`;
  let buttons = '';
  for (let y = 0; y <= 1140; y += S / 2) {
    for (let x = (y / (S / 2)) % 2 ? S / 2 : 0; x <= W; x += S) {
      buttons += `<circle cx="${f(x)}" cy="${f(y)}" r="6" fill="#2A0619" opacity="0.7"/><circle cx="${f(x - 1.5)}" cy="${f(y - 1.5)}" r="2.4" fill="#F08AB3" opacity="0.45"/>`;
    }
  }
  b += buttons;

  // The mirror set in the lid, framed in gold and ringed with seed pearls.
  let mir = `<ellipse cx="450" cy="250" rx="250" ry="176" fill="url(#gold)"/>`;
  mir += `<ellipse cx="450" cy="250" rx="240" ry="166" fill="#7A4E12" opacity="0.5"/>`;
  mir += `<ellipse cx="450" cy="250" rx="232" ry="158" fill="url(#mirror)"/>`;
  mir += `<g clip-path="url(#mirrorClip)" opacity="0.5"><path d="M250 420 L420 80 L480 80 L310 420 Z" fill="#fff"/><path d="M340 420 L510 80 L530 80 L360 420 Z" fill="#fff"/></g>`;
  mir += `<ellipse cx="450" cy="300" rx="140" ry="60" fill="url(#warm)" clip-path="url(#mirrorClip)"/>`;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    mir += pearl(450 + Math.cos(a) * 262, 250 + Math.sin(a) * 188, 6);
  }
  mir += rosette(450, 62, 26, RUBY) + scroll(420, 62, 0.8, -100, -1) + scroll(480, 62, 0.8, 100, 1);
  b += layer(2, mir);

  // The warm glow where the card's title sits.
  b += `<ellipse cx="450" cy="570" rx="420" ry="170" fill="url(#warm)" opacity="0.7"/>`;

  // Box walls: lacquer to either side, matching the doors.
  const wall = (x) =>
    `<rect x="${x}" y="0" width="44" height="${H}" fill="url(#lacquerV)"/><rect x="${x === 0 ? 38 : x}" y="0" width="6" height="${H}" fill="url(#gold)"/>`;
  b += layer(3, wall(0) + wall(W - 44));

  // The glow behind the crown and the main pearl swag.
  b += `<ellipse cx="450" cy="940" rx="260" ry="210" fill="url(#warm)"/>`;
  let swags = pearlStrand(44, 690, 856, 690, 105, 9);
  swags += pearlStrand(44, 770, 318, 826, 62, 7) + pearlStrand(856, 770, 582, 826, 62, 7);
  swags += rosette(44, 690, 20, EMERALD) + rosette(856, 690, 20, EMERALD);
  b += layer(2, swags);

  // The ledge, with the crown on its cushion, a ring box and loose stones.
  b += layer(2, `<rect x="44" y="1040" width="812" height="26" fill="#8E2A5C"/><rect x="44" y="1062" width="812" height="7" fill="url(#gold)"/><rect x="44" y="1069" width="812" height="86" fill="url(#ledge)"/>`);
  b += layer(2, cushion());
  b += layer(3, crown());
  b += layer(2, ringBox(180));
  let loose = emeraldCut(690, 1012, 58, 42, EMERALD) + roundGem(752, 1020, 22, RUBY) + roundGem(642, 1028, 14, SAPPHIRE) + roundGem(796, 1030, 11, AMETHYST);
  loose += pearl(722, 1034, 7) + pearl(668, 1036, 6);
  b += layer(1, loose);

  // The tray: velvet compartments behind gold dividers.
  let tray = `<rect x="44" y="1155" width="812" height="345" fill="#3E0B29"/>`;
  const cells = [
    [56, 1167, 238, 148], [56, 1329, 238, 159],
    [310, 1167, 280, 321],
    [606, 1167, 238, 148], [606, 1329, 238, 159],
  ];
  for (const [x, y, w, h] of cells) {
    tray += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="url(#pad)"/>`;
    tray += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="#24051A" stroke-width="4" opacity="0.5"/>`;
  }
  b += layer(1, tray);
  b += layer(2, `<rect x="296" y="1155" width="10" height="345" fill="url(#goldH)"/><rect x="594" y="1155" width="10" height="345" fill="url(#goldH)"/>
    <rect x="44" y="1318" width="252" height="8" fill="url(#gold)"/><rect x="604" y="1318" width="252" height="8" fill="url(#gold)"/>
    <rect x="44" y="1150" width="812" height="8" fill="url(#gold)"/>`);
  // Compartment contents.
  let gems = roundGem(110, 1244, 24, SAPPHIRE) + roundGem(176, 1236, 30, AMETHYST) + roundGem(244, 1248, 22, CITRINE);
  gems += emeraldCut(175, 1410, 118, 82, EMERALD);
  // Right top: a ring roll with three rings.
  gems += `<rect x="622" y="1238" width="206" height="40" rx="20" fill="#5A1239"/><rect x="622" y="1238" width="206" height="10" rx="5" fill="#8E2A5C"/>`;
  for (const [x, p] of [[668, RUBY], [726, DIAMOND], [784, SAPPHIRE]]) {
    gems += `<ellipse cx="${x}" cy="1238" rx="18" ry="26" fill="none" stroke="url(#gold)" stroke-width="6"/>`;
    gems += p === DIAMOND ? diamondSide(x, 1206, 26) : roundGem(x, 1206, 12, p);
    gems += `<rect x="${x - 22}" y="1244" width="44" height="6" fill="#3E0B29" opacity="0.8"/>`;
  }
  // Right bottom: ruby drop earrings either side of a round ruby.
  gems += `<path d="M676 1360 L676 1390 M780 1360 L780 1390" stroke="#E4B451" stroke-width="2.4"/>`;
  gems += `<circle cx="676" cy="1356" r="7" fill="url(#gold)"/><circle cx="780" cy="1356" r="7" fill="url(#gold)"/>`;
  gems += pearGem(676, 1424, 17, RUBY) + pearGem(780, 1424, 17, RUBY) + roundGem(728, 1404, 20, RUBY);
  b += layer(1, gems);
  // The big diamond, lit, in the centre compartment.
  b += `<circle cx="450" cy="1310" r="160" fill="url(#white)" opacity="0.8"/>`;
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const L = i % 2 ? 90 : 150;
    rays += `<path d="M450 1300 L${f(450 + Math.cos(a) * L)} ${f(1300 + Math.sin(a) * L)}" stroke="#FFFFFF" stroke-width="${i % 2 ? 1.2 : 2}" opacity="0.35"/>`;
  }
  b += rays;
  b += layer(2, diamondSide(450, 1280, 190));
  b += sparkle(392, 1240, 26) + sparkle(520, 1262, 18) + sparkle(450, 1218, 14);
  b += layer(1, pearl(372, 1462, 8) + pearl(392, 1468, 8) + pearl(412, 1471, 8) + pearl(488, 1471, 8) + pearl(508, 1468, 8) + pearl(528, 1462, 8));

  // The front lip of the box: lacquer, gold rims, studs and filigree.
  let lip = `<rect x="0" y="1500" width="${W}" height="100" fill="url(#lacquerV)"/>`;
  lip += `<rect x="0" y="1500" width="${W}" height="9" fill="url(#gold)"/><rect x="0" y="1588" width="${W}" height="6" fill="url(#gold)"/>`;
  for (let i = 0; i < 8; i++) {
    const x = 56 + i * 112;
    lip += roundGem(x, 1548, 10, [RUBY, EMERALD, SAPPHIRE, EMERALD][i % 4]);
    lip += scroll(x + 16, 1550, 0.5, 70, 1, 2.2) + scroll(x + 96, 1550, 0.5, -70, -1, 2.2);
  }
  lip += `<rect x="410" y="1522" width="80" height="54" rx="10" fill="url(#gold)"/>` + roundGem(450, 1549, 18, DIAMOND);
  b += layer(3, lip);

  // Sparkles and drifting motes of light.
  for (let i = 0; i < 46; i++) {
    const x = 60 + r() * 780;
    const y = 440 + r() * 1040;
    b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + r() * 1.8)}" fill="#FFE9C0" opacity="${f(0.25 + r() * 0.5)}"/>`;
  }
  for (const [x, y, s] of [[330, 860, 16], [578, 880, 12], [452, 826, 20], [214, 946, 12], [772, 1000, 14], [120, 1236, 12], [180, 1384, 14], [740, 1196, 10], [680, 140, 18], [250, 330, 12], [118, 560, 10], [790, 600, 12]]) {
    b += sparkle(x, y, s);
  }
  b += grain(0.12);
  return svg(b, extra);
}

/* ------------------------------------------------------------------- mid */

/** Pearl strands and gold chains with pendants into a top corner (mirrored in the app). */
export function mid() {
  let back = goldChain(340, -4, 334, 216, 6);
  back += `<circle cx="334" cy="226" r="7" fill="url(#gold)"/>`;
  back += `<path d="M334 230 C350 244 354 270 334 292 C314 270 318 244 334 230 Z" fill="url(#gold)"/>` + pearGem(334, 276, 10, EMERALD);
  back += pearlStrand(250, -6, 520, -6, 92, 7);

  let front = goldChain(150, -4, 152, 382, 8);
  front += `<circle cx="152" cy="420" r="38" fill="url(#gold)"/><circle cx="152" cy="420" r="31" fill="#7A4E12" opacity="0.5"/>`;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    front += `<circle cx="${f(152 + Math.cos(a) * 34)}" cy="${f(420 + Math.sin(a) * 34)}" r="2.6" fill="#FFF1C4"/>`;
  }
  front += roundGem(152, 420, 25, RUBY);
  front += `<circle cx="152" cy="386" r="9" fill="url(#gold)"/>`;
  front += `<path d="M152 458 L152 486" stroke="#E4B451" stroke-width="2.4"/><circle cx="152" cy="460" r="4" fill="url(#gold)"/><path d="M146 484 L158 484 L156 490 L148 490 Z" fill="#E4B451"/>`;
  front += `<path d="M152 484 C164 494 168 512 152 528 C136 512 140 494 152 484 Z" fill="url(#pearl)"/><circle cx="147" cy="502" r="3" fill="#fff" opacity="0.9"/>`;

  let pearls = pearlStrand(-24, 34, 430, -8, 222, 11);
  pearls += pearlStrand(-24, 140, 262, -8, 150, 9);
  pearls += rosette(26, 22, 22, SAPPHIRE);

  let body = layer(1, back) + layer(2, front) + layer(3, pearls);
  body += sparkle(110, 400, 12) + sparkle(190, 252, 9) + sparkle(352, 262, 8);
  return svg(body, extra, { width: 600, height: 900 });
}
