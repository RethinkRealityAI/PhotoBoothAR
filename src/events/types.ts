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

/** All human-readable strings that differ per event. */
export interface EventCopy {
  eyebrow: string;
  eventName: string;
  tagline: string;
  fullName: string;
  thankYou: string;
  steps: EventStep[];
  filePrefix: string;
  shareTitle: string;
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
  Wordmark: ComponentType<{ size?: 'sm' | 'md' | 'lg' | 'xl' }>;
  Mark: ComponentType;
  Background: ComponentType<{ density?: number; className?: string }>;
  /** Path the "/" route redirects to, e.g. '/booth' or '/wall'. */
  landingRoute: string;
  arContent: EventARContent;
}
