import { describe, expect, it } from 'vitest';
import { REVEAL_UNLOCKS, UNLOCK_META, presetDoc, type RevealUnlock } from './revealModel';
import { beamyOutline, CHEER_AT } from './revealUnlock';
import {
  demoDoc,
  initialRevealState,
  isPosterQuery,
  lineText,
  needsRestart,
  ornamentReach,
  revealLayout,
  revealReducer,
  type Rect,
  type RevealLayout,
} from './revealScene';

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5;
const overlapY = (aTop: number, aBottom: number, bTop: number, bBottom: number) => aTop < bBottom && bTop < aBottom;

function ornamentBox(l: RevealLayout, u: RevealUnlock) {
  const r = ornamentReach(u);
  const { x, feet, h } = l.beamy;
  return { left: x - r.half * h, right: x + r.half * h, top: feet - r.top * h, bottom: feet + r.bottom * h };
}

describe('revealLayout', () => {
  const sizes: [number, number][] = [[390, 844], [360, 640], [430, 932], [768, 1024], [1440, 900], [1280, 720], [1024, 768]];
  for (const [w, h] of sizes) {
    for (const u of REVEAL_UNLOCKS) {
      it(`sealed ${w}x${h} ${u}: everything on screen, nothing stacked`, () => {
        const l = revealLayout(w, h, 'live', 'sealed', u);
        expect(inside(l.slot, w, h)).toBe(true);
        const o = ornamentBox(l, u);
        expect(o.left).toBeGreaterThanOrEqual(0);
        expect(o.right).toBeLessThanOrEqual(w);
        expect(o.top).toBeGreaterThan(0);
        expect(l.controls).not.toBeNull();
        // The ring / triangle stays above the controls.
        expect(o.bottom).toBeLessThanOrEqual(l.controls!.y + 1);
        if (!l.wide) {
          // Object, bubble room, then Beamy: the object ends above his ornament.
          expect(l.slot.y + l.slot.h).toBeLessThan(o.top - 60);
        } else {
          // Side by side: the object clears his ornament horizontally.
          expect(l.slot.x).toBeGreaterThan(o.right);
        }
      });
    }
    it(`revealed ${w}x${h}: the card is on screen and clear of Beamy`, () => {
      const l = revealLayout(w, h, 'live', 'revealed', 'blast');
      expect(inside(l.slot, w, h)).toBe(true);
      const top = l.beamy.feet - l.beamy.h * 1.02;
      if (l.wide) expect(l.slot.x).toBeGreaterThan(l.beamy.x + l.beamy.h * 0.4);
      else expect(overlapY(l.slot.y, l.slot.y + l.slot.h, top, l.beamy.feet)).toBe(false);
      expect(l.controls).toBeNull();
    });
  }

  it('the poster centres a large subject in 1200x720 with no controls or teaser', () => {
    for (const u of REVEAL_UNLOCKS) {
      const l = revealLayout(1200, 720, 'poster', 'sealed', u);
      expect(l.teaserTop).toBeNull();
      expect(l.controls).toBeNull();
      expect(inside(l.slot, 1200, 720)).toBe(true);
      expect(l.slot.h).toBeGreaterThan(720 * 0.5);
      const o = ornamentBox(l, u);
      expect(o.top).toBeGreaterThan(720 * 0.04);
      expect(o.bottom).toBeLessThan(720 * 0.96);
      const left = Math.min(o.left, l.slot.x);
      const right = Math.max(o.right, l.slot.x + l.slot.w);
      // Horizontally centred within a few px, with breathing room each side.
      expect(Math.abs(left - (1200 - right))).toBeLessThan(2);
      expect(left).toBeGreaterThan(60);
      expect(l.beamy.h).toBeGreaterThan(300);
    }
  });

  it('the trace triangle matches beamyOutline round his body', () => {
    const l = revealLayout(390, 844, 'live', 'sealed', 'trace');
    const pts = beamyOutline(l.triangle.cx, l.triangle.cy, l.triangle.size);
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    expect(minY).toBeLessThan(l.beamy.feet - l.beamy.h);
    expect(maxY).toBeGreaterThanOrEqual(l.beamy.feet - 1);
  });
});

describe('revealReducer', () => {
  it('arrives, greets, hints, cheers once, opens and reveals', () => {
    let s = initialRevealState();
    expect(s.phase).toBe('arriving');
    s = revealReducer(s, { type: 'arrived' });
    expect(s).toMatchObject({ phase: 'sealed', line: 'greeting' });
    s = revealReducer(s, { type: 'hint' });
    expect(s.line).toBe('hint');
    s = revealReducer(s, { type: 'progress', value: CHEER_AT });
    expect(s).toMatchObject({ line: 'cheer', cheered: true });
    s = revealReducer(s, { type: 'progress', value: 0.2 });
    expect(s.line).toBe('cheer');
    s = revealReducer(s, { type: 'progress', value: 1 });
    expect(s).toMatchObject({ phase: 'opening', line: 'unlocked', openedBy: 'gesture' });
    s = revealReducer(s, { type: 'progress', value: 0 });
    expect(s.phase).toBe('opening');
    s = revealReducer(s, { type: 'opened' });
    expect(s.phase).toBe('revealed');
  });

  it('"Just show me" opens from any sealed state; a second open is a no-op', () => {
    let s = revealReducer(initialRevealState(), { type: 'arrived' });
    s = revealReducer(s, { type: 'open', by: 'skip' });
    expect(s).toMatchObject({ phase: 'opening', openedBy: 'skip', line: 'unlocked' });
    expect(revealReducer(s, { type: 'open', by: 'gesture' })).toBe(s);
  });

  it('progress during arrival starts the run (a fast reader)', () => {
    const s = revealReducer(initialRevealState(), { type: 'progress', value: 0.1 });
    expect(s).toMatchObject({ phase: 'sealed', line: 'hint' });
  });

  it('a jump goes straight to revealed; restart bumps the run and seals again', () => {
    let s = revealReducer(initialRevealState(3), { type: 'jump' });
    expect(s).toMatchObject({ phase: 'revealed', openedBy: 'jump' });
    s = revealReducer(s, { type: 'restart' });
    expect(s).toMatchObject({ phase: 'arriving', run: 4, line: 'none', cheered: false, progress: 0 });
  });

  it('the poster starts sealed and silent', () => {
    expect(initialRevealState(0, true)).toMatchObject({ phase: 'sealed', line: 'none' });
  });

  it('ignores a non-finite progress', () => {
    const s = revealReducer(revealReducer(initialRevealState(), { type: 'arrived' }), { type: 'progress', value: Number.NaN });
    expect(s.progress).toBe(0);
  });
});

describe('lineText', () => {
  it('fills {left} in the cheer line', () => {
    const lines = UNLOCK_META.tap.lines;
    expect(lineText('cheer', lines, 2)).toBe('2 more!');
    expect(lineText('greeting', lines, 2)).toBe(lines.greeting);
    expect(lineText('none', lines, 2)).toBe('');
  });
});

describe('demoDoc', () => {
  it('uses the preset, overriding unlock (with its lines) and theme', () => {
    const d = demoDoc('feature-drop', '?poster=1&unlock=melt&theme=gold');
    expect(d.unlock).toBe('melt');
    expect(d.theme).toBe('gold');
    expect(d.beamy).toEqual(UNLOCK_META.melt.lines);
    expect(d.reveal).toEqual(presetDoc('feature-drop').reveal);
  });
  it('ignores unknown values and occasions', () => {
    const d = demoDoc('nope', '?unlock=laser&theme=plaid');
    expect(d).toEqual(presetDoc('feature-drop'));
  });
});

describe('isPosterQuery', () => {
  it('reads ?poster=1', () => {
    expect(isPosterQuery('?poster=1')).toBe(true);
    expect(isPosterQuery('?poster')).toBe(true);
    expect(isPosterQuery('?poster=0')).toBe(false);
    expect(isPosterQuery('')).toBe(false);
  });
});

describe('needsRestart', () => {
  it('restarts on unlock / theme / occasion / tap count, not on words', () => {
    const a = presetDoc('milestone');
    expect(needsRestart(a, { ...a, reveal: { ...a.reveal, title: 'x' } })).toBe(false);
    expect(needsRestart(a, { ...a, theme: 'mint' })).toBe(true);
    expect(needsRestart(a, { ...a, taps: a.taps + 1 })).toBe(true);
  });
});
