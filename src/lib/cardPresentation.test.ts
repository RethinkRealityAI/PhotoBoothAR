import { describe, expect, it } from 'vitest';
import {
  firstReadingPage,
  BEAMWALL_CARD_PALETTE,
  CARD_EMAIL_STYLE_IDS,
  CARD_EMAIL_STYLE_OPTIONS,
  CARD_LOOK_IDS,
  CARD_LOOK_OPTIONS,
  CARD_REVEAL_IDS,
  CARD_REVEAL_OPTIONS,
  DEFAULT_CARD_PRESENTATION,
  cardMonogram,
  effectiveReveal,
  cardPalette,
  REVEAL_WEBGL_FALLBACK,
  normalizeCardPresentation,
  parseCardViewOverrides,
  playableReveal,
  resolveCardLook,
  revealOption,
} from './cardPresentation';

describe('closed sets', () => {
  it('every id has exactly one option, in the same order', () => {
    expect(CARD_REVEAL_OPTIONS.map((o) => o.id)).toEqual([...CARD_REVEAL_IDS]);
    expect(CARD_EMAIL_STYLE_OPTIONS.map((o) => o.id)).toEqual([...CARD_EMAIL_STYLE_IDS]);
    expect(CARD_LOOK_OPTIONS.map((o) => o.id)).toEqual([...CARD_LOOK_IDS]);
  });

  it('the WebGL fallback reveal itself needs no WebGL', () => {
    expect(revealOption(REVEAL_WEBGL_FALLBACK).needsWebGL).toBe(false);
  });

  it('the default reveal plays on every device', () => {
    expect(revealOption(DEFAULT_CARD_PRESENTATION.reveal).needsWebGL).toBe(false);
  });
});

describe('normalizeCardPresentation', () => {
  it('empty / junk → defaults', () => {
    for (const raw of [undefined, null, {}, [], 'x', 3, { reveal: 'nope', email: 7, look: null }]) {
      expect(normalizeCardPresentation(raw)).toEqual(DEFAULT_CARD_PRESENTATION);
    }
  });

  it('keeps valid choices and drops unknown keys', () => {
    expect(
      normalizeCardPresentation({ reveal: 'airplane', email: 'spotlight', look: 'event', extra: '<script>' }),
    ).toEqual({ v: 1, reveal: 'airplane', email: 'spotlight', look: 'event', design: 'none' });
  });

  it('keeps a known design and drops an unknown one (old rows have none)', () => {
    expect(normalizeCardPresentation({ design: 'owambe' }).design).toBe('owambe');
    expect(normalizeCardPresentation({ design: 'disco-inferno' }).design).toBe('none');
    expect(normalizeCardPresentation({ reveal: 'ribbon' }).design).toBe('none');
  });

  it('each axis falls back independently', () => {
    expect(normalizeCardPresentation({ reveal: 'stardust', email: 'neon' })).toEqual({
      ...DEFAULT_CARD_PRESENTATION,
      reveal: 'stardust',
    });
  });
});

describe('playableReveal', () => {
  it('a WebGL reveal without WebGL plays the fallback', () => {
    for (const o of CARD_REVEAL_OPTIONS) {
      const played = playableReveal(o.id, false);
      expect(played).toBe(o.needsWebGL ? REVEAL_WEBGL_FALLBACK : o.id);
    }
  });
  it('with WebGL every reveal plays as chosen', () => {
    for (const id of CARD_REVEAL_IDS) expect(playableReveal(id, true)).toBe(id);
  });
});

describe('effectiveReveal', () => {
  it('a design plays its own scene opener, unless the host chose no opening', () => {
    expect(effectiveReveal('envelope', 'none')).toBe('envelope');
    expect(effectiveReveal('envelope', 'garden-gate')).toBe('scene');
    expect(effectiveReveal('airplane', 'owambe')).toBe('scene');
    expect(effectiveReveal('none', 'owambe')).toBe('none');
  });
});

describe('parseCardViewOverrides — design', () => {
  it('previews a design, or explicitly none, and ignores junk', () => {
    expect(parseCardViewOverrides('?design=moon-gate')).toEqual({ design: 'moon-gate' });
    expect(parseCardViewOverrides('?design=none')).toEqual({ design: 'none' });
    expect(parseCardViewOverrides('?design=%3Cscript%3E')).toEqual({});
  });
});

describe('parseCardViewOverrides', () => {
  it('reads valid params', () => {
    expect(parseCardViewOverrides('?reveal=curtain&look=beamwall&template=filmstrip')).toEqual({
      reveal: 'curtain',
      look: 'beamwall',
      template: 'filmstrip',
    });
  });
  it('ignores unknown or unsafe values', () => {
    expect(parseCardViewOverrides('?reveal=explode&look=neon&template=%3Cscript%3E')).toEqual({});
    expect(parseCardViewOverrides('')).toEqual({});
  });
  it('passes an unknown but well-formed template through (the registry falls back)', () => {
    expect(parseCardViewOverrides('?template=future-style').template).toBe('future-style');
  });
});

describe('resolveCardLook', () => {
  const platformDefault = { '--color-accent': '#D4D6FF', '--color-brand-bg': '#171A33' };
  const wedding = { '--color-accent': '#D4AF37', '--color-brand-bg': '#070B08' };

  it('auto: a platform-default snapshot wears the Beamwall look', () => {
    expect(resolveCardLook('auto', platformDefault)).toBe('beamwall');
  });
  it('auto: custom event colours are kept', () => {
    expect(resolveCardLook('auto', wedding)).toBe('event');
  });
  it('auto / event: nothing to paint → Beamwall', () => {
    expect(resolveCardLook('auto', {})).toBe('beamwall');
    expect(resolveCardLook('event', null)).toBe('beamwall');
    expect(resolveCardLook('auto', { '--color-brand-bg': '#000000' })).toBe('beamwall');
  });
  it('explicit choices win', () => {
    expect(resolveCardLook('beamwall', wedding)).toBe('beamwall');
    expect(resolveCardLook('event', platformDefault)).toBe('event');
  });
});

describe('cardPalette', () => {
  it('beamwall ignores the snapshot', () => {
    expect(cardPalette('beamwall', { '--color-accent': '#D4AF37' })).toEqual(BEAMWALL_CARD_PALETTE);
  });
  it('event reads hex values and derives the triplet', () => {
    expect(cardPalette('event', { '--color-accent': '#D4AF37', '--color-brand-bg': '#070B08' })).toEqual({
      bg: '#070B08',
      fg: '#FFFFFF',
      accent: '#D4AF37',
      accentRgb: '212, 175, 55',
    });
  });
  it('event drops non-hex values (no CSS function reaches a shader)', () => {
    const p = cardPalette('event', { '--color-accent': 'rgba(1,2,3,0.5)', '--color-brand-fg': 'var(--x)' });
    expect(p.accent).toBe(BEAMWALL_CARD_PALETTE.accent);
    expect(p.fg).toBe(BEAMWALL_CARD_PALETTE.fg);
  });
});

describe('cardMonogram', () => {
  it('initials from the recipient, max two', () => {
    expect(cardMonogram('Dapo')).toBe('D');
    expect(cardMonogram('dapo ajisafe')).toBe('DA');
    expect(cardMonogram('Maya & Sam & Theo')).toBe('MS');
    expect(cardMonogram('  Zoë  ')).toBe('Z');
  });
  it('falls back to the title, then a star — never empty', () => {
    expect(cardMonogram(null, 'Happy birthday!')).toBe('H');
    expect(cardMonogram('', '')).toBe('✦');
    expect(cardMonogram('123', '!!')).toBe('✦');
  });
});

describe('firstReadingPage', () => {
  it('skips the cover after an opening when there is something to read', () => {
    expect(firstReadingPage(true, 3)).toBe(1);
  });
  it('keeps the cover with no opening, or with nothing inside yet', () => {
    expect(firstReadingPage(false, 3)).toBe(0);
    expect(firstReadingPage(true, 0)).toBe(0);
  });
});
