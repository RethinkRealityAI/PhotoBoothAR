import { lazy } from 'react';
import type { EventConfig } from '../types';
import { HopeGalaWordmark, HopeGalaMark, HopeGalaEmblem } from '../../components/ui/Logo';
import { scagoMarkDataUrl } from '../../lib/scagoMark';
import { hopeGalaCopy } from './copy';

// Lazy (matches jenna-jake/detola-wuyi): event Backgrounds load on first
// render inside ui/EventBackground's Suspense, not in the eager registry graph.
const GalaBackground = lazy(() => import('../../components/ui/GalaBackground'));

export const hopeGala: EventConfig = {
  id: 'hope-gala',
  copy: hopeGalaCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Pinyon+Script&family=Jost:wght@300;400;500;600&display=swap',
  faviconHref: scagoMarkDataUrl(64),
  Wordmark: HopeGalaWordmark,
  Mark: HopeGalaMark,
  Emblem: HopeGalaEmblem,
  Background: GalaBackground,
  landingRoute: '/booth',
  accentHexes: ['#D4AF37', '#E8C766', '#FBF3D9', '#B8860B'],
  // Mirrors theme.css (kept in sync) so the runtime EventProvider can theme
  // this event without a build-time CSS import.
  themeVars: {
    '--color-brand-bg': '#0A0806',
    '--color-brand-surface': '#1A130C',
    '--color-brand-fg': '#F7F1E3',
    '--color-brand-muted': '#E9D9B8',
    '--color-accent': '#D4AF37',
    '--color-accent-2': '#EFD584',
    '--color-accent-3': '#A67C1F',
    '--accent-rgb': '212, 175, 55',
  },
  // Pinned to Hope Gala's own built-ins so AR effects added for other events
  // (in the shared registries) never leak into this catalog.
  arContent: {
    shaderIds: [
      'champagne-sparkle',
      'golden-hour-bloom',
      'prismatic-holo',
      'aureate-god-rays',
      'velvet-film',
      'crystalline-kaleidoscope',
      'celestial-lens-flare',
      'aurora-lumina',
    ],
    borderIds: [
      'frame-classic',
      'frame-hexagon',
      'frame-deco',
      'frame-minimal',
      'sticker-hopegala',
      'sticker-hopegala-top',
      'sticker-crown',
      'overlay-confetti',
    ],
    headPieceIds: ['royal-crown', 'queen-tiara', 'cheek-stars', 'hope-halo'],
  },
};
