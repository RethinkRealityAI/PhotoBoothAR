/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The public Guides content model — every word on /guides lives here.
 *
 * PURE on purpose, exactly like src/lib/landingContent.ts: no React, no
 * supabase, no asset imports, nothing whose module graph reaches a browser
 * API. That is what lets guidesContent.test.ts and guidesDrift.test.ts run in
 * vitest's node environment and hold the whole surface to a contract.
 *
 * The impure half — the /guides/frames/* URLs and the film sources — lives in
 * src/lib/guidesMedia.ts, mirroring the landingContent/landingAssets split.
 *
 * THE POINT OF GUIDE_COVERAGE (bottom of this file): every host-visible
 * surface — studio tab, host nav row, Power-Up, in-studio help topic and
 * feature flag — must name the guide that explains it. guidesDrift.test.ts
 * asserts that map BOTH ways, so shipping a new tab without writing the copy
 * turns a test red instead of quietly leaving a hole in the guides.
 */

/* ------------------------------------------------------------------ */
/* Guides                                                              */
/* ------------------------------------------------------------------ */

export type GuideSlug =
  | 'make-a-frame'
  | 'make-3d-props'
  | 'use-the-studio'
  | 'first-event'
  | 'run-the-night';

/** The films that accompany a guide. Two exist this phase; their media lands
 *  with the renders (see guidesMedia.GUIDE_VIDEO). */
export type GuideVideoKey = 'first-event' | 'design-a-frame';

/** Annotated product screenshots. One key: the studio editor, captured from
 *  the /dev/studio harness at a fixed viewport. An event-chrome shot was
 *  considered and dropped — EventStudio's chrome renders around live event
 *  fetches, so no harness can capture it deterministically; that chrome is
 *  described in a steps block instead. */
export type HotspotShotKey = 'studio-editor';

export interface Hotspot {
  id: string;
  /** Fractional position on the shot, 0-1 from the top-left. */
  x: number;
  y: number;
  /** Which side the desktop popover opens on, so it never leaves the image. */
  side: 'left' | 'right';
  /** The 1-3 word marker caption. */
  label: string;
  title: string;
  body: string;
}

export interface HotspotShot {
  key: HotspotShotKey;
  /** Natural pixel size of the screenshot. 0 = not shot yet; the renderer
   *  skips the whole block rather than drawing an empty box. */
  width: number;
  height: number;
  alt: string;
  hotspots: Hotspot[];
}

export const HOTSPOT_SHOTS: Record<HotspotShotKey, HotspotShot> = {
  'studio-editor': {
    key: 'studio-editor',
    width: 2880,
    height: 1800,
    alt: 'The Beamwall studio with the stage in the middle, the asset library on the left and the properties panel on the right',
    hotspots: [
      {
        id: 'rename',
        x: 0.112, y: 0.032, side: 'right',
        label: 'Name it',
        title: 'Your experience’s name',
        body: 'Tap the pencil to rename it right here. Guests see this name when your booth offers more than one look.',
      },
      {
        id: 'director',
        x: 0.867, y: 0.032, side: 'left',
        label: 'AI Director',
        title: 'Describe it — the AI builds it',
        body: 'Tell the Director the vibe and it designs a matching frame, filter and head-piece as one scene. You preview each piece and only keep what you love.',
      },
      {
        id: 'save',
        x: 0.956, y: 0.032, side: 'left',
        label: 'Save',
        title: 'Save your scene',
        body: 'Saves your work to this experience. Your drafts are also kept locally as you edit, so a refresh never loses the scene.',
      },
      {
        id: 'search',
        x: 0.104, y: 0.172, side: 'right',
        label: 'Find fast',
        title: 'Search and filter chips',
        body: 'Everything lives in one library. The chips — Frames, Stickers, Filters, 3D — narrow it, and the active chip also decides what kind of thing your next upload becomes.',
      },
      {
        id: 'upload',
        x: 0.105, y: 0.250, side: 'right',
        label: 'Bring your own',
        title: 'Upload art or a 3D model',
        body: 'PNG, JPG, WEBP and SVG for flat art — transparent PNGs at 1080 × 1920 work best for frames — and GLB or GLTF for 3D. One file drops straight onto your scene.',
      },
      {
        id: 'quick-ai',
        x: 0.105, y: 0.382, side: 'right',
        label: 'Quick AI',
        title: 'A frame in one tap',
        body: 'Type what you want and get a single frame back. Your first three AI images per event are free, and a failed generation never costs a retry.',
      },
      {
        id: 'power-ups',
        x: 0.105, y: 0.518, side: 'right',
        label: 'Power-Ups',
        title: 'Gesture-fired magic',
        body: 'Power FX arms a visor, wand or gauntlet that fires when a guest clenches a fist or opens a palm. 3D Name Jewelry builds a necklace or floating text from a name.',
      },
      {
        id: 'library',
        x: 0.105, y: 0.780, side: 'right',
        label: 'The library',
        title: 'Built-in frames and props',
        body: 'Ready-made frames, stickers, filters and 3D head pieces. Tap any tile to add it to the scene — its settings open in the panel on the right.',
      },
      {
        id: 'modes',
        x: 0.499, y: 0.118, side: 'right',
        label: 'Three views',
        title: '2D, 3D and Preview',
        body: 'One scene, three views. 2D places flat frames and filters, 3D anchors face-tracked props, and Preview shows the finished result exactly as a guest will see it.',
      },
      {
        id: 'starters',
        x: 0.499, y: 0.312, side: 'right',
        label: 'Start with a look',
        title: 'Starter scenes',
        body: 'Each card is a real shot from that scene. Tap one to start from it, then make it yours — nothing is locked.',
      },
      {
        id: 'test-on-phone',
        x: 0.598, y: 0.944, side: 'left',
        label: 'Test on phone',
        title: 'Your own face, no publishing',
        body: 'Scan the QR with your handset and try the scene on a real camera. Nothing is shown to guests until you publish.',
      },
      {
        id: 'properties',
        x: 0.894, y: 0.336, side: 'left',
        label: 'Fine-tune',
        title: 'The properties panel',
        body: 'Whatever you select opens here — position, size, colour, finish, an engraved name, magic triggers. The Scene tab beside it lists every layer in your scene.',
      },
    ],
  },
};

export type GuideBlock =
  | { kind: 'prose'; title?: string; body: string[] }
  | { kind: 'steps'; title: string; steps: { title: string; body: string; tip?: string }[] }
  | { kind: 'film'; videoKey: GuideVideoKey; title: string; caption: string }
  | { kind: 'prompts'; title: string; blurb: string; cardIds: string[] }
  | { kind: 'downloads'; title: string; blurb: string; entryIds: FramePackId[] }
  | { kind: 'tools'; title: string; blurb: string; toolNames: string[] }
  | { kind: 'hotspots'; shot: HotspotShotKey; title: string; blurb: string }
  | { kind: 'spec'; title: string; rows: { label: string; value: string; why: string }[] }
  | { kind: 'callout'; tone: 'tip' | 'watch'; title: string; body: string }
  | { kind: 'cta'; label: string; to: string; blurb: string };

export interface GuideDoc {
  slug: GuideSlug;
  eyebrow: string;
  title: string;
  hook: string;
  /** Honest reading time, minutes. */
  minutes: number;
  /** Accent hex, taken from the beam spectrum the whole product is lit by
   *  (SPECTRUM in src/components/landing/CameraExperience.tsx). Five distinct
   *  picks so a guide is recognisable by colour alone. */
  hue: string;
  blocks: GuideBlock[];
}

/* ------------------------------------------------------------------ */
/* The downloadable frame pack                                         */
/* ------------------------------------------------------------------ */

export type FramePackId =
  | 'wedding-magazine-cover'
  | 'wedding-monogram-drop'
  | 'wedding-arch-mask'
  | 'gala-magazine-cover'
  | 'gala-artdeco-mask'
  | 'birthday-monogram-corner'
  | 'birthday-character-hands'
  | 'launch-product-side'
  | 'corporate-badge-mask'
  | 'cultural-asoebi-arch'
  | 'cultural-mehndi-arch'
  | 'christmas-elf-hands'
  | 'christmas-santa-cover'
  | 'nye-countdown';

export type FrameCategory = 'wedding' | 'gala' | 'birthday' | 'corporate' | 'cultural' | 'holiday';

export const FRAME_CATEGORY_LABELS: Record<FrameCategory, string> = {
  wedding: 'Weddings',
  gala: 'Galas',
  birthday: 'Birthdays',
  corporate: 'Brand & corporate',
  cultural: 'Cultural',
  holiday: 'Holidays',
};

export interface FramePackEntry {
  id: FramePackId;
  category: FrameCategory;
  title: string;
  blurb: string;
  /**
   * Where the guest's face lands, as fractions of the 1080 × 1920 artwork.
   * MEASURED from the keyed PNG, not guessed — the download gallery draws it
   * as a dashed window so a host can see, before downloading, how much room
   * the design leaves a person.
   */
  faceBox: { x: number; y: number; w: number; h: number };
}

export const FRAME_PACK: readonly FramePackEntry[] = [
  {
    id: 'wedding-magazine-cover',
    category: 'wedding',
    title: 'The Cover Story',
    blurb: 'A full-bleed editorial cover — your guests ARE the issue.',
    faceBox: { x: 0.18, y: 0.19, w: 0.64, h: 0.7 },
  },
  {
    id: 'wedding-monogram-drop',
    category: 'wedding',
    title: 'Two Letters, One Night',
    blurb: 'Your initials hang over every shot like a piece of jewellery.',
    faceBox: { x: 0.17, y: 0.22, w: 0.66, h: 0.66 },
  },
  {
    id: 'wedding-arch-mask',
    category: 'wedding',
    title: 'Through The Arch',
    blurb: 'Florals curl around a clean window your faces step into.',
    faceBox: { x: 0.27, y: 0.21, w: 0.46, h: 0.3 },
  },
  {
    id: 'gala-magazine-cover',
    category: 'gala',
    title: "Tonight's Headline",
    blurb: 'Black-tie masthead, cover lines down the side, and whoever steps up is the story.',
    faceBox: { x: 0.18, y: 0.19, w: 0.64, h: 0.7 },
  },
  {
    id: 'gala-artdeco-mask',
    category: 'gala',
    title: 'The Deco Frame',
    blurb: 'Gold fans and mirrored lines close around a portrait window.',
    faceBox: { x: 0.23, y: 0.19, w: 0.54, h: 0.36 },
  },
  {
    id: 'birthday-monogram-corner',
    category: 'birthday',
    title: 'Big Number Energy',
    blurb: 'The age takes the corner, the balloons take everything else.',
    faceBox: { x: 0.15, y: 0.16, w: 0.66, h: 0.68 },
  },
  {
    id: 'birthday-character-hands',
    category: 'birthday',
    title: 'Served By A Flamingo',
    blurb: 'Main character energy, on a tray.',
    faceBox: { x: 0.26, y: 0.06, w: 0.48, h: 0.33 },
  },
  {
    id: 'launch-product-side',
    category: 'corporate',
    title: 'Stand Beside The Star',
    blurb: 'Your product holds one side of the shot and the guest holds the other.',
    faceBox: { x: 0.24, y: 0.18, w: 0.6, h: 0.68 },
  },
  {
    id: 'corporate-badge-mask',
    category: 'corporate',
    title: 'Badge And Beam',
    blurb: 'A conference-lanyard look with a clean window for the face.',
    faceBox: { x: 0.22, y: 0.12, w: 0.57, h: 0.32 },
  },
  {
    id: 'cultural-asoebi-arch',
    category: 'cultural',
    title: 'Aso Ebi Arch',
    blurb: 'Gele, lace and gold pillars framing the family portrait.',
    faceBox: { x: 0.15, y: 0.14, w: 0.7, h: 0.72 },
  },
  {
    id: 'cultural-mehndi-arch',
    category: 'cultural',
    title: 'Henna Arch',
    blurb: 'Hand-drawn mehndi vines climbing around every guest.',
    faceBox: { x: 0.19, y: 0.19, w: 0.62, h: 0.66 },
  },
  {
    id: 'christmas-elf-hands',
    category: 'holiday',
    title: 'Held By An Elf',
    blurb: "The little guy holds your face up like the year's best bauble.",
    faceBox: { x: 0.21, y: 0.14, w: 0.58, h: 0.35 },
  },
  {
    id: 'christmas-santa-cover',
    category: 'holiday',
    title: "Santa's Cover Shoot",
    blurb: 'Red velvet, gold foil, and your name on the front page.',
    faceBox: { x: 0.18, y: 0.2, w: 0.6, h: 0.68 },
  },
  {
    id: 'nye-countdown',
    category: 'holiday',
    title: 'Ten Seconds Left',
    blurb: 'Confetti mid-air, the clock at midnight, you in the middle of it.',
    faceBox: { x: 0.2, y: 0.15, w: 0.6, h: 0.62 },
  },
];

export const FRAME_PACK_BY_ID: Record<string, FramePackEntry> = Object.fromEntries(
  FRAME_PACK.map((f) => [f.id, f]),
);

/* ------------------------------------------------------------------ */
/* Copy-paste prompts                                                  */
/* ------------------------------------------------------------------ */

/**
 * The tail every frame prompt ends with, word for word.
 *
 * It is shown to hosts as its own explainer AND asserted as the suffix of
 * every prompt below, because it is the part that actually makes a frame
 * usable: an image generator has no idea it is painting a photo booth frame
 * unless you tell it to leave a flat, hard-edged green shape where a person
 * goes. That shape is what gets keyed out into the transparent window.
 */
export const GREEN_TAIL =
  'Vertical 9:16 poster, 1080 × 1920. Where people will appear, paint one flat pure green (#00FF00) shape with hard edges — no gradients, no shadows, and no green anywhere else. Keep every bit of artwork and text outside the green shape. No watermarks.';

/**
 * Prompts are filed under the same event categories as the frame pack, so the
 * two galleries filter alike and a host who liked a pack frame can find the
 * prompt that makes more of them.
 */
export type PromptCategory = FrameCategory;

export interface PromptCard {
  id: string;
  category: PromptCategory;
  label: string;
  /** Ready to paste, ending in GREEN_TAIL. */
  prompt: string;
  /** Which engine renders this best. 'any' = all of them handle it. */
  bestWith: 'higgsfield' | 'gemini' | 'chatgpt' | 'any';
  /**
   * The frame in the pack that a prompt like this one produced — shown beside
   * the words so a host can SEE the result before spending a render on it.
   *
   * These are the real, shipped frames: the pack was generated from this same
   * set of briefs. It is captioned as "a prompt like this" rather than "this
   * exact prompt" on purpose — a couple of the finished designs moved an
   * element (the birthday balloons, the product's side of the frame) between
   * brief and render, and claiming an exact reproduction would be a promise
   * the next generator run cannot keep.
   */
  exampleId?: FramePackId;
}

export const PROMPT_CARDS: readonly PromptCard[] = [
  {
    id: 'wedding-cover-story',
    category: 'wedding',
    label: 'Wedding · magazine cover',
    bestWith: 'higgsfield',
    exampleId: 'wedding-magazine-cover',
    prompt: `A luxury bridal magazine cover. Ivory and champagne palette, soft film grain, one elegant serif masthead across the top reading "VOWS", small cover lines stacked down the left and right edges, a thin gold rule under the masthead. Peonies and eucalyptus spill in from the top corners. ${GREEN_TAIL}`,
  },
  {
    id: 'wedding-arch-window',
    category: 'wedding',
    label: 'Wedding · floral arch window',
    bestWith: 'gemini',
    exampleId: 'wedding-arch-mask',
    prompt: `A wedding ceremony arch built from garden roses, ranunculus and trailing eucalyptus, photographed straight on against a warm cream backdrop. The arch opening is an oval in the upper middle of the poster. The green shape is COMPLETELY BLANK — no face, no head, no person inside it. ${GREEN_TAIL}`,
  },
  {
    id: 'wedding-monogram-rails',
    category: 'wedding',
    label: 'Wedding · monogram + side rails',
    bestWith: 'any',
    exampleId: 'wedding-monogram-drop',
    prompt: `An elegant wedding poster: a large interlocking gold-foil monogram "A & J" hanging at the top centre, the date "12 · 09" in small caps beneath it, and two thin vertical rails of tiny script text running down the far left and far right edges. Deep midnight-blue background with a subtle linen texture. ${GREEN_TAIL}`,
  },
  {
    id: 'gala-headline-cover',
    category: 'gala',
    label: 'Gala · black-tie cover',
    bestWith: 'higgsfield',
    exampleId: 'gala-magazine-cover',
    prompt: `A black-tie charity gala magazine cover. Matte black background, brushed gold masthead across the top reading "THE GALA", three short cover lines in the lower left, a hairline gold border 40px inside the edges, and a scatter of tiny bokeh lights along the top. Editorial, expensive, restrained. ${GREEN_TAIL}`,
  },
  {
    id: 'gala-deco-window',
    category: 'gala',
    label: 'Gala · art deco window',
    bestWith: 'gemini',
    exampleId: 'gala-artdeco-mask',
    prompt: `An Art Deco poster in black, gold and deep emerald: symmetrical sunburst fans, stepped geometric columns down both sides, and a chevron crest at the top. The centre opening is a tall rounded arch. The green shape is COMPLETELY BLANK — no face, no head, no person inside it. ${GREEN_TAIL}`,
  },
  {
    id: 'birthday-balloon-masthead',
    category: 'birthday',
    label: 'Birthday · balloon masthead',
    bestWith: 'gemini',
    exampleId: 'birthday-monogram-corner',
    prompt: `A joyful birthday poster: a fat cluster of pink, coral and gold foil balloons filling the top quarter of the canvas like a masthead, a hand-lettered "HAPPY BIRTHDAY" arcing under them, and confetti drifting down the outer edges. Bright, glossy, party-lit. ${GREEN_TAIL}`,
  },
  {
    id: 'birthday-character-hands',
    category: 'birthday',
    label: 'Birthday · character hands',
    bestWith: 'higgsfield',
    exampleId: 'birthday-character-hands',
    prompt: `A playful illustrated flamingo in a party hat, seen from the chest up at the bottom of the poster, holding up a large empty oval tray with both wings so the tray opening sits in the upper middle. Pastel pink and mint palette, thick clean outlines, flat cartoon shading. The tray opening is the green shape and it is COMPLETELY BLANK — no face, no head, no person inside it. ${GREEN_TAIL}`,
  },
  {
    id: 'launch-product-side',
    category: 'corporate',
    label: 'Launch · product on the side',
    bestWith: 'higgsfield',
    exampleId: 'launch-product-side',
    prompt: `A premium product-launch poster. A sleek matte-black cosmetics bottle stands on a stone plinth hugging the RIGHT edge of the canvas, lit by a single studio softbox, with its reflection on a wet floor. The brand name sits small in the top-left corner. The left two thirds of the canvas stay clear for the guest. ${GREEN_TAIL}`,
  },
  {
    id: 'corporate-badge-window',
    category: 'corporate',
    label: 'Conference · badge window',
    bestWith: 'chatgpt',
    exampleId: 'corporate-badge-mask',
    prompt: `A modern tech-conference poster: an oversized illustrated event lanyard and badge holder occupying the lower third, a bold sans-serif event name across the top on a deep indigo gradient, and thin circuit-line decoration along both edges. The badge window is a rounded rectangle in the upper middle. The green shape is COMPLETELY BLANK — no face, no head, no person inside it. ${GREEN_TAIL}`,
  },
  {
    id: 'cultural-asoebi-arch',
    category: 'cultural',
    label: 'Aso ebi · gold arch',
    bestWith: 'higgsfield',
    exampleId: 'cultural-asoebi-arch',
    prompt: `A Nigerian owambe celebration poster: two carved gold pillars draped in rich burgundy and emerald aso ebi lace rising up both sides into a decorated arch, gele-fabric folds curling in at the top corners, and small gold beadwork along the base. Warm, opulent, ceremonial. ${GREEN_TAIL}`,
  },
  {
    id: 'cultural-mehndi-vines',
    category: 'cultural',
    label: 'Mehndi · henna vines',
    bestWith: 'gemini',
    exampleId: 'cultural-mehndi-arch',
    prompt: `A mehndi celebration poster on a warm saffron background: intricate henna vine work drawn in deep russet climbing both side edges and meeting in a paisley crown at the top, tiny marigold garlands strung across the upper corners, and a fine dotted border 50px inside the canvas edge. ${GREEN_TAIL}`,
  },
  {
    id: 'christmas-elf-hands',
    category: 'holiday',
    label: 'Christmas · elf hands',
    bestWith: 'higgsfield',
    exampleId: 'christmas-elf-hands',
    prompt: `A cheerful illustrated elf in a green and red suit, seen from the shoulders up at the bottom of the poster, reaching both mittened hands upward to hold a large empty round ornament so the ornament sits in the upper middle. Snowy pine branches and warm fairy lights fill the corners. Storybook illustration, thick outlines. The ornament opening is the green shape and it is COMPLETELY BLANK — no face, no head, no person inside it. ${GREEN_TAIL}`,
  },
  {
    id: 'christmas-santa-cover',
    category: 'holiday',
    label: 'Christmas · cover shoot',
    bestWith: 'gemini',
    exampleId: 'christmas-santa-cover',
    prompt: `A festive magazine cover: deep red velvet background with gold foil snowflakes, an ornate gold masthead across the top reading "NOEL", small cover lines down the right edge, and a garland of holly and warm bulbs draped across the very top. Rich, glossy, vintage-Christmas. ${GREEN_TAIL}`,
  },
  {
    id: 'nye-countdown-banner',
    category: 'holiday',
    label: 'New Year · countdown banner',
    bestWith: 'any',
    exampleId: 'nye-countdown',
    prompt: `A New Year's Eve poster: a burst of gold and silver confetti frozen mid-air across the top third, a champagne-gold "MIDNIGHT" banner arcing beneath it, streamers falling down both outer edges, and a soft bokeh city skyline glowing along the very bottom. Black background, high contrast. ${GREEN_TAIL}`,
  },
];

export const PROMPT_CARD_BY_ID: Record<string, PromptCard> = Object.fromEntries(
  PROMPT_CARDS.map((p) => [p.id, p]),
);

/* ------------------------------------------------------------------ */
/* Outside tools                                                       */
/* ------------------------------------------------------------------ */

export interface ToolCard {
  name: string;
  href: string;
  cost: string;
  blurb: string;
  goodFor: string[];
}

/**
 * Hosts that an outbound guide link may point at.
 *
 * A short allowlist rather than a comment, because these cards are the one
 * place on the platform that sends a customer somewhere else — a typo'd or
 * swapped host would be an unreviewed redirect off a marketing page. The test
 * checks every href against this.
 */
export const TOOL_HOST_ALLOWLIST: readonly string[] = [
  'higgsfield.ai',
  'www.meshy.ai',
  'gemini.google.com',
  'chatgpt.com',
];

export const TOOL_CARDS: readonly ToolCard[] = [
  {
    name: 'Higgsfield',
    href: 'https://higgsfield.ai',
    cost: 'Paid',
    blurb: 'The best-looking frames of the four, and the studio can pull a finished image straight in.',
    goodFor: ['Photoreal frames', 'Character hands', 'Product scenes'],
  },
  {
    name: 'Meshy',
    href: 'https://www.meshy.ai',
    cost: 'Paid',
    blurb: 'Turns a sentence or a photo into a 3D model you can download and drop on a guest.',
    goodFor: ['Custom 3D props', 'Turning a logo into an object', 'Hats, crowns, trophies'],
  },
  {
    name: 'Google Gemini',
    href: 'https://gemini.google.com',
    cost: 'Free tier',
    blurb: 'Free to start and genuinely good at frames — the fastest way to try an idea.',
    goodFor: ['Frames on a budget', 'Quick iterations', 'Graphic and illustrated looks'],
  },
  {
    name: 'ChatGPT',
    href: 'https://chatgpt.com',
    cost: 'Free tier',
    blurb: 'Makes images too, and will happily rewrite a prompt with you before you render it.',
    goodFor: ['Refining a brief', 'Illustrated frames', 'Trying a look before you pay'],
  },
];

export const TOOL_CARD_BY_NAME: Record<string, ToolCard> = Object.fromEntries(
  TOOL_CARDS.map((t) => [t.name, t]),
);

/* ------------------------------------------------------------------ */
/* Numbers the guides state out loud                                   */
/* ------------------------------------------------------------------ */

/**
 * Every count the guide copy quotes, kept in one object so guidesDrift.test.ts
 * can compare each one to the module that owns it. A guide that says "up to 6
 * per scene" after somebody raises MAX_TRIGGERS is worse than one that says
 * nothing, so the number is asserted, not trusted.
 */
export const GUIDE_COUNTS = {
  /** TRIGGER_SOURCES — 4 face + 5 hand. */
  triggerSources: 9,
  /** The TriggerAction union: burst · reveal · filterPulse · beam · animate. */
  triggerActions: 5,
  /** FRAME_LAYOUT_SPEC: Border · Full scene · Two faces · Corners · Banner. */
  frameArchetypes: 5,
  maxObjects: 20,
  maxTriggers: 6,
  studioTabs: 8,
  powerUps: 2,
} as const;

/* ------------------------------------------------------------------ */
/* THE CONTENT                                                         */
/* ------------------------------------------------------------------ */

const MAKE_A_FRAME: GuideDoc = {
  slug: 'make-a-frame',
  eyebrow: 'Design',
  title: 'Make a frame guests fight over',
  hook: 'Design it like a magazine cover: the face in the middle, the story around the edge.',
  minutes: 8,
  hue: '#FB923C',
  blocks: [
    {
      kind: 'prose',
      body: [
        'A frame is the artwork wrapped around every photo your guests take. It is the single thing that turns "a picture at a party" into "a picture from YOUR party" — and the one thing people screenshot and post.',
        'The trick is to stop thinking of it as a border. Think of a magazine cover. The person goes in the middle, big. Everything that says whose night it is — the names, the date, the flowers, the logo — lives around the edge where it frames the face instead of covering it.',
        'You have four ways to get one, and none of them needs design software.',
      ],
    },
    {
      kind: 'film',
      videoKey: 'design-a-frame',
      title: 'Watch a frame get built',
      caption: 'From a one-line description to a finished frame on a live booth.',
    },
    {
      kind: 'steps',
      title: 'Four ways to get your frame',
      steps: [
        {
          title: 'Take one from the pack below',
          body: 'Fourteen ready-made designs, free, sized correctly, with the face window already cut out. Download the one closest to your event, upload it, done. This is the two-minute route.',
          tip: 'Even if you plan to make your own, grab one first so your booth is never empty while you experiment.',
        },
        {
          title: 'Describe it to AI Frame Studio',
          body: `Open your event, go to the Assets tab, and describe the look you want. Pick one of the ${GUIDE_COUNTS.frameArchetypes} layouts — Border, Full scene, Two faces, Corners or Banner — add your names in one of the lettering styles, and it renders a finished, cut-out frame for you. Your first 3 AI images on every event are free, so the first few tries cost nothing.`,
          tip: 'Lettering can sit at the bottom, along the top, woven into the art, running past the edge, or stand alone as name art.',
        },
        {
          title: 'Write the prompt yourself, anywhere',
          body: 'Use any image generator you already pay for — the prompts further down are written to work in all of them, and each one shows you the frame it makes. Save the result, then upload it. The only rule is the green-window rule those prompts all end with.',
          tip: 'Beamwall’s own AI Frame Studio runs on these same engines, so a prompt that works there works here.',
        },
        {
          title: 'Bring a designer’s file, or import from Higgsfield',
          body: 'Already have artwork? Upload it in the Assets tab — PNG, JPG, WEBP and SVG all work, and the chip you have selected in that dock decides whether it becomes a frame or a sticker. Made it on Higgsfield? Paste the image link into the import page instead and it comes across without a download step (up to 10 MB, PNG, JPEG or WebP).',
        },
      ],
    },
    {
      kind: 'downloads',
      title: 'Start with a ready-made one',
      blurb: 'Fourteen finished frames, already the right size and already cut out. Download the one closest to your night, upload it, go live. The chequered part is see-through — that is where your guest lands — and the dashed window shows how much room the design leaves them.',
      entryIds: [
        'wedding-magazine-cover',
        'wedding-monogram-drop',
        'wedding-arch-mask',
        'gala-magazine-cover',
        'gala-artdeco-mask',
        'birthday-monogram-corner',
        'birthday-character-hands',
        'launch-product-side',
        'corporate-badge-mask',
        'cultural-asoebi-arch',
        'cultural-mehndi-arch',
        'christmas-elf-hands',
        'christmas-santa-cover',
        'nye-countdown',
      ],
    },
    {
      kind: 'spec',
      title: 'What every frame has to be',
      rows: [
        {
          label: 'Size',
          value: '1080 × 1920 pixels',
          why: 'Portrait 9:16 — the shape of a phone held upright, and of every tile on your live wall.',
        },
        {
          label: 'File type',
          value: 'Transparent PNG',
          why: 'The see-through middle is where your guest appears. A flat photo would cover their face.',
        },
        {
          label: 'The middle',
          value: 'Leave it clear',
          why: 'Anything you put in the centre lands on somebody’s nose. Push the design to the edges and corners.',
        },
        {
          label: 'One colour to avoid',
          value: 'Pure green (#00FF00)',
          why: 'Pure green is what we cut away to make the window. Green artwork disappears along with it.',
        },
        {
          label: 'Uploads we accept',
          value: 'PNG · JPG · WEBP · SVG',
          why: 'Any of these can become a frame or a sticker; 3D props come in as GLB or GLTF.',
        },
        {
          label: 'Frame or sticker?',
          value: 'The active chip in the Assets dock decides',
          why: 'Same upload button, two outcomes — check the chip before you drop the file in.',
        },
      ],
    },
    {
      kind: 'prompts',
      title: 'Or write your own — here are fourteen that work',
      blurb: 'One for every kind of night, each shown beside a frame it made. Copy it, swap the names and colours for yours, and paste it into any image generator.',
      cardIds: [
        'wedding-cover-story',
        'wedding-arch-window',
        'wedding-monogram-rails',
        'gala-headline-cover',
        'gala-deco-window',
        'birthday-balloon-masthead',
        'birthday-character-hands',
        'launch-product-side',
        'corporate-badge-window',
        'cultural-asoebi-arch',
        'cultural-mehndi-vines',
        'christmas-elf-hands',
        'christmas-santa-cover',
        'nye-countdown-banner',
      ],
    },
    {
      kind: 'callout',
      tone: 'watch',
      title: 'A face in your window? One sentence fixes it',
      body: 'Window designs tempt every image generator into being helpful: ask for an arch with a hole in it and it paints a lovely stranger standing in the hole. The window then cuts out around them, and your guests appear behind somebody else’s face. Every window design we tried came back that way until we added one blunt line — so if it happens to you, paste this on the end of your prompt: "The green shape is COMPLETELY BLANK — no face, no head, no person inside it."',
    },
    {
      kind: 'tools',
      title: 'Where to render them',
      blurb: 'Any of these will do the job. Beamwall’s own AI Frame Studio runs on the same engines, with your first 3 frames per event free — a Gemini render costs 1 credit, a Higgsfield render 2, and bringing your own key makes them free.',
      toolNames: ['Higgsfield', 'Google Gemini', 'ChatGPT'],
    },
    {
      kind: 'cta',
      label: 'Start an event and try it',
      to: '/host/new',
      blurb: 'Describe your event in one sentence and get a booth, a frame and a wall in a couple of minutes.',
    },
  ],
};

const MAKE_3D_PROPS: GuideDoc = {
  slug: 'make-3d-props',
  eyebrow: 'Props',
  title: 'Put a crown on every guest',
  hook: 'Pick a prop, paint it your colours, engrave a name — and it lands on every face in the room.',
  minutes: 9,
  hue: '#7C6CF7',
  blocks: [
    {
      kind: 'prose',
      body: [
        'A 3D prop is an object that sticks to your guest as they move: a crown on the head, a visor over the eyes, a gauntlet on the hand. It tracks their face in real time, so it stays put when they laugh, lean in or pull a friend into the shot.',
        'This is the part guests film themselves doing. A frame gets a photo; a prop gets a video of someone discovering they have antlers.',
        'There are four ways to get one, and the first two cost you nothing at all.',
      ],
    },
    {
      kind: 'steps',
      title: 'Four ways to get a prop',
      steps: [
        {
          title: 'Use a built-in head piece',
          body: 'Six pieces ship with every event — open the 3D view in your studio, tap one, and it is on. Nothing to make, nothing to spend.',
        },
        {
          title: 'Customise a library prop',
          body: 'The curated library goes further: pick a model, then recolour each part of it separately and choose a finish — matte, metal, gloss. You can also engrave a name into it, and if you set that name to the guest token, every single guest sees their OWN name on the prop. All of this is free.',
          tip: 'This is why customising beats generating: one prop, personalised per guest, at zero credits.',
        },
        {
          title: 'Generate one with AI',
          body: 'Describe the object and let the AI build it. A generated prop costs about 10 credits, comes back under 50,000 polygons, and can take up to ten minutes — start it before you need it, not during the party.',
          tip: 'Ten minutes is a real ten minutes. Kick it off, go do the wall settings, come back.',
        },
        {
          title: 'Upload your own model',
          body: 'Have a 3D file already? Drop a GLB or GLTF into the Assets tab and it auto-fits to roughly 24 cm — about head-sized — so you are not fighting with scale. Position it on the anchor you want and you are done.',
        },
      ],
    },
    {
      kind: 'spec',
      title: 'What a 3D file needs',
      rows: [
        {
          label: 'Format',
          value: 'GLB or GLTF',
          why: 'The two formats browsers can open directly, so nothing has to be converted on the night.',
        },
        {
          label: 'Size on a guest',
          value: 'Auto-fits to about 24 cm',
          why: 'Roughly head-sized, so an imported model never arrives microscopic or the size of the room.',
        },
        {
          label: 'Complexity',
          value: 'Under 50,000 polygons',
          why: 'What the AI route returns, and a good ceiling for anything you upload — heavier models stutter on older phones.',
        },
        {
          label: 'Textures',
          value: 'Plain colours load fastest',
          why: 'An untextured model is a fraction of the download. On venue wifi that is the difference between instant and awkward.',
        },
        {
          label: 'AI generation',
          value: '≈10 credits, up to ~10 minutes',
          why: 'Worth it for one hero prop. Not worth it for something the library already has.',
        },
        {
          label: 'Library props',
          value: 'Free, unlimited',
          why: 'Colour, finish and engraving are configuration, not generation — nothing is charged.',
        },
      ],
    },
    {
      kind: 'prose',
      title: 'Make it react',
      body: [
        `Props get much better when they do something. Magic Triggers watch your guest and fire an effect when they make a gesture: there are ${GUIDE_COUNTS.triggerSources} cues to choose from — smile, open mouth, wink, brow raise, closed fist, open palm, pinch, peace sign and hand-to-temple — and ${GUIDE_COUNTS.triggerActions} things they can set off: a Burst of confetti, an energy Blast, a Reveal that makes a hidden object appear, an Animate that shakes or spins a piece, and a Filter pulse that flashes the whole look.`,
        `You can have up to ${GUIDE_COUNTS.maxTriggers} of these in one scene, and each one waits about 2.5 seconds before it can fire again, so a guest holding a grin does not machine-gun the effect.`,
        `Two Power-Ups build the fancy versions for you. Power FX pairs a visor, wand or gauntlet with a gesture-fired energy blast that erupts from the prop itself. 3D Name Jewelry turns a name into a necklace, earrings or floating text. Both write ordinary objects back into your scene, so you can keep editing them afterwards. A scene holds up to ${GUIDE_COUNTS.maxObjects} pieces on top of its frame.`,
      ],
    },
    {
      kind: 'callout',
      tone: 'watch',
      title: 'Heavy props punish bad venue wifi',
      body: 'Every guest downloads your prop before their camera opens. A detailed, fully textured model can be tens of megabytes — fine on your desk, painful in a ballroom basement where forty people join at once. Prefer a library prop, keep uploads lean, and if you must ship something heavy, test it on a phone using mobile data before the doors open.',
    },
    {
      kind: 'tools',
      title: 'Where to make a custom model',
      blurb: 'If the library and the AI route do not have your object, this is the one to reach for. Export a GLB and upload it.',
      toolNames: ['Meshy'],
    },
    {
      kind: 'cta',
      label: 'Open a studio and try a prop',
      to: '/host/new',
      blurb: 'Spin up an event, switch the canvas to 3D, and put something on your own face in about a minute.',
    },
  ],
};

const USE_THE_STUDIO: GuideDoc = {
  slug: 'use-the-studio',
  eyebrow: 'The studio',
  title: 'Find everything in the studio',
  hook: `One screen, ${GUIDE_COUNTS.studioTabs} tabs, nothing buried. Here is what each one is for.`,
  minutes: 7,
  hue: '#22D3EE',
  blocks: [
    {
      kind: 'prose',
      body: [
        'Everything about one event lives behind one link. Open an event and you get a row of tabs across the top; each one owns a different part of the night, and nothing you do in one is lost when you move to another.',
        'The middle of the screen is the stage — a live preview of exactly what a guest sees. Left of it is your library of frames, stickers, filters and props. Right of it are the settings for whatever you have selected.',
      ],
    },
    {
      kind: 'hotspots',
      shot: 'studio-editor',
      title: 'The editor, labelled',
      blurb: 'Tap a marker to see what that part of the screen does.',
    },
    {
      kind: 'prose',
      title: 'What each tab is for',
      body: [
        'Dashboard — the state of your event at a glance: whether it is live, how many photos have come in, your guest link and the QR code to print.',
        'Studio — where you design. Switch the canvas between 2D for flat frames and filters, 3D for face-tracked props, and Preview to see the finished thing exactly as a guest will. It is one scene in all three views.',
        'Experiences — a booth can offer more than one look. Each experience is its own scene, and guests pick from them when they arrive.',
        'Assets — your uploads and your AI generations. Frames, stickers and 3D files all land here, and the chip you have active decides which kind an upload becomes.',
        'Wall — the big screen. Choose how photos arrive and how they are laid out, and get the link you open on the projector.',
        'Challenges — little missions for guests, worth points, optionally checked by AI from the photo itself.',
        'Cards — keepsake cards: a shareable page friends and family contribute photos and messages to, which can be rendered into a short film.',
        'Share — the print kit. QR signage, table cards and the links you hand to your venue.',
      ],
    },
    {
      kind: 'steps',
      title: 'The bar above the tabs',
      steps: [
        {
          title: 'Your event, at the top',
          body: 'The event name, its address, and a pill telling you whether it is a draft, live, or ended. The back arrow beside it returns you to your events list.',
        },
        {
          title: 'The credit pill',
          body: 'Your AI credit balance rides along on every tab. It turns red at zero — which is also the answer if a generation ever seems to do nothing.',
          tip: 'Tapping it takes you straight to Billing.',
        },
        {
          title: 'The sparkle button',
          body: 'Opens the Copilot anywhere in your event. Describe what you want; it proposes, you confirm.',
        },
        {
          title: 'The guest link chip',
          body: 'One tap copies your event’s welcome link — the exact address your QR signage points at. Report a problem sits beside it if anything ever feels off.',
        },
      ],
    },
    {
      kind: 'prose',
      title: 'Two things worth knowing early',
      body: [
        'Test on phone does what it says: it gives you a link to open on your own handset so you can check the AR on a real camera without publishing anything to guests.',
        'The Copilot floats on every host screen. It plans with you rather than acting behind your back — it proposes at most 3 changes at a time, and every one of them shows you a confirm card before anything is written. It also knows what things cost, so it will tell you before it spends a credit.',
        'Ask it for a whole look — "put my guests in a moonlit jungle, with a filter to match" — and instead of guessing at three separate pieces it offers to open the Scene Director, the studio tool that designs frame, filter and 3D prop together, with your brief already typed in. Ask for a person, or for help with billing or your account, and it offers to open a support message for you, pre-filled with what you were trying to do. Both are cards you confirm; nothing happens on its own.',
        'Two small things. Rate any reply with a thumb up or down — hover it on a desktop, or just look under it on a phone. And if a 3D prop it ordered is still sculpting when the wait runs long, the card offers Keep waiting: it picks the same job back up, so nothing is charged twice.',
      ],
    },
    {
      kind: 'spec',
      title: 'The limits, stated plainly',
      rows: [
        {
          label: 'Tabs in an event',
          value: `${GUIDE_COUNTS.studioTabs}`,
          why: 'Dashboard, Studio, Experiences, Assets, Wall, Challenges, Cards and Share. Cards appears on Premium and above.',
        },
        {
          label: 'Pieces in one scene',
          value: `${GUIDE_COUNTS.maxObjects}`,
          why: 'Stickers and 3D props. Your frame does not count towards it.',
        },
        {
          label: 'Magic Triggers per scene',
          value: `${GUIDE_COUNTS.maxTriggers}`,
          why: 'Enough for a rich scene, few enough that a guest can tell what caused what.',
        },
        {
          label: 'Gesture cues',
          value: `${GUIDE_COUNTS.triggerSources}`,
          why: 'Four from the face, five from the hands. Mix them freely.',
        },
        {
          label: 'What a trigger can do',
          value: `${GUIDE_COUNTS.triggerActions} actions`,
          why: 'Burst, Blast, Reveal, Animate and Filter — each with its own styles.',
        },
        {
          label: 'Frame layouts in AI Frame Studio',
          value: `${GUIDE_COUNTS.frameArchetypes}`,
          why: 'Border, Full scene, Two faces, Corners and Banner.',
        },
        {
          label: 'Power-Ups',
          value: `${GUIDE_COUNTS.powerUps}`,
          why: 'Power FX and 3D Name Jewelry — guided builders that write normal objects back into your scene.',
        },
      ],
    },
    {
      kind: 'cta',
      label: 'Open the studio',
      to: '/host',
      blurb: 'Your events, your assets and your Copilot are all one click in.',
    },
  ],
};

const FIRST_EVENT: GuideDoc = {
  slug: 'first-event',
  eyebrow: 'Start here',
  title: 'Your first event, start to finish',
  hook: 'One sentence in, a live booth out. No design skills, no app for your guests to install.',
  minutes: 6,
  hue: '#34D399',
  blocks: [
    {
      kind: 'film',
      videoKey: 'first-event',
      title: 'The whole thing, in a couple of minutes',
      caption: 'From describing your event to a guest scanning the QR code and beaming a photo onto the wall.',
    },
    {
      kind: 'prose',
      body: [
        'You do not build an event here so much as describe one. Tell the Concierge what the night is — "a 40th birthday, garden party, pink and gold" — and it designs the whole thing: the look, a frame, a wall, a set of challenges. You can also just hand it a photo of your invitation and let it read the palette off that.',
        'Then you adjust what you want and go live. Guests scan a QR code and their camera opens in the browser. Nothing to install, on any phone.',
      ],
    },
    {
      kind: 'steps',
      title: 'Five steps to a live booth',
      steps: [
        {
          title: 'Describe your event',
          body: 'Start a new event and write one sentence about it — occasion, vibe, colours. Or upload a photo of the invitation and let it design from that. If the AI designer is ever unavailable, the Concierge says why in plain words and builds from a quick template match instead; you can restyle all of it in the studio.',
          tip: 'Be specific about mood and colour. "Elegant, ivory and gold, evening" gets you much further than "wedding".',
        },
        {
          title: 'Work the checklist',
          body: 'Your dashboard shows a short list: name it, choose the look, add a frame, take a test photo. Each item links straight to the screen that finishes it, and it ticks itself off as you go.',
        },
        {
          title: 'Take a test photo yourself',
          body: 'Use Test on phone and take one real shot on your own handset. This is the single highest-value five minutes you will spend — it catches a frame that crops badly or a prop that is too heavy, while there is still time.',
          tip: 'Test on the phone you will hand to a guest, not just your desktop browser.',
        },
        {
          title: 'Go live',
          body: 'One switch. Until you flip it, the guest link shows a friendly not-yet page, so you can share it in advance without anyone seeing a half-built booth.',
        },
        {
          title: 'Print the signage',
          body: 'The Share kit gives you QR signage and table cards pointing at your welcome page. Print them, put one on every table, and your job on the night is basically done.',
          tip: 'Put a card at the bar and one by the door. Those two spots get scanned more than every table combined.',
        },
      ],
    },
    {
      kind: 'callout',
      tone: 'tip',
      title: 'Do this the week before, not the hour before',
      body: 'Everything above takes about fifteen minutes, but venue wifi, a printer that is out of ink and a frame that needs one more revision do not. Build it early, test it on a phone, then leave it alone. On the night you should be a guest at your own party.',
    },
    {
      kind: 'cta',
      label: 'Create your event',
      to: '/host/new',
      blurb: 'One sentence is genuinely enough to start.',
    },
  ],
};

const RUN_THE_NIGHT: GuideDoc = {
  slug: 'run-the-night',
  eyebrow: 'Show night',
  title: 'Run the night like a pro',
  hook: 'Wall on the big screen, moderation set, someone else on the door — and you get to enjoy your own party.',
  minutes: 9,
  hue: '#E879F9',
  blocks: [
    {
      kind: 'prose',
      body: [
        'The booth is only half of it. The live wall is what makes a room turn around: photos arrive in front of everyone, beaming in as they are taken, and people go and take another one so they can watch it land.',
        'Everything below is set once, before the doors open.',
      ],
    },
    {
      kind: 'steps',
      title: 'Set up the wall',
      steps: [
        {
          title: 'Pick how it shows',
          body: 'Gallery lays every photo out in a grid. Slideshow gives each one the whole screen in turn. Leaderboard puts the challenge scores up so the room starts competing. Projection mode is the one to use on an actual projector — it drops the interface and goes edge to edge.',
          tip: 'Slideshow reads best on a big screen far from the crowd; Gallery reads best on a TV people can walk up to.',
        },
        {
          title: 'Open it on the screen itself',
          body: 'The wall has its own link. Open it in a browser on the machine driving the projector or TV, go full screen, and leave it. It updates itself as photos arrive.',
          tip: 'Turn off the screensaver and sleep timer on that machine before you walk away from it.',
        },
        {
          title: 'Decide the moderation stance',
          body: 'Instant means photos appear the moment they are taken — the energy is much better and it is right for weddings and private parties. Approve-first holds each photo until someone lets it through; use it for public, branded or corporate events.',
          tip: 'If you choose Approve-first, make sure the person approving actually has the manager link before the night starts.',
        },
        {
          title: 'Hand out a manager link',
          body: 'A manager link opens a stripped-down console for whoever is running the room — approving photos, watching the count — without giving them access to your account or your billing.',
        },
      ],
    },
    {
      kind: 'prose',
      title: 'Challenges give people a reason to keep going',
      body: [
        'A challenge is a small mission worth points: "get a photo with someone you have never met", "find the couple’s parents". Guests see them in the booth, and the Leaderboard wall mode turns the whole thing into a game.',
        'You can also have AI check the photo against the mission before it counts. Worth knowing how that behaves: if the check cannot run — bad wifi, a slow response — it lets the photo through anyway. A guest is never blocked by a hiccup on our side. If the check runs and disagrees, the guest can retake it or post without the challenge tag.',
      ],
    },
    {
      kind: 'prose',
      title: 'Keepsake cards, after the night',
      body: [
        'A keepsake card is a shareable page for one person or one couple. Friends and family add photos and messages to it — up to 8 MB per photo, 60 MB and 20 seconds for a video — and it becomes something worth keeping rather than a folder of files.',
        'When it is full you can render it into a short film, which costs around 30 credits. Guests can also bulk-save everything they appear in from their own gallery, so nobody has to ask you for their photos afterwards.',
      ],
    },
    {
      kind: 'prose',
      title: 'After the event',
      body: [
        'When the party is over, hit End on the event. The booth shuts to new photos immediately — anyone who scans the QR after that gets your thank-you screen instead of a camera, so give guests their last call before you press it.',
        'Later, once an old event is just taking up room in Your events, hit Archive. It slides into a collapsed Archived shelf at the bottom of the page and nothing is deleted — the wall, every photo, the keepsake cards and the credits you spent are all exactly where you left them, and one click brings it back.',
      ],
    },
    {
      kind: 'prose',
      title: 'Send everyone the album',
      body: [
        'The album is a public page holding every photo from the night, plus a collage each guest can build and save on their own phone — mosaic, filmstrip or scattered prints, their pick. Their own shots go in first and never get cut.',
        'It has its own QR card in Share & Print, next to the booth and wall ones. That code is the one worth putting in a thank-you message, because unlike the others it keeps working after you end the event — the thank-you screen a late scanner gets now links straight to it.',
        'Getting it into inboxes takes one press. Guests are offered a "Send me the album" box in the booth after they send their first photo — nobody has to fill it in, and nobody is asked twice. Once the night is over and you have hit End, open Share & Print and press Send keepsakes: everyone who left an address gets one email, with an unsubscribe link at the bottom. Nobody else is contacted.',
        'Send yourself a preview first if you want to see exactly what lands. That button works at any stage, including before the doors open, and it touches nothing but your own inbox.',
      ],
    },
    {
      kind: 'spec',
      title: 'What things cost',
      rows: [
        {
          label: 'Your first 3 AI images',
          value: 'Free, on every event',
          why: 'Enough to find a look you like before you spend anything.',
        },
        {
          label: 'AI frame — Gemini',
          value: '1 credit',
          why: 'The cheaper engine. Strong on graphic and illustrated designs.',
        },
        {
          label: 'AI frame — Higgsfield',
          value: '2 credits',
          why: 'The better-looking engine, especially for photoreal scenes and character hands.',
        },
        {
          label: 'Bring your own AI key',
          value: 'Free',
          why: 'Already paying an AI provider? Use your key and Beamwall charges nothing for generation.',
        },
        {
          label: 'A failed cut-out',
          value: 'Retried free',
          why: 'If the transparent window does not key cleanly, the retry is on us — you never pay twice for one frame.',
        },
        {
          label: 'AI 3D prop',
          value: '≈10 credits',
          why: 'Up to ten minutes to build. The library props cost nothing at all.',
        },
        {
          label: 'Keepsake film render',
          value: '≈30 credits',
          why: 'One render turns a full card into a shareable film.',
        },
      ],
    },
    {
      kind: 'callout',
      tone: 'tip',
      title: 'The night-before checklist',
      body: 'Open the wall link on the actual screen and leave it running for ten minutes. Take one photo on a phone using mobile data, not the venue wifi. Confirm whoever is moderating has their link and knows what Approve-first means. Check the QR cards are printed and the ink has not run. That is the whole list.',
    },
    {
      kind: 'cta',
      label: 'Set up your event',
      to: '/host',
      blurb: 'Wall modes, moderation and manager links are all in the event you already have.',
    },
  ],
};

export const GUIDES: Record<GuideSlug, GuideDoc> = {
  'make-a-frame': MAKE_A_FRAME,
  'make-3d-props': MAKE_3D_PROPS,
  'use-the-studio': USE_THE_STUDIO,
  'first-event': FIRST_EVENT,
  'run-the-night': RUN_THE_NIGHT,
};

/** Hub order — the order a new host should read them in, not alphabetical. */
export const GUIDE_ORDER: readonly GuideSlug[] = [
  'first-event',
  'make-a-frame',
  'make-3d-props',
  'use-the-studio',
  'run-the-night',
];

export function isGuideSlug(v: string): v is GuideSlug {
  return Object.prototype.hasOwnProperty.call(GUIDES, v);
}

/**
 * What is actually inside a guide, for the hub cards — "14 free frames",
 * "14 prompts", "Film".
 *
 * DERIVED from the guide's own blocks rather than authored beside them. Five
 * cards that differ only in their title all look like the same card, and the
 * thing that makes one worth opening is usually what it hands you. Counting it
 * here means the promise on the hub cannot outlive the block that keeps it.
 */
export function guideHighlights(doc: GuideDoc): string[] {
  let frames = 0;
  let prompts = 0;
  let films = 0;
  let shots = 0;
  let steps = 0;
  for (const b of doc.blocks) {
    if (b.kind === 'downloads') frames += b.entryIds.length;
    else if (b.kind === 'prompts') prompts += b.cardIds.length;
    else if (b.kind === 'film') films += 1;
    else if (b.kind === 'hotspots') shots += 1;
    else if (b.kind === 'steps') steps += b.steps.length;
  }
  const out: string[] = [];
  if (frames > 0) out.push(`${frames} free frames`);
  if (prompts > 0) out.push(`${prompts} prompts`);
  if (films > 0) out.push(films === 1 ? 'Film' : `${films} films`);
  if (shots > 0) out.push('Labelled screenshot');
  // Steps are the filler chip: every guide has them, so they only say anything
  // on a card that has nothing rarer to offer.
  if (steps > 0 && out.length < 2) out.push(`${steps} steps`);
  return out;
}

/* ------------------------------------------------------------------ */
/* GUIDE_COVERAGE — the contract guidesDrift.test.ts enforces          */
/* ------------------------------------------------------------------ */

export interface GuideCoverageEntry {
  guide: GuideSlug;
  /** Where in that guide the thing is actually explained. Written for the
   *  developer who trips the drift test, so they know what to extend. */
  note: string;
}

/**
 * Typed as Record<string, …> DELIBERATELY.
 *
 * Keying these on the real union types would make a new studio tab or feature
 * flag a *compile* error in this file — which reads like a chore and gets
 * silenced with a one-word stub. Keeping them loose means the failure lands in
 * guidesDrift.test.ts instead, with a message that says which surface shipped
 * without an explanation and what to write.
 */
export const GUIDE_COVERAGE: {
  studioTabs: Record<string, GuideCoverageEntry>;
  hostNav: Record<string, GuideCoverageEntry>;
  addOns: Record<string, GuideCoverageEntry>;
  helpTopics: Record<string, GuideCoverageEntry>;
  featureKeys: Record<string, GuideCoverageEntry>;
} = {
  studioTabs: {
    dashboard: { guide: 'use-the-studio', note: 'What each tab is for — Dashboard; the checklist is walked in first-event.' },
    studio: { guide: 'use-the-studio', note: 'What each tab is for — Studio; the 2D/3D/Preview split and the editor hotspots.' },
    experiences: { guide: 'use-the-studio', note: 'What each tab is for — Experiences (more than one look per booth).' },
    assets: { guide: 'make-a-frame', note: 'Four ways to get your frame — upload path, and the frame-or-sticker chip.' },
    wall: { guide: 'run-the-night', note: 'Set up the wall — the four modes and the projector link.' },
    challenges: { guide: 'run-the-night', note: 'Challenges give people a reason to keep going, including the AI photo check.' },
    cards: { guide: 'run-the-night', note: 'Keepsake cards, after the night — contribution limits and the film render.' },
    share: { guide: 'first-event', note: 'Five steps to a live booth — Print the signage (QR kit).' },
  },
  hostNav: {
    events: { guide: 'first-event', note: 'Five steps to a live booth — creating and going live with an event.' },
    concierge: { guide: 'first-event', note: 'Describe your event — the Concierge designs from a sentence or a photo.' },
    billing: { guide: 'run-the-night', note: 'What things cost — the credit table covers what billing buys.' },
    support: { guide: 'use-the-studio', note: 'Two things worth knowing early — the Copilot (which can open a support message for you), and where help lives on every host screen.' },
  },
  addOns: {
    'power-fx': { guide: 'make-3d-props', note: 'Make it react — Power FX pairs a visor/wand/gauntlet with a gesture-fired blast.' },
    'name-jewelry': { guide: 'make-3d-props', note: 'Make it react — 3D Name Jewelry builds a necklace, earrings or floating text from a name.' },
  },
  helpTopics: {
    library: { guide: 'make-a-frame', note: 'Four ways to get your frame — the library, uploads and AI Frame Studio.' },
    modes: { guide: 'use-the-studio', note: 'What each tab is for — Studio; 2D, 3D and Preview are one scene.' },
    director: { guide: 'first-event', note: 'Describe your event — the AI designs the whole scene, you keep what you like.' },
    triggers: { guide: 'make-3d-props', note: 'Make it react — the gesture cues, the actions and the per-scene cap.' },
  },
  featureKeys: {
    maxPosts: { guide: 'run-the-night', note: 'What things cost — how many photos a plan carries.' },
    videoEnabled: { guide: 'make-3d-props', note: 'Put a crown on every guest — video capture is what makes a reacting prop worth having.' },
    watermark: { guide: 'run-the-night', note: 'What things cost — paid plans remove the Beamwall signature from guest photos.' },
    aiStudio: { guide: 'make-a-frame', note: 'Describe it to AI Frame Studio, and the credit table in run-the-night.' },
    cardsStandard: { guide: 'run-the-night', note: 'Keepsake cards, after the night — contributing photos and messages.' },
    cardsPremiumRender: { guide: 'run-the-night', note: 'Keepsake cards / What things cost — the ≈30-credit film render.' },
    projectionMode: { guide: 'run-the-night', note: 'Set up the wall — Projection mode for an actual projector.' },
    retentionDays: { guide: 'run-the-night', note: 'Keepsake cards, after the night — guests bulk-save before photos age out.' },
  },
};
