/**
 * Copy three.js's Draco decoder out of the installed package into public/ so it
 * is served from OUR origin at the exact version of the three.js that imports
 * it — the same reasoning (and the same shape) as scripts/copy-mediapipe.mjs.
 *
 * Without this, `new GLTFLoader()` cannot read a Draco-compressed .glb, which is
 * what Blender's "glTF Binary (.glb)" exporter produces by DEFAULT: the model
 * silently fails to appear. three ships the decoder in the package already, so
 * this adds no dependency, and serving it locally means a venue with bad wifi
 * (or an offline booth) still decodes.
 *
 * Only the four files GLTFLoader's DRACOLoader actually requests are copied —
 * the encoder is 800 KB of code nothing in this app calls.
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
const outDir = join(root, 'public', 'three', 'draco');

// DRACOLoader picks the wasm build when the browser supports it and falls back
// to the asm.js build otherwise, so both paths must be present.
const FILES = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];

if (!existsSync(srcDir)) {
  console.error('[copy-three-decoders] source not found:', srcDir);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let n = 0;
for (const f of FILES) {
  const from = join(srcDir, f);
  if (!existsSync(from)) {
    console.error('[copy-three-decoders] missing decoder file:', from);
    process.exit(1);
  }
  copyFileSync(from, join(outDir, f));
  n++;
}
console.log(`[copy-three-decoders] copied ${n} file(s) → public/three/draco`);
