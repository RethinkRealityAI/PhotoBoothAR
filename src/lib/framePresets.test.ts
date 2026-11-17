import { describe, it, expect } from 'vitest';
import {
  FRAME_PRESETS,
  FRAME_PRESET_STYLE,
  FRAME_PRESET_COLOURS,
  presetArtStyle,
  framePresetById,
  defaultPresetFor,
  providerForPreset,
  composePresetPrompt,
  FRAME_PALETTES,
  framePaletteById,
  eventPalette,
  eventPaletteGreenNote,
} from './framePresets';
import { FRAME_LAYOUT_SPEC, buildGreenScreenFramePrompt, inferFrameLayout, isGreenFamily } from './assetPrompt';

describe('FRAME_PRESETS', () => {
  it('ships the eight looks, each with a style, a real layout and a provider hint', () => {
    expect(FRAME_PRESETS.map((p) => p.label)).toEqual([
      'Botanical watercolour', 'Art-deco foil', 'Neon night', 'Confetti pop',
      'Minimal line', 'Storybook illustration', 'Retro 70s', 'Luxe marble',
    ]);
    for (const p of FRAME_PRESETS) {
      expect(FRAME_PRESET_STYLE[p.id].length).toBeGreaterThan(40);
      expect(Object.keys(FRAME_LAYOUT_SPEC)).toContain(p.layout);
      expect(['gemini', 'higgsfield']).toContain(p.providerHint);
    }
  });

  it('no style invites a green hue, and the risky ones forbid it outright', () => {
    for (const [id, style] of Object.entries(FRAME_PRESET_STYLE)) {
      const withoutBans = style.replace(/never green|no green[^;,.]*|no green marble/gi, '');
      expect(withoutBans, id).not.toMatch(/\b(green|emerald|sage|olive|mint|lime|teal)\b/i);
    }
    for (const id of ['botanical-watercolour', 'neon-night', 'storybook', 'luxe-marble'] as const) {
      expect(FRAME_PRESET_STYLE[id]).toMatch(/never green|no green/);
    }
  });

  it('host-facing words avoid the banned jargon', () => {
    for (const p of FRAME_PRESETS) {
      expect(`${p.label} ${p.blurb}`).not.toMatch(/shader|glb|experience|asset|preset|catalog/i);
    }
  });

  it('a style sentence does not itself re-route the layout inference', () => {
    // The style travels in `prompt` for the deployed server; it must not make
    // inferFrameLayout pick a different archetype than the preset recommends.
    for (const p of FRAME_PRESETS) {
      if (p.layout === 'classic-border') {
        expect(inferFrameLayout(FRAME_PRESET_STYLE[p.id]), p.id).toBe('classic-border');
        expect(inferFrameLayout(presetArtStyle(p.id, false)), p.id).toBe('classic-border');
      }
    }
  });
});

describe('defaultPresetFor', () => {
  it('pre-selects from the event type, and an occasion wins', () => {
    expect(defaultPresetFor('wedding')).toBe('botanical-watercolour');
    expect(defaultPresetFor('gala')).toBe('art-deco-foil');
    expect(defaultPresetFor('birthday')).toBe('confetti-pop');
    expect(defaultPresetFor('party')).toBe('neon-night');
    expect(defaultPresetFor('corporate')).toBe('minimal-line');
    expect(defaultPresetFor('party', 'Baby shower for Ada')).toBe('storybook');
    expect(defaultPresetFor('birthday', "Sofia's quinceañera")).toBe('luxe-marble');
    expect(defaultPresetFor('corporate', 'Christmas party')).toBe('storybook');
  });

  it('falls back to the safest look', () => {
    expect(defaultPresetFor(null)).toBe('minimal-line');
    expect(defaultPresetFor('remote')).toBe('minimal-line');
  });
});

describe('providerForPreset — advisory only', () => {
  const deco = framePresetById('art-deco-foil')!;
  const botanical = framePresetById('botanical-watercolour')!;

  it('uses the hint only when the org already has Higgsfield', () => {
    expect(providerForPreset(deco, 'gemini', true)).toBe('higgsfield');
    expect(providerForPreset(deco, 'gemini', false)).toBe('gemini');
  });

  it('never moves an org off its choice for a gemini-hinted look', () => {
    expect(providerForPreset(botanical, 'higgsfield', true)).toBe('higgsfield');
    expect(providerForPreset(botanical, 'gemini', true)).toBe('gemini');
  });

  it('framePresetById rejects unknown ids', () => {
    expect(framePresetById('nope')).toBe(null);
    expect(framePresetById(null)).toBe(null);
  });
});

describe('composePresetPrompt', () => {
  it('carries the style for the deployed server, plus the host’s extra words', () => {
    expect(composePresetPrompt('luxe-marble', '')).toBe(presetArtStyle('luxe-marble', false));
    expect(composePresetPrompt('luxe-marble', '  roses on the corners ')).toBe(
      `${presetArtStyle('luxe-marble', false)}. roses on the corners`);
  });

  it('spells a picked palette out for the deployed server (which ignores `palette`)', () => {
    const blush = framePaletteById('blush')!;
    expect(composePresetPrompt('luxe-marble', '', blush)).toBe(`${FRAME_PRESET_STYLE['luxe-marble']}, in ${blush.words}`);
    expect(composePresetPrompt('luxe-marble', 'roses', blush)).toBe(`${FRAME_PRESET_STYLE['luxe-marble']}, in ${blush.words}. roses`);
  });

  it('the event swatch (hexes, no words) gives the style alone — no preset colours, no dangling ", in "', () => {
    const ev = eventPalette(['#C8102E'])!;
    expect(composePresetPrompt('art-deco-foil', '', ev)).toBe(FRAME_PRESET_STYLE['art-deco-foil']);
    expect(composePresetPrompt('art-deco-foil', 'roses', ev)).toBe(`${FRAME_PRESET_STYLE['art-deco-foil']}. roses`);
  });
});

describe('palette is the colour authority over a preset look', () => {
  /** The colour vocabulary, derived from the presets' own colour lists. */
  const colourWords = [...new Set(
    Object.values(FRAME_PRESET_COLOURS).flatMap((cs) => cs.flatMap((c) => c.toLowerCase().split(/[\s-]+/))),
  )].filter(Boolean);
  const hasWord = (text: string, w: string) => new RegExp(`\\b${w}\\b`, 'i').test(text);

  it('derives a real vocabulary (sanity: the words the red-palette run fought)', () => {
    for (const w of ['gold', 'navy', 'magenta', 'coral', 'plum', 'orange', 'white', 'black']) expect(colourWords).toContain(w);
  });

  it('with a palette, no preset’s art style names any preset colour', () => {
    for (const p of FRAME_PRESETS) {
      const style = presetArtStyle(p.id, true);
      for (const w of colourWords) expect(hasWord(style, w), `${p.id} says "${w}"`).toBe(false);
    }
  });

  it('with a palette, the whole frame prompt carries the palette and none of the preset’s own colour words', () => {
    const red = ['#C8102E', '#F4EFE6'];
    for (const p of FRAME_PRESETS) {
      const prompt = buildGreenScreenFramePrompt('', { layout: p.layout, accentHexes: red, style: presetArtStyle(p.id, true) });
      expect(prompt).toContain('Build the palette around #C8102E');
      const artStyle = /Art style: (.*?)\. (Register|Build|Use a disciplined)/.exec(prompt)?.[1] ?? '';
      expect(artStyle, p.id).toBe(FRAME_PRESET_STYLE[p.id]);
      for (const w of colourWords) expect(hasWord(artStyle, w), `${p.id} says "${w}"`).toBe(false);
    }
  });

  it('without a palette, each preset keeps its own colours', () => {
    for (const p of FRAME_PRESETS) {
      const style = presetArtStyle(p.id, false);
      expect(style.startsWith(FRAME_PRESET_STYLE[p.id])).toBe(true);
      for (const c of FRAME_PRESET_COLOURS[p.id]) expect(style).toContain(c);
    }
    expect(presetArtStyle('art-deco-foil', false)).toBe(`${FRAME_PRESET_STYLE['art-deco-foil']}, in antique gold and ink navy`);
    expect(presetArtStyle('minimal-line', false)).toBe(FRAME_PRESET_STYLE['minimal-line']);
  });

  it('no preset colour is a green the key would cut out', () => {
    for (const [id, cs] of Object.entries(FRAME_PRESET_COLOURS)) {
      for (const c of cs) expect(c, id).not.toMatch(/\b(green|emerald|sage|olive|mint|lime|teal)\b/i);
    }
  });
});

describe('palette swatches', () => {
  it('no swatch carries a colour the green key would cut out', () => {
    for (const p of FRAME_PALETTES) {
      expect(p.hexes.length).toBeGreaterThan(0);
      expect(p.hexes.length).toBeLessThanOrEqual(3);
      for (const h of p.hexes) {
        expect(h).toMatch(/^#[0-9A-F]{6}$/);
        expect(isGreenFamily(h), `${p.id} ${h}`).toBe(false);
      }
      expect(p.words).not.toMatch(/green|lime|emerald|sage|olive|mint/i);
    }
  });

  it('eventPalette keeps the event’s usable colours and drops greens', () => {
    expect(eventPalette(['#C9A24B', '#00FF00', 'oops', '#1E1A22'])?.hexes).toEqual(['#C9A24B', '#1E1A22']);
    expect(eventPalette([])).toBe(null);
    expect(eventPalette(undefined)).toBe(null);
  });

  it('eventPaletteGreenNote says so when a green was dropped, and only then', () => {
    // Nothing green → no note.
    expect(eventPaletteGreenNote(['#C9A24B', '#1E1A22'])).toBe(null);
    expect(eventPaletteGreenNote([])).toBe(null);
    expect(eventPaletteGreenNote(undefined)).toBe(null);
    // A green beside other colours → the frame uses the others.
    expect(eventPaletteGreenNote(['#2E8B57', '#C9A24B'])).toBe(
      'Green is used to cut the photo window, so this frame uses your other colours.',
    );
    // Only green → no "Your colours" swatch at all; say why.
    expect(eventPalette(['#2E8B57'])).toBe(null);
    expect(eventPaletteGreenNote(['#2E8B57'])).toMatch(/^Green is used to cut the photo window, so your colour can’t go in this frame/);
    // A green past the 3-colour cap was never going to be used → no note.
    expect(eventPaletteGreenNote(['#C9A24B', '#1E1A22', '#FBF7EF', '#00FF00'])).toBe(null);
    // Invalid entries are skipped, as eventPalette skips them.
    expect(eventPaletteGreenNote(['oops', '#00FF00', '#C9A24B'])).not.toBe(null);
  });
});
