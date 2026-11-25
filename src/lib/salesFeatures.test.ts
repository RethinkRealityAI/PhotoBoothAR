import { describe, expect, it } from 'vitest';
import { ALL_FEATURES, FAST_FIVE, FEATURE_GROUPS, searchFeatures } from './salesFeatures';

const allCopy = () => [
  ...FAST_FIVE,
  ...FEATURE_GROUPS.flatMap((g) => [g.title, g.intro, g.eyebrow]),
  ...ALL_FEATURES.flatMap((f) => [f.title, f.line, f.detail ?? '', f.demo?.label ?? '']),
].join(' \n ');

describe('sales features cheat sheet', () => {
  it('has unique ids across every group', () => {
    const ids = ALL_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(FEATURE_GROUPS.map((g) => g.id)).size).toBe(FEATURE_GROUPS.length);
  });

  it('keeps every talking point to one speakable line', () => {
    for (const f of ALL_FEATURES) {
      expect(f.line.length, f.id).toBeLessThanOrEqual(140);
      expect((f.detail ?? '').length, f.id).toBeLessThanOrEqual(160);
      expect(f.line.trim()).toMatch(/[.!?]$/);
    }
  });

  it('uses the approved Looks vocabulary and never the retired word', () => {
    expect(allCopy()).not.toMatch(/\bfilters?\b/i);
    for (const look of ['frames', 'props', 'paint', 'effects']) {
      expect(ALL_FEATURES.some((f) => f.id === look), look).toBe(true);
    }
  });

  it('states the commercial terms honestly', () => {
    const byId = (id: string) => ALL_FEATURES.find((f) => f.id === id)!;
    expect(byId('studio').tag).toBe('Enterprise add-on');
    expect(byId('film').tag).toBe('Paid plans');
    // Done-for-you is fully remote: never promise anyone on site.
    expect(`${byId('dfy').line} ${byId('dfy').detail}`).toMatch(/remote/i);
    expect(allCopy()).not.toMatch(/on[- ]site (team|staff|attendant)|we('| wi)ll be there/i);
    // Keepsakes are digital only.
    expect(allCopy()).not.toMatch(/\bprinted (album|photos)\b/i);
  });

  it('only links to public pages a prospect can open without signing in', () => {
    for (const f of ALL_FEATURES) {
      if (f.demo === undefined) continue;
      expect(f.demo.path, f.id).toMatch(/^\/(e\/[a-z0-9-]+\/(welcome|booth|wall|challenges)|card-designs|guides)/);
      expect(f.demo.path).not.toMatch(/^\/(host|admin|hub)/);
    }
  });

  it('gives every card a picture or an icon, and the fast five stays five', () => {
    for (const f of ALL_FEATURES) expect(f.icon, f.id).toBeTruthy();
    expect(FAST_FIVE).toHaveLength(5);
  });

  it('searches title, line, detail and tag; empty query returns everything', () => {
    expect(searchFeatures(FEATURE_GROUPS, '  ')).toBe(FEATURE_GROUPS);
    const hits = searchFeatures(FEATURE_GROUPS, 'ENTERPRISE').flatMap((g) => g.features.map((f) => f.id));
    expect(hits).toEqual(['studio']);
    expect(searchFeatures(FEATURE_GROUPS, 'zzzz-nothing')).toEqual([]);
  });
});
