import { describe, it, expect } from 'vitest';
import { gapPrompt, proposalGaps, requiredGaps } from './proposalGaps';

describe('proposalGaps — required fields', () => {
  it('names the empty box instead of failing generically', () => {
    const gaps = proposalGaps('add_challenge', { title: '' });
    expect(gaps.map((g) => g.id)).toEqual(['title']);
    expect(gaps[0].required).toBe(true);
    expect(gaps[0].question).toMatch(/called/i);
  });

  it('treats whitespace as empty — a space is not a title', () => {
    expect(proposalGaps('add_challenge', { title: '   ' })).toHaveLength(1);
  });

  it('passes a filled proposal', () => {
    expect(proposalGaps('add_challenge', { title: 'Best dance move' })).toEqual([]);
  });

  it('requires an id for update and delete', () => {
    expect(proposalGaps('update_challenge', {}).map((g) => g.id)).toEqual(['challenge']);
    expect(proposalGaps('delete_challenge', {}).map((g) => g.id)).toEqual(['challenge']);
    expect(proposalGaps('delete_challenge', { challengeId: 'abc' })).toEqual([]);
  });

  it('requires a non-empty pack', () => {
    expect(proposalGaps('add_challenge_pack', { challenges: [] })).toHaveLength(1);
    expect(proposalGaps('add_challenge_pack', { challenges: [{ title: 'x' }] })).toEqual([]);
  });

  it('requires the picker value for the pick-one tools', () => {
    expect(proposalGaps('add_frame', {})).toHaveLength(1);
    expect(proposalGaps('set_filter', {})).toHaveLength(1);
    expect(proposalGaps('set_default_experience', {})).toHaveLength(1);
    expect(proposalGaps('add_head_piece', { source: 'builtin' })).toHaveLength(1);
    expect(proposalGaps('add_head_piece', { source: 'builtin', pieceId: 'crown' })).toEqual([]);
  });

  it('accepts only the ISO date shape normalizeActions accepts', () => {
    expect(proposalGaps('set_event_date', { date: '2026-09-12' })).toEqual([]);
    expect(proposalGaps('set_event_date', { date: '12/09/2026' })).toHaveLength(1);
    expect(proposalGaps('set_event_date', { date: '' })).toHaveLength(1);
    expect(proposalGaps('set_event_date', {})).toHaveLength(1);
  });

  it('asks nothing of the no-argument and read-only tools', () => {
    for (const tool of ['go_live', 'get_stats', 'share_links', 'test_experience']) {
      expect(proposalGaps(tool, {})).toEqual([]);
    }
  });

  it('does not invent a requirement for a tool it does not know', () => {
    // Guessing here would dead-end a tool added on the server before the client
    // learns about it — the executor still validates.
    expect(proposalGaps('some_future_tool', {})).toEqual([]);
  });
});

describe('proposalGaps — spending tools', () => {
  it('hard-blocks an empty frame brief', () => {
    const gaps = proposalGaps('generate_frame', { prompt: '' });
    expect(requiredGaps(gaps)).toHaveLength(1);
    expect(gaps[0].id).toBe('detail');
  });

  it('hard-blocks a missing prompt entirely', () => {
    expect(requiredGaps(proposalGaps('generate_frame', {}))).toHaveLength(1);
  });

  it('asks — but does not hard-block — a vague-but-real brief', () => {
    // "a gold frame" names a colour and nothing else. Worth a question; not
    // worth refusing a host who means it.
    const gaps = proposalGaps('generate_frame', { prompt: 'a gold frame' });
    expect(gaps.map((g) => g.id)).toEqual(['style']);
    expect(requiredGaps(gaps)).toEqual([]);
  });

  it('passes a specific brief with no questions at all', () => {
    expect(proposalGaps('generate_frame', { prompt: 'art-deco sunburst corners in brass on black' })).toEqual([]);
  });

  it('applies the 3D brief rules to a generated head piece', () => {
    expect(proposalGaps('add_head_piece', { source: 'generate', prompt: '' })).toHaveLength(1);
    expect(proposalGaps('add_head_piece', { source: 'generate', prompt: 'a venetian mask in brushed gold metal' })).toEqual([]);
  });
});

describe('gapPrompt', () => {
  it('is empty when nothing is missing', () => {
    expect(gapPrompt([])).toBe('');
  });

  it('asks the question with its example', () => {
    const msg = gapPrompt(proposalGaps('add_challenge', {}));
    expect(msg).toContain('What should the challenge be called?');
    expect(msg).toContain('Best dance move');
  });

  it('leads with the cost when a credit is about to be spent', () => {
    const msg = gapPrompt(proposalGaps('generate_frame', { prompt: 'a gold frame' }), { spending: true });
    expect(msg).toMatch(/before i spend/i);
  });

  it('offers the way through when the gap is only a quality one', () => {
    const msg = gapPrompt(proposalGaps('generate_frame', { prompt: 'a gold frame' }), { spending: true, canProceed: true });
    expect(msg).toMatch(/again to go ahead/i);
  });

  it('does not offer a way through when the field is genuinely required', () => {
    const msg = gapPrompt(proposalGaps('add_challenge', {}));
    expect(msg).not.toMatch(/go ahead/i);
  });

  it('asks at most two questions, so it does not read as a form', () => {
    const many = proposalGaps('generate_frame', { prompt: 'ooh nice please make it' });
    expect(many.length).toBeGreaterThanOrEqual(2);
    const msg = gapPrompt(many);
    expect(msg.split(' And ')).toHaveLength(2);
  });
});

describe('proposalGaps — packs and briefs', () => {
  it('a known packId is a complete pack; an unknown one still needs challenges', () => {
    expect(proposalGaps('add_challenge_pack', { packId: 'wedding' })).toEqual([]);
    expect(proposalGaps('add_challenge_pack', { packId: 'wedding', challenges: [] })).toEqual([]);
    expect(proposalGaps('add_challenge_pack', { packId: 'circus' }).map((g) => g.id)).toEqual(['challenges']);
    expect(proposalGaps('add_challenge_pack', { packId: 'circus', challenges: [{ title: 'x' }] })).toEqual([]);
  });

  it('update_brief needs at least one filled field', () => {
    const gaps = proposalGaps('update_brief', { palette: '  ', tone: '' });
    expect(gaps.map((g) => g.id)).toEqual(['brief']);
    expect(gaps[0].required).toBe(true);
    expect(proposalGaps('update_brief', { notes: 'Her dad flies in.' })).toEqual([]);
    expect(proposalGaps('update_brief', {})).toHaveLength(1);
  });
});
