/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MULTI-FACE: which tracked face is the guest (the PRIMARY, slot 0) and which
 * extra faces ride slots 1..MAX_EXTRA_FACES — PURE (no DOM, no engine), so the
 * assignment rules are unit-tested in node. Plus the policy for how many faces
 * 8th Wall is asked to track.
 *
 * WHY a primary: every single-face API (the FaceSample, triggers, ears, mesh,
 * frame-lock, readout) keeps describing ONE face. With 8th Wall tracking up to
 * three, that face must be STABLE — the first face found stays primary for as
 * long as 8th Wall keeps tracking it. Only when it is lost is the NEAREST
 * remaining face promoted (the one most likely holding the phone), and the
 * engine flags that sample so the shared head filter snaps instead of gliding
 * from one person to the other.
 *
 * Extras keep their slot while tracked, so the hat on the left friend does not
 * swap to the right friend when somebody else enters the frame.
 */

/** 8th Wall's own ceiling (FaceController: maxDetections 1..3). */
export const MAX_TRACKED_FACES = 3;
export const MAX_EXTRA_FACES = MAX_TRACKED_FACES - 1;

/**
 * How many faces the platform asks 8th Wall for when nothing overrides it.
 * Chosen by measurement (headless, one face in frame, see the multi-face
 * commit message): the cost of asking for more faces is paid only while extra
 * faces are actually present.
 */
export const MULTI_FACE_DEFAULT = 3;

/** Tester switch `?faces=1|2|3` (this page load only). Grants nothing: every count is free. */
export const FACES_URL_PARAM = 'faces';

/** Untrusted input → a face count 1..3, or null when it is not one. */
export function parseMaxFaces(input: unknown): number | null {
  const n = typeof input === 'number' ? input : typeof input === 'string' && input.trim() !== '' ? Number(input) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_TRACKED_FACES ? n : null;
}

/** The `?faces=` override from a location.search string, or null. */
export function readMaxFacesOverride(search: string): number | null {
  try {
    return parseMaxFaces(new URLSearchParams(search).get(FACES_URL_PARAM));
  } catch {
    return null;
  }
}

/**
 * How many faces 8th Wall tracks. LEGACY is always 1 (those sites never run
 * 8th Wall, and must stay single-face byte-for-byte). Then the URL switch,
 * then a per-filter/per-event value (`config`, raw — none ships yet), then
 * MULTI_FACE_DEFAULT.
 */
export function resolveMaxFaces(inp: { legacy: boolean; url?: unknown; config?: unknown }): number {
  if (inp.legacy) return 1;
  return parseMaxFaces(inp.url) ?? parseMaxFaces(inp.config) ?? MULTI_FACE_DEFAULT;
}

export interface FaceSlotState {
  /** 8th Wall face id of the primary, or null when no face is tracked. */
  primary: number | null;
  /** extras[i] = face id riding slot i+1, or null when the slot is free. */
  extras: (number | null)[];
  /** Last known camera distance (cm, positive) per tracked id — the promotion tiebreak. */
  depth: Map<number, number>;
}

export function createFaceSlotState(extraSlots = MAX_EXTRA_FACES): FaceSlotState {
  const n = Math.max(0, Math.min(MAX_EXTRA_FACES, Math.floor(extraSlots)));
  return { primary: null, extras: new Array<number | null>(n).fill(null), depth: new Map() };
}

export function resetFaceSlots(s: FaceSlotState): void {
  s.primary = null;
  s.extras.fill(null);
  s.depth.clear();
}

/** 0 = primary, 1..n = extra slot, -1 = not tracked. */
export function slotOf(s: FaceSlotState, id: number): number {
  if (s.primary === id) return 0;
  const i = s.extras.indexOf(id);
  return i === -1 ? -1 : i + 1;
}

const depthOf = (s: FaceSlotState, id: number): number => {
  const d = s.depth.get(id);
  return d !== undefined && Number.isFinite(d) ? d : Infinity;
};

/** Faces 8th Wall reported lost. Promotes the nearest remaining extra when the primary goes. */
export function faceSlotsLost(s: FaceSlotState, ids: Iterable<number>): { primaryChanged: boolean } {
  let primaryLost = false;
  for (const id of ids) {
    s.depth.delete(id);
    if (s.primary === id) {
      s.primary = null;
      primaryLost = true;
    }
    const i = s.extras.indexOf(id);
    if (i !== -1) s.extras[i] = null;
  }
  if (!primaryLost) return { primaryChanged: false };
  let best = -1;
  for (let i = 0; i < s.extras.length; i++) {
    const id = s.extras[i];
    if (id === null) continue;
    if (best === -1 || depthOf(s, id) < depthOf(s, s.extras[best] as number)) best = i;
  }
  if (best !== -1) {
    s.primary = s.extras[best];
    s.extras[best] = null;
  }
  return { primaryChanged: true };
}

/**
 * Faces 8th Wall reported this tick (found or updated), with their camera
 * distance. Records depths, gives a primary-less state the nearest face, and
 * seats every other new face in the first free extra slot (nearest first).
 * A face that fits nowhere (more faces than slots) is ignored.
 */
export function faceSlotsObserve(
  s: FaceSlotState,
  faces: readonly { id: number; depthCm: number }[],
): { primaryChanged: boolean } {
  for (const f of faces) s.depth.set(f.id, f.depthCm);
  const fresh = faces
    .filter((f) => slotOf(s, f.id) === -1)
    .sort((a, b) => (Number.isFinite(a.depthCm) ? a.depthCm : Infinity) - (Number.isFinite(b.depthCm) ? b.depthCm : Infinity));
  let primaryChanged = false;
  for (const f of fresh) {
    if (slotOf(s, f.id) !== -1) continue; // duplicate id in one tick
    if (s.primary === null) {
      s.primary = f.id;
      primaryChanged = true;
      continue;
    }
    const free = s.extras.indexOf(null);
    if (free === -1) {
      s.depth.delete(f.id);
      continue;
    }
    s.extras[free] = f.id;
  }
  return { primaryChanged };
}
