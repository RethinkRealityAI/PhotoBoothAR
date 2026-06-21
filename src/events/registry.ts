import type { EventConfig } from './types';
import { DEFAULT_EVENT_ID } from './eventId';
import { hopeGala } from './hope-gala/config';

const REGISTRY: Record<string, EventConfig> = {
  [hopeGala.id]: hopeGala,
};

export function getEventConfig(slug: string): EventConfig {
  return REGISTRY[slug] ?? REGISTRY[DEFAULT_EVENT_ID];
}
