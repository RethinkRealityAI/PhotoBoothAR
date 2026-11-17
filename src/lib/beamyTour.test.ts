import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUDIENCES, DELIVER_STEPS, GREETING, POKE_LINES, TOUR_STOPS, audienceById } from './beamyTour';
import { DEMO_KITS } from './demoKits';

const allCopy = (): string[] => [
  GREETING,
  ...POKE_LINES,
  ...DELIVER_STEPS.flatMap((s) => [s.title, s.body]),
  ...AUDIENCES.flatMap((a) => [a.title, a.hint, ...a.gets, ...TOUR_STOPS.map((s) => a.lines[s])]),
];

describe('beamyTour', () => {
  it('has unique audience ids that resolve', () => {
    const ids = AUDIENCES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(audienceById(id)?.id).toBe(id);
    expect(audienceById('nope')).toBeNull();
    expect(audienceById(null)).toBeNull();
  });

  it('gives every audience a line for every stop', () => {
    for (const a of AUDIENCES) {
      for (const s of TOUR_STOPS) expect(a.lines[s].trim().length, `${a.id}.${s}`).toBeGreaterThan(10);
    }
  });

  it('points at demo kits and prop files that exist', () => {
    for (const a of AUDIENCES) {
      if (a.kit !== null) expect(DEMO_KITS[a.kit], a.id).toBeDefined();
      expect(existsSync(resolve(__dirname, '../../public', a.prop.url.replace(/^\//, ''))), a.prop.url).toBe(true);
    }
    expect(existsSync(resolve(__dirname, '../../public/mascot/beamy.glb'))).toBe(true);
  });

  it('never promises on-site staff (the service is fully remote)', () => {
    const banned = /on[- ]site|on the ground|our (team|staff|crew) (at|on|will be at)|we('| wi)ll (be there|show up|set up at)|technician|attendant/i;
    for (const line of allCopy()) expect(line, line).not.toMatch(banned);
  });
});
