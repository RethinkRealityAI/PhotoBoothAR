import { describe, it, expect } from 'vitest';
import {
  normalizeScenePlan,
  planFromJson,
  parseDirectorTurn,
  pieceCreditCost,
  totalCreditCost,
  initialProgress,
  setPieceStatus,
  isSceneSettled,
  FRAME_CREDIT_COST,
  GENERATE_3D_CREDIT_COST,
  buildSceneContext,
  MAX_SCENE_CONTEXT_CHARS,
  type SceneShaderCatalogEntry,
  type ScenePlan,
} from './sceneDirector';

const CATALOG: SceneShaderCatalogEntry[] = [
  { id: 'champagne-sparkle', params: [{ key: 'uIntensity', min: 0, max: 1, default: 0.5 }] },
  { id: 'noir-classic', params: [] },
];
const PIECES = ['royal-crown', 'neon-shades'];

const FULL = {
  sceneName: 'Neon Nights',
  frame: { prompt: 'neon border with palm trees' },
  shader: { shaderId: 'champagne-sparkle', params: { uIntensity: 0.8 } },
  headPiece: { kind: 'procedural', id: 'neon-shades' },
};

describe('normalizeScenePlan', () => {
  it('passes a fully valid plan through', () => {
    const p = normalizeScenePlan(FULL, CATALOG, PIECES)!;
    expect(p.sceneName).toBe('Neon Nights');
    expect(p.frame?.prompt).toContain('palm trees');
    expect(p.shader).toEqual({ shaderId: 'champagne-sparkle', params: { uIntensity: 0.8 } });
    expect(p.headPiece).toEqual({ kind: 'procedural', id: 'neon-shades' });
  });
  it('clamps out-of-range params and fills missing ones with defaults', () => {
    const p = normalizeScenePlan(
      { ...FULL, shader: { shaderId: 'champagne-sparkle', params: { uIntensity: 42, uJunk: 1 } } },
      CATALOG, PIECES,
    )!;
    expect(p.shader?.params).toEqual({ uIntensity: 1 });
  });
  it('drops a hallucinated shader id instead of guessing', () => {
    const p = normalizeScenePlan({ ...FULL, shader: { shaderId: 'vaporwave-9000' } }, CATALOG, PIECES)!;
    expect(p.shader).toBeNull();
  });
  it('unknown procedural id with a prompt degrades to generate; without one it drops', () => {
    const withPrompt = normalizeScenePlan(
      { ...FULL, headPiece: { kind: 'procedural', id: 'nope', prompt: 'a chrome crown' } },
      CATALOG, PIECES,
    )!;
    expect(withPrompt.headPiece).toEqual({ kind: 'generate', prompt: 'a chrome crown' });
    const without = normalizeScenePlan({ ...FULL, headPiece: { kind: 'procedural', id: 'nope' } }, CATALOG, PIECES)!;
    expect(without.headPiece).toBeNull();
  });
  it('rejects plans with nothing usable, non-objects, and blank prompts', () => {
    expect(normalizeScenePlan({ sceneName: 'x' }, CATALOG, PIECES)).toBeNull();
    expect(normalizeScenePlan('nope', CATALOG, PIECES)).toBeNull();
    expect(normalizeScenePlan({ frame: { prompt: '   ' } }, CATALOG, PIECES)).toBeNull();
  });
  it('defaults a missing scene name', () => {
    const p = normalizeScenePlan({ frame: { prompt: 'gold frame' } }, CATALOG, PIECES)!;
    expect(p.sceneName).toBe('Custom Scene');
  });
});

describe('planFromJson (Gemini string-encoded plan)', () => {
  it('parses a JSON string plan', () => {
    expect(planFromJson(JSON.stringify(FULL), CATALOG, PIECES)?.sceneName).toBe('Neon Nights');
  });
  it('malformed JSON and non-strings return null', () => {
    expect(planFromJson('{oops', CATALOG, PIECES)).toBeNull();
    expect(planFromJson(42, CATALOG, PIECES)).toBeNull();
  });
});

describe('parseDirectorTurn (reply + optional plan)', () => {
  it('parses reply + plan when planJson is a valid scene', () => {
    const turn = parseDirectorTurn({ reply: 'Here is your scene.', planJson: JSON.stringify(FULL) }, CATALOG, PIECES)!;
    expect(turn.reply).toBe('Here is your scene.');
    expect(turn.plan?.sceneName).toBe('Neon Nights');
  });
  it('reply-only ideation turn (no planJson) yields plan null, not an error', () => {
    const turn = parseDirectorTurn({ reply: 'For a gala, deep emerald with warm gold reads elegant.' }, CATALOG, PIECES)!;
    expect(turn.reply).toContain('emerald');
    expect(turn.plan).toBeNull();
  });
  it('empty and malformed planJson stay clean (plan null) while the reply survives', () => {
    const empty = parseDirectorTurn({ reply: 'What colours are you drawn to?', planJson: '' }, CATALOG, PIECES)!;
    expect(empty.plan).toBeNull();
    expect(empty.reply).toContain('colours');
    const bad = parseDirectorTurn({ reply: 'Working on it.', planJson: '{oops' }, CATALOG, PIECES)!;
    expect(bad.reply).toBe('Working on it.');
    expect(bad.plan).toBeNull();
  });
  it('tolerates a missing reply when a plan is present', () => {
    const turn = parseDirectorTurn({ planJson: JSON.stringify(FULL) }, CATALOG, PIECES)!;
    expect(turn.reply).toBe('');
    expect(turn.plan?.sceneName).toBe('Neon Nights');
  });
  it('returns null when there is neither a usable reply nor a plan', () => {
    expect(parseDirectorTurn({ reply: '   ', planJson: '' }, CATALOG, PIECES)).toBeNull();
    expect(parseDirectorTurn('nope', CATALOG, PIECES)).toBeNull();
    expect(parseDirectorTurn(null, CATALOG, PIECES)).toBeNull();
  });
});

describe('credits', () => {
  it('frame costs 1, procedural piece free, generated piece 10, shader free', () => {
    const p = normalizeScenePlan(FULL, CATALOG, PIECES)!;
    expect(pieceCreditCost(p, 'frame')).toBe(FRAME_CREDIT_COST);
    expect(pieceCreditCost(p, 'shader')).toBe(0);
    expect(pieceCreditCost(p, 'headPiece')).toBe(0);
    expect(totalCreditCost(p)).toBe(1);
    const gen = normalizeScenePlan({ ...FULL, headPiece: { kind: 'generate', prompt: 'crown' } }, CATALOG, PIECES)!;
    expect(pieceCreditCost(gen, 'headPiece')).toBe(GENERATE_3D_CREDIT_COST);
    expect(totalCreditCost(gen)).toBe(11);
  });
});

describe('scene progress', () => {
  it('missing pieces start settled as skipped', () => {
    const p = normalizeScenePlan({ frame: { prompt: 'x' } }, CATALOG, PIECES)!;
    const prog = initialProgress(p);
    expect(prog).toEqual({ frame: 'proposed', shader: 'skipped', headPiece: 'skipped' });
    expect(isSceneSettled(prog)).toBe(false);
    expect(isSceneSettled(setPieceStatus(prog, 'frame', 'accepted'))).toBe(true);
  });
  it('working pieces keep the scene unsettled; failed counts as settled', () => {
    const p = normalizeScenePlan(FULL, CATALOG, PIECES)!;
    let prog = initialProgress(p);
    prog = setPieceStatus(prog, 'frame', 'working');
    expect(isSceneSettled(prog)).toBe(false);
    prog = setPieceStatus(prog, 'frame', 'failed');
    prog = setPieceStatus(prog, 'shader', 'accepted');
    prog = setPieceStatus(prog, 'headPiece', 'skipped');
    expect(isSceneSettled(prog)).toBe(true);
  });
});

describe('buildSceneContext', () => {
  const plan: ScenePlan = {
    sceneName: 'Art Deco Gold',
    frame: { prompt: 'art-deco sunburst corners in brass on matte black' },
    shader: { shaderId: 'noir-classic', params: {} },
    headPiece: { kind: 'generate', prompt: 'a gold laurel wreath' },
  };

  it('is empty when there is nothing to tell the model (field then omitted)', () => {
    expect(buildSceneContext(null, null)).toBe('');
  });

  it('summarises the open draft: filter + object names and kinds', () => {
    const out = buildSceneContext({
      shaderId: 'noir-classic',
      objects: [
        { name: 'Gold Frame', type: 'overlay', overlayKind: 'border' },
        { name: 'Sparkles', type: 'overlay', overlayKind: '2d_filter' },
        { name: 'Crown', type: 'headpiece' },
      ],
    }, null);
    expect(out).toContain('filter "noir-classic"');
    expect(out).toContain('"Gold Frame" (frame)');
    expect(out).toContain('"Sparkles" (sticker)');
    expect(out).toContain('"Crown" (3D head piece)');
    expect(out).not.toContain('last scene');
  });

  it('reports an empty draft honestly ("none" filter is no filter)', () => {
    const out = buildSceneContext({ shaderId: 'none', objects: [] }, null);
    expect(out).toContain('no filter');
    expect(out).toContain('no pieces yet');
  });

  it('summarises the last plan’s slots so the Director can iterate on it', () => {
    const out = buildSceneContext(null, plan);
    expect(out).toContain('Art Deco Gold');
    expect(out).toContain('art-deco sunburst');
    expect(out).toContain('filter: noir-classic');
    expect(out).toContain('generate "a gold laurel wreath"');
  });

  it('names a built-in head piece and null slots', () => {
    const out = buildSceneContext(null, {
      sceneName: 'Quiet Ivory', frame: null, shader: null,
      headPiece: { kind: 'procedural', id: 'royal-crown' },
    });
    expect(out).toContain('frame: none');
    expect(out).toContain('filter: none');
    expect(out).toContain('built-in "royal-crown"');
  });

  it('caps its length whatever the scene holds', () => {
    const objects = Array.from({ length: 30 }, (_v, i) => ({ name: `Object number ${i} with a long name`, type: 'model' }));
    const out = buildSceneContext({ shaderId: 'noir-classic', objects }, {
      ...plan, frame: { prompt: 'x'.repeat(500) },
    });
    expect(out.length).toBeLessThanOrEqual(MAX_SCENE_CONTEXT_CHARS);
    expect(out).toContain('Object number 0');
    expect(out).not.toContain('Object number 9'); // only the first 8 are listed
  });
});
