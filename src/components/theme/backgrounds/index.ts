/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Background-template registry (Phase 2b theming). DB events pick one via
 * `events.config.background_template`; buildRuntimeConfig resolves the id
 * through resolveBackgroundTemplate(). Legacy coded events keep their own
 * Background components and never consult this registry.
 */
import type { ComponentType } from 'react';
import type { AmbientBackgroundProps } from './shared';
import AuroraGradient from './AuroraGradient';
import Bokeh from './Bokeh';
import Confetti from './Confetti';
import Starfield from './Starfield';
import Waves from './Waves';
import Geometry from './Geometry';

export type { AmbientBackgroundProps } from './shared';

export interface BackgroundTemplate {
  id: string;
  /** Human-readable name for the admin picker. */
  name: string;
  component: ComponentType<AmbientBackgroundProps>;
}

export const BACKGROUND_TEMPLATES: Record<string, BackgroundTemplate> = {
  aurora: { id: 'aurora', name: 'Aurora', component: AuroraGradient },
  bokeh: { id: 'bokeh', name: 'Bokeh', component: Bokeh },
  confetti: { id: 'confetti', name: 'Confetti', component: Confetti },
  starfield: { id: 'starfield', name: 'Starfield', component: Starfield },
  waves: { id: 'waves', name: 'Waves', component: Waves },
  geometry: { id: 'geometry', name: 'Geometry', component: Geometry },
};

export const DEFAULT_BACKGROUND_ID = 'aurora';

/** Resolve a (possibly missing/unknown) config value to a registered template. */
export function resolveBackgroundTemplate(id: unknown): BackgroundTemplate {
  if (typeof id === 'string') {
    const t = BACKGROUND_TEMPLATES[id.trim()];
    if (t) return t;
  }
  return BACKGROUND_TEMPLATES[DEFAULT_BACKGROUND_ID];
}

export { AuroraGradient, Bokeh, Confetti, Starfield, Waves, Geometry };
