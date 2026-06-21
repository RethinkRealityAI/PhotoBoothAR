import type { EventConfig } from '../types';
import { HopeGalaWordmark, HopeGalaMark } from '../../components/ui/Logo';
import GalaBackground from '../../components/ui/GalaBackground';
import { hopeGalaCopy } from './copy';

export const hopeGala: EventConfig = {
  id: 'hope-gala',
  copy: hopeGalaCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Pinyon+Script&family=Jost:wght@300;400;500;600&display=swap',
  Wordmark: HopeGalaWordmark,
  Mark: HopeGalaMark,
  Background: GalaBackground,
  landingRoute: '/booth',
  arContent: {},
};
