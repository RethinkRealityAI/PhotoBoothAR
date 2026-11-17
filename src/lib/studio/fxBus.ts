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
import type { TriggerAction, TriggerSource } from './triggers';

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

/* ── emitter registry ─────────────────────────────────────────────────────────
 *
 * Live "fire from HERE" points. A rendered piece registers an object (a
 * THREE.Object3D placed at its template's emitter point, INSIDE the piece's own
 * transform chain) under its fx key; BeamFX looks the key up per frame and
 * follows that object's world transform — which is how a beam rides the exact
 * rig (face or hand), anchor offset, scale, mirror flip and animation of the
 * piece that fired it, without this module knowing any of that exists.
 *
 * Values are opaque `object`s so this stays three-free and node-testable.
 * Stack semantics per key: the same key registered twice (e.g. the Power-Ups
 * modal over a mounted preview) resolves to the most recent registrant, and
 * unregistering restores the previous one.
 */

const emitters = new Map<string, object[]>();

export function registerFxEmitter(key: string, obj: object): () => void {
  const stack = emitters.get(key) ?? [];
  stack.push(obj);
  emitters.set(key, stack);
  return () => unregisterFxEmitter(key, obj);
}

export function unregisterFxEmitter(key: string, obj: object): void {
  const stack = emitters.get(key);
  if (!stack) return;
  const i = stack.lastIndexOf(obj);
  if (i !== -1) stack.splice(i, 1);
  if (stack.length === 0) emitters.delete(key);
}

export function getFxEmitter(key: string): object | null {
  const stack = emitters.get(key);
  return stack !== undefined && stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Test hygiene only. */
export function clearFxEmitters(): void {
  emitters.clear();
}

/* ── trigger test channel ─────────────────────────────────────────────────────
 *
 * "▶ Test" on a Magic Triggers row: fire ONE trigger now, as if the guest had
 * made the gesture, so hand gestures and hand-to-temple can be tried from a
 * laptop camera. The stage owns the trigger handler (burst / reveal / animate
 * / filter pulse / beam all route there), so the dock publishes a request and
 * the stage — when mounted and subscribed — runs it. Availability is
 * observable so the button only shows when something will actually answer.
 */

export interface TriggerTestRequest {
  source: TriggerSource;
  action: TriggerAction;
}

type TriggerTestListener = (r: TriggerTestRequest) => void;

const testListeners = new Set<TriggerTestListener>();
const availabilityListeners = new Set<() => void>();

function notifyAvailability(): void {
  for (const fn of [...availabilityListeners]) fn();
}

/** Fire a trigger test. Returns false when nobody is listening (nothing ran). */
export function requestTriggerTest(r: TriggerTestRequest): boolean {
  if (testListeners.size === 0) return false;
  for (const fn of [...testListeners]) {
    try {
      fn(r);
    } catch (err) {
      console.warn('[fxBus] trigger-test subscriber threw', err);
    }
  }
  return true;
}

export function subscribeTriggerTest(fn: TriggerTestListener): () => void {
  testListeners.add(fn);
  notifyAvailability();
  return () => {
    if (testListeners.delete(fn)) notifyAvailability();
  };
}

export function hasTriggerTestSubscriber(): boolean {
  return testListeners.size > 0;
}

/** useSyncExternalStore-shaped: re-render when a stage (un)subscribes. */
export function subscribeTriggerTestAvailability(fn: () => void): () => void {
  availabilityListeners.add(fn);
  return () => {
    availabilityListeners.delete(fn);
  };
}

/** Test hygiene only. */
export function clearTriggerTestSubscribers(): void {
  testListeners.clear();
  availabilityListeners.clear();
}
