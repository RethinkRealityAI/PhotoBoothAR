import type { EventConfig } from '../types';

const noop: any = () => null;

export const hopeGala: EventConfig = {
  id: 'hope-gala',
  copy: {
    eyebrow: 'SCAGO · 2026',
    eventName: 'Hope Gala & Awards',
    tagline: 'Scan to capture your AR moment',
    fullName: 'SCAGO Hope Gala & Awards 2026',
    thankYou: 'Thank you for being part of the Hope Gala!',
    steps: [
      { title: 'Scan QR', body: '' },
      { title: 'Select a Filter', body: '' },
      { title: 'Snap Photo', body: '' },
      { title: 'Share', body: '' },
    ],
    filePrefix: 'HopeGala2026',
    shareTitle: 'SCAGO Hope Gala & Awards 2026',
    shareText: 'My moment from the SCAGO Hope Gala & Awards 2026.',
  },
  fontHref:
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Pinyon+Script&family=Jost:wght@300;400;500;600&display=swap',
  Wordmark: noop,
  Mark: noop,
  Background: noop,
  landingRoute: '/booth',
  arContent: {},
};
