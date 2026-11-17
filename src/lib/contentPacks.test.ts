import { describe, it, expect } from 'vitest';
import { CONTENT_PACKS, PACK_IDS, packAction, packById, packForEventType } from './contentPacks';
import { normalizeActions } from './copilot';
import { EVENT_TEMPLATES } from './eventTemplates';
import { CARD_TEMPLATE_IDS } from './cardTemplates';

describe('CONTENT_PACKS', () => {
  it('has exactly one pack per event template, in template order', () => {
    expect([...PACK_IDS]).toEqual(EVENT_TEMPLATES.map((t) => t.id));
    for (const id of PACK_IDS) expect(CONTENT_PACKS[id].id).toBe(id);
  });

  for (const id of PACK_IDS) {
    const pack = CONTENT_PACKS[id];
    it(`${id}: 4-6 tasteful generic challenges within the draft caps`, () => {
      expect(pack.challenges.length).toBeGreaterThanOrEqual(4);
      expect(pack.challenges.length).toBeLessThanOrEqual(6);
      const titles = new Set<string>();
      for (const c of pack.challenges) {
        expect(c.title.length, c.title).toBeLessThanOrEqual(60);
        expect(c.title.trim()).toBe(c.title);
        expect(c.emoji.length).toBeGreaterThan(0);
        expect(c.points).toBeGreaterThanOrEqual(10);
        expect(c.points).toBeLessThanOrEqual(30);
        expect(c.description.length).toBeGreaterThan(10);
        expect(c.description).not.toContain('\n');
        expect(titles.has(c.title), `duplicate title ${c.title}`).toBe(false);
        titles.add(c.title);
      }
      const checks = pack.challenges.filter((c) => c.validationPrompt);
      expect(checks.length).toBeGreaterThanOrEqual(1);
      expect(checks.length).toBeLessThanOrEqual(2);
      for (const c of checks) expect(c.validationPrompt!.length).toBeLessThanOrEqual(500);
    });

    it(`${id}: no legacy-event branding, a real card template, a titled card`, () => {
      const text = JSON.stringify(pack);
      expect(text).not.toMatch(/gala ?booth|jenna|jake|adetoyi|hope gala|beamwall/i);
      expect(CARD_TEMPLATE_IDS).toContain(pack.cardTemplate);
      expect(pack.cardTitle("Maya's 40th")).toContain("Maya's 40th");
      expect(pack.theme.length).toBeLessThanOrEqual(80);
      expect(pack.tagline.length).toBeLessThanOrEqual(160);
    });

    it(`${id}: packAction round-trips normalizeActions with NOTHING dropped`, () => {
      const action = packAction(pack);
      const [out] = normalizeActions([{ tool: action.tool, ...action.proposal }], null);
      expect(out).toEqual(action);
      // the registry itself was not handed out by reference
      expect(action.proposal.challenges[0]).not.toBe(pack.challenges[0]);
    });
  }
});

describe('packById / packForEventType', () => {
  it('resolves ids and rejects prototype keys', () => {
    expect(packById('gala')?.id).toBe('gala');
    expect(packById('toString')).toBeNull();
    expect(packById(null)).toBeNull();
  });

  it('maps every event_type to its pack; remote and unknown fall back to party', () => {
    for (const t of EVENT_TEMPLATES) expect(packForEventType(t.eventType).id).toBe(t.id);
    expect(packForEventType('remote').id).toBe('party');
    expect(packForEventType('').id).toBe('party');
    expect(packForEventType(undefined).id).toBe('party');
  });
});
