import { describe, expect, it } from 'vitest';
import {
  cardEmailHtml, cardEmailSubject, clip, emailPalette, fromLine, summarizeContributions,
  type ContributionRow,
} from '../../supabase/functions/card-publish/email.ts';

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
  it('subject names the crowd only when there is one', () => {
    expect(cardEmailSubject('Happy birthday', summarizeContributions(rows))).toContain('from 4 people');
    expect(cardEmailSubject('Happy birthday', null)).toContain('A card for you');
  });
});

describe('cardEmailHtml', () => {
  const url = 'https://beamwall.app/c/abc';
  it('escapes guest text and drops photos without a signed URL', () => {
    const evil: ContributionRow[] = [
      { contributor_name: '<b>x</b>', message: '"><script>1</script>', media_type: 'photo', media_path: 'p.jpg' },
    ];
    const html = cardEmailHtml('T', 'R', url, {}, { summary: summarizeContributions(evil), photoUrls: {} });
    expect(html).not.toContain('<script>1');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('background-image:url(');
  });
  it('renders signed photos as cropped tiles', () => {
    const html = cardEmailHtml('T', null, url, {}, {
      summary: summarizeContributions(rows),
      photoUrls: { 'e/c/1.jpg': 'https://x.test/1?token=a', 'e/c/3.jpg': 'https://x.test/3?token=b' },
    });
    expect(html.match(/background-image:url\('https:\/\/x\.test/g)).toHaveLength(2);
    expect(html).toContain('Open your card');
  });
  it('still renders with no extras (plain fallback)', () => {
    const html = cardEmailHtml('Hello', null, url);
    expect(html).toContain('Hello');
    expect(html).toContain(url);
  });
  it('rejects non-hex theme colours', () => {
    expect(emailPalette({ vars: { '--color-accent': 'red;background:url(x)' } }).accent).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
