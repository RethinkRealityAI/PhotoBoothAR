/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build half of the service worker (src/sw/sw.ts · src/lib/pwa/).
 * Platform builds only: a VITE_EVENT (frozen legacy) build gets no sw.js and
 * no extra tag in its head.
 *
 *  - bundles src/sw/sw.ts to /sw.js (root scope; a worker under /assets/
 *    could only control /assets/);
 *  - writes into it the build's /assets file list (so the worker can drop
 *    files no build ships any more) and VENDOR_TAG, a hash of the bytes of
 *    the self-hosted engines under public/ — those keep their file names
 *    across dependency bumps, so their cache is keyed by content instead;
 *  - puts the same tag in index.html (<meta name="bw-vendor">) so a page can
 *    tell an older worker its engine cache no longer matches.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Folders under public/ that scripts/copy-*.mjs vendor from node_modules. */
const VENDOR_DIRS = ['mediapipe', 'xr8', 'three'] as const;

const PLACEHOLDER = /(['"])__BW_SW_CONFIG__\1/g;

function hashDir(dir: string, hash: ReturnType<typeof createHash>, rel = ''): void {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const relName = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) hashDir(full, hash, relName);
    else hash.update(relName).update('\0').update(readFileSync(full)).update('\0');
  }
}

export function vendorTag(publicDir: string): string {
  const hash = createHash('sha256');
  for (const d of VENDOR_DIRS) {
    const dir = path.join(publicDir, d);
    hash.update(`[${d}]`);
    if (existsSync(dir)) hashDir(dir, hash);
  }
  return hash.digest('hex').slice(0, 16);
}

function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

export function beamwallPwa(legacy: boolean, env: Record<string, string | undefined>): Plugin {
  let tag = '';
  return {
    name: 'beamwall-pwa',
    apply: 'build',
    buildStart() {
      if (legacy) return;
      tag = vendorTag(path.resolve(process.cwd(), 'public'));
      this.emitFile({ type: 'chunk', id: path.resolve(process.cwd(), 'src/sw/sw.ts'), fileName: 'sw.js' });
    },
    generateBundle(_options, bundle) {
      if (legacy) return;
      const sw = bundle['sw.js'];
      if (!sw || sw.type !== 'chunk') throw new Error('beamwall-pwa: sw.js was not emitted');
      // A service worker is one classic script: it cannot import a sibling chunk.
      if (sw.imports.length > 0 || sw.dynamicImports.length > 0 || /^\s*(import|export)\s/m.test(sw.code)) {
        throw new Error(`beamwall-pwa: sw.js must be self-contained, but it imports ${[...sw.imports, ...sw.dynamicImports].join(', ') || 'or exports something'} — keep src/lib/pwa/cachePolicy.ts out of the app bundle`);
      }
      const config = {
        vendorTag: tag,
        assets: Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort().map((f) => `/${f}`),
        supabaseOrigin: originOf(env.VITE_SUPABASE_URL),
        builtAt: new Date().toISOString(),
      };
      const hits = sw.code.match(PLACEHOLDER)?.length ?? 0;
      if (hits !== 1) throw new Error(`beamwall-pwa: expected the config placeholder once in sw.js, found it ${hits} times`);
      sw.code = sw.code.replace(PLACEHOLDER, () => JSON.stringify(JSON.stringify(config)));
      sw.map = null;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (legacy) return html;
        if (!html.includes('</head>')) throw new Error('beamwall-pwa: index.html has no </head>');
        return html.replace('</head>', `  <meta name="bw-vendor" content="${tag}" />\n  </head>`);
      },
    },
  };
}
