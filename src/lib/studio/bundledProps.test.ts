/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BUNDLED_PROPS, BUNDLED_PROP_MAP, bundledPropUrls, propAnchorConfig, supersededPieceIds } from './bundledProps';
import { FINISHES } from './finish';
import { ANCHOR_PRESETS } from '../faceRig';
import { HEAD_PIECES, HEAD_PIECE_MAP } from '../headPieces';

const onDisk = (p: string) => existsSync(new URL(`../../../public${p}`, import.meta.url));

describe('the bundled prop catalogue is real', () => {
  it('has props with unique ids, names and urls', () => {
    expect(BUNDLED_PROPS.length).toBeGreaterThan(0);
    for (const key of ['id', 'name', 'url'] as const) {
      const vals = BUNDLED_PROPS.map((p) => p[key]);
      expect(new Set(vals).size, `duplicate ${key}`).toBe(vals.length);
    }
  });

  it('the map mirrors the list', () => {
    expect(Object.keys(BUNDLED_PROP_MAP)).toHaveLength(BUNDLED_PROPS.length);
    for (const p of BUNDLED_PROPS) expect(BUNDLED_PROP_MAP[p.id]).toBe(p);
  });

  // Same-origin is the load-bearing rule: a third-party CDN on the booth's
  // critical path is what cost the AR layer on bad venue wifi once already.
  it('ships every GLB and thumb from public/, app-absolute', () => {
    for (const p of BUNDLED_PROPS) {
      expect(p.url, `${p.id} url`).toMatch(/^\/models\/props\/[a-z0-9-]+\.glb$/);
      expect(p.thumb, `${p.id} thumb`).toMatch(/^\/models\/props\/[a-z0-9-]+\.webp$/);
      expect(onDisk(p.url), `${p.id} GLB missing on disk`).toBe(true);
      expect(onDisk(p.thumb), `${p.id} thumb missing on disk`).toBe(true);
    }
  });

  it('names a finish that exists — these meshes carry no material of their own', () => {
    const ids = new Set<string>(FINISHES.map((f) => f.id));
    for (const p of BUNDLED_PROPS) expect(ids.has(p.finish), `${p.id} finish ${p.finish}`).toBe(true);
  });

  it('anchors to a real head attachment point', () => {
    const ids = new Set(ANCHOR_PRESETS.map((a) => a.id));
    for (const p of BUNDLED_PROPS) expect(ids.has(p.anchor), `${p.id} anchor ${p.anchor}`).toBe(true);
  });

  /**
   * The scales here were tuned by eye against a tracked face because
   * computePropFitScale's answer (PROP_TARGET_CM / a ~1.9-unit bbox = 12.64)
   * renders these meshes about three times too large. This pins them into the
   * band that was verified, so a future edit cannot quietly restore the
   * face-covering crown.
   */
  it('keeps every authored scale in the verified band', () => {
    for (const p of BUNDLED_PROPS) {
      expect(p.scale, `${p.id} scale`).toBeGreaterThanOrEqual(1);
      expect(p.scale, `${p.id} scale`).toBeLessThanOrEqual(8);
    }
  });

  it('keeps offsets within head-space reach (centimetres)', () => {
    for (const p of BUNDLED_PROPS) {
      for (const v of p.offset) expect(Math.abs(v), `${p.id} offset`).toBeLessThanOrEqual(20);
      for (const v of p.rotation) expect(Math.abs(v), `${p.id} rotation`).toBeLessThanOrEqual(Math.PI * 2);
    }
  });

  it('supersedes only procedural pieces that actually exist', () => {
    for (const p of BUNDLED_PROPS) {
      if (!p.supersedes) continue;
      expect(HEAD_PIECE_MAP[p.supersedes], `${p.id} supersedes ${p.supersedes}`).toBeDefined();
    }
  });

  // The bug that got reported, as an assertion: whatever the library shelf ends
  // up offering, no two entries may share a name — that is what made the old
  // and new crown indistinguishable.
  it('leaves the library shelf with no duplicate names', () => {
    const superseded = supersededPieceIds();
    const shelf = [
      ...HEAD_PIECES.filter((p) => !superseded.has(p.id)).map((p) => p.name),
      ...BUNDLED_PROPS.map((p) => p.name),
    ];
    expect(new Set(shelf).size, `duplicate shelf names: ${shelf.join(', ')}`).toBe(shelf.length);
  });

  it('never hides a procedural piece without offering a replacement', () => {
    expect(supersededPieceIds().size).toBeLessThan(HEAD_PIECES.length);
  });

  it('lists every url once for preloading', () => {
    const urls = bundledPropUrls();
    expect(new Set(urls).size).toBe(urls.length);
    for (const p of BUNDLED_PROPS) expect(urls).toContain(p.url);
  });

  it('maps placement into the anchorConfig shape without reordering axes', () => {
    for (const p of BUNDLED_PROPS) {
      const c = propAnchorConfig(p);
      expect([c.offset.x, c.offset.y, c.offset.z]).toEqual(p.offset);
      expect([c.rotation.x, c.rotation.y, c.rotation.z]).toEqual(p.rotation);
      expect(c.scale).toBe(p.scale);
    }
  });

  // The owner's standing mandate: nothing in the self-serve library may carry
  // branding from the three frozen legacy events.
  it('is generic — never names a legacy event', () => {
    const words = ['scago', 'hope gala', 'gala', 'jenna', 'jake', 'detola', 'wuyi'];
    for (const p of BUNDLED_PROPS) {
      const text = `${p.id} ${p.name} ${p.url}`.toLowerCase();
      for (const w of words) expect(text.includes(w), `${p.id} mentions "${w}"`).toBe(false);
    }
  });
});
