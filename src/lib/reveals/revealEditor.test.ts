import { describe, expect, it } from 'vitest';
import { presetDoc, withUnlock } from './revealModel';
import {
  buildDraftPatch, canonDoc, counter, emailFileName, imageUploadError, imageUrlError, isDirty, isUntouched,
  linkError, previewSrcDoc, relativeTime, revealStatus, revealUploadPath, slugError, typedSlug,
  IMAGE_MAX_BYTES,
} from './revealEditor';

const base = () => ({ doc: presetDoc('feature-drop'), name: 'Launch', slug: 'launch' });

describe('buildDraftPatch / isDirty', () => {
  it('returns null when nothing changed', () => {
    expect(buildDraftPatch(base(), base())).toBeNull();
    expect(isDirty(base(), base())).toBe(false);
  });

  it('ignores whitespace-only differences readers would never see', () => {
    const local = base();
    local.doc = { ...local.doc, email: { ...local.doc.email, headline: `${local.doc.email.headline}  ` } };
    expect(buildDraftPatch(local, base())).toBeNull();
  });

  it('carries a normalised draft when the copy changed', () => {
    const local = base();
    local.doc = { ...local.doc, email: { ...local.doc.email, headline: '  New headline ' } };
    const p = buildDraftPatch(local, base());
    expect(p?.draft?.email.headline).toBe('New headline');
    expect(p?.name).toBeUndefined();
    expect(p?.slug).toBeUndefined();
  });

  it('leaves out an invalid slug and an empty name but keeps the rest', () => {
    const local = { ...base(), name: '   ', slug: '-bad-' };
    local.doc = { ...local.doc, theme: 'gold' as const };
    const p = buildDraftPatch(local, base());
    expect(p).not.toBeNull();
    expect(p?.draft?.theme).toBe('gold');
    expect('name' in (p ?? {})).toBe(false);
    expect('slug' in (p ?? {})).toBe(false);
    expect(isDirty(local, base())).toBe(true);
  });

  it('leaves out a slug the database refused, until it changes', () => {
    const local = { ...base(), slug: 'taken-one' };
    expect(buildDraftPatch(local, base(), 'taken-one')).toBeNull();
    expect(buildDraftPatch({ ...local, slug: 'free-one' }, base(), 'taken-one')).toEqual({ slug: 'free-one' });
  });

  it('trims and saves a renamed reveal', () => {
    expect(buildDraftPatch({ ...base(), name: '  Spring  launch ' }, base())).toEqual({ name: 'Spring launch' });
  });
});

describe('revealStatus', () => {
  it('draft, live and changes', () => {
    const d = presetDoc('offer');
    expect(revealStatus(d, null)).toBe('draft');
    expect(revealStatus(d, presetDoc('offer'))).toBe('live');
    expect(revealStatus({ ...d, theme: 'mint' }, presetDoc('offer'))).toBe('changes');
  });
});

describe('isUntouched', () => {
  it('true for a fresh preset, false after an edit or an unlock swap', () => {
    expect(isUntouched(presetDoc('invite'))).toBe(true);
    expect(isUntouched(withUnlock(presetDoc('invite'), 'rub'))).toBe(false);
    const d = presetDoc('invite');
    expect(isUntouched({ ...d, email: { ...d.email, subject: 'Hi' } })).toBe(false);
  });
});

describe('image upload', () => {
  it('accepts images up to 5 MB only', () => {
    expect(imageUploadError({ type: 'image/png', size: 1000 })).toBeNull();
    expect(imageUploadError({ type: 'image/png', size: IMAGE_MAX_BYTES })).toBeNull();
    expect(imageUploadError({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 })).toMatch(/5 MB/);
    expect(imageUploadError({ type: 'application/pdf', size: 10 })).toMatch(/not an image/);
    expect(imageUploadError({ type: 'image/svg+xml', size: 10 })).toMatch(/not an image/);
    expect(imageUploadError({ type: 'image/jpeg', size: 0 })).toMatch(/empty/);
  });

  it('builds the platform path with the right extension', () => {
    expect(revealUploadPath('3f2a-b9', 'image/jpeg', 1700000000123)).toBe('_platform/reveals/3f2a-b9/1700000000123.jpg');
    expect(revealUploadPath('../etc', 'image/webp', 5)).toBe('_platform/reveals/etc/5.webp');
    expect(revealUploadPath('', 'image/png', 5)).toBe('_platform/reveals/unknown/5.png');
  });
});

describe('field checks', () => {
  it('links: https or a site path, empty is fine', () => {
    expect(linkError('')).toBeNull();
    expect(linkError('/pricing')).toBeNull();
    expect(linkError('https://beamwall.app/x')).toBeNull();
    expect(linkError('http://beamwall.app')).not.toBeNull();
    expect(linkError('javascript:alert(1)')).not.toBeNull();
    expect(linkError('//evil.example')).not.toBeNull();
  });

  it('images: https only', () => {
    expect(imageUrlError('')).toBeNull();
    expect(imageUrlError('https://x.example/a.png')).toBeNull();
    expect(imageUrlError('/a.png')).not.toBeNull();
    expect(imageUrlError('data:image/png;base64,AA')).not.toBeNull();
  });

  it('slugs', () => {
    expect(slugError('spring-launch', null)).toBeNull();
    expect(slugError('', null)).toMatch(/needs/);
    expect(slugError('ab', null)).toMatch(/3/);
    expect(slugError('Bad_Slug', null)).toMatch(/Lowercase/);
    expect(slugError('ends-', null)).toMatch(/Lowercase/);
    expect(slugError('taken', 'taken')).toMatch(/already/);
    expect(slugError('taken-2', 'taken')).toBeNull();
  });

  it('typedSlug keeps typing natural', () => {
    expect(typedSlug('Spring Launch!')).toBe('spring-launch');
    expect(typedSlug('a  b')).toBe('a-b');
    expect(typedSlug('end-')).toBe('end-');
  });

  it('counter tones', () => {
    expect(counter('abc', 10)).toEqual({ text: '3/10', tone: 'ok' });
    expect(counter('abcdefghi', 10).tone).toBe('near');
    expect(counter('abcdefghij', 10).tone).toBe('full');
  });
});

describe('small helpers', () => {
  it('emailFileName', () => {
    expect(emailFileName('launch')).toBe('launch-email.html');
    expect(emailFileName(' ')).toBe('reveal-email.html');
  });

  it('previewSrcDoc opens links in a new tab', () => {
    expect(previewSrcDoc('<html><head><title>x</title></head></html>')).toContain('<head><base target="_blank"><title>');
    expect(previewSrcDoc('<p>x</p>')).toBe('<base target="_blank"><p>x</p>');
  });

  it('relativeTime', () => {
    const now = Date.parse('2026-11-22T12:00:00Z');
    expect(relativeTime('2026-11-22T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-11-22T11:50:00Z', now)).toBe('10 min ago');
    expect(relativeTime('2026-11-22T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-21T10:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-01-01T00:00:00Z', now)).toBe('2026-01-01');
    expect(relativeTime('nope', now)).toBe('');
  });

  it('canonDoc is stable for equal docs', () => {
    expect(canonDoc(presetDoc('holiday'))).toBe(canonDoc(presetDoc('holiday')));
  });
});
