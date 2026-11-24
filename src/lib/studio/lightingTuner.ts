/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tester-only LIVE TUNING of the shared 3D lighting (lighting.ts).
 *
 * The booth's tuning panel (components/booth/LightingTuner.tsx, shown only
 * with `?lightdebug` or the tracking readout) writes a `LightingTune` here;
 * SceneLighting reads it and applies it on top of whatever preset the surface
 * asked for. Every value is a MULTIPLIER (1 = the preset unchanged), except
 * `warmth` (-1 cool … 0 as authored … +1 warm), so one set of values tunes any
 * preset the same way and "Copy values" hands back numbers that can be baked
 * into the preset.
 *
 * Never applies to the 'legacy' rig (frozen events), and the default tune is
 * the identity, so a guest who never opens the panel renders byte-identically.
 * Kept per TAB in sessionStorage so a reload keeps the tester's values.
 *
 * PURE except the tiny store at the bottom (no three.js, no React).
 */
import type { LightingPreset } from './lighting';

export interface LightingTune {
  /** Renderer exposure multiplier. */
  exposure: number;
  /** Environment (reflection / image-based light) multiplier. */
  reflections: number;
  /** Ambient light multiplier. */
  ambient: number;
  /** First directional ("key") multiplier. */
  key: number;
  /** Every other directional + point light ("fill") multiplier. */
  fill: number;
  /** -1 cool … 0 as authored … +1 warm, applied to the key light's colour. */
  warmth: number;
}

export const DEFAULT_TUNE: LightingTune = Object.freeze({
  exposure: 1,
  reflections: 1,
  ambient: 1,
  key: 1,
  fill: 1,
  warmth: 0,
}) as LightingTune;

export const TUNE_KEYS = ['exposure', 'reflections', 'ambient', 'key', 'fill', 'warmth'] as const;

export const TUNE_BOUNDS: Record<keyof LightingTune, { min: number; max: number }> = {
  exposure: { min: 0.2, max: 2 },
  reflections: { min: 0, max: 2 },
  ambient: { min: 0, max: 3 },
  key: { min: 0, max: 2 },
  fill: { min: 0, max: 2 },
  warmth: { min: -1, max: 1 },
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Clamp every field into bounds; anything missing or non-numeric = default. */
export function normalizeTune(raw: unknown): LightingTune {
  const o = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_TUNE };
  for (const k of TUNE_KEYS) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const b = TUNE_BOUNDS[k];
      out[k] = round(Math.min(b.max, Math.max(b.min, v)));
    }
  }
  return out;
}

export function isDefaultTune(t: LightingTune): boolean {
  return TUNE_KEYS.every((k) => t[k] === DEFAULT_TUNE[k]);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

const WARM: [number, number, number] = [255, 196, 130];
const COOL: [number, number, number] = [190, 214, 255];

/** Blend a light colour toward warm (+) or cool (−) by |warmth|. */
export function warmColor(hex: string, warmth: number): string {
  if (warmth === 0) return hex;
  const base = hexToRgb(hex);
  const target = warmth > 0 ? WARM : COOL;
  const t = Math.min(1, Math.abs(warmth));
  return rgbToHex([0, 1, 2].map((i) => base[i] + (target[i] - base[i]) * t) as [number, number, number]);
}

/**
 * The preset with the tune applied. Returns the SAME object for the identity
 * tune or the legacy rig, so an untouched booth is unchanged by construction.
 */
export function applyTune(p: LightingPreset, t: LightingTune): LightingPreset {
  if (p.id === 'legacy' || isDefaultTune(t)) return p;
  return {
    ...p,
    exposure: p.exposure * t.exposure,
    ambient: { ...p.ambient, intensity: p.ambient.intensity * t.ambient },
    directionals: p.directionals.map((d, i) =>
      i === 0
        ? { ...d, intensity: d.intensity * t.key, color: warmColor(d.color, t.warmth) }
        : { ...d, intensity: d.intensity * t.fill },
    ),
    points: p.points.map((l) => ({ ...l, intensity: l.intensity * t.fill })),
    environment: p.environment ? { ...p.environment, intensity: p.environment.intensity * t.reflections } : null,
  };
}

/** What "Copy values" puts on the clipboard. */
export function formatTune(t: LightingTune, presetId: string): string {
  return JSON.stringify({ preset: presetId, ...t });
}

/* ── Store ─────────────────────────────────────────────────────────────────── */

export const TUNE_SESSION_KEY = 'pbar.lightTune';

let current: LightingTune = DEFAULT_TUNE;
let loaded = false;
const listeners = new Set<() => void>();

function session(): Storage | null {
  try { return typeof window !== 'undefined' ? window.sessionStorage : null; } catch { return null; }
}

export function getLightingTune(): LightingTune {
  if (!loaded) {
    loaded = true;
    try {
      const raw = session()?.getItem(TUNE_SESSION_KEY);
      if (raw) current = normalizeTune(JSON.parse(raw));
    } catch { current = DEFAULT_TUNE; }
  }
  return current;
}

export function setLightingTune(next: Partial<LightingTune>): void {
  current = normalizeTune({ ...getLightingTune(), ...next });
  try {
    const s = session();
    if (isDefaultTune(current)) s?.removeItem(TUNE_SESSION_KEY);
    else s?.setItem(TUNE_SESSION_KEY, JSON.stringify(current));
  } catch { /* storage blocked: the tune still applies for this page */ }
  listeners.forEach((l) => l());
}

export function subscribeLightingTune(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
