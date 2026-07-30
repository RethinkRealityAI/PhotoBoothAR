import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LANDING_CONTENT,
  normalizeLandingContent,
  resolveMediaUrl,
  FAQ_MAX,
  AUDIENCE_MAX,
  HIGHLIGHT_MAX,
} from './landingContent';

const SUPA_IMG =
  'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/_platform/landing/abc-hero.jpg';
const SUPA_VIDEO =
  'https://zrtftliozslrjomxbfrr.supabase.co/storage/v1/object/public/assets/_platform/landing/abc-film.mp4';

describe('normalizeLandingContent — total function', () => {
  it('null, undefined, {} and "" all return the complete defaults', () => {
    for (const raw of [null, undefined, {}, '', 0, false, [] as unknown]) {
      expect(normalizeLandingContent(raw)).toEqual(DEFAULT_LANDING_CONTENT);
    }
  });

  it('wrong-typed sections fall back wholesale', () => {
    const out = normalizeLandingContent({ features: 'nope', hero: 42, faqs: 'x', howSteps: null });
    expect(out).toEqual(DEFAULT_LANDING_CONTENT);
  });

  it('hostile nested junk degrades per-field, never throws', () => {
    const out = normalizeLandingContent({
      hero: { tagline: {}, badge: ['x'], primaryCta: 7 },
      features: [{ videoUrl: 'javascript:alert(1)', title: null, highlights: [1, {}, null] }],
      howSteps: [{ title: 12, body: () => 0 }],
      eventTypes: 'zip',
      closing: { title: false },
      footerTagline: {},
    });
    expect(out.hero).toEqual(DEFAULT_LANDING_CONTENT.hero);
    expect(out.howSteps).toEqual(DEFAULT_LANDING_CONTENT.howSteps);
    expect(out.eventTypes).toEqual(DEFAULT_LANDING_CONTENT.eventTypes);
    expect(out.closing).toEqual(DEFAULT_LANDING_CONTENT.closing);
    expect(out.footerTagline).toBe(DEFAULT_LANDING_CONTENT.footerTagline);
    // The hostile videoUrl survives normalize as a string but is REJECTED at
    // the render boundary — resolveMediaUrl is the gate.
    expect(resolveMediaUrl(out.features[0].videoUrl, 'video')).toBeUndefined();
    // Junk-only highlights degrade to the defaults, not to [].
    expect(out.features[0].highlights).toEqual(DEFAULT_LANDING_CONTENT.features[0].highlights);
  });

  it('a valid partial override merges per-field and keeps the rest', () => {
    const out = normalizeLandingContent({
      hero: { badge: '  New badge  ' },
      features: [{ id: 'wall', title: 'Custom wall title', videoUrl: SUPA_VIDEO }],
      closing: { cta: 'Go' },
    });
    expect(out.hero.badge).toBe('New badge'); // trimmed
    expect(out.hero.tagline).toBe(DEFAULT_LANDING_CONTENT.hero.tagline);
    // merge-by-id: 'wall' is slot 1 even though it arrived at index 0.
    expect(out.features[1].title).toBe('Custom wall title');
    expect(out.features[1].videoUrl).toBe(SUPA_VIDEO);
    expect(out.features[0]).toEqual(DEFAULT_LANDING_CONTENT.features[0]);
    expect(out.closing.cta).toBe('Go');
    expect(out.closing.title).toBe(DEFAULT_LANDING_CONTENT.closing.title);
  });

  it('unknown keys are dropped', () => {
    const out = normalizeLandingContent({ pricing: { hack: true }, hero: { evil: 'x' } });
    expect(out).toEqual(DEFAULT_LANDING_CONTENT);
    expect('pricing' in out).toBe(false);
    expect('evil' in out.hero).toBe(false);
  });

  it('fixed-slot arrays never change length', () => {
    const grow = normalizeLandingContent({
      howSteps: [{}, {}, {}, { title: 'step 4?' }, {}],
      features: [{}, {}, {}, {}, { id: 'extra' }],
      eventTypes: new Array(20).fill({ label: 'x', blurb: 'y' }),
    });
    expect(grow.howSteps).toHaveLength(3);
    expect(grow.features).toHaveLength(4);
    expect(grow.eventTypes).toHaveLength(6);

    const shrink = normalizeLandingContent({ howSteps: [], features: [{ id: 'cards' }], eventTypes: [{}] });
    expect(shrink.howSteps).toHaveLength(3);
    expect(shrink.features).toHaveLength(4);
    expect(shrink.eventTypes).toHaveLength(6);
    expect(shrink.features.map((f) => f.id)).toEqual(['booth', 'wall', 'challenges', 'cards']);
  });

  it('faqs and audiences are variable but capped, and junk rows are dropped', () => {
    const out = normalizeLandingContent({
      faqs: [
        { q: 'Q1', a: 'A1' },
        { q: '', a: 'orphan answer' },
        { q: 'orphan question', a: '' },
        'garbage',
        ...new Array(20).fill({ q: 'Qn', a: 'An' }),
      ],
      audiences: ['One', '', 42, '  Two  ', ...new Array(20).fill('More')],
    });
    expect(out.faqs.length).toBeLessThanOrEqual(FAQ_MAX);
    expect(out.faqs[0]).toEqual({ q: 'Q1', a: 'A1' });
    expect(out.faqs.some((f) => f.q === '' || f.a === '')).toBe(false);
    expect(out.audiences.length).toBeLessThanOrEqual(AUDIENCE_MAX);
    expect(out.audiences[0]).toBe('One');
    expect(out.audiences[1]).toBe('Two');
  });

  it('an explicitly empty faqs/audiences array is respected (admin removed them all)', () => {
    const out = normalizeLandingContent({ faqs: [], audiences: [] });
    expect(out.faqs).toEqual([]);
    expect(out.audiences).toEqual([]);
  });

  it('strings are length-capped (titles 200, bodies 1000, highlights 200 × max 6)', () => {
    const long = 'x'.repeat(5000);
    const out = normalizeLandingContent({
      hero: { badge: long, tagline: long },
      features: [{ id: 'booth', highlights: new Array(10).fill(long) }],
    });
    expect(out.hero.badge).toHaveLength(200);
    expect(out.hero.tagline).toHaveLength(1000);
    expect(out.features[0].highlights).toHaveLength(HIGHLIGHT_MAX);
    for (const h of out.features[0].highlights) expect(h).toHaveLength(200);
  });

  it('normalize(DEFAULT) is a fixed point — defaults survive a round trip', () => {
    expect(normalizeLandingContent(DEFAULT_LANDING_CONTENT)).toEqual(DEFAULT_LANDING_CONTENT);
  });

  it('normalize(JSON round trip of an override) is stable (what the DB does)', () => {
    const once = normalizeLandingContent({ hero: { badge: 'B' }, faqs: [{ q: 'q', a: 'a' }] });
    const twice = normalizeLandingContent(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

describe('resolveMediaUrl — the render-boundary gate', () => {
  it('accepts a real Supabase public storage URL of the right kind', () => {
    expect(resolveMediaUrl(SUPA_IMG, 'image')).toBe(SUPA_IMG);
    expect(resolveMediaUrl(SUPA_VIDEO, 'video')).toBe(SUPA_VIDEO);
  });

  it('rejects every hostile scheme', () => {
    for (const bad of [
      'javascript:alert(1)',
      // eslint-disable-next-line no-script-url
      'data:text/html,<script>alert(1)</script>',
      'data:image/png;base64,AAAA',
      'vbscript:evil',
      'file:///etc/passwd',
      'blob:https://example.com/x',
      `http://zrtftliozslrjomxbfrr.supabase.co${'/storage/v1/object/public/assets/x.jpg'}`, // http, not https
    ]) {
      expect(resolveMediaUrl(bad, 'image'), bad).toBeUndefined();
      expect(resolveMediaUrl(bad, 'video'), bad).toBeUndefined();
    }
  });

  it('rejects foreign origins and non-storage paths', () => {
    expect(resolveMediaUrl('https://evil.example.com/storage/v1/object/public/assets/x.jpg', 'image')).toBe(
      'https://evil.example.com/storage/v1/object/public/assets/x.jpg',
    ); // any https host with the public-object path shape is allowed (mediaUrl.ts posture: hostname not pinned)
    expect(resolveMediaUrl('https://zrtftliozslrjomxbfrr.supabase.co/not/storage/x.jpg', 'image')).toBeUndefined();
    expect(resolveMediaUrl('https://example.com/x.jpg', 'image')).toBeUndefined();
  });

  it('rejects non-strings, blanks and unparseable URLs', () => {
    for (const bad of [null, undefined, 7, {}, [], '', '   ', 'not a url', '//host/x.jpg']) {
      expect(resolveMediaUrl(bad, 'image')).toBeUndefined();
    }
  });

  it('kind-checks the extension both ways', () => {
    expect(resolveMediaUrl(SUPA_VIDEO, 'image')).toBeUndefined(); // video into an image slot
    expect(resolveMediaUrl(SUPA_IMG, 'video')).toBeUndefined(); // image into a video slot
  });
});
