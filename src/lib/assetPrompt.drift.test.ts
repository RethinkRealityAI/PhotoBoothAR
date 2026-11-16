/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE PROMPT-MIRROR CONTRACT.
 *
 * Supabase edge functions cannot import from src/, so the prompt fragments
 * that ai-generate-image and ai-generate-3d send to the models were hand-copied
 * from src/lib/assetPrompt.ts and guarded by nothing but a comment: "change
 * one, change the other". assetPrompt.test.ts asserted the CLIENT copy's text;
 * nothing ever tied the two copies together, so a fix landing on one side
 * silently shipped a different prompt on the other.
 *
 * The server copies now live in pure, Deno-free sibling modules
 * (`supabase/functions/ai-generate-image/frameLayout.ts` and
 * `supabase/functions/ai-generate-3d/pieceGeometry.ts`) that BOTH the edge
 * function and this test import. Every mirrored pair is `toEqual`ed here, so
 * divergence is a red test in the same PR — this file replaces the old
 * comments. Importing the siblings also pulls them into `npm run lint` (the
 * repo tsconfig excludes supabase/), which closes the PR #28 class of bug — an
 * undeclared identifier in an edge function passing every repo gate — for the
 * prompt layer.
 *
 * Values the client does not export (GREEN_RULES, EMPTY_ELLIPSE,
 * NOT_A_STANDEE, EVENT_REGISTER, letteringPlacementSpec, KIND_PATTERNS) are
 * compared through the nearest exported derivation instead: FRAME_LAYOUT_SPEC
 * embeds the first three, buildFrameArtDirection embeds the register, and
 * inferPieceKind is the client's kind→regex routing. src/lib/assetPrompt.ts is
 * NOT edited to export more — the client twin is what this test compares
 * AGAINST.
 *
 * Deliberately NOT asserted: ai-generate-3d's per-kind geometry PROSE is a
 * condensed variant of the client's KIND_SPEC (same rules, shorter wording for
 * Meshy), so `withWearability` and `buildMeshyPrompt` differ by design — only
 * the routing (which kind a brief resolves to) is pinned.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as client from './assetPrompt';
import * as presets from './framePresets';
import * as quality from './studio/frameQuality';
import * as frame from '../../supabase/functions/ai-generate-image/frameLayout.ts';
import * as piece from '../../supabase/functions/ai-generate-3d/pieceGeometry.ts';

const FN_DIR = resolve(__dirname, '../../supabase/functions');

const LAYOUTS = Object.keys(client.FRAME_LAYOUT_SPEC) as client.FrameLayout[];
const STYLES = Object.keys(client.LETTERING_STYLE_SPEC) as client.LetteringStyle[];
const PLACEMENTS = [
  ...(Object.keys(client.LETTERING_PLACEMENT_SPEC) as client.LetteringPlacement[]),
  'standalone',
] as client.LetteringPlacement[];

/* ── ai-generate-image ↔ assetPrompt.ts ──────────────────────────────── */

describe('ai-generate-image/frameLayout.ts mirrors src/lib/assetPrompt.ts', () => {
  it('FRAME_LAYOUT_SPEC is byte-identical on both sides', () => {
    expect(frame.FRAME_LAYOUT_SPEC).toEqual(client.FRAME_LAYOUT_SPEC);
  });

  it('LAYOUTS (the request validator) is exactly the client archetype set', () => {
    expect([...frame.LAYOUTS].sort()).toEqual([...LAYOUTS].sort());
  });

  it('GREEN_RULES / EMPTY_ELLIPSE / NOT_A_STANDEE reach the client through FRAME_LAYOUT_SPEC', () => {
    // The client does not export the three fragments; FRAME_LAYOUT_SPEC (equal
    // above) is where they land, so pin that the server's fragments are the
    // ones its own table embeds — then equality of the table carries them.
    for (const layout of ['full-scene', 'duo-scene'] as const) {
      expect(frame.FRAME_LAYOUT_SPEC[layout]).toContain(frame.NOT_A_STANDEE);
      expect(frame.FRAME_LAYOUT_SPEC[layout]).toContain(frame.EMPTY_ELLIPSE);
      expect(frame.FRAME_LAYOUT_SPEC[layout].endsWith(frame.GREEN_RULES)).toBe(true);
    }
    for (const layout of ['corner-overlay', 'bottom-third'] as const) {
      expect(frame.FRAME_LAYOUT_SPEC[layout].endsWith(frame.GREEN_RULES)).toBe(true);
    }
  });

  it('FRAME_COMPOSITION is byte-identical on both sides', () => {
    expect(frame.FRAME_COMPOSITION).toEqual(client.FRAME_COMPOSITION);
  });

  it('LETTERING_STYLE_SPEC / LETTERING_PLACEMENT_SPEC / LETTERING_MAX match', () => {
    expect(frame.LETTERING_STYLE_SPEC).toEqual(client.LETTERING_STYLE_SPEC);
    expect(frame.LETTERING_PLACEMENT_SPEC).toEqual(client.LETTERING_PLACEMENT_SPEC);
    expect(frame.LETTERING_MAX).toBe(client.LETTERING_MAX);
    expect([...frame.LETTERING_STYLES].sort()).toEqual([...STYLES].sort());
    expect([...frame.LETTERING_PLACEMENTS].sort()).toEqual([...PLACEMENTS].sort());
  });

  it('normalizeLettering accepts and rejects exactly the same inputs', () => {
    const cases: unknown[] = [
      null, undefined, 'x', 42, [], {},
      { text: 'Maya & Sam', style: 'script-name', placement: 'top' },
      { text: '  padded  ', style: 'modern-block', placement: 'standalone' },
      { text: '', style: 'script-name', placement: 'top' },
      { text: 'a'.repeat(client.LETTERING_MAX), style: 'serif-initials', placement: 'bottom' },
      { text: 'a'.repeat(client.LETTERING_MAX + 1), style: 'serif-initials', placement: 'bottom' },
      { text: 'ok', style: 'comic-sans', placement: 'top' },
      { text: 'ok', style: 'script-name', placement: 'left' },
      { text: 'ok', style: 'script-name' },
    ];
    for (const c of cases) {
      expect(frame.normalizeLettering(c)).toEqual(client.normalizeLettering(c));
    }
  });

  it('letteringDirection is identical for every style × placement', () => {
    for (const style of STYLES) {
      for (const placement of PLACEMENTS) {
        const spec = { text: 'Maya & Sam · 12 June', style, placement };
        expect(frame.letteringDirection(spec)).toBe(client.letteringDirection(spec));
      }
    }
  });

  it('paletteDirection is identical for 0, 1, 2+ and malformed hexes', () => {
    const inputs: string[][] = [
      [],
      ['#D4AF37'],
      ['#D4AF37', '#EACB6E'],
      ['#D4AF37', '#EACB6E', '#FBF3D9', '#A87C1F'],
      ['gold', '#fff', 'not-a-hex', '#0F0F0F'],
      ['#12'],
    ];
    for (const hexes of inputs) {
      expect(frame.paletteDirection(hexes)).toBe(client.paletteDirection(hexes));
    }
    expect(frame.paletteDirection([])).toBe(client.paletteDirection(null));
    expect(frame.paletteDirection([])).toBe(client.paletteDirection(undefined));
  });

  it('EVENT_REGISTER keys are honoured identically by both art-direction builders', () => {
    // The client does not export EVENT_REGISTER; buildFrameArtDirection is
    // where it lands, so compare through it for every server key (+ a case
    // change and an unknown type, which must both behave the same way).
    const types = [...Object.keys(frame.EVENT_REGISTER), 'WEDDING', 'Gala', 'bar-mitzvah', null];
    for (const eventType of types) {
      expect(frame.artDirectionFor('gold leaf', 'border', [], eventType)).toBe(
        client.buildFrameArtDirection('gold leaf', { eventType }),
      );
    }
  });

  it('artDirectionFor(border) equals buildFrameArtDirection for every layout × lettering × palette', () => {
    const palettes: string[][] = [[], ['#D4AF37'], ['#D4AF37', '#EACB6E', '#FBF3D9']];
    const letterings: (client.LetteringSpec | null)[] = [
      null,
      { text: 'M & S', style: 'cursive-monogram', placement: 'integrated' },
      { text: 'Class of 2026', style: 'modern-block', placement: 'beyond-edge' },
    ];
    for (const layout of LAYOUTS) {
      for (const accentHexes of palettes) {
        for (const lettering of letterings) {
          expect(
            frame.artDirectionFor('art-deco sunburst', 'border', accentHexes, 'gala', layout, lettering),
          ).toBe(
            client.buildFrameArtDirection('art-deco sunburst', { accentHexes, eventType: 'gala', layout, lettering }),
          );
        }
      }
    }
  });

  it('an absent server layout falls back to classic-border exactly like the client default', () => {
    expect(frame.artDirectionFor('roses', 'border', [], null)).toBe(
      client.buildFrameArtDirection('roses'),
    );
  });

  /* ai-frames additions */

  it('booth geometry (canvas, safe zones, windows, plaques, blank-window rule) is identical', () => {
    expect(frame.FRAME_CANVAS_W).toBe(client.FRAME_CANVAS_W);
    expect(frame.FRAME_CANVAS_H).toBe(client.FRAME_CANVAS_H);
    expect(frame.BOOTH_SAFE_ZONE).toEqual(client.BOOTH_SAFE_ZONE);
    expect(frame.FRAME_GEOMETRY).toEqual(client.FRAME_GEOMETRY);
    expect(frame.BLANK_WINDOW).toBe(client.BLANK_WINDOW);
    expect(frame.NO_GREEN_HUES).toBe(client.NO_GREEN_HUES);
    expect(frame.NO_TEXT_LINE).toBe(client.NO_TEXT_LINE);
  });

  it('frameGeometryDirection is identical for every layout × plaque', () => {
    for (const layout of LAYOUTS) {
      for (const plaque of [false, true]) {
        expect(frame.frameGeometryDirection(layout, plaque)).toBe(client.frameGeometryDirection(layout, plaque));
      }
    }
  });

  it('occasion → register resolution, colour helpers and the brief fence are identical', () => {
    const occasions = [null, '', 'Baby shower', 'class of 2027', 'Quinceañera', 'xmas party', 'pop-up shop',
      'game day tailgate', 'team offsite', 'our wedding'];
    const types = [null, 'wedding', 'GALA', 'remote', 'party'];
    for (const o of occasions) {
      expect(frame.occasionRegisterKey(o)).toBe(client.occasionRegisterKey(o));
      for (const t of types) expect(frame.resolveRegisterKey(o, t)).toBe(client.resolveRegisterKey(o, t));
    }
    for (const h of ['#00FF00', '#2E8B57', '#D4AF37', '#20B2AA', '#fff', '#808880', 'nope']) {
      expect(frame.isGreenFamily(h)).toBe(client.isGreenFamily(h));
      expect(frame.relativeLuminance(h)).toBe(client.relativeLuminance(h));
      expect(frame.hexRgb(h)).toEqual(client.hexRgb(h));
    }
    for (const b of ['', '  roses  ', 'a >>> b <<< c', 'multi\n\nline']) {
      expect(frame.fenceBrief(b)).toBe(client.fenceBrief(b));
    }
  });

  it('artDirectionFor with occasion + style equals buildFrameArtDirection', () => {
    for (const occasion of [null, 'baby shower', 'graduation']) {
      for (const style of [null, '', presets.FRAME_PRESET_STYLE['luxe-marble']]) {
        expect(frame.artDirectionFor('pearls', 'border', ['#F5E6C8'], 'party', 'full-scene', null, occasion, style))
          .toBe(client.buildFrameArtDirection('pearls', {
            accentHexes: ['#F5E6C8'], eventType: 'party', layout: 'full-scene', occasion, style,
          }));
      }
    }
  });

  it('buildGreenScreenFramePrompt is identical for every layout × plaque × lettering', () => {
    const letterings: (client.LetteringSpec | null)[] = [null, { text: 'A & B', style: 'script-name', placement: 'top' }];
    for (const layout of LAYOUTS) {
      for (const plaque of [false, true]) {
        for (const lettering of letterings) {
          const opts = { layout, plaque, lettering, accentHexes: ['#1B2A4A', '#D4AF37'], eventType: 'gala', occasion: 'graduation' };
          expect(frame.buildGreenScreenFramePrompt('stars', opts)).toBe(client.buildGreenScreenFramePrompt('stars', opts));
        }
      }
    }
    expect(frame.buildGreenScreenFramePrompt('stars')).toBe(client.buildGreenScreenFramePrompt('stars'));
  });

  it('FRAME_PRESET_STYLE is byte-identical to src/lib/framePresets.ts and covers every preset', () => {
    expect(frame.FRAME_PRESET_STYLE).toEqual(presets.FRAME_PRESET_STYLE);
    expect(Object.keys(frame.FRAME_PRESET_STYLE).sort()).toEqual(presets.FRAME_PRESETS.map((p) => p.id).sort());
    expect(frame.presetStyle('neon-night')).toBe(presets.FRAME_PRESET_STYLE['neon-night']);
    expect(frame.presetStyle('constructor')).toBe(null); // prototype keys are not presets
    expect(frame.presetStyle(42)).toBe(null);
  });

  it('FRAME_CORRECTIONS mirrors frameQuality CORRECTIONS, and the correction slot is identical', () => {
    expect(frame.FRAME_CORRECTIONS).toEqual(Object.fromEntries(quality.CORRECTIONS));
    expect(frame.correctionSentence('toString')).toBe(null);
    for (const [code, sentence] of quality.CORRECTIONS) {
      expect(frame.correctionSentence(code)).toBe(sentence);
      const opts = { layout: 'full-scene' as const, correction: sentence };
      expect(frame.buildGreenScreenFramePrompt('roses', opts)).toBe(client.buildGreenScreenFramePrompt('roses', opts));
    }
  });

  it('the edge function really sends buildGreenScreenFramePrompt for a green-screen frame', () => {
    // Reads the deployed source: equality of the builders above is worthless
    // if index.ts assembles its own string.
    const src = readFileSync(resolve(FN_DIR, 'ai-generate-image/index.ts'), 'utf8');
    expect(src).toMatch(/buildGreenScreenFramePrompt\(/);
    expect(src).toMatch(/import\s*\{[^}]*\bbuildGreenScreenFramePrompt\b[^}]*\}\s*from\s*['"]\.\/frameLayout\.ts['"]/);
  });
});

/* ── ai-generate-3d ↔ assetPrompt.ts ──────────────────────────────────── */

describe('ai-generate-3d/pieceGeometry.ts routes briefs like src/lib/assetPrompt.ts', () => {
  /** One probe per server kind, plus the ordering traps the mirror comments
   *  call out (visor before glasses, helmet before mask, piercing before
   *  earring, jewellery before ears). */
  const probes: [string, string][] = [
    ['a chrome cyclops visor', 'visor'],
    ['a neon visor', 'visor'],
    ['wraparound shades', 'visor'],
    ['round sunglasses', 'glasses'],
    ['an iron power glove', 'gauntlet'],
    ['a wizard wand', 'wand'],
    ['a knight helmet', 'helmet'],
    ['space suit mask', 'helmet'],
    ['a venetian mask', 'mask'],
    ['a gold crown', 'crown'],
    ['a black top hat', 'hat'],
    ['nose studs', 'piercing'],
    ['a septum ring', 'piercing'],
    ['pearl earrings', 'earring'],
    ['an ear cuff', 'earring'],
    ['cheek gems', 'faceGem'],
    ['cat ear headband', 'ears'],
    ['reindeer antlers', 'ears'],
  ];

  it('every KIND_GEOMETRY kind is a client PieceKind and resolves identically', () => {
    const serverKinds = piece.KIND_GEOMETRY.map((k) => k.kind);
    expect(new Set(serverKinds).size).toBe(serverKinds.length);
    for (const [brief, expected] of probes) {
      const server = piece.KIND_GEOMETRY.find((k) => k.re.test(brief))?.kind ?? 'generic';
      expect(server, brief).toBe(expected);
      expect(client.inferPieceKind(brief), brief).toBe(expected);
    }
    // Every server kind is exercised by at least one probe above.
    for (const kind of serverKinds) {
      expect(probes.some(([, k]) => k === kind), `no probe for '${kind}'`).toBe(true);
    }
  });

  it('a brief neither side recognises falls to GENERIC_GEOMETRY / generic', () => {
    const brief = 'a floating orb of light';
    expect(piece.KIND_GEOMETRY.some((k) => k.re.test(brief))).toBe(false);
    expect(client.inferPieceKind(brief)).toBe('generic');
    expect(piece.withWearability(brief)).toContain(`Geometry: ${piece.GENERIC_GEOMETRY}.`);
    expect(piece.anchorHintFor(brief)).toBe('crown');
  });

  it('ANCHOR_BY_KIND only names kinds KIND_GEOMETRY can produce', () => {
    const serverKinds = new Set(piece.KIND_GEOMETRY.map((k) => k.kind));
    for (const kind of Object.keys(piece.ANCHOR_BY_KIND)) {
      expect(serverKinds.has(kind), kind).toBe(true);
    }
  });
});

/* ── The scene designer's archetype wording must infer its own layout ─────
 * ai-event-designer tells the model the app "picks the layout from those
 * words". That is only true if each archetype's own example phrase resolves
 * to that archetype through inferFrameLayout — the old CORNER line ("…corners,
 * thinning along the edges") and BANNER line ("lower-third") both resolved to
 * classic-border, so a model following the instructions literally got the
 * wrong frame. */
describe('ai-event-designer frame archetypes infer the layout they name', () => {
  const src = readFileSync(resolve(FN_DIR, 'ai-event-designer/prompt.ts'), 'utf8');
  const cases: [string, client.FrameLayout][] = [
    ['EDGE BORDER', 'classic-border'],
    ['FULL-SCENE FRAME', 'full-scene'],
    ['CORNER-WEIGHTED', 'corner-overlay'],
    ['BOTTOM BANNER', 'bottom-third'],
  ];
  for (const [label, layout] of cases) {
    it(`${label} example → ${layout}`, () => {
      const line = src.split('\n').find((l) => l.includes(`'${label} — `));
      expect(line, label).toBeDefined();
      const example = /\("([^"]+)"\)/.exec(line!)?.[1];
      expect(example, `${label} needs a quoted ("…") example`).toBeDefined();
      expect(client.inferFrameLayout(example!)).toBe(layout);
    });
  }

  it('never asks for a "transparent" frame (the model paints a checkerboard)', () => {
    expect(src).not.toMatch(/transparent centre/i);
  });
});

/* ── The siblings must stay importable from node AND deployable by Deno ─── */

describe('sibling modules are pure and Deno-free', () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  for (const rel of ['ai-generate-image/frameLayout.ts', 'ai-generate-image/jobPolicy.ts', 'ai-generate-3d/pieceGeometry.ts']) {
    it(`${rel} references no Deno global and no jsr:/npm: import`, () => {
      const code = stripComments(readFileSync(resolve(FN_DIR, rel), 'utf8'));
      expect(code).not.toMatch(/\bDeno\b/);
      expect(code).not.toMatch(/from\s+['"](jsr:|npm:)/);
      expect(code).not.toMatch(/\bimport\b/);
    });
  }
});
