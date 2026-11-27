/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-event configuration contract. Every event supplies one EventConfig; all
 * event-specific branding, theming, copy, and AR content flows from it.
 */
import type { ComponentType } from 'react';
import type { BoothIntroConfig } from '../lib/boothIntro';
import type { EventBrief } from '../lib/eventBrief';
import type { EventScene } from '../lib/sceneThemes';
import type { EventTheme } from '../lib/themePacks';
import type { TriggerConfig } from '../lib/studio/triggers';

/** A single numbered step on the /join landing + onboarding. */
export interface EventStep {
  title: string;
  body: string;
}

/** A first-launch onboarding card. */
export interface OnboardingStep {
  eyebrow: string;
  title: string;
  body: string;
}

/** All human-readable strings that differ per event. */
export interface EventCopy {
  eyebrow: string;
  eventName: string;
  tagline: string;
  fullName: string;
  thankYou: string;
  steps: EventStep[];
  /** First-launch onboarding cards (booth). */
  onboardingSteps: OnboardingStep[];
  filePrefix: string;
  shareTitle: string;
  /** Personalized share-sheet title, e.g. "My Hope Gala Moment". */
  momentTitle: string;
  shareText: string;
  /** Guest-welcome intro paragraph (DB events; generated once from the brief
   *  or host-edited via Branding). Absent → the welcome page's built-in line,
   *  so legacy coded events render byte-identically. */
  welcomeIntro?: string;
  /** Keepsake-email intro (read server-side by send-keepsakes; surfaced in
   *  Branding so the host can edit it). */
  keepsakeIntro?: string;
  /** ISO stamp of the AI copy run (`config.copy.generatedAt`) — shown in
   *  Branding as "Written by AI on …"; never re-generated once set. */
  generatedAt?: string;
}

/** Which AR catalog entries this event exposes. Empty/undefined array = include all. */
export interface EventARContent {
  shaderIds?: string[];
  borderIds?: string[];
  headPieceIds?: string[];
  /** The colour recolourable built-in frames take on (borders.ts
   *  recolorFrameSvg). Written only by the platform create flow / LooksPicker;
   *  absent → every frame renders exactly as drawn (all legacy events). */
  framePalette?: { accent: string; accent2?: string | null };
  /** Magazine cover Frames the host turned on (lib/cover/spec.ts
   *  CoverSettings, read through normalizeCovers). Written only by the
   *  platform Looks step; absent on every legacy event. */
  covers?: unknown[];
}

export interface EventConfig {
  /** Stable id === slug === DB event_id. */
  id: string;
  copy: EventCopy;
  /** Google Fonts stylesheet href to inject at runtime (or '' if none). */
  fontHref: string;
  /** Favicon for this event (data URL or bundled asset URL). Applied by the
   *  EventProvider while the event is active; the platform icon is restored
   *  on leave. Unset → the platform favicon stays. */
  faviconHref?: string;
  Wordmark: ComponentType<{ size?: 'sm' | 'md' | 'lg' | 'xl' }>;
  Mark: ComponentType;
  /** Bare event emblem icon (no text) — used wherever a small brand mark appears. */
  Emblem: ComponentType<{ size?: number; className?: string }>;
  /** Ambient background. Coded events supply this as a `React.lazy` component
   *  (their Background modules can pull heavy deps — jenna-jake's imports
   *  three/R3F — which must stay OUT of the eager marketing bundle); the sole
   *  render site, ui/EventBackground, wraps it in its own Suspense. Runtime DB
   *  events pass a plain template component, which Suspense passes through. */
  Background: ComponentType<{ density?: number; className?: string; sparkle?: number }>;
  /** Registry id of the background template that produced `Background` (DB
   *  events only — set by buildRuntimeConfig from config.background_template
   *  so the admin picker can highlight the current choice). Legacy coded
   *  events leave it unset. */
  backgroundTemplateId?: string;
  /** Path the "/" route redirects to, e.g. '/booth' or '/wall'. */
  landingRoute: string;
  /** When set (DB events; events.config.primary_card = { publicId }), the
   *  guest "/" redirect goes to the published greeting card at /c/:publicId
   *  instead of landingRoute — the remote-event card landing. */
  primaryCardPublicId?: string;
  /** Keepsake style new cards start from (events.config.default_card_template).
   *  Host-only: guests never choose a keepsake style — the host sets the look
   *  once and every card of the event follows it unless overridden per card. */
  defaultCardTemplate?: string;
  arContent: EventARContent;
  /** Event palette as hex strings — for canvas/JS color needs (confetti, the
   *  captured-photo watermark) that can't read CSS variables. Brightest first. */
  accentHexes: string[];
  /** Catalog id auto-applied when the booth opens if the admin hasn't set one
   *  (e.g. a signature frame). Admin's wallSettings.defaultExperienceId wins. */
  defaultExperienceId?: string;
  /** Event-wide power-ups from the setup wizard (events.config.powerUps),
   *  already resolved to booth triggers. Absent = none — merged after the
   *  selected filter's own triggers (lib/wizard/powerUps). */
  powerUps?: TriggerConfig[];
  /** Beamy's booth intro settings (events.config.boothIntro, lib/boothIntro).
   *  DB events only; absent = the default intro, on. */
  boothIntro?: BoothIntroConfig;
  /** CSS custom-property values for this event's theme (mirrors theme.css for
   *  the legacy coded events; sourced from events.config for DB events). The
   *  EventProvider applies these at runtime so themes no longer require a
   *  build-time CSS import. */
  themeVars?: Record<string, string>;
  /** The platform look family (events.config.look). 'beamwall' = brand v2 on
   *  the guest surfaces (src/styles/platform.css); absent = the event's own
   *  themeVars over the classic dark default. DB events only — coded legacy
   *  events never carry it. */
  look?: 'beamwall';
  /** How the guest pages are dressed (events.config.scene): a template,
   *  gradient, colour, photo or frame. DB events only; undefined = today's
   *  background. Always normalized (lib/sceneThemes.normalizeScene). */
  scene?: EventScene;
  /** A full event theme pack (events.config.theme, lib/themePacks): the
   *  client's branding on every guest surface, CTAs included. DB events
   *  only; undefined = today's look. Always normalized. When set, its tokens
   *  ARE `themeVars`, `look` is never 'beamwall', and its backdrop replaces
   *  `scene` on the guest pages and the wall. */
  theme?: EventTheme;
  /** The photo on the welcome page's and booth splash's phone screen
   *  (events.config.boothScreen), drawn under the event's frame in place of
   *  the stand-in guest. DB events only; absent = scenePage.boothScreen's default.
   *  Validated like a scene image (root-relative or public storage only). */
  boothScreen?: string;
  /** The shared event brief (events.config.brief) the concierge captures and
   *  the Platform Copilot / Scene Director read. DB events only — undefined
   *  when the row carries none, and always undefined for legacy coded events. */
  brief?: EventBrief;
}
