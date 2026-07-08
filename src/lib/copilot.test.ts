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

  it('salvages a sentence-dumped title into title + description', () => {
    const sentence =
      'add a challenge where guests take a picture of people dancing on the dance floor with the couple';
    const out = normalizeActions([{ tool: 'add_challenge', title: sentence }], snapshot);
    expect(out).toHaveLength(1);
    const p = (out[0] as { proposal: { title: string; description: string } }).proposal;
    expect(p.title.length).toBeLessThanOrEqual(60);
    expect(p.title.endsWith(' ')).toBe(false);
    expect(p.description).toBe(sentence);
    // A short title with its own description passes through untouched.
    const short = normalizeActions(
      [{ tool: 'add_challenge', title: 'Dance floor cam', description: 'Snap the dancers.' }], snapshot,
    );
    expect((short[0] as { proposal: { title: string; description: string } }).proposal)
      .toMatchObject({ title: 'Dance floor cam', description: 'Snap the dancers.' });
  });

  it('validates challenge packs: per-item filtering, 6-item cap, theme default', () => {
    const out = normalizeActions([{
      tool: 'add_challenge_pack',
      challenges: [
        { title: 'First dance', emoji: '💃', points: 20 },
        { emoji: '💀' },                                   // no title — dropped
        ...Array.from({ length: 8 }, (_v, i) => ({ title: `extra ${i}` })),
      ],
    }], snapshot);
    expect(out).toHaveLength(1);
    const p = (out[0] as { proposal: { theme: string; challenges: unknown[] } }).proposal;
    expect(p.theme).toBe('Challenge pack');
    expect(p.challenges).toHaveLength(6);
    expect(p.challenges[0]).toEqual({ title: 'First dance', emoji: '💃', points: 20, description: '' });
    // A pack with zero usable challenges is dropped entirely.
    expect(normalizeActions([{ tool: 'add_challenge_pack', challenges: [{}, null] }], snapshot)).toEqual([]);
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
