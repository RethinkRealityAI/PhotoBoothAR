import { describe, it, expect } from 'vitest';
import { conciergeSuggestionsFor, examplePromptsFor, greetingFor, quickChipsFor } from './hostChips';
import { checklistFromSnapshot, computeChecklist, missingIds } from './eventChecklist';
import { normalizeActions } from './copilot';
import type { EventSnapshot } from './eventSnapshot';

const snap = (over: Partial<EventSnapshot> = {}): EventSnapshot => ({
  eventUuid: 'u-1', slug: 'maya-40', name: "Maya's 40th", status: 'draft', planTier: 'free', eventType: 'birthday',
  failed: false, postCount: 0, showChallenges: true, challenges: [], experiences: [], cards: [],
  ...over,
});
const built = snap({
  status: 'live',
  experiences: [
    { id: 'a', name: 'F', kind: 'border', published: true },
    { id: 'b', name: 'S', kind: 'shader', published: true },
    { id: 'c', name: 'P', kind: '3d_attachment', published: true },
  ],
  challenges: [{ id: 'ch', title: 'x', emoji: '⭐', points: 1, active: true }],
});
const checklistOf = (s: EventSnapshot) => computeChecklist(checklistFromSnapshot(s), 'build');

describe('greetingFor', () => {
  it('concierge keeps the opener verbatim', () => {
    expect(greetingFor({ mode: 'concierge' })).toMatch(/^Tell me about your event — who or what are we celebrating\?/);
  });

  it('build names the event, lists what is missing, and nudges by event type', () => {
    const g = greetingFor({ mode: 'build', eventType: 'birthday', name: "Maya's 40th", missing: missingIds(checklistOf(snap())) });
    expect(g).toContain("“Maya's 40th” is created — in draft for now.");
    expect(g).toContain('Next up: a frame, a filter, a 3D prop and some challenges.');
    expect(g).toContain('cake-moment challenge');
    expect(g).toMatch(/take you live right here\.$/);
  });

  it('build with nothing missing says so instead of listing nothing', () => {
    const g = greetingFor({ mode: 'build', eventType: 'gala', name: 'G', missing: [] });
    expect(g).toContain('The look and content are in place.');
    expect(g).not.toContain('Next up');
  });

  it('platform offers the starter pack only when challenges are missing', () => {
    expect(greetingFor({ mode: 'platform', missing: ['challenges'] })).toContain('starter pack in one tap');
    expect(greetingFor({ mode: 'platform', missing: [] })).not.toContain('starter pack');
    expect(greetingFor({ mode: 'platform' })).toMatch(/^Ask me anything/);
  });
});

describe('quickChipsFor — build mode', () => {
  it('missing items come first, done items are dropped, pack chip when no challenges, Go live when not live', () => {
    const chips = quickChipsFor({ mode: 'build', snapshot: snap(), checklist: checklistOf(snap()) });
    expect(chips.map((c) => c.id)).toEqual(['frame', 'filter', 'prop', 'pack', 'challenge', 'test', 'live', 'checklist', 'recommend']);
    expect(chips.find((c) => c.id === 'pack')!.run).toEqual({ kind: 'pack', packId: 'birthday' });
    expect(chips.find((c) => c.id === 'frame')!.run).toMatchObject({ kind: 'open', action: { tool: 'generate_frame' } });
  });

  it('a fully built live event keeps only the evergreen chips', () => {
    const chips = quickChipsFor({ mode: 'build', snapshot: built, checklist: checklistOf(built) });
    expect(chips.map((c) => c.id)).toEqual(['test', 'checklist', 'recommend']);
  });

  it('every open/readonly chip carries an action normalizeActions accepts', () => {
    for (const s of [snap(), built]) {
      for (const chip of quickChipsFor({ mode: 'build', snapshot: s, checklist: checklistOf(s) })) {
        if (chip.run.kind !== 'open' && chip.run.kind !== 'readonly') continue;
        const a = chip.run.action;
        const raw = 'proposal' in a ? { tool: a.tool, ...a.proposal } : { tool: a.tool };
        expect(normalizeActions([raw], s).map((x) => x.tool), chip.id).toEqual([a.tool]);
      }
    }
  });

  it('no snapshot → no chips', () => {
    expect(quickChipsFor({ mode: 'build', snapshot: null, checklist: [] })).toEqual([]);
  });
});

describe('quickChipsFor — platform mode', () => {
  it('leads with the starter pack when challenges are missing, then the classic set, Go live last', () => {
    const chips = quickChipsFor({ mode: 'platform', snapshot: snap(), checklist: checklistOf(snap()) });
    expect(chips.map((c) => c.id)).toEqual(['pack', 'stats', 'share', 'challenge', 'card', 'live']);
    expect(chips.find((c) => c.id === 'card')!.run).toMatchObject({ kind: 'open', action: { proposal: { cardTitle: "Memories for Maya's 40th" } } });
  });

  it('with challenges present the AI pack chip replaces the starter pack; live drops Go live', () => {
    const chips = quickChipsFor({ mode: 'platform', snapshot: built, checklist: checklistOf(built) });
    expect(chips.map((c) => c.id)).toEqual(['stats', 'share', 'challenge', 'card', 'pack-ai']);
    expect(chips[4].run).toEqual({ kind: 'send', text: 'Design a themed pack of 5 photo challenges that fit this event.' });
  });
});

describe('examplePromptsFor / conciergeSuggestionsFor', () => {
  it('three prompts per event type, generic fallback, fresh arrays', () => {
    expect(examplePromptsFor({ mode: 'platform', eventType: 'wedding' })).toHaveLength(3);
    expect(examplePromptsFor({ mode: 'platform', eventType: 'wedding' })[0]).toMatch(/first-dance/);
    expect(examplePromptsFor({ mode: 'build', eventType: 'remote' })).toEqual(examplePromptsFor({ mode: 'build' }));
    expect(examplePromptsFor({ mode: 'build' })).not.toBe(examplePromptsFor({ mode: 'build' }));
  });

  it('the concierge gets today\'s three plus the deferral', () => {
    const s = conciergeSuggestionsFor();
    expect(s).toHaveLength(4);
    expect(s[3]).toBe('Just set it all up for me');
  });
});
