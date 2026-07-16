import { describe, it, expect } from 'vitest';
import { eventUrl, boothUrl, experienceUrl, welcomeUrl } from './copilotBooth';

const O = 'https://beamwall.app';

describe('copilotBooth URL builders', () => {
  it('builds the canonical /e/:slug surfaces', () => {
    expect(eventUrl(O, 'jenna-jake')).toBe('https://beamwall.app/e/jenna-jake');
    expect(boothUrl(O, 'jenna-jake')).toBe('https://beamwall.app/e/jenna-jake/booth');
    expect(welcomeUrl(O, 'jenna-jake')).toBe('https://beamwall.app/e/jenna-jake/welcome');
  });

  it('deep-links one experience', () => {
    expect(experienceUrl(O, 'gala', 'exp-1')).toBe('https://beamwall.app/e/gala/experience/exp-1');
  });

  it('composes from a bare origin without a trailing slash', () => {
    expect(boothUrl('http://localhost:5173', 'x')).toBe('http://localhost:5173/e/x/booth');
  });
});
