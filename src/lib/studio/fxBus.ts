/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tiny pub/sub for fired power-FX (beams). Exists because three different
 * surfaces publish (Booth, StudioStage preview, the Power-Ups builder) into a
 * consumer mounted three components deep inside Overlay3D's <Canvas> — a ref
 * chain through HeadScaleOverlay3D would couple all of them. No React, no
 * queue: a beam is a moment; subscribers that mount later simply miss it.
 */

import type { BeamSpec } from './beam';

export interface FxEvent {
  kind: 'beam';
  spec: BeamSpec;
}

type FxListener = (e: FxEvent) => void;

const listeners = new Set<FxListener>();

export function emitFx(e: FxEvent): void {
  for (const fn of [...listeners]) {
    try {
      fn(e);
    } catch (err) {
      // One broken preview subscriber must not kill the booth's ceremony.
      console.warn('[fxBus] subscriber threw', err);
    }
  }
}

export function subscribeFx(fn: FxListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test hygiene only. */
export function clearFxSubscribers(): void {
  listeners.clear();
}
