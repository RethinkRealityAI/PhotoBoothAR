/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Detola & Wuyi — black & green wedding with gold accents.
 */
import type { EventConfig } from '../types';
import { detolaWuyiCopy } from './copy';
import { detolaWuyiAR } from './arContent';
import { DetolaWuyiWordmark, DetolaWuyiMark, DetolaWuyiEmblem } from './Logo';
import DetolaWuyiBackground from './Background';

export const detolaWuyi: EventConfig = {
  id: 'detola-wuyi',
  copy: detolaWuyiCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=Pinyon+Script&family=Jost:wght@300;400;500;600&display=swap',
  Wordmark: DetolaWuyiWordmark,
  Mark: DetolaWuyiMark,
  Emblem: DetolaWuyiEmblem,
  Background: DetolaWuyiBackground,
  landingRoute: '/booth',
  accentHexes: ['#D4AF37', '#E8C766', '#FBF3D9', '#1E4A34'],
  arContent: detolaWuyiAR,
  // Open the booth with the signature gold "Detola & Wuyi" frame already applied.
  defaultExperienceId: 'builtin:border:dw-frame-monogram',
};
