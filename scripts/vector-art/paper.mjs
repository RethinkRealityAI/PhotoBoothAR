/**
 * paper.mjs — shared drawing kit for hand-built (vector) card design scenes.
 *
 * Every scene is layered paper: flat-colour shapes, each layer lifted off the
 * one behind it by a soft drop shadow, with a fine paper grain over the lot.
 * Stage space is 900x1600 (the same space the scene art, lib/sceneLife.ts and
 * the opening use). All randomness is seeded, so a scene renders identically
 * every time it is rebuilt.
 */

export const W = 900;
export const H = 1600;

export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => Math.round(n * 10) / 10;

/** The filters every scene uses. `lift` is the shadow strength per depth. */
export function defs(extra = '') {
  return `<defs>
  <filter id="lift1" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.28"/></filter>
  <filter id="lift2" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000" flood-opacity="0.32"/></filter>
  <filter id="lift3" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity="0.38"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.55 0"/>
  </filter>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
  ${extra}
</defs>`;
}

/** Paper grain over the whole stage (keep last). */
export function grain(opacity = 0.16) {
  return `<rect width="${W}" height="${H}" filter="url(#grain)" opacity="${opacity}"/>`;
}

/** A lifted paper layer. */
export function layer(depth, body) {
  return `<g filter="url(#lift${depth})">${body}</g>`;
}

/** A pointed leaf from its base (x,y), length L, half-width w, angle deg (0 = up). */
export function leaf(x, y, L, w, deg, fill, rib = 'rgba(255,255,255,0.28)') {
  const d = `M0 0 C${f(w * 1.1)} ${f(-L * 0.22)} ${f(w * 0.9)} ${f(-L * 0.78)} 0 ${f(-L)} C${f(-w * 0.9)} ${f(-L * 0.78)} ${f(-w * 1.1)} ${f(-L * 0.22)} 0 0Z`;
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})"><path d="${d}" fill="${fill}"/><path d="M0 0 Q${f(w * 0.08)} ${f(-L * 0.5)} 0 ${f(-L * 0.93)}" stroke="${rib}" stroke-width="${f(Math.max(1.2, w * 0.06))}" fill="none"/></g>`;
}

/** A palm frond: a curved stem with leaflets both sides. */
export function frond(x, y, L, deg, fill, rand, leaflets = 14) {
  let out = `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})">`;
  out += `<path d="M0 0 Q${f(L * 0.18)} ${f(-L * 0.5)} ${f(L * 0.1)} ${f(-L)}" stroke="${fill}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  for (let i = 1; i <= leaflets; i++) {
    const t = i / (leaflets + 1);
    const px = L * 0.18 * 2 * t * (1 - t) + L * 0.1 * t * t;
    const py = -L * t;
    const len = L * (0.42 - 0.3 * t) * (0.85 + rand() * 0.3);
    for (const side of [-1, 1]) {
      out += leaf(px, py, len, len * 0.13, side * (62 - t * 25) + 8, fill, 'rgba(255,255,255,0.18)');
    }
  }
  return out + '</g>';
}

/** A hibiscus-like five-petal flower. */
export function flower(x, y, r, fill, center = '#FFE08A') {
  let out = `<g transform="translate(${f(x)} ${f(y)})">`;
  for (let i = 0; i < 5; i++) {
    out += `<ellipse cx="0" cy="${f(-r * 0.55)}" rx="${f(r * 0.42)}" ry="${f(r * 0.6)}" fill="${fill}" transform="rotate(${i * 72})"/>`;
  }
  out += `<circle r="${f(r * 0.22)}" fill="${center}"/></g>`;
  return out;
}

/** A wavy band (hills, waves, ground) from y, filling to the bottom. */
export function band(y, amp, waves, fill, rand, phase = 0) {
  const steps = 24;
  let d = `M0 ${H} L0 ${f(y)}`;
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * W;
    const yy = y + Math.sin((i / steps) * Math.PI * 2 * waves + phase) * amp + (rand() - 0.5) * amp * 0.3;
    d += ` L${f(x)} ${f(yy)}`;
  }
  return `<path d="${d} L${W} ${H} Z" fill="${fill}"/>`;
}

/** Bunting: a sagging string with triangle flags. */
export function bunting(x1, y1, x2, y2, sag, colors, n = 9) {
  const pt = (t) => {
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * sag;
    return [x, y];
  };
  let out = `<path d="M${f(x1)} ${f(y1)} Q${f((x1 + x2) / 2)} ${f((y1 + y2) / 2 + sag * 2)} ${f(x2)} ${f(y2)}" stroke="#6B4A2E" stroke-width="2.5" fill="none"/>`;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pt((i + 0.15) / n);
    const [bx, by] = pt((i + 0.85) / n);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2 + 52;
    out += `<path d="M${f(ax)} ${f(ay)} L${f(bx)} ${f(by)} L${f(mx)} ${f(my)} Z" fill="${colors[i % colors.length]}"/>`;
  }
  return out;
}

export function svg(body, extraDefs = '', { width = W, height = H } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${defs(extraDefs)}${body}</svg>`;
}
