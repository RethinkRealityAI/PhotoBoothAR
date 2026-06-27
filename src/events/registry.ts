import type { EventConfig } from './types';
import { DEFAULT_EVENT_ID } from './eventId';
import { hopeGala } from './hope-gala/config';
import { jennaJake } from './jenna-jake/config';
import { detolaWuyi } from './detola-wuyi/config';

const REGISTRY: Record<string, EventConfig> = {
  [hopeGala.id]: hopeGala,
  [jennaJake.id]: jennaJake,
  [detolaWuyi.id]: detolaWuyi,
};

export function getEventConfig(slug: string): EventConfig {
  const cfg = REGISTRY[slug] ?? REGISTRY[DEFAULT_EVENT_ID];
  if (!cfg) {
    throw new Error(
      `[events] No config for "${slug}" and default "${DEFAULT_EVENT_ID}" is not registered.`,
    );
  }
  return cfg;
}
