import { describe, expect, it } from 'vitest';
import { REVEAL_OCCASIONS, REVEAL_THEMES, REVEAL_UNLOCKS, THEME_PALETTES, normalizeRevealDoc, presetDoc } from './revealModel';
import { RESEND_UNSUBSCRIBE, renderRevealEmail, revealArtUrl, revealAssetBase, revealButtonFile, revealHeroFile } from './revealEmail';

const OPTS = { revealUrl: 'https://beamwall.app/reveal/new-thing', assetBase: 'https://beamwall.app' };

describe('renderRevealEmail', () => {
  it('renders every occasion with the CTA, hero and button art, under Gmail\'s 102 KB clip', () => {
    for (const o of REVEAL_OCCASIONS) {
      const doc = presetDoc(o);
      const r = renderRevealEmail(doc, OPTS);
      expect(r.subject).toBe(doc.email.subject);
      expect(r.html).toContain('href="https://beamwall.app/reveal/new-thing"');
      expect(r.html).toContain(`/email/reveals/v1/${revealHeroFile(doc.unlock, doc.theme)}`);
      expect(r.html).toContain(`/email/reveals/v1/${revealButtonFile(doc.theme)}`);
      expect(r.html).toContain(doc.email.ctaLabel);
      expect(r.html).toContain(RESEND_UNSUBSCRIBE);
      expect(r.html.length).toBeLessThan(102 * 1024);
      expect(r.text).toContain(`${doc.email.ctaLabel}: https://beamwall.app/reveal/new-thing`);
    }
  });

  it('escapes admin text and refuses unsafe URLs', () => {
    const doc = normalizeRevealDoc({ email: { headline: '<script>alert(1)</script>', body: 'a "b"\nline two' } });
    const r = renderRevealEmail(doc, { revealUrl: 'javascript:alert(1)', assetBase: 'https://x" onerror="y' });
    expect(r.html).not.toContain('<script>alert');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('line two');
    expect(r.html).toContain('a &quot;b&quot;<br>line two');
    expect(r.html).not.toContain('javascript:');
    expect(r.html).not.toContain('onerror');
  });

  it('uses only theme colours from the palette', () => {
    const r = renderRevealEmail({ ...presetDoc('offer'), theme: 'mint' }, OPTS);
    expect(r.html).toContain(THEME_PALETTES.mint.panel);
    expect(r.html).not.toContain(THEME_PALETTES.sunrise.panel);
  });

  it('omits empty optional blocks', () => {
    const doc = normalizeRevealDoc({ email: { kicker: '', body: '', footnote: '' } });
    const r = renderRevealEmail(doc, OPTS);
    expect(r.html).not.toContain('text-transform:uppercase');
    expect(r.text.split('\n').some((l, i, a) => l === '' && a[i - 1] === '')).toBe(false);
  });
});

describe('art paths', () => {
  it('every unlock × theme has a hero file name and every theme a button', () => {
    const names = new Set<string>();
    for (const u of REVEAL_UNLOCKS) for (const t of REVEAL_THEMES) names.add(revealHeroFile(u, t));
    expect(names.size).toBe(REVEAL_UNLOCKS.length * REVEAL_THEMES.length);
    expect(revealArtUrl('https://beamwall.app/', 'x.gif')).toBe('https://beamwall.app/email/reveals/v1/x.gif');
    expect(revealAssetBase('http://insecure')).toBe('https://beamwall.app');
  });
});
