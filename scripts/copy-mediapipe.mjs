/**
 * Copy the MediaPipe tasks-vision WASM runtime out of the installed package into
 * public/ so it is served from our own origin at the EXACT version of the JS we
 * import. Loading the WASM from a hardcoded CDN version (it was pinned to 0.10.3
 * while the package resolved to 0.10.35) causes a JS/WASM ABI mismatch, which
 * makes the face-transform matrices come back wrong — assets land off-face. This
 * keeps JS and WASM in lockstep and removes a runtime CDN dependency.
 */
import { mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const outDir = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(srcDir)) {
  console.error('[copy-mediapipe] source wasm not found:', srcDir);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let n = 0;
for (const f of readdirSync(srcDir)) {
  copyFileSync(join(srcDir, f), join(outDir, f));
  n++;
}
console.log(`[copy-mediapipe] copied ${n} wasm file(s) → public/mediapipe/wasm`);
