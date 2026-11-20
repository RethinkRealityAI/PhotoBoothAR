import { describe, expect, it } from 'vitest';
import { AUTO_DELIVERY, AUTO_DELIVERY_RE, VC_COPY, VC_PIECES, VC_SCENE, VC_SEQ, vcLines } from './beamyVirtual';
import { EMOJI_RE, STORY_STEPS } from './brandLanding';
import { STOPS } from './beamyScroll';
import { STORY_SEQ } from './beamyStory';

describe('beamyVirtual copy', () => {
  it('never over-promises delivery', () => {
    // Negative controls: the pattern really catches the promises it exists for.
    for (const bad of [
      'Emailed to them automatically on their birthday',
      'We will send it on the day',
      'Schedule it for the big day',
      'Auto-send on their birthday',
      'A birthday email, delivered on time',
      'we’ll email it for you',
    ]) expect(AUTO_DELIVERY_RE.test(bad), bad).toBe(true);
    // The truthful phrasing passes.
    expect(AUTO_DELIVERY_RE.test('one digital card that you send on the big day')).toBe(false);
    // Banned always (also now that a host-picked send day ships): it is the host's day, not a promise of magic.
    for (const l of vcLines()) expect(l, l).not.toMatch(AUTO_DELIVERY_RE);
  });

  it('says who sends it, truthfully', () => {
    // Timed delivery is live (card-deliveries cron + card-publish): the host picks the day.
    // Without it, the host sends it by hand and the copy must say so.
    if (AUTO_DELIVERY) expect(VC_COPY.body).toMatch(/\byou pick the day\b/i);
    else expect(VC_COPY.body).toMatch(/\byou send\b/i);
  });

  it('only names what contributors can really leave (note, photo, short video) and never the AR booth', () => {
    expect(VC_COPY.body).toMatch(/note/);
    expect(VC_COPY.body).toMatch(/photo/);
    expect(VC_COPY.body).toMatch(/video/);
    // Contributors get at most a frames-only booth (cardBoothKit): the copy never names it, props or filters.
    for (const l of vcLines()) expect(l, l).not.toMatch(/\bbooth\b|\bAR\b|\bfilters?\b|\bprops?\b|\b3D\b/i);
    expect(new Set(VC_PIECES.map((p) => p.kind))).toEqual(new Set(['note', 'photo', 'video']));
  });

  it('stays digital, remote, on-brand', () => {
    for (const l of vcLines()) {
      expect(l, l).not.toMatch(EMOJI_RE);
      expect(l, l).not.toMatch(/—|–/);
      expect(l, l).not.toMatch(/\bstudio\b/i);
      expect(l, l).not.toMatch(/print|printed|physical|mailed|post(ed)? to|on[- ]site|in person|at your venue|technician|attendant/i);
    }
    expect(`${VC_COPY.title} ${VC_COPY.body}`).toMatch(/digital/);
  });

  it('keeps the scene words short', () => {
    for (const l of [...Object.values(VC_SCENE), ...VC_PIECES.map((p) => p.text ?? '')]) expect(l.length, l).toBeLessThanOrEqual(32);
    expect(VC_COPY.body.length).toBeLessThanOrEqual(80);
  });
});

describe('beamyVirtual scene', () => {
  it('plays in the owner’s order, one beat at a time, and holds the last frame', () => {
    expect(VC_SEQ.cues.map((c) => c.id)).toEqual(['link', 'share', 'notes', 'photos', 'videos', 'assemble', 'deliver']);
    expect(VC_SEQ.loop).toBeUndefined();
  });

  it('flies every piece in on a real cue, from every edge, each from a different person', () => {
    const cues = new Set(VC_SEQ.cues.map((c) => c.id));
    for (const p of VC_PIECES) expect(cues.has(p.cue), p.id).toBe(true);
    expect(new Set(VC_PIECES.map((p) => p.who)).size).toBe(VC_PIECES.length);
    expect(new Set(VC_PIECES.map((p) => p.from)).size).toBe(VC_PIECES.length);
    expect(new Set(VC_PIECES.map((p) => p.edge)).size).toBe(4);
    for (const p of VC_PIECES) if (p.kind !== 'note') expect(p.photo, p.id).toBeTypeOf('number');
  });

  it('is How it works step 6, run by the story\'s sequencer, not a stop of its own', () => {
    expect(STORY_STEPS).toHaveLength(6);
    expect(STORY_STEPS[5]).toMatchObject({ id: 'virtual', title: VC_COPY.title, body: VC_COPY.body });
    expect(STORY_SEQ.virtual).toBe(VC_SEQ);
    expect(STOPS.map((s) => s.id as string)).not.toContain('virtual');
  });
});
