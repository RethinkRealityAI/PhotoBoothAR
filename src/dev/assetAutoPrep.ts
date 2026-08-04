/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEV pipeline utility: build a library-asset descriptor for a TEXTURED GLB by
 * classifying vertices from the albedo texels their UVs cover — the automated
 * sibling of /dev/asset-prep's human painting, for assets whose regions are
 * separable by COLOUR (a red lens in a dark frame, a violet gem on a brown
 * shaft). Runs the SAME pure engine (assetPrep.measureRegionLuminances +
 * buildTemplateDescriptor), so refLuminance is measured for real — shipping
 * the 0.18 placeholder renders a region blown out, not merely off-colour.
 *
 * Driven headlessly (Playwright page.evaluate → dynamic import) or from the
 * console of any DEV page. Never bundled into production routes.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  buildTemplateDescriptor,
  measureRegionLuminances,
  type PrepRegionDraft,
} from '../lib/studio/assetPrep';

export interface AutoRegionRule {
  id: string;
  label: string;
  defaultHex: string;
  /** Return true when an albedo texel (0-255 RGB) belongs to this region.
   *  Rules run in order; the LAST region is the catch-all (rule ignored). */
  match: (r: number, g: number, b: number) => boolean;
}

export interface AutoPrepResult {
  descriptor: unknown;
  /** Vertex counts per region, for a sanity read before pasting. */
  counts: number[];
  /** Mean albedo per region as #rrggbb (a better defaultHex candidate). */
  meanHex: string[];
}

export async function autoPrepDescriptor(
  glbUrl: string,
  id: string,
  name: string,
  fitCm: number,
  rules: AutoRegionRule[],
): Promise<AutoPrepResult> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (mesh === null && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (mesh === null) throw new Error('no mesh in GLB');
  const m = mesh as THREE.Mesh;
  const geo = m.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const index = geo.getIndex();
  if (!pos || !uv || !index) throw new Error('mesh lacks position/uv/index');

  const material = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  const image = material.map?.image as CanvasImageSource & { width: number; height: number };
  if (!image) throw new Error('no albedo texture');
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  // Classify each vertex from the texel under its UV (glTF v=0 at image top).
  const n = pos.count;
  const ids = new Uint8Array(n);
  const counts = new Array<number>(rules.length).fill(0);
  const sums = rules.map(() => [0, 0, 0]);
  for (let i = 0; i < n; i++) {
    let u = uv.getX(i) % 1;
    let v = uv.getY(i) % 1;
    if (u < 0) u += 1;
    if (v < 0) v += 1;
    const px = Math.min(canvas.width - 1, Math.floor(u * canvas.width));
    const py = Math.min(canvas.height - 1, Math.floor(v * canvas.height));
    const o = (py * canvas.width + px) * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    let region = rules.length - 1; // catch-all
    for (let k = 0; k < rules.length - 1; k++) {
      if (rules[k].match(r, g, b)) {
        region = k;
        break;
      }
    }
    ids[i] = region;
    counts[region]++;
    sums[region][0] += r; sums[region][1] += g; sums[region][2] += b;
  }

  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uvs[i * 2] = uv.getX(i);
    uvs[i * 2 + 1] = uv.getY(i);
  }
  const indices = new Uint32Array(index.count);
  for (let i = 0; i < index.count; i++) indices[i] = index.getX(i);

  // MEASURED per-region mean linear luminance — the load-bearing step.
  const measured = measureRegionLuminances(rgba, canvas.width, canvas.height, uvs, indices, ids);

  const meanHex = counts.map((c, k) => {
    if (c === 0) return '#888888';
    const hx = (v: number) => Math.round(v / c).toString(16).padStart(2, '0');
    return `#${hx(sums[k][0])}${hx(sums[k][1])}${hx(sums[k][2])}`;
  });

  const regions: PrepRegionDraft[] = rules.map((rule, k) => ({
    id: rule.id,
    label: rule.label,
    recolourable: true,
    defaultHex: rule.defaultHex,
    refLuminance: measured[k]?.luminance ?? 0.18,
    index: k,
  }));

  const descriptor = buildTemplateDescriptor({
    id,
    name,
    glbUrl,
    fitCm,
    regions,
    regionIds: ids,
    textSlots: [],
    humanEdited: false,
  });

  return { descriptor, counts, meanHex };
}
