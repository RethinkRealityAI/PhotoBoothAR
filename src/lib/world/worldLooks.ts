/**
 * World mode, part 4: which looks stand up in the room.
 *
 * Every 2D border Frame an event has also appears in the Props tab as a "3D"
 * tile. Picking one switches the booth to the back camera and room placement
 * (WorldStage); picking any other prop, or none, goes back to the selfie
 * camera and face tracking. The Frames tab and the camera flip button keep
 * working exactly as before.
 *
 * The tiles are built in memory from the event's own Frames: nothing is
 * stored, and legacy events never call this (Booth gates on source === 'db').
 * Pure, so it is unit-tested in node.
 */
import type { Experience } from '../../types';

export const WORLD_LOOK_PREFIX = 'world:';

/** The art a Frame would stand up with: its own border image, or a composite's first visible border layer. */
export function frameArtUrl(exp: Experience): string | null {
  if (exp.kind === 'border' && exp.asset_url) return exp.asset_url;
  if (exp.kind !== 'composite') return null;
  const layer = exp.config?.layers?.find((l) => l.kind === 'border' && !!l.asset_url && l.hidden !== true);
  return layer?.asset_url ?? null;
}

/** A "3D" Props tile for one Frame. No asset_url: nothing else in the booth treats it as a GLB. */
export function worldLookOf(frame: Experience, frameUrl: string): Experience {
  return {
    ...frame,
    id: `${WORLD_LOOK_PREFIX}${frame.id}`,
    name: `${frame.name} 3D`,
    kind: '3d_attachment',
    asset_url: null,
    config: { world: { frameUrl, frameId: frame.id } },
  };
}

/**
 * The catalog with a "3D" tile appended for each Frame that has border art.
 * Two Frames sharing the same art get one tile (a composite and its plain
 * border twin would otherwise stand up the same board twice).
 */
export function withWorldLooks(catalog: readonly Experience[]): Experience[] {
  // One tile per art, in catalog order. When a plain border and a composite
  // share the art, the tile takes the plain border's name and id: a
  // composite's name ("Red Devil Shades") describes its 3D prop, which the
  // standing board does not carry.
  const byUrl = new Map<string, Experience>();
  for (const exp of catalog) {
    const url = frameArtUrl(exp);
    if (url === null) continue;
    const had = byUrl.get(url);
    if (!had || (had.kind !== 'border' && exp.kind === 'border')) byUrl.set(url, exp);
  }
  const extra = [...byUrl].map(([url, exp]) => worldLookOf(exp, url));
  return extra.length === 0 ? [...catalog] : [...catalog, ...extra];
}

export function isWorldLook(exp: Experience | null | undefined): boolean {
  return !!exp && exp.id.startsWith(WORLD_LOOK_PREFIX) && typeof exp.config?.world?.frameUrl === 'string';
}

export function worldLookFrameUrl(exp: Experience | null | undefined): string | null {
  return isWorldLook(exp) ? exp!.config.world!.frameUrl : null;
}
