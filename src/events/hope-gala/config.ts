import type { EventConfig } from '../types';
import { HopeGalaWordmark, HopeGalaMark, HopeGalaEmblem } from '../../components/ui/Logo';
import GalaBackground from '../../components/ui/GalaBackground';
import { hopeGalaCopy } from './copy';

export const hopeGala: EventConfig = {
  id: 'hope-gala',
  copy: hopeGalaCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Pinyon+Script&family=Jost:wght@300;400;500;600&display=swap',
  Wordmark: HopeGalaWordmark,
  Mark: HopeGalaMark,
  Emblem: HopeGalaEmblem,
  Background: GalaBackground,
  landingRoute: '/booth',
  accentHexes: ['#D4AF37', '#E8C766', '#FBF3D9', '#B8860B'],
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
