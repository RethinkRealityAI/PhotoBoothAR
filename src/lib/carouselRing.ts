/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ring geometry for the circular photo carousel.
 *
 * Adapted from the pmndrs/examples "cards" demo, which places cards around a
 * circle and spins the whole group. Everything that can be decided without a
 * GPU lives here so it can be unit-tested: placement, which slot faces the
 * viewer, how many photos the ring may hold, and — the part the live wall
 * depends on — projecting a card back to a screen rectangle.
 *
 * THE SCREEN-RECT PIECE IS WHY THIS FILE EXISTS. The wall's arrival ceremony
 * (ArrivalBeam) reassembles a guest's photo into the DOMRect of its
 * destination tile. A 3D card has no DOMRect, so the carousel has to hand back
 * the rectangle the card currently occupies on screen; the beam then lands on
 * a spinning 3D card with no change to the ceremony at all.
 */

/** Where a card sits, in the ring group's local space. */
export interface RingSlot {
  index: number;
  /** Radians around the ring; 0 = front (facing the camera). */
  angle: number;
  position: [number, number, number];
  /** Euler Y so the card's face points out of the ring, at the viewer. */
  rotationY: number;
}

export interface RingLayoutOptions {
  radius?: number;
  /** Lift each successive card slightly, so the ring reads as a helix rather
   *  than a flat band — the pmndrs demo staggers whole categories instead. */
  riseY?: number;
}

export const DEFAULT_RADIUS = 5.25;

/**
 * Place `count` cards evenly around the ring.
 *
 * Slot 0 sits at angle 0 = local +Z, which is the direction the camera looks
 * from, so slot 0 is the one facing the viewer at rest.
 *
 * `rotationY` equals the angle (NOT angle + π/2): a plane's default normal is
 * +Z, so rotating by the slot angle turns that normal into the outward radial
 * direction and the card faces away from the ring's centre. The pmndrs demo
 * adds π/2 because its cards are meant to be read as a rolodex seen from
 * above; ours are photographs the room has to be able to read head-on.
 */
export function ringLayout(count: number, opts: RingLayoutOptions = {}): RingSlot[] {
  const radius = opts.radius ?? DEFAULT_RADIUS;
  const riseY = opts.riseY ?? 0;
  if (count <= 0) return [];
  const slots: RingSlot[] = [];
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2;
    slots.push({
      index,
      angle,
      position: [Math.sin(angle) * radius, index * riseY, Math.cos(angle) * radius],
      rotationY: angle,
    });
  }
  return slots;
}

/**
 * Ring rotation that brings `index` to the front.
 *
 * Negated because rotating the GROUP by -angle carries the card AT that angle
 * round to the front.
 */
export function rotationForIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return -((index % count) / count) * Math.PI * 2;
}

/**
 * Shortest signed delta from `current` to `target` on a circle, in (-π, π].
 *
 * Spinning a ring by "just set the target" makes it take the long way round
 * whenever the shorter path crosses the 0/2π seam — visible as a full reverse
 * spin when the newest photo lands in slot 0 after the previous one.
 */
export function shortestAngleDelta(current: number, target: number): number {
  const twoPi = Math.PI * 2;
  let delta = (target - current) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta <= -Math.PI) delta += twoPi;
  return delta;
}

/**
 * How many photos the ring may show at once.
 *
 * A live wall accumulates hundreds of photos over a night; every card on the
 * ring is a GPU texture, so the ring shows a recent window rather than
 * everything. Below the minimum the ring reads as a gappy arc instead of a
 * circle, so a small event repeats what it has to keep the shape.
 */
export const RING_MAX_CARDS = 32;
export const RING_MIN_CARDS = 8;

/**
 * The most times one photo may appear on the ring.
 *
 * Repetition is what keeps a young event's ring a circle instead of an arc,
 * but it stops being a full ring and starts being a hall of mirrors: six
 * photos stretched around thirty slots is the SAME six photos five times, and
 * the room notices. Two copies reads as a full carousel; three does not.
 */
export const RING_MAX_REPEATS = 2;

/**
 * Choose the ring's contents from a newest-first list.
 *
 * `target` is how many SLOTS the ring wants — normally what
 * `ringSlotsForViewport` says will fill the screen. What comes back is
 * newest-first, never longer than the target or RING_MAX_CARDS, and padded by
 * repetition only up to RING_MAX_REPEATS copies of each photo: an event with
 * six photos gets a twelve-card ring rather than a thirty-card wall of the
 * same six faces. An empty input yields an empty ring; callers render their
 * own empty state rather than a circle of nothing.
 */
export function ringWindow<T>(items: readonly T[], target = RING_MAX_CARDS): T[] {
  if (items.length === 0) return [];
  const want = Math.min(Math.max(Math.round(target), RING_MIN_CARDS), RING_MAX_CARDS);
  const unique = items.slice(0, want);
  // The repeat cap applies ABOVE the minimum only. A three-photo event still
  // fills its small ring — an arc of three is not a carousel — but a
  // six-photo event stops at twelve rather than being stretched to thirty.
  const slots = Math.max(
    Math.min(want, RING_MIN_CARDS),
    Math.min(want, unique.length * RING_MAX_REPEATS),
  );
  if (unique.length >= slots) return unique.slice(0, slots);
  const out: T[] = [];
  while (out.length < slots) out.push(unique[out.length % unique.length]);
  return out;
}

/* ── Screen projection ─────────────────────────────────────────────── */

/** Viewport-space rectangle, matching wallArrivals' BeamRect. */
export interface ScreenRect { left: number; top: number; width: number; height: number }

/** A point already projected to normalized device coordinates (-1..1). */
export interface NdcPoint { x: number; y: number }

/**
 * Convert projected NDC corners into a viewport rectangle.
 *
 * Kept separate from the three.js projection itself so the arithmetic — the
 * part that silently produces an off-by-half-a-screen beam — is testable
 * without a renderer. `canvasRect` is the canvas's own position on the page,
 * because the wall's carousel does not fill the viewport (there is a header
 * above it) and the ceremony works in viewport coordinates.
 */
export function ndcBoundsToScreenRect(
  corners: readonly NdcPoint[],
  canvasRect: { left: number; top: number; width: number; height: number },
): ScreenRect | null {
  if (corners.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  // NDC: x -1..1 left→right, y -1..1 BOTTOM→top (screen y is inverted).
  const left = canvasRect.left + ((minX + 1) / 2) * canvasRect.width;
  const right = canvasRect.left + ((maxX + 1) / 2) * canvasRect.width;
  const top = canvasRect.top + ((1 - maxY) / 2) * canvasRect.height;
  const bottom = canvasRect.top + ((1 - minY) / 2) * canvasRect.height;
  const width = right - left;
  const height = bottom - top;
  // A card edge-on to the camera collapses to a sliver; the ceremony would
  // reassemble ~13k points into nothing. Callers treat null as "not landable".
  if (width < 8 || height < 8) return null;
  return { left, top, width, height };
}

/**
 * Is this slot facing the viewer closely enough to land a beam on?
 *
 * A card on the far side of the ring is behind the others and mostly back-on;
 * the ceremony should wait for (or rotate to) a card the room can actually
 * see. π/4 is a quarter turn either side of front.
 */
export function isFacingViewer(slotAngle: number, ringRotation: number, tolerance = Math.PI / 4): boolean {
  const effective = Math.atan2(
    Math.sin(slotAngle + ringRotation),
    Math.cos(slotAngle + ringRotation),
  );
  return Math.abs(effective) <= tolerance;
}

/**
 * How present a card should be, given where it has turned to.
 *
 * A ring of photographs rendered at flat opacity reads as clutter: the far
 * side shows through the gaps between the near cards and the eye has nothing
 * to settle on. Fading with depth turns the same geometry into a ring with a
 * FRONT — the cards you are meant to look at are solid, the ones behind them
 * recede — which is also what stops a back card from stealing attention from
 * a photo that has just arrived.
 *
 * Returns 1 dead ahead, `back` at dead behind, eased so the falloff happens
 * around the sides rather than linearly across the whole turn. The default
 * floor is 0: a card directly behind the ring's centre is not dimmed, it is
 * GONE, which is what stops the far side showing through the near gaps.
 */
export function depthPresence(slotAngle: number, ringRotation: number, back = 0): number {
  // 1 at the front, 0 at the back — cos of the angle off dead-ahead.
  const t = (Math.cos(slotAngle + ringRotation) + 1) / 2;
  const eased = t * t * (3 - 2 * t); // smoothstep: flat near front and back
  return back + (1 - back) * eased;
}

/**
 * How big a ring should be for the number of photos on it.
 *
 * A fixed radius is wrong at both ends: eight photos on a wide ring leave the
 * front of the carousel EMPTY half the time it turns (the gap between two
 * cards faces the room), and eighteen on the same ring collide. Deriving the
 * radius from the count keeps the SPACING constant instead, so the ring is
 * always about as full as it should be and simply grows as the night does.
 *
 * `gap` is the spacing in card widths: 1 would have cards touching edge to
 * edge, 1.25 leaves a sliver of room between them.
 */
export function ringRadiusForCount(count: number, cardWidth: number, gap = 1.25, min = 2.2): number {
  if (!Number.isFinite(count) || count <= 0) return min;
  return Math.max(min, (count * cardWidth * gap) / (Math.PI * 2));
}

/**
 * Where to stand so the card at the front is a given fraction of frame height.
 *
 * Returned as the distance to the FRONT of the ring, not to its centre — a
 * carousel that grows through the evening must not shrink the photo the room
 * is looking at, so the camera steps back as the radius grows (the caller adds
 * the radius). 0.45 of frame height reads as a hero without crowding out the
 * wall's own furniture.
 */
export function cameraDistanceForCard(cardHeight: number, fovDeg: number, fraction = 0.45): number {
  const safeFraction = Math.min(Math.max(fraction, 0.05), 1);
  const visibleHeight = cardHeight / safeFraction;
  return visibleHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/**
 * A colour three.js can actually parse, or the fallback.
 *
 * The ring's accent comes from the event theme, which lives in CSS custom
 * properties — and a CSS value is not a colour a renderer understands: handing
 * THREE.Color the literal string "var(--color-accent)" throws, and a host who
 * has set an `oklch()` accent would do the same. Only the notations three is
 * guaranteed to read are let through; anything else keeps the default rather
 * than taking down the wall over a floor glow.
 */
export function safeThreeColor(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v) || /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(v)) return v;
  return fallback;
}

/**
 * How much of the frame height the front card should fill, for a given canvas
 * aspect ratio.
 *
 * One number cannot serve both surfaces. A landscape wall wants the card at
 * about 45% so the cards either side of it stay in frame and the thing still
 * reads as a RING. A phone held upright has no room for neighbours anyway —
 * they crop at the edges whatever you do — so holding the hero at 45% there
 * just leaves a third of the screen empty above it.
 *
 * Interpolated rather than switched, so a tablet or a resized window moves
 * smoothly between the two instead of jumping at some threshold.
 */
export function cardHeightFraction(aspect: number, wide = 0.45, tall = 0.62): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return wide;
  const t = (Math.min(Math.max(aspect, 0.7), 1.3) - 0.7) / 0.6; // 0 at 0.7, 1 at 1.3
  return tall + (wide - tall) * t;
}

/**
 * How many cards it takes to fill the screen, at this canvas shape.
 *
 * The ring used to take its size from the photo COUNT alone, which meant a
 * fourteen-photo event drew a small ring in the middle of a wide wall with
 * dead space either side of it — the screen was paying for pixels it never
 * used. This inverts that: work out the radius whose ring spans `fill` of the
 * frame at the distance the hero card wants to be seen from, then say how many
 * cards go round it at the usual spacing.
 *
 * The default fill is deliberately just OVER 1 — the ring runs a little past
 * the edges of the frame. The cards out there are nearly edge-on slivers, so
 * cropping them costs nothing to look at and buys the screen two more cards
 * that can actually be seen.
 *
 * The camera stands at radius + `cameraDistanceForCard(...)`, so the radius
 * appears on both sides of the equation; solving it rather than iterating is
 * what keeps this a pure function the caller can use before anything renders.
 * A very wide canvas can ask for a ring wider than any distance would bound —
 * that falls out as a non-positive denominator, and the answer is simply the
 * maximum.
 */
export function ringSlotsForViewport(
  aspect: number,
  opts: {
    cardWidth: number;
    cardHeight: number;
    fovDeg: number;
    /** Fraction of frame WIDTH the ring should span. */
    fill?: number;
    /** Fraction of frame HEIGHT the front card should fill. */
    heroFraction?: number;
    gap?: number;
  },
): number {
  const { cardWidth, cardHeight, fovDeg } = opts;
  const fill = opts.fill ?? 1.02;
  const gap = opts.gap ?? 1.25;
  if (!Number.isFinite(aspect) || aspect <= 0 || cardWidth <= 0) return RING_MIN_CARDS;

  const k = Math.tan((fovDeg * Math.PI) / 360);
  const front = cameraDistanceForCard(cardHeight, fovDeg, opts.heroFraction);
  const spread = fill * k * aspect;
  const denom = 1 - spread;
  if (denom <= 0) return RING_MAX_CARDS;

  const radius = (spread * front) / denom;
  const slots = Math.floor((Math.PI * 2 * radius) / (cardWidth * gap));
  return Math.min(Math.max(slots, RING_MIN_CARDS), RING_MAX_CARDS);
}

/**
 * Where to aim the camera so the FRONT card sits centred in frame.
 *
 * The obvious aim — the middle of the ring — is wrong, and wrong by a lot. The
 * camera stands above the ring so the circle reads as a circle rather than a
 * row, which tilts the view axis down; and the front card is barely half as
 * far away as the point being aimed at, so the axis has not yet descended to
 * card height by the time it passes the card. The result is a hero photo
 * riding low with a band of empty floor above it — measured at ~10% of frame
 * height, which is what the wall's dead space at the top actually was.
 *
 * So aim at the height that puts the view axis through the front card's centre
 * AT THE FRONT CARD'S DEPTH. That is usually below the ring entirely, which
 * looks wrong written down and is right on screen.
 */
export function aimHeightForFrontCard(
  cameraHeight: number, ringLift: number, radius: number, frontDistance: number,
): number {
  if (!Number.isFinite(frontDistance) || frontDistance <= 0) return ringLift;
  const cameraZ = radius + frontDistance;
  return cameraHeight - (cameraHeight - ringLift) * (cameraZ / frontDistance);
}
