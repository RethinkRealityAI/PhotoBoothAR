/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turning a GLTFLoader failure into something a HOST can act on.
 *
 * Every GLB load in this app used to end at `console.error(...)` and an empty
 * rectangle: the guest saw no crown, the host saw no reason. The most common
 * real cause is compression — Blender's "glTF (.glb)" export enables Draco by
 * default, and a Draco-compressed file fails with a message ("No DRACOLoader
 * instance provided") that means nothing to someone uploading a tiara.
 *
 * PURE — string in, enum + copy out. Deliberately holds no three.js import so a
 * node-env vitest file can cover it.
 */

export type GlbLoadIssue =
  /** Draco geometry compression, and no decoder was registered. */
  | 'draco'
  /** KTX2 / Basis Universal supercompressed textures. */
  | 'ktx2'
  /** EXT_meshopt_compression. */
  | 'meshopt'
  /** Never reached the bytes: offline, CORS, 404, storage down. */
  | 'network'
  /** Bytes arrived but are not a glTF we can read. */
  | 'parse'
  | 'unknown';

/** Everything we might be handed: an Error, an ErrorEvent, a string, a DOM
 *  ProgressEvent from XHR, or (from a rejected loader) `undefined`. */
function messageOf(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'object') {
    const o = err as { message?: unknown; type?: unknown; target?: { status?: unknown } };
    const parts: string[] = [];
    if (typeof o.message === 'string') parts.push(o.message);
    if (typeof o.type === 'string') parts.push(o.type);
    const status = o.target?.status;
    if (typeof status === 'number') parts.push(`status ${status}`);
    if (parts.length) return parts.join(' ');
  }
  return String(err);
}

/**
 * Classify a GLB load failure.
 *
 * Order matters: a Draco file whose decoder is missing throws a message that
 * ALSO contains "glTF", so the compression checks must run before the generic
 * parse check.
 */
export function classifyGlbError(err: unknown): GlbLoadIssue {
  const m = messageOf(err).toLowerCase();
  if (!m) return 'unknown';
  if (m.includes('draco') || m.includes('khr_draco_mesh_compression')) return 'draco';
  if (m.includes('ktx2') || m.includes('basis') || m.includes('khr_texture_basisu')) return 'ktx2';
  if (m.includes('meshopt') || m.includes('ext_meshopt_compression')) return 'meshopt';
  if (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('cors') ||
    m.includes('load error') ||
    m.includes('status 0') ||
    /status (4|5)\d\d/.test(m) ||
    m === 'error'
  ) return 'network';
  if (m.includes('unexpected token') || m.includes('unsupported') || m.includes('gltf') || m.includes('json')) return 'parse';
  return 'unknown';
}

/**
 * One sentence, addressed to the host, that names the cause and the fix.
 *
 * These are shown in the studio (upload / Director card), never to a guest —
 * a guest can do nothing about a compression format, so the booth stays silent
 * and simply renders without the piece.
 */
export function glbErrorMessage(issue: GlbLoadIssue): string {
  switch (issue) {
    case 'draco':
      return 'This model uses Draco compression the booth could not decode. Re-export it from Blender with Compression turned OFF and upload again.';
    case 'ktx2':
      return 'This model uses KTX2/Basis compressed textures, which the booth cannot read. Re-export it with standard PNG or JPEG textures.';
    case 'meshopt':
      return 'This model uses Meshopt compression the booth could not decode. Re-export it without mesh compression.';
    case 'network':
      return "The model file could not be downloaded — check the connection and try again. Nothing is wrong with the file itself.";
    case 'parse':
      return 'That file is not a glTF/GLB the booth can read. Export it as .glb (glTF Binary) and try again.';
    default:
      return 'The booth could not open that 3D model. Try re-exporting it as an uncompressed .glb.';
  }
}

/** Convenience: classify and describe in one call. */
export function describeGlbError(err: unknown): { issue: GlbLoadIssue; message: string } {
  const issue = classifyGlbError(err);
  return { issue, message: glbErrorMessage(issue) };
}
