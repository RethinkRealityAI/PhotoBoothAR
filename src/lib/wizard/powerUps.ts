/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Event-wide power-ups — the wizard's "Add a little magic" step, as data.
 *
 * A power-up is a surprise that fires whatever look the guest has on: smile
 * and the screen sparkles, flash a peace sign and hearts burst. They ride the
 * booth's existing trigger engine (the same TriggerConfig a studio scene
 * carries), merged in after the selected filter's own triggers.
 *
 * Stored as preset ids in `events.config.powerUps` — `{ v: 1, on: ['smile-sparkles'] }` —
 * never as raw trigger JSON, so a host cannot hand-write an arbitrary action
 * through the API and the presets can be retuned later without a migration.
 * Untrusted on read: unknown ids are dropped.
 */
import type { TriggerConfig, TriggerSource } from '../studio/triggers';

export type PowerUpId =
  | 'smile-sparkles'
  | 'mouth-confetti'
  | 'peace-hearts'
  | 'palm-fireworks'
  | 'fist-beam'
  | 'temple-optic';

export interface PowerUpPreset {
  id: PowerUpId;
  /** What the guest does, in plain words. */
  gesture: string;
  /** What happens. */
  effect: string;
  /** Emoji-free glyph key the tile draws (see PowerUpsStep). */
  glyph: 'smile' | 'mouth' | 'peace' | 'palm' | 'fist' | 'temple';
  /** Hand gestures load the hand tracker — a little heavier on older phones. */
  usesHands: boolean;
  source: TriggerSource;
  action: TriggerConfig['action'];
}

export const POWER_UP_PRESETS: readonly PowerUpPreset[] = [
  { id: 'smile-sparkles', gesture: 'Smile', effect: 'Sparkles shower down', glyph: 'smile', usesHands: false, source: 'smile', action: { type: 'burst', style: 'sparkles' } },
  { id: 'mouth-confetti', gesture: 'Open your mouth wide', effect: 'Confetti pops', glyph: 'mouth', usesHands: false, source: 'mouthOpen', action: { type: 'burst', style: 'confetti' } },
  { id: 'peace-hearts', gesture: 'Peace sign', effect: 'Hearts float up', glyph: 'peace', usesHands: true, source: 'peaceSign', action: { type: 'burst', style: 'hearts' } },
  { id: 'palm-fireworks', gesture: 'Show your palm', effect: 'Fireworks go off', glyph: 'palm', usesHands: true, source: 'palmOpen', action: { type: 'burst', style: 'fireworks' } },
  { id: 'fist-beam', gesture: 'Make a fist', effect: 'An energy beam blasts out', glyph: 'fist', usesHands: true, source: 'fistClench', action: { type: 'beam', style: 'energy', origin: 'hand' } },
  { id: 'temple-optic', gesture: 'Fingers to your temple', effect: 'Laser eyes', glyph: 'temple', usesHands: true, source: 'handToTemple', action: { type: 'beam', style: 'optic', origin: 'head' } },
] as const;

const PRESET_MAP: ReadonlyMap<string, PowerUpPreset> = new Map(POWER_UP_PRESETS.map((p) => [p.id, p]));

/** Trigger ids carry this prefix so they can never collide with a scene's. */
export const POWER_UP_TRIGGER_PREFIX = 'event-pu:';

export function isPowerUpId(v: unknown): v is PowerUpId {
  return typeof v === 'string' && PRESET_MAP.has(v);
}

/** Total coercion of `events.config.powerUps` → the ids that are on, in preset order. */
export function normalizePowerUps(raw: unknown): PowerUpId[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.on)) return [];
  const on = new Set(r.on.filter(isPowerUpId));
  return POWER_UP_PRESETS.filter((p) => on.has(p.id)).map((p) => p.id);
}

/** The config value to store. */
export function powerUpsConfig(on: readonly PowerUpId[]): { v: 1; on: PowerUpId[] } {
  const set = new Set(on.filter(isPowerUpId));
  return { v: 1, on: POWER_UP_PRESETS.filter((p) => set.has(p.id)).map((p) => p.id) };
}

/** The booth triggers for the stored value. Absent / empty → []. */
export function powerUpTriggers(raw: unknown): TriggerConfig[] {
  return normalizePowerUps(raw).map((id) => {
    const p = PRESET_MAP.get(id)!;
    return { id: `${POWER_UP_TRIGGER_PREFIX}${id}`, source: p.source, action: p.action, cooldownMs: 4000 };
  });
}

export function togglePowerUp(on: readonly PowerUpId[], id: PowerUpId): PowerUpId[] {
  return on.includes(id) ? on.filter((x) => x !== id) : powerUpsConfig([...on, id]).on;
}
