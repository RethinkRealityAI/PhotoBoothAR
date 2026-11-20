/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Try on (/admin/library) — the pure half: turn a library row into exactly the
 * props the guest booth hands Overlay3D, and step a fit by one nudge.
 *
 * NOT A SECOND PIPELINE. Pieces come from draftMapping.layerToPiece — the one
 * mapper Booth, StudioPreview and Studio3DView share — and a nudged fit is
 * previewed by running the row's config through admin-api's own
 * applyItemFit (libraryImport.ts, imported directly, never mirrored), so the
 * preview is byte-for-byte the config that Save writes.
 *
 * Occlusion is always ON here (Booth's `occlusionEnabled` gate plus the
 * scene-level `occlude` fallback): judging a hat means seeing its back hidden
 * by your head, which is how it looks to guests once occlusion is the default.
 *
 * No DOM, no three.js, no supabase import — vitest runs it in node.
 */
import { layerToPiece } from './studio/draftMapping';
import {
  FIT_OFFSET_MAX,
  FIT_ROTATION_MAX,
  FIT_SCALE_MAX,
  FIT_SCALE_MIN,
  applyItemFit,
  fitTargetOf,
  type ItemFit,
} from '../../supabase/functions/admin-api/libraryImport.ts';
import type { AnchorConfig, ExperienceLayer } from '../types';
import type { Overlay3DPiece } from '../components/booth/Overlay3D';

export { fitTargetOf, type ItemFit };

/** The columns Try on reads from an `experiences` row. */
export interface TryOnRow {
  id: string;
  kind: string;
  asset_url: string | null;
  config: Record<string, unknown> | null;
}

/** What Overlay3D needs, the way Booth derives it (Booth.tsx is3D / anchorConfig / overlayPieces). */
export interface TryOnScene {
  anchor: AnchorConfig;
  assetUrl: string | null;
  proceduralId: string | null;
  /** null = the single-piece path (a row with no layers), as in Booth. */
  pieces: Overlay3DPiece[] | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The booth's render spec for a row, or null when there is nothing to wear
 * (a frame, a filter, or a 3D row without an anchor). `fit`, when given, is
 * applied first exactly as Save would write it; an unfittable row ignores it.
 */
export function tryOnScene(row: TryOnRow, fit?: ItemFit | null): TryOnScene | null {
  const fitted = fit ? applyItemFit(row.config, fit) : null;
  const config = fitted ?? row.config;
  if (!isObj(config) || !isObj(config.anchor)) return null;
  const layers = Array.isArray(config.layers) ? (config.layers as ExperienceLayer[]) : null;
  const procedural = typeof config.procedural === 'string' ? config.procedural : null;
  const has3D =
    (row.kind === '3d_attachment' && (!!row.asset_url || !!procedural)) ||
    (row.kind === 'composite' && !!layers?.some((l) => l.kind === '3d_attachment'));
  if (!has3D) return null;
  const pieces = layers
    ? layers
        // Booth's filter. A trigger-revealed piece shows straight away here
        // (there is nothing to trigger it), so the whole look is judged at once.
        .filter((l) => l.kind === '3d_attachment' && !!l.anchor && l.hidden !== true)
        .map((l) => layerToPiece(l, { occlusionEnabled: true, customizationEnabled: true }))
    : null;
  if (pieces && pieces.length === 0) return null;
  return {
    anchor: config.anchor as unknown as AnchorConfig,
    assetUrl: row.asset_url,
    proceduralId: procedural,
    pieces,
  };
}

/** The fit stored on the row's one worn piece, or null when it cannot be fitted here. */
export function currentFit(row: TryOnRow): ItemFit | null {
  const t = fitTargetOf(row.config);
  if (t === null || !isObj(row.config)) return null;
  const a = (t >= 0 ? (row.config.layers as Record<string, unknown>[])[t].anchor : row.config.anchor) as Record<string, unknown>;
  const vec = (v: unknown) => {
    const r = isObj(v) ? v : {};
    const n = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : 0);
    return { x: n('x'), y: n('y'), z: n('z') };
  };
  const s = typeof a.scale === 'number' && Number.isFinite(a.scale) && a.scale > 0 ? a.scale : 1;
  return { offset: vec(a.offset), rotation: vec(a.rotation), scale: s };
}

export type NudgeAxis = 'x' | 'y' | 'z';
export type Nudge =
  | { kind: 'move'; axis: NudgeAxis; dir: 1 | -1 }
  | { kind: 'tilt'; axis: NudgeAxis; dir: 1 | -1 }
  | { kind: 'scale'; dir: 1 | -1 };

/** One tap: 2.5 mm, 2 degrees, 3% — small enough to settle a hat's brim. */
export const NUDGE_MOVE_CM = 0.25;
export const NUDGE_TILT_RAD = (2 * Math.PI) / 180;
export const NUDGE_SCALE = 1.03;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Keeps stored values short and free of float dust (0.30000000000000004). */
const tidy = (v: number) => Math.round(v * 10_000) / 10_000;

/** The fit after one nudge, clamped inside what the server accepts. `big` = 4 taps. */
export function nudgeFit(fit: ItemFit, n: Nudge, big = false): ItemFit {
  const times = big ? 4 : 1;
  if (n.kind === 'scale') {
    const s = fit.scale * Math.pow(NUDGE_SCALE, n.dir * times);
    return { ...fit, scale: tidy(clamp(s, FIT_SCALE_MIN, FIT_SCALE_MAX)) };
  }
  if (n.kind === 'move') {
    const v = fit.offset[n.axis] + n.dir * NUDGE_MOVE_CM * times;
    return { ...fit, offset: { ...fit.offset, [n.axis]: tidy(clamp(v, -FIT_OFFSET_MAX, FIT_OFFSET_MAX)) } };
  }
  const r = fit.rotation[n.axis] + n.dir * NUDGE_TILT_RAD * times;
  return { ...fit, rotation: { ...fit.rotation, [n.axis]: tidy(clamp(r, -FIT_ROTATION_MAX, FIT_ROTATION_MAX)) } };
}

export function sameFit(a: ItemFit | null, b: ItemFit | null): boolean {
  if (a === null || b === null) return a === b;
  const v = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) =>
    p.x === q.x && p.y === q.y && p.z === q.z;
  return a.scale === b.scale && v(a.offset, b.offset) && v(a.rotation, b.rotation);
}

/** A fit in words for the panel: "Up 0.5 cm · Back 0.25 cm · 106% · tilted 4°". */
export function describeFit(fit: ItemFit, base: ItemFit): string {
  const parts: string[] = [];
  const d = (k: NudgeAxis) => tidy(fit.offset[k] - base.offset[k]);
  const cm = (v: number) => `${Math.abs(v)} cm`;
  if (d('y') !== 0) parts.push(`${d('y') > 0 ? 'Up' : 'Down'} ${cm(d('y'))}`);
  if (d('x') !== 0) parts.push(`${d('x') > 0 ? 'Right' : 'Left'} ${cm(d('x'))}`);
  if (d('z') !== 0) parts.push(`${d('z') > 0 ? 'Forward' : 'Back'} ${cm(d('z'))}`);
  const pct = Math.round((fit.scale / base.scale) * 100);
  if (pct !== 100) parts.push(`${pct}% size`);
  const deg = Math.round(((fit.rotation.x - base.rotation.x) * 180) / Math.PI);
  // Checked on a tracked face: +x rotation drops the front of a cap's brim.
  if (deg !== 0) parts.push(`tipped ${deg > 0 ? 'forward' : 'back'} ${Math.abs(deg)}°`);
  return parts.length ? parts.join(' · ') : 'As saved';
}
