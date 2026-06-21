import { EVENT_ID } from './eventId';
import { getEventConfig } from './registry';

export const activeEvent = getEventConfig(EVENT_ID);
export { EVENT_ID };
