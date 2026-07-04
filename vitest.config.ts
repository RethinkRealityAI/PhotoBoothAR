import { defineConfig } from 'vitest/config';

// Pure-logic tests (*.test.ts) run in Node; component/render tests (*.test.tsx)
// run in jsdom. Keeping the split means the fast Node suite is unaffected by the
// DOM setup, and component tests get a real DOM + jest-dom matchers. JSX is
// transformed by esbuild via tsconfig's "jsx": "react-jsx" (no react plugin
// needed here — adding it pulls in a conflicting bundled Vite type).
export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Dummy Supabase env so modules that build the client at import time
    // (src/lib/supabase.ts) don't throw "supabaseUrl is required" under test.
    // No test makes a real network call.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
});
