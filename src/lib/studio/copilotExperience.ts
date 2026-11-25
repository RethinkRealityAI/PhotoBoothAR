/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure builders that turn an in-chat Concierge choice (a filter id) into an
 * `experiences` row payload matching EXACTLY what the
 * studio's draftMapping persists — so the booth's kind-driven resolution
 * (Booth.tsx) applies them the same way whether they were authored in the
 * studio or added from the Event Concierge chat.
 *
 * Zero React / supabase imports (shaders.ts is DOM-free at
 * module load), so this runs under the vitest node env and is unit-tested.
 */
import type { ExperienceDraft } from '../../types';
import { SHADER_MAP, defaultParams } from '../shaders';

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
