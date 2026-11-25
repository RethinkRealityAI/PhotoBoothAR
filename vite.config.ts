import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

/**
 * index.html carries the PLATFORM head (brand v2 font preloads, dusk
 * theme-color). The three legacy single-event sites are frozen, so a
 * VITE_EVENT build gets the head they shipped with back, byte-for-byte:
 * each [platform, legacy] pair below is swapped in the emitted HTML. If a
 * pair stops matching index.html the build FAILS rather than silently
 * changing a frozen site's head.
 */
const LEGACY_HEAD: ReadonlyArray<readonly [string, string]> = [
  ['<meta name="theme-color" content="#262566" />', '<meta name="theme-color" content="#05060B" />'],
  ['    <meta property="og:site_name" content="Beamwall" />\n', ''],
  ['    <meta property="og:image:alt" content="Beamwall, your immersive photo booth, with Beamy the mascot on a dusk-blue background" />\n', ''],
  [
    `         remote, frozen) at runtime.
         PRELOADS = the brand v2 faces every platform page actually paints
         (Geist = UI text, Bricolage = display; @font-face in styles/brand.css).
         Without these the browser only discovers them after the CSS + JS
         have run (~3.5s on a throttled phone) while the old Inter/Cormorant
         preloads downloaded fonts the platform never renders. Legacy
         (VITE_EVENT) builds get their original two preloads and theme-color
         back byte-for-byte from the legacyFrozenHead plugin in vite.config.ts. -->
    <link rel="preload" href="/fonts/geist-var-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/bricolage-grotesque-var-latin.woff2" as="font" type="font/woff2" crossorigin />`,
    `         remote, frozen) at runtime. -->
    <link rel="preload" href="/fonts/inter-400-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/cormorant-garamond-500-latin.woff2" as="font" type="font/woff2" crossorigin />`,
  ],
];

function legacyFrozenHead(legacy: boolean): Plugin {
  return {
    name: 'legacy-frozen-head',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!legacy) return html;
        let out = html;
        for (const [platform, frozen] of LEGACY_HEAD) {
          if (!out.includes(platform)) {
            throw new Error(`legacy-frozen-head: index.html no longer contains:\n${platform.slice(0, 120)}`);
          }
          out = out.replace(platform, frozen);
        }
        return out;
      },
    },
  };
}

export default defineConfig(({mode}) => {
  const legacy = (process.env.VITE_EVENT ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_EVENT ?? '').trim() !== '';
  return {
    plugins: [react(), tailwindcss(), legacyFrozenHead(legacy)],
    // Workers are created as `{ type: 'module' }` (frameKey, mp4Export), and
    // the MP4 one loads its converter on demand, which IIFE cannot split.
    worker: { format: 'es' },
    build: {
      rollupOptions: {
        output: {
          // Stable vendor chunks: the 3D stack (reached only via lazy imports —
          // Booth/studio/showcase/event Backgrounds), gsap (Landing scroll
          // choreography) and supabase-js cache independently of app code.
          // Function form on purpose: the object form let Rollup hoist shared
          // deps (react itself) into the three chunk, which made the eager
          // entry import — and so preload — the whole 3D stack again.
          manualChunks(id: string) {
            // Vite's preload-helper is a virtual module (no node_modules in
            // its id) — check it before the node_modules guard.
            if (id.includes('vite/preload-helper')) return 'react';
            if (!id.includes('node_modules')) return undefined;
            // Modules shared between the eager app and the 3D stack must be
            // pinned to an eagerly-loaded chunk: left unassigned, Rollup folds
            // them into 'three' (fiber needs them too), which makes the eager
            // entry statically import the 1.3 MB 3D chunk again. Applies to
            // react + router, zustand (app store AND fiber), and Vite's
            // dynamic-import preload helper virtual module.
            if (
              /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|zustand|use-sync-external-store)\//.test(id) ||
              id.includes('vite/preload-helper')
            ) {
              return 'react';
            }
            if (/node_modules\/(three|@react-three)\//.test(id)) return 'three';
            if (id.includes('node_modules/gsap/')) return 'gsap';
            if (id.includes('node_modules/@supabase/')) return 'supabase';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
