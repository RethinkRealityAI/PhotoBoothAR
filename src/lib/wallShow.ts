/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * wallShow — how the live wall moves between its layouts.
 *
 *  - `transition`: the effect when the wall changes layout (a host's rotation,
 *    a host changing the layout live, or someone picking a layout on a screen).
 *  - `cycle`: the layouts the wall rotates through on its own, and how often.
 *
 * Stored raw as `WallSettings.show` and always read through
 * `normalizeWallShow`. Absent = the wall as it was: a soft crossfade, no
 * rotation.
 *
 * Rotation is driven by the WALL CLOCK (`cycleIndexAt`), not a timer started
 * when the page opened, so two projectors in the same room show the same
 * layout at the same time, and a refreshed screen rejoins the rotation where
 * the others are instead of starting it over. PURE: no DOM.
 */
import type { WallLayout } from './sceneThemes';
import { WALL_LAYOUTS } from './sceneThemes';

export type WallModeTransition = 'crossfade' | 'slide' | 'zoom' | 'flip' | 'wipe' | 'iris';
export const WALL_MODE_TRANSITIONS: readonly WallModeTransition[] = ['crossfade', 'slide', 'zoom', 'flip', 'wipe', 'iris'];

export const WALL_MODE_TRANSITION_META: Readonly<Record<WallModeTransition, { label: string; blurb: string }>> = {
  crossfade: { label: 'Crossfade', blurb: 'One layout melts softly into the next.' },
  slide: { label: 'Slide', blurb: 'The next layout glides in from the side.' },
  zoom: { label: 'Zoom through', blurb: 'The wall flies forward into the next layout.' },
  flip: { label: 'Flip', blurb: 'The whole wall turns over like a card.' },
  wipe: { label: 'Wipe', blurb: 'A clean sweep across the screen reveals the next layout.' },
  iris: { label: 'Spotlight', blurb: 'The next layout opens out from the centre in a circle of light.' },
};

/** Seconds per layout in a rotation. */
export const WALL_CYCLE_STEPS: readonly number[] = [60, 120, 180, 300, 600];
export const DEFAULT_CYCLE_SEC = 180;

export interface WallShow {
  transition: WallModeTransition;
  /** Layouts to rotate through, in order. Fewer than 2 = no rotation. */
  cycle: WallLayout[];
  /** Seconds each layout stays up. */
  cycleSec: number;
}

export const DEFAULT_WALL_SHOW: WallShow = { transition: 'crossfade', cycle: [], cycleSec: DEFAULT_CYCLE_SEC };

export function normalizeWallShow(raw: unknown): WallShow {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_WALL_SHOW, cycle: [] };
  const r = raw as Record<string, unknown>;
  const cycle: WallLayout[] = [];
  if (Array.isArray(r.cycle)) {
    for (const l of r.cycle) {
      if (WALL_LAYOUTS.includes(l as WallLayout) && !cycle.includes(l as WallLayout)) cycle.push(l as WallLayout);
    }
  }
  return {
    transition: WALL_MODE_TRANSITIONS.includes(r.transition as WallModeTransition)
      ? (r.transition as WallModeTransition)
      : DEFAULT_WALL_SHOW.transition,
    cycle,
    cycleSec: WALL_CYCLE_STEPS.includes(r.cycleSec as number) ? (r.cycleSec as number) : DEFAULT_CYCLE_SEC,
  };
}

/** True when the wall rotates on its own. */
export function cycleActive(show: WallShow): boolean {
  return show.cycle.length >= 2;
}

/**
 * Which entry of the rotation is up at `nowMs`, shared by every screen.
 * Returns -1 when there is no rotation.
 */
export function cycleIndexAt(show: WallShow, nowMs: number): number {
  if (!cycleActive(show)) return -1;
  const slot = Math.floor(nowMs / (show.cycleSec * 1000));
  const n = show.cycle.length;
  return ((slot % n) + n) % n;
}

/** Milliseconds until the rotation next changes layout (for one timer). */
export function msUntilNextCycle(show: WallShow, nowMs: number): number {
  const period = show.cycleSec * 1000;
  return period - (((nowMs % period) + period) % period);
}

/** Add or remove a layout from the rotation, keeping the wall's own order. */
export function toggleCycleLayout(cycle: readonly WallLayout[], layout: WallLayout): WallLayout[] {
  const has = cycle.includes(layout);
  return WALL_LAYOUTS.filter((l) => (l === layout ? !has : cycle.includes(l)));
}

/** "Every 3 minutes" / "Every minute". */
export function cycleLabel(sec: number): string {
  const min = Math.round(sec / 60);
  return min === 1 ? 'Every minute' : `Every ${min} minutes`;
}

/** Plain motion targets for each transition (motion/react `initial` /
 *  `animate` / `exit`). Kept here so they are data, testable, and shared by
 *  the wall and any preview. Reduced motion always gets the crossfade. */
export interface TransitionSpec {
  initial: Record<string, number | string>;
  animate: Record<string, number | string>;
  exit: Record<string, number | string>;
  duration: number;
}

export function transitionSpec(t: WallModeTransition, reducedMotion: boolean): TransitionSpec {
  const base = rawSpec(t, reducedMotion);
  // The incoming layout always paints above the outgoing one.
  return {
    ...base,
    initial: { ...base.initial, zIndex: 1 },
    animate: { ...base.animate, zIndex: 1 },
    exit: { ...base.exit, zIndex: 0 },
  };
}

function rawSpec(t: WallModeTransition, reducedMotion: boolean): TransitionSpec {
  if (reducedMotion) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, duration: 0.25 };
  }
  switch (t) {
    case 'crossfade':
      return { initial: { opacity: 0, scale: 0.985 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: 1.01 }, duration: 0.55 };
    case 'slide':
      return { initial: { x: '100%', opacity: 1 }, animate: { x: '0%', opacity: 1 }, exit: { x: '-35%', opacity: 0 }, duration: 0.9 };
    case 'zoom':
      return { initial: { scale: 0.6, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 1.6, opacity: 0 }, duration: 0.9 };
    case 'flip':
      return { initial: { rotateY: 90, opacity: 0 }, animate: { rotateY: 0, opacity: 1 }, exit: { rotateY: -90, opacity: 0 }, duration: 0.8 };
    case 'wipe':
      return {
        initial: { clipPath: 'inset(0% 0% 0% 100%)' },
        animate: { clipPath: 'inset(0% 0% 0% 0%)' },
        exit: { opacity: 0.999 },
        duration: 1.1,
      };
    case 'iris':
      return {
        initial: { clipPath: 'circle(0% at 50% 50%)' },
        animate: { clipPath: 'circle(75% at 50% 50%)' },
        exit: { opacity: 0.999 },
        duration: 1.2,
      };
  }
}

/** Wipe and Spotlight reveal the new layout OVER the old one, so the old one
 *  must stay painted underneath until the reveal finishes. */
export function transitionLayersOver(t: WallModeTransition): boolean {
  return t === 'wipe' || t === 'iris';
}
