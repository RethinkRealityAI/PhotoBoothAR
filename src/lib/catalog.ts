/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unified filter catalog for the booth: built-in shaders + borders/overlays
 * (from code, always available) merged with custom studio experiences (DB).
 * Everything is normalized to the `Experience` shape so the booth renders
 * uniformly by `kind`.
 */
import { Experience, PresetOverrides } from '../types';
import { FILTER_SHADERS, defaultParams } from './shaders';
import { BUILTIN_BORDERS, toDataUrl } from './borders';
import { HEAD_PIECES } from './headPieces';
import { activeEvent } from '../events/active';

const NOW = '2026-01-01T00:00:00Z';

/** Filter a list of {id} items by an allow-list. Empty/undefined list = include all. */
export function pick<T extends { id: string }>(all: T[], ids?: string[]): T[] {
  if (!ids || ids.length === 0) return all;
  const set = new Set(ids);
  return all.filter((x) => set.has(x.id));
}

function base(id: string, name: string, sort: number): Pick<Experience, 'id' | 'name' | 'created_at' | 'updated_at' | 'is_published' | 'featured' | 'sort_order' | 'thumbnail_url'> {
  return { id, name, created_at: NOW, updated_at: NOW, is_published: true, featured: true, sort_order: sort, thumbnail_url: null };
}

/** Featured cool effects shown as combinable filters (excludes 'none' + special). */
export function builtinShaderExperiences(): Experience[] {
  return pick(FILTER_SHADERS, activeEvent.arContent.shaderIds).map((s, i) => ({
    ...base(`builtin:shader:${s.id}`, s.name, 100 + i),
    kind: 'shader',
    asset_url: null,
    config: { shader: { shaderId: s.id, params: defaultParams(s.id) } },
  }));
}

export function builtinBorderExperiences(): Experience[] {
  return pick(BUILTIN_BORDERS, activeEvent.arContent.borderIds).map((b, i) => ({
    ...base(`builtin:border:${b.id}`, b.name, 200 + i),
    kind: b.kind,
    asset_url: toDataUrl(b.svg),
    config: { transform: { scale: 1, x: 0, y: 0, rotation: 0 }, opacity: 1 },
  }));
}

/** Built-in procedural 3D head pieces (crown, tiara, cheek gems) as experiences. */
export function builtinHeadPieceExperiences(): Experience[] {
  return pick(HEAD_PIECES, activeEvent.arContent.headPieceIds).map((p, i) => ({
    ...base(`builtin:3d:${p.id}`, p.name, 50 + i),
    kind: '3d_attachment',
    asset_url: null,
    config: { procedural: p.id, anchor: p.config },
  }));
}

export function builtinExperiences(): Experience[] {
  return [
    ...builtinHeadPieceExperiences(),
    ...builtinShaderExperiences(),
    ...builtinBorderExperiences(),
  ];
}

export function isBuiltin(id: string): boolean {
  return id.startsWith('builtin:');
}

/**
 * Merge built-ins with DB experiences. Admin `overrides` can hide and reorder
 * the built-in presets. Custom (DB) experiences come first (sorted by their
 * own sort_order), then the built-ins in the admin's chosen order.
 */
export function buildCatalog(
  dbExperiences: Experience[],
  overrides?: PresetOverrides,
): Experience[] {
  const custom = dbExperiences
    .filter((e) => e.is_published)
    .sort((a, b) => a.sort_order - b.sort_order);

  let builtins = builtinExperiences();

  const hidden = new Set(overrides?.hidden ?? []);
  if (hidden.size) builtins = builtins.filter((b) => !hidden.has(b.id));

  const order = overrides?.order ?? [];
  if (order.length) {
    const rank = new Map(order.map((id, i) => [id, i]));
    builtins = [...builtins].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : 1e6 + a.sort_order;
      const rb = rank.has(b.id) ? rank.get(b.id)! : 1e6 + b.sort_order;
      return ra - rb;
    });
  }

  return [...custom, ...builtins];
}
