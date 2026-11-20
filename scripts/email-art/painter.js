/**
 * Browser half of scripts/render-email-art.mjs — runs inside headless
 * Chromium, paints every keepsake-email asset procedurally on <canvas>, and
 * hands raw RGBA back to Node (base64) for encoding. No images in, no network,
 * no Math.random: every random choice comes from a seeded PRNG, so a re-run
 * paints the same pixels.
 *
 * The envelope and the wax seals are LIT HEIGHT MAPS: each surface is built as
 * a height field (paper fibre, flap steps, embossed filigree, the wax dome and
 * its debossed letter), normals come from its gradient, and a top-left light
 * gives diffuse + specular (+ a pearlescent tint on the paper). That is what
 * makes them read as material rather than flat shapes.
 *
 * Exposes window.EmailArt.<asset>(args) → { width, height, frames: [b64 RGBA] }.
 */
(() => {
  const PANEL = [0x23, 0x21, 0x67];
  const CORE = [255, 197, 107];

  /* ---------------- utilities ---------------- */

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cnv(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  const ctx = (c) => c.getContext('2d', { willReadFrequently: true });
  /** Canvas alpha (or red) channel → Float32 0..1. */
  function chan(c, k = 3) {
    const d = ctx(c).getImageData(0, 0, c.width, c.height).data;
    const f = new Float32Array(c.width * c.height);
    for (let i = 0; i < f.length; i++) f[i] = d[i * 4 + k] / 255;
    return f;
  }
  function blurred(src, px, dx = 0, dy = 0) {
    const c = cnv(src.width, src.height);
    const x = ctx(c);
    x.filter = `blur(${px}px)`;
    x.drawImage(src, dx, dy);
    return c;
  }
  function toB64(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function out(c) {
    return toB64(new Uint8Array(ctx(c).getImageData(0, 0, c.width, c.height).data.buffer));
  }
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, v) => {
    const t = clamp((v - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  };

  /** Tileable value noise + fbm. */
  function noise2(seed) {
    const r = rng(seed);
    const N = 256;
    const P = new Float32Array(N * N);
    for (let i = 0; i < P.length; i++) P[i] = r();
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const g = (a, b) => P[((b & 255) * N) + (a & 255)];
      const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  function fbm(n, x, y, oct) {
    let s = 0, a = 0.5, f = 1, t = 0;
    for (let o = 0; o < oct; o++) {
      s += a * n(x * f, y * f);
      t += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / t;
  }

  /** Normal of a height field at i (central differences), scaled by k. */
  function normalAt(H, w, h, x, y, k) {
    const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
    const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
    const dx = (H[y * w + xr] - H[y * w + xl]) * k;
    const dy = (H[yd * w + x] - H[yu * w + x]) * k;
    const l = Math.hypot(dx, dy, 1);
    return [-dx / l, -dy / l, 1 / l];
  }
  const LIGHT = (() => {
    const v = [-0.52, -0.66, 0.54];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  })();
  const HALF = (() => {
    const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  })();

  /* ---------------- ornament drawing (strokes = raised letterpress) ---------------- */

  function leaf(x, px, py, ang, len, wid) {
    x.save();
    x.translate(px, py);
    x.rotate(ang);
    x.beginPath();
    x.moveTo(0, 0);
    x.quadraticCurveTo(len * 0.5, -wid, len, 0);
    x.quadraticCurveTo(len * 0.5, wid, 0, 0);
    x.stroke();
    x.beginPath();
    x.moveTo(len * 0.12, 0);
    x.lineTo(len * 0.8, 0);
    x.globalAlpha *= 0.6;
    x.stroke();
    x.restore();
  }
  function curl(x, px, py, ang, size, dir) {
    x.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const r = size * (1 - t * 0.85);
      const a = ang + dir * t * Math.PI * 2.2;
      const X = px + Math.cos(a) * r - Math.cos(ang) * size;
      const Y = py + Math.sin(a) * r - Math.sin(ang) * size;
      if (i === 0) x.moveTo(X, Y);
      else x.lineTo(X, Y);
    }
    x.stroke();
  }
  function rosette(x, px, py, r, petals) {
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      x.save();
      x.translate(px, py);
      x.rotate(a);
      x.beginPath();
      x.ellipse(r * 0.62, 0, r * 0.45, r * 0.22, 0, 0, Math.PI * 2);
      x.stroke();
      x.restore();
    }
    x.beginPath();
    x.arc(px, py, r * 0.18, 0, Math.PI * 2);
    x.fill();
  }
  /** A vine along a cubic bezier, leaves alternating, curls at the end. */
  function vine(x, r, p0, p1, p2, p3, opts) {
    const pt = (t) => {
      const u = 1 - t;
      return [
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ];
    };
    x.beginPath();
    x.moveTo(...p0);
    x.bezierCurveTo(...p1, ...p2, ...p3);
    x.stroke();
    const n = opts.leaves;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const [a, b] = pt(t);
      const [c, d] = pt(Math.min(1, t + 0.01));
      const tan = Math.atan2(d - b, c - a);
      const side = i % 2 === 0 ? 1 : -1;
      const len = opts.leafLen * (0.75 + 0.5 * r());
      leaf(x, a, b, tan + side * (0.75 + 0.25 * r()), len, len * 0.32);
      if (opts.curls && i % 3 === 0) curl(x, a, b, tan - side * 1.2, opts.leafLen * 0.38, side);
    }
    const [ex, ey] = pt(1);
    const [fx, fy] = pt(0.97);
    curl(x, ex, ey, Math.atan2(ey - fy, ex - fx) + Math.PI / 2, opts.leafLen * 0.5, opts.endDir ?? 1);
  }

  function scallopRect(x, x0, y0, w, h, r) {
    // semicircle bumps along a rectangle, facing inward
    const step = r * 2;
    x.beginPath();
    for (let X = x0 + r; X <= x0 + w - r + 0.1; X += step) {
      x.moveTo(X + r, y0);
      x.arc(X, y0, r, 0, Math.PI, false);
    }
    for (let X = x0 + r; X <= x0 + w - r + 0.1; X += step) {
      x.moveTo(X - r, y0 + h);
      x.arc(X, y0 + h, r, Math.PI, 0, false);
    }
    for (let Y = y0 + r + step; Y <= y0 + h - r - step + 0.1; Y += step) {
      x.moveTo(x0, Y - r);
      x.arc(x0, Y, r, -Math.PI / 2, Math.PI / 2, false);
      x.moveTo(x0 + w, Y + r);
      x.arc(x0 + w, Y, r, Math.PI / 2, -Math.PI / 2, false);
    }
    x.stroke();
  }

  /* ---------------- the envelope ---------------- */

  const ENV = { W: 1040, H: 1352, ex: 58, ey: 54, ew: 924, eh: 1244 };
  ENV.cx = ENV.W / 2;
  ENV.cy = 676;

  function polyMask(pts, round) {
    const c = cnv(ENV.W, ENV.H);
    const x = ctx(c);
    x.fillStyle = '#fff';
    x.strokeStyle = '#fff';
    x.lineJoin = 'round';
    x.lineWidth = round;
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
    x.closePath();
    x.fill();
    if (round) x.stroke();
    return c;
  }

  let ENVELOPE_CACHE = null;

  function paintEnvelope() {
    if (ENVELOPE_CACHE) return ENVELOPE_CACHE;
    const { W, H, ex, ey, ew, eh, cx, cy } = ENV;
    const r = rng(7);
    const ER = ex + ew, EB = ey + eh;

    // ---- masks
    const body = cnv(W, H);
    {
      const x = ctx(body);
      x.fillStyle = '#fff';
      x.beginPath();
      x.roundRect(ex, ey, ew, eh, 16);
      x.fill();
    }
    const sideL = polyMask([[ex + 2, ey + 2], [ex + 2, EB - 2], [cx - 26, cy + 18]], 26);
    const sideR = polyMask([[ER - 2, ey + 2], [ER - 2, EB - 2], [cx + 26, cy + 18]], 26);
    const bottom = polyMask([[ex + 2, EB - 2], [ER - 2, EB - 2], [cx, cy + 40]], 34);
    const top = polyMask([[ex + 2, ey + 2], [ER - 2, ey + 2], [cx, cy]], 40);
    const fBody = chan(blurred(body, 1.3));
    const fSide = (() => {
      const a = chan(blurred(sideL, 1.4)), b = chan(blurred(sideR, 1.4));
      return a.map((v, i) => Math.max(v, b[i]));
    })();
    const fBottom = chan(blurred(bottom, 1.4));
    const fTop = chan(blurred(top, 1.5));
    // cast shadows: the layer shifted away from the light, minus itself
    const shadowOf = (m, px, dx, dy) => chan(blurred(m, px, dx, dy));
    const sTop = shadowOf(top, 12, 8, 16);
    const sBottom = shadowOf(bottom, 8, 6, 10);
    const sSide = (() => {
      const a = shadowOf(sideL, 5, 5, 6), b = shadowOf(sideR, 5, 5, 6);
      return a.map((v, i) => Math.max(v, b[i]));
    })();

    // ---- letterpress ornaments (raised)
    const orn = cnv(W, H);
    {
      const x = ctx(orn);
      x.strokeStyle = '#fff';
      x.fillStyle = '#fff';
      x.lineCap = 'round';
      x.lineJoin = 'round';
      x.lineWidth = 3.2;
      scallopRect(x, ex + 24, ey + 24, ew - 48, eh - 48, 9);
      x.lineWidth = 2;
      x.beginPath();
      x.roundRect(ex + 44, ey + 44, ew - 88, eh - 88, 8);
      x.stroke();
      x.beginPath();
      x.roundRect(ex + 52, ey + 52, ew - 104, eh - 104, 6);
      x.globalAlpha = 0.7;
      x.stroke();
      x.globalAlpha = 1;
      // top flap: a double V echoing its edges, ending in curls at the tip
      x.lineWidth = 2.6;
      for (const inset of [46, 58]) {
        const k = inset / Math.hypot(ew / 2, cy - ey);
        x.beginPath();
        x.moveTo(ex + 90, ey + inset * 0.9);
        x.lineTo(cx, cy - inset * 1.9 - k * 10);
        x.lineTo(ER - 90, ey + inset * 0.9);
        x.stroke();
      }
      curl(x, cx - 18, cy - 128, Math.PI * 0.85, 16, -1);
      curl(x, cx + 18, cy - 128, Math.PI * 0.15, 16, 1);
      // top flap: vines spreading from the centre under the scallops
      x.lineWidth = 2.6;
      for (const s of [-1, 1]) {
        vine(x, r, [cx, ey + 150], [cx + s * 90, ey + 110], [cx + s * 210, ey + 170], [cx + s * 330, ey + 120],
          { leaves: 9, leafLen: 22, curls: true, endDir: s });
        vine(x, r, [cx, ey + 150], [cx + s * 60, ey + 200], [cx + s * 140, ey + 230], [cx + s * 210, ey + 210],
          { leaves: 5, leafLen: 18, curls: false, endDir: -s });
      }
      rosette(x, cx, ey + 150, 26, 8);
      rosette(x, cx, ey + 150, 12, 6);
      // side flaps: a vine climbing each, mirrored
      for (const s of [-1, 1]) {
        const X = s < 0 ? ex + 120 : ER - 120;
        vine(x, r, [X, EB - 170], [X + s * 30, cy + 260], [X - s * 40, cy - 60], [X + s * 10, ey + 290],
          { leaves: 13, leafLen: 22, curls: true, endDir: s });
        rosette(x, X - s * 6, cy + 120, 18, 7);
        rosette(x, X + s * 4, cy - 150, 14, 6);
      }
      // bottom flap: a floral spray rising from the bottom centre
      x.lineWidth = 2.8;
      x.beginPath();
      x.moveTo(cx, EB - 80);
      x.lineTo(cx, cy + 150);
      x.stroke();
      for (const s of [-1, 1]) {
        vine(x, r, [cx, EB - 110], [cx + s * 120, EB - 160], [cx + s * 230, EB - 120], [cx + s * 340, EB - 190],
          { leaves: 10, leafLen: 24, curls: true, endDir: s });
        vine(x, r, [cx, EB - 230], [cx + s * 70, EB - 300], [cx + s * 150, EB - 300], [cx + s * 200, EB - 360],
          { leaves: 6, leafLen: 20, curls: true, endDir: -s });
        rosette(x, cx + s * 180, EB - 170, 22, 8);
        leaf(x, cx, cy + 210, -Math.PI / 2 + s * 0.6, 46, 15);
      }
      rosette(x, cx, EB - 250, 30, 10);
      rosette(x, cx, EB - 250, 14, 6);
      // dot rows along the bottom flap edges
      for (const s of [-1, 1]) {
        for (let i = 1; i < 16; i++) {
          const t = i / 16;
          const X = cx + s * (ew / 2 - 70) * t;
          const Y = cy + 104 + (EB - 96 - (cy + 104)) * t;
          x.beginPath();
          x.arc(X, Y, 3, 0, Math.PI * 2);
          x.fill();
        }
      }
    }
    // ornaments belong to the paper they are printed on: keep them off the
    // flap seams so an edge never runs through a flourish
    const fOrnSharp = chan(blurred(orn, 1.1));
    const fOrnSoft = chan(blurred(orn, 3.5));

    // ---- fibres
    const fib = cnv(W, H);
    {
      const x = ctx(fib);
      x.strokeStyle = '#fff';
      x.lineCap = 'round';
      for (let i = 0; i < 9000; i++) {
        const px = r() * W, py = r() * H;
        const a = r() * Math.PI * 2;
        const L = 6 + r() * 26;
        x.globalAlpha = 0.05 + r() * 0.16;
        x.lineWidth = 0.5 + r() * 0.9;
        x.beginPath();
        x.moveTo(px, py);
        x.quadraticCurveTo(px + Math.cos(a + 0.6) * L * 0.5, py + Math.sin(a + 0.6) * L * 0.5, px + Math.cos(a) * L, py + Math.sin(a) * L);
        x.stroke();
      }
    }
    const fFib = chan(blurred(fib, 0.6));
    const n1 = noise2(11), n2 = noise2(23);

    // ---- height field
    const N = W * H;
    const Hf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const X = i % W, Y = (i / W) | 0;
      const grain = fbm(n1, X / 2.2, Y / 2.2, 3) - 0.5;
      const cockle = fbm(n2, X / 140, Y / 140, 3) - 0.5;
      Hf[i] =
        fBody[i] * 2.0 + fSide[i] * 1.0 + fBottom[i] * 1.0 + fTop[i] * 1.2 +
        (fOrnSharp[i] * 0.55 + fOrnSoft[i] * 0.45) * fBody[i] +
        (grain * 0.10 + fFib[i] * 0.12 + cockle * 0.9) * fBody[i];
    }

    // ---- warm light leaking from the seams
    const glow = cnv(W, H);
    {
      const x = ctx(glow);
      x.strokeStyle = '#fff';
      x.lineCap = 'round';
      const seams = [
        [[ex + 30, ey + 28], [cx, cy]], [[ER - 30, ey + 28], [cx, cy]],
        [[ex + 40, EB - 30], [cx, cy + 40]], [[ER - 40, EB - 30], [cx, cy + 40]],
      ];
      x.lineWidth = 3;
      for (const [a, b] of seams) {
        x.beginPath();
        x.moveTo(...a);
        x.lineTo(...b);
        x.stroke();
      }
    }
    const gCore = chan(blurred(glow, 2.2));
    const gHalo = chan(blurred(glow, 16));
    const gWide = chan(blurred(glow, 46));

    // ---- shade
    const env = cnv(W, H);
    const ed = ctx(env).createImageData(W, H);
    // Each flap is its own sheet at its own angle to the light, so each gets
    // its own albedo AND a "pillow" falloff toward the crease it folds over:
    // that tonal step between planes is what makes the four flaps read as
    // paper layered in depth instead of lines drawn on one flat card.
    const albTop = [0.985, 0.968, 0.99], albSide = [0.905, 0.89, 0.95], albBot = [0.945, 0.925, 0.972];
    const warm = [1.0, 0.975, 0.94], cool = [0.90, 0.90, 1.0];
    const peach = [1.0, 0.86, 0.74], peri = [0.80, 0.83, 1.0], mint = [0.82, 1.0, 0.93];
    for (let Y = 0; Y < H; Y++) {
      for (let X = 0; X < W; X++) {
        const i = Y * W + X;
        const a = fBody[i];
        if (a <= 0.001) continue;
        const nrm = normalAt(Hf, W, H, X, Y, 1.6);
        const diff = Math.max(0, nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]);
        const nh = Math.max(0, nrm[0] * HALF[0] + nrm[1] * HALF[1] + nrm[2] * HALF[2]);
        const spec = Math.pow(nh, 46);
        const sheen = Math.pow(nh, 5);
        const onTop = fTop[i] > 0.5, onBot = !onTop && fBottom[i] > 0.5;
        const alb = onTop ? albTop : onBot ? albBot : albSide;
        // pillow: a flap is brightest where it lifts off its fold edge and
        // dips toward the point where it tucks under the seal
        const ty = (Y - ey) / (cy - ey), by = (EB - Y) / (EB - cy), sx = Math.abs(X - cx) / (ew / 2);
        const pillow = onTop ? 1.03 - 0.07 * ty * ty : onBot ? 1.0 - 0.06 * by * by : 0.99 - 0.06 * (1 - sx) * (1 - sx);
        // shadows cast onto everything beneath each raised layer
        const shT = clamp(sTop[i] - fTop[i]);
        const shB = clamp(sBottom[i] - fBottom[i] - fTop[i]);
        const shS = clamp(sSide[i] - fSide[i] - fBottom[i] - fTop[i]);
        const shade = 1 - 0.46 * shT - 0.32 * shB - 0.24 * shS;
        // light falls off from the top-left; lit paper warms, shade cools
        const lt = (X / W) * 0.45 + (Y / H) * 0.55;
        const fall = 1.05 - 0.17 * lt;
        const wk = clamp(1.15 - lt * 1.3);
        const s = 0.5 + 0.5 * Math.sin((nrm[0] * 1.4 + nrm[1]) * 3 + (X / W) * 2.2 + (Y / H) * 1.3);
        // pearlescent band sweeping corner to corner, hue drifting along it
        const bandT = (X / W) * 0.75 + (Y / H) * 0.62 - 0.62;
        const band = Math.exp(-(bandT * bandT) / 0.018) * 0.5 + Math.exp(-((bandT + 0.42) ** 2) / 0.006) * 0.25;
        const hue = 0.5 + 0.5 * Math.sin((X / W) * 5.0 - (Y / H) * 3.0 + nrm[0] * 4);
        const d = Math.hypot(X - cx, Y - (cy + 14));
        const near = Math.exp(-d / 210);
        const seam = gCore[i] * 3.0 * (0.25 + near) + gHalo[i] * 1.6 * near + gWide[i] * 0.9 * near;
        const out = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const tint = peach[c] * s + peri[c] * (1 - s);
          const pearl = mint[c] * hue + peach[c] * (1 - hue);
          const temp = warm[c] * wk + cool[c] * (1 - wk);
          let v = alb[c] * temp * (0.66 + 0.52 * diff) * shade * fall * pillow;
          v += spec * 0.22 * tint + sheen * 0.05 * tint;
          v += band * (0.05 + sheen * 0.1) * (pearl - 0.86);
          v = v * (1 - 0.15 * clamp(seam)) + (CORE[c] / 255) * seam * 0.9;
          out[c] = clamp(v);
        }
        const o = i * 4;
        ed.data[o] = out[0] * 255;
        ed.data[o + 1] = out[1] * 255;
        ed.data[o + 2] = out[2] * 255;
        ed.data[o + 3] = a * 255;
      }
    }
    ctx(env).putImageData(ed, 0, 0);

    // ---- stage: panel colour, drop shadow, the envelope on top
    const stage = cnv(W, H);
    {
      const x = ctx(stage);
      x.fillStyle = `rgb(${PANEL.join(',')})`;
      x.fillRect(0, 0, W, H);
      // a faint halo of light behind the envelope — it must reach zero before
      // the image edge, where the email butts it against the flat panel colour
      const g = x.createRadialGradient(cx, cy, 80, cx, cy, 500);
      g.addColorStop(0, 'rgba(160,150,255,0.20)');
      g.addColorStop(1, 'rgba(160,150,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
      x.save();
      x.filter = 'blur(20px)';
      x.globalAlpha = 0.75;
      x.fillStyle = 'rgb(8,6,30)';
      x.beginPath();
      x.roundRect(ex + 14, ey + 26, ew - 28, eh - 20, 18);
      x.fill();
      x.restore();
      x.drawImage(env, 0, 0);
    }
    ENVELOPE_CACHE = stage;
    return stage;
  }

  /* ---------------- wax seal ---------------- */

  // The seal ships as a FULL-WIDTH band of the envelope (one per letter):
  // the email stacks top / band / bottom as three full-width images, so there
  // is no side-by-side seam through the paper for a fluid table to open up.
  const SEAL = { x: 0, y: 526, w: 1040, h: 300 };

  function paintSeal({ letter, seed }) {
    const env = paintEnvelope();
    const { w, h } = SEAL;
    const c = cnv(w, h);
    const x = ctx(c);
    x.drawImage(env, SEAL.x, SEAL.y, w, h, 0, 0, w, h);
    const cx = ENV.cx - SEAL.x, cy = ENV.cy - SEAL.y + 6;
    const R = 96;
    const r = rng(seed);
    const n = noise2(seed + 3);

    // irregular blob radius: low-frequency wobble + a few drips. Capped so
    // the blob AND its contact shadow end inside the band's 300px height — a
    // drip clipped there would show as a seam against the slices above/below.
    const drips = Array.from({ length: 6 }, () => ({ a: r() * Math.PI * 2, amp: 0.04 + r() * 0.07, wid: 0.12 + r() * 0.16 }));
    const rad = (ang) => {
      let k = 1 + 0.03 * (n(Math.cos(ang) * 3 + 10, Math.sin(ang) * 3 + 10) - 0.5) * 2;
      for (const d of drips) {
        let da = Math.abs(ang - d.a);
        da = Math.min(da, Math.PI * 2 - da);
        k += d.amp * Math.exp(-(da * da) / (d.wid * d.wid));
      }
      return R * k;
    };

    // letter mask
    const lm = cnv(w, h);
    {
      const y = ctx(lm);
      y.fillStyle = '#fff';
      y.strokeStyle = '#fff';
      if (letter === '✦') {
        y.beginPath();
        const s = R * 0.5;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 === 0 ? s : s * 0.26;
          const X = cx + Math.cos(a) * rr, Y = cy + Math.sin(a) * rr;
          i ? y.lineTo(X, Y) : y.moveTo(X, Y);
        }
        y.closePath();
        y.fill();
      } else {
        y.font = `600 ${Math.round(R * 1.02)}px Bricolage`;
        y.textAlign = 'center';
        y.textBaseline = 'alphabetic';
        const m = y.measureText(letter);
        const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
        y.fillText(letter, cx, cy + (asc - desc) / 2);
      }
      // a fine debossed ring inside the stamped face
      y.lineWidth = 2;
      y.beginPath();
      y.arc(cx, cy, R * 0.66, 0, Math.PI * 2);
      y.stroke();
    }
    const fL = chan(blurred(lm, 1.2));
    const fLs = chan(blurred(lm, 3.5));

    const N = w * h;
    const Hs = new Float32Array(N);
    const A = new Float32Array(N);
    for (let Y = 0; Y < h; Y++) {
      for (let X = 0; X < w; X++) {
        const i = Y * w + X;
        const dx = X - cx, dy = Y - cy;
        const dist = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const rr = rad(ang);
        const d = dist / rr;
        A[i] = 1 - smooth(1 - 1.4 / rr, 1 + 0.6 / rr, d);
        if (d > 1.05) continue;
        // rolled wax edge rising to a slightly domed face
        let hv = Math.sin(clamp((1 - d) / 0.2) * Math.PI / 2) * 1.0 + (1 - d * d) * 0.25;
        // stamped face: a recess with a raised rim ring
        const f = dist / R;
        hv -= 0.22 * (1 - smooth(0.70, 0.74, f));
        hv += 0.14 * Math.exp(-((f - 0.76) ** 2) / 0.0012);
        hv -= 0.42 * fL[i] + 0.12 * fLs[i];
        hv += (fbm(n, X / 9, Y / 9, 3) - 0.5) * 0.05;
        Hs[i] = hv;
      }
    }

    // glow ring of warm light under the seal (fades to 0 inside the crop)
    {
      const g = x.createRadialGradient(cx, cy, R * 0.8, cx, cy, 126);
      g.addColorStop(0, 'rgba(255,197,107,0.75)');
      g.addColorStop(0.45, 'rgba(255,197,107,0.28)');
      g.addColorStop(1, 'rgba(255,197,107,0)');
      x.save();
      x.globalCompositeOperation = 'screen';
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.restore();
    }
    // contact shadow
    {
      const sm = cnv(w, h);
      const y = ctx(sm);
      y.fillStyle = 'rgba(40,18,40,0.55)';
      y.beginPath();
      for (let i = 0; i <= 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        const rr = rad(a);
        const X = cx + 6 + Math.cos(a) * rr, Y = cy + 10 + Math.sin(a) * rr;
        i ? y.lineTo(X, Y) : y.moveTo(X, Y);
      }
      y.fill();
      x.drawImage(blurred(sm, 7), 0, 0);
    }

    const img = x.getImageData(0, 0, w, h);
    // poured wax: deep amber in the folds, honey on the slopes, near-white
    // glints where the glossy skin catches the light
    const deep = [0.38, 0.15, 0.03], mid = [0.86, 0.50, 0.13], lite = [1.0, 0.80, 0.42];
    for (let Y = 0; Y < h; Y++) {
      for (let X = 0; X < w; X++) {
        const i = Y * w + X;
        if (A[i] <= 0) continue;
        const nrm = normalAt(Hs, w, h, X, Y, 9);
        const diff = Math.max(0, nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]);
        const nh = Math.max(0, nrm[0] * HALF[0] + nrm[1] * HALF[1] + nrm[2] * HALF[2]);
        const spec = Math.pow(nh, 140) * 1.4 + Math.pow(nh, 24) * 0.28 + Math.pow(nh, 6) * 0.05;
        const cav = 1 - 0.42 * fL[i];
        const t = clamp(0.04 + diff * 1.08);
        const o = i * 4;
        for (let k = 0; k < 3; k++) {
          const base = t < 0.5 ? deep[k] + (mid[k] - deep[k]) * (t / 0.5) : mid[k] + (lite[k] - mid[k]) * ((t - 0.5) / 0.5);
          const v = clamp(base * cav + spec * [1, 0.95, 0.86][k]);
          img.data[o + k] = img.data[o + k] * (1 - A[i]) + v * 255 * A[i];
        }
      }
    }
    x.putImageData(img, 0, 0);
    return { width: w, height: h, frames: [out(c)] };
  }

  function envelopeSlices() {
    const env = paintEnvelope();
    const { W, H } = ENV;
    const crop = (sx, sy, sw, sh) => {
      const c = cnv(sw, sh);
      ctx(c).drawImage(env, sx, sy, sw, sh, 0, 0, sw, sh);
      return { width: sw, height: sh, frames: [out(c)] };
    };
    return {
      top: crop(0, 0, W, SEAL.y),
      bottom: crop(0, SEAL.y + SEAL.h, W, H - SEAL.y - SEAL.h),
      full: crop(0, 0, W, H),
    };
  }

  /* ---------------- shimmering frame caps ---------------- */

  /*
   * The Beamwall shimmer border (src/styles/brand.css — `conic-gradient(from
   * 210deg, #FFFFFF, #A5ABFF, #FFFFFF, #FFC56B, #C9CCFF, #FFFFFF)` with a
   * white→gold comet orbiting it), rebuilt for email: the rim colour runs
   * through the same stops along the edge, and a comet travels it.
   *
   * The panel is three pieces in the email — this top cap, a middle cell whose
   * CSS borders draw the straight sides, and the bottom cap — so the caps END
   * in the colours those CSS borders use (RIM_SIDE outer 3px, then 7px of
   * panel, then a 1px RIM_INNER hairline, @1x) and the seam is invisible.
   */
  const RIM_SIDE = '#D2D4FD';
  const RIM_INNER = '#5E5A90';
  const SPECTRUM = [
    [0, RIM_SIDE], [0.1, '#FFFFFF'], [0.24, '#A5ABFF'], [0.38, '#FFFFFF'],
    [0.54, '#FFC56B'], [0.68, '#FFC56B'], [0.84, '#A5ABFF'], [0.93, '#FFFFFF'], [1, RIM_SIDE],
  ];
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  function spectrum(u, stops = SPECTRUM) {
    u = clamp(u);
    for (let k = 1; k < stops.length; k++) {
      if (u <= stops[k][0]) {
        const [u0, c0] = stops[k - 1], [u1, c1] = stops[k];
        const t = (u - u0) / (u1 - u0 || 1);
        const a = hex(c0), b = hex(c1);
        return a.map((v, i) => Math.round(v + (b[i] - v) * t));
      }
    }
    return hex(stops[stops.length - 1][1]);
  }

  /** A polyline with cumulative arc length, sampled at any distance. */
  function pathOf(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const at = (d) => {
      d = ((d % total) + total) % total;
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (cum[m] <= d) lo = m; else hi = m;
      }
      const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
      return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
    };
    return { pts, cum, total, at };
  }
  function arcPts(cx, cy, r, a0, a1, n) {
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
  }
  /** Open path up the left side, over the rounded top, down the right side. */
  function capPath(width, height, radius, inset) {
    const l = inset, r = width - inset, t = inset, R = radius - inset;
    return pathOf([
      [l, height], [l, t + R],
      ...arcPts(l + R, t + R, R, Math.PI, Math.PI * 1.5, 24),
      [r - R, t],
      ...arcPts(r - R, t + R, R, Math.PI * 1.5, Math.PI * 2, 24),
      [r, height],
    ]);
  }
  /** Closed stadium (pill) path, clockwise from the left end's top. */
  function stadiumPath(x0, y0, w, h) {
    const R = h / 2;
    return pathOf([
      ...arcPts(x0 + R, y0 + R, R, Math.PI, Math.PI * 1.5, 28),
      ...arcPts(x0 + w - R, y0 + R, R, -Math.PI / 2, Math.PI / 2, 56),
      ...arcPts(x0 + R, y0 + R, R, Math.PI / 2, Math.PI, 28),
    ]);
  }
  /** Stroke a path segment by segment, coloured by colourAt(fraction). */
  function strokeSpectrum(x, p, lineWidth, colourAt, alpha = 1) {
    x.save();
    x.lineWidth = lineWidth;
    x.lineCap = 'round';
    x.globalAlpha = alpha;
    for (let i = 1; i < p.pts.length; i++) {
      const u = (p.cum[i - 1] + p.cum[i]) / 2 / p.total;
      x.strokeStyle = `rgb(${colourAt(u).join(',')})`;
      x.beginPath();
      x.moveTo(...p.pts[i - 1]);
      x.lineTo(...p.pts[i]);
      x.stroke();
    }
    x.restore();
  }
  /** The comet: a white-hot head with a gold tail trailing behind it. */
  function comet(x, p, head, tail, lineWidth, strength, closed) {
    if (strength <= 0) return;
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.lineCap = 'butt';
    const steps = 48;
    // an OPEN path must not wrap: a tail running past its start would be
    // drawn as one straight segment from the far end back across the cap
    const lim = (d) => (closed ? d : clamp(d, 0, p.total));
    for (let s = 0; s < steps - 1; s++) {
      const k = s / (steps - 1); // 0 = tail end, 1 = head
      const da = lim(head - tail * (1 - k)), db = lim(head - tail * (1 - (s + 1) / (steps - 1)));
      if (!closed && db - da <= 0) continue;
      const a = p.at(da), b = p.at(db);
      const col = k > 0.82 ? [255, 255, 255] : [255, Math.round(197 + 58 * k), Math.round(107 + 148 * k * k)];
      x.strokeStyle = `rgba(${col.join(',')},${(k * k * strength).toFixed(3)})`;
      x.lineWidth = lineWidth * (0.6 + 0.9 * k);
      x.beginPath();
      x.moveTo(...a);
      x.lineTo(...b);
      x.stroke();
    }
    const [hx, hy] = p.at(head);
    const g = x.createRadialGradient(hx, hy, 0, hx, hy, lineWidth * 7);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * strength})`);
    g.addColorStop(0.35, `rgba(255,214,160,${0.5 * strength})`);
    g.addColorStop(1, 'rgba(255,197,107,0)');
    x.fillStyle = g;
    x.fillRect(hx - lineWidth * 7, hy - lineWidth * 7, lineWidth * 14, lineWidth * 14);
    x.restore();
  }
  /** A four-point star glint (crisp enough to survive 1-bit GIF alpha). */
  function glint(x, gx, gy, size, alpha = 1) {
    if (size <= 0.5) return;
    x.save();
    x.globalAlpha = alpha;
    const g = x.createRadialGradient(gx, gy, 0, gx, gy, size * 0.9);
    g.addColorStop(0, 'rgba(255,236,200,0.85)');
    g.addColorStop(1, 'rgba(255,197,107,0)');
    x.fillStyle = g;
    x.fillRect(gx - size, gy - size, size * 2, size * 2);
    x.fillStyle = '#FFFFFF';
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? size : size * 0.16;
      i ? x.lineTo(gx + Math.cos(a) * r, gy + Math.sin(a) * r) : x.moveTo(gx + Math.cos(a) * r, gy + Math.sin(a) * r);
    }
    x.closePath();
    x.fill();
    x.restore();
  }

  /**
   * Frame 0 is the still Outlook shows: the full spectrum rim, the inner
   * hairline and two resting glints — finished on its own. The comet orbits
   * clockwise: across the top cap in the first half of the loop, back along
   * the bottom cap (right→left) in the second. Outside the rim is fully
   * transparent so the page field shows through.
   */
  function paintCap({ which, frames, width = 1200, height = 72, radius = 56 }) {
    const out_ = [];
    const L = 6; // outer rim, 3px @1x
    const outer = capPath(width, height, radius, L / 2);
    const inner = capPath(width, height, radius, 21); // 1px hairline at 10px @1x
    const half = frames / 2;
    for (let f = 0; f < frames; f++) {
      const c = cnv(width, height);
      const x = ctx(c);
      x.beginPath();
      x.roundRect(L / 2, L / 2, width - L, height * 3, radius - L / 2);
      x.fillStyle = `rgb(${PANEL.join(',')})`;
      x.fill();
      // inner hairline (solid where it meets the middle cell's CSS border)
      x.save();
      x.strokeStyle = RIM_INNER;
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(...inner.pts[0]);
      for (const pt of inner.pts) x.lineTo(...pt);
      x.stroke();
      x.restore();
      // bloom of the rim, inside the panel only
      const bloom = cnv(width, height);
      strokeSpectrum(ctx(bloom), outer, 10, (u) => spectrum(u));
      const bl = blurred(bloom, 9);
      {
        // fade the bloom out before the cap's last rows: there the cap meets
        // the middle cell's flat CSS borders, which have no glow to match
        const y = ctx(bl);
        const fadeOut = y.createLinearGradient(0, height - 40, 0, height - 8);
        fadeOut.addColorStop(0, '#000');
        fadeOut.addColorStop(1, 'rgba(0,0,0,0)');
        y.globalCompositeOperation = 'destination-in';
        y.fillStyle = fadeOut;
        y.fillRect(0, 0, width, height);
      }
      x.save();
      x.beginPath();
      x.roundRect(L, L, width - 2 * L, height * 3, radius - L);
      x.clip();
      x.globalCompositeOperation = 'lighter';
      x.globalAlpha = 0.34;
      x.drawImage(bl, 0, 0);
      x.restore();
      // the spectrum rim (bottom cap runs it backwards so the colours orbit)
      const colourAt = (u) => spectrum(which === 'top' ? u : 1 - u);
      strokeSpectrum(x, outer, L, colourAt);
      // the comet
      const local = which === 'top' ? f : f - half;
      // local 0 is frame 0 for the top cap: no comet, so Outlook's still is clean
      if (local > 0 && local < half) {
        const t = local / half;
        const dist = which === 'top' ? t * outer.total : (1 - t) * outer.total;
        const fade = Math.min(1, Math.sin(t * Math.PI) * 1.6);
        const tail = 340;
        // a reversed path makes the tail trail correctly on the bottom cap
        const p = which === 'top' ? outer : pathOf([...outer.pts].reverse());
        comet(x, p, which === 'top' ? dist : outer.total - dist, tail, L, fade);
      }
      // resting glints on the shoulders (twinkle a little)
      const tw = 0.75 + 0.25 * Math.cos((f / frames) * Math.PI * 2 + (which === 'top' ? 0 : Math.PI));
      const s1 = outer.at(outer.total * (which === 'top' ? 0.2 : 0.8));
      glint(x, s1[0], s1[1], 15 * tw);
      const s2 = outer.at(outer.total * (which === 'top' ? 0.705 : 0.295));
      glint(x, s2[0], s2[1], 10 * (1.75 - tw));
      // binary alpha for GIF: inside the frame opaque, outside transparent
      const id = x.getImageData(0, 0, width, height);
      for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] >= 120 ? 255 : 0;
      x.putImageData(id, 0, 0);
      if (which === 'bottom') {
        const flip = cnv(width, height);
        const z = ctx(flip);
        z.translate(0, height);
        z.scale(1, -1);
        z.drawImage(c, 0, 0);
        out_.push(out(flip));
      } else {
        out_.push(out(c));
      }
    }
    return { width, height, frames: out_ };
  }

  /* ---------------- the button ---------------- */

  /**
   * A SOLID white pill (no gradient fill, per the brand) floating inside a
   * ring of the shimmer spectrum, with a warm bloom and a comet orbiting the
   * ring once per loop. The email lays live link text over it; its bgcolor
   * fallback is the same white, so blocked images still show the pill.
   */
  function paintButton({ frames, width = 600, height = 168 }) {
    const out_ = [];
    const px = 44, py = 30, pw = width - 2 * px, ph = height - 2 * py;
    const gap = 9;
    const ring = stadiumPath(px - gap, py - gap, pw + 2 * gap, ph + 2 * gap);
    // conic colour around the pill's centre, from 210deg like the CSS
    const cx = width / 2, cy = height / 2;
    const conic = (u) => {
      const [X, Y] = ring.at(u * ring.total);
      const ang = (Math.atan2(Y - cy, (X - cx) * (ph / pw) * 1.6) * 180) / Math.PI + 90; // 0 = up
      return spectrum(((((ang - 210) % 360) + 360) % 360) / 360, [
        [0, '#FFFFFF'], [0.25, '#A5ABFF'], [0.4, '#FFFFFF'], [0.55, '#FFC56B'], [0.75, '#C9CCFF'], [1, '#FFFFFF'],
      ]);
    };
    for (let f = 0; f < frames; f++) {
      const c = cnv(width, height);
      const x = ctx(c);
      x.fillStyle = `rgb(${PANEL.join(',')})`;
      x.fillRect(0, 0, width, height);
      // warm bloom behind the whole button, breathing gently
      const breath = 0.85 + 0.15 * Math.cos((f / frames) * Math.PI * 2);
      const halo = cnv(width, height);
      strokeSpectrum(ctx(halo), ring, 14, conic);
      x.save();
      x.globalCompositeOperation = 'lighter';
      x.globalAlpha = 0.45 * breath;
      x.drawImage(blurred(halo, 14), 0, 0);
      x.restore();
      // the ring
      strokeSpectrum(x, ring, 3.5, conic);
      // solid pill with a soft contact shadow under it
      x.save();
      x.shadowColor = 'rgba(8,6,30,0.55)';
      x.shadowBlur = 14;
      x.shadowOffsetY = 5;
      x.fillStyle = '#FFFFFF';
      x.beginPath();
      x.roundRect(px, py, pw, ph, ph / 2);
      x.fill();
      x.restore();
      // the comet: one orbit per loop, starting at the top-left shoulder
      comet(x, ring, ring.total * (0.08 + f / frames), 300, 4, 1, true);
      // a glint that twinkles on the far side
      const g = ring.at(ring.total * (0.62 + 0.0));
      glint(x, g[0], g[1], 12 * (0.6 + 0.4 * Math.sin((f / frames) * Math.PI * 2)));
      out_.push(out(c));
    }
    return { width, height, frames: out_ };
  }

  /* ---------------- divider ---------------- */

  function paintDivider({ width = 1040, height = 80 }) {
    const c = cnv(width, height);
    const x = ctx(c);
    x.fillStyle = `rgb(${PANEL.join(',')})`;
    x.fillRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;
    // glow
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, 70);
    g.addColorStop(0, 'rgba(255,197,107,0.55)');
    g.addColorStop(1, 'rgba(255,197,107,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, width, height);
    // hairlines fading to the ends
    for (const s of [-1, 1]) {
      const lg = x.createLinearGradient(cx, 0, cx + s * 300, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0.85)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      x.strokeStyle = lg;
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(cx + s * 34, cy);
      x.lineTo(cx + s * 300, cy);
      x.stroke();
      x.lineWidth = 1.4;
      x.beginPath();
      x.moveTo(cx + s * 46, cy - 7);
      x.lineTo(cx + s * 190, cy - 7);
      x.moveTo(cx + s * 46, cy + 7);
      x.lineTo(cx + s * 190, cy + 7);
      x.globalAlpha = 0.55;
      x.stroke();
      x.globalAlpha = 1;
      x.strokeStyle = 'rgba(255,255,255,0.8)';
      x.lineWidth = 1.8;
      curl(x, cx + s * 52, cy - 8, s > 0 ? Math.PI * 1.5 : Math.PI * 1.5, 7, s);
      curl(x, cx + s * 52, cy + 8, Math.PI * 0.5, 7, -s);
      for (const d of [210, 240, 268]) {
        x.fillStyle = `rgba(255,255,255,${0.75 - (d - 210) / 120})`;
        x.beginPath();
        x.arc(cx + s * d, cy, 2.4, 0, Math.PI * 2);
        x.fill();
      }
    }
    // four-point star
    x.fillStyle = '#FFE7BF';
    x.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? 20 : 5;
      i ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    x.closePath();
    x.fill();
    return { width, height, frames: [out(c)] };
  }

  /* ---------------- the field (page background) ---------------- */

  function paintField({ width = 1300, height = 2000 }) {
    const c = cnv(width, height);
    const x = ctx(c);
    const r = rng(41);
    const lg = x.createLinearGradient(0, 0, 0, height);
    lg.addColorStop(0, '#3A3A97');
    lg.addColorStop(0.45, '#33318A');
    lg.addColorStop(1, '#33318A');
    x.fillStyle = lg;
    x.fillRect(0, 0, width, height);
    const blob = (X, Y, R, col) => {
      const g = x.createRadialGradient(X, Y, 0, X, Y, R);
      g.addColorStop(0, col);
      g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      x.fillStyle = g;
      x.fillRect(0, 0, width, height);
    };
    blob(80, 260, 760, 'rgba(74,112,186,0.85)');
    blob(1250, 1050, 700, 'rgba(128,94,160,0.75)');
    blob(650, 0, 620, 'rgba(255,197,107,0.30)');
    blob(650, -30, 260, 'rgba(255,232,196,0.45)');
    blob(300, 1500, 600, 'rgba(84,120,196,0.35)');
    // light rays fanning down from the top centre
    x.save();
    x.globalCompositeOperation = 'screen';
    x.filter = 'blur(18px)';
    for (let i = 0; i < 14; i++) {
      const a = Math.PI / 2 + (r() - 0.5) * 1.5;
      const spread = 0.025 + r() * 0.05;
      const len = 900 + r() * 700;
      const g = x.createLinearGradient(650, -40, 650 + Math.cos(a) * len, -40 + Math.sin(a) * len);
      const al = 0.07 + r() * 0.11;
      g.addColorStop(0, `rgba(255,236,210,${al})`);
      g.addColorStop(1, 'rgba(255,236,210,0)');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(650, -40);
      x.lineTo(650 + Math.cos(a - spread) * len, -40 + Math.sin(a - spread) * len);
      x.lineTo(650 + Math.cos(a + spread) * len, -40 + Math.sin(a + spread) * len);
      x.closePath();
      x.fill();
    }
    x.restore();
    // bokeh
    x.save();
    x.globalCompositeOperation = 'screen';
    for (let i = 0; i < 46; i++) {
      const X = r() * width, Y = r() * height * 0.9;
      const R = 6 + r() * r() * 46;
      const warm = r() < 0.3;
      const al = 0.05 + r() * 0.16;
      const g = x.createRadialGradient(X, Y, R * 0.55, X, Y, R);
      const col = warm ? '255,210,150' : '210,214,255';
      g.addColorStop(0, `rgba(${col},${al})`);
      g.addColorStop(0.85, `rgba(${col},${al * 0.8})`);
      g.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g;
      x.beginPath();
      x.arc(X, Y, R, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
    // constellations: stars joined by fine lines, kept to the margins
    const stars = [];
    for (let k = 0; k < 7; k++) {
      const side = k % 2 === 0 ? 0 : 1;
      const bx = side === 0 ? 40 + r() * 260 : width - 300 + r() * 260;
      const by = 80 + r() * (height - 400);
      const group = [];
      const n = 4 + Math.floor(r() * 4);
      for (let j = 0; j < n; j++) group.push([bx + (r() - 0.5) * 240, by + (r() - 0.5) * 240]);
      stars.push(group);
    }
    x.lineWidth = 1.2;
    for (const g of stars) {
      x.strokeStyle = 'rgba(220,224,255,0.22)';
      x.beginPath();
      g.forEach((p, i) => (i ? x.lineTo(...p) : x.moveTo(...p)));
      x.stroke();
      for (const p of g) {
        const R = 1.6 + r() * 2.4;
        const sg = x.createRadialGradient(p[0], p[1], 0, p[0], p[1], R * 5);
        sg.addColorStop(0, 'rgba(255,255,255,0.9)');
        sg.addColorStop(0.2, 'rgba(230,232,255,0.55)');
        sg.addColorStop(1, 'rgba(230,232,255,0)');
        x.fillStyle = sg;
        x.beginPath();
        x.arc(p[0], p[1], R * 5, 0, Math.PI * 2);
        x.fill();
      }
    }
    // tiny scattered stars
    for (let i = 0; i < 260; i++) {
      x.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.45})`;
      x.beginPath();
      x.arc(r() * width, r() * height * 0.92, 0.6 + r() * 1.2, 0, Math.PI * 2);
      x.fill();
    }
    // still grain
    const id = x.getImageData(0, 0, width, height);
    const n = noise2(5);
    for (let i = 0; i < width * height; i++) {
      const X = i % width, Y = (i / width) | 0;
      const g = (n(X * 0.9, Y * 0.9) - 0.5) * 7;
      // fade the very bottom to the solid fallback colour (#33318A)
      const fadeK = smooth(height - 260, height, Y);
      const o = i * 4;
      id.data[o] = clamp((id.data[o] + g) * (1 - fadeK) + 0x33 * fadeK, 0, 255);
      id.data[o + 1] = clamp((id.data[o + 1] + g) * (1 - fadeK) + 0x31 * fadeK, 0, 255);
      id.data[o + 2] = clamp((id.data[o + 2] + g) * (1 - fadeK) + 0x8a * fadeK, 0, 255);
    }
    x.putImageData(id, 0, 0);
    return { width, height, frames: [out(c)] };
  }

  window.EmailArt = {
    async loadFont(b64) {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const face = new FontFace('Bricolage', u8.buffer, { weight: '200 800' });
      await face.load();
      document.fonts.add(face);
      return true;
    },
    envelopeSlices,
    seal: paintSeal,
    cap: paintCap,
    button: paintButton,
    divider: paintDivider,
    field: paintField,
  };
})();
