/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SpectrumField — generative WebGL background for the platform's black
 * "beam wall" theme: a true-black field with soft vertical light beams in a
 * multi-hue spectrum, a faint drifting nebula wash, twinkling sparkle points
 * and a glowing horizon line — like standing in a dark hall in front of the
 * wall itself.
 *
 * Raw WebGL1 / GLSL ES 1.00 fullscreen-triangle shader (no Three.js/R3F),
 * matching the technique already used for the booth's procedural filters in
 * src/lib/shaders.ts (aurora-lumina's wave bands, champagne-sparkle's
 * twinkle points) — generalized here to a fixed multi-color palette instead
 * of a single event accent, since this is the platform's own identity, not
 * a per-event theme.
 *
 * The shader renders the ENTIRE background (opaque, starting from pure
 * void-black) so the look is deterministic — it never depends on what CSS
 * gradient happens to sit underneath. If WebGL is unavailable it renders
 * nothing and the solid `bg-brand-bg` behind it stays. With
 * prefers-reduced-motion it freezes on a single static frame.
 */
import { useEffect, useRef } from 'react';

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  return vnoise(p) * 0.6 + vnoise(p * 2.3 + vec2(1.7, 9.2)) * 0.28 + vnoise(p * 4.9 + vec2(8.3, 2.8)) * 0.12;
}

vec3 beamColor(int i){
  if (i == 0) return vec3(0.357, 0.549, 1.000); /* blue    #5B8CFF */
  if (i == 1) return vec3(0.133, 0.827, 0.933); /* teal    #22D3EE */
  if (i == 2) return vec3(0.984, 0.573, 0.235); /* orange  #FB923C */
  if (i == 3) return vec3(0.204, 0.827, 0.600); /* green   #34D399 */
  if (i == 4) return vec3(0.910, 0.475, 0.980); /* magenta #E879F9 */
  if (i == 5) return vec3(0.486, 0.427, 0.933); /* violet  #7C6CF7 */
  return vec3(0.220, 0.741, 0.973);             /* cyan    #38BDF8 */
}

void main(){
  vec2 uv = vUv;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);

  /* true void-black base with the faintest cool lift at the top */
  vec3 col = vec3(0.016, 0.02, 0.038) * (1.0 - uv.y * 0.55);

  /* slow drifting nebula wash — barely-there color depth between the beams */
  float neb = fbm(uv * vec2(2.2, 1.5) + vec2(uTime * 0.012, -uTime * 0.008));
  vec3 nebTint = mix(vec3(0.10, 0.16, 0.42), vec3(0.30, 0.14, 0.44), uv.x);
  col += nebTint * smoothstep(0.5, 0.98, neb) * 0.055;

  /* Soft vertical beams, gently drifting side to side. Beam width is a
     fraction of SCREEN WIDTH (not height) so portrait phones don't smear
     all seven into one wash — and narrow screens keep only four beams. */
  bool narrow = aspect.x < 0.75;
  float slots = narrow ? 4.0 : 7.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    if (narrow && (i == 2 || i == 4 || i == 6)) continue;
    float slot = narrow ? (fi == 0.0 ? 0.0 : (fi == 1.0 ? 1.0 : (fi == 3.0 ? 2.0 : 3.0))) : fi;
    float baseX = (slot + 0.5) / slots;
    float drift = sin(uTime * (0.05 + 0.015 * fi) + fi * 2.1) * 0.045;
    float d = abs(uv.x - (baseX + drift));
    /* tight bright core + restrained halo keeps blacks black */
    float beam = exp(-d * d * 950.0) * 0.5 + exp(-d * d * 210.0) * 0.10;
    float flicker = 0.7 + 0.3 * sin(uTime * (0.5 + 0.2 * fi) + fi * 5.0 + uv.y * 3.0);
    /* beams rise from the horizon and dissolve upward */
    float heightFade = smoothstep(0.05, 0.42, 1.0 - uv.y) * smoothstep(1.0, 0.55, 1.0 - uv.y) +
                       smoothstep(0.0, 0.55, 1.0 - uv.y) * 0.18;
    col += beamColor(i) * beam * flicker * heightFade;
  }

  /* glowing horizon line near the base — the "wall floor" */
  float horizonY = 0.86;
  float hd = abs(uv.y - horizonY);
  vec3 horizonTint = mix(beamColor(0), beamColor(5), uv.x) * 0.55 + vec3(0.12);
  col += horizonTint * exp(-hd * hd * 900.0) * 0.16;
  col += horizonTint * exp(-hd * hd * 90.0) * 0.05;

  /* twinkling sparkle points scattered across the upper field */
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    vec2 cell = vec2(mod(fi, 6.0), floor(fi / 6.0)) / vec2(6.0, 4.0);
    vec2 jitter = vec2(hash21(cell + 0.1), hash21(cell + 0.7));
    vec2 center = (cell + jitter * 0.9) * vec2(aspect.x, 0.8);
    float sz = 0.0022 + hash21(cell + 1.3) * 0.0035;
    float speed = 0.5 + hash21(cell + 2.1) * 1.4;
    float phase = uTime * speed + hash21(cell + 3.7) * 6.28318;
    float d = length(uv * aspect - center);
    float tw = smoothstep(sz, 0.0, d) * (0.5 + 0.5 * sin(phase));
    int hi = int(mod(fi, 7.0));
    col += tw * beamColor(hi) * 0.8;
  }

  /* vignette keeps edges and the reading column properly black */
  float vin = smoothstep(1.15, 0.4, length((uv - 0.5) * vec2(aspect.x * 0.8, 1.15)));
  col *= mix(0.42, 1.0, vin);

  gl_FragColor = vec4(col, 1.0);
}`;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function SpectrumField({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl =
      (canvas.getContext('webgl', { premultipliedAlpha: false }) as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return; // no WebGL — the solid bg-brand-bg behind this stays visible

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERTEX);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FRAGMENT);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('[SpectrumField] shader compile error:', gl.getShaderInfoLog(fs));
      return;
    }
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[SpectrumField] program link error:', gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'uTime');
    const uResolution = gl.getUniformLocation(program, 'uResolution');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      const w = Math.max(1, Math.round(clientWidth * dpr));
      const h = Math.max(1, Math.round(clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const start = performance.now();
    const reduced = prefersReducedMotion();
    let raf = 0;
    const draw = (t: number) => {
      gl.uniform1f(uTime, reduced ? 0 : (t - start) / 1000);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
