import { describe, expect, it } from 'vitest';
import {
  WALL_MODE_TRANSITIONS, WALL_MODE_TRANSITION_META, cycleActive, cycleIndexAt, cycleLabel, msUntilNextCycle,
  normalizeWallShow, toggleCycleLayout, transitionSpec,
} from './wallShow';

describe('wallShow', () => {
  it('reads an absent or broken value as today\'s wall', () => {
    for (const raw of [undefined, null, 3, 'x', [], {}]) {
      expect(normalizeWallShow(raw)).toEqual({ transition: 'crossfade', cycle: [], cycleSec: 180 });
    }
    expect(normalizeWallShow({ transition: 'iris', cycle: ['album', 'nope', 'album', 'grid'], cycleSec: 60 }))
      .toEqual({ transition: 'iris', cycle: ['album', 'grid'], cycleSec: 60 });
    expect(normalizeWallShow({ cycleSec: 7 }).cycleSec).toBe(180);
  });

  it('rotates on the wall clock so every screen agrees', () => {
    const show = normalizeWallShow({ cycle: ['grid', 'album', 'carousel'], cycleSec: 60 });
    expect(cycleActive(show)).toBe(true);
    expect(cycleIndexAt(show, 0)).toBe(0);
    expect(cycleIndexAt(show, 59_999)).toBe(0);
    expect(cycleIndexAt(show, 60_000)).toBe(1);
    expect(cycleIndexAt(show, 180_000)).toBe(0);
    expect(msUntilNextCycle(show, 59_000)).toBe(1000);
    expect(cycleIndexAt(normalizeWallShow({ cycle: ['grid'] }), 1e9)).toBe(-1);
  });

  it('toggles layouts in the wall\'s own order', () => {
    expect(toggleCycleLayout([], 'album')).toEqual(['album']);
    expect(toggleCycleLayout(['album'], 'grid')).toEqual(['grid', 'album']);
    expect(toggleCycleLayout(['grid', 'album'], 'grid')).toEqual(['album']);
  });

  it('has copy and motion for every transition; reduced motion only fades', () => {
    for (const t of WALL_MODE_TRANSITIONS) {
      expect(WALL_MODE_TRANSITION_META[t].label.length).toBeGreaterThan(0);
      const s = transitionSpec(t, false);
      expect(s.duration).toBeGreaterThan(0);
      expect(s.animate.zIndex).toBe(1);
      expect(s.exit.zIndex).toBe(0);
      expect(Object.keys(transitionSpec(t, true).animate).sort()).toEqual(['opacity', 'zIndex']);
    }
    expect(cycleLabel(60)).toBe('Every minute');
    expect(cycleLabel(300)).toBe('Every 5 minutes');
  });
});
