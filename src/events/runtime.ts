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

export interface RuntimeEvent {
  /** slug — doubles as the posts/experiences/app_settings event_id. */
  eventId: string;
  /** events.id uuid for DB events; null for legacy coded events. */
  eventUuid: string | null;
  status: string;
  planTier: string;
  config: EventConfig;
  source: 'code' | 'db';
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
      { title: 'Select a Filter', body: '' },
      { title: 'Snap Photo', body: '' },
      { title: 'Share', body: '' },
    ],
    onboardingSteps: [
      { eyebrow: 'Step One', title: 'Choose Your Look', body: 'Pick an Effect, then layer it with a Frame — they were designed to pair beautifully together.' },
      { eyebrow: 'Step Two', title: 'Flip & Adorn', body: 'Tap to flip between front and back cameras, and try a 3D accessory tracked live to your head.' },
      { eyebrow: 'Step Three', title: 'Photo or Video', body: 'Press the shutter for a single frame, or switch to Video to capture up to 30 seconds of magic.' },
      { eyebrow: 'Step Four', title: 'Send & Shine', body: 'Set a hands-free timer for the perfect pose, then beam your moment straight to the live wall.' },
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

  return {
    id: row.slug,
    copy: buildRuntimeCopy(name, cfg),
    fontHref: str(cfg.fontHref) ?? '',
    Wordmark: visuals.Wordmark,
    Mark: visuals.Mark,
    Emblem: visuals.Emblem,
    Background: background.component,
    backgroundTemplateId: background.id,
    landingRoute: str(cfg.landingRoute) ?? '/booth',
    primaryCardPublicId,
    arContent,
    accentHexes,
    defaultExperienceId: str(cfg.defaultExperienceId),
    themeVars: (cfg.themeVars && typeof cfg.themeVars === 'object'
      ? (cfg.themeVars as Record<string, string>)
      : {}),
  };
}

/**
 * Resolve a slug to a runtime event: coded registry first, then the `events`
 * table. Returns null when the slug matches neither (caller shows a
 * "not found" screen).
 */
export async function loadEventConfig(slug: string): Promise<RuntimeEvent | null> {
  const code = getRegisteredEvent(slug);
  if (code) return codeRuntimeEvent(slug, code);

  const { data, error } = await supabase
    .from('events')
    .select('id, slug, name, event_type, status, config, plan_tier')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.error('[events] loadEventConfig', error);
    return null;
  }
  if (!data) return null;

  const row = data as EventRow;
  return {
    eventId: row.slug,
    eventUuid: row.id,
    status: row.status,
    planTier: row.plan_tier ?? 'free',
    config: buildRuntimeConfig(row),
    source: 'db',
  };
}
