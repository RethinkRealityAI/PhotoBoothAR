import { describe, it, expect } from 'vitest';
import {
  buildConceptPrompt,
  buildFrameArtDirection,
  buildMeshyPrompt,
  inferFrameLayout,
  inferPieceKind,
  paletteDirection,
  FRAME_LAYOUT_SPEC,
  type PieceKind,
  FRAME_COMPOSITION,
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
    // A helmet is NOT a mask: it opens at the neck and has a face gap, where
    // the mask rules ask for cut-through eye holes and an open lower edge.
    expect(inferPieceKind('a chrome helmet')).toBe('helmet');
    expect(inferPieceKind('an astronaut helmet')).toBe('helmet');
    expect(inferPieceKind('a venetian mask')).toBe('mask');
    // Glasses wins over mask for "masquerade glasses" because eyewear geometry
    // (rims + bridge + arms) is the harder constraint to get right.
    expect(inferPieceKind('masquerade glasses')).toBe('glasses');
  });

  it('falls back to generic for something it cannot place', () => {
    expect(inferPieceKind('a shimmering aura thing')).toBe('generic');
  });

  it('recognises the jewellery kinds, which are worn on ONE feature not the head', () => {
    expect(inferPieceKind('gold hoop earrings')).toBe('earring');
    expect(inferPieceKind('septum ring')).toBe('piercing');
    expect(inferPieceKind('face gems')).toBe('faceGem');
  });

  it('reads "ear cuff" as an earring, not as a headband arc', () => {
    // The `ears` pattern matches a bare "ear", so before the jewellery kinds
    // were inserted ahead of it an ear cuff was given headband geometry.
    expect(inferPieceKind('ear cuff')).toBe('earring');
    // …and the headband case it used to serve still resolves to `ears`.
    expect(inferPieceKind('cat ears headband')).toBe('ears');
  });
});

describe('buildConceptPrompt', () => {
  const HOLLOW_KINDS: PieceKind[] = ['mask', 'helmet', 'hat', 'crown', 'glasses', 'ears', 'generic'];

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

  it('opens a helmet at the neck with a face gap, not with eye holes', () => {
    const p = buildConceptPrompt('a chrome motorcycle helmet');
    expect(p).toMatch(/neck opening/i);
    expect(p).toMatch(/face gap/i);
    expect(p).not.toMatch(/cut-through eye openings/i);
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

  it('sizes a nose ring in millimetres and keeps its hoop open', () => {
    const p = buildConceptPrompt('a nose ring');
    expect(p).toMatch(/open|gap/i); // a closed torus cannot clip onto a nostril
    expect(p).toMatch(/mm/); // the piece is millimetres, not centimetres
    // The generic fallback would have sized it "roughly 15-20cm at its largest".
    expect(p).not.toMatch(/15-20cm/);
  });

  it('keeps an earring off an ear and a face gem off a face', () => {
    expect(buildConceptPrompt('gold hoop earrings')).toMatch(/NO ear\b/);
    const gem = buildConceptPrompt('cheek gems');
    expect(gem).toMatch(/FLAT back/);
    expect(gem).toMatch(/NO face/);
  });
});

describe('FRAME_LAYOUT_SPEC', () => {
  it('keeps classic-border byte-identical to the prompt already in production', () => {
    // This literal is the string ai-generate-image has always sent for a
    // green-screen frame (its buildPrompt border branch). Moving it into the
    // table must not change one character, or every existing frame archetype
    // silently regenerates differently.
    const LEGACY =
      'Create a full-bleed decorative FRAME composition for a 9:16 vertical portrait canvas ' +
      '(1080x1920). ALL decorative art must hug the four edges as a border. Fill the ENTIRE ' +
      'central area AND the whole background with ONE solid pure green colour #00FF00 — a flat, ' +
      'uniform chroma-key green with NO gradients, NO shadows, NO texture, NO vignette or glow on ' +
      'the green. Do not place any art, drop-shadow, or highlight over the green region; the green ' +
      'must read as a single exact colour so it can be keyed out. Use NO green anywhere in the ' +
      'border artwork itself, and give it no green tint, green reflection or green rim-light — ' +
      'anything green in the art will be punched out as a hole.';
    expect(FRAME_LAYOUT_SPEC['classic-border']).toBe(LEGACY);
  });

  it('gives full-scene a keyable head cutout with no face painted in it', () => {
    const p = FRAME_LAYOUT_SPEC['full-scene'];
    expect(p).toContain('#00FF00');
    expect(p).toContain('38%'); // vertical centre of the cutout
    expect(p).toMatch(/ellipse/);
    expect(p).toContain(
      'The ellipse contains NOTHING but flat green — no person, no face, no silhouette inside it.',
    );
  });

  it('carries the proven anti-spill wording on every archetype', () => {
    for (const [layout, spec] of Object.entries(FRAME_LAYOUT_SPEC)) {
      expect(spec, layout).toMatch(
        /flat, uniform chroma-key green with NO gradients, NO shadows, NO texture, NO vignette or glow/,
      );
      expect(spec, layout).toMatch(/Use NO green anywhere in the (border )?artwork itself/);
      expect(spec, layout).toContain('1080x1920');
    }
  });

  it('places duo cutouts apart and keeps the other two archetypes off the centre', () => {
    const duo = FRAME_LAYOUT_SPEC['duo-scene'];
    expect(duo).toContain('30%');
    expect(duo).toContain('70%');
    expect(duo).toMatch(/TWO head cutouts/);
    expect(FRAME_LAYOUT_SPEC['corner-overlay']).toMatch(/top-left and bottom-right/);
    expect(FRAME_LAYOUT_SPEC['bottom-third']).toMatch(/BELOW 66% of the height/);
  });
});

describe('inferFrameLayout', () => {
  it('reads a scene-with-a-cutout brief as a full scene', () => {
    expect(inferFrameLayout('an underwater scene with a head cutout')).toBe('full-scene');
    expect(inferFrameLayout('a retro sci-fi backdrop with a face hole')).toBe('full-scene');
  });

  it('reads a two-header as a duo scene, even though it also names a cutout', () => {
    expect(inferFrameLayout('a jungle scene with head cutouts for both of us')).toBe('duo-scene');
    expect(inferFrameLayout('a backdrop for two of us')).toBe('duo-scene');
  });

  it('recognises the corner and lower-third archetypes', () => {
    expect(inferFrameLayout('gold art-deco ornaments in the corners')).toBe('corner-overlay');
    expect(inferFrameLayout('a lower third banner with our names')).toBe('bottom-third');
    expect(inferFrameLayout('a neon marquee along the bottom')).toBe('bottom-third');
  });

  it('defaults to the classic border — the shape every frame had before', () => {
    expect(inferFrameLayout('art-deco gold border with confetti')).toBe('classic-border');
    expect(inferFrameLayout('')).toBe('classic-border');
    // A scene word alone is not enough: "gold background" is still a border.
    expect(inferFrameLayout('a gold background')).toBe('classic-border');
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
    expect(buildFrameArtDirection('a frame', { accentHexes: ['#D4AF37'] })).toContain('#D4AF37');
  });

  it('still constrains the palette when no accent is known', () => {
    const p = buildFrameArtDirection('a frame');
    expect(p).toMatch(/disciplined palette/i);
    expect(p).not.toContain('undefined');
  });
});

describe('paletteDirection', () => {
  it('names a dominant and a supporting colour when the event has a palette', () => {
    // events.config.accentHexes is ordered, [0] dominant — the real shape
    // (src/events/runtime.ts:106), not the `config.accent` key that never existed.
    const p = paletteDirection(['#D4AF37', '#EACB6E', '#FBF3D9', '#A87C1F']);
    expect(p).toContain('#D4AF37');
    expect(p).toContain('#EACB6E');
  });

  it('uses at most two colours — four hexes in a prompt produce a muddy rainbow', () => {
    const p = paletteDirection(['#D4AF37', '#EACB6E', '#FBF3D9', '#A87C1F']);
    expect(p).not.toContain('#FBF3D9');
    expect(p).not.toContain('#A87C1F');
  });

  it('falls back to the disciplined wording for an empty or unusable palette', () => {
    expect(paletteDirection([])).toMatch(/disciplined palette/i);
    expect(paletteDirection(null)).toMatch(/disciplined palette/i);
    // A config written by hand can carry junk; a non-hex must not reach the model.
    expect(paletteDirection(['gold', ''])).toMatch(/disciplined palette/i);
  });

  it('handles a single-colour palette without inventing a second', () => {
    const p = paletteDirection(['#D4AF37']);
    expect(p).toContain('#D4AF37');
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

describe('FRAME_COMPOSITION (layout-aware art direction)', () => {
  it('keeps the classic-border composition byte-identical to the legacy text', () => {
    expect(FRAME_COMPOSITION['classic-border']).toBe(
      'Composition: treat the four edges as a deliberate composition, not a repeating stamp. Anchor the ' +
      'design with heavier ornament in two opposite corners and let it thin out along the long edges, ' +
      'so the eye travels. Keep the top-centre and bottom-centre calmer than the corners.',
    );
  });

  it('never sends edge-border composition with a scene layout', () => {
    // The defect this fixes: "keep the top-centre calmer than the corners" was
    // sent alongside a brief asking for a full-bleed scene — the two directives
    // fight, and the model averages them into mush.
    for (const layout of ['full-scene', 'duo-scene'] as const) {
      expect(FRAME_COMPOSITION[layout]).not.toMatch(/four edges|opposite corners|top-centre/);
      expect(FRAME_COMPOSITION[layout]).toMatch(/cutout/);
    }
  });

  it('buildFrameArtDirection swaps composition by layout and defaults to classic', () => {
    const scene = buildFrameArtDirection('an enchanted forest', { layout: 'full-scene' });
    const classic = buildFrameArtDirection('an enchanted forest', {});
    expect(scene).toContain('designed AROUND the head cutout');
    expect(classic).toContain('four edges as a deliberate composition');
    expect(classic).not.toContain('designed AROUND');
  });
});
