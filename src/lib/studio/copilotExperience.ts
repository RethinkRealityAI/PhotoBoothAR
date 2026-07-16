/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure builders that turn an in-chat Concierge choice (a filter id, a built-in
 * head-piece id) into an `experiences` row payload matching EXACTLY what the
 * studio's draftMapping persists — so the booth's kind-driven resolution
 * (Booth.tsx) applies them the same way whether they were authored in the
 * studio or added from the Event Concierge chat.
 *
 * Zero React / supabase imports (shaders.ts + headPieces.ts are DOM-free at
 * module load), so this runs under the vitest node env and is unit-tested.
 */
import type { ExperienceDraft } from '../../types';
import { SHADER_MAP, defaultParams } from '../shaders';
import { HEAD_PIECE_MAP } from '../headPieces';

/**
 * A filter-only experience: kind 'shader' with `config.shader = { shaderId,
 * params }` (params defaulted from the registry) — the same shape StudioShell
 * writes for a shader-only scene (draftMapping.ts draftToPayload, kind 'shader').
 * Returns null for an unknown shader id (the real gate is normalizeActions, but
 * a defensive null keeps a hallucinated id from ever reaching createExperience).
 */
export function buildFilterExperienceDraft(shaderId: string, name?: string): ExperienceDraft | null {
  const def = SHADER_MAP[shaderId];
  if (!def) return null;
  return {
    name: name?.trim() || def.name,
    kind: 'shader',
    asset_url: null,
    config: { shader: { shaderId, params: defaultParams(shaderId) } },
    is_published: true,
    featured: true,
    sort_order: 0,
  };
}

/**
 * A built-in procedural head-piece experience: kind '3d_attachment' with
 * `config.anchor` (the registry AnchorConfig) + `config.procedural` = the id
 * and no GLB asset — byte-compatible with draftMapping's singular 3D mirror.
 * Returns null for an unknown piece id.
 */
export function buildHeadPieceExperienceDraft(pieceId: string, name?: string): ExperienceDraft | null {
  const def = HEAD_PIECE_MAP[pieceId];
  if (!def) return null;
  return {
    name: name?.trim() || def.name,
    kind: '3d_attachment',
    asset_url: null,
    config: { anchor: def.config, procedural: pieceId },
    is_published: true,
    featured: true,
    sort_order: 0,
  };
}
