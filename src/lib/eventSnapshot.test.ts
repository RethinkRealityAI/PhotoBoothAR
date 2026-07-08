import { describe, it, expect } from 'vitest';
import { formatSnapshot, SNAPSHOT_CAPS, type EventSnapshot } from './eventSnapshot';

function snap(over: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    eventUuid: '11111111-1111-4111-8111-111111111111',
    slug: 'daps-35th',
    name: "Dapo's 35th",
    status: 'live',
    planTier: 'deluxe',
    eventType: 'birthday',
    postCount: 42,
    showChallenges: true,
    challenges: [{ id: 'ch-1', title: 'Best dunk pose', emoji: '🏀', points: 20, active: true }],
    experiences: [{ id: 'ex-1', name: 'Gold frame', kind: 'border', published: true }],
    cards: [{ id: 'cd-1', title: 'For Grandma', status: 'draft', publicId: 'abc123' }],
    ...over,
  };
}

describe('formatSnapshot', () => {
  it('includes both keys, meta, and verbatim row ids', () => {
    const text = formatSnapshot(snap());
    expect(text).toContain('slug daps-35th');
    expect(text).toContain('uuid 11111111-1111-4111-8111-111111111111');
    expect(text).toContain('[ch-1] 🏀 Best dunk pose · 20 pts · active');
    expect(text).toContain('[ex-1] Gold frame (border) · published');
    expect(text).toContain('[cd-1] "For Grandma" · draft · /c/abc123');
    expect(text).toContain('wall posts: 42');
    expect(text).toContain('challenges feature ON');
  });

  it('caps long lists with an "…and N more" marker', () => {
    const many = Array.from({ length: SNAPSHOT_CAPS.challenges + 7 }, (_v, i) => ({
      id: `ch-${i}`, title: `Mission ${i}`, emoji: '⭐', points: i, active: true,
    }));
    const text = formatSnapshot(snap({ challenges: many }));
    expect(text).toContain(`CHALLENGES (${many.length})`);
    expect(text).toContain('…and 7 more');
    expect(text).not.toContain(`[ch-${SNAPSHOT_CAPS.challenges}]`); // first dropped row
  });

  it('renders empty sections as (none), not blank', () => {
    const text = formatSnapshot(snap({ challenges: [], experiences: [], cards: [] }));
    expect(text.match(/\(none\)/g)?.length).toBe(3);
  });
});
