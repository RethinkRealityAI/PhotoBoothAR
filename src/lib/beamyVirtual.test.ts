import { describe, expect, it } from 'vitest';
import { AUTO_DELIVERY, AUTO_DELIVERY_RE, VC_COPY, VC_PIECES, VC_SCENE, VC_SEQ, vcLines } from './beamyVirtual';
import { EMOJI_RE } from './brandLanding';
import { STOPS } from './beamyScroll';

describe('beamyVirtual copy', () => {
  it('never promises timed or automatic delivery while none ships', () => {
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
    if (!AUTO_DELIVERY) for (const l of vcLines()) expect(l, l).not.toMatch(AUTO_DELIVERY_RE);
  });

  it('says the host sends it', () => {
    expect(VC_COPY.line).toMatch(/\byou send\b/);
  });

  it('only names what contributors can really leave (note, photo, short video) and never the AR booth', () => {
    expect(VC_COPY.line).toMatch(/note/);
    expect(VC_COPY.line).toMatch(/photo/);
    expect(VC_COPY.line).toMatch(/video/);
    // Card contributions record with a plain camera (CaptureSurface), not the booth.
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
    expect(VC_COPY.line).toMatch(/digital/);
  });

  it('keeps the scene words short', () => {
    for (const l of [...Object.values(VC_SCENE), ...VC_PIECES.map((p) => p.text ?? '')]) expect(l.length, l).toBeLessThanOrEqual(32);
    expect(VC_COPY.line.length).toBeLessThanOrEqual(170);
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

  it('is a stop Beamy glides to, between the films and the options', () => {
    const ids = STOPS.map((s) => s.id);
    expect(ids.indexOf('virtual')).toBe(ids.indexOf('films') + 1);
    expect(STOPS.find((s) => s.id === 'virtual')?.label).toBe(VC_COPY.stop);
  });
});
