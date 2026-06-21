/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Jenna & Jake — EDM festival wedding event.
 */
import type { EventConfig } from '../types';
import { jennaJakeCopy } from './copy';
import { jennaJakeAR } from './arContent';
import { JennaJakeWordmark, JennaJakeMark } from './Logo';
import FestivalBackground from './Background';

export const jennaJake: EventConfig = {
  id: 'jenna-jake',
  copy: jennaJakeCopy,
  fontHref:
    'https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Pacifico&family=Inter:wght@300;400;500;600;700&family=Jost:wght@300;400;500;600&display=swap',
  Wordmark: JennaJakeWordmark,
  Mark: JennaJakeMark,
  Background: FestivalBackground,
  landingRoute: '/wall',
  arContent: jennaJakeAR,
};
