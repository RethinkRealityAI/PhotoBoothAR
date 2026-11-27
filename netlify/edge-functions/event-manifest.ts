/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /event.webmanifest?slug=…&name=…&bg=…&wall=1 → one event's install manifest.
 *
 * Why a served file and not a blob: Android browsers only install a web app
 * (their own address-bar install button, a real app icon) when the manifest
 * comes from an https address. A blob: manifest passes on desktop and is
 * silently refused on a phone.
 *
 * Stateless: everything comes from the query, which the event page builds
 * (src/lib/pwa/install.ts `eventManifestHref`). The same pure builder writes
 * the JSON, so the page and this function cannot drift. Nothing here reads a
 * database, and a crafted link can only name and colour its own manifest.
 */
import { eventManifestFromQuery } from '../../src/lib/pwa/install.ts';

export default (request: Request): Response => {
  const url = new URL(request.url);
  const manifest = eventManifestFromQuery(url.origin, url.searchParams);
  if (!manifest) return new Response('Bad request', { status: 400 });
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
};

export const config = { path: '/event.webmanifest' };
