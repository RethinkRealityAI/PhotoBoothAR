import { describe, it, expect } from 'vitest';
import { deckLabels, guestLookTitles, isUntitledName, DECK_LABEL_MAX } from './lookLabels';

describe('deckLabels', () => {
  it('drops a leading word the siblings share (the cap-test-event "Gold · Gold · Gold")', () => {
    expect(deckLabels(['Gold Confetti', 'Gold Border', 'Gold Corners'])).toEqual(['Confetti', 'Border', 'Corners']);
  });

  it('keeps names that share nothing whole', () => {
    expect(deckLabels(['Gold Frame', 'Silver Frame'])).toEqual(['Gold Frame', 'Silver Frame']);
  });

  it('only strips within the group that shares the word', () => {
    expect(deckLabels(['Gold Confetti', 'Gold Border', 'Neon Scene'])).toEqual(['Confetti', 'Border', 'Neon Scene']);
  });

  it('strips every word the whole group shares, but leaves each at least one', () => {
    expect(deckLabels(['Gold Leaf Border', 'Gold Leaf Corners'])).toEqual(['Border', 'Corners']);
    expect(deckLabels(['Gold Border', 'Gold Border Thin'])).toEqual(['Border', 'Border Thin']);
  });

  it('drops a shared trailing phrase of two or more words', () => {
    expect(deckLabels(['Gameday Face Paint', 'Skull Face Paint', 'Skull Whiteout', 'Natural']))
      .toEqual(['Gameday', 'Skull', 'Skull Whiteout', 'Natural']);
  });

  it('keeps a single shared last word — it often says what the thing is', () => {
    expect(deckLabels(['Kabuki Mask', 'Racer Mask'])).toEqual(['Kabuki Mask', 'Racer Mask']);
  });

  it('never strips a name down to nothing from both ends', () => {
    expect(deckLabels(['Gold Face Paint', 'Gold Skull Face Paint'])).toEqual(['Gold', 'Gold Skull']);
  });

  it('is case-insensitive about the shared word', () => {
    expect(deckLabels(['gold Confetti', 'Gold Border'])).toEqual(['Confetti', 'Border']);
  });

  it('never makes two different looks collide — the collided ones keep their full names', () => {
    expect(deckLabels(['Gold Border', 'Gold Corners', 'Border'])).toEqual(['Gold Border', 'Corners', 'Border']);
  });

  it('leaves identical names identical (nothing to disambiguate)', () => {
    expect(deckLabels(['Gold Star', 'Gold Star'])).toEqual(['Star', 'Star']);
  });

  it('keeps single words, and a lone sibling keeps its whole name', () => {
    expect(deckLabels(['Tiara'])).toEqual(['Tiara']);
    expect(deckLabels(['Queen Tiara'])).toEqual(['Queen Tiara']);
    expect(deckLabels(['Gold', 'Gold Border'])).toEqual(['Gold', 'Gold Border']);
  });

  it('cuts an over-long word and an over-long label with an ellipsis', () => {
    const [w] = deckLabels(['Kaleidoscopically']);
    expect(w.endsWith('…')).toBe(true);
    expect(Array.from(w).length).toBeLessThanOrEqual(11);
    const [l] = deckLabels(['A sleek blue cycling helmet with a stripe']);
    expect(l.endsWith('…')).toBe(true);
    expect(Array.from(l).length).toBeLessThanOrEqual(DECK_LABEL_MAX);
  });

  it('handles emoji without splitting them', () => {
    expect(deckLabels(['🎉 Party', '🎉 Gala'])).toEqual(['Party', 'Gala']);
    expect(deckLabels(['👑'])).toEqual(['👑']);
    const [long] = deckLabels(['👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦']);
    expect(long.endsWith('…')).toBe(true);
    expect(long.startsWith('👨‍👩‍👧‍👦')).toBe(true);
  });

  it('trims whitespace and copes with empty input', () => {
    expect(deckLabels(['  Gold   Border ', 'Gold Corners'])).toEqual(['Border', 'Corners']);
    expect(deckLabels([])).toEqual([]);
    expect(deckLabels([''])).toEqual(['']);
  });
});

describe('isUntitledName', () => {
  it('matches the Studio and db.ts defaults and their 3D twins', () => {
    expect(isUntitledName('Untitled Experience')).toBe(true);
    expect(isUntitledName('Untitled 3D Experience')).toBe(true);
    expect(isUntitledName('untitled experience')).toBe(true);
    expect(isUntitledName('Untitled Experience 3D')).toBe(true);
    expect(isUntitledName('   ')).toBe(true);
  });
  it('leaves real names alone', () => {
    expect(isUntitledName('Gold Border')).toBe(false);
    expect(isUntitledName('Untitledness Gala')).toBe(false);
  });
});

describe('guestLookTitles', () => {
  it('keeps named looks and labels unnamed ones by kind', () => {
    expect(guestLookTitles([
      { name: 'Gold Border', tab: 'frames' },
      { name: 'Untitled Experience', tab: 'frames' },
      { name: 'Untitled 3D Experience', tab: 'props' },
    ])).toEqual(['Gold Border', 'Frame', 'Prop']);
  });

  it('numbers several unnamed looks in one tab so they never read the same', () => {
    expect(guestLookTitles([
      { name: 'Untitled Experience', tab: 'frames' },
      { name: 'Gold Border', tab: 'frames' },
      { name: 'Untitled Experience', tab: 'frames' },
      { name: 'Untitled Experience', tab: 'paint' },
    ])).toEqual(['Frame 1', 'Gold Border', 'Frame 2', 'Paint']);
  });
});
