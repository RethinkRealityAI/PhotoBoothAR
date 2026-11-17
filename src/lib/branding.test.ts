import { describe, it, expect } from 'vitest';
import { mergeCopy, brandingCssVars, hexToRgbTriplet, MANAGED_CSS_VARS, onAccentForeground } from './branding';
import type { EventCopy } from '../events/types';

const base: EventCopy = {
  eyebrow: 'BASE · 2026',
  eventName: 'Base Event',
  tagline: 'base tagline',
  fullName: 'Base Event 2026',
  thankYou: 'thanks',
  steps: [{ title: 'A', body: 'a' }],
  onboardingSteps: [{ eyebrow: 'Step One', title: 'Welcome', body: 'hi' }],
  filePrefix: 'Base2026',
  shareTitle: 'Base share',
  momentTitle: 'My Base Moment',
  shareText: 'base share text',
};

describe('mergeCopy', () => {
  it('returns a copy of defaults when no overrides', () => {
    const out = mergeCopy(base);
    expect(out).toEqual(base);
    expect(out).not.toBe(base);
  });

  it('overlays only non-blank string fields', () => {
    const out = mergeCopy(base, { eventName: 'Detola & Wuyi', tagline: '   ', thankYou: '' });
    expect(out.eventName).toBe('Detola & Wuyi');
    expect(out.tagline).toBe('base tagline'); // whitespace ignored
    expect(out.thankYou).toBe('thanks'); // empty ignored
  });

  it('replaces onboardingSteps only when a non-empty array is given', () => {
    const steps = [{ eyebrow: 'One', title: 'New', body: 'b' }];
    expect(mergeCopy(base, { onboardingSteps: steps }).onboardingSteps).toEqual(steps);
    expect(mergeCopy(base, { onboardingSteps: [] }).onboardingSteps).toEqual(base.onboardingSteps);
    expect(mergeCopy(base, {}).onboardingSteps).toEqual(base.onboardingSteps);
  });

  it('never mutates the defaults', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeCopy(base, { eventName: 'X', onboardingSteps: [{ eyebrow: 'z', title: 'z', body: 'z' }] });
    expect(base).toEqual(snapshot);
  });

  it('overlays the generated guest lines (welcomeIntro / keepsakeIntro) like any other copy field', () => {
    const generated: EventCopy = {
      ...base,
      welcomeIntro: 'Generated welcome.',
      keepsakeIntro: 'Generated keepsake.',
      generatedAt: '2026-09-04T00:00:00.000Z',
    };
    const out = mergeCopy(generated, { welcomeIntro: 'Host welcome.', keepsakeIntro: 'Host keepsake.' });
    expect(out.welcomeIntro).toBe('Host welcome.');
    expect(out.keepsakeIntro).toBe('Host keepsake.');
    // The AI stamp is not a Branding field: it survives untouched.
    expect(out.generatedAt).toBe('2026-09-04T00:00:00.000Z');
    // Blank edits keep the generated line (same rule as tagline/thankYou).
    const kept = mergeCopy(generated, { welcomeIntro: '  ', keepsakeIntro: '' });
    expect(kept.welcomeIntro).toBe('Generated welcome.');
    expect(kept.keepsakeIntro).toBe('Generated keepsake.');
  });

  it('leaves the optional guest lines ABSENT on a legacy copy that never had them', () => {
    // A coded event's EventCopy carries no welcomeIntro; an override object
    // without one must not conjure the key (GuestWelcome renders its literal).
    const out = mergeCopy(base, { eventName: 'X' });
    expect('welcomeIntro' in out).toBe(false);
    expect('keepsakeIntro' in out).toBe(false);
    expect(mergeCopy(base, { welcomeIntro: '' }).welcomeIntro).toBeUndefined();
  });
});

describe('hexToRgbTriplet', () => {
  it('parses 6-digit hex with or without #', () => {
    expect(hexToRgbTriplet('#D4AF37')).toBe('212, 175, 55');
    expect(hexToRgbTriplet('d4af37')).toBe('212, 175, 55');
  });
  it('returns null for invalid input', () => {
    expect(hexToRgbTriplet('#fff')).toBeNull();
    expect(hexToRgbTriplet('nope')).toBeNull();
  });
});

describe('brandingCssVars', () => {
  it('returns {} when no colors', () => {
    expect(brandingCssVars()).toEqual({});
    expect(brandingCssVars({})).toEqual({});
    expect(brandingCssVars({ colors: {} })).toEqual({});
  });

  it('maps accent to semantic + scale tokens and derives --accent-rgb', () => {
    const vars = brandingCssVars({ colors: { accent: '#D4AF37' } });
    expect(vars['--color-accent']).toBe('#D4AF37');
    expect(vars['--color-gold-400']).toBe('#D4AF37');
    expect(vars['--accent-rgb']).toBe('212, 175, 55');
  });

  it('maps background + foreground overrides to their scale tokens', () => {
    const vars = brandingCssVars({ colors: { brandBg: '#0A0F0B', brandFg: '#EAF3EC' } });
    expect(vars['--color-brand-bg']).toBe('#0A0F0B');
    expect(vars['--color-noir-900']).toBe('#0A0F0B');
    expect(vars['--color-brand-fg']).toBe('#EAF3EC');
    expect(vars['--color-ivory']).toBe('#EAF3EC');
  });

  it('ignores blank color values', () => {
    expect(brandingCssVars({ colors: { accent: '  ' } })).toEqual({});
  });

  it('only emits vars that are in MANAGED_CSS_VARS (so resets fully clear them)', () => {
    const all = brandingCssVars({
      colors: { accent: '#111111', accent2: '#222222', accent3: '#333333', brandBg: '#444444', brandSurface: '#555555', brandFg: '#666666', brandMuted: '#777777' },
    });
    for (const key of Object.keys(all)) {
      expect(MANAGED_CSS_VARS).toContain(key);
    }
  });
});

describe('onAccentForeground', () => {
  it('puts near-black ink on a light accent', () => {
    // Champagne gold — the legacy events' accent.
    expect(onAccentForeground('#D4AF37')).toBe('#0A0806');
  });

  it('puts ivory ink on a dark accent', () => {
    // The failure this exists to prevent: .bg-foil is built from the host's
    // accent while CTAs hard-coded a dark foreground, so a host who picked a
    // dark accent got an unreadable booth shutter and "Try again" button.
    expect(onAccentForeground('#101010')).toBe('#F7F1E3');
    expect(onAccentForeground('#3A46B0')).toBe('#F7F1E3');
  });

  it('accepts a hex without the leading hash', () => {
    expect(onAccentForeground('D4AF37')).toBe('#0A0806');
  });

  it('returns null for anything that is not a 6-digit hex, so the default stands', () => {
    expect(onAccentForeground('rebeccapurple')).toBeNull();
    expect(onAccentForeground('#fff')).toBeNull();
    expect(onAccentForeground('')).toBeNull();
  });
});
