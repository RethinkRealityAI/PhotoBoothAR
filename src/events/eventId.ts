/**
 * Resolves the active event id from the build env. Kept free of any React/asset
 * imports so the data layer can import it cheaply. id === slug === DB event_id.
 */
export const DEFAULT_EVENT_ID = 'hope-gala';

export function resolveEventId(raw?: string): string {
  const slug = (raw ?? '').trim();
  return slug.length ? slug : DEFAULT_EVENT_ID;
}

export const EVENT_ID = resolveEventId(import.meta.env.VITE_EVENT as string | undefined);
