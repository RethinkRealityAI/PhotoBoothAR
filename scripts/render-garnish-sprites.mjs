#!/usr/bin/env node
/**
 * Renders each baked garnish model (public/models/garnish/<id>.glb) to the
 * transparent sprite the 2D magazine cover draws (<id>.webp, 512 px), so the
 * selfie cover and the AR cover show the very same flowers and balloons.
 *
 *   node scripts/render-garnish-sprites.mjs
 *
 * Headless Chromium (the pre-installed Playwright) + three.js from
 * node_modules, studio-lit from the front and a little above, like the guest
 * sees them in AR. Run again after re-baking a model; the output is committed.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const DIR = join(ROOT, 'public', 'models', 'garnish');
const ids = readdirSync(DIR).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).sort();

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };
const PAGE = `<!doctype html><html><body style="margin:0;background:transparent">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const S = 1024;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(S, S);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1.5, 2.5, 3); scene.add(key);
const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
window.renderOne = async (url) => {
  const g = await loader.loadAsync(url);
  const m = g.scene;
  scene.add(m);
  const box = new THREE.Box3().setFromObject(m);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getBoundingSphere(new THREE.Sphere()).radius;
  const d = r / Math.sin(THREE.MathUtils.degToRad(11)) * 1.02;
  const dir = new THREE.Vector3(0, 0.22, 1).normalize();
  camera.position.copy(c).addScaledVector(dir, d);
  camera.lookAt(c);
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL('image/png');
  scene.remove(m);
  return png;
};
window.ready = true;
</script></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-proxy-server'] });
const page = await browser.newPage();
await page.route('http://sprite.local/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' });
  const file = path.startsWith('/garnish/') ? join(DIR, path.slice('/garnish/'.length)) : join(ROOT, path);
  try {
    route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
  } catch {
    route.fulfill({ status: 404, body: 'missing' });
  }
});
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto('http://sprite.local/');
await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
for (const id of ids) {
  const dataUrl = await page.evaluate((u) => window.renderOne(u), `/garnish/${id}.glb`);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  const out = join(DIR, `${id}.webp`);
  const buf = await sharp(png).trim({ threshold: 1 }).resize(512, 512, { fit: 'inside' }).webp({ quality: 84, alphaQuality: 90 }).toBuffer();
  writeFileSync(out, buf);
  const meta = await sharp(buf).metadata();
  console.log(`${id}.webp ${meta.width}×${meta.height} ${(buf.length / 1024).toFixed(0)} KB`);
}
await browser.close();
