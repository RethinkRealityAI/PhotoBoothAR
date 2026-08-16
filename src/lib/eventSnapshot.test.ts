import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatSnapshot, loadEventSnapshot, SNAPSHOT_CAPS, type EventSnapshot } from './eventSnapshot';

// loadEventSnapshot lazy-imports ./db + ./cards (both create the supabase client
// at module load) — mock them, the same pattern as askCopilot.test.ts; vi.mock
// intercepts dynamic imports too.
const { challengesRes, experiencesRes, postsRes, wallRes, cardsRes } = vi.hoisted(() => ({
  challengesRes: vi.fn(), experiencesRes: vi.fn(), postsRes: vi.fn(), wallRes: vi.fn(), cardsRes: vi.fn(),
}));
vi.mock('./db', () => ({
  fetchChallengesResult: challengesRes,
  fetchExperiencesResult: experiencesRes,
  fetchPostsResult: postsRes,
  getWallSettingsResult: wallRes,
}));
vi.mock('./cards', () => ({ listCardsResult: cardsRes }));

const META = {
  eventUuid: '11111111-1111-4111-8111-111111111111',
  slug: 'daps-35th',
  name: "Dapo's 35th",
  status: 'live',
  planTier: 'deluxe',
  eventType: 'birthday',
};

/** Every read succeeds, with one real row each. */
function allOk() {
  challengesRes.mockResolvedValue({ rows: [{ id: 'ch-1', title: 'Dunk pose', emoji: '🏀', points: 20, active: true }], failed: false });
  experiencesRes.mockResolvedValue({ rows: [{ id: 'ex-1', name: 'Gold frame', kind: 'border', is_published: true }], failed: false });
  postsRes.mockResolvedValue({ rows: [{ id: 'p-1' }, { id: 'p-2' }], failed: false });
  wallRes.mockResolvedValue({ settings: { showChallenges: true }, failed: false });
  cardsRes.mockResolvedValue({ rows: [{ id: 'cd-1', title: 'For Grandma', status: 'draft', public_id: 'abc123' }], failed: false });
}

beforeEach(() => {
  for (const m of [challengesRes, experiencesRes, postsRes, wallRes, cardsRes]) m.mockReset();
  allOk();
});

function snap(over: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    ...META,
    failed: false,
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

  it('a FAILED snapshot says so instead of rendering (none) — and quotes no counts', () => {
    const text = formatSnapshot(snap({ failed: true, postCount: 0, challenges: [], experiences: [], cards: [] }));
    expect(text).toContain('CONTENTS UNAVAILABLE');
    expect(text).not.toContain('(none)');
    expect(text).not.toContain('CHALLENGES (0)');
    expect(text).not.toContain('wall posts:');
    // The meta still came from the events row the caller already had.
    expect(text).toContain('slug daps-35th');
  });
});

describe('loadEventSnapshot failure flag', () => {
  it('is false when every read succeeds, and maps the rows through', async () => {
    const s = await loadEventSnapshot(META);
    expect(s.failed).toBe(false);
    expect(s.postCount).toBe(2);
    expect(s.showChallenges).toBe(true);
    expect(s.challenges).toEqual([{ id: 'ch-1', title: 'Dunk pose', emoji: '🏀', points: 20, active: true }]);
    expect(s.experiences).toEqual([{ id: 'ex-1', name: 'Gold frame', kind: 'border', published: true }]);
    expect(s.cards).toEqual([{ id: 'cd-1', title: 'For Grandma', status: 'draft', publicId: 'abc123' }]);
  });

  it.each([
    ['challenges', challengesRes, { rows: [], failed: true }],
    ['experiences', experiencesRes, { rows: [], failed: true }],
    ['posts', postsRes, { rows: [], failed: true }],
    ['wall settings', wallRes, { settings: {}, failed: true }],
    ['cards', cardsRes, { rows: [], failed: true }],
  ])('ANY one failed read (%s) poisons the whole snapshot', async (_label, mock, value) => {
    mock.mockResolvedValue(value);
    await expect(loadEventSnapshot(META)).resolves.toMatchObject({ failed: true });
  });

  it('an event that is genuinely empty is NOT flagged as failed', async () => {
    challengesRes.mockResolvedValue({ rows: [], failed: false });
    experiencesRes.mockResolvedValue({ rows: [], failed: false });
    postsRes.mockResolvedValue({ rows: [], failed: false });
    cardsRes.mockResolvedValue({ rows: [], failed: false });
    const s = await loadEventSnapshot(META);
    expect(s.failed).toBe(false);
    expect(s.postCount).toBe(0);
    expect(s.challenges).toEqual([]);
  });
});
