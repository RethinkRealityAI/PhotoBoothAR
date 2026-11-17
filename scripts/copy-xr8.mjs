/**
 * Copy the 8th Wall face engine out of the installed @8thwall/engine package
 * into public/xr8/ so it is served from our own origin at EXACTLY the version
 * package.json pins (same reasoning as copy-mediapipe: JS, wasm-in-JS and model
 * files must move in lockstep, and no runtime CDN dependency).
 *
 * Only the face path is copied — xr.js (loader + camera pipeline), xr-face.js
 * (the face chunk, wasm inlined) and the face models — plus the MIT LICENSE.
 * Deliberately NOT copied: xr-tracking.js (SLAM, 3.9 MB), the semantics model,
 * the semantics/media workers, GLBs and the logo. The ear model is copied
 * because FaceController's pipeline loads it when ears are enabled; we do not
 * enable ears, but a later config flip must not 404 into index.html.
 *
 * public/xr8/ is gitignored (like public/mediapipe/); predev/prebuild run this.
 */
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', '@8thwall', 'engine');
const outDir = join(root, 'public', 'xr8');

const FILES = [
  ['dist/xr.js', 'xr.js'],
  ['dist/xr-face.js', 'xr-face.js'],
  ['dist/resources/face-model.tflite', 'resources/face-model.tflite'],
  ['dist/resources/face-mesh-model.tflite', 'resources/face-mesh-model.tflite'],
  ['dist/resources/face-ear-model.tflite', 'resources/face-ear-model.tflite'],
  ['LICENSE', 'LICENSE'],
];

const missing = FILES.filter(([src]) => !existsSync(join(pkgDir, src)));
if (missing.length > 0) {
  console.error('[copy-xr8] missing from @8thwall/engine (run npm install):', missing.map(([s]) => s).join(', '));
  process.exit(1);
}

mkdirSync(join(outDir, 'resources'), { recursive: true });
let bytes = 0;
for (const [src, dst] of FILES) {
  copyFileSync(join(pkgDir, src), join(outDir, dst));
  bytes += statSync(join(outDir, dst)).size;
}
console.log(`[copy-xr8] copied ${FILES.length} file(s), ${(bytes / 1e6).toFixed(1)} MB → public/xr8`);
