/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Normalizes the studio's three asset sources — uploaded files, catalog
 * experiences, and (elsewhere) built-in procedural head pieces — into one
 * dock item shape for the drag-and-drop asset dock.
 */
import type { StoredAsset } from '../db';
import type { Experience } from '../../types';
import { classifyAsset } from './dnd';

export interface DockItem {
  id: string;
  label: string;
  source: 'builtin' | 'upload' | 'experience';
  family: '2d' | '3d';
  previewUrl: string | null;
  payload: {
    overlayKind?: 'border' | '2d_filter';
    url?: string;
    assetUrl?: string;
    proceduralId?: string;
  };
}

// Matches a leading UUID v4-shaped prefix followed by '-', as produced by db.ts uploadAsset's uid().
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

/** Strip a leading `<uuid>-` prefix (if present) and the file extension from an asset filename. */
function labelFromFilename(name: string): string {
  const withoutUuid = name.replace(UUID_PREFIX, '');
  return withoutUuid.replace(/\.[a-z0-9]+$/i, '');
}

// Suffix AssetsDock's GLB upload flow stamps on an auto-captured thumbnail:
// uploadAsset(blob, `${file.name}.thumb`) → `<uid>-<file.name>.thumb.png`.
const THUMB_SUFFIX = /\.thumb\.png$/i;

/** True for a GLB-thumbnail companion file (named `<asset-name>.thumb.png` by
 *  AssetsDock's GLB upload flow) — paired into its model's dock item instead
 *  of being listed as its own item. */
export function isThumbAsset(name: string): boolean {
  return THUMB_SUFFIX.test(name);
}

/**
 * Maps each non-thumb asset's normalized label to its paired thumbnail's
 * public URL. Pairing is by label match after uploadAsset's uid()-prefix and
 * extension are stripped from both sides — `<uid1>-crown.glb` pairs with
 * `<uid2>-crown.glb.thumb.png` because both normalize to "crown".
 */
export function pairThumbnails(assets: StoredAsset[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of assets) {
    if (!isThumbAsset(a.name)) continue;
    const label = labelFromFilename(a.name.replace(THUMB_SUFFIX, ''));
    map.set(label, a.url);
  }
  return map;
}

/** Normalize uploaded assets into dock items, classifying by extension/mimetype. */
export function uploadsToDockItems(assets: StoredAsset[]): DockItem[] {
  const thumbs = pairThumbnails(assets);
  const items: DockItem[] = [];
  for (const asset of assets) {
    if (asset.name.startsWith('thumb-')) continue;
    if (isThumbAsset(asset.name)) continue; // paired into its model item below, not its own item
    const cls = classifyAsset(asset.name, asset.mimetype);
    if (cls === 'unknown') continue;
    const label = labelFromFilename(asset.name);
    if (cls === 'image') {
      items.push({
        id: asset.path,
        label,
        source: 'upload',
        family: '2d',
        previewUrl: asset.url,
        payload: { url: asset.url },
      });
    } else {
      items.push({
        id: asset.path,
        label,
        source: 'upload',
        family: '3d',
        previewUrl: thumbs.get(label) ?? null,
        payload: { assetUrl: asset.url },
      });
    }
  }
  return items;
}

/** Normalize catalog experiences into dock items. Shader/composite kinds are skipped. */
export function experiencesToDockItems(exps: Experience[]): DockItem[] {
  const items: DockItem[] = [];
  for (const exp of exps) {
    if (exp.kind === 'border' || exp.kind === '2d_filter') {
      if (!exp.asset_url) continue;
      items.push({
        id: exp.id,
        label: exp.name,
        source: 'experience',
        family: '2d',
        previewUrl: exp.thumbnail_url ?? exp.asset_url,
        payload: { overlayKind: exp.kind, url: exp.asset_url },
      });
    } else if (exp.kind === '3d_attachment') {
      const proceduralId = exp.config.procedural;
      const assetUrl = exp.asset_url ?? undefined;
      if (!proceduralId && !assetUrl) continue;
      items.push({
        id: exp.id,
        label: exp.name,
        source: 'experience',
        family: '3d',
        previewUrl: exp.thumbnail_url ?? null,
        payload: proceduralId ? { proceduralId } : { assetUrl },
      });
    }
    // shader / composite: skipped — not placeable dock items.
  }
  return items;
}

/** Filter dock items by family and a case-insensitive label substring query. */
export function filterDockItems(items: DockItem[], family: '2d' | '3d', query: string): DockItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (item.family !== family) return false;
    if (!q) return true;
    return item.label.toLowerCase().includes(q);
  });
}

/* -------------------------------------------------------------------- */
/* Scene templates (W6-C) — a template is any experience saved with      */
/* config.template:true (always is_published:false; see PropertiesDock's */
/* "Save as template" and AssetsDock's Mine tab).                        */
/* -------------------------------------------------------------------- */

/** True for a reusable scene template (`config.template === true`). */
export function isTemplate(exp: Experience): boolean {
  return exp.config?.template === true;
}

/** Splits a list of experiences into templates and everything else, keeping
 *  each group's relative order. Used by AssetsDock's Mine tab to show
 *  templates as a distinct group ahead of the regular saved experiences. */
export function splitTemplates(exps: Experience[]): { templates: Experience[]; rest: Experience[] } {
  const templates: Experience[] = [];
  const rest: Experience[] = [];
  for (const exp of exps) (isTemplate(exp) ? templates : rest).push(exp);
  return { templates, rest };
}

// Suffix PropertiesDock's Save-as-template stamps on the name at save time
// (`${draft.name} (template)`) — stripped when a template is opened as a
// fresh, untitled draft so repeated reuse doesn't pile up the suffix.
const TEMPLATE_SUFFIX = /\s*\(template\)$/i;

/** Strips a trailing " (template)" suffix (case-insensitive), if present. */
export function stripTemplateSuffix(name: string): string {
  return name.replace(TEMPLATE_SUFFIX, '');
}

/* -------------------------------------------------------------------- */
/* AI-generated origin (W7-C) — the "Generated" section of the single    */
/* "My Assets" surface. BOTH server-side AI paths stamp config.generated */
/* :true on the saved experience row:                                    */
/*   • 2D frames/stickers — ai-generate-image edge fn (index.ts config)  */
/*   • 3D attachments     — ai-job-status edge fn (Meshy pipeline)        */
/* This is an EXPLICIT server-set marker, not a filename/shape heuristic. */
/* `generated` is provenance, not render config, so it's intentionally    */
/* NOT on the ExperienceConfig type — we read it through a narrow cast     */
/* (mirroring isTemplate's defensive optional access).                    */
/* -------------------------------------------------------------------- */

/** True for an experience the server marked as AI-generated (`config.generated === true`). */
export function isGenerated(exp: Experience): boolean {
  const cfg = exp.config as { generated?: unknown } | null | undefined;
  return cfg?.generated === true;
}

/**
 * Partition saved experiences into the three "My Assets" buckets, in priority
 * order: templates first (a template that is ALSO AI-generated stays a template —
 * it needs the open-as-new-draft flow, not add-as-layer), then AI-generated
 * ("Generated"), then everything else ("My experiences"). Each bucket keeps its
 * input-relative order. Supersedes splitTemplates for the single-surface dock.
 */
export function splitExperiences(exps: Experience[]): {
  templates: Experience[];
  generated: Experience[];
  mine: Experience[];
} {
  const templates: Experience[] = [];
  const generated: Experience[] = [];
  const mine: Experience[] = [];
  for (const exp of exps) {
    if (isTemplate(exp)) templates.push(exp);
    else if (isGenerated(exp)) generated.push(exp);
    else mine.push(exp);
  }
  return { templates, generated, mine };
}

/* -------------------------------------------------------------------- */
/* Kind filter chips (W7-C) — the single-surface "All · Frames ·         */
/* Stickers · Filters · 3D" filter that spans every section at once.     */
/* -------------------------------------------------------------------- */

/** The kind chips across the whole "My Assets" surface. 'filter' matches only
 *  the built-in shader list (no DockItem is ever a shader), so it keeps NO
 *  DockItem — see dockItemMatchesChip. */
export type AssetChip = 'all' | 'frame' | 'sticker' | 'filter' | '3d';

/** A DockItem's chip kind: a 3D piece, a frame overlay, a sticker overlay, or a
 *  bare 'image' — a raw uploaded 2D file with no declared overlayKind, which is
 *  placeable as EITHER a frame or a sticker (so it shows under both chips). */
export function dockItemKind(item: DockItem): 'frame' | 'sticker' | '3d' | 'image' {
  if (item.family === '3d') return '3d';
  if (item.payload.overlayKind === 'border') return 'frame';
  if (item.payload.overlayKind === '2d_filter') return 'sticker';
  return 'image';
}

/** Whether a DockItem passes a kind chip. 'all' keeps everything; 'filter' keeps
 *  nothing (shaders aren't DockItems); a bare image shows under both 'frame' and
 *  'sticker' since it can be placed as either. */
export function dockItemMatchesChip(item: DockItem, chip: AssetChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'filter') return false;
  if (chip === '3d') return item.family === '3d';
  const k = dockItemKind(item);
  return chip === 'frame' ? k === 'frame' || k === 'image' : k === 'sticker' || k === 'image';
}

/** Filter DockItems by kind chip AND a case-insensitive label substring — the
 *  single-surface replacement for filterDockItems' family+query filter. */
export function filterDockByChip(items: DockItem[], chip: AssetChip, query: string): DockItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (!dockItemMatchesChip(item, chip)) return false;
    if (!q) return true;
    return item.label.toLowerCase().includes(q);
  });
}
