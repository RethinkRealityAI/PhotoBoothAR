/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unknown platform paths. Most land on the branded not-found page; a few are
 * such plausible guesses at a real page ("/pricing", "/legal") that sending
 * the visitor straight there serves them better than an apology. Pure.
 */

/** Guessable addresses → where that thing actually lives. Keys are lower-case,
 *  without a trailing slash. Only unambiguous guesses belong here. */
const ALIASES: Readonly<Record<string, string>> = {
  // The homepage's pricing stop; BeamyPage scrolls to ?s=<stop> on load.
  '/pricing': '/?s=pricing',
  '/plans': '/?s=pricing',
  // The platform's legal pages are /terms and /privacy.
  '/legal': '/terms',
  '/tos': '/terms',
  '/privacy-policy': '/privacy',
  // Account pages under their other common names.
  '/signin': '/login',
  '/sign-in': '/login',
  '/register': '/signup',
  '/sign-up': '/signup',
  // Password recovery emails always link /reset-password with a token; a bare
  // "/reset" is someone looking for the form that SENDS that email.
  '/reset': '/forgot-password',
  '/guide': '/guides',
};

/** Where an unknown path should go instead, or null to show the not-found page. */
export function notFoundAlias(pathname: string): string | null {
  const key = pathname.length > 1 ? pathname.replace(/\/+$/, '').toLowerCase() : pathname.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : null;
}
