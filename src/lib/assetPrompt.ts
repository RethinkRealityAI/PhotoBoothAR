/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prompt craft for AI-generated assets.
 *
 * The generators were being handed almost nothing. A frame prompt was
 * chroma-key mechanics plus `Design brief: ${whatever the host typed}` — no
 * composition, no motif vocabulary, no material or line-weight language, no
 * quality bar — so a two-word brief produced two-word art. The 3D pipeline was
 * worse: the concept image asked for "a single centered object … product shot"
 * with nothing about the thing being WORN, so a mask concept came back
 * modelled on a face, and image→3D then fused face and mask into one solid
 * lump. That is the "not concave or hollow, no holes in the right place"
 * failure — it starts in the prompt, not the mesh.
 *
 * Everything here is pure so the craft is testable and reviewable in one place
 * rather than smeared across three call sites.
 *
 * MIRRORED SERVER-SIDE: Supabase edge functions cannot import from src/, so
 * `supabase/functions/ai-generate-image/index.ts` (buildPrompt) and
 * `ai-generate-3d/index.ts` (wearability wrapper) carry the same rules. Change
 * one, change the other — the same standing rule the stripe-webhook
 * entitlements snapshot follows.
 */

/* ── Wearable geometry ────────────────────────────────────────────────── */

/**
 * What kind of head-worn object this is. Drives the geometry language, which
 * is the single biggest lever on whether the mesh comes back usable: a mask
 * needs an open face cavity, a hat needs an open crown, glasses need a bridge
 * and temples and mostly empty lenses.
 */
export type PieceKind =
  | 'mask' | 'helmet' | 'hat' | 'crown' | 'glasses' | 'ears'
  | 'earring' | 'piercing' | 'faceGem'
  | 'held' | 'generic';

const KIND_PATTERNS: { kind: PieceKind; re: RegExp }[] = [
  { kind: 'glasses', re: /\b(glasses|sunglasses|shades|spectacles|goggles|monocle|visor)\b/i },
  // Helmet BEFORE mask: a helmet was being given the mask spec, which asks for
  // "cut-through eye openings and an open lower edge" — right for a face mask,
  // wrong for a helmet, which opens at the NECK and usually has a face gap
  // rather than two eye holes.
  { kind: 'helmet', re: /\b(helmet|hardhat|hard ?hat|astronaut|space ?suit|diving ?bell)\b/i },
  { kind: 'mask', re: /\b(mask|masquerade|balaclava|face ?cover|respirator)\b/i },
  { kind: 'crown', re: /\b(crown|tiara|diadem|coronet|halo|laurel)\b/i },
  { kind: 'hat', re: /\b(hat|cap|beanie|fedora|top ?hat|sombrero|beret|headdress|turban|bonnet|hood)\b/i },
  // The three jewellery kinds go BEFORE `ears`, which matches a bare "ear" and
  // was therefore swallowing "ear cuff" (a headband arc is the wrong geometry
  // for something that clips onto one ear). `piercing` goes before `earring`
  // because "nose studs" matches `studs?` in the earring pattern too.
  { kind: 'piercing', re: /\b(nose ?rings?|septum|nose ?studs?|lip ?rings?|piercings?)\b/i },
  { kind: 'earring', re: /\b(earrings?|ear ?cuffs?|studs?|hoops?)\b/i },
  { kind: 'faceGem', re: /\b(face ?(gems?|stickers?|jewels?)|rhinestones?|bindis?|cheek ?gems?)\b/i },
  { kind: 'ears', re: /\b(ears?|antlers?|horns?|antennae|headband)\b/i },
  { kind: 'held', re: /\b(trophy|cup|statue|figurine|bouquet|sign|placard|balloon|wand|sword|mug|bottle)\b/i },
];

/** Classify a brief. Order matters: "cat ear headband" is ears, not a hat. */
export function inferPieceKind(brief: string): PieceKind {
  for (const { kind, re } of KIND_PATTERNS) {
    if (re.test(brief)) return kind;
  }
  return 'generic';
}

interface KindSpec {
  /** How the object must be built, in modelling terms. */
  geometry: string;
  /** Roughly how big it is in the real world — anchors proportion. */
  scale: string;
  /** How the concept image should be shot so image→3D reads the opening. */
  view: string;
}

/**
 * Per-kind modelling rules. The recurring failure is a closed, solid blob, so
 * every entry states the cavity explicitly and in the same shape: what is
 * hollow, where it opens, and how thick the wall is.
 */
const KIND_SPEC: Record<PieceKind, KindSpec> = {
  mask: {
    geometry:
      'a HOLLOW curved shell that fits over a human face — concave on the inside, open at the back, ' +
      'with cut-through eye openings and an open lower edge. Wall thickness roughly 3-5mm, uniform. ' +
      'It is an empty shell: there must be NO face, NO head, NO mannequin, NO bust and NO solid ' +
      'interior filling the cavity',
    scale: 'about 18cm tall and 14cm wide — real human face proportions',
    view: 'a three-quarter view, tilted so the hollow inside of the shell and the cut-through eye holes are clearly visible',
  },
  helmet: {
    geometry:
      'a HOLLOW helmet shell that a whole head fits inside — concave on the inside with a large open ' +
      'neck opening at the bottom, and an open face gap at the front (not two small eye holes). Wall ' +
      'thickness roughly 5-8mm, uniform. It is an empty shell: there must be NO head, NO face, NO ' +
      'mannequin, NO bust and NO solid interior filling the cavity',
    scale: 'about 26cm tall and 22cm wide — sized to fit over a real adult head',
    view: 'a three-quarter view tilted so both the open face gap and the hollow inside of the shell are visible',
  },
  hat: {
    geometry:
      'a HOLLOW hat with an open underside — the crown is a shell with an empty cavity where a head ' +
      'would go, and the brim is a thin surface. Wall thickness roughly 4-6mm. There must be NO head, ' +
      'NO mannequin, NO stand and NO solid plug filling the crown',
    scale: 'crown opening about 17cm across — sized to a real adult head',
    view: 'a three-quarter view from slightly below the brim, so the empty inside of the crown is visible',
  },
  crown: {
    geometry:
      'an OPEN circular band — a ring, hollow through the middle, with the decorative points rising ' +
      'from the band. The centre is empty air, not a solid disc or dome. Band thickness roughly 4-6mm. ' +
      'There must be NO head, NO face, NO mannequin, NO bust and NO stand wearing or supporting it',
    scale: 'about 17cm across the inner ring — sized to a real adult head',
    view: 'a three-quarter view from slightly above, so the open ring reads clearly as a ring',
  },
  glasses: {
    geometry:
      'an eyewear frame: two rims joined by a bridge, with temple arms folding back. The lens area is ' +
      'empty or a thin transparent sheet — NOT solid blocks. Frame stock roughly 4-6mm thick. There ' +
      'must be NO face, NO head and NO mannequin',
    scale: 'about 14cm wide across the front — real eyewear proportions',
    view: 'a three-quarter front view showing both the front rims and one temple arm',
  },
  ears: {
    geometry:
      'a thin headband arc with the shapes rising from it. The band is an open arc, not a closed ring ' +
      'and not a solid cap, and the space under the arc is empty. Band roughly 4-6mm thick. There must ' +
      'be NO head, NO hair, NO mannequin and NO bust wearing it',
    scale: 'band about 15cm across — sized to sit on a real adult head',
    view: 'a three-quarter front view showing the arc of the band and both shapes',
  },
  // The jewellery kinds fail differently from the head-worn ones: they are
  // small, so the model's instinct is to render them ON the body part they clip
  // to (an ear, a nostril, a cheek), and to close every opening into a solid
  // ring. Both are stated explicitly, in millimetres.
  earring: {
    geometry:
      'a single earring — a thin OPEN hook or hoop at the top (roughly 1mm wire, an open curve, ' +
      'never fused into a closed solid) with the decorative body hanging below it. There must be ' +
      'NO ear, NO head, NO mannequin and NO stand',
    scale: 'about 3-6cm from the top of the hook to the bottom of the drop',
    view: 'a straight-on macro view with the open hook or hoop clearly visible',
  },
  piercing: {
    geometry:
      'a small OPEN C-shaped hoop with a visible gap where it clips onto the nostril — wire roughly ' +
      '1-2mm thick with the middle hollow. It is NOT a closed torus and NOT a solid disc. There must ' +
      'be NO nose, NO face, NO head and NO mannequin',
    scale: 'about 8-14mm across the outer diameter',
    view: 'a macro view angled so the open gap in the hoop is unmistakable',
  },
  faceGem: {
    geometry:
      'a small faceted gem, or a tight cluster of them, with a completely FLAT back so it sits flush ' +
      'on skin and a domed faceted front, roughly 2-4mm thick overall. There must be NO face, NO ' +
      'skin, NO head and NO mannequin',
    scale: 'about 1-3cm across the whole gem or cluster',
    view: 'a three-quarter macro view showing both the faceted top and the flat underside edge',
  },
  held: {
    geometry:
      'a single free-standing object, modelled complete and closed, with no ground plane, no base ' +
      'slab, no pedestal, no backdrop and no hands holding it',
    scale: 'a size a person could comfortably hold in one hand',
    view: 'a three-quarter product view, evenly lit, the whole object in shot',
  },
  generic: {
    geometry:
      'a single object built to be WORN on or near the head. If any part of it encloses the head or ' +
      'face it must be a HOLLOW shell with an opening where the head goes, roughly 4-6mm thick — ' +
      'never a solid mass. There must be NO head, NO face, NO mannequin, NO bust and NO stand',
    scale: 'proportioned for a real adult head, roughly 15-20cm at its largest',
    view: 'a three-quarter view that makes any opening or cavity clearly visible',
  },
};

/** Shared rules that apply to every 3D piece regardless of kind. */
const COMMON_3D =
  'ONE single connected object, centred, facing forward and left-right symmetric unless the design is ' +
  'deliberately asymmetric. No scene, no background objects, no text, no logos, no watermark, no ' +
  'packaging, no ground shadow baked into the object.';

/**
 * The concept image for the 3D pipeline.
 *
 * This is the highest-leverage prompt in the product: Meshy's image→3D copies
 * what it sees, so if the concept shows a mask on a face, the mesh contains a
 * face. Hence the explicit "no head/mannequin" and the view that reveals the
 * cavity.
 */
export function buildConceptPrompt(brief: string, kind: PieceKind = inferPieceKind(brief)): string {
  const spec = KIND_SPEC[kind];
  return [
    `Product concept art of ONE object for a 3D scan: ${brief.trim()}.`,
    `Build it as ${spec.geometry}.`,
    `Scale: ${spec.scale}.`,
    `Camera: ${spec.view}.`,
    COMMON_3D,
    'Isolated on a plain mid-grey studio background, soft even three-point lighting, no harsh ' +
      'shadows, sharp focus across the whole object, high detail in the materials and surface finish.',
  ].join(' ');
}

/**
 * The text prompt Meshy receives in TEXT mode.
 *
 * NOT called from the client on purpose: `ai-generate-3d` applies these rules
 * server-side (so every caller is covered, including ones we don't own) while
 * storing the host's raw brief for the experience name. This stays here as the
 * canonical, tested spec the edge function mirrors — the same arrangement as
 * the entitlements snapshot stripe-webhook keeps. Change the rules, change both.
 */
export function buildMeshyPrompt(brief: string, kind: PieceKind = inferPieceKind(brief)): string {
  const spec = KIND_SPEC[kind];
  return [
    `${brief.trim()}.`,
    `Geometry: ${spec.geometry}.`,
    `Real-world scale: ${spec.scale}.`,
    COMMON_3D,
    'Watertight where it is solid, genuinely open where it should be open. Clean quad-friendly ' +
      'topology, no interpenetrating parts, no floating disconnected pieces.',
  ].join(' ');
}

/* ── Frames ───────────────────────────────────────────────────────────── */

/**
 * What SHAPE of frame this is. Until now every generated frame was the same
 * artefact — ornament hugging four edges around an empty centre — so "creative"
 * only ever meant a different motif. These archetypes change the composition
 * itself: a full illustrated scene with a head cutout, a two-up version of it,
 * corner clusters, or a lower-third band.
 */
export type FrameLayout = 'classic-border' | 'full-scene' | 'duo-scene' | 'corner-overlay' | 'bottom-third';

/* ── Frame lettering ──────────────────────────────────────────────────────
 * A host who names their event ("Maya & Sam · 12 June") almost always wants
 * that ON the frame. Until now the art direction ended with an unconditional
 * ban on text, so the only way to get a name onto a frame was to draw it
 * afterwards. Lettering is OPT-IN: absent → the ban line below is sent exactly
 * as it always has been, byte for byte.
 *
 * MIRRORED SERVER-SIDE in `supabase/functions/ai-generate-image/index.ts`
 * (LETTERING_STYLE_SPEC / LETTERING_PLACEMENT_SPEC / normalizeLettering /
 * the exact-text sentence) — edge functions cannot import from src/, so the
 * two carry the same text byte for byte. Change one, change the other. */

/** How the lettering is DRAWN. */
export type LetteringStyle = 'cursive-monogram' | 'serif-initials' | 'script-name' | 'modern-block';

/** WHERE it sits. 'standalone' is the no-frame case: the lettering itself IS
 *  the artwork (the caller sends it down the sticker path, not the border one). */
export type LetteringPlacement = 'top' | 'bottom' | 'integrated' | 'beyond-edge' | 'standalone';

export interface LetteringSpec {
  /** The literal characters to render, 1–40 chars after trimming. */
  text: string;
  style: LetteringStyle;
  placement: LetteringPlacement;
}

const LETTERING_STYLES: ReadonlySet<string> = new Set<LetteringStyle>([
  'cursive-monogram', 'serif-initials', 'script-name', 'modern-block',
]);
const LETTERING_PLACEMENTS: ReadonlySet<string> = new Set<LetteringPlacement>([
  'top', 'bottom', 'integrated', 'beyond-edge', 'standalone',
]);

/** Max characters of lettering. Past ~40 an image model stops spelling and
 *  starts inventing glyphs, which is worse than no lettering at all. */
export const LETTERING_MAX = 40;

/**
 * Validate untrusted lettering (model output, an edited confirm card, a stored
 * config) into a LetteringSpec — or null, which means "no lettering" and
 * restores the byte-identical ban line. Never throws.
 */
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

/** The look of the letterforms, per style id (mirror: ai-generate-image). */
export const LETTERING_STYLE_SPEC: Record<LetteringStyle, string> = {
  'cursive-monogram': 'an interlocked cursive monogram with elegant flourishes',
  'serif-initials': 'large engraved serif capital initials',
  'script-name': 'a flowing calligraphic script wordmark',
  'modern-block': 'bold modern geometric block capitals with tight tracking',
};

/**
 * Where the lettering sits, per placement id (mirror: ai-generate-image).
 *
 * 'standalone' has NO entry on purpose: it means "no frame at all", so the
 * caller sends kind '2d_filter' and the sticker composition line ("one clear
 * silhouette…") already says where the subject goes. Looking it up falls back
 * to the standalone sentence below.
 */
export const LETTERING_PLACEMENT_SPEC: Record<Exclude<LetteringPlacement, 'standalone'>, string> = {
  top: 'centred in the top band of the frame',
  bottom: 'centred in the lower band of the frame',
  integrated: 'woven into the frame ornament itself, sharing its materials and lighting',
  'beyond-edge': 'overflowing past the frame edge into the canvas, oversized and confident',
};

/** Placement sentence for any placement, including 'standalone'. */
function letteringPlacementSpec(placement: LetteringPlacement): string {
  return placement === 'standalone'
    ? 'as the single standalone subject of the artwork, with no frame or border around it'
    : LETTERING_PLACEMENT_SPEC[placement];
}

/**
 * The block that REPLACES the standing "no text" ban when lettering is asked
 * for. Spelling is the whole game with image models, hence "letter-for-letter
 * with no substitutions" and the residual ban on EVERYTHING else — one piece of
 * lettering is a design; two is a mistake.
 *
 * Mirror: ai-generate-image `letteringDirection`.
 */
export function letteringDirection(spec: LetteringSpec): string {
  return `Render EXACTLY the text "${spec.text}", exactly once, spelled precisely letter-for-letter ` +
    `with no substitutions, as ${LETTERING_STYLE_SPEC[spec.style]}, ${letteringPlacementSpec(spec.placement)}. ` +
    'Integrate the lettering with the frame\'s palette and materials. Apart from that single piece of ' +
    'lettering: no other text, no numerals, no logos, no watermark, no signature anywhere in the image.';
}

/**
 * The anti-spill block, reused VERBATIM from the classic-border prompt that has
 * been keying cleanly in production. Every new archetype ends with it rather
 * than a paraphrase — the exact wording is the part that was proven, and a
 * frame whose green carries a gradient or a rim-light cannot be keyed out at
 * all (the guest gets a green pane over their face).
 */
const GREEN_RULES =
  'The green must be a flat, uniform chroma-key green with NO gradients, NO shadows, NO texture, ' +
  'NO vignette or glow, and must read as a single exact colour so it can be keyed out. Use NO green ' +
  'anywhere in the artwork itself, and give it no green tint, green reflection or green rim-light — ' +
  'anything green in the art will be punched out as a hole.';

/** Cutout layouts only: asked for a hole where a head goes, an image model's
 *  first instinct is to draw a face in it — which then keys out as a hole in
 *  the guest's own face. */
const EMPTY_ELLIPSE =
  'The ellipse contains NOTHING but flat green — no person, no face, no silhouette inside it.';

/**
 * Scene layouts only. VERIFIED FAILURE without this sentence: asked for "a scene
 * with a head cutout", the model paints a photograph OF a carnival standee — the
 * board as an object, on a stand, on a floor, in a room, in perspective, with a
 * drop shadow around it. That is a picture of a frame instead of the frame, and
 * the perspective alone makes it unusable as a 9:16 overlay. Naming the artefact
 * we do NOT want is what fixes it; "flat" and "straight-on" alone did not.
 */
const NOT_A_STANDEE =
  'This image IS the overlay itself viewed perfectly straight-on — NOT a photograph or picture ' +
  'of a cutout board, standee, or panel: no stand, no floor, no room, no wall behind it, no ' +
  'perspective, no drop shadow around the artwork\'s outer edge.';

/**
 * The base mechanics prompt per archetype (green-screen border path).
 *
 * MIRRORED SERVER-SIDE in `supabase/functions/ai-generate-image/index.ts`
 * (FRAME_LAYOUT_SPEC) — edge functions cannot import from src/. The
 * 'classic-border' entry is byte-identical to the string that function has
 * always sent, so an absent/legacy layout produces the same prompt as before.
 */
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

/** A scene is an environment, not a border — these words mean the host wants
 *  the whole canvas illustrated. */
const SCENE_WORDS = /\b(scene|backdrop|background|world|environment|inside)\b/i;
/** …and these mean they want a hole in it for a head. */
const CUTOUT_WORDS = /\b(cut ?outs?|head ?holes?|face ?holes?|head ?cut ?outs?|holes? for (my|our|the|their) (head|face))\b/i;
const DUO_WORDS = /\b(two|couple|duo|pair|both of us)\b/i;
const CORNER_WORDS = /\bcorners?\b/i;
const BANNER_WORDS = /\b(lower ?thirds?|banners?|title ?bars?|marquees?)\b/i;

/**
 * Pick the archetype a brief is describing. Pure and deliberately conservative:
 * anything it cannot place stays 'classic-border', which is what every frame
 * generated before this was.
 *
 * Order matters — a two-header ("a jungle scene with holes for both of us") is
 * a duo-scene, and checking full-scene first would swallow it.
 */
export function inferFrameLayout(brief: string): FrameLayout {
  const scene = SCENE_WORDS.test(brief);
  if (scene && DUO_WORDS.test(brief)) return 'duo-scene';
  if (scene && CUTOUT_WORDS.test(brief)) return 'full-scene';
  if (CORNER_WORDS.test(brief)) return 'corner-overlay';
  if (BANNER_WORDS.test(brief)) return 'bottom-third';
  return 'classic-border';
}

export interface FrameArtOptions {
  /**
   * The event's own palette, when known — grounds the art in the real theme
   * instead of a generic one. This is `events.config.accentHexes` (see
   * `buildRuntimeConfig` in src/events/runtime.ts), an ORDERED array where [0]
   * is the dominant accent: `['#D4AF37', '#EACB6E', '#FBF3D9', '#A87C1F']`.
   * Only the first two are used — handing a model four hexes produces a muddy
   * rainbow, which is the opposite of the disciplined palette we ask for.
   */
  accentHexes?: string[] | null;
  /** e.g. "wedding", "gala" — sets the register. */
  eventType?: string | null;
  /** Frame layout driving the composition direction (default classic-border). */
  layout?: FrameLayout;
  /**
   * Opt-in lettering (a name, initials, a monogram) to render ON the frame.
   * Absent/null → the standing "no text, no lettering…" ban is sent verbatim,
   * so every existing caller's prompt is byte-identical to before.
   */
  lettering?: LetteringSpec | null;
}

/** Palette sentence for 0, 1 or many known accent colours. Exported so the
 *  edge-function mirror can be diffed against it directly. */
export function paletteDirection(accentHexes?: string[] | null): string {
  const hexes = (accentHexes ?? []).filter((h) => typeof h === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(h));
  if (hexes.length === 0) {
    return 'Use a disciplined palette: one dominant colour, one supporting metallic or neutral, at most one accent.';
  }
  if (hexes.length === 1) {
    return `Build the palette around ${hexes[0]} — use it plus one supporting metallic or neutral, ` +
      'and at most one accent hue. Do not use every colour.';
  }
  return `Build the palette around ${hexes[0]} as the dominant colour with ${hexes[1]} supporting, ` +
    'plus at most one neutral. Do not use every colour.';
}

/** Register hints per event type. Deliberately concrete: "elegant" is not art direction. */
const EVENT_REGISTER: Record<string, string> = {
  wedding: 'romantic and refined — botanical filigree, ribbon, fine script flourishes, pearl and gold leaf',
  gala: 'black-tie and opulent — art-deco geometry, sunburst fans, metallic inlay, deep jewel tones',
  birthday: 'celebratory and playful — confetti, streamers, balloon clusters, bold saturated colour',
  conference: 'crisp and modern — geometric rules, thin brackets, restrained accent colour, generous whitespace',
  party: 'high-energy and neon — light streaks, glow, gradient washes, night-club palette',
  corporate: 'clean and premium — minimal rules, subtle metallic hairlines, plenty of negative space',
};

/**
 * Art direction for a 9:16 booth frame.
 *
 * The mechanics (chroma-key green, clear centre) are the caller's job — they
 * differ between the transparent and green-screen paths. This adds the part
 * that was missing entirely: what makes a frame look designed rather than
 * generated.
 */
/**
 * Composition direction PER FRAME LAYOUT (mirror: ai-generate-image
 * FRAME_COMPOSITION). The edge-border language ("heavier ornament in two
 * opposite corners… keep the top-centre calmer") is exactly wrong for a
 * full-scene frame, whose art must fill the canvas and organise itself AROUND
 * the head cutouts — one table, keyed by layout, on both mirror sides.
 */
export const FRAME_COMPOSITION: Record<FrameLayout, string> = {
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

export function buildFrameArtDirection(brief: string, opts: FrameArtOptions = {}): string {
  const register = opts.eventType ? EVENT_REGISTER[opts.eventType.toLowerCase()] : undefined;
  const parts = [
    `Design brief: ${brief.trim()}.`,
    register ? `Register: ${register}.` : '',
    paletteDirection(opts.accentHexes),
    // Composition is what separates a designed frame from a generated one —
    // and it must match the layout (edge language fights a full-scene brief).
    FRAME_COMPOSITION[opts.layout ?? 'classic-border'],
    'Craft: crisp vector-clean edges, deliberate line-weight contrast between thick structural strokes ' +
      'and fine detail lines, believable material (brushed metal, foil, glass, matte ink) with subtle ' +
      'depth from layering rather than drop shadows. Symmetrical left-to-right unless the brief says otherwise.',
    'Quality bar: looks like a professional event stationery designer made it for this specific ' +
      'occasion. Avoid clip-art motifs, generic swirls, muddy gradients, and anything that reads as ' +
      'stock template.',
    // Lettering REPLACES the ban (it is the one exception to it). Absent →
    // this line is the exact string this function has always ended with.
    opts.lettering
      ? letteringDirection(opts.lettering)
      : 'No text, no lettering, no numerals, no logos, no watermark, no signature anywhere in the image.',
  ];
  return parts.filter(Boolean).join(' ');
}
