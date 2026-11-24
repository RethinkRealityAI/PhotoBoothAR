/**
 * World mode, part 2: where the frame stands and how fingers move it.
 *
 * The floor is the plane y = 0 and the phone is held CAMERA_HEIGHT_M above
 * it. With only the phone's rotation known (no SLAM), the point the camera
 * aims at on the floor is still exact for a phone held at that height: the
 * same ray that hits the floor in 3D passes through the same pixel in the
 * picture, so the frame's feet land where the reticle is drawn.
 *
 * Pure (numbers in, numbers out) so it is unit-tested in node.
 */

/** Typical height of a phone held to take a photo of someone, in metres. */
export const CAMERA_HEIGHT_M = 1.4;
/** The standing frame's default height: a tall adult fits inside it. */
export const STANDEE_HEIGHT_M = 2;
/** Closest and furthest a frame can be placed, in metres along the floor. */
export const MIN_PLACE_M = 0.8;
export const MAX_PLACE_M = 8;
/** Pinch range, as multiples of the default size (1 m to 4 m tall). */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;

export interface Vec3 { x: number; y: number; z: number }

/**
 * Where a ray from `origin` along `dir` meets the floor (y = 0), or null when it
 * points at or above the horizon, or the hit is closer than `min` / further
 * than `max` metres along the floor (a frame at your own feet is no use).
 */
export function floorHit(origin: Vec3, dir: Vec3, min = MIN_PLACE_M, max = MAX_PLACE_M): Vec3 | null {
  if (!(dir.y < -1e-4) || origin.y <= 0) return null;
  const k = -origin.y / dir.y;
  const dist = k * Math.hypot(dir.x, dir.z);
  if (dist < min || dist > max) return null;
  return { x: origin.x + dir.x * k, y: 0, z: origin.z + dir.z * k };
}

/** Default stand-off when the phone aims too high or too far: about where a
 *  friend stands to shoot a group, in metres along the floor. */
export const DEFAULT_PLACE_M = 2.6;
/** Aimed further than this, the frame comes back to DEFAULT_PLACE_M. */
export const COMFORT_MAX_M = 5;

/**
 * The spot the reticle shows: where the aim ray meets the floor, or — when the
 * phone points at the horizon or further than COMFORT_MAX_M — DEFAULT_PLACE_M
 * ahead along the floor in the direction the phone faces. Null only when the
 * phone points straight up or down (no heading) or the hit is too close.
 */
export function placementSpot(origin: Vec3, dir: Vec3): Vec3 | null {
  const hit = floorHit(origin, dir, MIN_PLACE_M, COMFORT_MAX_M);
  if (hit) return hit;
  const flat = Math.hypot(dir.x, dir.z);
  if (flat < 0.05) return null;
  // Aimed down but too close (at your feet): no spot, the hint says to aim further.
  if (dir.y < 0 && origin.y > 0 && (-origin.y / dir.y) * flat < MIN_PLACE_M) return null;
  return { x: origin.x + (dir.x / flat) * DEFAULT_PLACE_M, y: 0, z: origin.z + (dir.z / flat) * DEFAULT_PLACE_M };
}

/** Yaw (radians about +Y) that turns an object at `obj` to face a viewer at `cam`. */
export function yawToFace(cam: Vec3, obj: Vec3): number {
  return Math.atan2(cam.x - obj.x, cam.z - obj.z);
}

/** Frame size in metres for a picture of `pxW` × `pxH`, standing STANDEE_HEIGHT_M tall. */
export function standeeSize(pxW: number, pxH: number, height = STANDEE_HEIGHT_M): { w: number; h: number } {
  const aspect = pxW > 0 && pxH > 0 ? pxW / pxH : 9 / 16;
  return { w: height * aspect, h: height };
}

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/* ------------------------------------------------------------------ */
/* Gestures                                                           */
/* ------------------------------------------------------------------ */

export interface Pointer { x: number; y: number }

/** What the fingers are doing to the frame. scale × the default size; yaw added to "faces you". */
export interface GestureState {
  scale: number;
  yaw: number;
  pts: Map<number, Pointer>;
  /** Baseline when two fingers are down. */
  two: { d: number; a: number; s: number; r: number } | null;
  /** Baseline when one finger is down. */
  one: { x: number; y: number; r: number; t: number; moved: boolean } | null;
}

export function createGesture(scale = 1, yaw = 0): GestureState {
  return { scale, yaw, pts: new Map(), two: null, one: null };
}

function rebase(g: GestureState, now: number): void {
  g.one = null;
  g.two = null;
  if (g.pts.size === 2) {
    const [a, b] = [...g.pts.values()];
    g.two = { d: Math.max(20, Math.hypot(b.x - a.x, b.y - a.y)), a: Math.atan2(b.y - a.y, b.x - a.x), s: g.scale, r: g.yaw };
  } else if (g.pts.size === 1) {
    const [p] = [...g.pts.values()];
    // A second finger lifting leaves one down: that is never the start of a tap.
    g.one = { x: p.x, y: p.y, r: g.yaw, t: now, moved: true };
  }
}

export function gestureDown(g: GestureState, id: number, p: Pointer, now: number): void {
  const wasEmpty = g.pts.size === 0;
  g.pts.set(id, p);
  rebase(g, now);
  if (wasEmpty && g.one) g.one.moved = false; // a fresh single finger may become a tap
}

/** `viewW` = the stage width in CSS px: one full-width drag turns the frame once around. */
export function gestureMove(g: GestureState, id: number, p: Pointer, viewW: number): void {
  if (!g.pts.has(id)) return;
  g.pts.set(id, p);
  if (g.two && g.pts.size === 2) {
    const [a, b] = [...g.pts.values()];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    g.scale = clampScale(g.two.s * (d / g.two.d));
    // A clockwise twist on screen turns the frame clockwise seen from above.
    g.yaw = g.two.r - wrapAngle(Math.atan2(b.y - a.y, b.x - a.x) - g.two.a);
  } else if (g.one && g.pts.size === 1) {
    if (Math.hypot(p.x - g.one.x, p.y - g.one.y) > TAP_SLOP_PX) g.one.moved = true;
    if (g.one.moved) g.yaw = g.one.r + ((p.x - g.one.x) / Math.max(320, viewW)) * Math.PI * 2;
  }
}

export const TAP_SLOP_PX = 14;
export const TAP_MAX_MS = 500;

/** Returns true when this lift completes a TAP (one finger, barely moved, quick). */
export function gestureUp(g: GestureState, id: number, now: number): boolean {
  if (!g.pts.has(id)) return false;
  const one = g.one;
  const tap = g.pts.size === 1 && one !== null && !one.moved && now - one.t <= TAP_MAX_MS;
  g.pts.delete(id);
  rebase(g, now);
  return tap;
}
