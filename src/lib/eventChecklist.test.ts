import { describe, it, expect } from 'vitest';
import { checklistFromSnapshot, checklistFromStudio, computeChecklist, missingIds } from './eventChecklist';
import type { EventSnapshot } from './eventSnapshot';

const snap = (over: Partial<EventSnapshot> = {}): EventSnapshot => ({
  eventUuid: 'u-1', slug: 'e', name: 'E', status: 'draft', planTier: 'free', eventType: 'party',
  failed: false, postCount: 0, showChallenges: true, challenges: [], experiences: [], cards: [],
  ...over,
});

describe('build checklist (copilot)', () => {
  it('keeps the five verbatim labels and marks nothing done on an empty draft', () => {
    const items = computeChecklist(checklistFromSnapshot(snap()), 'build');
    expect(items.map((i) => i.label)).toEqual(['Add a frame', 'Add a filter', 'Add a 3D prop', 'Add challenges', 'Go live']);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(missingIds(items)).toEqual(['frame', 'filter', 'prop', 'challenges', 'live']);
  });

  it('counts only PUBLISHED experiences per kind', () => {
    const facts = checklistFromSnapshot(snap({
      status: 'live',
      experiences: [
        { id: 'a', name: 'F', kind: 'border', published: true },
        { id: 'b', name: 'S', kind: 'shader', published: false },
        { id: 'c', name: 'P', kind: '3d_attachment', published: true },
      ],
      challenges: [{ id: 'ch', title: 'x', emoji: '⭐', points: 1, active: true }],
    }));
    const items = computeChecklist(facts, 'build');
    expect(Object.fromEntries(items.map((i) => [i.id, i.done]))).toEqual({ frame: true, filter: false, prop: true, challenges: true, live: true });
    expect(missingIds(items)).toEqual(['filter']);
  });
});

describe('dashboard checklist (studio)', () => {
  const cfg = { copy: { fullName: "Maya's 40th" }, themeVars: { '--color-accent': '#fff' }, arContent: { borderIds: ['x'] } };

  it('keeps the four verbatim labels and hints', () => {
    const items = computeChecklist(checklistFromStudio(cfg, { published: 0, posts: 0 }, 'draft'), 'dashboard');
    expect(items).toEqual([
      { id: 'name', label: 'Name your event', hint: "Maya's 40th", done: true },
      { id: 'look', label: 'Pick your look & colours', hint: 'Template look active — make it yours in Branding', done: true },
      { id: 'frames', label: 'Add frames & effects', hint: 'Template frames active — add your own or AI-generate more', done: true },
      { id: 'test_shot', label: 'Take a test photo', hint: 'Open your booth and snap one — see what guests will see', done: false },
    ]);
  });

  it('an unnamed, unthemed, frameless event shows the "not yet" hints', () => {
    const items = computeChecklist(checklistFromStudio({ copy: { fullName: '  ' } }, null, 'draft'), 'dashboard');
    expect(items.map((i) => i.hint)).toEqual([
      'Give it a name in Branding', 'Theme, background & fonts', 'Frames, filters & 3D props',
      'Open your booth and snap one — see what guests will see',
    ]);
    expect(missingIds(items)).toEqual(['name', 'look', 'frames', 'test_shot']);
  });

  it('a published experience counts as frames & effects even without template frames', () => {
    expect(computeChecklist(checklistFromStudio({}, { published: 1, posts: 2 }, 'live'), 'dashboard').map((i) => i.done))
      .toEqual([false, false, true, true]);
  });

  it('a snapshot has no theme — look is unobserved and renders as not done, never earned', () => {
    const facts = checklistFromSnapshot(snap());
    expect(facts.look).toBeNull();
    expect(computeChecklist(facts, 'dashboard')[1].done).toBe(false);
  });
});
