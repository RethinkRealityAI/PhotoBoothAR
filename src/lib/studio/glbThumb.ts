/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Offscreen GLB thumbnail capture — renders an uploaded model to a small
 * transparent PNG so its dock tile shows real geometry instead of a generic
 * icon. Browser-only (WebGLRenderer + canvas + GLTFLoader's XHR): never
 * import this from a vitest (node env) test file — assetSources.ts keeps its
 * own pairing helpers pure/DOM-free for exactly that reason.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';
import { computePropFitScale } from './bustFit';

// Using three v0.184 / three-stdlib v2.36 — Box3.getBoundingSphere(target)
// requires the target Sphere argument in this version (no bare-return overload).

/** Free every geometry/material/texture under a loaded GLB scene graph.
 *  material.dispose() does NOT free its textures — a textured Meshy model
 *  would leak GPU memory per load. */
function disposeSceneResources(root: THREE.Object3D | null) {
  root?.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        for (const v of Object.values(m)) {
          if (v instanceof THREE.Texture) v.dispose();
        }
        m.dispose();
      }
    }
  });
}

/**
 * Load `url` as a GLB and return its auto-fit head-space scale (see
 * computePropFitScale). Resolves to `null` (never throws) on any load or
 * measure failure — callers dispatch without a scale and keep the legacy
 * default of 1. Measure-only: no renderer or GL context is created.
 */
/** A stalled storage/CDN response can leave GLTFLoader's XHR pending with NO
 *  error event, so the load promise would never settle and the caller's
 *  post-measure dispatch (e.g. the Director approve latch) would strand. Cap
 *  the wait and resolve null so the caller always proceeds. */
const MEASURE_TIMEOUT_MS = 15_000;

export async function measureGlbFitScale(url: string): Promise<number | null> {
  let root: THREE.Object3D | null = null;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const load = new Promise<THREE.Group>((resolve, reject) => {
    new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject);
  });
  // Late arrival: if the timeout already won, a slow-but-successful load still
  // resolves here — dispose that orphaned scene so it can't leak GPU memory.
  // This handler is registered BEFORE Promise.race's own, so on the fast/normal
  // path it runs while `settled` is still false and skips (the finally disposes
  // exactly once — no double-free). A late rejection has nothing to dispose.
  void load.then(
    (scene) => { if (settled) disposeSceneResources(scene); },
    () => {},
  );
  try {
    root = await Promise.race([
      load,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS); }),
    ]);
    if (!root) return null; // timed out — a stall never fires reject; resolve null
    return computePropFitScale(root);
  } catch (e) {
    console.warn('[glbThumb] measureGlbFitScale failed', url, e);
    return null;
  } finally {
    settled = true;
    if (timer) clearTimeout(timer);
    disposeSceneResources(root);
  }
}

/**
 * Load `url` as a GLB/GLTF, frame it in a simple two-light scene sized to its
 * bounding sphere, and render a `size`×`size` transparent PNG snapshot.
 * Resolves to `null` (never throws) on load or render failure — callers must
 * treat a missing thumbnail as best-effort, never as a failed model upload.
 * Every three.js resource created here (renderer, geometries, materials) is
 * disposed before returning, on both the success and failure paths.
 */
export async function captureGlbThumbnail(url: string, size = 256): Promise<Blob | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  let root: THREE.Object3D | null = null;
  try {
    const gltf = await new Promise<THREE.Group>((resolve, reject) => {
      new GLTFLoader().load(url, (g) => resolve(g.scene), undefined, reject);
    });
    root = gltf;

    // Fold every node's local transform into world matrices before measuring
    // (a GLB commonly carries node rotation/scale — see bustFit.ts's same fix).
    gltf.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf);
    if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null;

    const scene = new THREE.Scene();
    scene.add(gltf);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(
      sphere.center.x + sphere.radius,
      sphere.center.y + sphere.radius * 1.5,
      sphere.center.z + sphere.radius * 2,
    );
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(35, 1, Math.max(sphere.radius / 100, 0.001), sphere.radius * 20);
    const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.4;
    camera.position.set(
      sphere.center.x + dist * 0.35,
      sphere.center.y + dist * 0.25,
      sphere.center.z + dist * 0.9,
    );
    camera.lookAt(sphere.center);

    const canvas = document.createElement('canvas'); // detached — never appended to the DOM
    canvas.width = size;
    canvas.height = size;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch (e) {
    console.error('[glbThumb] captureGlbThumbnail failed', url, e);
    return null;
  } finally {
    disposeSceneResources(root);
    renderer?.dispose();
    // dispose() alone leaves the GL context alive until GC; repeated uploads
    // would hit the browser's ~16-context cap and could kill the live stage.
    renderer?.forceContextLoss();
  }
}
