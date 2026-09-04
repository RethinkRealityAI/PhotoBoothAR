/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guest-facing copy generated ONCE per event from its brief — the welcome
 * intro, the thank-you line and the keepsake-email intro (plus an optional
 * tagline). Generated at create success when a brief exists, else at go-live
 * if still absent (host.goLive); never per guest and never re-generated over
 * host edits: `config.copy.generatedAt` is the idempotency stamp, and the
 * Branding overlay (mergeCopy) still wins at runtime.
 *
 * Pure half: `normalizeGeneratedCopy` + `copyPatch` (node-tested). Impure
 * half: `generateEventCopy` (lazy supabase/host imports, never throws).
 */
import { FunctionsHttpError } from '@supabase/supabase-js';
import { formatBrief, normalizeBrief } from './eventBrief';
import { reportAiError } from './eventDesigner';

export interface GeneratedCopy {
  tagline?: string;
  welcomeIntro: string;
  thankYou: string;
  keepsakeIntro: string;
}

/** Every generated line is capped here (one or two sentences). */
export const COPY_LINE_MAX = 160;

/** The server's copy-mode input contract (Lane B validates these caps). */
const COPY_INPUT_CAPS = { name: 80, eventType: 20, brief: 600, tagline: 160 } as const;

const line = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, COPY_LINE_MAX).trim() : '';

/** Coerce the model's output; null when any REQUIRED line is missing (a
 *  half-generated set must not overwrite the template defaults). */
export function normalizeGeneratedCopy(raw: unknown): GeneratedCopy | null {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const welcomeIntro = line(r.welcomeIntro);
  const thankYou = line(r.thankYou);
  const keepsakeIntro = line(r.keepsakeIntro);
  if (!welcomeIntro || !thankYou || !keepsakeIntro) return null;
  const tagline = line(r.tagline);
  return { ...(tagline ? { tagline } : {}), welcomeIntro, thankYou, keepsakeIntro };
}

/**
 * The events.config patch that records the generated lines. `updateEventConfig`
 * merges SHALLOWLY, so the whole `copy` object is rebuilt here: existing keys
 * (fullName, eventName, the template tagline, host edits) survive, generated
 * lines fill in, and `generatedAt` stamps the run.
 */
export function copyPatch(existing: unknown, gen: GeneratedCopy, now: string): { copy: Record<string, unknown> } {
  const current = (existing !== null && typeof existing === 'object' ? existing : {}) as Record<string, unknown>;
  return { copy: { ...current, ...gen, generatedAt: now } };
}

export type GenerateCopyResult =
  | { ok: true; skipped?: 'already_generated' }
  | { ok: false; reason: string };

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** formatBrief output cut to the server's cap on a line boundary. */
function briefInput(brief: unknown): string {
  const text = brief === null || brief === undefined ? '' : formatBrief(normalizeBrief(brief));
  if (text.length <= COPY_INPUT_CAPS.brief) return text;
  const cut = text.lastIndexOf('\n', COPY_INPUT_CAPS.brief);
  return cut > 0 ? text.slice(0, cut) : text.slice(0, COPY_INPUT_CAPS.brief);
}

/**
 * Generate + persist the copy for one event. Idempotent (skips when
 * `copy.generatedAt` is set); never throws; the caller (create success,
 * goLive) treats the result as informational.
 */
export async function generateEventCopy(eventUuid: string): Promise<GenerateCopyResult> {
  try {
    const [{ supabase }, { updateEventConfig }] = await Promise.all([import('./supabase'), import('./host')]);
    const { data, error } = await supabase
      .from('events')
      .select('name, event_type, config')
      .eq('id', eventUuid)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn('[eventCopy] read failed', error);
      return { ok: false, reason: 'read_failed' };
    }
    const config = (data.config ?? {}) as Record<string, unknown>;
    const copy = (config.copy !== null && typeof config.copy === 'object' ? config.copy : {}) as Record<string, unknown>;
    if (typeof copy.generatedAt === 'string' && copy.generatedAt.trim()) return { ok: true, skipped: 'already_generated' };

    const { data: res, error: fnError } = await supabase.functions.invoke('ai-event-designer', {
      body: {
        mode: 'copy',
        eventUuid,
        copyInput: {
          name: str(data.name, COPY_INPUT_CAPS.name),
          eventType: str(data.event_type, COPY_INPUT_CAPS.eventType),
          brief: briefInput(config.brief),
          tagline: str(copy.tagline, COPY_INPUT_CAPS.tagline),
        },
      },
    });
    if (fnError) {
      let reason = 'network';
      if (fnError instanceof FunctionsHttpError) {
        try {
          const body = (await fnError.context.json()) as { error?: string };
          if (typeof body.error === 'string' && body.error) reason = body.error;
        } catch { /* body unreadable */ }
      }
      console.warn('[eventCopy] ai-event-designer copy failed:', reason);
      reportAiError(`ai_event_designer:copy:${reason}`, fnError, { reason });
      return { ok: false, reason };
    }
    const gen = normalizeGeneratedCopy((res as { copy?: unknown } | null)?.copy);
    if (!gen) return { ok: false, reason: 'empty_reply' };
    const ok = await updateEventConfig(eventUuid, copyPatch(copy, gen, new Date().toISOString()));
    return ok ? { ok: true } : { ok: false, reason: 'write_failed' };
  } catch (e) {
    console.warn('[eventCopy] generateEventCopy failed', e);
    reportAiError('ai_event_designer:copy:network', e, { reason: 'network' });
    return { ok: false, reason: 'network' };
  }
}
