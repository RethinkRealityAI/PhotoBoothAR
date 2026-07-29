/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallArrivals — pure choreography for new posts landing on the live wall.
 *
 * The wall used to fire one ~1.6 s beam per insert and overwrite the "feature
 * this next" id every time, so a ten-photo dinner rush produced sixteen
 * seconds of back-to-back beams and spotlighted only the last guest. The
 * queue below fixes both by deciding, at the moment the stage frees up, what
 * the room should actually see:
 *
 *   • exactly one arrival waiting  → a SOLO ceremony: that guest's real photo
 *     dissolves in and reassembles into its own tile.
 *   • two or more waiting          → a BURST ceremony: every waiting arrival is
 *     consumed at once and presented as a single "N moments just landed"
 *     multi-photo landing.
 *
 * The threshold is deliberately rate-derived rather than a magic number: more
 * than one arrival waiting when the stage frees means posts are landing faster
 * than one ceremony's duration (~2.6 s, i.e. faster than ~23/min). Below that
 * rate every single guest still gets their own beam, which is the whole point
 * of the feature; above it the wall stops being a beam screensaver.
 *
 * Pure and synchronous: no timers, no DOM. The component owns the clock and
 * calls startNextCeremony / finishCeremony.
 */

/** One post's worth of what a ceremony needs to draw. */
export interface WallArrival {
  id: string;
  guestName: string | null;
  /** Full-size media URL (the ceremony picks its own render size). */
  imageUrl: string;
  mediaType: 'image' | 'video';
}

export type CeremonyKind = 'solo' | 'burst';

export interface Ceremony {
  /** Stable React key — never reused, so AnimatePresence always remounts. */
  key: string;
  kind: CeremonyKind;
  /** Oldest first. 1 entry for 'solo', 2..BURST_MAX for 'burst'. */
  arrivals: WallArrival[];
  /** Arrivals this ceremony stands for but does not draw (backlog + evicted). */
  overflow: number;
  durationMs: number;
}

export interface ArrivalQueueState {
  /** Waiting arrivals, oldest first. */
  pending: WallArrival[];
  /** The ceremony currently on screen, or null when the stage is free. */
  playing: Ceremony | null;
  /** Arrivals evicted by the cap since the last ceremony started. */
  dropped: number;
  /** Monotonic ceremony counter — feeds `key`. */
  seq: number;
}

/** Hard ceiling on waiting arrivals. A wall that has fallen this far behind is
 *  better off summarising than replaying: the photos are already in the grid,
 *  and an unbounded array on a 6-hour projector is a leak. */
export const MAX_PENDING = 24;

/** Most photos one burst ceremony draws. Beyond this they become `overflow`. */
export const BURST_MAX = 6;

/** Solo ceremony length — the particle dissolve + reassembly + toast. */
export const SOLO_MS = 2600;
/** Burst: a little longer per extra photo, but never a slideshow. */
export const BURST_BASE_MS = 2600;
export const BURST_PER_EXTRA_MS = 240;
export const BURST_MAX_MS = 4200;

/**
 * Grace period between an arrival landing and its ceremony starting.
 *
 * Realtime delivers each INSERT in its own task, so without a short wait the
 * very first of a rush would always start a solo ceremony and the coalescing
 * rule could never fire. Long enough to gather a simultaneous batch, short
 * enough that a lone guest still sees their photo fly almost immediately.
 */
export const COALESCE_GRACE_MS = 350;

export function emptyArrivalQueue(): ArrivalQueueState {
  return { pending: [], playing: null, dropped: 0, seq: 0 };
}

/** How long a ceremony showing `count` photos should stay up. */
export function ceremonyDurationMs(count: number): number {
  if (count <= 1) return SOLO_MS;
  const extra = Math.min(count, BURST_MAX) - 1;
  return Math.min(BURST_BASE_MS + extra * BURST_PER_EXTRA_MS, BURST_MAX_MS);
}

/**
 * Add an arrival. Ignores ids already waiting or already on screen — realtime
 * re-delivers, and the wall also routes a newly-approved UPDATE through the
 * same insert path, so duplicates are normal rather than exceptional.
 *
 * At MAX_PENDING the OLDEST waiting arrival is evicted (and counted in
 * `dropped`): the newest moment is the one the room is still reacting to, and
 * the evicted photo is already visible in the grid either way.
 */
export function enqueueArrival(
  state: ArrivalQueueState,
  arrival: WallArrival,
): ArrivalQueueState {
  const known = state.pending.some((a) => a.id === arrival.id)
    || (state.playing?.arrivals.some((a) => a.id === arrival.id) ?? false);
  if (known) return state;

  const pending = [...state.pending, arrival];
  let dropped = state.dropped;
  while (pending.length > MAX_PENDING) {
    pending.shift();
    dropped += 1;
  }
  return { ...state, pending, dropped };
}

/**
 * Promote the waiting arrivals into the ceremony that should play now.
 * No-op while a ceremony is on screen or nothing is waiting.
 *
 * A burst consumes the ENTIRE pending list rather than the first BURST_MAX of
 * it. Draining six at a time would just queue the next burst behind it and
 * reproduce the original "nothing but beams" failure one step removed; the
 * backlog is reported as `overflow` instead.
 */
export function startNextCeremony(state: ArrivalQueueState): ArrivalQueueState {
  if (state.playing !== null) return state;
  if (state.pending.length === 0) return state;

  const all = state.pending;
  const kind: CeremonyKind = all.length === 1 ? 'solo' : 'burst';
  // Newest photos are the ones worth drawing; order within the ceremony stays
  // oldest-first so captions read in the order guests actually posted.
  const shown = all.length <= BURST_MAX ? all : all.slice(all.length - BURST_MAX);
  const overflow = all.length - shown.length + state.dropped;

  return {
    pending: [],
    dropped: 0,
    seq: state.seq + 1,
    playing: {
      key: `ceremony-${state.seq + 1}-${shown[0].id}`,
      kind,
      arrivals: shown,
      overflow,
      durationMs: ceremonyDurationMs(shown.length),
    },
  };
}

/** Clear the stage. Safe to call when nothing is playing. */
export function finishCeremony(state: ArrivalQueueState): ArrivalQueueState {
  if (state.playing === null) return state;
  return { ...state, playing: null };
}

/**
 * Which post the Featured Spotlight should pick up after this ceremony.
 * The old code overwrote a single id on every insert, so nine of ten guests in
 * a rush were silently skipped; the ceremony's newest photo is the one the
 * room just watched land, so it is the honest hand-off.
 */
export function spotlightIdFor(ceremony: Ceremony | null): string | null {
  if (ceremony === null || ceremony.arrivals.length === 0) return null;
  return ceremony.arrivals[ceremony.arrivals.length - 1].id;
}

/** Headline copy for a ceremony. Kept here so it is covered by tests. */
export function ceremonyLabel(ceremony: Ceremony): string {
  const total = ceremony.arrivals.length + ceremony.overflow;
  if (ceremony.kind === 'solo') {
    const name = ceremony.arrivals[0]?.guestName?.trim();
    return name ? `${name} just shared a moment` : 'A new moment has arrived';
  }
  return `${total} moments just landed`;
}

/** Ids a ceremony is currently carrying — the grid holds these tiles hidden
 *  until the photo lands in them, so the moment never appears twice at once. */
export function ceremonyIds(ceremony: Ceremony | null): Set<string> {
  if (ceremony === null) return new Set();
  return new Set(ceremony.arrivals.map((a) => a.id));
}

/* ------------------------------------------------------------------ */
/* Geometry for the particle flight                                     */
/* ------------------------------------------------------------------ */

/** Viewport-space rectangle, matching lib/beamGeometry's Rect. */
export interface BeamRect { left: number; top: number; width: number; height: number }

/**
 * Where a photo starts its flight: just off the bottom edge, centred, shaped
 * like its destination. Off-screen so the dissolve reads as the photo arriving
 * from the room rather than fading up in place, and bottom-centre because that
 * is where the booth QR lives on every wall layout.
 */
export function beamOriginRect(to: BeamRect, viewportW: number, viewportH: number): BeamRect {
  const aspect = to.width > 0 && to.height > 0 ? to.width / to.height : 9 / 16;
  const width = Math.max(80, Math.min(to.width * 0.62, viewportW * 0.16));
  const height = width / (aspect || 1);
  return {
    left: viewportW / 2 - width / 2,
    top: viewportH + height * 0.35,
    width,
    height,
  };
}

/** Column count for a burst composite — kept squarish so faces stay large. */
export function burstColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

/**
 * Cell rects for `count` photos inside a `w`×`h` composite, in reading order.
 * Used both to draw the composite canvas and to size its landing rect, so the
 * particles reassemble into exactly the picture that was sampled.
 *
 * A final partial row is CENTRED. Five photos in a three-wide grid otherwise
 * leaves a hole in the bottom-right corner, and on a projected wall an empty
 * black cell does not read as "five photos" — it reads as a failed load.
 */
export function burstCells(count: number, w: number, h: number, pad = 0): BeamRect[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || w <= 0 || h <= 0) return [];
  const cols = burstColumns(n);
  const rows = Math.ceil(n / cols);
  const cw = w / cols;
  const ch = h / rows;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const rowOffset = ((cols - inRow) * cw) / 2;
    return {
      left: rowOffset + (i % cols) * cw + pad,
      top: row * ch + pad,
      width: Math.max(1, cw - pad * 2),
      height: Math.max(1, ch - pad * 2),
    };
  });
}

/** Centred landing rect for a burst composite (no single tile to fly into). */
export function burstLandingRect(
  count: number,
  viewportW: number,
  viewportH: number,
): BeamRect {
  const cols = burstColumns(count);
  const rows = Math.ceil(Math.max(1, count) / cols);
  // 9:16 cells, so the composite's aspect follows the grid shape.
  const cellAspect = 9 / 16;
  const gridAspect = (cols * cellAspect) / rows;
  let height = viewportH * 0.62;
  let width = height * gridAspect;
  if (width > viewportW * 0.7) {
    width = viewportW * 0.7;
    height = width / (gridAspect || 1);
  }
  return {
    left: viewportW / 2 - width / 2,
    top: viewportH / 2 - height / 2,
    width,
    height,
  };
}
