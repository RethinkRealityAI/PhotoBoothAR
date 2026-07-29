/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE SHARED LIGHTING DEFINITION.
 *
 * Before this file, four 3D surfaces each hard-coded their own lights:
 *   booth/Overlay3D.tsx      ambient 1.2 + dir 1.8 + warm point 0.8
 *   studio/Studio3DView.tsx  ambient 0.6 + two directionals (orbit AND live)
 *   studio/Text3DBuilder.tsx a comment promising it copied the booth "VERBATIM"
 *   studio/DirectorCards.tsx a third, slightly different, two-directional rig
 * Nothing enforced that promise, so a gold crown tuned in one surface read as
 * mustard plastic in the next. This module is the single source; the surfaces
 * render `<SceneLighting preset={…} />` and hold no light values of their own.
 *
 * PURE DATA ONLY — no three.js, no React, no DOM. `SceneLighting.tsx` is the
 * (untestable, node-env-hostile) half that turns these numbers into elements.
 *
 * WHY LIGHTFORMERS AND NOT drei's `<Environment preset="studio">`:
 * drei 10.7.7 resolves a named preset to an .hdr fetched from
 * `https://raw.githack.com/pmndrs/drei-assets/…/hdri/`
 * (node_modules/@react-three/drei/core/useEnvironment.js:8). A real venue's wifi
 * — or an offline booth — would render every metal black while that 1–2 MB HDR
 * never arrives. `<Environment>` given CHILDREN instead takes drei's
 * EnvironmentPortal path, which renders the child emissive planes into a small
 * WebGLCubeRenderTarget exactly once (frames=1) and issues no network request at
 * all (Environment.js:185 -> EnvironmentPortal). three then PMREM-filters that
 * cube for `scene.environment`, so roughness still blurs correctly. The
 * environment is therefore generated locally, on the GPU, in one frame.
 */

/** Lighting rigs a surface can ask for. */
export type LightingPresetId =
  /** Byte-for-byte the pre-Wave-6 booth rig. Legacy coded events keep this. */
  | 'legacy'
  | 'studio'
  | 'goldenHour'
  | 'neon'
  | 'candlelit';

export type Vec3 = readonly [number, number, number];

export interface LightSpec {
  /** Hex string, `#rrggbb`. */
  color: string;
  intensity: number;
  position: Vec3;
}

/**
 * One emissive panel inside the generated environment. These never light the
 * scene directly — they are rendered into the environment cube, which is what
 * gives metal something to REFLECT (the thing 1 ambient + 2 directionals can
 * never do, however bright you make them).
 */
export interface LightformerSpec {
  form: 'rect' | 'circle' | 'ring';
  color: string;
  intensity: number;
  position: Vec3;
  /** Euler radians. Omitted = face the origin via drei's `target` default. */
  rotation?: Vec3;
  scale: readonly [number, number];
}

export interface EnvironmentSpec {
  /** Cube render-target edge in px. 64 is plenty for a blurry IBL and costs
   *  6 × 64² fragments ONCE, which a mid-range phone will not notice. */
  resolution: number;
  /** `scene.environmentIntensity` — how strongly the IBL contributes. */
  intensity: number;
  lightformers: readonly LightformerSpec[];
}

export interface ContactShadowSpec {
  opacity: number;
  blur: number;
  /** World units the shadow catcher spans. */
  scale: number;
  /** Distance the depth pass looks. */
  far: number;
  color: string;
  /** Y of the shadow plane, in the surface's own units. */
  y: number;
}

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  /** One line a host can actually choose between. */
  hint: string;
  ambient: { color: string; intensity: number };
  directionals: readonly LightSpec[];
  points: readonly LightSpec[];
  /** null ⇒ NO environment map at all (the legacy look, preserved exactly). */
  environment: EnvironmentSpec | null;
  /** null ⇒ no contact shadow. Only surfaces with a ground plane pass one on. */
  contactShadow: ContactShadowSpec | null;
  /** Renderer exposure. 1 = three's default, so `legacy` changes nothing. */
  exposure: number;
}

/**
 * The legacy rig, transcribed from booth/Overlay3D.tsx as it stood before this
 * wave (ambient 1.2, directional [2,4,3] 1.8, point [-2,2,2] 0.8 #E8C766) with
 * NO environment and NO contact shadow. Legacy coded events (hope-gala,
 * jenna-jake, detola-wuyi) render through this, so their saved photos are
 * unchanged — a lighting change is a change to the keepsake, and those three
 * events are frozen.
 */
const LEGACY: LightingPreset = {
  id: 'legacy',
  label: 'Classic',
  hint: 'The original booth lighting. No reflections.',
  ambient: { color: '#ffffff', intensity: 1.2 },
  directionals: [{ color: '#ffffff', intensity: 1.8, position: [2, 4, 3] }],
  points: [{ color: '#E8C766', intensity: 0.8, position: [-2, 2, 2] }],
  environment: null,
  contactShadow: null,
  exposure: 1,
};

/**
 * Every non-legacy preset drops the direct light HARD (ambient 1.2 -> ~0.2)
 * because the environment now carries the base illumination. Leaving the old
 * intensities on top of an IBL blows every highlight to white and destroys the
 * very metal the IBL was added to show.
 */
const STUDIO: LightingPreset = {
  id: 'studio',
  label: 'Studio',
  hint: 'Neutral softbox light. Metal reads as metal; good for anything.',
  ambient: { color: '#ffffff', intensity: 0.18 },
  directionals: [
    { color: '#FFF4E2', intensity: 1.1, position: [3, 5, 4] },
    { color: '#9FC0FF', intensity: 0.35, position: [-4, 2, -3] },
  ],
  points: [],
  environment: {
    resolution: 64,
    intensity: 1.15,
    lightformers: [
      // Big overhead key — the long soft highlight down a crown's band.
      { form: 'rect', color: '#ffffff', intensity: 4, position: [0, 5, 1], rotation: [-Math.PI / 2, 0, 0], scale: [8, 8] },
      // Cool fill from camera-left, so shadow sides are blue-grey not black.
      { form: 'rect', color: '#BFD6FF', intensity: 1.6, position: [-5, 1, 3], scale: [5, 5] },
      // Warm rim from behind — the bright edge that separates a prop from a face.
      { form: 'rect', color: '#FFDCA8', intensity: 2.4, position: [3, 2, -5], scale: [5, 5] },
      // A ring above gives round jewellery a circular catchlight.
      { form: 'ring', color: '#ffffff', intensity: 3, position: [0, 3, 4], scale: [3, 3] },
    ],
  },
  contactShadow: { opacity: 0.42, blur: 2.6, scale: 60, far: 30, color: '#000000', y: 0 },
  exposure: 1,
};

const GOLDEN_HOUR: LightingPreset = {
  id: 'goldenHour',
  label: 'Golden hour',
  hint: 'Warm low sun. Flatters gold, skin and champagne.',
  ambient: { color: '#FFE7C4', intensity: 0.16 },
  directionals: [
    { color: '#FFC978', intensity: 1.35, position: [5, 2, 3] },
    { color: '#7FA8FF', intensity: 0.28, position: [-4, 3, -3] },
  ],
  points: [],
  environment: {
    resolution: 64,
    intensity: 1.25,
    lightformers: [
      { form: 'rect', color: '#FFB65C', intensity: 5, position: [5, 1.5, 2], scale: [7, 4] },
      { form: 'rect', color: '#FFE9C9', intensity: 1.8, position: [0, 5, 0], rotation: [-Math.PI / 2, 0, 0], scale: [8, 8] },
      { form: 'rect', color: '#5B79C9', intensity: 1.1, position: [-5, 0, -3], scale: [6, 6] },
      { form: 'circle', color: '#FFD9A0', intensity: 3.2, position: [2, 0.5, 5], scale: [2.4, 2.4] },
    ],
  },
  contactShadow: { opacity: 0.5, blur: 3, scale: 60, far: 30, color: '#2A1405', y: 0 },
  exposure: 1.05,
};

const NEON: LightingPreset = {
  id: 'neon',
  label: 'Neon',
  hint: 'Magenta and cyan club light. Loud, high-contrast, party.',
  ambient: { color: '#2A1B3D', intensity: 0.14 },
  directionals: [
    { color: '#FF4FD8', intensity: 0.9, position: [4, 2, 3] },
    { color: '#38E8FF', intensity: 0.9, position: [-4, 2, 2] },
  ],
  points: [],
  environment: {
    resolution: 64,
    intensity: 1.4,
    lightformers: [
      { form: 'rect', color: '#FF3DCB', intensity: 6, position: [4, 1, 2], scale: [1.2, 7] },
      { form: 'rect', color: '#2FE6FF', intensity: 6, position: [-4, 1, 2], scale: [1.2, 7] },
      { form: 'rect', color: '#7C4DFF', intensity: 2.4, position: [0, 4, -3], rotation: [-Math.PI / 3, 0, 0], scale: [7, 4] },
      { form: 'ring', color: '#ffffff', intensity: 2, position: [0, 1, 5], scale: [2, 2] },
    ],
  },
  contactShadow: { opacity: 0.55, blur: 2, scale: 60, far: 30, color: '#12002B', y: 0 },
  exposure: 1.1,
};

const CANDLELIT: LightingPreset = {
  id: 'candlelit',
  label: 'Candlelit',
  hint: 'Low warm pools of light. Intimate dinners and evening receptions.',
  ambient: { color: '#3A2412', intensity: 0.2 },
  directionals: [{ color: '#FFB870', intensity: 0.55, position: [1, 2, 4] }],
  points: [{ color: '#FF9A3C', intensity: 1.6, position: [-1.5, 0.5, 2.5] }],
  environment: {
    resolution: 64,
    intensity: 1.0,
    lightformers: [
      { form: 'circle', color: '#FFA845', intensity: 7, position: [-2, 0.2, 3], scale: [1.4, 1.4] },
      { form: 'circle', color: '#FFC98A', intensity: 4, position: [2.5, 1, 2], scale: [1, 1] },
      { form: 'rect', color: '#2B1A3A', intensity: 1.2, position: [0, 4, -3], scale: [7, 5] },
    ],
  },
  contactShadow: { opacity: 0.6, blur: 3.4, scale: 60, far: 30, color: '#180B02', y: 0 },
  exposure: 1.15,
};

export const LIGHTING_PRESETS: readonly LightingPreset[] = [LEGACY, STUDIO, GOLDEN_HOUR, NEON, CANDLELIT];

export const LIGHTING_MAP: Record<LightingPresetId, LightingPreset> = Object.fromEntries(
  LIGHTING_PRESETS.map((p) => [p.id, p]),
) as Record<LightingPresetId, LightingPreset>;

/** What a host may CHOOSE. `legacy` is a compatibility mode, never an option:
 *  offering "Classic" as a pick would let a platform host opt into worse
 *  rendering by accident, and it exists only so frozen events do not change. */
export const HOST_LIGHTING_PRESETS: readonly LightingPreset[] = LIGHTING_PRESETS.filter((p) => p.id !== 'legacy');

export const DEFAULT_LIGHTING: LightingPresetId = 'studio';

export const LIGHTING_IDS: readonly LightingPresetId[] = LIGHTING_PRESETS.map((p) => p.id);

/** Narrow any stored/user value to a real preset id. Unknown -> `fallback`. */
export function normalizeLightingPreset(
  raw: unknown,
  fallback: LightingPresetId = DEFAULT_LIGHTING,
): LightingPresetId {
  return typeof raw === 'string' && (LIGHTING_IDS as readonly string[]).includes(raw)
    ? (raw as LightingPresetId)
    : fallback;
}

export function lightingFor(id: LightingPresetId): LightingPreset {
  return LIGHTING_MAP[id] ?? LIGHTING_MAP.studio;
}

/**
 * The booth's rig for an event.
 *
 * THE LEGACY GATE. `source` is EventProvider's origin for this event: 'db' =
 * a platform event a host authored in the studio, anything else = one of the
 * three frozen coded events. Only 'db' events get the new lighting, because the
 * booth's 3D canvas is composited straight into the saved 1080x1920 photo — new
 * lighting means different keepsakes, and hope-gala / jenna-jake / detola-wuyi
 * shipped with the old ones.
 */
export function boothLightingFor(source: string | undefined, configured: unknown): LightingPresetId {
  if (source !== 'db') return 'legacy';
  return normalizeLightingPreset(configured);
}
