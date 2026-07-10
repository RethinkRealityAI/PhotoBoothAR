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
