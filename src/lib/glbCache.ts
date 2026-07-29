/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE SHARED GLB LOADER + CACHE.
 *
 * Before this file the same .glb was downloaded and parsed up to FOUR times on
 * one host's journey, by four private loaders that knew nothing of each other:
 *   ar/FaceRig.tsx:19          a Map<url, Promise<Group>>          (booth + studio live)
 *   studio/DirectorCards.tsx   a second Map<url, Promise<Group>>   (approve viewer)
 *   studio/glbThumb.ts:52      `new GLTFLoader()` per measure       (auto-fit)
 *   studio/glbThumb.ts:94      `new GLTFLoader()` per thumbnail     (dock tile)
 * AssetsDock.tsx:357/363 calls the last two back-to-back on the SAME url, so a
 * 12 MB Meshy model was pulled and parsed twice before the host even saw the
 * tile. Everything now goes through `loadModel`.
 *
 * DECODERS. All four loaders were constructed bare, so a Draco-compressed GLB —
 * what Blender's glTF exporter produces by DEFAULT — failed outright. The single
 * loader below registers a DRACO decoder served from our OWN origin (copied out
 * of the installed `three` package by scripts/copy-three-decoders.mjs, the same
 * idiom scripts/copy-mediapipe.mjs established) and three-stdlib's self-contained
 * Meshopt decoder. No new dependency, no CDN.
 * NOT registered: KTX2/Basis. Its loader needs a live WebGLRenderer for
 * `detectSupport()` and there is no renderer at load time on the booth path; a
 * KTX2 file therefore still fails — but it now fails through `lib/glbErrors.ts`
 * with a sentence naming the cause, instead of a bare console.error.
 *
 * OWNERSHIP / DISPOSAL. The cache OWNS every geometry, material and texture it
 * hands out. Callers `clone(true)` (which SHARES those resources) and must never
 * dispose a clone — that would free the cache's GPU objects out from under every
 * other live copy. A caller that genuinely needs to mutate-and-destroy asks for
 * `loadModelDisposable`, which parses fresh and hands over ownership.
 */
import * as THREE from 'three';
import { DRACOLoader, GLTFLoader, MeshoptDecoder } from 'three-stdlib';

/** Where scripts/copy-three-decoders.mjs puts the Draco runtime. Resolved
 *  against Vite's base so a sub-path deploy still finds it. */
const DRACO_PATH = `${import.meta.env.BASE_URL ?? '/'}three/draco/`.replace(/\/{2,}/g, '/');

let _loader: GLTFLoader | null = null;
let _draco: DRACOLoader | null = null;

/**
 * The one configured GLTFLoader.
 *
 * Built lazily: constructing a DRACOLoader spins up a Worker pool the moment
 * `preload()` is called, and most sessions never open a 3D asset at all.
 */
export function gltfLoader(): GLTFLoader {
  if (_loader) return _loader;
  const loader = new GLTFLoader();
  try {
    _draco = new DRACOLoader();
    _draco.setDecoderPath(DRACO_PATH);
    loader.setDRACOLoader(_draco);
  } catch (e) {
    // A missing decoder must never take the whole loader down: an UNcompressed
    // GLB (the overwhelming majority) still loads perfectly without Draco.
    console.warn('[glbCache] DRACO decoder unavailable — compressed models will fail', e);
  }
  try {
    loader.setMeshoptDecoder(MeshoptDecoder);
  } catch (e) {
    console.warn('[glbCache] Meshopt decoder unavailable', e);
  }
  _loader = loader;
  return loader;
}

/** url -> the master scene. Never resolved twice for one url. */
const _cache = new Map<string, Promise<THREE.Group>>();

/**
 * Load `url` once and hand back the CACHE-OWNED master scene.
 *
 * Callers that render it must `clone(true)` (R3F cannot mount one Object3D at
 * two places, and the master must stay pristine) and must NOT dispose either
 * the clone or the master.
 */
export function loadModel(url: string): Promise<THREE.Group> {
  let hit = _cache.get(url);
  if (!hit) {
    hit = new Promise<THREE.Group>((resolve, reject) => {
      gltfLoader().load(url, (g) => resolve(g.scene), undefined, reject);
    });
    // A failed load must not poison the cache forever: a guest who lost the
    // radio for one second would otherwise never see that crown again this
    // session, however many times they re-picked it.
    void hit.catch(() => { if (_cache.get(url) === hit) _cache.delete(url); });
    _cache.set(url, hit);
  }
  return hit;
}

/**
 * Load `url` into a FRESH scene the caller owns and must dispose.
 *
 * For consumers that re-parent or mutate the graph (glbThumb's offscreen
 * render). Deliberately uncached — handing a mutable master to two owners is
 * how a "shared cache" becomes a corruption bug.
 */
export function loadModelDisposable(url: string): Promise<THREE.Group> {
  return new Promise<THREE.Group>((resolve, reject) => {
    gltfLoader().load(url, (g) => resolve(g.scene), undefined, reject);
  });
}

/** Warm the cache without rendering. Resolves either way — a preload that
 *  failed is not an error, it just means the real load will retry. */
export function preloadModel(url: string): Promise<void> {
  return loadModel(url).then(
    () => undefined,
    () => undefined,
  );
}

/** True once `url`'s bytes are parsed and a scene is in the cache. */
export function isModelCached(url: string): boolean {
  return _cache.has(url);
}

/**
 * Free every geometry / material / texture under a scene graph.
 *
 * `material.dispose()` does NOT free its textures, so a textured Meshy model
 * would leak GPU memory per load without the inner sweep. Moved here from
 * lib/studio/glbThumb.ts unchanged — it is now the disposal routine for every
 * GLB in the app, not just thumbnails.
 */
export function disposeSceneResources(root: THREE.Object3D | null | undefined) {
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
 * Drop one url from the cache and free its GPU resources.
 *
 * DANGEROUS while clones are on screen (they share the freed geometry). Only
 * call for a url the app has stopped rendering — e.g. an asset the host deleted.
 */
export function evictModel(url: string): void {
  const hit = _cache.get(url);
  if (!hit) return;
  _cache.delete(url);
  void hit.then((scene) => disposeSceneResources(scene), () => {});
}

/** Test/teardown hook: empty the cache and release the Draco worker pool. */
export function clearModelCache(): void {
  for (const url of [..._cache.keys()]) evictModel(url);
  _draco?.dispose();
  _draco = null;
  _loader = null;
}
