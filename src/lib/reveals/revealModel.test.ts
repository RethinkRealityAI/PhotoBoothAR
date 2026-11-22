import { describe, expect, it } from 'vitest';
import {
  CAPS, OCCASION_META, REVEAL_OCCASIONS, REVEAL_THEMES, REVEAL_UNLOCKS, THEME_PALETTES, UNLOCK_META,
  TAPS_MAX, TAPS_MIN, fillLine, hasRevealCta, isValidSlug, normalizeRevealDoc, presetDoc,
  readPreviewMessage, revealUrl, safeImage, safeLink, slugify, withUnlock,
} from './revealModel';

describe('registries', () => {
  it('every occasion names a real theme and unlock, and its preset survives normalisation unchanged', () => {
    for (const o of REVEAL_OCCASIONS) {
      const m = OCCASION_META[o];
      expect(REVEAL_THEMES).toContain(m.theme);
      expect(REVEAL_UNLOCKS).toContain(m.unlock);
      const doc = presetDoc(o);
      expect(normalizeRevealDoc(doc)).toEqual(doc);
      expect(doc.email.subject.length).toBeLessThanOrEqual(CAPS.subject);
      expect(doc.email.ctaLabel.length).toBeLessThanOrEqual(CAPS.ctaLabel);
    }
  });

  it('every unlock is used by at least one occasion preset (so each has a showcase)', () => {
    const used = new Set(REVEAL_OCCASIONS.map((o) => OCCASION_META[o].unlock));
    for (const u of REVEAL_UNLOCKS) expect(used.has(u)).toBe(true);
  });

  it('every palette colour is a 6-digit hex', () => {
    for (const t of REVEAL_THEMES) {
      const p = THEME_PALETTES[t];
      for (const k of ['bgTop', 'bgBottom', 'panel', 'fg', 'muted', 'accent', 'onAccent', 'core'] as const) {
        expect(p[k]).toMatch(/^#[0-9A-F]{6}$/i);
      }
    }
  });

  it('Beamy copy carries no emoji (brand rule)', () => {
    const all = JSON.stringify([UNLOCK_META, OCCASION_META]);
    expect(/\p{Extended_Pictographic}/u.test(all)).toBe(false);
  });
});

describe('normalizeRevealDoc', () => {
  it('is total', () => {
    for (const raw of [null, undefined, 3, 'x', [], { occasion: 'nope', theme: 9, unlock: {} }]) {
      const d = normalizeRevealDoc(raw);
      expect(d.occasion).toBe('feature-drop');
      expect(d.email.ctaLabel).not.toBe('');
    }
  });

  it('clamps taps and clips text', () => {
    const d = normalizeRevealDoc({ taps: 99, email: { subject: 'a'.repeat(500) } });
    expect(d.taps).toBe(TAPS_MAX);
    expect(d.email.subject.length).toBe(CAPS.subject);
    expect(normalizeRevealDoc({ taps: -2 }).taps).toBe(TAPS_MIN);
  });

  it('keeps an explicitly empty reveal button and image, but refills a required field', () => {
    const d = normalizeRevealDoc({ occasion: 'offer', reveal: { ctaLabel: '', ctaUrl: '', imageUrl: '' }, email: { headline: '   ' } });
    expect(d.reveal.ctaLabel).toBe('');
    expect(hasRevealCta(d)).toBe(false);
    expect(d.email.headline).toBe(OCCASION_META.offer.email.headline);
  });

  it('drops unsafe links', () => {
    const d = normalizeRevealDoc({ reveal: { ctaUrl: 'javascript:alert(1)', imageUrl: 'http://x.com/a.png' } });
    expect(d.reveal.ctaUrl).toBe('');
    expect(d.reveal.imageUrl).toBe('');
  });
});

describe('links', () => {
  it('accepts https and site paths only', () => {
    expect(safeLink('https://beamwall.app/pricing')).toBe('https://beamwall.app/pricing');
    expect(safeLink('/host/new?x=1')).toBe('/host/new?x=1');
    expect(safeLink('//evil.com')).toBe('');
    expect(safeLink('http://x.com')).toBe('');
    expect(safeLink('https://u:p@x.com')).toBe('');
    expect(safeLink('data:text/html,hi')).toBe('');
    expect(safeImage('/a.png')).toBe('');
  });

  it('slugs', () => {
    expect(slugify('New feature: Live Captions!')).toBe('new-feature-live-captions');
    expect(slugify('  Ça va  ')).toBe('ca-va');
    expect(isValidSlug('new-feature')).toBe(true);
    expect(isValidSlug('-x')).toBe(false);
    expect(isValidSlug('a')).toBe(false);
    expect(revealUrl('https://beamwall.app/', 'hi-there')).toBe('https://beamwall.app/reveal/hi-there');
  });
});

describe('withUnlock', () => {
  it('swaps default lines but keeps the admin\'s own', () => {
    const d = { ...presetDoc('feature-drop') };
    d.beamy = { ...d.beamy, hint: 'My own hint' };
    const n = withUnlock(d, 'rub');
    expect(n.unlock).toBe('rub');
    expect(n.beamy.hint).toBe('My own hint');
    expect(n.beamy.greeting).toBe(UNLOCK_META.rub.lines.greeting);
  });
});

describe('fillLine + preview messages', () => {
  it('fills {left}', () => {
    expect(fillLine('{left} more!', 3)).toBe('3 more!');
  });

  it('reads only known preview messages, normalising the doc', () => {
    expect(readPreviewMessage({ type: 'other' })).toBeNull();
    expect(readPreviewMessage('x')).toBeNull();
    const m = readPreviewMessage({ type: 'beamwall:reveal-preview-doc', doc: { theme: 'gold' } });
    expect(m?.type).toBe('beamwall:reveal-preview-doc');
    if (m?.type === 'beamwall:reveal-preview-doc') expect(m.doc.theme).toBe('gold');
    expect(readPreviewMessage({ type: 'beamwall:reveal-preview-replay' })).toEqual({ type: 'beamwall:reveal-preview-replay' });
  });
});

describe('uniqueSlug', () => {
  it('suffixes taken slugs and never returns an invalid one', async () => {
    const { uniqueSlug } = await import('./revealModel');
    expect(uniqueSlug('New feature', [])).toBe('new-feature');
    expect(uniqueSlug('New feature', ['new-feature', 'new-feature-2'])).toBe('new-feature-3');
    expect(isValidSlug(uniqueSlug('!!!', []))).toBe(true);
    expect(isValidSlug(uniqueSlug('x', []))).toBe(true);
  });
});
