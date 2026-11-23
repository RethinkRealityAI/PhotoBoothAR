/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The keepsake-film scene intro (hyperframes/card-scene-intro) runs a
 * GENERATED copy of src/lib/cardDesigns.ts, so the film and the live card
 * open the same way. This goes red when the copy is stale.
 * Fix: node scripts/build-scene-intro.mjs
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sceneFrameBundle } from '../../scripts/build-scene-intro.mjs';

describe('card scene intro — generated opening maths', () => {
  it('hyperframes/card-scene-intro/scene-frame.js matches src/lib/cardDesigns.ts', () => {
    const committed = readFileSync('hyperframes/card-scene-intro/scene-frame.js', 'utf8');
    expect(
      committed === sceneFrameBundle(),
      'scene-frame.js is stale. Run: node scripts/build-scene-intro.mjs',
    ).toBe(true);
  });
});
