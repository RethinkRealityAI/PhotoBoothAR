import { describe, it, expect } from 'vitest';
import { normalizeActions, mergeWireTurns } from './copilot';
import type { EventSnapshot } from './eventSnapshot';
import type { ChatMessage } from './eventDesigner';
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECES } from './headPieces';

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

describe('normalizeActions — experience-building tools', () => {
  const filterId = FILTER_SHADERS.find((s) => s.id !== 'none')!.id;
  const pieceId = HEAD_PIECES[0].id;
  const withExp = {
    ...snapshot,
    experiences: [{ id: 'exp-real', name: 'Gold frame', kind: 'border', published: true }],
  } satisfies EventSnapshot;

  it('accepts generate_frame with a prompt, drops it without one', () => {
    expect(normalizeActions([{ tool: 'generate_frame', prompt: 'art-deco gold border' }], snapshot))
      .toEqual([{ tool: 'generate_frame', proposal: { prompt: 'art-deco gold border' } }]);
    expect(normalizeActions([{ tool: 'generate_frame' }], snapshot)).toEqual([]);
  });

  it('accepts a known filter id, drops unknown ids and none', () => {
    expect(normalizeActions([{ tool: 'set_filter', shaderId: filterId }], snapshot))
      .toEqual([{ tool: 'set_filter', proposal: { shaderId: filterId } }]);
    expect(normalizeActions([{ tool: 'set_filter', shaderId: 'made-up' }], snapshot)).toEqual([]);
    expect(normalizeActions([{ tool: 'set_filter', shaderId: 'none' }], snapshot)).toEqual([]);
  });

  it('validates head pieces: builtin id must exist, generate needs a prompt', () => {
    expect(normalizeActions([{ tool: 'add_head_piece', source: 'builtin', pieceId }], snapshot))
      .toEqual([{ tool: 'add_head_piece', proposal: { source: 'builtin', pieceId } }]);
    expect(normalizeActions([{ tool: 'add_head_piece', source: 'builtin', pieceId: 'nope' }], snapshot)).toEqual([]);
    expect(normalizeActions([{ tool: 'add_head_piece', source: 'generate', prompt: 'a foam crown' }], snapshot))
      .toEqual([{ tool: 'add_head_piece', proposal: { source: 'generate', prompt: 'a foam crown' } }]);
    expect(normalizeActions([{ tool: 'add_head_piece', source: 'generate' }], snapshot)).toEqual([]);
  });

  it('set_default_experience must reference a real experience id', () => {
    expect(normalizeActions([{ tool: 'set_default_experience', experienceId: 'exp-real' }], withExp))
      .toEqual([{ tool: 'set_default_experience', proposal: { experienceId: 'exp-real' } }]);
    expect(normalizeActions([{ tool: 'set_default_experience', experienceId: 'exp-fake' }], withExp)).toEqual([]);
    expect(normalizeActions([{ tool: 'set_default_experience', experienceId: 'exp-real' }], snapshot)).toEqual([]);
  });

  it('passes no-arg go_live and test_experience through', () => {
    expect(normalizeActions([{ tool: 'go_live' }, { tool: 'test_experience' }], snapshot))
      .toEqual([{ tool: 'go_live' }, { tool: 'test_experience' }]);
  });

  it('add_frame accepts only generic (event-neutral) built-in ids', () => {
    expect(normalizeActions([{ tool: 'add_frame', borderId: 'dw-frame-classic' }], snapshot))
      .toEqual([{ tool: 'add_frame', proposal: { borderId: 'dw-frame-classic' } }]);
    // A real built-in that carries event-locked text (frame-classic → "HOPE GALA") is refused.
    expect(normalizeActions([{ tool: 'add_frame', borderId: 'frame-classic' }], snapshot)).toEqual([]);
    expect(normalizeActions([{ tool: 'add_frame', borderId: 'made-up' }], snapshot)).toEqual([]);
  });

  it('set_event_date requires YYYY-MM-DD; rename_event needs a name', () => {
    expect(normalizeActions([{ tool: 'set_event_date', date: '2026-09-12' }], snapshot))
      .toEqual([{ tool: 'set_event_date', proposal: { date: '2026-09-12' } }]);
    expect(normalizeActions([{ tool: 'set_event_date', date: 'next friday' }], snapshot)).toEqual([]);
    expect(normalizeActions([{ tool: 'rename_event', name: '  Gala 2.0 ' }], snapshot))
      .toEqual([{ tool: 'rename_event', proposal: { name: 'Gala 2.0' } }]);
    expect(normalizeActions([{ tool: 'rename_event', name: '' }], snapshot)).toEqual([]);
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
