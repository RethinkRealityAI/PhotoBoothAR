import { describe, it, expect } from 'vitest';
import { classifyGlbError, glbErrorMessage, describeGlbError, type GlbLoadIssue } from './glbErrors';

const ALL: GlbLoadIssue[] = ['draco', 'ktx2', 'meshopt', 'network', 'parse', 'unknown'];

describe('classifyGlbError', () => {
  it('names Draco — the failure Blender produces BY DEFAULT', () => {
    // The literal message three's GLTFLoader throws with no decoder registered.
    expect(classifyGlbError(new Error('THREE.GLTFLoader: No DRACOLoader instance provided.'))).toBe('draco');
    expect(classifyGlbError('KHR_draco_mesh_compression')).toBe('draco');
  });

  it('names KTX2/Basis', () => {
    expect(classifyGlbError(new Error('THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures'))).toBe('ktx2');
    expect(classifyGlbError('KHR_texture_basisu')).toBe('ktx2');
  });

  it('names Meshopt', () => {
    expect(classifyGlbError(new Error('THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files'))).toBe('meshopt');
    expect(classifyGlbError('EXT_meshopt_compression')).toBe('meshopt');
  });

  it('separates "never got the bytes" from "the bytes are wrong"', () => {
    expect(classifyGlbError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyGlbError({ type: 'error', target: { status: 404 } })).toBe('network');
    expect(classifyGlbError({ type: 'error', target: { status: 503 } })).toBe('network');
    expect(classifyGlbError('blocked by CORS policy')).toBe('network');
    expect(classifyGlbError(new SyntaxError('Unexpected token < in JSON at position 0'))).toBe('parse');
    expect(classifyGlbError(new Error('THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported.'))).toBe('parse');
  });

  it('prefers the compression cause when the message also mentions glTF', () => {
    // Both words appear; "draco" must win or the host is told to re-export as
    // .glb, which it already is.
    expect(classifyGlbError(new Error('THREE.GLTFLoader: No DRACOLoader instance provided.'))).toBe('draco');
  });

  it('never throws on anything a loader might hand it', () => {
    for (const junk of [undefined, null, '', 0, {}, [], new Error(''), { target: {} }]) {
      expect(ALL).toContain(classifyGlbError(junk));
    }
  });
});

describe('glbErrorMessage', () => {
  it('gives every issue a non-empty sentence a host can act on', () => {
    for (const issue of ALL) {
      const m = glbErrorMessage(issue);
      expect(m.length).toBeGreaterThan(20);
      expect(m).toMatch(/[.!]$/);
    }
  });

  it('tells the host to re-export for a compression failure, and only then', () => {
    for (const issue of ['draco', 'ktx2', 'meshopt'] as const) {
      expect(glbErrorMessage(issue).toLowerCase()).toContain('re-export');
    }
    // A dropped connection is NOT the file's fault and must not send the host
    // off to re-export a perfectly good model.
    expect(glbErrorMessage('network').toLowerCase()).not.toContain('re-export');
  });
});

describe('describeGlbError', () => {
  it('classifies and describes in one call', () => {
    const d = describeGlbError(new Error('No DRACOLoader instance provided.'));
    expect(d.issue).toBe('draco');
    expect(d.message).toBe(glbErrorMessage('draco'));
  });
});
