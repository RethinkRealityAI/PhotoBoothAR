import { describe, it, expect } from 'vitest';
import {
  FRAME_PRESETS,
  FRAME_PRESET_STYLE,
  framePresetById,
  defaultPresetFor,
  providerForPreset,
  composePresetPrompt,
} from './framePresets';
import { FRAME_LAYOUT_SPEC, inferFrameLayout } from './assetPrompt';

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
      if (p.layout === 'classic-border') expect(inferFrameLayout(FRAME_PRESET_STYLE[p.id]), p.id).toBe('classic-border');
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
    expect(composePresetPrompt('luxe-marble', '')).toBe(FRAME_PRESET_STYLE['luxe-marble']);
    expect(composePresetPrompt('luxe-marble', '  roses on the corners ')).toBe(
      `${FRAME_PRESET_STYLE['luxe-marble']}. roses on the corners`);
  });
});
