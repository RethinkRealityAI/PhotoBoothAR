import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_TEMPLATES,
  DEFAULT_BACKGROUND_ID,
  resolveBackgroundTemplate,
} from './index';

describe('background template registry', () => {
  it('exposes the six Phase 2b templates', () => {
    expect(Object.keys(BACKGROUND_TEMPLATES).sort()).toEqual(
      ['aurora', 'bokeh', 'confetti', 'geometry', 'starfield', 'waves'],
    );
  });

  it('every entry is well-formed (id matches key, has name + component)', () => {
    for (const [key, t] of Object.entries(BACKGROUND_TEMPLATES)) {
      expect(t.id).toBe(key);
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.component).toBe('function');
    }
  });

  it('the default id is registered', () => {
    expect(DEFAULT_BACKGROUND_ID).toBe('aurora');
    expect(BACKGROUND_TEMPLATES[DEFAULT_BACKGROUND_ID]).toBeDefined();
  });
});

describe('resolveBackgroundTemplate', () => {
  it('resolves a registered id (trimming whitespace)', () => {
    expect(resolveBackgroundTemplate('starfield').id).toBe('starfield');
    expect(resolveBackgroundTemplate(' waves ').id).toBe('waves');
  });

  it('falls back to the default for missing/unknown/non-string values', () => {
    expect(resolveBackgroundTemplate(undefined).id).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundTemplate(null).id).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundTemplate('disco-lasers').id).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundTemplate(42).id).toBe(DEFAULT_BACKGROUND_ID);
    expect(resolveBackgroundTemplate({}).id).toBe(DEFAULT_BACKGROUND_ID);
  });
});
