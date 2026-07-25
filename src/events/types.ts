/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-event configuration contract. Every event supplies one EventConfig; all
 * event-specific branding, theming, copy, and AR content flows from it.
 */
import type { ComponentType } from 'react';

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
}

/** Which AR catalog entries this event exposes. Empty/undefined array = include all. */
export interface EventARContent {
  shaderIds?: string[];
  borderIds?: string[];
  headPieceIds?: string[];
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
  arContent: EventARContent;
  /** Event palette as hex strings — for canvas/JS color needs (confetti, the
   *  captured-photo watermark) that can't read CSS variables. Brightest first. */
  accentHexes: string[];
  /** Catalog id auto-applied when the booth opens if the admin hasn't set one
   *  (e.g. a signature frame). Admin's wallSettings.defaultExperienceId wins. */
  defaultExperienceId?: string;
  /** CSS custom-property values for this event's theme (mirrors theme.css for
   *  the legacy coded events; sourced from events.config for DB events). The
   *  EventProvider applies these at runtime so themes no longer require a
   *  build-time CSS import. */
  themeVars?: Record<string, string>;
}
