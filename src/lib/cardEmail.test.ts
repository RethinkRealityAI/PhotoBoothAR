import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMAIL_ASSET_BASE, EMAIL_ART, EMAIL_ART_SEAM, EMAIL_ART_VERSION, EMAIL_LOOK_IDS, EMAIL_STYLE_IDS,
  SEAL_GLYPHS, cardEmailHtml, cardEmailPreheader, cardEmailSubject, cardEmailText,
  cardMonogram as denoMonogram, clip, emailAssetBase, emailPalette, fromLine, normalizeEmailPresentation,
  resolveEmailLook, sealGlyph, summarizeContributions,
  type ContributionRow,
} from '../../supabase/functions/card-publish/email.ts';
import {
  CARD_EMAIL_STYLE_IDS, CARD_LOOK_IDS, cardMonogram, resolveCardLook, type CardLookId,
} from './cardPresentation';

/** Background images that are NOT the rendered art — i.e. guest photos. The
 *  art (field, button) is also a background image since email-v2, so "no
 *  background-image at all" stopped meaning "no photo". */
const ART_PREFIX = `${DEFAULT_EMAIL_ASSET_BASE}/${EMAIL_ART_VERSION}/`;
function photoBackgrounds(html: string): string[] {
  return [...html.matchAll(/background-image:url\('([^']*)'\)/g)].map((m) => m[1]).filter((u) => !u.startsWith(ART_PREFIX));
}

const rows: ContributionRow[] = [
  { contributor_name: 'The Squad', message: 'Happy birthday!', media_type: 'photo', media_path: 'e/c/1.jpg' },
  { contributor_name: 'Beamy', message: 'A blast for you', media_type: 'video', media_path: 'e/c/2.mp4' },
  { contributor_name: 'the squad', message: 'Second photo', media_type: 'photo', media_path: 'e/c/3.jpg' },
  { contributor_name: 'The family', message: 'We love you endlessly, every single day of the year.', media_type: 'text', media_path: null },
  { contributor_name: '', message: '', media_type: 'photo', media_path: 'e/c/4.jpg' },
];

describe('summarizeContributions', () => {
  const s = summarizeContributions(rows);
  it('counts people (names de-duplicated, anonymous counted), media and messages', () => {
    expect(s.people).toBe(4);
    expect(s.names).toEqual(['The Squad', 'Beamy', 'The family']);
    expect(s.photos).toBe(3);
    expect(s.videos).toBe(1);
    expect(s.messages).toBe(4);
  });
  it('picks photos in card order and quotes a text note over the photo caption', () => {
    expect(s.photoPicks.map((p) => p.path)).toEqual(['e/c/1.jpg', 'e/c/3.jpg', 'e/c/4.jpg']);
    expect(s.quote?.name).toBe('The family');
  });
  it('an empty card summarizes to zeros and no quote', () => {
    const e = summarizeContributions([]);
    expect(e.people).toBe(0);
    expect(e.quote).toBeNull();
  });
});

describe('copy helpers', () => {
  it('fromLine', () => {
    expect(fromLine([], 0)).toBe('');
    expect(fromLine(['Ada'], 1)).toBe('From Ada');
    expect(fromLine(['Ada', 'Tunde'], 2)).toBe('From Ada and Tunde');
    expect(fromLine(['A', 'B', 'C', 'D'], 8)).toBe('From A, B, C and 5 more');
  });
  it('clip never splits an emoji', () => {
    expect(clip('ab🎂cd', 4)).toBe('ab🎂…');
    expect(clip('short', 10)).toBe('short');
  });
  it('subject is the title, naming the crowd only when there is one, with no emoji', () => {
    expect(cardEmailSubject('Happy birthday', summarizeContributions(rows))).toBe('Happy birthday · from 4 people');
    expect(cardEmailSubject('Happy birthday', null)).toBe('Happy birthday');
    expect(cardEmailSubject('   ', null)).toBe('A card for you');
    expect(cardEmailSubject('Happy birthday', summarizeContributions(rows))).not.toMatch(/\p{Extended_Pictographic}/u);
  });
  it('preheader says what is inside, and the sealed one keeps the mystery', () => {
    expect(cardEmailPreheader(summarizeContributions(rows), 'glow')).toBe(
      "3 photos, 1 video and 4 notes inside. Open it whenever you're ready.",
    );
    expect(cardEmailPreheader(summarizeContributions(rows), 'sealed')).not.toMatch(/photo|video/);
    expect(cardEmailPreheader(null, 'glow')).toBe("Open it whenever you're ready.");
  });
});

describe('cardEmailHtml', () => {
  const url = 'https://beamwall.app/c/abc';
  it('escapes guest text and drops photos without a signed URL', () => {
    const evil: ContributionRow[] = [
      { contributor_name: '<b>x</b>', message: '"><script>1</script>', media_type: 'photo', media_path: 'p.jpg' },
    ];
    const html = cardEmailHtml({ title: 'T', url, theme: {}, extras: { summary: summarizeContributions(evil), photoUrls: {} } });
    expect(html).not.toContain('<script>1');
    expect(html).not.toContain('<b>x</b>');
    expect(photoBackgrounds(html)).toEqual([]);
  });
  it('renders signed photos as cropped tiles', () => {
    const html = cardEmailHtml({
      title: 'T',
      url,
      theme: {},
      extras: {
        summary: summarizeContributions(rows),
        photoUrls: { 'e/c/1.jpg': 'https://x.test/1?token=a', 'e/c/3.jpg': 'https://x.test/3?token=b' },
      },
    });
    expect(html.match(/background-image:url\('https:\/\/x\.test/g)).toHaveLength(2);
    expect(html).toContain('Open your card');
  });
  it('still renders with no extras (plain fallback)', () => {
    const html = cardEmailHtml({ title: 'Hello', url });
    expect(html).toContain('Hello');
    expect(html).toContain(url);
  });
  it('rejects non-hex theme colours', () => {
    expect(emailPalette({ vars: { '--color-accent': 'red;background:url(x)' } }).accent).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

/* ------------------------------------------------------------------ */
/* Presentation: style selection, look, mirrors of the browser module   */
/* ------------------------------------------------------------------ */

const eventTheme = {
  eventName: "Dapo's 40th",
  vars: {
    '--color-brand-bg': '#101820',
    '--color-brand-surface': '#1C2A36',
    '--color-brand-fg': '#F4EFE6',
    '--color-brand-muted': '#C9C2B4',
    '--color-accent': '#E8B04B',
    '--on-accent': '#1A1206',
  },
};
const fullExtras = {
  summary: summarizeContributions(rows),
  photoUrls: {
    'e/c/1.jpg': 'https://x.test/1?token=a',
    'e/c/3.jpg': 'https://x.test/3?token=b',
    'e/c/4.jpg': 'https://x.test/4?token=c',
  },
};
const url = 'https://beamwall.app/c/abc';
const STYLES = ['glow', 'sealed', 'spotlight'] as const;

describe('email presentation mirrors', () => {
  it('accepts exactly the browser closed sets (no drift)', () => {
    expect([...EMAIL_STYLE_IDS]).toEqual([...CARD_EMAIL_STYLE_IDS]);
    expect([...EMAIL_LOOK_IDS]).toEqual([...CARD_LOOK_IDS]);
    for (const id of CARD_EMAIL_STYLE_IDS) expect(normalizeEmailPresentation({ email: id }).email).toBe(id);
  });
  it('normalises junk and absence to glow / auto', () => {
    expect(normalizeEmailPresentation(undefined)).toEqual({ email: 'glow', look: 'auto' });
    expect(normalizeEmailPresentation({ email: 'neon', look: 7 })).toEqual({ email: 'glow', look: 'auto' });
    expect(normalizeEmailPresentation([])).toEqual({ email: 'glow', look: 'auto' });
  });
  it('resolveEmailLook agrees with resolveCardLook on every look x theme', () => {
    const themes: Record<string, string>[] = [
      {},
      { '--color-accent': '#D4D6FF' },
      { '--color-accent': '#d4d6ff', '--color-brand-bg': '#000000' },
      { '--color-accent': '#E8B04B' },
      { '--color-brand-bg': '#101820' },
    ];
    for (const look of CARD_LOOK_IDS as readonly CardLookId[]) {
      for (const vars of themes) {
        expect(resolveEmailLook(look, { vars })).toBe(resolveCardLook(look, vars));
      }
    }
  });
  it('cardMonogram matches the browser one', () => {
    const cases: [string | null, string | null][] = [
      ['Dapo', 'Happy birthday, Dapo!'], ['Maya & Sam', null], ['dapo ajisafe', null],
      [null, 'happy birthday'], ['', ''], [null, null], ['Zoë-Ann Ó', null], ['  ', '!!'],
    ];
    for (const [n, t] of cases) expect(denoMonogram(n, t)).toBe(cardMonogram(n, t));
  });
});

describe('cardEmailHtml styles', () => {
  it('no style prints an eyebrow, a greeting, the recipient name or the event name', () => {
    for (const style of STYLES) {
      for (const look of CARD_LOOK_IDS) {
        const html = cardEmailHtml({
          title: 'Happy birthday!',
          url,
          theme: eventTheme,
          extras: fullExtras,
          presentation: { email: style, look },
          recipientName: 'Dapo Ajisafe',
        });
        expect(html).not.toContain("Dapo's 40th");
        expect(html).not.toMatch(/Dapo/);
        expect(html).not.toMatch(/for you\./i);
        expect(html).not.toMatch(/A card from/i);
        expect(html).toContain('Happy birthday!');
        if (style !== 'sealed') expect(html).toContain('4 people made you something.');
      }
    }
  });
  it('selects the style from presentation.email', () => {
    const sealed = cardEmailHtml({ title: 'T', url, extras: fullExtras, presentation: { email: 'sealed' }, recipientName: 'Dapo' });
    expect(sealed).toContain('Break the seal');
    expect(photoBackgrounds(sealed)).toEqual([]);
    expect(sealed).not.toContain('x.test');
    expect(sealed).toContain(`${ART_PREFIX}seal-D.jpg`);
    // the event look keeps the CSS envelope, its seal a live-text monogram
    const sealedEvent = cardEmailHtml({
      title: 'T', url, theme: eventTheme, extras: fullExtras, presentation: { email: 'sealed', look: 'event' }, recipientName: 'Dapo',
    });
    expect(sealedEvent).toMatch(/>D<\/td>/);
    expect(sealedEvent).not.toContain(ART_PREFIX);
    expect(photoBackgrounds(sealedEvent)).toEqual([]);
    const glow = cardEmailHtml({ title: 'T', url, extras: fullExtras, presentation: { email: 'glow' } });
    expect(glow).toContain('Open your card');
    expect(glow.match(/background-image:url\('https:\/\/x\.test/g)).toHaveLength(3);
    const spot = cardEmailHtml({ title: 'T', url, extras: fullExtras, presentation: { email: 'spotlight' } });
    expect(spot).toContain('class="bw-hero"');
    expect(spot.match(/background-image:url\('https:\/\/x\.test/g)).toHaveLength(1);
  });
  it('an unknown or missing style sends glow', () => {
    const base = { title: 'T', url, extras: fullExtras };
    const glow = cardEmailHtml({ ...base, presentation: { email: 'glow' } });
    expect(cardEmailHtml({ ...base, presentation: { email: 'neon' } })).toBe(glow);
    expect(cardEmailHtml(base)).toBe(glow);
  });
  it('spotlight without photos falls back to the glow layout', () => {
    const noPhotos = { summary: summarizeContributions(rows), photoUrls: {} };
    const spot = cardEmailHtml({ title: 'T', url, extras: noPhotos, presentation: { email: 'spotlight' } });
    const glow = cardEmailHtml({ title: 'T', url, extras: noPhotos, presentation: { email: 'glow' } });
    expect(spot).toBe(glow);
    expect(spot).not.toContain('class="bw-hero"');
  });
  it('every style renders with no extras at all', () => {
    for (const style of STYLES) {
      const html = cardEmailHtml({ title: 'Hello', url, presentation: { email: style } });
      expect(html).toContain('Hello');
      expect(html).toContain(url);
      expect(html).toContain('<title>Hello</title>');
    }
  });
  it('escapes the title, the monogram and the URL in every style', () => {
    for (const style of STYLES) {
      const html = cardEmailHtml({
        title: '<img src=x onerror=1>',
        url: 'https://beamwall.app/c/a"onmouseover="x',
        extras: fullExtras,
        presentation: { email: style },
        recipientName: '<s>',
      });
      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('"onmouseover="');
    }
  });
  it('paints Beamwall dusk by default and the event colours when the look resolves to event', () => {
    const auto = cardEmailHtml({ title: 'T', url, theme: eventTheme, presentation: { look: 'auto' } });
    expect(auto).toContain('#101820');
    const forced = cardEmailHtml({ title: 'T', url, theme: eventTheme, presentation: { look: 'beamwall' } });
    expect(forced).toContain('#33318A');
    expect(forced).not.toContain('#101820');
    const platformDefault = cardEmailHtml({ title: 'T', url, theme: { vars: { '--color-accent': '#D4D6FF' } } });
    expect(platformDefault).toContain('#33318A');
    expect(emailPalette(eventTheme, 'beamwall').bg).toBe('#33318A');
  });
  it('keeps the 600px column and a hidden preheader', () => {
    const html = cardEmailHtml({ title: 'T', url, extras: fullExtras });
    expect(html).toContain('max-width:600px');
    expect(html).toContain("3 photos, 1 video and 4 notes inside.");
  });
});

describe('cardEmailText', () => {
  it('is the title, one line and the link — no names', () => {
    const text = cardEmailText({ title: 'Happy birthday', url, extras: fullExtras, recipientName: 'Dapo' });
    expect(text).toContain('Happy birthday');
    expect(text).toContain('4 people made you something.');
    expect(text).toContain(url);
    expect(text).not.toContain('Dapo');
    expect(text).not.toContain('<');
  });
});

/* ------------------------------------------------------------------ */
/* Rendered art (public/email/v1, painted by scripts/render-email-art) */
/* ------------------------------------------------------------------ */

const ART_DIR = new URL(`../../public/email/${EMAIL_ART_VERSION}/`, import.meta.url);
const artFile = (f: string) => new URL(f, ART_DIR);

describe('email art', () => {
  it('sealGlyph is total: A-Z keep their letter, accents fold, everything else is the star', () => {
    for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(sealGlyph(L)).toBe(L);
      expect(sealGlyph(L.toLowerCase())).toBe(L);
    }
    expect(sealGlyph('DA')).toBe('D');
    expect(sealGlyph('É')).toBe('E');
    expect(sealGlyph('Ó')).toBe('O');
    expect(sealGlyph('Ñ')).toBe('N');
    for (const other of ['✦', 'Ж', '李', 'Ø', 'Æ', '7', '', ' ', '🎂', '<']) {
      expect(sealGlyph(other)).toBe('star');
    }
    // every monogram the card can produce maps into the shipped set
    const names = ['Dapo', 'Zoë-Ann Ó', 'Ólafur', 'Мария', '李', '', null, 'éa'];
    for (const n of names) expect(SEAL_GLYPHS).toContain(sealGlyph(denoMonogram(n, null)));
  });

  it('asset base: https or file:/// only, else the default; trailing slash dropped', () => {
    expect(emailAssetBase(undefined)).toBe(DEFAULT_EMAIL_ASSET_BASE);
    expect(emailAssetBase('https://staging.beamwall.app/email/')).toBe('https://staging.beamwall.app/email');
    expect(emailAssetBase('file:///home/u/public/email')).toBe('file:///home/u/public/email');
    for (const bad of ['http://beamwall.app/email', 'javascript:alert(1)', "https://x.test/e')", 'https://x.test/"onerror=1', 'https://a b', '']) {
      expect(emailAssetBase(bad)).toBe(DEFAULT_EMAIL_ASSET_BASE);
    }
  });

  it('every art URL is well-formed, under the versioned base, and names a shipped file', () => {
    const files = new Set(readdirSync(ART_DIR));
    for (const style of STYLES) {
      for (const recipientName of ['Dapo', 'Мария', null]) {
        const html = cardEmailHtml({ title: 'T', url, extras: fullExtras, presentation: { email: style }, recipientName });
        const refs = [
          ...[...html.matchAll(/(?:src|background)="([^"]*)"/g)].map((m) => m[1]),
          ...[...html.matchAll(/url\('([^']*)'\)/g)].map((m) => m[1]),
        ].filter((u) => !u.startsWith('https://x.test/'));
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
          expect(ref.startsWith(ART_PREFIX), ref).toBe(true);
          const name = ref.slice(ART_PREFIX.length);
          expect(name).toMatch(/^[a-z0-9-]+\.(jpg|gif|png)$/i);
          expect(files.has(name), `${name} missing from public/email/${EMAIL_ART_VERSION}/`).toBe(true);
        }
      }
    }
    const custom = cardEmailHtml({ title: 'T', url, assetBase: 'file:///tmp/e', presentation: { email: 'sealed' } });
    expect(custom).toContain(`file:///tmp/e/${EMAIL_ART_VERSION}/seal-T.jpg`); // no recipient: the title initial
    expect(custom).not.toContain(DEFAULT_EMAIL_ASSET_BASE);
  });

  it('ships every file the email can reference, each within budget (≤150 KB, set ≤1.5 MB)', () => {
    const wanted = [...Object.values(EMAIL_ART).map((a) => a.file), ...SEAL_GLYPHS.map((g) => `seal-${g}.jpg`)];
    for (const f of wanted) expect(statSync(artFile(f)).size, f).toBeLessThanOrEqual(150 * 1024);
    const total = readdirSync(ART_DIR).reduce((n, f) => n + statSync(artFile(f)).size, 0);
    expect(total).toBeLessThanOrEqual(1536 * 1024);
  });

  it('the art keeps working with images blocked: every cell it covers has a bgcolor, every img has size + alt', () => {
    for (const style of STYLES) {
      const html = cardEmailHtml({ title: 'T', url, extras: fullExtras, presentation: { email: style }, recipientName: 'Dapo' });
      for (const img of html.match(/<img [^>]*>/g) ?? []) {
        expect(img).toMatch(/ width="\d+"/);
        expect(img).toMatch(/ height="\d+"/);
        expect(img).toMatch(/ alt="/);
      }
      expect(html).toContain(`bgcolor="${EMAIL_ART_SEAM.panel}"`);
      // the pill is live text on a white cell, not part of the image
      expect(html).toMatch(/<td[^>]*bgcolor="#FFFFFF"[^>]*>\s*<a href="https:\/\/beamwall\.app\/c\/abc"/);
      expect(html).toContain('bgcolor="#33318A"'); // the field's fallback
    }
  });

  it("the CSS side borders use the colours the generator measures at the caps' seam", () => {
    const source = readFileSync(new URL('../../scripts/render-email-art.mjs', import.meta.url), 'utf8');
    const m = source.match(/export const SEAM = \{ panel: '(#[0-9A-F]{6})', rim: '(#[0-9A-F]{6})', inner: '(#[0-9A-F]{6})' \};/);
    expect(m, 'SEAM literal not found in scripts/render-email-art.mjs').not.toBeNull();
    expect({ panel: m?.[1], rim: m?.[2], inner: m?.[3] }).toEqual({ ...EMAIL_ART_SEAM });
  });
});
