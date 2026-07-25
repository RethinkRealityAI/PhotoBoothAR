/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Jenna & Jake — EDM festival wedding event.
 */
import { lazy } from 'react';
import type { EventConfig } from '../types';
import { jennaJakeCopy } from './copy';
import { jennaJakeAR } from './arContent';
import { JennaJakeWordmark, JennaJakeMark, JennaJakeEmblem } from './Logo';

// Lazy: Background imports three/R3F/drei — keeping it out of this module's
// eager graph keeps the whole 3D stack out of the marketing entry bundle
// (main.tsx → events/active → registry → this config). Rendered inside
// ui/EventBackground's Suspense.
const FestivalBackground = lazy(() => import('./Background'));

export const jennaJake: EventConfig = {
  id: 'jenna-jake',
  copy: jennaJakeCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Pacifico&family=Inter:wght@300;400;500;600;700&family=Jost:wght@300;400;500;600&display=swap',
  Wordmark: JennaJakeWordmark,
  Mark: JennaJakeMark,
  Emblem: JennaJakeEmblem,
  Background: FestivalBackground,
  landingRoute: '/wall',
  arContent: jennaJakeAR,
  accentHexes: ['#FF2D9B', '#19E3FF', '#C6FF1A', '#7A2BFF'],
  // Mirrors theme.css variable values (the .glass/.text-foil class overrides
  // stay in theme.css, which remains scoped to [data-event='jenna-jake']).
  themeVars: {
    '--color-brand-bg': '#0B0220',
    '--color-brand-surface': '#16093A',
    '--color-brand-fg': '#F4ECFF',
    '--color-brand-muted': '#B79CFF',
    '--color-accent': '#FF2D9B',
    '--color-accent-2': '#19E3FF',
    '--color-accent-3': '#7A2BFF',
    '--accent-rgb': '255, 45, 155',
    '--color-gold-50': '#FCE6FF',
    '--color-gold-100': '#FFB8EE',
    '--color-gold-200': '#FF7FDA',
    '--color-gold-300': '#FF52C2',
    '--color-gold-400': '#FF2D9B',
    '--color-gold-500': '#D52CCB',
    '--color-gold-600': '#7A2BFF',
    '--color-gold-700': '#4A1A99',
    '--color-ivory': '#F4ECFF',
    '--color-cream': '#E9DCFF',
    '--color-champagne': '#C9B3FF',
    '--color-noir-900': '#0B0220',
    '--color-noir-800': '#120630',
    '--color-noir-700': '#16093A',
    '--color-noir-600': '#20104F',
    '--color-rose': '#FF6FD6',
    '--color-brand-gold': '#FF2D9B',
    '--color-brand-orange': '#19E3FF',
    '--color-brand-text': '#F4ECFF',
    '--font-serif': '"Sora", ui-sans-serif, system-ui, sans-serif',
    '--font-script': '"Pacifico", cursive',
  },
};
