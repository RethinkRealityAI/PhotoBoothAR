import { describe, expect, it } from 'vitest';
import {
  EMAIL_LOOK_IDS, EMAIL_STYLE_IDS, cardEmailHtml, cardEmailPreheader, cardEmailSubject, cardEmailText,
  cardMonogram as denoMonogram, clip, emailPalette, fromLine, normalizeEmailPresentation, resolveEmailLook,
  summarizeContributions,
  type ContributionRow,
} from '../../supabase/functions/card-publish/email.ts';
import {
  CARD_EMAIL_STYLE_IDS, CARD_LOOK_IDS, cardMonogram, resolveCardLook, type CardLookId,
} from './cardPresentation';

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
    expect(html).not.toContain('background-image:url(');
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
    expect(sealed).toContain('Tap to open');
    expect(sealed).not.toContain('background-image:url(');
    expect(sealed).toMatch(/>D<\/td>/);
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
