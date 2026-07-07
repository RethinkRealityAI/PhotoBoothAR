import { describe, it, expect } from 'vitest';
import {
  inferTemplate, extractName, extractDate, detectRemote, localDesign, normalizePlan,
  buildPlanSurface, surfaceIdOf, type EventPlan,
} from './eventDesigner';
import { applySurfaceMessages, getPath, resolveContext } from './a2ui';

describe('inferTemplate', () => {
  it('maps occasion keywords to templates', () => {
    expect(inferTemplate("It's for Jenna and Jake's wedding in June")).toBe('wedding');
    expect(inferTemplate('a black-tie charity gala for our foundation')).toBe('gala');
    expect(inferTemplate("my mum turns 60 — big birthday bash")).toBe('birthday');
    expect(inferTemplate('our company summit and product launch')).toBe('corporate');
    expect(inferTemplate('neon dance party for graduation night')).toBe('party');
  });

  it('lets the specific occasion beat the generic word "party"', () => {
    expect(inferTemplate("a birthday party for my son")).toBe('birthday');
    expect(inferTemplate('wedding after-party')).toBe('wedding');
  });

  it('returns null on no match and on empty input', () => {
    expect(inferTemplate('just a get-together next week')).toBeNull();
    expect(inferTemplate('')).toBeNull();
  });
});

describe('extractName', () => {
  it('prefers a quoted name verbatim', () => {
    expect(extractName('call it "Golden Hour 2026" please', 'gala')).toBe('Golden Hour 2026');
  });

  it('builds a possessive name from "for <People>"', () => {
    expect(extractName('a party for Jenna and Jake', 'wedding')).toBe("Jenna & Jake's Wedding");
    expect(extractName('celebrating Amara this year', 'birthday')).toBe("Amara's Birthday");
  });

  it('reads direct possessives like "Jenna and Jake\'s wedding"', () => {
    expect(extractName("Jenna and Jake's wedding on 2026-09-12", null)).toBe("Jenna & Jake's Wedding");
    expect(extractName("Mum's 60th birthday", null)).toBe("Mum's Birthday");
  });

  it('returns null for lowercase mentions, no mention, and empty input', () => {
    expect(extractName('a party for everyone', 'party')).toBeNull();
    expect(extractName('something fun', null)).toBeNull();
    expect(extractName('', null)).toBeNull();
  });

  it('does not treat apostrophes as quotes (audit regression)', () => {
    expect(extractName("It's Jenna and Jake's wedding on 2026-09-12", null)).toBe("Jenna & Jake's Wedding");
  });

  it('rejects lowercase possessives and holiday words (audit regression)', () => {
    expect(extractName("it's my sister's birthday party", null)).toBeNull();
    expect(extractName('a photo booth for Christmas', 'party')).toBeNull();
    expect(extractName('a party for Thanksgiving dinner', 'party')).toBeNull();
  });
});

describe('extractDate', () => {
  it('accepts ISO dates and month-name forms in both orders', () => {
    expect(extractDate('the big day is 2026-09-12')).toBe('2026-09-12');
    expect(extractDate('September 12, 2026 works')).toBe('2026-09-12');
    expect(extractDate('on the 3rd of March 2027')).toBe('2027-03-03');
  });

  it('rejects invalid months/days, near-misses, and empty input', () => {
    expect(extractDate('2026-13-40')).toBeNull();
    expect(extractDate('Wingdings 12, 2026')).toBeNull();
    expect(extractDate('meet at 12, room 2026')).toBeNull();
    expect(extractDate('')).toBeNull();
  });
});

describe('detectRemote', () => {
  it('spots remote/virtual phrasing', () => {
    expect(detectRemote("grandma can't attend so it's a virtual celebration")).toBe(true);
    expect(detectRemote('guests join over Zoom from overseas')).toBe(true);
  });
  it('stays false for in-person events and empty input', () => {
    expect(detectRemote('everyone will be there in the hall')).toBe(false);
    expect(detectRemote('')).toBe(false);
  });
});

describe('localDesign', () => {
  it('assembles a full plan from one description', () => {
    const { reply, plan } = localDesign([
      { role: 'user', content: 'A wedding for Jenna and Jake on 2026-09-12, call it "Jenna & Jake Forever"' },
    ]);
    expect(plan.templateId).toBe('wedding');
    expect(plan.name).toBe('Jenna & Jake Forever');
    expect(plan.date).toBe('2026-09-12');
    expect(plan.remote).toBe(false);
    expect(plan.slug).toBe('jenna-jake-forever');
    expect(reply).toContain('Jenna & Jake Forever');
  });

  it('lets later messages override the template and asks for a missing name', () => {
    const { reply, plan } = localDesign([
      { role: 'user', content: 'company conference booth' },
      { role: 'assistant', content: 'Corporate it is!' },
      { role: 'user', content: 'actually make it a neon dance party' },
    ]);
    expect(plan.templateId).toBe('party');
    expect(plan.name).toBeNull();
    expect(plan.slug).toBeNull();
    expect(reply.toLowerCase()).toContain('call');
  });

  it('defaults to the party look when nothing matches, but marks it undecided', () => {
    const { plan, decided } = localDesign([{ role: 'user', content: 'hello' }]);
    expect(plan.templateId).toBe('party');
    expect(decided).toEqual({ template: false, remote: false });
  });

  it('marks template/remote decided when the text carries a signal', () => {
    const { decided } = localDesign([
      { role: 'user', content: 'a virtual wedding celebration over Zoom' },
    ]);
    expect(decided).toEqual({ template: true, remote: true });
  });
});

describe('normalizePlan', () => {
  it('sanitizes an AI plan: bad template, malformed date, sluggable name', () => {
    const plan = normalizePlan({
      name: '  Starlight Gala  ',
      templateId: 'space-disco',
      remote: 'yes',
      date: 'next friday',
      slug: 'Starlight Gala!!',
    });
    expect(plan).toEqual({
      name: 'Starlight Gala',
      templateId: 'party',
      remote: false,
      date: null,
      slug: 'starlight-gala',
    });
  });

  it('handles null/garbage input without throwing', () => {
    expect(normalizePlan(null).templateId).toBe('party');
    expect(normalizePlan(undefined).name).toBeNull();
    expect(normalizePlan('nonsense').slug).toBeNull();
  });
});

describe('buildPlanSurface (A2UI generative UI)', () => {
  const plan: EventPlan = {
    name: "Jenna & Jake's Wedding",
    templateId: 'wedding',
    remote: false,
    date: '2026-09-12',
    slug: 'jenna-jakes-wedding',
  };

  it('streams a valid A2UI surface the reducer can fold into state', () => {
    const messages = buildPlanSurface(plan, 'plan_1');
    expect(surfaceIdOf(messages)).toBe('plan_1');
    expect(messages[0].createSurface?.catalogId).toContain('a2ui.org');

    const surfaces = applySurfaceMessages({}, messages);
    const s = surfaces.plan_1;
    expect(s).toBeDefined();
    expect(s.components.root.component).toBe('Card');
    expect(getPath(s.dataModel, '/plan/name')).toBe(plan.name);
    expect(getPath(s.dataModel, '/plan/templateId')).toBe('wedding');
  });

  it('every referenced child id exists in the flat component list', () => {
    const surfaces = applySurfaceMessages({}, buildPlanSurface(plan, 'p'));
    const comps = surfaces.p.components;
    for (const c of Object.values(comps)) {
      if (typeof c.child === 'string') expect(comps[c.child], `${c.id}.child`).toBeDefined();
      if (Array.isArray(c.children)) {
        for (const id of c.children) expect(comps[id as string], `${c.id}.children`).toBeDefined();
      }
    }
  });

  it("confirm action's context resolves the (edited) plan at trigger time", () => {
    const surfaces = applySurfaceMessages({}, buildPlanSurface(plan, 'p'));
    const s = surfaces.p;
    const action = (s.components.confirmBtn.action as { event: { context: Record<string, unknown> } }).event;
    // Simulate a user edit through the two-way binding, then trigger.
    const edited = { ...s, dataModel: { plan: { ...plan, name: 'Renamed' } } };
    const ctx = resolveContext(action.context, edited.dataModel);
    expect((ctx.plan as EventPlan).name).toBe('Renamed');
    expect((ctx.plan as EventPlan).slug).toBe('jenna-jakes-wedding');
  });
});
