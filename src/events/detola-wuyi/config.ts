/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detola & Wuyi — black & green wedding with gold accents.
 */
import { lazy } from 'react';
import type { EventConfig } from '../types';
import { detolaWuyiCopy } from './copy';
import { detolaWuyiAR } from './arContent';
import { DetolaWuyiWordmark, DetolaWuyiMark, DetolaWuyiEmblem } from './Logo';
import dwEmblem from './dw-emblem.png';

// Lazy (matches jenna-jake/hope-gala): loads on first render inside
// ui/EventBackground's Suspense, keeping the registry graph lean.
const DetolaWuyiBackground = lazy(() => import('./Background'));

export const detolaWuyi: EventConfig = {
  id: 'detola-wuyi',
  copy: detolaWuyiCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Pinyon+Script&family=Jost:wght@300;400;500;600&display=swap',
  faviconHref: dwEmblem,
  Wordmark: DetolaWuyiWordmark,
  Mark: DetolaWuyiMark,
  Emblem: DetolaWuyiEmblem,
  Background: DetolaWuyiBackground,
  landingRoute: '/booth',
  accentHexes: ['#D4AF37', '#E8C766', '#FBF3D9', '#1E4A34'],
  arContent: detolaWuyiAR,
  // Open the booth with the signature gold "Detola & Wuyi" frame already applied.
  defaultExperienceId: 'builtin:border:dw-frame-monogram',
  // Mirrors theme.css variable values (the .glass class overrides stay in
  // theme.css, which remains scoped to [data-event='detola-wuyi']).
  themeVars: {
    '--color-brand-bg': '#070B08',
    '--color-brand-surface': '#0F1A13',
    '--color-brand-fg': '#EFF5EE',
    '--color-brand-muted': '#AFCDB9',
    '--color-accent': '#D4AF37',
    '--color-accent-2': '#EACB6E',
    '--color-accent-3': '#A87C1F',
    '--accent-rgb': '212, 175, 55',
    '--color-gold-50': '#FBF3D9',
    '--color-gold-100': '#F3E4AE',
    '--color-gold-200': '#E8CE7C',
    '--color-gold-300': '#DCBB55',
    '--color-gold-400': '#D4AF37',
    '--color-gold-500': '#BD962B',
    '--color-gold-600': '#A87C1F',
    '--color-gold-700': '#7E5C14',
    '--color-ivory': '#EFF5EE',
    '--color-cream': '#DCE9DD',
    '--color-champagne': '#BFD7C6',
    '--color-noir-900': '#070B08',
    '--color-noir-800': '#0C140F',
    '--color-noir-700': '#122019',
    '--color-noir-600': '#1B2E22',
    '--color-rose': '#C9A24A',
    '--color-brand-gold': '#D4AF37',
    '--color-brand-orange': '#2E5B40',
    '--color-brand-text': '#EFF5EE',
    '--font-serif': '"Cormorant Garamond", Georgia, serif',
    '--font-script': '"Pinyon Script", cursive',
  },
};
