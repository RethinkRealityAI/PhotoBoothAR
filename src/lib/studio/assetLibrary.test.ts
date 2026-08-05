/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_LIBRARY_ASSETS,
  LIBRARY_ASSETS,
  LIBRARY_ASSET_CHECKLIST,
  LIBRARY_EMPTY_MESSAGE,
  assetTemplateOf,
  findLibraryAsset,
  libraryAssets,
  type ConfigurableAsset,
} from './assetLibrary';
import { isConfigurable } from './assetTemplate';
import { DEFAULT_REF_LUMINANCE, MAX_REGIONS, unpackRegionIds } from './regionTint';

const ALL: ConfigurableAsset[] = [...LIBRARY_ASSETS, ...DEMO_LIBRARY_ASSETS];

describe('the shelf a host actually sees', () => {
  it('ships the authored shelf — and ONLY authored content, no demo entries', () => {
    // This asserted `toEqual([])` while the library was honestly empty; each
    // real asset (descriptor authored + refLuminance measured) changes the
    // honest state, not the honesty rule. Power-Ups added the visor (worn),
    // wand (held) and gauntlet (hand-worn) — the first hand-anchored entries.
    expect(libraryAssets(false).map((a) => a.id)).toEqual([
      'baseball-cap',
      'cyclops-visor',
      'wizard-wand',
      'power-gauntlet',
    ]);
  });

  it('adds the demo entries only under DEV', () => {
    expect(libraryAssets(true).length).toBe(LIBRARY_ASSETS.length + DEMO_LIBRARY_ASSETS.length);
    expect(libraryAssets(true).some((a) => a.demo)).toBe(true);
  });

  it('never lets a demo entry into the shipped list', () => {
    for (const a of LIBRARY_ASSETS) expect(a.demo).toBeFalsy();
    for (const a of DEMO_LIBRARY_ASSETS) expect(a.demo).toBe(true);
  });

  it('looks an entry up under the same DEV gate, so a demo id cannot be reached in production', () => {
    for (const a of DEMO_LIBRARY_ASSETS) {
      expect(findLibraryAsset(a.id, true)?.id).toBe(a.id);
      expect(findLibraryAsset(a.id, false)).toBeNull();
    }
    expect(findLibraryAsset('nope', true)).toBeNull();
  });

  it('ships copy for the empty state rather than leaving a blank panel', () => {
    expect(LIBRARY_EMPTY_MESSAGE.length).toBeGreaterThan(20);
    expect(LIBRARY_ASSET_CHECKLIST.length).toBeGreaterThan(0);
  });
});

describe('every catalogued entry is a descriptor the app will actually accept', () => {
  it('has unique ids across both lists', () => {
    const ids = ALL.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const asset of ALL) {
    describe(asset.id, () => {
      it('survives normalizeTemplate — a catalogue entry that validates to null is dead weight', () => {
        expect(assetTemplateOf(asset)).not.toBeNull();
      });

      it('offers the host something to change', () => {
        expect(isConfigurable(assetTemplateOf(asset))).toBe(true);
      });

      it('round-trips UNCHANGED, so the shipped data is already canonical', () => {
        const t = assetTemplateOf(asset)!;
        // A catalogue entry that gets rewritten by the validator means the file
        // and the render disagree about what the asset is.
        expect(t).toEqual(asset.template);
      });

      it('points at a repo-local model — no runtime CDN fetch on the booth path', () => {
        const t = assetTemplateOf(asset)!;
        expect(t.glbUrl.startsWith('/')).toBe(true);
        expect(t.glbUrl).not.toMatch(/^https?:/i);
      });

      it('stays inside the GLSL uniform bound', () => {
        expect(assetTemplateOf(asset)!.regions.length).toBeLessThanOrEqual(MAX_REGIONS);
      });

      it('gives every recolourable region a real reference luminance', () => {
        for (const r of assetTemplateOf(asset)!.regions) {
          // 0 would be a divide-by-almost-zero and paint the part pure white.
          expect(r.refLuminance).toBeGreaterThan(0);
          expect(r.refLuminance).toBeLessThanOrEqual(1);
        }
      });

      it('has tile copy, so the grid is not a row of unlabelled boxes', () => {
        expect(asset.name.trim().length).toBeGreaterThan(0);
        expect(asset.blurb.trim().length).toBeGreaterThan(0);
        expect(asset.swatch).toHaveLength(2);
        for (const s of asset.swatch) expect(s).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  }
});

describe('the baseball cap — the contracts its render depends on', () => {
  const cap = () => assetTemplateOf(findLibraryAsset('baseball-cap')!)!;

  it('was prepared by a human, with hand-painted regions', () => {
    expect(cap().preparedBy).toBe('human');
    expect(cap().regions.map((r) => r.id)).toEqual(['crown', 'brim', 'button']);
  });

  it('carries one packed region id per GLB vertex — FaceRig IGNORES a mismatched buffer', () => {
    // 26,464 is baseball-cap.glb's POSITION count. If either side changes, the
    // asset silently degrades to whole-asset styling (ensureRegionAttribute's
    // guard), which is exactly the regression this test exists to catch.
    const bytes = unpackRegionIds(cap().regionIds!);
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBe(26464);
  });

  it('every packed byte indexes a real region — the positional uniform contract', () => {
    const t = cap();
    const bytes = unpackRegionIds(t.regionIds!)!;
    let max = 0;
    for (const b of bytes) if (b > max) max = b;
    expect(max).toBeLessThan(t.regions.length);
  });

  it('ships MEASURED reference luminances, not the placeholder — the blown-out-part guard', () => {
    for (const r of cap().regions) {
      expect(r.refLuminance).not.toBe(DEFAULT_REF_LUMINANCE);
    }
    // The button's bake is genuinely darker than the crown's; a copy-pasted
    // shared value would be the tell that nobody measured.
    const byId = Object.fromEntries(cap().regions.map((r) => [r.id, r.refLuminance]));
    expect(byId.button).toBeLessThan(byId.crown);
  });

  it('engraves on the crown FRONT surface, not the bounding-box face', () => {
    const slot = cap().textSlots[0];
    // The mesh's front-most vertex is at z 0.946; the crown front panel sits
    // near z 0.44. A slot at the box face would need decalDepth ~1 to reach
    // fabric — this one sits ON the surface with a shallow projector.
    expect(slot.position[2]).toBeGreaterThan(0.3);
    expect(slot.position[2]).toBeLessThan(0.6);
    expect(slot.normal).toEqual([0, 0, 1]);
    expect(slot.decalDepth).toBeLessThanOrEqual(0.4);
  });
});

describe('Power-Ups gear — authored placement so a fresh add fits a real guest', () => {
  // These numbers were tuned by the owner against a live camera. The add path
  // computes scale as fitScale * fitCm / PROP_TARGET_CM, so the REAL-WORLD size
  // is the thing to author; the rest is placement the anchor cannot know.
  it('the visor ships the size and brow placement that fit a real face', () => {
    const visor = findLibraryAsset('cyclops-visor')!;
    expect(assetTemplateOf(visor)!.fitCm).toBeCloseTo(16.33, 2);
    expect(visor.defaultNudgeCm).toEqual({ x: 0, y: 0.4, z: -6.4 });
    expect(visor.defaultOcclude).toBe(true);
  });

  it('the gauntlet ships the rotation that lands it ON the wrist', () => {
    const g = findLibraryAsset('power-gauntlet')!;
    // DERIVED from the mesh, replacing hand-tuned values that crossed the
    // gauntlet's fingers over the mannequin's by ~30 degrees (checked in the
    // orbit view). Measured headlessly over all 33,005 vertices: the long PCA
    // axis runs toward the fingers at [0.249,-0.132,0.960] and the palm-outward
    // normal at [0.030,-0.989,-0.143] — the latter independently agreeing with
    // the authored palm emitter, which fires along GLB -y. Rotating those onto
    // the tracked hand frame (+Y wrist->fingers, +Z out of the palm) is this.
    expect(g.defaultRotationDeg).toEqual({ x: -98.49, y: -14.01, z: -3.78 });
    // The NUDGE is still the owner's, deliberately: deriving it the same way
    // put the gauntlet ~5cm too far up the hand, so one of the frames that
    // derivation assumes is not what it appears to be. Values a human checked
    // against a real hand beat a derivation that fails its own screenshot.
    expect(g.defaultNudgeCm).toEqual({ x: -0.7, y: -1.9, z: 2.1 });
    // fitCm 30 already lands the owner's size — authoring a rotation must not
    // quietly change how big the piece arrives. Measured: the hand portion is
    // 1.209 of the mesh's 1.898 longest units, so this renders 19.1cm of hand
    // against an adult mean of 18.6cm.
    expect(assetTemplateOf(g)!.fitCm).toBe(30);
  });

  it('the gauntlet declares the hand it was modelled for, so it can serve both', () => {
    // Without this the mirror never engages and the orbit mannequin has nothing
    // to hand itself by — the two halves of "fits either hand" both hang off it.
    const g = findLibraryAsset('power-gauntlet')!;
    expect(assetTemplateOf(g)!.modelledHand).toBe('left');
    expect(g.handAnchor).toBe('wristBack');
    // The symmetric gear stays agnostic: declaring a hand it does not have
    // would make the renderer mirror a wand for no reason.
    expect(assetTemplateOf(findLibraryAsset('wizard-wand')!)!.modelledHand).toBeUndefined();
    expect(assetTemplateOf(findLibraryAsset('cyclops-visor')!)!.modelledHand).toBeUndefined();
  });

  it('an entry with no authored placement stays exactly as before', () => {
    const cap = findLibraryAsset('baseball-cap')!;
    expect(cap.defaultRotationDeg).toBeUndefined();
    expect(cap.defaultOcclude).toBeUndefined();
  });
});

describe('Power-Ups gear — beam emitters survive validation and sit on the mesh', () => {
  // The fired beam parents to the template emitter; a gear whose emitter is
  // dropped by normalizeTemplate silently falls back to the generic head/hand
  // origin — the exact "beam doesn't come from the asset" bug this fixes.
  const cases: [string, [number, number, number]][] = [
    ['cyclops-visor', [0, 0, 1]], // lens front, firing forward
    // The wand's VISIBLE shaft runs along X (the +z extent is flat ribbon
    // geometry that fools a whole-mesh PCA); grip maps +x to "up out of the
    // fist", so the beam leaves the +x crystal along +x.
    ['wizard-wand', [1, 0, 0]],
    ['power-gauntlet', [0, -1, 0]], // palm, firing out of the open hand
  ];
  for (const [id, direction] of cases) {
    it(`${id} carries a validated emitter firing along ${JSON.stringify(direction)}`, () => {
      const t = assetTemplateOf(findLibraryAsset(id)!)!;
      expect(t.emitter).toBeDefined();
      expect(t.emitter!.direction).toEqual(direction);
      // GLB-local space: inside the asset's roughly unit box, never at origin
      // (an all-zero position would mean nobody measured).
      for (const c of t.emitter!.position) expect(Math.abs(c)).toBeLessThan(1.1);
      expect(Math.hypot(...t.emitter!.position)).toBeGreaterThan(0.1);
    });
  }
});

describe('GENERIC BY MANDATE — no legacy-event branding may reach the library', () => {
  // Owner, verbatim: "make sure we remove all the hard-coded templates, like the
  // SCAGO gala or any that have specific branding for any of the legacy events."
  // starterScenes.test.ts enforces the same rule against BuiltinBorder.legacy;
  // assets carry no such flag, so the guard is an explicit deny-list.
  const BRANDED = [
    'scago', 'hope gala', 'hope-gala', 'hopegala', 'galabooth',
    'jenna', 'jake', 'jennajake', 'jenna-jake',
    'detola', 'wuyi', 'adetoyi', 'theadetoyis',
  ];

  it('has no branded token in any id, name, blurb or descriptor', () => {
    for (const asset of ALL) {
      const haystack = `${asset.id} ${asset.name} ${asset.blurb} ${JSON.stringify(asset.template)}`.toLowerCase();
      for (const token of BRANDED) {
        expect(haystack).not.toContain(token);
      }
    }
  });
});

describe('default nudge — a cap rides at the hairline, not the brow', () => {
  it('ships an authored +y starting offset the host can still edit away', () => {
    const cap = findLibraryAsset('baseball-cap')!;
    expect(cap.defaultNudgeCm).toBeDefined();
    expect(cap.defaultNudgeCm!.y).toBeGreaterThan(0);
  });
});
