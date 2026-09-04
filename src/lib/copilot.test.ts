import { describe, it, expect } from 'vitest';
import {
  normalizeActions, normalizeActionsResult, mergeWireTurns, executeAction,
  trimWireTurns, MAX_WIRE_TURNS, formatToolResult, toolResultSummary, toolResultCode,
  offlineReplyFor, TOOL_LABELS, MAX_ACTIONS, applyIncludeFlags,
} from './copilot';
import { CONTENT_PACKS } from './contentPacks';
import { CARD_TEMPLATE_IDS } from './cardTemplates';
import { COPILOT_TOOLS } from './copilotTools';
import type { EventSnapshot } from './eventSnapshot';
import type { ChatMessage } from './eventDesigner';
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECES } from './headPieces';

const snapshot = {
  eventUuid: 'u-1', slug: 'daps-35th', name: "Dapo's 35th", status: 'live',
  planTier: 'deluxe', eventType: 'birthday', failed: false, postCount: 3, showChallenges: true,
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

  it('caps at MAX_ACTIONS actions and clamps points into [0,1000]', () => {
    const many = Array.from({ length: MAX_ACTIONS + 3 }, (_v, i) => ({ tool: 'add_challenge', title: `c${i}`, points: 99999 }));
    const out = normalizeActions(many, snapshot);
    expect(out).toHaveLength(MAX_ACTIONS);
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

  it('carries an optional AI-check validationPrompt on challenges (present → kept, absent → omitted)', () => {
    const withCheck = normalizeActions(
      [{ tool: 'add_challenge', title: 'Spot the red', validationPrompt: '  Someone clearly wearing red  ' }],
      snapshot,
    );
    expect((withCheck[0] as { proposal: { validationPrompt?: string } }).proposal.validationPrompt)
      .toBe('Someone clearly wearing red');
    // No validationPrompt key at all when the model doesn't ask for a check.
    const plain = normalizeActions([{ tool: 'add_challenge', title: 'Best dance move' }], snapshot);
    expect('validationPrompt' in (plain[0] as { proposal: object }).proposal).toBe(false);
    // A blank/whitespace prompt is treated as no check.
    const blank = normalizeActions([{ tool: 'add_challenge', title: 'x', validationPrompt: '   ' }], snapshot);
    expect('validationPrompt' in (blank[0] as { proposal: object }).proposal).toBe(false);
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

  it('passes valid frame lettering through', () => {
    const lettering = { text: 'Maya & Sam', style: 'script-name', placement: 'bottom' };
    expect(normalizeActions([{ tool: 'generate_frame', prompt: 'art-deco gold border', lettering }], snapshot))
      .toEqual([{ tool: 'generate_frame', proposal: { prompt: 'art-deco gold border', lettering } }]);
  });

  it('drops invalid lettering SILENTLY rather than the whole frame proposal', () => {
    // A hallucinated placement id must cost the host a name on the frame, not
    // the frame itself — same handling validationPrompt gets on add_challenge.
    const bad = { text: 'Maya & Sam', style: 'script-name', placement: 'diagonally' };
    expect(normalizeActions([{ tool: 'generate_frame', prompt: 'art-deco gold border', lettering: bad }], snapshot))
      .toEqual([{ tool: 'generate_frame', proposal: { prompt: 'art-deco gold border' } }]);
    expect(normalizeActions([{ tool: 'generate_frame', prompt: 'a frame', lettering: 'Maya' }], snapshot))
      .toEqual([{ tool: 'generate_frame', proposal: { prompt: 'a frame' } }]);
  });

  it('passes a known frame provider through and leaves it ABSENT when unstated', () => {
    expect(normalizeActions([{ tool: 'generate_frame', prompt: 'a frame', provider: 'higgsfield' }], snapshot))
      .toEqual([{ tool: 'generate_frame', proposal: { prompt: 'a frame', provider: 'higgsfield' } }]);
    expect(normalizeActions([{ tool: 'generate_frame', prompt: 'a frame', provider: 'HiggsField ' }], snapshot))
      .toEqual([{ tool: 'generate_frame', proposal: { prompt: 'a frame', provider: 'higgsfield' } }]);
    // Absent → no key at all, so an existing proposal is byte-identical to
    // before the option existed (the confirm card seeds 'gemini' for display).
    const plain = normalizeActions([{ tool: 'generate_frame', prompt: 'a frame' }], snapshot);
    expect('provider' in (plain[0] as { proposal: object }).proposal).toBe(false);
  });

  it('normalizes a hallucinated provider to gemini instead of dropping the frame', () => {
    // A provider name the platform does not have must cost the host a provider
    // choice, never the frame — same forgiveness lettering gets above.
    for (const provider of ['midjourney', '', 42, {}, true]) {
      expect(normalizeActions([{ tool: 'generate_frame', prompt: 'a frame', provider }], snapshot))
        .toEqual([{ tool: 'generate_frame', proposal: { prompt: 'a frame', provider: 'gemini' } }]);
    }
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

  it('coerces add_head_piece with a usable prompt but no/hallucinated pieceId to generate (never silently dropped)', () => {
    // No source and no pieceId — just a prompt (common model output for "make me a 3D X").
    expect(normalizeActions([{ tool: 'add_head_piece', prompt: 'a golden basketball trophy' }], snapshot))
      .toEqual([{ tool: 'add_head_piece', proposal: { source: 'generate', prompt: 'a golden basketball trophy' } }]);
    // Hallucinated builtin id WITH a usable prompt — degrade to generate, don't drop.
    expect(normalizeActions(
      [{ tool: 'add_head_piece', source: 'builtin', pieceId: 'made-up', prompt: 'a foam crown' }], snapshot,
    )).toEqual([{ tool: 'add_head_piece', proposal: { source: 'generate', prompt: 'a foam crown' } }]);
    // Neither a valid pieceId nor a prompt — still dropped.
    expect(normalizeActions([{ tool: 'add_head_piece' }], snapshot)).toEqual([]);
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

describe('normalizeActionsResult — dropped count', () => {
  it('counts every proposal the gate rejected, so the chat can say so', () => {
    const res = normalizeActionsResult([
      { tool: 'update_challenge', challengeId: 'ch-fake', points: 30 }, // id not in snapshot
      { tool: 'launch_missiles' },                                     // unknown tool
      { tool: 'add_challenge' },                                       // no title
    ], snapshot);
    expect(res.actions).toEqual([]);
    expect(res.dropped).toBe(3);
  });

  it('counts only the rejected half of a mixed batch', () => {
    const res = normalizeActionsResult([
      { tool: 'delete_challenge', challengeId: 'ch-real' },  // valid
      { tool: 'delete_challenge', challengeId: 'ch-ghost' }, // hallucinated id
    ], snapshot);
    expect(res.actions).toEqual([{ tool: 'delete_challenge', proposal: { challengeId: 'ch-real' } }]);
    expect(res.dropped).toBe(1);
  });

  it('is 0 for an all-valid batch, an empty array, and a non-array', () => {
    expect(normalizeActionsResult([{ tool: 'get_stats' }], snapshot).dropped).toBe(0);
    expect(normalizeActionsResult([], snapshot).dropped).toBe(0);
    expect(normalizeActionsResult(null, snapshot)).toEqual({ actions: [], dropped: 0, droppedReasons: [] });
  });

  it('does NOT count actions truncated by the MAX_ACTIONS cap as rejected', () => {
    // Six valid tools: MAX_ACTIONS (5) run, the sixth is capped — never judged
    // invalid, so it must not trigger the "I couldn't act on that one" line.
    const res = normalizeActionsResult([
      { tool: 'get_stats' }, { tool: 'share_links' }, { tool: 'go_live' }, { tool: 'test_experience' },
      { tool: 'get_stats' }, { tool: 'test_experience' },
    ], snapshot);
    expect(res.actions).toHaveLength(MAX_ACTIONS);
    expect(res.dropped).toBe(0);
  });

  it('normalizeActions stays the actions-only sibling', () => {
    const raw = [{ tool: 'get_stats' }, { tool: 'nope' }];
    expect(normalizeActions(raw, snapshot)).toEqual(normalizeActionsResult(raw, snapshot).actions);
  });
});

describe('executeAction — no-event guard', () => {
  it('refuses an event-scoped action when no event is selected (empty slug), without touching the DB', async () => {
    // Regression: a null snapshot → ctx.slug='' → INSERT event_id='' → RLS 403
    // → "Adding the challenge failed". The guard short-circuits with a clear
    // "pick an event" message before any supabase import.
    const res = await executeAction(
      { tool: 'add_challenge', proposal: { title: 'Spot the red', emoji: '🔴', points: 10, description: '' } },
      { slug: '', eventUuid: '', origin: 'http://localhost' },
    );
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/pick one|pick an event|not pointed at an event/i);
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

  // REGRESSION: CopilotChat stores a client-rendered card as an assistant turn
  // with EMPTY content (CopilotChat.tsx addSurface). ai-event-designer rejects
  // ANY blank turn with 400 invalid_body, and the empty turn persists in
  // sessionStorage — so one quick-action card used to poison every later send.
  // Merging alone never caught it: it only merges ADJACENT same-role turns.
  it('drops empty/whitespace-only turns so a surface-only card never reaches the wire', () => {
    const out = mergeWireTurns([
      { role: 'user', content: 'add a challenge' },
      { role: 'assistant', content: '' },        // surface-only card, not adjacent to any assistant turn
      { role: 'user', content: 'now show stats' },
    ]);
    expect(out.every((m) => m.content.trim().length > 0)).toBe(true);
    expect(out).toEqual([{ role: 'user', content: 'add a challenge\n\nnow show stats' }]);
    // Whitespace-only counts as empty (the server tests content.trim()).
    const ws = mergeWireTurns([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '   \n ' },
      { role: 'user', content: 'again' },
    ]);
    expect(ws).toHaveLength(1);
  });

  it('leaves a real assistant turn between two user turns intact', () => {
    const out = mergeWireTurns([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
  });

  it('returns [] when every turn is empty', () => {
    expect(mergeWireTurns([{ role: 'assistant', content: '' }, { role: 'assistant', content: ' ' }])).toEqual([]);
    expect(mergeWireTurns([])).toEqual([]);
  });
});

describe('trimWireTurns — the server turn window', () => {
  const turn = (i: number): ChatMessage => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `t${i}` });

  it('keeps at most MAX_WIRE_TURNS (16) of a 24-turn thread, ending on the latest turn', () => {
    const many = Array.from({ length: 24 }, (_v, i) => turn(i)); // ends on an assistant turn? no: 23 is odd → assistant
    const out = trimWireTurns(many);
    expect(MAX_WIRE_TURNS).toBe(16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out[out.length - 1]).toEqual(many[many.length - 1]);
  });

  it('starts on a user turn and preserves strict alternation (25 turns → last is user)', () => {
    const many = Array.from({ length: 25 }, (_v, i) => turn(i)); // 0..24: even = user, so last is user
    const out = trimWireTurns(many);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out[0].role).toBe('user');
    expect(out[out.length - 1].role).toBe('user');
    for (let i = 1; i < out.length; i++) expect(out[i].role).not.toBe(out[i - 1].role);
  });

  it('drops a leading assistant turn left by the cut (cuts on a user boundary)', () => {
    // 17 turns, user-first: the last 16 start on an assistant turn → one more drops.
    const many = Array.from({ length: 17 }, (_v, i) => turn(i));
    const out = trimWireTurns(many);
    expect(out).toHaveLength(15);
    expect(out[0]).toEqual(many[2]);
  });

  it('leaves a short transcript untouched (same content, a fresh array)', () => {
    const short = [turn(0), turn(1), turn(2)];
    const out = trimWireTurns(short);
    expect(out).toEqual(short);
    expect(out).not.toBe(short);
  });

  it('composes with mergeWireTurns: a tool_result user turn is a user turn', () => {
    const thread: ChatMessage[] = [];
    for (let i = 0; i < 30; i++) {
      thread.push({ role: 'user', content: `ask ${i}` });
      thread.push({ role: 'assistant', content: `reply ${i}` });
      thread.push({ role: 'user', content: `[tool_result] tool=get_stats ok=true — ${i}` });
    }
    thread.push({ role: 'user', content: 'and now?' });
    const out = trimWireTurns(mergeWireTurns(thread));
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out[0].role).toBe('user');
    expect(out[out.length - 1].role).toBe('user');
    expect(out[out.length - 1].content).toContain('and now?');
  });
});

describe('normalizeActionsResult — droppedReasons', () => {
  it('names why each proposal was refused, in input order', () => {
    const res = normalizeActionsResult([
      { tool: 'launch_missiles' },
      { tool: 'add_challenge' },
      { tool: 'update_challenge', challengeId: 'ch-fake', points: 30 },
      { tool: 'set_filter', shaderId: 'made-up' },
    ], snapshot);
    expect(res.dropped).toBe(4);
    expect(res.droppedReasons).toEqual([
      { tool: 'launch_missiles', reason: 'unknown_tool' },
      { tool: 'add_challenge', reason: 'invalid_args' },
      { tool: 'update_challenge', reason: 'unknown_id' },
      { tool: 'set_filter', reason: 'unknown_id' },
    ]);
  });

  it('records the MAX_ACTIONS cut as over_cap WITHOUT counting it in dropped', () => {
    const res = normalizeActionsResult([
      { tool: 'get_stats' }, { tool: 'share_links' }, { tool: 'go_live' }, { tool: 'test_experience' },
      { tool: 'get_stats' }, { tool: 'test_experience' },
    ], snapshot);
    expect(res.actions).toHaveLength(MAX_ACTIONS);
    expect(res.dropped).toBe(0);
    expect(res.droppedReasons).toEqual([{ tool: 'test_experience', reason: 'over_cap' }]);
  });

  it('is empty for a clean batch and for a non-array', () => {
    expect(normalizeActionsResult([{ tool: 'get_stats' }], snapshot).droppedReasons).toEqual([]);
    expect(normalizeActionsResult('nope', snapshot)).toEqual({ actions: [], dropped: 0, droppedReasons: [] });
  });
});

describe('normalizeActions — natural-language dates', () => {
  it('set_event_date accepts "July 12 2026" and normalises it; ISO still wins verbatim', () => {
    expect(normalizeActions([{ tool: 'set_event_date', date: 'July 12 2026' }], snapshot))
      .toEqual([{ tool: 'set_event_date', proposal: { date: '2026-07-12' } }]);
    expect(normalizeActions([{ tool: 'set_event_date', date: '12 September 2026' }], snapshot))
      .toEqual([{ tool: 'set_event_date', proposal: { date: '2026-09-12' } }]);
    expect(normalizeActions([{ tool: 'set_event_date', date: '2026-09-12' }], snapshot))
      .toEqual([{ tool: 'set_event_date', proposal: { date: '2026-09-12' } }]);
  });

  it('still drops an unparseable date, and create_card.deadline gets the same parser', () => {
    expect(normalizeActions([{ tool: 'set_event_date', date: 'soon' }], snapshot)).toEqual([]);
    const [card] = normalizeActions([{ tool: 'create_card', cardTitle: 'Hi', deadline: 'June 1, 2026' }], snapshot);
    expect((card as { proposal: { deadline: string } }).proposal.deadline).toBe('2026-06-01');
  });
});

describe('handoff tools', () => {
  it('open_scene_director needs a brief of 6+ chars; contact_support needs a summary; both cap at 600', () => {
    expect(normalizeActions([{ tool: 'open_scene_director', brief: 'jungle' }], snapshot))
      .toEqual([{ tool: 'open_scene_director', proposal: { brief: 'jungle' } }]);
    expect(normalizeActions([{ tool: 'open_scene_director', brief: 'no' }], snapshot)).toEqual([]);
    expect(normalizeActions([{ tool: 'contact_support', summary: '' }], snapshot)).toEqual([]);
    const long = 'x'.repeat(700);
    const [sup] = normalizeActions([{ tool: 'contact_support', summary: long }], snapshot);
    expect((sup as { proposal: { summary: string } }).proposal.summary).toHaveLength(600);
  });

  it('executeAction returns a handoff and touches nothing', async () => {
    const ctx = { slug: 'e', eventUuid: 'u', origin: 'https://x' };
    const d = await executeAction({ tool: 'open_scene_director', proposal: { brief: 'a jungle at dusk' } }, ctx);
    expect(d).toEqual({ ok: true, summary: 'Opening the Scene Director…', handoff: { kind: 'scene_director', brief: 'a jungle at dusk' } });
    const s = await executeAction({ tool: 'contact_support', proposal: { summary: 'it broke twice' } }, ctx);
    expect(s).toEqual({ ok: true, summary: 'Opening support…', handoff: { kind: 'support', summary: 'it broke twice' } });
  });

  it('the no-event guard now carries a code', async () => {
    const r = await executeAction({ tool: 'add_challenge', proposal: { title: 't', emoji: '⭐', points: 1, description: '' } }, { slug: '', eventUuid: '', origin: '' });
    expect(r).toMatchObject({ ok: false, code: 'no_event', retryable: false });
  });
});

describe('formatToolResult / toolResultSummary', () => {
  it('renders the machine prefix exactly, and the summary comes back out', () => {
    const line = formatToolResult('add_challenge', { ok: false, code: 'rls_denied', retryable: false, summary: 'Adding the challenge failed.' });
    expect(line).toBe('[tool_result] tool=add_challenge ok=false code=rls_denied retryable=false — Adding the challenge failed.');
    expect(toolResultSummary(line)).toBe('Adding the challenge failed.');
    expect(formatToolResult('get_stats', { ok: true, summary: '3 posts' })).toBe('[tool_result] tool=get_stats ok=true — 3 posts');
  });

  it('a legacy turn without a dash loses only its prefix', () => {
    expect(toolResultSummary('[tool_result] I couldn’t read this event just now.')).toBe('I couldn’t read this event just now.');
    expect(toolResultSummary('plain')).toBe('plain');
  });
});

describe('toolResultCode', () => {
  it('maps Supabase / fetch errors', () => {
    expect(toolResultCode({ code: '42501', message: 'permission denied for table challenges' })).toEqual({ code: 'rls_denied', retryable: false });
    expect(toolResultCode({ message: 'new row violates row-level security policy' })).toEqual({ code: 'rls_denied', retryable: false });
    expect(toolResultCode({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toEqual({ code: 'not_found', retryable: false });
    expect(toolResultCode(new TypeError('Failed to fetch'))).toEqual({ code: 'network', retryable: true });
    expect(toolResultCode(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toEqual({ code: 'timeout', retryable: true });
    expect(toolResultCode(new Error('something else'))).toEqual({ code: 'unknown', retryable: true });
    expect(toolResultCode(null).code).toBe('unknown');
  });
});

describe('offlineReplyFor + TOOL_LABELS', () => {
  it('is exported and customer-safe per code', () => {
    expect(offlineReplyFor('rate_limited')).toMatch(/hourly AI limit/i);
    expect(offlineReplyFor('ai_key_invalid')).not.toMatch(/GEMINI|API key/i);
    expect(offlineReplyFor(undefined)).toMatch(/built-in guide/i);
  });

  it('network / invalid_body copy is surface-neutral (also rendered on /host/new)', () => {
    for (const reason of ['network', 'invalid_body']) {
      const copy = offlineReplyFor(reason);
      expect(copy).not.toMatch(/studio tab/i);
      expect(copy).not.toMatch(/GEMINI|API key|edge function/i);
    }
    expect(offlineReplyFor('network')).toMatch(/connection/i);
    expect(offlineReplyFor('invalid_body')).toMatch(/shorter/i);
  });

  it('TOOL_LABELS is the registry label for every tool', () => {
    for (const [tool, spec] of Object.entries(COPILOT_TOOLS)) {
      expect(TOOL_LABELS[tool as keyof typeof TOOL_LABELS]).toBe(spec.label);
    }
  });
});

describe('MAX_ACTIONS (exported, 5)', () => {
  it('is 5 and is the cap the normalizer applies', () => {
    expect(MAX_ACTIONS).toBe(5);
    const raw = Array.from({ length: MAX_ACTIONS + 2 }, () => ({ tool: 'get_stats' }));
    const res = normalizeActionsResult(raw, snapshot);
    expect(res.actions).toHaveLength(MAX_ACTIONS);
    expect(res.droppedReasons.filter((d) => d.reason === 'over_cap')).toHaveLength(2);
  });
});

describe('add_challenge_pack.packId (registry packs)', () => {
  it('a known packId with no challenges expands from the registry, keeps packId and the pack theme', () => {
    const [out] = normalizeActions([{ tool: 'add_challenge_pack', packId: 'birthday' }], snapshot);
    expect(out).toEqual({
      tool: 'add_challenge_pack',
      proposal: { theme: 'Birthday party', packId: 'birthday', challenges: CONTENT_PACKS.birthday.challenges },
    });
    // a copy, not the registry
    expect((out as { proposal: { challenges: unknown[] } }).proposal.challenges[0]).not.toBe(CONTENT_PACKS.birthday.challenges[0]);
  });

  it('model-authored challenges win over the pack; a host theme wins over the pack theme', () => {
    const [out] = normalizeActions([{ tool: 'add_challenge_pack', packId: 'gala', theme: 'Our gala', challenges: [{ title: 'Only one' }] }], snapshot);
    expect(out).toMatchObject({ proposal: { theme: 'Our gala', packId: 'gala' } });
    expect((out as { proposal: { challenges: { title: string }[] } }).proposal.challenges.map((c) => c.title)).toEqual(['Only one']);
  });

  it('an unknown packId with no challenges is dropped as invalid_args; with challenges it is simply ignored', () => {
    const res = normalizeActionsResult([{ tool: 'add_challenge_pack', packId: 'circus' }], snapshot);
    expect(res.actions).toEqual([]);
    expect(res.droppedReasons).toEqual([{ tool: 'add_challenge_pack', reason: 'invalid_args' }]);
    const [out] = normalizeActions([{ tool: 'add_challenge_pack', packId: 'circus', challenges: [{ title: 'x' }] }], snapshot);
    expect(out).toEqual({ tool: 'add_challenge_pack', proposal: { theme: 'Challenge pack', challenges: [{ title: 'x', emoji: '⭐', points: 10, description: '' }] } });
    expect('packId' in (out as { proposal: object }).proposal).toBe(false);
  });
});

describe('create_card.cardTemplate accepts every CardTemplateId', () => {
  it.each([...CARD_TEMPLATE_IDS])('%s survives', (id) => {
    const [out] = normalizeActions([{ tool: 'create_card', cardTitle: 'Hi', cardTemplate: id }], snapshot);
    expect(out).toMatchObject({ proposal: { cardTemplate: id } });
  });
});

describe('update_brief', () => {
  it('keeps only present, non-empty fields, trimmed and capped', () => {
    const [out] = normalizeActions([{ tool: 'update_brief', palette: '  gold and navy ', tone: '', avoid: 'balloons, puns', notes: 42 }], snapshot);
    expect(out).toEqual({ tool: 'update_brief', proposal: { palette: 'gold and navy', avoid: 'balloons, puns' } });
    const [long] = normalizeActions([{ tool: 'update_brief', occasion: 'o'.repeat(500) }], snapshot);
    expect((long as { proposal: { occasion: string } }).proposal.occasion).toHaveLength(80);
  });

  it('with every field blank it is dropped as invalid_args (nothing to record)', () => {
    const res = normalizeActionsResult([{ tool: 'update_brief' }, { tool: 'update_brief', palette: '   ' }], snapshot);
    expect(res.actions).toEqual([]);
    expect(res.droppedReasons.map((d) => d.reason)).toEqual(['invalid_args', 'invalid_args']);
  });

  it('with no event selected the executor refuses like every other tool', async () => {
    const r = await executeAction({ tool: 'update_brief', proposal: { palette: 'gold' } }, { slug: '', eventUuid: '', origin: '' });
    expect(r).toMatchObject({ ok: false, code: 'no_event' });
  });
});

describe('applyIncludeFlags', () => {
  it('drops rows with include === false and strips the flag from the rest; nothing else changes', () => {
    const proposal = {
      tool: 'add_challenge_pack', theme: 'T',
      challenges: [
        { title: 'keep', include: true, points: 5 },
        { title: 'drop', include: false },
        { title: 'untagged' },
        null,
      ],
    };
    const out = applyIncludeFlags(proposal);
    expect(out).toEqual({ tool: 'add_challenge_pack', theme: 'T', challenges: [{ title: 'keep', points: 5 }, { title: 'untagged' }, null] });
    expect(proposal.challenges).toHaveLength(4); // input untouched
  });

  it('passes non-pack proposals through untouched (same reference)', () => {
    const p = { tool: 'add_challenge', title: 'x', include: false };
    expect(applyIncludeFlags(p)).toBe(p);
  });

  it('is the step BEFORE normalizeActions: the flags would otherwise be ignored', () => {
    const raw = { tool: 'add_challenge_pack', challenges: [{ title: 'keep' }, { title: 'drop', include: false }] };
    expect((normalizeActions([raw], snapshot)[0] as { proposal: { challenges: unknown[] } }).proposal.challenges).toHaveLength(2);
    expect((normalizeActions([applyIncludeFlags(raw)], snapshot)[0] as { proposal: { challenges: unknown[] } }).proposal.challenges).toHaveLength(1);
  });
});
