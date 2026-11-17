import { describe, it, expect } from 'vitest';
import {
  plaqueBox,
  PLAQUE_V1,
  frameGeometryVersion,
  cleanFrameText,
  fitFontSize,
  contrastRatio,
  sampleBackdrop,
  pickTextColours,
  layoutFrameText,
  drawFrameText,
  defaultFrameText,
  formatFrameDate,
  FRAME_TEXT_MAX,
  aiFrameName,
  AI_FRAME_NAME_MAX,
  type TextCtx,
} from './frameText';
import { BOOTH_SAFE_ZONE, FRAME_GEOMETRY, FRAME_GEOMETRY_VERSION, type FrameLayout } from '../assetPrompt';
import type { RgbaImage } from './chromaKey';

describe('aiFrameName (new AI frames get a human name, not the raw prompt)', () => {
  it('names by look, numbers multiple takes, falls back for a blank look', () => {
    expect(aiFrameName('Art-deco foil')).toBe('Art-deco foil frame');
    expect(aiFrameName('Storybook illustration', 1, 2)).toBe('Storybook illustration frame · 2');
    expect(aiFrameName('  ')).toBe('Custom frame');
    expect(aiFrameName(null)).toBe('Custom frame');
  });
  it('stays short (the booth orb shows the first word)', () => {
    const n = aiFrameName('x'.repeat(200), 1, 2);
    expect(n.length).toBeLessThanOrEqual(AI_FRAME_NAME_MAX);
    expect(n.endsWith(' frame · 2')).toBe(true);
  });
});

/** Fake measure: 0.55 em per character (a typical serif average). */
const measure = (text: string, size: number) => text.length * size * 0.55;

function solid(w: number, h: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { data, width: w, height: h };
}

describe('plaqueBox', () => {
  it('is the FRAME_GEOMETRY plaque in pixels, inside the booth safe bands, for every layout', () => {
    for (const layout of Object.keys(FRAME_GEOMETRY) as FrameLayout[]) {
      const b = plaqueBox(layout, 1080, 1920);
      expect(b.y).toBeGreaterThanOrEqual(Math.round(BOOTH_SAFE_ZONE.top * 1920));
      expect(b.y + b.h).toBeLessThanOrEqual(Math.round((1 - BOOTH_SAFE_ZONE.bottom) * 1920) + 1);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1080);
    }
    expect(plaqueBox('classic-border', 1080, 1920)).toEqual({ x: 216, y: 192, w: 648, h: 125 });
  });

  it('a current-geometry frame uses FRAME_GEOMETRY’s plaque, inside the safe bands', () => {
    for (const layout of Object.keys(FRAME_GEOMETRY) as FrameLayout[]) {
      const p = FRAME_GEOMETRY[layout].plaque;
      const b = plaqueBox(layout, 1080, 1920, FRAME_GEOMETRY_VERSION);
      expect(b).toEqual({
        x: Math.round(p.x0 * 1080), y: Math.round(p.y0 * 1920),
        w: Math.round((p.x1 - p.x0) * 1080), h: Math.round((p.y1 - p.y0) * 1920),
      });
      expect(b.y).toBeGreaterThanOrEqual(Math.round(BOOTH_SAFE_ZONE.top * 1920));
      expect(b.y + b.h).toBeLessThanOrEqual(Math.round((1 - BOOTH_SAFE_ZONE.bottom) * 1920) + 1);
    }
  });

  it('a frame saved before v2 keeps EXACTLY the box its prompt reserved', () => {
    // Pinned pixels, not derived: these are where shipped frames have their calm band.
    expect(plaqueBox('corner-overlay', 1080, 1920)).toEqual({ x: 216, y: 1123, w: 648, h: 125 });
    expect(plaqueBox('bottom-third', 1080, 1920)).toEqual({ x: 130, y: 1142, w: 821, h: 134 });
    expect(plaqueBox('full-scene', 1080, 1920)).toEqual({ x: 216, y: 192, w: 648, h: 125 });
    for (const layout of Object.keys(PLAQUE_V1) as FrameLayout[]) {
      expect(plaqueBox(layout, 1080, 1920, frameGeometryVersion({ plaque: true }))).toEqual(plaqueBox(layout, 1080, 1920, 1));
    }
    // …while a v2 frame moves to the new, on-art box.
    expect(plaqueBox('corner-overlay', 1080, 1920, frameGeometryVersion({ frameGeometry: 2 }))).not.toEqual(plaqueBox('corner-overlay', 1080, 1920));
  });

  it('frameGeometryVersion reads only an exact known version', () => {
    expect(frameGeometryVersion({ frameGeometry: FRAME_GEOMETRY_VERSION })).toBe(FRAME_GEOMETRY_VERSION);
    for (const c of [null, undefined, {}, { frameGeometry: '2' }, { frameGeometry: 99 }, 'x']) {
      expect(frameGeometryVersion(c)).toBe(1);
    }
  });
});

describe('fitFontSize', () => {
  it('finds the largest size that fits the width, capped by the height', () => {
    // 10 chars at 0.55em: width = 5.5·size ≤ 550 → size ≤ 100; height cap 80 wins.
    expect(fitFontSize((s) => measure('0123456789', s), 550, 80)).toBe(80);
    expect(fitFontSize((s) => measure('0123456789', s), 275, 80)).toBe(50);
  });

  it('never returns under the floor, even for text that cannot fit', () => {
    expect(fitFontSize((s) => measure('x'.repeat(200), s), 100, 80, 12)).toBe(12);
  });
});

describe('cleanFrameText', () => {
  it('trims, collapses whitespace and caps', () => {
    expect(cleanFrameText('  Maya   &\nSam ')).toBe('Maya & Sam');
    expect(cleanFrameText(null)).toBe('');
    expect(cleanFrameText('a'.repeat(100))).toHaveLength(FRAME_TEXT_MAX);
  });
});

describe('contrast-aware colours', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 5);
    expect(contrastRatio(0.5, 0.5)).toBe(1);
  });

  it('uses dark text on light art and light text on dark art', () => {
    const light = sampleBackdrop(solid(100, 100, [240, 232, 210, 255]), { x: 0, y: 0, w: 100, h: 100 });
    const dark = sampleBackdrop(solid(100, 100, [20, 24, 48, 255]), { x: 0, y: 0, w: 100, h: 100 });
    expect(pickTextColours(light).fill).toBe('#1E1A22');
    expect(pickTextColours(dark).fill).toBe('#FBF7EF');
  });

  it('prefers a theme accent only when it clears 4.5:1', () => {
    const dark = sampleBackdrop(solid(50, 50, [20, 24, 48, 255]), { x: 0, y: 0, w: 50, h: 50 });
    expect(pickTextColours(dark, ['#D4AF37']).fill).toBe('#D4AF37'); // gold on navy ≈ 7.6:1
    expect(pickTextColours(dark, ['#3A3F6B']).fill).toBe('#FBF7EF'); // too close to navy
  });

  it('over the open photo: ivory with a stroke and shadow (legible on any guest)', () => {
    const open = sampleBackdrop(solid(50, 50, [0, 0, 0, 0]), { x: 0, y: 0, w: 50, h: 50 });
    expect(open.luminance).toBe(null);
    const c = pickTextColours(open, ['#D4AF37']);
    expect(c.shadow).toBe(true);
    expect(c.strokeWidth).toBeGreaterThan(0);
  });
});

describe('layoutFrameText', () => {
  const box = { x: 216, y: 192, w: 648, h: 125 };

  it('draws nothing when disabled or empty', () => {
    expect(layoutFrameText({ enabled: false, title: 'Maya & Sam' }, box, measure)).toEqual([]);
    expect(layoutFrameText({ enabled: true, title: '   ' }, box, measure)).toEqual([]);
  });

  it('keeps every line inside the plaque width and height', () => {
    for (const spec of [
      { enabled: true, title: 'Maya & Sam' },
      { enabled: true, title: 'The Okonkwo–Fitzgerald Wedding Reception', subtitle: '12 June 2026' },
      { enabled: true, title: 'Gala', subtitle: 'An evening for the Children’s Hospital', font: 'modern' as const },
    ]) {
      const ops = layoutFrameText(spec, box, measure);
      expect(ops.length).toBe(spec.subtitle ? 2 : 1);
      for (const op of ops) {
        expect(measure(op.text, op.size)).toBeLessThanOrEqual(box.w * 0.88 + 1e-9);
        expect(op.y).toBeLessThanOrEqual(box.y + box.h);
        expect(op.y - op.size * 0.82).toBeGreaterThanOrEqual(box.y - 1e-9);
        expect(op.x).toBe(box.x + box.w / 2);
      }
      if (ops.length === 2) expect(ops[1].size).toBeLessThanOrEqual(ops[0].size * 0.6 + 1e-9);
    }
  });

  it('modern lettering is upper-cased', () => {
    expect(layoutFrameText({ enabled: true, title: 'Gala', font: 'modern' }, box, measure)[0].text).toBe('GALA');
  });
});

describe('drawFrameText (thin canvas step)', () => {
  it('fills every op, strokes only when asked, and restores the context', () => {
    const calls: string[] = [];
    const ctx = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, textAlign: 'left', textBaseline: 'top',
      lineJoin: 'miter', shadowColor: '', shadowBlur: 0,
      measureText: (t: string) => ({ width: t.length }),
      fillText: (t: string) => calls.push(`fill:${t}`),
      strokeText: (t: string) => calls.push(`stroke:${t}`),
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
    } as unknown as TextCtx;
    drawFrameText(ctx, [{ text: 'A', size: 40, x: 0, y: 0 }], 'classic',
      { fill: '#000', stroke: '#fff', strokeWidth: 0.05, shadow: false });
    expect(calls).toEqual(['save', 'stroke:A', 'fill:A', 'restore']);
    calls.length = 0;
    drawFrameText(ctx, [{ text: 'B', size: 40, x: 0, y: 0 }], 'classic',
      { fill: '#000', stroke: '', strokeWidth: 0, shadow: false });
    expect(calls).toEqual(['save', 'fill:B', 'restore']);
  });
});

describe('defaults', () => {
  it('formats a date deterministically and rejects junk', () => {
    expect(formatFrameDate('2026-06-12')).toBe('12 June 2026');
    expect(formatFrameDate('2026-06-12T18:00:00Z')).toBe('12 June 2026');
    expect(formatFrameDate('next friday')).toBe('');
    expect(formatFrameDate('2026-13-01')).toBe('');
    expect(formatFrameDate(null)).toBe('');
  });

  it('turns text on only when the event has a name', () => {
    expect(defaultFrameText('Maya & Sam', '2026-06-12')).toEqual(
      { enabled: true, title: 'Maya & Sam', subtitle: '12 June 2026', font: 'classic' });
    expect(defaultFrameText('', null).enabled).toBe(false);
  });
});
