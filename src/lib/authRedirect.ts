/**
 * Where Supabase sends a user back after Google sign-in, email confirmation
 * or a password-reset link.
 *
 * Production sign-in must always come home to https://beamwall.app. Supabase's
 * redirect allow-list only holds beamwall.app (verified 2026-11-20), so any
 * other origin we pass, like a Netlify deploy preview or beamwall.netlify.app,
 * is silently swapped for the Site URL root. That dropped people on the
 * homepage instead of /host, on a different origin from where they started.
 *
 * Rules:
 *  - localhost / 127.0.0.1 keep their own origin, so local dev still works.
 *  - every other host (beamwall.app, www, *.netlify.app previews) returns to
 *    the canonical production origin.
 */
export const CANONICAL_ORIGIN = 'https://beamwall.app';

export function authRedirectOrigin(loc: { protocol: string; hostname: string; origin: string }): string {
  const host = loc.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')) {
    return loc.origin;
  }
  return CANONICAL_ORIGIN;
}

/** Full redirect URL for a path like "/host". */
export function authRedirectUrl(path: string, loc: { protocol: string; hostname: string; origin: string }): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${authRedirectOrigin(loc)}${p}`;
}
