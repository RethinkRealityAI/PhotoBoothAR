/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Magazine cover Frames in AR: builds the cover that stands up in the room
 * (WorldStage mounts it in place of the flat standee).
 *
 * It is a FRAME, not a box: nothing sits behind the guests, so there is
 * nothing to hide behind them (no occlusion to get wrong).
 *  - A thick lacquered or metal frame, life size (COVER_W × COVER_H), with a
 *    thin accent trim and two feet.
 *  - The masthead as extruded 3D type, HANGING from the top bar on two cords
 *    and swaying a little.
 *  - The cover lines, the guests' names and the bottom banner as panels that
 *    float free in front of the frame, each bobbing on its own rhythm. They
 *    are painted by the same block painters as the selfie cover (render2d.ts).
 *  - The template's Meshy garnishes (flowers, balloons, stars…) at the
 *    corners, the floaters drifting.
 *
 * Origin: the frame's bottom-centre on the floor, +z towards the camera.
 */
import * as THREE from 'three';
import { FontLoader, RoundedBoxGeometry, TextGeometry, type Font } from 'three-stdlib';
import { loadModel } from '../glbCache';
import {
  COVER_BAR, COVER_DEPTH, COVER_H, COVER_TYPEFACE, COVER_W,
  type CoverFontId, type CoverFrameFinish, type CoverTemplate,
} from './templates';
import type { ResolvedCover } from './spec';
import { loadCoverFonts, paintBanner, paintIssueStrap, paintLineBlock, paintStarBlock } from './render2d';

export interface CoverObject {
  group: THREE.Group;
  /** Outer size (m), for the placement reticle. */
  w: number;
  h: number;
  /** Advance the sways and bobs (ms clock). */
  tick(now: number): void;
  /** Free what this cover made (shared garnish models are left to their cache). */
  dispose(): void;
}

/* ── Typefaces ─────────────────────────────────────────────────────────── */

const typefaces = new Map<string, Promise<Font>>();

function loadTypeface(id: CoverFontId): Promise<Font> {
  const name = COVER_TYPEFACE[id];
  let p = typefaces.get(name);
  if (!p) {
    p = fetch(`/fonts/cover/typeface/${name}.json`)
      .then((r) => {
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`typeface ${name}: ${r.status}`);
        return r.json();
      })
      .then((json) => new FontLoader().parse(json));
    p.catch(() => { if (typefaces.get(name) === p) typefaces.delete(name); });
    typefaces.set(name, p);
  }
  return p;
}

/* ── Materials ─────────────────────────────────────────────────────────── */

function frameMaterial(f: CoverFrameFinish): THREE.MeshPhysicalMaterial {
  switch (f) {
    case 'gold': return new THREE.MeshPhysicalMaterial({ color: '#d8b25a', metalness: 1, roughness: 0.26 });
    case 'white': return new THREE.MeshPhysicalMaterial({ color: '#f6f3ec', roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12 });
    case 'black': return new THREE.MeshPhysicalMaterial({ color: '#141418', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    case 'blush': return new THREE.MeshPhysicalMaterial({ color: '#efc4c2', roughness: 0.42, clearcoat: 0.8, sheen: 0.4 });
    case 'navy': return new THREE.MeshPhysicalMaterial({ color: '#1a2948', roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.1 });
    case 'red': return new THREE.MeshPhysicalMaterial({ color: '#b3122d', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    case 'pastel': return new THREE.MeshPhysicalMaterial({ color: '#d4e6f8', roughness: 0.45, clearcoat: 0.7 });
  }
}

/** Light inks read as satin metal, dark ones as gloss lacquer. */
function typeMaterial(hex: string): THREE.MeshPhysicalMaterial {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const golden = hsl.h > 0.08 && hsl.h < 0.17 && hsl.s > 0.35;
  return new THREE.MeshPhysicalMaterial({
    color: c,
    metalness: golden ? 0.9 : 0.15,
    roughness: golden ? 0.28 : 0.34,
    clearcoat: golden ? 0 : 1,
    clearcoatRoughness: 0.1,
  });
}

/* ── Panels ────────────────────────────────────────────────────────────── */

/** Pixels per metre of a floating panel. */
const PX_PER_M = 1150;

/**
 * Paint a block onto a tall scratch canvas, crop it to what was drawn, and
 * make a plane of that size (m) facing the camera.
 */
function panel(widthM: number, paint: (ctx: CanvasRenderingContext2D, widthPx: number) => number, maxAniso: number): THREE.Mesh | null {
  const wPx = Math.round(widthM * PX_PER_M);
  const pad = 40;
  const cv = document.createElement('canvas');
  cv.width = wPx + pad * 2;
  cv.height = 1400;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.translate(pad, pad);
  const bottom = Math.min(cv.height - pad * 2, Math.ceil(paint(ctx, wPx)));
  const out = document.createElement('canvas');
  out.width = cv.width;
  out.height = bottom + pad * 2;
  out.getContext('2d')?.drawImage(cv, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(out.width / PX_PER_M, out.height / PX_PER_M),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = 5;
  return mesh;
}

/* ── Build ─────────────────────────────────────────────────────────────── */

interface Mover { obj: THREE.Object3D; base: THREE.Vector3; baseRot: THREE.Euler; amp: number; speed: number; phase: number; spin?: number }

export async function buildCover3D(cover: ResolvedCover, maxAniso = 4): Promise<CoverObject> {
  const t: CoverTemplate = cover.template;
  const [font] = await Promise.all([
    loadTypeface(t.masthead.font),
    loadCoverFonts([t.masthead.font, t.lineFont, 'anton', 'playfair']),
  ]);

  const owned = { geos: [] as THREE.BufferGeometry[], mats: [] as THREE.Material[], texs: [] as THREE.Texture[] };
  const keep = <T extends THREE.Mesh>(m: T): T => {
    owned.geos.push(m.geometry);
    const mat = m.material as THREE.MeshBasicMaterial;
    owned.mats.push(mat);
    if (mat.map) owned.texs.push(mat.map);
    return m;
  };
  const group = new THREE.Group();
  group.name = `cover:${t.id}`;
  const W = COVER_W;
  const H = COVER_H;
  const B = COVER_BAR;
  const D = COVER_DEPTH;

  // ── The frame: four rounded bars, an accent trim, two feet.
  const frameMat = frameMaterial(t.frame);
  owned.mats.push(frameMat);
  const bar = (w: number, h: number, x: number, y: number) => {
    const m = keep(new THREE.Mesh(new RoundedBoxGeometry(w, h, D, 3, 0.018), frameMat));
    m.position.set(x, y, 0);
    group.add(m);
  };
  bar(W, B, 0, H - B / 2);
  bar(W, B, 0, B / 2);
  bar(B, H - B * 2 + 0.002, -W / 2 + B / 2, H / 2);
  bar(B, H - B * 2 + 0.002, W / 2 - B / 2, H / 2);
  const trimMat = new THREE.MeshPhysicalMaterial({ color: t.accent, metalness: 0.85, roughness: 0.3 });
  owned.mats.push(trimMat);
  const tw = 0.008;
  const inset = B * 0.5;
  for (const [w, h, x, y] of [
    [W - inset * 2, tw, 0, H - inset], [W - inset * 2, tw, 0, inset],
    [tw, H - inset * 2, -W / 2 + inset, H / 2], [tw, H - inset * 2, W / 2 - inset, H / 2],
  ] as const) {
    const m = keep(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.004), trimMat));
    m.position.set(x, y, D / 2 + 0.002);
    group.add(m);
  }
  const footMat = new THREE.MeshStandardMaterial({ color: '#1c1c22', roughness: 0.32, metalness: 0.85 });
  owned.mats.push(footMat);
  for (const x of [-W / 2 + B / 2, W / 2 - B / 2]) {
    const m = keep(new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.03, 0.42, 2, 0.01), footMat));
    m.position.set(x, 0.015, 0);
    group.add(m);
  }

  const movers: Mover[] = [];
  const addMover = (obj: THREE.Object3D, amp: number, speed: number, phase: number, spin?: number) =>
    movers.push({ obj, base: obj.position.clone(), baseRot: obj.rotation.clone(), amp, speed, phase, spin });

  // ── The masthead: extruded type hanging from the top bar.
  const text = cover.masthead;
  const probe = new TextGeometry(text, { font, size: 1, height: 0.01, curveSegments: 4, letterSpacing: t.masthead.tracking });
  probe.computeBoundingBox();
  const pb = probe.boundingBox!;
  probe.dispose();
  const fitW = (W - B * 2) * 0.9;
  const size = Math.min(0.3, fitW / Math.max(0.01, pb.max.x - pb.min.x));
  const mastGeo = new TextGeometry(text, {
    font, size, height: 0.045, curveSegments: 6, letterSpacing: t.masthead.tracking * size,
    bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004,
  });
  mastGeo.computeBoundingBox();
  const mb = mastGeo.boundingBox!;
  // Centre it: x on the middle, y so its cap top is the hang point, z on the frame plane.
  mastGeo.translate(-(mb.min.x + mb.max.x) / 2, -mb.max.y, -(mb.min.z + mb.max.z) / 2);
  const mastMat = typeMaterial(t.ink);
  const mast = keep(new THREE.Mesh(mastGeo, mastMat));
  const cord = 0.11;
  mast.position.y = -cord;
  const hang = new THREE.Group();
  hang.position.set(0, H - B, 0.015);
  hang.add(mast);
  const cordMat = new THREE.MeshStandardMaterial({ color: t.accent, metalness: 0.7, roughness: 0.35 });
  owned.mats.push(cordMat);
  const mw = mb.max.x - mb.min.x;
  for (const x of [-mw * 0.32, mw * 0.32]) {
    const c = keep(new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, cord + 0.01, 6), cordMat));
    c.position.set(x, -cord / 2, 0);
    hang.add(c);
    const ring = keep(new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 14), cordMat));
    ring.position.set(x, -cord, 0);
    hang.add(ring);
  }
  group.add(hang);
  addMover(hang, 0, 0.85, 0, 1);
  const mastBottom = H - B - cord - (mb.max.y - mb.min.y);

  // ── Floating panels: the same blocks the selfie cover prints.
  const float = (m: THREE.Mesh | null, x: number, yTop: number, z: number, yaw: number, phase: number) => {
    if (!m) return;
    keep(m);
    const h = (m.geometry as THREE.PlaneGeometry).parameters.height;
    m.position.set(x, yTop - h / 2, z);
    m.rotation.y = yaw;
    group.add(m);
    addMover(m, 0.012, 0.7 + phase * 0.13, phase);
  };
  const innerL = -W / 2 + B;
  const innerR = W / 2 - B;

  float(panel(W - B * 2, (ctx, w) => paintIssueStrap(ctx, t, cover.issue, cover.dateLine, 0, w, 6, 1.1) + 8, maxAniso),
    0, mastBottom - 0.05, 0.08, 0, 0.3);

  const colM = 0.46;
  let ly = mastBottom - 0.22;
  cover.left.slice(0, 2).forEach((line, i) => {
    const m = panel(colM, (ctx, w) => paintLineBlock(ctx, t, line, 0, 0, w, 'left', 1.2), maxAniso);
    float(m, innerL + colM / 2 + 0.03, ly, 0.22 + i * 0.06, 0.16, 1 + i);
    if (m) ly -= (m.geometry as THREE.PlaneGeometry).parameters.height + 0.06;
  });
  let ry = mastBottom - 0.22;
  cover.right.slice(0, 1).forEach((line) => {
    const m = panel(colM, (ctx, w) => paintLineBlock(ctx, t, line, w, 0, w, 'right', 1.2), maxAniso);
    float(m, innerR - colM / 2 - 0.03, ry, 0.26, -0.16, 3);
    if (m) ry -= (m.geometry as THREE.PlaneGeometry).parameters.height + 0.08;
  });
  const starM = panel(0.62, (ctx, w) => paintStarBlock(ctx, t, cover.star, w, 0, w, 'right', 1.35), maxAniso);
  float(starM, innerR - 0.31 - 0.02, Math.min(ry, 1.2), 0.34, -0.2, 4);
  const bannerM = panel(W * 0.78, (ctx, w) => paintBanner(ctx, t, cover.banner, w / 2, 0, w, 1.25), maxAniso);
  float(bannerM, 0, 0.5, 0.42, 0, 5);

  // ── Garnishes: the template's Meshy models, at the corners.
  const garnishes = await Promise.all(t.garnish3d.map(async (g) => {
    try {
      const master = await loadModel(`/models/garnish/${g.id}.glb`);
      const obj = master.clone(true);
      obj.scale.setScalar(g.size);
      obj.position.set(g.x, g.y, g.z);
      const [rx, ry2, rz] = (g.rot ?? [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d));
      obj.rotation.set(rx, ry2, rz);
      // Resting pieces sit ON the floor, never through it.
      if (!g.float) {
        const box = new THREE.Box3().setFromObject(obj);
        if (box.min.y < 0.005) obj.position.y += 0.005 - box.min.y;
      }
      return { g, obj };
    } catch (e) {
      console.warn('[cover] garnish failed', g.id, e);
      return null;
    }
  }));
  garnishes.forEach((r, i) => {
    if (!r) return;
    group.add(r.obj);
    if (r.g.float) addMover(r.obj, 0.025, 0.55 + (i % 3) * 0.12, i * 1.7);
  });

  return {
    group,
    w: W,
    h: H,
    tick(now: number) {
      const s = now / 1000;
      for (const m of movers) {
        const k = s * m.speed + m.phase;
        if (m.spin !== undefined) {
          // The hanging masthead: a slow pendulum about its cords.
          m.obj.rotation.z = Math.sin(k) * 0.022;
          m.obj.rotation.x = Math.sin(k * 0.73 + 1.1) * 0.03;
          continue;
        }
        m.obj.position.y = m.base.y + Math.sin(k) * m.amp;
        m.obj.rotation.y = m.baseRot.y + Math.sin(k * 0.6) * 0.03;
      }
    },
    dispose() {
      group.removeFromParent();
      for (const g of owned.geos) g.dispose();
      for (const m of owned.mats) m.dispose();
      for (const x of owned.texs) x.dispose();
    },
  };
}
