/**
 * build-render.mjs — bake a card payload into a render-ready keepsake-film bundle.
 *
 * The keepsake-film composition reads its data from a pre-script global,
 * `window.__KEEPSAKE_PAYLOAD__`, because HyperFrames `--variables` overrides are
 * only populated AFTER the composition's initial synchronous build (verified in
 * this container) — so a data-driven film must receive its data as a global
 * injected into the bundle BEFORE the init script runs.
 *
 * This helper copies index.html + gsap.min.js into an output dir and replaces
 * the empty `<script id="kf-payload-data">` slot with the payload assignment.
 * The card-render edge function performs the equivalent injection when it
 * submits the bundle to the HeyGen HyperFrames Cloud Render API.
 *
 * Usage:
 *   node build-render.mjs <payload.json> <outDir>
 * Then:
 *   npx hyperframes render <outDir> --output out.mp4
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SLOT_RE = /<script id="kf-payload-data">[\s\S]*?<\/script>/;

export function bakeBundle(payload, outDir) {
  const template = readFileSync(join(HERE, 'index.html'), 'utf8');
  if (!SLOT_RE.test(template)) {
    throw new Error('kf-payload-data injection slot not found in index.html');
  }
  // JSON.stringify twice is deliberate: the inner stringify produces the JSON
  // text, and embedding it as a JS string literal via a second stringify makes
  // it safe inside <script> (escapes quotes, and </script> can't appear in a
  // JSON string of our data). We assign the PARSED object to the global.
  const json = JSON.stringify(payload);
  const literal = JSON.stringify(json).replace(/<\/(script)/gi, '<\\/$1');
  const injected = `<script id="kf-payload-data">window.__KEEPSAKE_PAYLOAD__ = JSON.parse(${literal});</script>`;
  const html = template.replace(SLOT_RE, injected);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  copyFileSync(join(HERE, 'gsap.min.js'), join(outDir, 'gsap.min.js'));
  return join(outDir, 'index.html');
}

// CLI entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [payloadPath, outDir] = process.argv.slice(2);
  if (!payloadPath || !outDir) {
    console.error('usage: node build-render.mjs <payload.json> <outDir>');
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(resolve(payloadPath), 'utf8'));
  const entry = bakeBundle(payload, resolve(outDir));
  console.log('baked bundle →', entry);
}
