/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WebGL procedural shader EFFECTS for the Hope Gala booth.
 *
 * These are "cool" effects designed to additively layer over the camera frame
 * (screen-blend aesthetics) so they COMBINE beautifully with decorative frames
 * composited on top. WebGL1 / GLSL ES 1.00 for mobile-Safari compatibility.
 *
 * Plus a special `golden-disintegration` dissolve (driven by uFade 0→1) used
 * for the magical send-off animation.
 */

export interface ShaderParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface ShaderDef {
  id: string;
  name: string;
  description: string;
  animated: boolean;
  /** special effects (e.g. the dissolve) are not offered as booth filters */
  special?: boolean;
  fragment: string;
  params: ShaderParam[];
}

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Shared header: precision, uniforms, varying + common helpers. */
const HEADER = `
precision highp float;
uniform sampler2D uTexture;
uniform float uTime;
uniform vec2 uResolution;
uniform float uIntensity;
uniform float uWarmth;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uBloom;
uniform float uSparkle;
uniform float uFade;
varying vec2 vUv;

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 screenBlend(vec3 a, vec3 b){ return 1.0 - (1.0 - a) * (1.0 - b); }
`;

const compose = (effect: string) => `${HEADER}\n${effect}`;

export const SHADERS: ShaderDef[] = [
  {
    id: 'none',
    name: 'Au Naturel',
    description: 'No effect — pure camera.',
    animated: false,
    fragment: compose(`void main(){ gl_FragColor = texture2D(uTexture, vUv); }`),
    params: [],
  },

  {
    id: 'champagne-sparkle',
    name: 'Champagne Sparkle',
    description: 'Procedural gold glitter that twinkles over you — additively layered.',
    animated: true,
    fragment: compose(`
float sparklePoint(vec2 uv, vec2 center, float size, float phase){
  float d = length(uv - center);
  float core = smoothstep(size, 0.0, d);
  float angle = atan(uv.y - center.y, uv.x - center.x);
  float cross4 = pow(abs(sin(angle * 2.0)), 8.0);
  float star = smoothstep(size * 3.0, 0.0, d) * cross4;
  return (core + star * 0.4) * (0.6 + 0.4 * sin(phase));
}
void main(){
  vec4 base = texture2D(uTexture, vUv);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 uv = vUv * aspect;
  vec3 goldA = vec3(0.831, 0.686, 0.216);
  vec3 goldB = vec3(0.910, 0.780, 0.400);
  vec3 ivory = vec3(0.984, 0.953, 0.851);
  vec3 sparkles = vec3(0.0);
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    vec2 cell = vec2(mod(fi, 7.0), floor(fi / 7.0)) / vec2(7.0, 4.0);
    vec2 jitter = vec2(hash21(cell + 0.1), hash21(cell + 0.7));
    vec2 center = (cell + jitter * 0.9) * aspect;
    center.x = mod(center.x, aspect.x);
    float sz = 0.004 + hash21(cell + 1.3) * 0.008;
    float speed = 0.8 + hash21(cell + 2.1) * 2.0;
    float phase = uTime * speed + hash21(cell + 3.7) * 6.28318;
    float drift = hash21(cell + 4.2) * 6.28318;
    vec2 pos = center + vec2(cos(drift + uTime * 0.3), sin(drift * 1.3 + uTime * 0.2)) * 0.02;
    float sp = sparklePoint(uv, pos, sz, phase);
    float t = fract(fi * 0.137);
    vec3 col = mix(goldA, mix(goldB, ivory, t * 2.0 - 1.0), t);
    sparkles += sp * col;
  }
  vec3 result = base.rgb + sparkles * uSparkle * 1.4;
  result = mix(result, result * vec3(1.05, 1.01, 0.88), uWarmth * 0.4);
  gl_FragColor = vec4(result, base.a);
}`),
    params: [
      { key: 'uSparkle', label: 'Sparkle', min: 0, max: 1.2, step: 0.01, default: 0.75 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1, step: 0.05, default: 0.5 },
    ],
  },

  {
    id: 'golden-hour-bloom',
    name: 'Golden Hour Bloom',
    description: 'Warm champagne glow that screen-blends across the highlights.',
    animated: false,
    fragment: compose(`
vec3 sampleBlur(sampler2D tex, vec2 uv, float radius){
  vec3 acc = texture2D(tex, uv).rgb * 0.25;
  vec2 px = radius / uResolution;
  acc += texture2D(tex, uv + vec2( px.x, 0.0)).rgb * 0.125;
  acc += texture2D(tex, uv + vec2(-px.x, 0.0)).rgb * 0.125;
  acc += texture2D(tex, uv + vec2(0.0,  px.y)).rgb * 0.125;
  acc += texture2D(tex, uv + vec2(0.0, -px.y)).rgb * 0.125;
  acc += texture2D(tex, uv + vec2( px.x,  px.y)).rgb * 0.0625;
  acc += texture2D(tex, uv + vec2(-px.x,  px.y)).rgb * 0.0625;
  acc += texture2D(tex, uv + vec2( px.x, -px.y)).rgb * 0.0625;
  acc += texture2D(tex, uv + vec2(-px.x, -px.y)).rgb * 0.0625;
  vec2 px2 = px * 2.5;
  acc += texture2D(tex, uv + vec2( px2.x, 0.0)).rgb * 0.03125;
  acc += texture2D(tex, uv + vec2(-px2.x, 0.0)).rgb * 0.03125;
  acc += texture2D(tex, uv + vec2(0.0,  px2.y)).rgb * 0.03125;
  acc += texture2D(tex, uv + vec2(0.0, -px2.y)).rgb * 0.03125;
  return acc;
}
void main(){
  vec4 base = texture2D(uTexture, vUv);
  vec3 scene = base.rgb;
  scene = clamp((scene - 0.5) * uContrast + 0.5, 0.0, 1.0);
  vec3 glow = sampleBlur(uTexture, vUv, 6.0) * 0.5;
  glow += sampleBlur(uTexture, vUv, 14.0) * 0.3;
  glow += sampleBlur(uTexture, vUv, 28.0) * 0.2;
  glow = max(glow - vec3(0.4), vec3(0.0)) * 2.5;
  vec3 goldTint = vec3(1.0, 0.88, 0.55);
  glow = glow * mix(vec3(1.0), goldTint, uWarmth);
  vec3 result = screenBlend(scene, glow * uBloom);
  float dist = length(vUv - 0.5) * 1.414;
  result *= 1.0 - smoothstep(0.5, 1.2, dist * uVignette * 1.5);
  result += vec3(0.04, 0.02, 0.0) * uWarmth * (1.0 - luma(result));
  gl_FragColor = vec4(clamp(result, 0.0, 1.0), base.a);
}`),
    params: [
      { key: 'uBloom', label: 'Bloom', min: 0, max: 1, step: 0.01, default: 0.6 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1.5, step: 0.05, default: 0.6 },
      { key: 'uVignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.4 },
      { key: 'uContrast', label: 'Contrast', min: 0.5, max: 2, step: 0.05, default: 1.1 },
    ],
  },

  {
    id: 'prismatic-holo',
    name: 'Prismatic Holo',
    description: 'Iridescent holographic shimmer with radial chromatic split.',
    animated: true,
    fragment: compose(`
vec3 hueShift(vec3 col, float h){
  float c = cos(h), s = sin(h);
  mat3 rot = mat3(
    0.299 + 0.701*c + 0.168*s, 0.587 - 0.587*c + 0.330*s, 0.114 - 0.114*c - 0.497*s,
    0.299 - 0.299*c - 0.328*s, 0.587 + 0.413*c + 0.035*s, 0.114 - 0.114*c + 0.292*s,
    0.299 - 0.300*c + 1.250*s, 0.587 - 0.588*c - 1.050*s, 0.114 + 0.886*c - 0.203*s
  );
  return clamp(rot * col, 0.0, 1.0);
}
void main(){
  vec2 centered = vUv - 0.5;
  float dist = length(centered);
  vec2 dir = normalize(centered + 0.0001);
  float strength = uIntensity * 0.025 * dist;
  vec2 uvR = vUv - dir * strength * 1.2;
  vec2 uvB = vUv + dir * strength * 0.8;
  float r = texture2D(uTexture, clamp(uvR, 0.001, 0.999)).r;
  float g = texture2D(uTexture, vUv).g;
  float b = texture2D(uTexture, clamp(uvB, 0.001, 0.999)).b;
  vec3 aberrated = vec3(r, g, b);
  float holoHue = 0.83 + dist * 2.2 + uTime * 0.25;
  vec3 iridescent = hueShift(vec3(0.82, 0.72, 0.38), holoHue);
  float rim = smoothstep(0.0, 0.5, dist);
  float shimmer = 0.5 + 0.5 * sin(dist * 18.0 - uTime * 2.0);
  vec3 result = screenBlend(aberrated, iridescent * rim * shimmer * uIntensity * 0.55);
  result = mix(result, result * vec3(1.03, 1.0, 0.90), uWarmth * 0.3);
  gl_FragColor = vec4(result, 1.0);
}`),
    params: [
      { key: 'uIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1, step: 0.05, default: 0.4 },
    ],
  },

  {
    id: 'aureate-god-rays',
    name: 'Aureate God Rays',
    description: 'Warm golden light shafts radiating through the scene.',
    animated: true,
    fragment: compose(`
void main(){
  vec4 base = texture2D(uTexture, vUv);
  vec2 lightPos = vec2(0.50 + sin(uTime * 0.12) * 0.04, 0.88 + cos(uTime * 0.09) * 0.02);
  vec2 delta = (vUv - lightPos);
  const int NUM_SAMPLES = 20;
  float density = 0.85;
  float weight = 0.015;
  float decay = 0.965;
  vec2 marchStep = delta * (density / float(NUM_SAMPLES));
  vec2 sUV = vUv;
  float illum = 1.0;
  vec3 rays = vec3(0.0);
  for (int i = 0; i < NUM_SAMPLES; i++) {
    sUV -= marchStep;
    vec3 s = texture2D(uTexture, clamp(sUV, 0.001, 0.999)).rgb;
    s = max(s - vec3(0.45), vec3(0.0)) * 2.2;
    rays += s * illum * weight;
    illum *= decay;
  }
  rays *= 0.9;
  vec3 goldRay = vec3(0.95, 0.80, 0.40);
  rays = rays * mix(vec3(1.0), goldRay, uWarmth);
  vec3 result = screenBlend(base.rgb, rays * uIntensity * uBloom * 1.5);
  gl_FragColor = vec4(result, base.a);
}`),
    params: [
      { key: 'uIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.6 },
      { key: 'uBloom', label: 'Rays', min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1, step: 0.05, default: 0.7 },
    ],
  },

  {
    id: 'velvet-film',
    name: 'Velvet Film',
    description: 'Cinematic film grain, warm grade and an oval vignette.',
    animated: true,
    fragment: compose(`
float filmGrain(vec2 uv, float t){
  float n = hash21(uv * vec2(1920.0, 1080.0) + vec2(t * 137.0, t * 59.0));
  n += hash21(uv * vec2(640.0, 480.0) - vec2(t * 83.0, t * 107.0));
  return (n - 1.0) * 0.5;
}
void main(){
  vec4 base = texture2D(uTexture, vUv);
  vec3 scene = base.rgb;
  scene = (scene - 0.5) * uContrast + 0.5;
  float lum = luma(scene);
  scene += vec3(0.05, 0.02, 0.0) * (1.0 - lum) * uWarmth;
  scene += vec3(0.02, 0.01, -0.01) * lum * uWarmth * 0.5;
  vec3 grey = vec3(luma(scene));
  scene = mix(grey, scene * vec3(1.06, 1.02, 0.93), 1.0 + uWarmth * 0.15);
  float grain = filmGrain(vUv, uTime);
  float lumMask = smoothstep(0.0, 0.3, lum) * (1.0 - smoothstep(0.7, 1.0, lum));
  scene += grain * uGrain * lumMask * 0.12;
  vec2 vigUV = (vUv - 0.5) * vec2(1.0, 1.3);
  float vig = 1.0 - smoothstep(0.45, 0.90, length(vigUV) * uVignette * 1.8);
  scene *= vig;
  scene += vec3(0.04, 0.02, 0.0) * (1.0 - vig) * uWarmth;
  gl_FragColor = vec4(clamp(scene, 0.0, 1.0), base.a);
}`),
    params: [
      { key: 'uGrain', label: 'Grain', min: 0, max: 1, step: 0.01, default: 0.35 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1, step: 0.05, default: 0.6 },
      { key: 'uContrast', label: 'Contrast', min: 0.5, max: 2, step: 0.05, default: 1.15 },
      { key: 'uVignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.55 },
    ],
  },

  {
    id: 'crystalline-kaleidoscope',
    name: 'Crystalline Kaleidoscope',
    description: 'Living jewel symmetry mirrored over the live image.',
    animated: true,
    fragment: compose(`
vec2 kaleido(vec2 uv, float segments){
  vec2 c = uv - 0.5;
  float r = length(c);
  float a = atan(c.y, c.x);
  float segAngle = 3.14159265 / segments;
  a = mod(a, segAngle * 2.0);
  if (a > segAngle) a = segAngle * 2.0 - a;
  return vec2(cos(a), sin(a)) * r + 0.5;
}
void main(){
  vec4 base = texture2D(uTexture, vUv);
  float angle = uTime * 0.05;
  float cosA = cos(angle), sinA = sin(angle);
  vec2 centered = vUv - 0.5;
  centered = vec2(cosA * centered.x - sinA * centered.y, sinA * centered.x + cosA * centered.y);
  vec2 rotUV = centered + 0.5;
  vec2 kUV = clamp(kaleido(rotUV, 8.0), 0.001, 0.999);
  vec4 kSample = texture2D(uTexture, kUV);
  vec3 result = mix(base.rgb, kSample.rgb, uIntensity * 0.65);
  result = screenBlend(result, kSample.rgb * uIntensity * 0.25);
  gl_FragColor = vec4(result, base.a);
}`),
    params: [{ key: 'uIntensity', label: 'Mirror', min: 0, max: 1, step: 0.01, default: 0.5 }],
  },

  {
    id: 'celestial-lens-flare',
    name: 'Celestial Lens Flare',
    description: 'Cinematic anamorphic lens flare with gold ghosts and starburst.',
    animated: true,
    fragment: compose(`
vec3 flareGhost(vec2 uv, vec2 src, float offset, float size, vec3 col){
  vec2 axis = vec2(0.5) - src;
  vec2 gPos = src + axis * offset;
  float d = length(uv - gPos);
  float ghost = smoothstep(size, 0.0, d);
  float ring = smoothstep(size * 0.3, size * 0.25, d) * smoothstep(size, size * 0.7, d) * 0.6;
  return (ghost + ring) * col;
}
vec3 anamorphicStreak(vec2 uv, vec2 src, float thickness, float len, vec3 col){
  float dy = abs(uv.y - src.y);
  float dx = abs(uv.x - src.x);
  float streak = smoothstep(thickness, 0.0, dy) * smoothstep(len, len * 0.3, dx);
  streak *= exp(-dx * 8.0);
  return streak * col;
}
float haloRing(vec2 uv, vec2 src, float radius, float width){
  float d = length(uv - src);
  return smoothstep(width, 0.0, abs(d - radius));
}
void main(){
  vec4 base = texture2D(uTexture, vUv);
  vec2 uv = vUv;
  vec2 src = vec2(0.78 + sin(uTime * 0.07) * 0.04, 0.82 + cos(uTime * 0.11) * 0.03);
  vec3 srcColor = texture2D(uTexture, clamp(src, 0.001, 0.999)).rgb;
  float gate = smoothstep(0.3, 0.7, luma(srcColor)) * uIntensity;
  vec3 goldA = vec3(0.831, 0.686, 0.216);
  vec3 goldB = vec3(0.950, 0.820, 0.500);
  vec3 ivory = vec3(1.000, 0.980, 0.940);
  vec3 flare = vec3(0.0);
  flare += flareGhost(uv, src, 0.35, 0.030, goldA * 0.9);
  flare += flareGhost(uv, src, 0.55, 0.018, goldB * 0.7);
  flare += flareGhost(uv, src, 0.75, 0.040, ivory * 0.5);
  flare += flareGhost(uv, src, 1.00, 0.022, goldA * 0.8);
  flare += flareGhost(uv, src, 1.30, 0.012, goldB * 0.6);
  float halo = haloRing(uv, src, 0.18, 0.010);
  float haloR = haloRing(uv, src, 0.182, 0.008);
  float haloB = haloRing(uv, src, 0.178, 0.008);
  flare += vec3(haloR, halo, haloB) * goldB * 0.5;
  flare += anamorphicStreak(uv, src, 0.002, 0.8, goldA * 1.2);
  float angle = atan(uv.y - src.y, uv.x - src.x);
  float starburst = pow(abs(sin(angle * 2.0 + uTime * 0.5)), 12.0);
  float sLen = smoothstep(0.25, 0.0, length(uv - src));
  flare += starburst * sLen * goldA * 0.7;
  flare = mix(flare, flare * vec3(1.1, 0.95, 0.7), uWarmth * 0.4);
  gl_FragColor = vec4(base.rgb + flare * gate, base.a);
}`),
    params: [
      { key: 'uIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.55 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1, step: 0.05, default: 0.6 },
    ],
  },

  {
    id: 'aurora-lumina',
    name: 'Aurora Lumina',
    description: 'Soft gold-and-ivory aurora curtains drifting over the frame.',
    animated: true,
    fragment: compose(`
float auroraWave(vec2 uv, float speed, float freq, float phase){
  float n1 = sin(uv.x * freq + uTime * speed + phase);
  float n2 = sin(uv.x * freq * 1.7 + uTime * speed * 0.7 + phase * 1.3);
  float n3 = sin(uv.x * freq * 0.4 + uTime * speed * 1.3 + phase * 0.7);
  return (n1 + n2 * 0.5 + n3 * 0.3) / 1.8;
}
void main(){
  vec4 base = texture2D(uTexture, vUv);
  vec2 uv = vUv;
  float heightMask = smoothstep(0.0, 0.55, uv.y) * (1.0 - smoothstep(0.75, 1.0, uv.y));
  heightMask *= (1.0 - smoothstep(0.35, 0.0, uv.y));
  vec3 aurora = vec3(0.0);
  float w1 = auroraWave(uv, 0.4, 4.0, 0.0);
  float band1 = smoothstep(0.0, 0.12, w1 * 0.5 + uv.y - 0.65) * (1.0 - smoothstep(0.12, 0.28, w1 * 0.5 + uv.y - 0.65));
  aurora += max(band1, 0.0) * vec3(0.9, 0.75, 0.3) * 1.2;
  float w2 = auroraWave(uv, 0.28, 5.5, 2.09);
  float band2 = smoothstep(0.0, 0.10, w2 * 0.4 + uv.y - 0.70) * (1.0 - smoothstep(0.10, 0.22, w2 * 0.4 + uv.y - 0.70));
  aurora += max(band2, 0.0) * vec3(0.99, 0.95, 0.87) * 0.8;
  float w3 = auroraWave(uv, 0.55, 3.0, 4.19);
  float band3 = smoothstep(0.0, 0.15, w3 * 0.6 + uv.y - 0.60) * (1.0 - smoothstep(0.15, 0.30, w3 * 0.6 + uv.y - 0.60));
  aurora += max(band3, 0.0) * vec3(1.0, 0.70, 0.25) * 0.6;
  aurora *= heightMask;
  aurora *= 0.7 + 0.3 * sin(uTime * 1.2 + uv.x * 3.0);
  float str = uIntensity * (0.5 + uBloom * 0.5);
  vec3 result = screenBlend(base.rgb, aurora * str);
  result = mix(result, result * vec3(1.04, 1.01, 0.91), uWarmth * 0.25);
  gl_FragColor = vec4(result, base.a);
}`),
    params: [
      { key: 'uIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1, step: 0.05, default: 0.7 },
      { key: 'uBloom', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.4 },
    ],
  },

  {
    id: 'golden-disintegration',
    name: 'Golden Disintegration',
    description: 'Magical dissolve into gold dust — used for the send-off.',
    animated: true,
    special: true,
    fragment: compose(`
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbmNoise(vec2 p){ return vnoise(p) * 0.65 + vnoise(p * 2.1 + vec2(1.7, 9.2)) * 0.35; }
float dustParticle(vec2 uv, vec2 center, float size){ return smoothstep(size, 0.0, length(uv - center)); }
void main(){
  vec2 uv = vUv;
  vec4 base = texture2D(uTexture, uv);
  float n = fbmNoise(uv * 6.0);
  n += vnoise(uv * 18.0 + vec2(uTime * 0.5)) * 0.15;
  n = clamp(n, 0.0, 1.0);
  n = mix(n, n * (1.0 - uv.y * 0.4), 0.5);
  float threshold = uFade;
  float edgeWidth = 0.08;
  float onEdge = smoothstep(threshold, threshold + edgeWidth, n) * (1.0 - smoothstep(threshold + edgeWidth, threshold + edgeWidth + 0.04, n));
  float emberBright = clamp(1.0 - (n - threshold) / edgeWidth, 0.0, 1.0);
  vec3 emberColor = mix(vec3(1.0, 0.60, 0.10), vec3(0.95, 0.82, 0.30), emberBright);
  vec3 ember = emberColor * onEdge * 2.5;
  vec3 dust = vec3(0.0);
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    vec2 seed = vec2(fi * 0.137, fi * 0.271);
    float spawnN = fbmNoise(seed * 3.0);
    if (spawnN < threshold) {
      vec2 origin = vec2(hash21(seed), hash21(seed + 0.5));
      float speed = 0.15 + hash21(seed + 1.0) * 0.25;
      float sway = sin(uTime * 1.2 + fi * 0.8) * 0.04;
      float life = clamp((threshold - spawnN) / 0.6, 0.0, 1.0);
      vec2 pos = fract(origin + vec2(sway, speed * life * uFade));
      float sz = 0.005 + hash21(seed + 2.0) * 0.008;
      float twinkle = 0.5 + 0.5 * sin(uTime * 3.0 + fi * 1.9);
      float alpha = dustParticle(uv, pos, sz) * (1.0 - life * 0.85) * twinkle;
      vec3 goldDust = mix(vec3(0.831, 0.686, 0.216), vec3(0.984, 0.953, 0.851), hash21(seed + 3.0));
      dust += goldDust * alpha * 1.8;
    }
  }
  float alive = step(threshold, n);
  vec3 result = base.rgb * alive + ember * uIntensity + dust * uIntensity;
  result = mix(result, result * vec3(1.06, 0.98, 0.80), uWarmth * 0.4);
  float compositeAlpha = mix(base.a, 0.0, smoothstep(0.85, 1.0, uFade));
  gl_FragColor = vec4(clamp(result, 0.0, 1.0), compositeAlpha);
}`),
    params: [
      { key: 'uFade', label: 'Dissolve', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'uIntensity', label: 'Intensity', min: 0, max: 1, step: 0.05, default: 1 },
      { key: 'uWarmth', label: 'Warmth', min: 0, max: 1, step: 0.05, default: 0.8 },
    ],
  },
];

export const SHADER_MAP: Record<string, ShaderDef> = Object.fromEntries(SHADERS.map((s) => [s.id, s]));

/** Effects offered as booth/studio filters (excludes 'none' and special effects). */
export const FILTER_SHADERS: ShaderDef[] = SHADERS.filter((s) => s.id !== 'none' && !s.special);

export function defaultParams(shaderId: string): Record<string, number> {
  const def = SHADER_MAP[shaderId];
  if (!def) return {};
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

const UNIFORM_NAMES = [
  'uIntensity', 'uWarmth', 'uContrast', 'uVignette', 'uGrain', 'uBloom', 'uSparkle', 'uFade',
] as const;

/**
 * Renders source frames through a shader to an internal canvas.
 * Reuse one instance for live preview; call draw() per frame.
 */
export class ShaderRunner {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private programs = new Map<string, WebGLProgram>();
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private start = performance.now();

  constructor(width = 1080, height = 1920) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl =
      (this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGLRenderingContext) ||
      (this.canvas.getContext('experimental-webgl') as WebGLRenderingContext) ||
      null;
    if (this.gl) this.init();
  }

  get available() {
    return !!this.gl;
  }

  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl?.viewport(0, 0, width, height);
  }

  private init() {
    const gl = this.gl!;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  private compile(def: ShaderDef): WebGLProgram | null {
    const gl = this.gl!;
    const cached = this.programs.get(def.id);
    if (cached) return cached;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERTEX);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, def.fragment);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error(`[shaders] ${def.id} compile error:`, gl.getShaderInfoLog(fs));
      return null;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(`[shaders] ${def.id} link error:`, gl.getProgramInfoLog(prog));
      return null;
    }
    this.programs.set(def.id, prog);
    return prog;
  }

  /**
   * Draw `source` through shader `shaderId`. Returns the runner canvas (or null
   * if WebGL is unavailable / source not ready). drawImage it onto your target.
   * `paramOverrides` lets callers animate uniforms (e.g. uFade for the dissolve).
   */
  draw(
    source: TexImageSource,
    shaderId: string,
    params: Record<string, number> = {},
    _legacyFlip?: boolean, // accepted for backward-compat; flipping is handled by callers
  ): HTMLCanvasElement | null {
    void _legacyFlip;
    const gl = this.gl;
    if (!gl) return null;
    const def = SHADER_MAP[shaderId] ?? SHADER_MAP['none'];
    const prog = this.compile(def);
    if (!prog) return null;

    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return null; // source not decodable yet
    }
    gl.uniform1i(gl.getUniformLocation(prog, 'uTexture'), 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), (performance.now() - this.start) / 1000);
    gl.uniform2f(gl.getUniformLocation(prog, 'uResolution'), this.canvas.width, this.canvas.height);

    const merged = { ...defaultParams(shaderId), ...params };
    for (const name of UNIFORM_NAMES) {
      const l = gl.getUniformLocation(prog, name);
      if (l) gl.uniform1f(l, merged[name] ?? 0);
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    this.programs.forEach((p) => gl.deleteProgram(p));
    this.programs.clear();
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.buffer) gl.deleteBuffer(this.buffer);
  }
}
