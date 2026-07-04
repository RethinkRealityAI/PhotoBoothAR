// Slug helpers shared by the host wizard and event tooling.
// The server (create-event edge function) remains authoritative — this is a
// front-end mirror for instant validation feedback.

/** Valid runtime event slug: lowercase alnum start, then alnum/dashes, 2-63 chars. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * Mirror of the create-event edge function's reserved list: route words and
 * platform names, plus the three coded legacy slugs (which resolve from the
 * code registry, not the events table, so a taken-check would miss them).
 */
export const RESERVED_SLUGS = new Set([
  'admin',
  'host',
  'login',
  'signup',
  'api',
  'e',
  'c',
  'm',
  'app',
  'www',
  'assets',
  'posts',
  'wall',
  'booth',
  'upload',
  'me',
  'gallery',
  'join',
  'experience',
  'beamwall',
  'legal',
  'pricing',
  'help',
  'about',
  // Coded legacy events
  'hope-gala',
  'jenna-jake',
  'detola-wuyi',
]);

/**
 * Derive a URL slug from a free-form event name: lowercase, strip diacritics,
 * collapse non-alphanumerics to single dashes, trim dashes, clamp to 63 chars,
 * ensure a leading alphanumeric. Returns '' when nothing usable remains.
 */
export function slugify(name: string): string {
  let s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  s = s.slice(0, 63).replace(/-+$/g, '');
  return s;
}
