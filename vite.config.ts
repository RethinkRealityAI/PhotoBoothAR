import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
