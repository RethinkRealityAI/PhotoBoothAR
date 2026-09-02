/**
 * frameLayout — the prompt fragments ai-generate-image shares with the client.
 *
 * PURE and Deno-free on purpose: this module is imported by BOTH the edge
 * function (index.ts) and the vitest drift test `src/lib/assetPrompt.drift.test.ts`,
 * which `toEqual`s every export below against its twin in src/lib/assetPrompt.ts.
 * That test replaces the old "change one, change the other" comments — a
 * mismatch is now a red test, not a hope. tsc also type-checks this file
 * through that import (the repo tsconfig excludes supabase/ otherwise).
 *
 * Rules for this file: no `Deno.*`, no `jsr:`/`npm:` imports, no request-scoped
 * values — constants and pure functions only. Deployed alongside index.ts
 * (deploy_edge_function files: index.ts, frameLayout.ts, deno.json).
 */

/* ── Frame archetypes ─────────────────────────────────────────────────────
 * MIRRORED from src/lib/assetPrompt.ts (FrameLayout / FRAME_LAYOUT_SPEC /
 * GREEN_RULES / EMPTY_ELLIPSE). Edge functions cannot import from src/, so the
 * two carry the same text byte for byte — src/lib/assetPrompt.drift.test.ts
 * goes red if they diverge.
 *
 * 'classic-border' is the string this function has always sent for a
 * green-screen frame, moved verbatim into the table: an absent or legacy
 * `layout` therefore produces a byte-identical prompt to before. */

export type FrameLayout = 'classic-border' | 'full-scene' | 'duo-scene' | 'corner-overlay' | 'bottom-third';

export const GREEN_RULES =
  'The green must be a flat, uniform chroma-key green with NO gradients, NO shadows, NO texture, ' +
  'NO vignette or glow, and must read as a single exact colour so it can be keyed out. Use NO green ' +
  'anywhere in the artwork itself, and give it no green tint, green reflection or green rim-light — ' +
  'anything green in the art will be punched out as a hole.';

/** Cutout layouts only: asked for a hole where a head goes, an image model's
 *  first instinct is to draw a face in it — which then keys out as a hole in
 *  the guest's own face. */
export const EMPTY_ELLIPSE =
  'The ellipse contains NOTHING but flat green — no person, no face, no silhouette inside it.';

/**
 * Scene layouts only. VERIFIED FAILURE without this sentence: asked for "a scene
 * with a head cutout", the model paints a photograph OF a carnival standee — the
 * board as an object, on a stand, on a floor, in a room, in perspective, with a
 * drop shadow around it. That is a picture of a frame instead of the frame, and
 * the perspective alone makes it unusable as a 9:16 overlay. Naming the artefact
 * we do NOT want is what fixes it; "flat" and "straight-on" alone did not.
 */
export const NOT_A_STANDEE =
  'This image IS the overlay itself viewed perfectly straight-on — NOT a photograph or picture ' +
  'of a cutout board, standee, or panel: no stand, no floor, no room, no wall behind it, no ' +
  'perspective, no drop shadow around the artwork\'s outer edge.';

export const FRAME_LAYOUT_SPEC: Record<FrameLayout, string> = {
  'classic-border':
    'Create a full-bleed decorative FRAME composition for a 9:16 vertical portrait canvas ' +
    '(1080x1920). ALL decorative art must hug the four edges as a border. Fill the ENTIRE ' +
    'central area AND the whole background with ONE solid pure green colour #00FF00 — a flat, ' +
    'uniform chroma-key green with NO gradients, NO shadows, NO texture, NO vignette or glow on ' +
    'the green. Do not place any art, drop-shadow, or highlight over the green region; the green ' +
    'must read as a single exact colour so it can be keyed out. Use NO green anywhere in the ' +
    'border artwork itself, and give it no green tint, green reflection or green rim-light — ' +
    'anything green in the art will be punched out as a hole.',
  'full-scene':
    'Create a full-bleed illustrated SCENE for a 9:16 vertical portrait canvas (1080x1920) — the ' +
    'artwork runs edge to edge as a complete environment, NOT a border around an empty middle. ' +
    `${NOT_A_STANDEE} ` +
    'Leave exactly ONE head cutout: a solid #00FF00 ellipse centred at 50% of the width and 38% of ' +
    'the height, spanning 34% of the width and 21% of the height. The scene may frame that ellipse ' +
    '(a porthole, a visor, a wreath of flowers) but must never paint over it. ' +
    `${EMPTY_ELLIPSE} ${GREEN_RULES}`,
  'duo-scene':
    'Create a full-bleed illustrated SCENE for a 9:16 vertical portrait canvas (1080x1920) — the ' +
    'artwork runs edge to edge as a complete environment, NOT a border around an empty middle. ' +
    `${NOT_A_STANDEE} ` +
    'Leave exactly TWO head cutouts: solid #00FF00 ellipses centred at 30% and at 70% of the width, ' +
    'both at 38% of the height, each spanning 26% of the width and 18% of the height. The scene may ' +
    'frame those ellipses (portholes, visors, wreaths) but must never paint over them. ' +
    `${EMPTY_ELLIPSE} ${GREEN_RULES}`,
  'corner-overlay':
    'Create a corner-anchored decorative overlay for a 9:16 vertical portrait canvas (1080x1920). ' +
    'ALL of the artwork sits in two opposite corners — top-left and bottom-right — each cluster ' +
    'contained within 40% of the width and 25% of the height. EVERY other pixel, including the ' +
    'whole centre and both remaining corners, is solid #00FF00. ' +
    `${GREEN_RULES}`,
  'bottom-third':
    'Create a lower-third stage graphic for a 9:16 vertical portrait canvas (1080x1920). ALL of the ' +
    'artwork sits BELOW 66% of the height, as a lower-third band the subject stands above. The top ' +
    'two-thirds of the canvas is entirely solid #00FF00. ' +
    `${GREEN_RULES}`,
};

export const LAYOUTS = new Set(Object.keys(FRAME_LAYOUT_SPEC));

/* ── Art direction ───────────────────────────────────────────────────────
 * MIRRORED from src/lib/assetPrompt.ts (buildFrameArtDirection). Edge
 * functions cannot import from src/, so the two carry the same rules —
 * src/lib/assetPrompt.drift.test.ts goes red if artDirectionFor and
 * buildFrameArtDirection diverge.
 *
 * Before this, the whole prompt was chroma-key mechanics plus
 * `Design brief: <whatever the host typed>`. A two-word brief therefore
 * produced two-word art: no composition, no motif vocabulary, no material or
 * line-weight language, no quality bar. This is the missing half. */

export const EVENT_REGISTER: Record<string, string> = {
  wedding: 'romantic and refined — botanical filigree, ribbon, fine script flourishes, pearl and gold leaf',
  gala: 'black-tie and opulent — art-deco geometry, sunburst fans, metallic inlay, deep jewel tones',
  birthday: 'celebratory and playful — confetti, streamers, balloon clusters, bold saturated colour',
  conference: 'crisp and modern — geometric rules, thin brackets, restrained accent colour, generous whitespace',
  party: 'high-energy and neon — light streaks, glow, gradient washes, night-club palette',
  corporate: 'clean and premium — minimal rules, subtle metallic hairlines, plenty of negative space',
};

/** Palette sentence for 0, 1 or many known accent colours. Mirrors
 *  `paletteDirection` in src/lib/assetPrompt.ts. Only the first two hexes are
 *  used: handing a model four produces a muddy rainbow, the opposite of the
 *  disciplined palette the rest of this direction asks for. */
export function paletteDirection(accentHexes: string[]): string {
  const hexes = accentHexes.filter((h) => typeof h === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(h));
  if (hexes.length === 0) {
    return 'Use a disciplined palette: one dominant colour, one supporting metallic or neutral, at most one accent.';
  }
  if (hexes.length === 1) {
    return `Build the palette around ${hexes[0]} — use it plus one supporting metallic or neutral, and ` +
      'at most one accent hue. Do not use every colour.';
  }
  return `Build the palette around ${hexes[0]} as the dominant colour with ${hexes[1]} supporting, ` +
    'plus at most one neutral. Do not use every colour.';
}

// Composition direction PER FRAME LAYOUT (mirror: src/lib/assetPrompt.ts
// FRAME_COMPOSITION — src/lib/assetPrompt.drift.test.ts goes red if they
// diverge). Edge-border language is
// exactly wrong for a full-scene frame, whose art fills the canvas and
// organises itself AROUND the head cutouts.
export const FRAME_COMPOSITION: Record<string, string> = {
  'classic-border':
    'Composition: treat the four edges as a deliberate composition, not a repeating stamp. Anchor the ' +
    'design with heavier ornament in two opposite corners and let it thin out along the long edges, ' +
    'so the eye travels. Keep the top-centre and bottom-centre calmer than the corners.',
  'corner-overlay':
    'Composition: treat the four edges as a deliberate composition, not a repeating stamp. Anchor the ' +
    'design with heavier ornament in two opposite corners and let it thin out along the long edges, ' +
    'so the eye travels. Keep the top-centre and bottom-centre calmer than the corners.',
  'full-scene':
    'Composition: a complete illustrated environment with real depth — distinct foreground, midground ' +
    'and background layers — designed AROUND the head cutout so the scene makes sense once a real face ' +
    'fills the opening. Use leading lines and framing devices (arches, foliage, beams of light, portholes) ' +
    'that draw the eye toward the cutout.',
  'duo-scene':
    'Composition: a complete illustrated environment with real depth — distinct foreground, midground ' +
    'and background layers — designed AROUND the two head cutouts so the scene makes sense once real ' +
    'faces fill the openings. Give the pair a shared context (one bench, one archway, one marquee) and ' +
    'use leading lines that connect the two openings.',
  'bottom-third':
    'Composition: build the artwork as a lower-third stage with a clear horizon line; visual weight and ' +
    'detail live in the bottom band and thin upward to nothing well before the vertical midpoint.',
};

/* ── Frame lettering ──────────────────────────────────────────────────────
 * MIRRORED from src/lib/assetPrompt.ts (LetteringStyle / LetteringPlacement /
 * LETTERING_STYLE_SPEC / LETTERING_PLACEMENT_SPEC / normalizeLettering /
 * letteringDirection). Edge functions cannot import from src/, so the two carry
 * the same text byte for byte — src/lib/assetPrompt.drift.test.ts goes red
 * if they diverge.
 *
 * Opt-in: with `lettering` absent the ban line below is the exact string this
 * function has always ended its art direction with. */

export type LetteringStyle = 'cursive-monogram' | 'serif-initials' | 'script-name' | 'modern-block';
export type LetteringPlacement = 'top' | 'bottom' | 'integrated' | 'beyond-edge' | 'standalone';

export interface LetteringSpec {
  text: string;
  style: LetteringStyle;
  placement: LetteringPlacement;
}

export const LETTERING_STYLES = new Set([
  'cursive-monogram', 'serif-initials', 'script-name', 'modern-block',
]);
export const LETTERING_PLACEMENTS = new Set([
  'top', 'bottom', 'integrated', 'beyond-edge', 'standalone',
]);

/** Max characters of lettering. Past ~40 an image model stops spelling and
 *  starts inventing glyphs, which is worse than no lettering at all. */
export const LETTERING_MAX = 40;

/** Validate untrusted lettering into a spec, or null (= no lettering). */
export function normalizeLettering(v: unknown): LetteringSpec | null {
  if (v === null || v === undefined || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text || text.length > LETTERING_MAX) return null;
  const style = typeof o.style === 'string' ? o.style : '';
  if (!LETTERING_STYLES.has(style)) return null;
  const placement = typeof o.placement === 'string' ? o.placement : '';
  if (!LETTERING_PLACEMENTS.has(placement)) return null;
  return { text, style: style as LetteringStyle, placement: placement as LetteringPlacement };
}

export const LETTERING_STYLE_SPEC: Record<LetteringStyle, string> = {
  'cursive-monogram': 'an interlocked cursive monogram with elegant flourishes',
  'serif-initials': 'large engraved serif capital initials',
  'script-name': 'a flowing calligraphic script wordmark',
  'modern-block': 'bold modern geometric block capitals with tight tracking',
};

/** 'standalone' has no entry: it means "no frame at all", so the sticker
 *  composition line already places the subject — see letteringPlacementSpec. */
export const LETTERING_PLACEMENT_SPEC: Record<Exclude<LetteringPlacement, 'standalone'>, string> = {
  top: 'centred in the top band of the frame',
  bottom: 'centred in the lower band of the frame',
  integrated: 'woven into the frame ornament itself, sharing its materials and lighting',
  'beyond-edge': 'overflowing past the frame edge into the canvas, oversized and confident',
};

export function letteringPlacementSpec(placement: LetteringPlacement): string {
  return placement === 'standalone'
    ? 'as the single standalone subject of the artwork, with no frame or border around it'
    : LETTERING_PLACEMENT_SPEC[placement];
}

/** The block that REPLACES the standing "no text" ban when lettering is asked
 *  for. Spelling is the whole game with image models, hence "letter-for-letter
 *  with no substitutions" and the residual ban on EVERYTHING else. */
export function letteringDirection(spec: LetteringSpec): string {
  return `Render EXACTLY the text "${spec.text}", exactly once, spelled precisely letter-for-letter ` +
    `with no substitutions, as ${LETTERING_STYLE_SPEC[spec.style]}, ${letteringPlacementSpec(spec.placement)}. ` +
    'Integrate the lettering with the frame\'s palette and materials. Apart from that single piece of ' +
    'lettering: no other text, no numerals, no logos, no watermark, no signature anywhere in the image.';
}

export function artDirectionFor(
  brief: string,
  kind: string,
  accentHexes: string[],
  eventType: string | null,
  layout: string = 'classic-border',
  /** Opt-in lettering. Absent/null → the ban line is sent verbatim. */
  lettering: LetteringSpec | null = null,
): string {
  const register = eventType ? EVENT_REGISTER[eventType.toLowerCase()] : undefined;
  const palette = paletteDirection(accentHexes);
  // Frame composition language is WRONG for a sticker (and for the 3D concept
  // image, which also arrives as a sticker kind) — a sticker has one subject,
  // not four edges.
  const composition = kind === 'border'
    ? (FRAME_COMPOSITION[layout] ?? FRAME_COMPOSITION['classic-border'])
    : 'Composition: one clear silhouette that reads instantly at thumbnail size. Strong outer shape, ' +
      'detail concentrated toward the centre, nothing important near the outer few pixels.';
  return [
    `Design brief: ${brief.trim()}.`,
    register ? `Register: ${register}.` : '',
    palette,
    composition,
    'Craft: crisp vector-clean edges, deliberate line-weight contrast between thick structural strokes ' +
      'and fine detail lines, believable material (brushed metal, foil, glass, matte ink) with subtle ' +
      'depth from layering rather than drop shadows. Symmetrical left-to-right unless the brief says otherwise.',
    'Quality bar: looks like a professional event stationery designer made it for this specific ' +
      'occasion. Avoid clip-art motifs, generic swirls, muddy gradients, and anything that reads as ' +
      'stock template.',
    // Lettering REPLACES the ban (it is the one exception to it) — for the
    // sticker/standalone path too, which keeps its one-subject composition
    // line above. Absent → the exact string this function has always sent.
    lettering
      ? letteringDirection(lettering)
      : 'No text, no lettering, no numerals, no logos, no watermark, no signature anywhere in the image.',
  ].filter(Boolean).join(' ');
}
