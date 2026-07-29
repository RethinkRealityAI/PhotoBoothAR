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
import { computePropFitScale } from './bustFit';
import { loadModel } from '../glbCache';

// Using three v0.184 / three-stdlib v2.36 — Box3.getBoundingSphere(target)
// requires the target Sphere argument in this version (no bare-return overload).

// LOADING + DISPOSAL MOVED TO lib/glbCache.
// This file used to construct `new GLTFLoader()` twice, so AssetsDock.tsx's
// measure-then-thumbnail sequence downloaded and parsed the SAME model twice
// before the host saw its tile. Both entry points now read the shared cache,
// which also OWNS the resources: neither function disposes what it is handed
// any more, because those geometries and materials are the ones FaceRig will
// clone from when the piece reaches the stage. (Disposing them here is exactly
// how a shared cache turns into a black, textureless model on the head.)
// The renderer created below is still disposed here — that one IS ours.

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Shared cache: measuring is READ-ONLY (computePropFitScale walks the graph
  // and never mutates it), so the master can be measured in place. The old
  // late-arrival dispose handler is gone with it — there is no orphan to clean
  // up when the timeout wins, because the cache keeps the one copy and the
  // caller who actually renders this url will reuse it.
  const load = loadModel(url);
  try {
    const root = await Promise.race([
      load,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS); }),
    ]);
    if (!root) return null; // timed out — a stall never fires reject; resolve null
    return computePropFitScale(root);
  } catch (e) {
    console.warn('[glbThumb] measureGlbFitScale failed', url, e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Load `url` as a GLB/GLTF, frame it in a simple two-light scene sized to its
 * bounding sphere, and render a `size`×`size` transparent PNG snapshot.
 * Resolves to `null` (never throws) on load or render failure — callers must
 * treat a missing thumbnail as best-effort, never as a failed model upload.
 * The only three.js resource this function OWNS is the WebGLRenderer, and it is
 * disposed AND context-lost before returning on both the success and failure
 * paths. The geometries/materials belong to lib/glbCache (see the clone note
 * below) and are deliberately left alive.
 */
export async function captureGlbThumbnail(url: string, size = 256): Promise<Blob | null> {
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    // clone(true) because this function RE-PARENTS the graph into its own
    // scene, and the cache's master must stay unparented for FaceRig. The clone
    // shares the master's geometries/materials, so it costs almost nothing and
    // is deliberately NOT disposed — those resources belong to the cache.
    const master = await loadModel(url);
    const gltf = master.clone(true);

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
    renderer?.dispose();
    // dispose() alone leaves the GL context alive until GC; repeated uploads
    // would hit the browser's ~16-context cap and could kill the live stage.
    renderer?.forceContextLoss();
  }
}
