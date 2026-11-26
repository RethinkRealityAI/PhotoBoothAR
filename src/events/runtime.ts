/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runtime event resolution for the multi-tenant platform.
 *
 * loadEventConfig(slug) first consults the legacy code registry (the three
 * coded events keep working exactly as before); any other slug is looked up in
 * the live `events` table and adapted into the existing EventConfig contract
 * via buildRuntimeConfig(), so every downstream component keeps working
 * unchanged for DB-configured events.
 */
import type { EventARContent, EventConfig, EventCopy } from './types';
import { getRegisteredEvent } from './registry';
import { supabase } from '../lib/supabase';
import { createGenericVisuals } from './generic';
import { resolveBackgroundTemplate } from '../components/theme/backgrounds';
import { isEmptyBrief, normalizeBrief } from '../lib/eventBrief';
import { isUntouchedTemplateTheme } from '../lib/eventTemplates';
import { normalizeScene, resolveSceneImageUrl } from '../lib/sceneThemes';
import { normalizeEventTheme, themePackById, themePackVars } from '../lib/themePacks';
import { powerUpTriggers } from '../lib/wizard/powerUps';
import { normalizeBoothIntro } from '../lib/boothIntro';

export interface RuntimeEvent {
  /** slug — doubles as the posts/experiences/app_settings event_id. */
  eventId: string;
  /** events.id uuid for DB events; null for legacy coded events. */
  eventUuid: string | null;
  status: string;
  planTier: string;
  config: EventConfig;
  source: 'code' | 'db';
  /** events.starts_at (ISO) for DB events. Optional so coded/legacy events and
   *  every existing caller are untouched; read by the post-event album's
   *  "{when}" copy token. */
  startsAt?: string | null;
  /** Raw `events.config.keepsakes` (unvalidated). Readers MUST pass it through
   *  normalizeKeepsakeSettings — it is whatever the row holds. */
  keepsakes?: unknown;
}

/** The three grandfathered coded events (direct-write RLS still allows them). */
export const LEGACY_EVENT_IDS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

/** Wrap a registry EventConfig as a RuntimeEvent (source: 'code'). */
export function codeRuntimeEvent(slug: string, config: EventConfig): RuntimeEvent {
  return {
    eventId: config.id,
    eventUuid: null,
    status: 'live',
    planTier: 'legacy',
    config,
    source: 'code',
  };
}

interface EventRow {
  id: string;
  slug: string;
  name: string | null;
  event_type: string | null;
  status: string;
  config: Record<string, unknown> | null;
  plan_tier: string | null;
  starts_at?: string | null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Generic copy set for DB events; row.config.copy fields override per key. */
function buildRuntimeCopy(name: string, cfg: Record<string, unknown>): EventCopy {
  const base: EventCopy = {
    eyebrow: name,
    eventName: name,
    tagline: 'Scan to capture your AR moment',
    fullName: name,
    thankYou: `Thank you for celebrating with us at ${name}!`,
    steps: [
      { title: 'Scan QR', body: '' },
      { title: 'Pick a Look', body: '' },
      { title: 'Snap Photo', body: '' },
      { title: 'Share', body: '' },
    ],
    onboardingSteps: [
      { eyebrow: 'Step One', title: 'Choose Your Look', body: 'Pick an Effect, then layer it with a Frame — they were designed to pair beautifully together.' },
      { eyebrow: 'Step Two', title: 'Flip & Adorn', body: 'Tap to flip between front and back cameras, and try a 3D accessory tracked live to your head.' },
      { eyebrow: 'Step Three', title: 'Photo or Video', body: 'Press the shutter for a single frame, or switch to Video to record a short clip with sound, motion and your effects.' },
      { eyebrow: 'Step Four', title: 'Send & Shine', body: 'Set a hands-free timer for the perfect pose, then beam your moment straight to the live wall.' },
      // Gestures exist but nothing taught them — this is the only surface that
      // can. Legacy coded events keep their own registry copy untouched; a DB
      // event's config.copy.onboardingSteps override also replaces this list.
      { eyebrow: 'Step Five', title: 'Handy Moves', body: 'Swipe the camera to change your look · double-tap to flip the camera.' },
    ],
    filePrefix: name.replace(/[^a-zA-Z0-9]+/g, '') || 'PhotoBooth',
    shareTitle: name,
    momentTitle: `My ${name} Moment`,
    shareText: `My moment from ${name}.`,
  };

  const overrides = (cfg.copy ?? {}) as Partial<EventCopy>;
  const out: EventCopy = { ...base };
  for (const key of [
    'eyebrow', 'eventName', 'tagline', 'fullName', 'thankYou',
    'filePrefix', 'shareTitle', 'momentTitle', 'shareText',
    // Generated-once guest lines (eventCopy.ts) — optional on EventCopy, so a
    // blank/absent value leaves the key off the object entirely.
    'welcomeIntro', 'keepsakeIntro', 'generatedAt',
  ] as const) {
    const v = str(overrides[key]);
    if (v) out[key] = v;
  }
  if (Array.isArray(overrides.steps) && overrides.steps.length) out.steps = overrides.steps;
  if (Array.isArray(overrides.onboardingSteps) && overrides.onboardingSteps.length) {
    out.onboardingSteps = overrides.onboardingSteps;
  }
  return out;
}

/** Adapt an `events` row into the coded EventConfig contract. */
export function buildRuntimeConfig(row: EventRow): EventConfig {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const name = str(cfg.name) ?? str(row.name) ?? row.slug;
  const visuals = createGenericVisuals(name);
  const accentHexes = Array.isArray(cfg.accentHexes) && cfg.accentHexes.every((h) => typeof h === 'string')
    ? (cfg.accentHexes as string[])
    : ['#D4AF37', '#E8C766', '#FBF3D9', '#B8860B'];
  // Permissive default manifest: empty allow-lists expose every built-in
  // shader/border/head-piece (see pick() in lib/catalog.ts).
  const arContent = (cfg.arContent && typeof cfg.arContent === 'object'
    ? cfg.arContent
    : {}) as EventARContent;
  // Ambient background: config.background_template picks from the template
  // registry; missing/unknown ids fall back to the default (aurora).
  const background = resolveBackgroundTemplate(cfg.background_template);
  // Greeting-card landing override (set by the studio's "Make event landing"
  // button): config.primary_card = { publicId } → "/" redirects to /c/:publicId.
  const primaryCard = (cfg.primary_card ?? null) as { publicId?: unknown } | null;
  const primaryCardPublicId =
    primaryCard && typeof primaryCard === 'object' ? str(primaryCard.publicId) : undefined;
  // Shared event brief (config.brief): normalized through the one coercer the
  // copilot/concierge use; a missing or content-free brief stays undefined so
  // consumers can `?? null` it without a second emptiness check.
  const brief = cfg.brief === null || cfg.brief === undefined ? undefined : normalizeBrief(cfg.brief);
  // Keepsake style new cards start from. Host-only setting; guests never pick.
  const defaultCardTemplate = str(cfg.default_card_template);
  // The brand look: set explicitly (new events, Branding's "Beamwall" look),
  // or by default for an event that never chose its colours (an untouched
  // occasion theme). `look: null` is Branding's explicit opt-out. The template
  // tokens are dropped so the brand tokens show (platform.css).
  const rawThemeVars = (cfg.themeVars && typeof cfg.themeVars === 'object'
    ? (cfg.themeVars as Record<string, string>)
    : {});
  // Guest-page scene (lib/sceneThemes): absent/invalid = today's background.
  const scene = normalizeScene(cfg.scene);
  // The splash phone's own photo (under the event frame); invalid = default.
  const boothScreen = resolveSceneImageUrl(cfg.boothScreen);
  // Event-wide power-ups (setup wizard): preset ids → booth triggers.
  const powerUps = powerUpTriggers(cfg.powerUps);
  // Beamy's booth intro (setup wizard): only stored when the host touched it.
  const boothIntro = cfg.boothIntro !== undefined ? normalizeBoothIntro(cfg.boothIntro) : undefined;
  // A full theme pack (lib/themePacks): when set, it IS the look — its
  // tokens replace themeVars, the brand look is off, and its own self-hosted
  // fonts load. Absent/unknown = everything below exactly as before.
  const theme = normalizeEventTheme(cfg.theme);
  const themeVars = theme ? themePackVars(theme) : null;
  const brandLook = !theme && (cfg.look === 'beamwall' || (cfg.look === undefined && isUntouchedTemplateTheme(rawThemeVars)));

  return {
    id: row.slug,
    copy: buildRuntimeCopy(name, cfg),
    fontHref: (theme ? themePackById(theme.pack)?.fonts.href : undefined) ?? str(cfg.fontHref) ?? '',
    Wordmark: visuals.Wordmark,
    Mark: visuals.Mark,
    Emblem: visuals.Emblem,
    Background: background.component,
    backgroundTemplateId: background.id,
    landingRoute: str(cfg.landingRoute) ?? '/booth',
    primaryCardPublicId,
    defaultCardTemplate,
    arContent,
    accentHexes,
    defaultExperienceId: str(cfg.defaultExperienceId),
    themeVars: themeVars ?? (brandLook ? {} : rawThemeVars),
    ...(brief !== undefined && !isEmptyBrief(brief) ? { brief } : {}),
    ...(brandLook ? { look: 'beamwall' as const } : {}),
    ...(scene ? { scene } : {}),
    ...(theme ? { theme } : {}),
    ...(boothScreen ? { boothScreen } : {}),
    ...(powerUps.length > 0 ? { powerUps } : {}),
    ...(boothIntro ? { boothIntro } : {}),
  };
}

/**
 * Outcome of resolving a slug. `missing` means the lookup succeeded and there
 * is genuinely no such event; `unreachable` means we never got an answer.
 * They are kept apart deliberately: collapsing both to null told a guest on
 * bad venue wifi that the QR code in their hand was wrong.
 */
export type EventLoad =
  | { event: RuntimeEvent; error: null }
  | { event: null; error: 'missing' | 'unreachable' };

/**
 * Resolve a slug to a runtime event: coded registry first, then the `events`
 * table.
 */
export async function loadEventConfig(slug: string): Promise<EventLoad> {
  const code = getRegisteredEvent(slug);
  if (code) return { event: codeRuntimeEvent(slug, code), error: null };

  const { data, error } = await supabase
    .from('events')
    .select('id, slug, name, event_type, status, config, plan_tier, starts_at')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.error('[events] loadEventConfig', error);
    return { event: null, error: 'unreachable' };
  }
  if (!data) return { event: null, error: 'missing' };

  const row = data as EventRow;
  return {
    event: {
      eventId: row.slug,
      eventUuid: row.id,
      status: row.status,
      planTier: row.plan_tier ?? 'free',
      config: buildRuntimeConfig(row),
      source: 'db',
      startsAt: typeof row.starts_at === 'string' ? row.starts_at : null,
      keepsakes: row.config?.keepsakes,
    },
    error: null,
  };
}
