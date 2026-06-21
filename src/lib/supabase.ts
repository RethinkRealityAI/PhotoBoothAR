/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single shared Supabase browser client for the Hope Gala booth.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  // Surfaced loudly in dev so misconfiguration is obvious before the event.
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env.local and fill in your project keys.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const POSTS_BUCKET = 'posts';
export const ASSETS_BUCKET = 'assets';

/** Public CDN URL for an object already uploaded to a bucket. */
export function publicUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
