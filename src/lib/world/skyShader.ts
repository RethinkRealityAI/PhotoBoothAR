/**
 * Sky effects, part 2: the picture.
 *
 * One WebGL pass drawn straight after 8th Wall has drawn the camera picture
 * into its run canvas (xr8World.ts, the session module's onRender). 8th Wall's
 * sky layer hands over a small mask (white = sky) and the camera picture as
 * textures in OUR GL context, so this pass repaints the sky and lightly grades
 * the rest of the scene to match, and the booth's compositor then reads the
 * finished canvas as before: photos and clips get the effect for free.
 *
 * Every effect lives on a dome around the guest (azimuth / elevation from the
 * camera's rotation and projection), so stars, lanterns and fireworks stay put
 * in the sky as the phone turns, instead of sliding with the screen.
 *
 * GLSL ES 1.00 on purpose: it compiles in WebGL 1 and WebGL 2 alike.
 */
import { SKY_PROBE_H, SKY_PROBE_W, type SkyEffectId } from './skyFx';

const FX_INDEX: Record<SkyEffectId, number> = {
  golden: 0, stars: 1, aurora: 2, fireworks: 3, lanterns: 4, hearts: 5, names: 6, petals: 7, heartbursts: 8, vows: 9,
};

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** Shared head: uniforms, hashes, noise, the dome ray. */
const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uMask;
uniform sampler2D uCam;
uniform sampler2D uText;
uniform vec4 uVp;
uniform vec2 uCanvas;
uniform vec4 uProj;
uniform mat3 uRot;
uniform float uTime;
uniform float uFade;
uniform vec3 uA;
uniform vec3 uB;
uniform float uTextAspect;
uniform float uHasText;
uniform float uTextEl;
uniform float uBase;

const float PI = 3.14159265;
const float TAU = 6.2831853;

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 hash22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return s;
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

/** Stars on the dome: random points in a 3D grid, kept where the sphere passes near them. */
float starLayer(vec3 d, float scale, float t) {
  vec3 p = d * scale;
  vec3 c = floor(p);
  vec3 h = hash33(c);
  float dist = length(p - (c + 0.15 + 0.7 * h));
  float size = 0.05 + 0.09 * h.x * h.x;
  float tw = 0.65 + 0.35 * sin(t * (1.5 + 4.0 * h.y) + h.z * TAU);
  return smoothstep(size, 0.0, dist) * tw * step(0.3, h.z) * 1.4;
}
float stars(vec3 d, float t) {
  return starLayer(d, 42.0, t) + 0.8 * starLayer(d, 78.0, t * 1.3) + 0.5 * starLayer(d, 140.0, t * 0.7);
}

/** A night sky: deep blue up high, a lighter band at the horizon, a faint milky way. */
vec3 nightSky(vec3 d, float az, float el, float t) {
  vec3 top = vec3(0.012, 0.022, 0.085), low = vec3(0.07, 0.10, 0.26);
  vec3 c = mix(low, top, smoothstep(-0.05, 0.75, el));
  float band = fbm(vec2(az * 2.2 + el * 1.6, el * 3.0 - az * 0.8));
  float mw = smoothstep(0.42, 0.85, band) * smoothstep(0.75, 0.1, abs(el - 0.55 - 0.35 * sin(az * 0.9)));
  c += vec3(0.09, 0.10, 0.20) * mw;
  float s = stars(d, t);
  c += vec3(1.0, 0.96, 0.9) * s * (1.0 + 1.5 * mw);
  return c;
}

/** Day-for-night: the scene under a night sky, darker and cooler but still readable. */
vec3 nightGrade(vec3 c) {
  float l = lum(c);
  return mix(vec3(l), c, 0.7) * vec3(0.36, 0.44, 0.70) * (0.75 + 0.5 * l);
}

/** An island golden hour: gold at the horizon, coral, then rose into deep teal overhead. */
vec3 islandSky(float az, float el, float t) {
  vec3 horizon = vec3(1.0, 0.80, 0.42), coral = vec3(0.99, 0.52, 0.38), rose = vec3(0.72, 0.40, 0.54), teal = vec3(0.11, 0.33, 0.40);
  vec3 g = mix(horizon, coral, smoothstep(0.0, 0.2, el));
  g = mix(g, rose, smoothstep(0.14, 0.46, el));
  g = mix(g, teal, smoothstep(0.38, 1.0, el));
  vec2 sunAt = vec2(-0.30, 0.05);
  float sd = length(vec2((az - sunAt.x) * cos(el), el - sunAt.y));
  g += vec3(1.0, 0.84, 0.5) * (0.6 * exp(-sd * 3.0) + 0.9 * exp(-sd * sd * 240.0));
  float cl = fbm(vec2(az * 2.4 + t * 0.012, el * 9.0));
  float cm = smoothstep(0.52, 0.80, cl) * smoothstep(0.03, 0.2, el) * smoothstep(0.95, 0.4, el);
  vec3 cloud = mix(vec3(0.45, 0.27, 0.40), vec3(1.0, 0.68, 0.42), smoothstep(0.55, 0.9, cl + 0.3 * exp(-sd * 2.0)));
  return mix(g, cloud, cm * 0.8);
}

float sdHeart(vec2 p) {
  p.x = abs(p.x);
  p.y += 0.55;
  if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - 0.35355;
  vec2 a = p - vec2(0.0, 1.0);
  vec2 b = p - 0.5 * max(p.x + p.y, 0.0);
  return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
}
`;

/** Each effect fills `sky` (the new sky colour), `keep` (how much real sky stays) and `scene` (the graded scene). */
const EFFECTS: string[] = [
  // 0 Sunset Sky
  `
  vec3 horizon = vec3(1.0, 0.74, 0.36), coral = vec3(0.98, 0.47, 0.40), mauve = vec3(0.56, 0.36, 0.64), dusk = vec3(0.20, 0.24, 0.50);
  vec3 g = mix(horizon, coral, smoothstep(0.0, 0.22, el));
  g = mix(g, mauve, smoothstep(0.16, 0.52, el));
  g = mix(g, dusk, smoothstep(0.45, 1.05, el));
  vec2 sunAt = vec2(0.28, 0.07);
  float sd = length(vec2((az - sunAt.x) * cos(el), el - sunAt.y));
  g += vec3(1.0, 0.82, 0.5) * (0.55 * exp(-sd * 3.2) + 0.9 * exp(-sd * sd * 260.0));
  float cl = fbm(vec2(az * 2.6 + uTime * 0.012, el * 8.5));
  float cm = smoothstep(0.50, 0.78, cl) * smoothstep(0.03, 0.2, el) * smoothstep(1.0, 0.45, el);
  vec3 cloud = mix(vec3(0.42, 0.26, 0.42), vec3(1.0, 0.62, 0.44), smoothstep(0.55, 0.9, cl + 0.25 * exp(-sd * 2.0)));
  g = mix(g, cloud, cm * 0.85);
  // Keep the real sky's own clouds as shading, so it still looks like this sky.
  float real = lum(cam);
  sky = g * (0.78 + 0.34 * real);
  keep = 0.0;
  float l = lum(cam);
  scene = mix(cam, cam * vec3(1.14, 0.94, 0.74) + vec3(0.05, 0.02, 0.0) * l, 0.75);
  `,
  // 1 Starry Night
  `
  sky = nightSky(d, az, el, uTime);
  // A shooting star every few seconds.
  float k = floor(uTime / 4.5), lt = fract(uTime / 4.5);
  vec2 s0 = vec2(-0.5 + hash11(k + 3.0), 0.25 + 0.25 * hash11(k + 7.0));
  vec2 dir = normalize(vec2(0.8, -0.3 + 0.25 * hash11(k + 11.0)));
  vec2 q = vec2(az, el) - (s0 + dir * lt * 2.2);
  float along = dot(q, dir), across = length(q - dir * along);
  float tail = smoothstep(-0.22, 0.0, along) * step(along, 0.0);
  sky += vec3(1.0, 0.95, 0.85) * tail * exp(-across * across * 60000.0) * smoothstep(0.0, 0.05, lt) * smoothstep(0.35, 0.2, lt) * 1.6;
  keep = 0.0;
  scene = nightGrade(cam);
  `,
  // 2 Northern Lights
  `
  sky = nightSky(d, az, el, uTime) * 0.8;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float x = az * (1.6 + 0.5 * fi) + fi * 4.0;
    float n = fbm(vec2(x * 1.1 + uTime * 0.045, uTime * 0.03 + fi * 9.0));
    float base = 0.07 + 0.13 * fi + 0.07 * sin(x * 1.4 + n * 3.5);
    float h = el - base;
    float curtain = h > 0.0 ? exp(-h * (3.2 + 1.5 * fi)) : exp(-h * h * 500.0);
    float rays = 0.55 + 0.45 * vnoise(vec2(az * 46.0 + n * 6.0, uTime * 0.35 + fi * 3.0));
    float ribbon = smoothstep(0.25, 0.75, fbm(vec2(x * 0.8 - uTime * 0.02, fi * 5.0 + 2.0)));
    vec3 col = mix(vec3(0.15, 1.0, 0.55), vec3(0.20, 0.75, 0.95), smoothstep(0.0, 0.25, h));
    col = mix(col, vec3(0.62, 0.30, 0.95), smoothstep(0.18, 0.6, h));
    sky += col * curtain * rays * ribbon * (1.05 - 0.35 * fi);
  }
  keep = 0.0;
  scene = nightGrade(cam) + vec3(0.0, 0.035, 0.02);
  `,
  // 3 Firework Sky
  `
  sky = nightSky(d, az, el, uTime) * 0.75;
  vec3 spill = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float period = 2.7 + 0.45 * fi;
    float tt = uTime / period + fi * 0.37;
    float k = floor(tt), lt = fract(tt);
    float seed = k * 7.13 + fi * 31.7;
    vec2 c0 = vec2((hash11(seed) - 0.5) * 0.56, 0.13 + 0.26 * hash11(seed + 1.7));
    vec2 q = vec2((az - c0.x) * cos(el), el - c0.y);
    float hsel = hash11(seed + 4.2);
    vec3 col = hsel < 0.28 ? uA : hsel < 0.52 ? uB : hsel < 0.72 ? vec3(1.0, 0.78, 0.32) : hsel < 0.86 ? vec3(1.0, 0.42, 0.55) : vec3(0.75, 0.88, 1.0);
    float launch = 0.16;
    if (lt < launch) {
      // The rocket climbing to where it will burst.
      float u = lt / launch;
      vec2 r = q - vec2(0.0, -(1.0 - u) * 0.2);
      float tr = smoothstep(-0.07, 0.0, r.y) * step(r.y, 0.0);
      sky += vec3(1.0, 0.85, 0.6) * (exp(-dot(r, r) * 30000.0) + 0.5 * tr * exp(-r.x * r.x * 90000.0));
    } else {
      float u = (lt - launch) / (1.0 - launch);
      float R = (0.10 + 0.07 * hash11(seed + 2.9)) * (1.0 - exp(-4.2 * u));
      float fade = pow(1.0 - u, 1.6);
      vec2 qq = q + vec2(0.0, 0.05 * u * u);
      float rad = length(qq), ang = atan(qq.y, qq.x);
      float glow = 0.0;
      // Two rings of sparks; only the three spokes nearest this pixel are worked out.
      for (int ring = 0; ring < 2; ring++) {
        float n = ring == 0 ? 26.0 : 13.0;
        float rr = ring == 0 ? 1.0 : 0.56;
        float j0 = floor(ang / TAU * n);
        for (int dj = -1; dj <= 1; dj++) {
          float j = j0 + float(dj);
          float hj = hash11(mod(j, n) + seed * 1.3 + float(ring) * 50.0);
          float a = (j + 0.2 + 0.6 * hj) / n * TAU;
          float len = R * rr * (0.82 + 0.3 * hj);
          vec2 dirj = vec2(cos(a), sin(a));
          float al = dot(qq, dirj), ac = length(qq - dirj * al);
          vec2 tip = qq - dirj * len;
          float tw = 0.6 + 0.4 * sin(uTime * 22.0 + hj * 40.0);
          glow += exp(-dot(tip, tip) * 42000.0) * (u > 0.55 ? tw : 1.0);
          glow += 0.45 * smoothstep(len * 0.45, len, al) * step(al, len) * exp(-ac * ac * 120000.0);
        }
      }
      sky += (col * 1.35 + vec3(0.35)) * glow * fade;
      float flash = exp(-rad * rad * 55.0) * pow(1.0 - u, 3.0);
      sky += col * flash * 0.5;
      spill += col * pow(1.0 - u, 3.0) * 0.10;
    }
  }
  keep = 0.0;
  scene = nightGrade(cam) * (1.0 + 0.5 * lum(spill)) + spill * (0.25 + lum(cam));
  `,
  // 4 Sky Lanterns
  `
  vec3 top = vec3(0.05, 0.07, 0.22), mid = vec3(0.22, 0.16, 0.38), low = vec3(0.72, 0.40, 0.34);
  vec3 g = mix(low, mid, smoothstep(0.0, 0.3, el));
  g = mix(g, top, smoothstep(0.2, 0.85, el));
  g += vec3(1.0, 0.95, 0.9) * stars(d, uTime) * smoothstep(0.2, 0.6, el) * 0.7;
  float warm = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float s = 3.4 + 2.6 * fi;
    vec2 p = vec2(az * s + fi * 3.7, (el - uTime * (0.020 - 0.004 * fi)) * s * 0.8);
    vec2 cell = floor(p);
    vec2 h = hash22(cell + fi * 19.0);
    if (h.x > 0.5) {
      vec2 f = fract(p) - 0.5;
      f.x += 0.08 * sin(uTime * 0.5 + h.y * TAU);
      f -= (h - 0.5) * 0.4;
      float sz = 0.10 + 0.05 * h.y;
      vec2 b = f / sz;
      // A paper lantern: wider at the top, open at the bottom where the flame sits.
      float body = max(abs(b.x) - (0.62 + 0.16 * b.y), abs(b.y) - 0.9);
      float inside = smoothstep(0.06, -0.06, body);
      float flick = 0.85 + 0.15 * sin(uTime * 7.0 + h.x * 50.0);
      vec3 paper = mix(vec3(1.0, 0.86, 0.45), vec3(1.0, 0.42, 0.14), smoothstep(-0.9, 0.9, b.y));
      float halo = exp(-dot(b, b) * 1.1) * 0.6;
      float depth = 1.0 - 0.22 * fi;
      g = mix(g, paper * flick * depth * 1.25, inside * depth);
      g += vec3(1.0, 0.55, 0.2) * halo * (1.0 - inside) * flick * depth;
      warm += halo * 0.3;
    }
  }
  sky = g;
  keep = 0.0;
  float l = lum(cam);
  scene = mix(vec3(l), cam, 0.8) * vec3(0.62, 0.54, 0.66) + vec3(0.07, 0.035, 0.0) * l;
  `,
  // 5 Floating Hearts
  `
  vec3 blush = mix(vec3(1.0, 0.80, 0.78), vec3(0.98, 0.62, 0.76), smoothstep(0.0, 0.7, el));
  vec3 g = mix(cam, blush * (0.6 + 0.5 * lum(cam)), 0.42);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float s = 3.0 + 2.4 * fi;
    vec2 p = vec2(az * s + fi * 5.3, (el - uTime * (0.034 - 0.007 * fi)) * s * 0.85);
    vec2 cell = floor(p);
    vec2 h = hash22(cell + fi * 23.0);
    if (h.x > 0.36) {
      vec2 f = fract(p) - 0.5;
      f.x += 0.09 * sin(uTime * 0.8 + h.y * TAU);
      f -= (h - 0.5) * 0.4;
      float sz = 0.13 + 0.07 * h.y;
      float rot = 0.3 * sin(uTime * 0.6 + h.x * 30.0);
      vec2 b = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * f / sz;
      float sdh = sdHeart(b * 0.62);
      float inside = smoothstep(0.03, -0.03, sdh);
      vec3 col = h.y < 0.4 ? uA : h.y < 0.7 ? vec3(0.98, 0.36, 0.52) : uB;
      col = mix(col, vec3(1.0), 0.25 * smoothstep(0.0, -0.4, sdh) * smoothstep(-0.2, 0.6, b.y - b.x));
      float depth = 1.0 - 0.2 * fi;
      g += col * exp(-max(sdh, 0.0) * 9.0) * 0.28 * (1.0 - inside);
      g = mix(g, col, inside * 0.92 * depth);
    }
  }
  sky = g;
  keep = 0.0;
  scene = mix(cam, cam * vec3(1.06, 0.97, 0.98), 0.6);
  `,
  // 6 Names in Stars
  `
  sky = nightSky(d, az, el, uTime);
  if (uHasText > 0.5) {
    float W = 0.54, H = W / uTextAspect;
    vec2 tuv = vec2(az / W + 0.5, (el - uTextEl) / H + 0.5);
    if (tuv.x > -0.1 && tuv.x < 1.1 && tuv.y > -0.3 && tuv.y < 1.3) {
      vec2 tc = vec2(tuv.x, 1.0 - tuv.y);
      float inb = step(0.0, tc.x) * step(tc.x, 1.0) * step(0.0, tc.y) * step(tc.y, 1.0);
      float ink = texture2D(uText, tc).a * inb;
      vec2 e = smoothstep(vec2(0.0), vec2(0.04, 0.16), tc) * smoothstep(vec2(0.0), vec2(0.04, 0.16), 1.0 - tc);
      float soft = texture2D(uText, clamp(tc, 0.0, 1.0), 3.0).a * e.x * e.y;
      // The words draw themselves in from the left, then keep a slow shimmer.
      float reveal = smoothstep(0.0, 0.12, uTime * 0.4 - tuv.x * 1.0 + 0.1);
      float spark = 0.75 + 0.25 * vnoise(vec2(tuv.x * 140.0, tuv.y * 40.0 + uTime * 1.5));
      sky += (vec3(1.0, 0.97, 0.9) * ink * spark * 1.4 + mix(uA, vec3(1.0, 0.85, 0.6), 0.5) * soft * 0.55) * reveal;
    }
  }
  keep = 0.0;
  scene = nightGrade(cam);
  `,
  // 7 Hibiscus Rain
  `
  vec3 g = islandSky(az, el, uTime) * (0.80 + 0.32 * lum(cam));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float s = 2.8 + 2.3 * fi;
    vec2 p = vec2(az * s + fi * 4.1, (el + uTime * (0.030 - 0.006 * fi)) * s * 0.85);
    vec2 cell = floor(p);
    vec2 h = hash22(cell + fi * 29.0);
    if (h.x > 0.40) {
      vec2 f = fract(p) - 0.5;
      f.x += 0.10 * sin(uTime * 0.7 + h.y * TAU);
      f -= (h - 0.5) * 0.36;
      float sz = 0.16 + 0.07 * h.y;
      float rot = uTime * (0.25 + 0.5 * h.x) * (h.y > 0.5 ? 1.0 : -1.0) + h.x * 30.0;
      vec2 b = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * f / sz;
      // A flower tumbling as it falls: it turns edge-on now and then.
      b.y /= 0.55 + 0.45 * abs(cos(uTime * 0.8 + h.x * 20.0));
      float r = length(b), a = atan(b.y, b.x);
      float petal = 0.42 + 0.50 * pow(abs(cos(2.5 * a)), 0.55);
      float inside = smoothstep(petal, petal - 0.10, r);
      vec3 col = h.y < 0.45 ? vec3(0.95, 0.17, 0.28) : h.y < 0.75 ? mix(uA, vec3(1.0, 0.80, 0.30), 0.35) : vec3(1.0, 0.94, 0.86);
      // A darker throat, light veins along each petal, a gold stamen.
      col *= 0.62 + 0.38 * smoothstep(0.05, 0.6, r);
      col *= 0.93 + 0.07 * cos(10.0 * a);
      col = mix(col, vec3(1.0, 0.82, 0.25), smoothstep(0.13, 0.07, r));
      float depth = 1.0 - 0.2 * fi;
      g += col * exp(-max(r - petal, 0.0) * 7.0) * 0.12 * (1.0 - inside);
      g = mix(g, col, inside * 0.95 * depth);
    }
  }
  sky = g;
  keep = 0.0;
  float l = lum(cam);
  scene = mix(cam, cam * vec3(1.14, 0.95, 0.76) + vec3(0.05, 0.02, 0.0) * l, 0.75);
  `,
  // 8 Heart Bursts
  `
  sky = nightSky(d, az, el, uTime) * 0.75 + vec3(0.0, 0.022, 0.03) * smoothstep(0.6, 0.0, el);
  vec3 spill = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float period = 3.1 + 0.5 * fi;
    float tt = uTime / period + fi * 0.41;
    float k = floor(tt), lt = fract(tt);
    float seed = k * 5.77 + fi * 23.9;
    vec2 c0 = vec2((hash11(seed) - 0.5) * 0.52, 0.16 + 0.24 * hash11(seed + 1.7));
    vec2 q = vec2((az - c0.x) * cos(el), el - c0.y);
    float hsel = hash11(seed + 4.2);
    vec3 col = hsel < 0.36 ? uA : hsel < 0.68 ? uB : vec3(1.0, 0.40, 0.55);
    float launch = 0.15;
    if (lt < launch) {
      float u = lt / launch;
      vec2 r = q - vec2(0.0, -(1.0 - u) * 0.2);
      float tr = smoothstep(-0.07, 0.0, r.y) * step(r.y, 0.0);
      sky += vec3(1.0, 0.85, 0.6) * (exp(-dot(r, r) * 30000.0) + 0.5 * tr * exp(-r.x * r.x * 90000.0));
    } else {
      float u = (lt - launch) / (1.0 - launch);
      float R = (0.11 + 0.06 * hash11(seed + 2.9)) * (1.0 - exp(-4.0 * u));
      float fade = pow(1.0 - u, 1.5);
      float tilt = (hash11(seed + 6.1) - 0.5) * 0.5;
      vec2 qq = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * (q + vec2(0.0, 0.04 * u * u));
      float ang = atan(qq.y, qq.x);
      float glow = 0.0;
      // Two hearts of sparks, one inside the other.
      for (int ring = 0; ring < 2; ring++) {
        float rr = ring == 0 ? 1.0 : 0.56;
        float sdh = sdHeart(qq / max(R * rr, 0.001) * 0.56);
        float n = ring == 0 ? 30.0 : 16.0;
        float dots = pow(0.5 + 0.5 * cos(ang * n + seed * 3.0 + float(ring)), 3.0);
        float tw = u > 0.5 ? 0.55 + 0.45 * sin(uTime * 20.0 + ang * 9.0) : 1.0;
        glow += (0.25 + 1.1 * dots * tw) * exp(-sdh * sdh * (ring == 0 ? 1500.0 : 900.0)) * (ring == 0 ? 1.0 : 0.7);
      }
      sky += (col * 1.3 + vec3(0.3)) * glow * fade;
      float rad = length(qq);
      sky += col * exp(-rad * rad * 55.0) * pow(1.0 - u, 3.0) * 0.45;
      spill += col * pow(1.0 - u, 3.0) * 0.10;
    }
  }
  keep = 0.0;
  scene = nightGrade(cam) * (1.0 + 0.5 * lum(spill)) + spill * (0.25 + lum(cam));
  `,
  // 9 Forever Sky
  `
  vec3 g = islandSky(az, el, uTime) * (0.80 + 0.32 * lum(cam));
  g += vec3(1.0, 0.92, 0.75) * stars(d, uTime) * smoothstep(0.3, 0.7, el) * 0.6;
  if (uHasText > 0.5) {
    float W = 0.60, H = W / uTextAspect;
    vec2 tuv = vec2(az / W + 0.5, (el - uTextEl - 0.07) / H + 0.5);
    if (tuv.x > -0.1 && tuv.x < 1.1 && tuv.y > -0.3 && tuv.y < 1.3) {
      vec2 tc = vec2(tuv.x, 1.0 - tuv.y);
      float inb = step(0.0, tc.x) * step(tc.x, 1.0) * step(0.0, tc.y) * step(tc.y, 1.0);
      float ink = texture2D(uText, tc).a * inb;
      vec2 e = smoothstep(vec2(0.0), vec2(0.04, 0.10), tc) * smoothstep(vec2(0.0), vec2(0.04, 0.10), 1.0 - tc);
      float soft = texture2D(uText, clamp(tc, 0.0, 1.0), 3.5).a * e.x * e.y;
      float reveal = smoothstep(0.0, 0.12, uTime * 0.4 - tuv.x + 0.1);
      float shine = 0.82 + 0.18 * sin(tuv.x * 9.0 - uTime * 1.3);
      // A soft shade behind the letters so gold reads on a bright sky.
      g *= 1.0 - 0.60 * soft * reveal;
      g = mix(g, vec3(1.0, 0.95, 0.78) * shine * 1.2, ink * reveal);
      g += vec3(1.0, 0.72, 0.30) * soft * 0.22 * reveal;
    }
  }
  sky = g;
  keep = 0.0;
  float l = lum(cam);
  scene = mix(cam, cam * vec3(1.14, 0.95, 0.76) + vec3(0.05, 0.02, 0.0) * l, 0.75);
  `,
];

function fragmentSource(fx: number): string {
  return `${HEAD}
void main() {
  vec2 muv = (gl_FragCoord.xy - uVp.xy) / uVp.zw;
  vec2 tuvCam = vec2(muv.x, 1.0 - muv.y);
  vec3 cam = texture2D(uCam, tuvCam).rgb;
  float m = texture2D(uMask, tuvCam).r;
  // The mask is small (144 x 256), so its edge is soft. Along that edge a
  // bright pixel is far more likely sky than building: let brightness decide.
  float skyLike = smoothstep(0.40, 0.78, lum(cam));
  float edgeMid = mix(0.52, 0.16, skyLike);
  float inSky = smoothstep(edgeMid - 0.12, edgeMid + 0.12, m);
  vec2 ndc = gl_FragCoord.xy / uCanvas * 2.0 - 1.0;
  vec3 d = normalize(uRot * vec3((ndc.x + uProj.z) / uProj.x, (ndc.y + uProj.w) / uProj.y, -1.0));
  float az = atan(d.x, -d.z);
  // Elevation above the skyline (rooftops, trees, the sea's horizon), so every
  // effect sits in the sky this camera can actually see.
  float el = asin(clamp(d.y, -1.0, 1.0)) - uBase;
  vec3 sky = cam;
  vec3 scene = cam;
  float keep = 0.0;
  ${EFFECTS[fx]}
  vec3 outSky = mix(sky, cam, keep);
  vec3 col = mix(scene, outSky, inSky);
  gl_FragColor = vec4(mix(cam, col, uFade), 1.0);
}
`;
}

export interface SkyDraw {
  mask: WebGLTexture;
  cam: WebGLTexture;
  /** Where 8th Wall drew the camera picture inside the canvas (pixels). */
  vp: { offsetX: number; offsetY: number; width: number; height: number };
  canvasW: number;
  canvasH: number;
  /** Column-major projection matrix of the canvas. */
  proj: ArrayLike<number>;
  /** Dome-from-camera rotation, column-major 3x3 (skyFx.domeRotation). */
  rot: Float32Array;
  /** Seconds since the effect was switched on. */
  time: number;
  /** 0..1 fade-in. */
  fade: number;
  /** Elevation of the skyline (radians): skyFx.skylineElevation. */
  base: number;
}

type GL = WebGL2RenderingContext | WebGLRenderingContext;

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  aPos: number;
}

const UNIFORMS = ['uMask', 'uCam', 'uText', 'uVp', 'uCanvas', 'uProj', 'uRot', 'uTime', 'uFade', 'uA', 'uB', 'uTextAspect', 'uHasText', 'uTextEl', 'uBase'];

/**
 * The sky pass. It shares 8th Wall's GL context, so `draw` puts back every
 * piece of GL state it touches.
 */
export class SkyPass {
  private readonly programs = new Map<number, Program | null>();
  private readonly buf: WebGLBuffer | null;
  private readonly vao: WebGLVertexArrayObject | null = null;
  private readonly gl2: WebGL2RenderingContext | null;
  private text: WebGLTexture | null = null;
  private textAspect = 4;
  private a: [number, number, number] = [1, 0.8, 0.4];
  private b: [number, number, number] = [1, 0.4, 0.6];
  private fx = -1;
  /** Why the last effect could not be shown (shader compile), if it could not. */
  error: string | null = null;

  constructor(private readonly gl: GL) {
    this.gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? gl : null;
    const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    if (this.gl2) {
      const prevVao = this.gl2.getParameter(this.gl2.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
      this.vao = this.gl2.createVertexArray();
      this.gl2.bindVertexArray(this.vao);
      this.gl2.enableVertexAttribArray(0);
      this.gl2.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.gl2.bindVertexArray(prevVao);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
  }

  /** WebGL 1 has no vertex array objects to keep our attribute away from 8th Wall's. */
  get supported(): boolean { return this.gl2 !== null; }

  private program(fx: number): Program | null {
    const had = this.programs.get(fx);
    if (had !== undefined) return had;
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        this.error = gl.getShaderInfoLog(s) ?? 'shader compile failed';
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource(fx));
    let out: Program | null = null;
    if (vs && fs) {
      const prog = gl.createProgram();
      if (prog) {
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'aPos');
        gl.linkProgram(prog);
        if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          const u: Program['u'] = {};
          for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name);
          out = { prog, u, aPos: 0 };
        } else {
          this.error = gl.getProgramInfoLog(prog) ?? 'shader link failed';
        }
      }
    }
    if (out === null) console.warn('[skyShader]', this.error);
    this.programs.set(fx, out);
    return out;
  }

  /** Pick the effect and its two event colours (linear 0..1 rgb). */
  use(id: SkyEffectId, a: readonly [number, number, number], b: readonly [number, number, number]): void {
    this.fx = FX_INDEX[id];
    this.a = [a[0], a[1], a[2]];
    this.b = [b[0], b[1], b[2]];
  }

  /** The words for "Names in Stars": white on transparent, any size. null clears them. */
  setText(image: HTMLCanvasElement | null): void {
    const gl = this.gl;
    if (image === null) {
      if (this.text) gl.deleteTexture(this.text);
      this.text = null;
      return;
    }
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    const prevPre = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean;
    this.text = this.text ?? gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.text);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPre);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.activeTexture(prevActive);
    this.textAspect = image.width / Math.max(1, image.height);
  }

  private probeProg: WebGLProgram | null = null;
  private probeFb: WebGLFramebuffer | null = null;
  private probeTex: WebGLTexture | null = null;
  private readonly probePx = new Uint8Array(SKY_PROBE_W * SKY_PROBE_H * 4);
  private readonly probeOut = new Uint8Array(SKY_PROBE_W * SKY_PROBE_H);

  /**
   * A small copy of the sky mask read back to the CPU (SKY_PROBE_W x
   * SKY_PROBE_H, row 0 = the TOP of the picture, 255 = sky), for finding the
   * skyline. A blocking read of a few hundred bytes: call it a couple of
   * times a second, not every frame. null when it cannot be read.
   */
  probe(mask: WebGLTexture): Uint8Array | null {
    const gl = this.gl2;
    if (!gl) return null;
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const prevPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
    const blend = gl.isEnabled(gl.BLEND), depth = gl.isEnabled(gl.DEPTH_TEST), scissor = gl.isEnabled(gl.SCISSOR_TEST), cull = gl.isEnabled(gl.CULL_FACE);
    let ok = false;
    try {
      if (!this.probeProg) {
        const mk = (type: number, src: string) => { const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
        const prog = gl.createProgram()!;
        gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
        // The mask's first row is the top of the picture, and so is ours.
        gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, `precision mediump float; uniform sampler2D uMask; uniform vec2 uSize;
          void main() { gl_FragColor = vec4(texture2D(uMask, gl_FragCoord.xy / uSize).r); }`));
        gl.bindAttribLocation(prog, 0, 'aPos');
        gl.linkProgram(prog);
        this.probeProg = prog;
        this.probeTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.probeTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SKY_PROBE_W, SKY_PROBE_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.probeFb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.probeTex, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        gl.viewport(0, 0, SKY_PROBE_W, SKY_PROBE_H);
        gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
        gl.useProgram(this.probeProg);
        gl.bindVertexArray(this.vao);
        gl.bindTexture(gl.TEXTURE_2D, mask);
        gl.uniform1i(gl.getUniformLocation(this.probeProg, 'uMask'), 0);
        gl.uniform2f(gl.getUniformLocation(this.probeProg, 'uSize'), SKY_PROBE_W, SKY_PROBE_H);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.readPixels(0, 0, SKY_PROBE_W, SKY_PROBE_H, gl.RGBA, gl.UNSIGNED_BYTE, this.probePx);
        for (let i = 0; i < this.probeOut.length; i++) this.probeOut[i] = this.probePx[i * 4];
        ok = true;
      }
    } catch { ok = false; }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.activeTexture(prevActive);
    gl.bindVertexArray(prevVao);
    gl.useProgram(prevProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
    if (blend) gl.enable(gl.BLEND);
    if (depth) gl.enable(gl.DEPTH_TEST);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    if (cull) gl.enable(gl.CULL_FACE);
    return ok ? this.probeOut : null;
  }

  /** Repaint the sky over the camera picture already in the canvas. false = nothing drawn. */
  draw(d: SkyDraw): boolean {
    const gl2 = this.gl2;
    if (!gl2 || this.fx < 0) return false;
    const p = this.program(this.fx);
    if (!p) return false;
    const gl = gl2;
    // Everything this pass changes, to put back afterwards.
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const prevTex: (WebGLTexture | null)[] = [];
    for (let i = 0; i < 3; i++) { gl.activeTexture(gl.TEXTURE0 + i); prevTex.push(gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null); }
    const blend = gl.isEnabled(gl.BLEND), depth = gl.isEnabled(gl.DEPTH_TEST), scissor = gl.isEnabled(gl.SCISSOR_TEST), cull = gl.isEnabled(gl.CULL_FACE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(d.vp.offsetX, d.vp.offsetY, d.vp.width, d.vp.height);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, d.mask);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, d.cam);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.text);
    gl.uniform1i(p.u.uMask, 0); gl.uniform1i(p.u.uCam, 1); gl.uniform1i(p.u.uText, 2);
    gl.uniform4f(p.u.uVp, d.vp.offsetX, d.vp.offsetY, d.vp.width, d.vp.height);
    gl.uniform2f(p.u.uCanvas, d.canvasW, d.canvasH);
    gl.uniform4f(p.u.uProj, d.proj[0], d.proj[5], d.proj[8], d.proj[9]);
    gl.uniformMatrix3fv(p.u.uRot, false, d.rot);
    gl.uniform1f(p.u.uTime, d.time);
    gl.uniform1f(p.u.uFade, d.fade);
    gl.uniform3f(p.u.uA, this.a[0], this.a[1], this.a[2]);
    gl.uniform3f(p.u.uB, this.b[0], this.b[1], this.b[2]);
    gl.uniform1f(p.u.uTextAspect, this.textAspect);
    gl.uniform1f(p.u.uHasText, this.text ? 1 : 0);
    gl.uniform1f(p.u.uTextEl, 0.17);
    gl.uniform1f(p.u.uBase, d.base);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    for (let i = 0; i < 3; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, prevTex[i]); }
    gl.activeTexture(prevActive);
    gl.bindVertexArray(prevVao);
    gl.useProgram(prevProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
    if (blend) gl.enable(gl.BLEND);
    if (depth) gl.enable(gl.DEPTH_TEST);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    if (cull) gl.enable(gl.CULL_FACE);
    return true;
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of this.programs.values()) if (p) gl.deleteProgram(p.prog);
    this.programs.clear();
    if (this.text) gl.deleteTexture(this.text);
    if (this.probeProg) gl.deleteProgram(this.probeProg);
    if (this.probeTex) gl.deleteTexture(this.probeTex);
    if (this.probeFb) gl.deleteFramebuffer(this.probeFb);
    this.probeProg = this.probeTex = this.probeFb = null;
    if (this.buf) gl.deleteBuffer(this.buf);
    if (this.vao && this.gl2) this.gl2.deleteVertexArray(this.vao);
    this.text = null;
  }
}

/**
 * The words an effect writes, as a white-on-clear picture (power-of-two sized,
 * so WebGL 1 can mipmap it too). Italic serif, fitted to width. A second line
 * (after "\n", the hashtag under the names) is set small and spaced beneath.
 */
export function skyTextCanvas(text: string, fontFamily = '"Cormorant Garamond", "Instrument Serif", Georgia, serif'): HTMLCanvasElement {
  const [first, second] = text.split('\n');
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = second ? 512 : 256;
  const g = c.getContext('2d');
  if (!g) return c;
  let px = second ? 190 : 150;
  const font = () => `italic 500 ${px}px ${fontFamily}`;
  g.font = font();
  const maxW = c.width - 80;
  const w = g.measureText(first).width;
  if (w > maxW) { px = Math.max(40, Math.floor(px * maxW / w)); g.font = font(); }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  if (!second) {
    g.fillText(first, c.width / 2, c.height / 2 + px * 0.04);
    return c;
  }
  g.fillText(first, c.width / 2, c.height * 0.40);
  let small = Math.round(px * 0.40);
  const smallFont = () => `600 ${small}px ${fontFamily}`;
  g.font = smallFont();
  try { (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${Math.round(small * 0.18)}px`; } catch { /* older browsers: unspaced */ }
  const w2 = g.measureText(second).width;
  if (w2 > maxW) { small = Math.max(24, Math.floor(small * maxW / w2)); g.font = smallFont(); }
  g.fillText(second, c.width / 2, c.height * 0.40 + px * 0.62);
  return c;
}
