import { describe, it, expect } from 'vitest';
import {
  buildConceptPrompt,
  buildFrameArtDirection,
  buildMeshyPrompt,
  inferPieceKind,
  type PieceKind,
} from './assetPrompt';

describe('inferPieceKind', () => {
  it('recognises the head-worn kinds', () => {
    expect(inferPieceKind('a venetian masquerade mask')).toBe('mask');
    expect(inferPieceKind('gold top hat')).toBe('hat');
    expect(inferPieceKind('a jewelled tiara')).toBe('crown');
    expect(inferPieceKind('neon sunglasses')).toBe('glasses');
    expect(inferPieceKind('cat ears headband')).toBe('ears');
    expect(inferPieceKind('a golden trophy')).toBe('held');
  });

  it('prefers the more specific kind when a brief could match two', () => {
    // "cat ear headband" is ears, not a hat; "welding helmet" is a mask shell.
    expect(inferPieceKind('bunny ears on a headband')).toBe('ears');
    expect(inferPieceKind('a chrome helmet')).toBe('mask');
    // Glasses wins over mask for "masquerade glasses" because eyewear geometry
    // (rims + bridge + arms) is the harder constraint to get right.
    expect(inferPieceKind('masquerade glasses')).toBe('glasses');
  });

  it('falls back to generic for something it cannot place', () => {
    expect(inferPieceKind('a shimmering aura thing')).toBe('generic');
  });
});

describe('buildConceptPrompt', () => {
  const HOLLOW_KINDS: PieceKind[] = ['mask', 'hat', 'crown', 'glasses', 'ears', 'generic'];

  it('forbids a head, face or mannequin on every head-worn kind', () => {
    // The exact failure this exists to prevent: a concept showing the piece ON
    // a face makes image->3D fuse the face into the mesh.
    for (const kind of HOLLOW_KINDS) {
      const p = buildConceptPrompt('something', kind);
      expect(p).toMatch(/NO (head|face|mannequin)/i);
    }
  });

  it('demands a visible cavity for a mask, not a solid shell', () => {
    const p = buildConceptPrompt('a venetian mask');
    expect(p).toMatch(/HOLLOW/);
    expect(p).toMatch(/eye openings|eye holes/i);
    expect(p).toMatch(/three-quarter/i);
  });

  it('states a real-world scale so proportions are anchored', () => {
    expect(buildConceptPrompt('a top hat')).toMatch(/cm/);
  });

  it('keeps the host brief verbatim in the prompt', () => {
    expect(buildConceptPrompt('a feathered venetian mask in gold')).toContain(
      'a feathered venetian mask in gold',
    );
  });

  it('rules out scene furniture that image-to-3D would model as part of the object', () => {
    const p = buildConceptPrompt('a trophy');
    expect(p).toMatch(/no base|no pedestal|no ground plane/i);
  });
});

describe('buildMeshyPrompt', () => {
  it('carries the geometry rules, not just the brief', () => {
    const p = buildMeshyPrompt('a venetian mask');
    expect(p).toContain('a venetian mask');
    expect(p).toMatch(/HOLLOW/);
    expect(p).toMatch(/open/i);
  });

  it('asks for an open ring on a crown rather than a solid dome', () => {
    const p = buildMeshyPrompt('a laurel crown');
    expect(p).toMatch(/OPEN circular band|ring/i);
    expect(p).toMatch(/not a solid disc or dome/i);
  });

  it('asks for empty lenses on glasses', () => {
    expect(buildMeshyPrompt('neon shades')).toMatch(/lens area is empty|NOT solid blocks/i);
  });

  it('forbids floating disconnected pieces', () => {
    expect(buildMeshyPrompt('anything')).toMatch(/floating disconnected/i);
  });
});

describe('buildFrameArtDirection', () => {
  it('keeps the brief and adds composition, craft and a quality bar', () => {
    const p = buildFrameArtDirection('art-deco border');
    expect(p).toContain('art-deco border');
    expect(p).toMatch(/Composition:/);
    expect(p).toMatch(/Craft:/);
    expect(p).toMatch(/Quality bar:/);
  });

  it('bans text, which otherwise turns up baked into frames', () => {
    expect(buildFrameArtDirection('anything')).toMatch(/No text/i);
  });

  it('builds the palette around the event accent when there is one', () => {
    expect(buildFrameArtDirection('a frame', { accentHex: '#D4AF37' })).toContain('#D4AF37');
  });

  it('still constrains the palette when no accent is known', () => {
    const p = buildFrameArtDirection('a frame');
    expect(p).toMatch(/disciplined palette/i);
    expect(p).not.toContain('undefined');
  });

  it('sets a concrete register per event type rather than saying "elegant"', () => {
    const wedding = buildFrameArtDirection('a frame', { eventType: 'wedding' });
    expect(wedding).toMatch(/botanical|ribbon|pearl/i);
    const gala = buildFrameArtDirection('a frame', { eventType: 'gala' });
    expect(gala).toMatch(/art-deco|sunburst|jewel/i);
  });

  it('ignores an event type it has no register for, without emitting a stray label', () => {
    const p = buildFrameArtDirection('a frame', { eventType: 'bar-mitzvah' });
    expect(p).not.toMatch(/Register:/);
    expect(p).toContain('a frame');
  });

  it('is case-insensitive about the event type', () => {
    expect(buildFrameArtDirection('a frame', { eventType: 'Wedding' })).toMatch(/botanical/i);
  });
});
