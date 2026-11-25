import { describe, expect, it } from 'vitest';
import { SHOWCASE_EVENTS, qrFileName, showcaseShareText } from './salesShowcase';
import { salesImage } from '../pages/sales/salesImages';

describe('showcase events', () => {
  it('lists the flagship and the three legacy sites', () => {
    const ids = SHOWCASE_EVENTS.map((e) => e.id);
    expect(ids).toContain('lynxxx-birthday');
    expect(ids).toEqual(expect.arrayContaining(['hope-gala', 'detola-wuyi', 'jenna-jake']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never lists test events', () => {
    for (const e of SHOWCASE_EVENTS) {
      const hay = `${e.id} ${e.name} ${e.links.booth} ${e.links.wall}`.toLowerCase();
      expect(hay).not.toMatch(/test|delete-me|e2e|mailinator|probe|tester/);
    }
  });

  it('uses absolute https production links', () => {
    for (const e of SHOWCASE_EVENTS) {
      for (const url of Object.values(e.links)) {
        const u = new URL(url);
        expect(u.protocol).toBe('https:');
        expect(u.hostname === 'beamwall.app' || u.hostname.endsWith('.netlify.app')).toBe(true);
        expect(u.hostname).not.toMatch(/deploy-preview/);
      }
    }
  });

  it('has real card art for every event', () => {
    for (const e of SHOWCASE_EVENTS) expect(salesImage(e.image)).not.toBeNull();
  });

  it('builds file names and share text', () => {
    expect(qrFileName({ id: 'lynxxx-birthday' }, 'booth')).toBe('lynxxx-birthday-booth-qr.png');
    expect(showcaseShareText({ name: 'The Winter Gala' }, 'wall')).toContain('live photo wall');
    expect(showcaseShareText({ name: 'The Winter Gala' }, 'booth')).toContain('No app');
  });
});
