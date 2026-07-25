import { describe, it, expect } from 'vitest';
import { briefIsReady, frameBriefGaps, gapSummary, pieceBriefGaps } from './assetBrief';

describe('frameBriefGaps', () => {
  it('asks for everything when the brief is barely there', () => {
    // "gold frame" is what hosts actually type, and what produced the generic
    // output this module exists to prevent.
    const gaps = frameBriefGaps('gold');
    expect(gaps.map((g) => g.id)).toEqual(['detail']);
  });

  it('accepts a short but specific brief', () => {
    const gaps = frameBriefGaps('art-deco sunburst corners in brass on black');
    expect(gaps).toEqual([]);
  });

  it('asks for colour when the brief names only a style', () => {
    expect(frameBriefGaps('clean minimalist geometric border').map((g) => g.id)).toEqual(['colour']);
  });

  it('asks for style when the brief names only colours', () => {
    expect(frameBriefGaps('ivory and gold and blush').map((g) => g.id)).toEqual(['style']);
  });

  it('counts a motif as answering the style question', () => {
    expect(frameBriefGaps('gold botanical vines')).toEqual([]);
  });

  it('accepts a hex colour as a colour answer', () => {
    expect(frameBriefGaps('#D4AF37 art-deco border')).toEqual([]);
  });
});

describe('pieceBriefGaps', () => {
  it('asks what the object is when the brief never says', () => {
    expect(pieceBriefGaps('something gold and shiny').map((g) => g.id)).toContain('object');
  });

  it('accepts a brief that names the object and its material', () => {
    expect(pieceBriefGaps('a venetian mask in brushed gold metal')).toEqual([]);
  });

  it('asks for material when only the object is named', () => {
    expect(pieceBriefGaps('a masquerade mask thing').map((g) => g.id)).toEqual(['material']);
  });

  it('treats a colour as answering the material question', () => {
    expect(pieceBriefGaps('a crimson venetian mask')).toEqual([]);
  });

  it('short-circuits to one question on a two-word brief', () => {
    expect(pieceBriefGaps('a mask').map((g) => g.id)).toEqual(['detail']);
  });
});

describe('briefIsReady', () => {
  it('is false while gaps remain', () => {
    const b = 'gold';
    expect(briefIsReady(b, frameBriefGaps(b))).toBe(false);
  });

  it('is true for a specific brief', () => {
    const b = 'art-deco sunburst corners in brass on black';
    expect(briefIsReady(b, frameBriefGaps(b))).toBe(true);
  });

  it('is false for a long brief that still has gaps', () => {
    // Length is not the test — this is wordy and still says nothing usable.
    const b = 'something really nice and lovely that everyone will enjoy a lot';
    expect(briefIsReady(b, frameBriefGaps(b))).toBe(false);
  });
});

describe('gapSummary', () => {
  it('is empty when nothing is missing', () => {
    expect(gapSummary([])).toBe('');
  });

  it('names at most two gaps, so the card does not read as a form', () => {
    const summary = gapSummary(pieceBriefGaps('thing'));
    expect(summary).toContain('e.g.');
    expect(summary.split(' and ').length).toBeLessThanOrEqual(2);
  });
});
