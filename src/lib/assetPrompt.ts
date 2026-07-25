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
export type PieceKind = 'mask' | 'helmet' | 'hat' | 'crown' | 'glasses' | 'ears' | 'held' | 'generic';

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
export function buildFrameArtDirection(brief: string, opts: FrameArtOptions = {}): string {
  const register = opts.eventType ? EVENT_REGISTER[opts.eventType.toLowerCase()] : undefined;
  const parts = [
    `Design brief: ${brief.trim()}.`,
    register ? `Register: ${register}.` : '',
    paletteDirection(opts.accentHexes),
    // Composition is what separates a designed frame from a generated one.
    'Composition: treat the four edges as a deliberate composition, not a repeating stamp. Anchor the ' +
      'design with heavier ornament in two opposite corners and let it thin out along the long edges, ' +
      'so the eye travels. Keep the top-centre and bottom-centre calmer than the corners.',
    'Craft: crisp vector-clean edges, deliberate line-weight contrast between thick structural strokes ' +
      'and fine detail lines, believable material (brushed metal, foil, glass, matte ink) with subtle ' +
      'depth from layering rather than drop shadows. Symmetrical left-to-right unless the brief says otherwise.',
    'Quality bar: looks like a professional event stationery designer made it for this specific ' +
      'occasion. Avoid clip-art motifs, generic swirls, muddy gradients, and anything that reads as ' +
      'stock template.',
    'No text, no lettering, no numerals, no logos, no watermark, no signature anywhere in the image.',
  ];
  return parts.filter(Boolean).join(' ');
}
