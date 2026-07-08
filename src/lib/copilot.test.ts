import { describe, it, expect } from 'vitest';
import { normalizeActions, mergeWireTurns } from './copilot';
import type { EventSnapshot } from './eventSnapshot';
import type { ChatMessage } from './eventDesigner';

const snapshot = {
  eventUuid: 'u-1', slug: 'daps-35th', name: "Dapo's 35th", status: 'live',
  planTier: 'deluxe', eventType: 'birthday', postCount: 3, showChallenges: true,
  challenges: [{ id: 'ch-real', title: 'Dunk pose', emoji: '🏀', points: 20, active: true }],
  experiences: [], cards: [],
} satisfies EventSnapshot;

describe('normalizeActions', () => {
  it('accepts valid proposals and applies defaults/coercions', () => {
    const out = normalizeActions([
      { tool: 'add_challenge', title: '  Best gym flex  ', points: '25', emoji: '' },
      { tool: 'create_card', cardTitle: 'For Grandma', cardTemplate: 'weird', deadline: 'next friday' },
      { tool: 'get_stats' },
    ], snapshot);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      tool: 'add_challenge',
      proposal: { title: 'Best gym flex', emoji: '⭐', points: 25, description: '' },
    });
    expect(out[1]).toEqual({
      tool: 'create_card',
      proposal: { cardTitle: 'For Grandma', recipientName: '', cardTemplate: 'storybook', deadline: '' },
    });
    expect(out[2]).toEqual({ tool: 'get_stats' });
  });

  it('drops unknown tools, missing required args, and hallucinated ids', () => {
    const out = normalizeActions([
      { tool: 'launch_missiles', target: 'moon' },
      { tool: 'add_challenge' },                                  // no title
      { tool: 'update_challenge', challengeId: 'ch-fake', title: 'x' }, // id not in snapshot
      { tool: 'delete_challenge', challengeId: 'ch-real' },       // valid
      'garbage', null,
    ], snapshot);
    expect(out).toEqual([{ tool: 'delete_challenge', proposal: { challengeId: 'ch-real' } }]);
  });

  it('caps at 3 actions and clamps points into [0,1000]', () => {
    const many = Array.from({ length: 6 }, (_v, i) => ({ tool: 'add_challenge', title: `c${i}`, points: 99999 }));
    const out = normalizeActions(many, snapshot);
    expect(out).toHaveLength(3);
    expect((out[0] as { proposal: { points: number } }).proposal.points).toBe(1000);
  });

  it('handles non-array input and null snapshot (update/delete need ids)', () => {
    expect(normalizeActions('nope', snapshot)).toEqual([]);
    expect(normalizeActions([{ tool: 'update_challenge', challengeId: 'ch-real' }], null)).toEqual([]);
    expect(normalizeActions([{ tool: 'add_challenge', title: 'ok' }], null)).toHaveLength(1);
  });
});

describe('mergeWireTurns', () => {
  it('merges consecutive same-role turns (Gemini alternation)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'add a challenge' },
      { role: 'assistant', content: 'Proposed!' },
      { role: 'user', content: '[tool_result] Challenge "X" added.' },
      { role: 'user', content: 'now show stats' },
    ];
    const out = mergeWireTurns(msgs);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe('user');
    expect(out[2].content).toBe('[tool_result] Challenge "X" added.\n\nnow show stats');
    expect(msgs[2].content).toBe('[tool_result] Challenge "X" added.'); // input not mutated
  });
});
