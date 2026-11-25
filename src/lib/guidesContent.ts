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
        body: 'Tell the Director the vibe and it designs a matching frame, effect and prop as one scene. You preview each piece and only keep what you love.',
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
        body: 'Everything lives in one library. The chips — Frames, Stickers, Effects, Props — narrow it, and the active chip also decides what kind of thing your next upload becomes.',
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
        body: 'Power FX arms a prop like the visor with an energy blast that fires on a gesture. 3D Name Jewelry builds a necklace or floating text from a name.',
      },
      {
        id: 'library',
        x: 0.105, y: 0.780, side: 'right',
        label: 'The library',
        title: 'Built-in frames and props',
        body: 'Ready-made frames, stickers, effects and props. Tap any tile to add it to the scene — its settings open in the panel on the right.',
      },
      {
        id: 'modes',
        x: 0.499, y: 0.118, side: 'right',
        label: 'Three views',
        title: '2D, 3D and Preview',
        body: 'One scene, three views. 2D places flat frames and effects, 3D anchors face-tracked props, and Preview shows the finished result exactly as a guest will see it.',
      },
      {
        id: 'starters',
        x: 0.499, y: 0.312, side: 'right',
        label: 'Start with a look',
        title: 'Starter scenes',
        body: 'Each card previews that scene’s look. Tap one to start from it, then make it yours — nothing is locked.',
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

/* ------------------------------------------------------------------ */
/* Product screens                                                     */
/* ------------------------------------------------------------------ */

/**
 * Real product screens that sit beside the words: a step's picture, the
 * picture beside a section, a strip of guest phone screens, a hub card's cover.
 *
 * Every one is a capture of the real product, never a mock-up: host setup
 * screens come from the setup wizard at 1440 × 900, guest screens from the
 * booth on a 390 × 844 phone (scripts/shoot-guide-screens.mjs). The person in
 * the guest screens is the platform's AI stand-in guest, not a real one.
 *
 * Served by URL from public/guides/screens/<id>.webp (guidesMedia.guideScreen)
 * so a visitor only fetches the pictures of the guide they open.
 * guidesContent.test.ts holds each recorded width/height to the file's own
 * header, so a re-shoot at another size is a red test, not a squashed image.
 */
export type GuideScreenId =
  | 'setup-basics'
  | 'setup-welcome'
  | 'setup-looks'
  | 'setup-powerups'
  | 'setup-challenges'
  | 'setup-livewall'
  | 'setup-keepsake'
  | 'setup-launch'
  | 'wall-gallery'
  | 'wall-grid'
  | 'studio-editor'
  | 'guest-welcome'
  | 'guest-frame'
  | 'guest-crown'
  | 'guest-paint'
  | 'guest-effects'
  | 'guest-more-looks'
  | 'guest-send'
  | 'guest-challenges';

export interface GuideScreen {
  id: GuideScreenId;
  /** phone = drawn in a phone bezel; desktop = in a browser window. */
  device: 'phone' | 'desktop';
  width: number;
  height: number;
  alt: string;
}

const DESKTOP = { device: 'desktop', width: 1600, height: 1000 } as const;
const PHONE = { device: 'phone', width: 600, height: 1298 } as const;

export const GUIDE_SCREENS: Record<GuideScreenId, GuideScreen> = {
  'setup-basics': { id: 'setup-basics', ...DESKTOP, alt: 'The first setup step: the event name, Ada & Tolu’s Wedding, and its date, with a phone preview of the welcome page beside it' },
  'setup-welcome': { id: 'setup-welcome', ...DESKTOP, alt: 'Designing the welcome page: Background, Border and Words tabs over a row of background templates, with the phone preview on the right' },
  // Cropped to the picker: the try-on preview to its right is left out.
  'setup-looks': { id: 'setup-looks', device: 'desktop', width: 1440, height: 1200, alt: 'The Looks step: Frames, 3D props, Face paint, Effects and Filters tabs, an occasion menu, and a grid of frames each ticked on for guests' },
  'setup-powerups': { id: 'setup-powerups', device: 'desktop', width: 1600, height: 360, alt: 'Power-ups, Gestures tab: Smile showers sparkles and Open your mouth wide pops confetti, each with Turn on and Preview' },
  'setup-challenges': { id: 'setup-challenges', ...DESKTOP, alt: 'Challenges: suggested photo missions for a wedding reception, like First dance floor and Toast to the couple, each with its points' },
  'setup-livewall': { id: 'setup-livewall', ...DESKTOP, alt: 'The Live wall step: eight wall styles on the left and the real live wall filled with sample photos on the right, with a Beam a photo button' },
  'setup-keepsake': { id: 'setup-keepsake', ...DESKTOP, alt: 'The Keepsake step: colour choices and opening moments for the album guests get the morning after, with a live preview of the album' },
  'setup-launch': { id: 'setup-launch', ...DESKTOP, alt: 'The Launch step: a ticked checklist of every part of the event, a Go live button, Open or print shortcuts, and the real welcome page on a phone' },
  'wall-gallery': { id: 'wall-gallery', ...DESKTOP, alt: 'The live wall on a big screen in Gallery layout: tall photo cards of guests with their names, two QR codes on the right and a challenge ticker at the bottom' },
  'wall-grid': { id: 'wall-grid', ...DESKTOP, alt: 'The live wall in Grid layout: sixteen guest photos edge to edge, each with the guest’s name, beside the QR codes' },
  'studio-editor': { id: 'studio-editor', ...DESKTOP, alt: 'The Studio editor: the library on the left, the stage in the middle and the properties panel on the right' },
  'guest-welcome': { id: 'guest-welcome', ...PHONE, alt: 'The welcome page on a guest’s phone: the event’s name, a booth preview of a smiling guest wearing a gold crown, and a Step into the booth button' },
  'guest-frame': { id: 'guest-frame', ...PHONE, alt: 'The booth with a thin gold frame round the camera, the Frames tab open and a row of round look thumbnails above the shutter' },
  'guest-crown': { id: 'guest-crown', ...PHONE, alt: 'A guest in the booth wearing a 3D gold crown that sits on their head, with confetti falling, inside a gold frame' },
  'guest-paint': { id: 'guest-paint', ...PHONE, alt: 'A guest wearing tiger face paint in the booth, with the Paint tab open and other designs like Butterfly and Frost beside it' },
  'guest-effects': { id: 'guest-effects', ...PHONE, alt: 'A guest wearing a snowflake tiara and frost face paint while snow falls across the whole screen' },
  'guest-more-looks': { id: 'guest-more-looks', ...PHONE, alt: 'The More looks sheet: every look at once, filtered by All, Frames, Props and Paint chips, with a Done button' },
  'guest-send': { id: 'guest-send', ...PHONE, alt: 'The photo a guest just took, crown and frame included, with Retake and Send to the wall buttons under it' },
  'guest-challenges': { id: 'guest-challenges', ...PHONE, alt: 'The guest challenges page: six missions like Raise a toast and Royalty for a night, each with its emoji and points, and a progress bar' },
};

export type GuideBlock =
  | { kind: 'prose'; title?: string; body: string[]; screen?: GuideScreenId }
  | {
      kind: 'steps';
      title: string;
      steps: { title: string; body: string; tip?: string; screen?: GuideScreenId }[];
    }
  | { kind: 'screens'; title: string; blurb: string; items: { screen: GuideScreenId; caption: string }[] }
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
  /** The real screen on this guide's hub card. */
  cover: GuideScreenId;
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
  powerUps: 4,
  /** copilot.ts MAX_ACTIONS — the most changes the Copilot proposes in one turn. */
  copilotMaxActions: 5,
  /** contentPacks.ts PACK_IDS — one starter pack per event style. */
  starterPacks: 5,
  /** Missions inside every starter pack (asserted per pack, not on average). */
  starterPackMissions: 5,
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
  cover: 'guest-frame',
  blocks: [
    {
      kind: 'prose',
      screen: 'guest-frame',
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
          title: 'Pick a ready-made one',
          body: 'Open your event and go to the Looks tab. At the top, Pick your looks shows the frames that come with every event: tap one to switch it on or off for guests, press Open with this on the one the booth should start with, and Save. Above them, Ready-made looks adds complete designs from Beamwall, best fit for your event first — tap one to add it to your booth straight away, tap again to take it off. Nothing to design, nothing to upload. This is the two-minute route.',
          tip: 'Even if you plan to make your own, add one first so your booth is never empty while you experiment.',
          screen: 'setup-looks',
        },
        {
          title: 'Make one with AI, in the same tab',
          body: `In Looks, just below the picker, Make a frame with AI needs no writing at all: Pick a look (one is already chosen from your occasion), pick your colours, leave Add the event name on to have your names and date drawn in, and press Generate. It comes back cut out and shown on a phone with the booth’s buttons outlined — press Use as booth frame and guests get it, opening first. Prefer your own words? Describe it yourself swaps to a free-text box. The Generate button says free while your event still has free frames (the first 3 on every event), then shows the price. Teams with the Studio add-on get the full version inside the Studio: ${GUIDE_COUNTS.frameArchetypes} layouts — Border, Full scene, Two faces, Corners or Banner — and lettering styles for your names.`,
          tip: 'Name a colour and a style in the description — "ivory and gold, art-deco" gets you much further than "wedding".',
        },
        {
          title: 'Write the prompt yourself, anywhere',
          body: 'Use any image generator you already pay for — the prompts further down are written to work in all of them, and each one shows you the frame it makes. Save the result, then upload it. The only rule is the green-window rule those prompts all end with.',
          tip: 'Beamwall’s own AI Frame Studio runs on these same engines, so a prompt that works there works here.',
        },
        {
          title: 'Bring a designer’s file, or import from Higgsfield',
          body: 'Made it on Higgsfield, or anywhere that gives you a public image link? Paste the link into the import page and it lands in your event’s Looks, ready to switch on (up to 10 MB, PNG, JPEG or WebP). Uploading a file straight from your computer — PNG, JPG, WEBP or SVG — happens in the Studio’s Assets tab, which comes with the Studio add-on; there the chip you have selected decides whether it becomes a frame or a sticker.',
        },
      ],
    },
    {
      kind: 'prose',
      title: 'Or let guests step onto a magazine cover',
      body: [
        'Magazine covers are frames that fill themselves in. Open Looks, go to Frames, and the Magazine covers row at the top has one for every big occasion: wedding, anniversary, birthday, retirement, corporate, product launch, Christmas, Halloween, graduation, baby shower, New Year and gala. Tap one to open it, press Add to booth, and it is on. Every title is our own made-up magazine name, and you can change it.',
        'Three tabs set it up. Style picks the occasion. Words sets the title across the top (up to 18 letters, because it is cut in 3D letters, so a couple’s names fit), the lead headline, the issue date and a hashtag printed along the bottom. Names takes up to three names the cover celebrates, so a line like “Guests of Ada & Tunde’s wedding” writes itself. The preview switches between the selfie frame and the cover standing in a room.',
        'For guests it works two ways. In the Frames tab it is a selfie frame with a clear middle, so nobody gets cut off. In Props it has a 3D tile: pick it and the back camera stands a life-size cover up in the room, with a thick frame, the title hanging from the top in 3D letters, the cover lines floating in front, and real 3D flowers, balloons or stars on the corners. Guests can put up to three of their own names on it as the cover stars when they pick it, and change them any time from the chip at the top of the screen. Leave Ask guests for their names on in the Names tab for that.',
      ],
    },
    {
      kind: 'downloads',
      title: 'Start with a ready-made one',
      blurb: 'Fourteen finished frames, already the right size and already cut out — free to download for your own designs, or to hand to whoever runs your Studio. The chequered part is see-through — that is where your guest lands — and the dashed window shows how much room the design leaves them.',
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
          why: 'Studio add-on: same upload button, two outcomes — check the chip before you drop the file in.',
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
      to: '/signup',
      blurb: 'Describe your event in one sentence and get a booth, a frame and a wall in a couple of minutes.',
    },
  ],
};

const MAKE_3D_PROPS: GuideDoc = {
  slug: 'make-3d-props',
  eyebrow: 'Studio add-on',
  title: 'Put a crown on every guest',
  hook: 'Pick a prop, paint it your colours, engrave a name — and it lands on every face in the room.',
  minutes: 9,
  hue: '#7C6CF7',
  cover: 'guest-crown',
  blocks: [
    {
      kind: 'prose',
      screen: 'guest-crown',
      body: [
        'A 3D prop is an object that sticks to your guest as they move: a crown on the head, a visor over the eyes, a pair of earrings. It tracks their face in real time, so it stays put when they laugh, lean in or pull a friend into the shot.',
        'This is the part guests film themselves doing. A frame gets a photo; a prop gets a video of someone discovering they have antlers.',
        'Props are built in the Studio, which is an add-on for teams and large organisations. No Studio? Ask the Copilot to put a ready-made prop or effect on your booth — it proposes, you confirm.',
        'With the Studio there are four ways to get one, and the first two cost you nothing at all.',
      ],
    },
    {
      kind: 'screens',
      title: 'What it looks like on a guest',
      blurb: 'Real booth screens on a phone. Everything here follows the face as the guest moves, and lands in the photo exactly as it looks on screen.',
      items: [
        { screen: 'guest-crown', caption: 'A 3D crown that sits on the head, with confetti on top' },
        { screen: 'guest-paint', caption: 'Face paint that moves with the face when they smile' },
        { screen: 'guest-effects', caption: 'A tiara and frost paint, with snow across the whole screen' },
        { screen: 'guest-more-looks', caption: 'More looks shows every prop, frame and effect at once' },
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
      screen: 'setup-powerups',
      body: [
        `Props get much better when they do something. Magic Triggers watch your guest and fire an effect when they make a gesture: there are ${GUIDE_COUNTS.triggerSources} cues in the Studio — smile, open mouth, wink and brow raise from the face, and closed fist, open palm, pinch, peace sign and hand-to-temple from the hands — and ${GUIDE_COUNTS.triggerActions} things they can set off: a Burst of confetti, an energy Blast, a Reveal that makes a hidden object appear, an Animate that shakes or spins a piece, and an Effect pulse that flashes the whole look.`,
        'For now, guest booths track faces only, which keeps the camera as smooth and sharp as the phone allows. The hand cues and hand-held gear like the gauntlet stay in the Studio, but guests will not see them, so build your reactions on the face cues.',
        `You can have up to ${GUIDE_COUNTS.maxTriggers} of these in one scene, and each one waits about 2.5 seconds before it can fire again, so a guest holding a grin does not machine-gun the effect.`,
        'Guests never have to guess. When they pick a Look that reacts, a short "Try this" card pops up over the camera saying what to do and what happens, like Open your mouth wide, then Confetti pops. It closes on its own after a few seconds, and a small button on the side of the screen brings it back.',
        'Frames can move too. In the 2D view, pick a piece of your frame and choose an Entrance (Fade, Rise, Drop, Bloom, From left, From right or Spin in) with a delay, so the pieces arrive one after another, then an idle motion such as Float, Sway, Twinkle or Drift to keep it gently alive. The motion is part of the frame, so it plays in videos as well as on screen, and guests get a Replay button to run the entrance again whenever they like, for example just before they start recording.',
        `Four Power-Ups build the fancy versions for you. Power FX pairs a prop like the visor with a gesture-fired energy blast that erupts from the prop itself. 3D Name Jewelry turns a name into a necklace, earrings or floating text. All four write ordinary objects back into your scene, so you can keep editing them afterwards. A scene holds up to ${GUIDE_COUNTS.maxObjects} pieces on top of its frame.`,
        `Face Paint is the third: living paint that sits on your guest's actual skin, so it stretches when they smile and stays put when they turn. Pick a look — Game Day stripes, Flag Cheeks, Eye Black, Glitter Freckles, Hearts, Stars, Tiger or Sugar Skull, or one of the party looks: Butterfly, Hero Mask, Rainbow, Lightning Bolt, Unicorn, Cat or Neon Festival — and it starts in your event colours. For the holidays there's a Christmas set too: Candy Cane, Rudolph, Snowflakes, Frost Queen and Gingerbread, which start in their classic festive colours. Unicorn, Neon Festival, Snowflakes and Frost Queen even twinkle on your guest's face, and hold still for anyone who has turned motion off on their phone. Every look is yours to adjust: change any colour, soften it with Paint strength, or stamp your own logo on the left cheek, right cheek, both cheeks or forehead. Press Test on my face to see it on you in the 3D Live view. It reads the right way round in the mirror and in the saved photo. Face paint uses our advanced face tracker. On the few phones that can't run it, guests still get the rest of your scene, just without the paint.`,
        `Coloured Contacts is the fourth: lenses that follow your guest's eyes, move with every glance and disappear behind a blink, just like real ones. Choose a style — Natural, Vivid, Starburst, Cat Eye, Heart Eyes, Star Eyes, Glow or Full Eye — then pick a colour by name (Sapphire, Emerald, Honey, Violet and more) or any colour you like, and set Lens strength and Lens size. Natural keeps your guest's own pupil and the sparkle in their eye, so it reads like everyday coloured contacts; Glow pulses softly; Full Eye covers the whole eye for a blackout or whiteout costume look. Contacts work on their own or together with Face Paint. The preview has two tabs: Example shows the look on a pair of sample eyes, and Live camera shows it on your own eyes as you change it. Test on my eyes adds the lenses and opens the full stage. They follow one guest at a time and use the same advanced face tracker as Face Paint, so on the few phones that can't run it, guests get the rest of your scene without the lenses.`,
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
      label: 'Start an event and try a prop',
      to: '/signup',
      blurb: 'Spin up an event, then put a prop on your own face — in the Studio, or by asking the Copilot.',
    },
  ],
};

const USE_THE_STUDIO: GuideDoc = {
  slug: 'use-the-studio',
  eyebrow: 'Studio add-on',
  title: 'Find everything in the studio',
  hook: `One screen, ${GUIDE_COUNTS.studioTabs} tabs, nothing buried. Here is what each one is for.`,
  minutes: 7,
  hue: '#22D3EE',
  cover: 'studio-editor',
  blocks: [
    {
      kind: 'prose',
      body: [
        'Everything about one event lives behind one link. Open an event and you get a row of tabs across the top; each one owns a different part of the night, and nothing you do in one is lost when you move to another.',
        'The Studio and its Assets tab are an add-on for teams and large organisations who design their own frames and props. Every host gets the rest — including Looks, where you pick ready-made designs or make a frame with AI. On a phone the tabs scroll sideways, with your event’s name above them.',
        'Inside the Studio, the middle of the screen is the stage — a live preview of exactly what a guest sees. Left of it is your library of frames, stickers, filters and props. Right of it are the settings for whatever you have selected.',
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
        'Studio (add-on) — where you design. Switch the canvas between 2D for flat frames and effects, 3D for face-tracked props, and Preview to see the finished thing exactly as a guest will. It is one scene in all three views.',
        'Looks — everything guests can pick in the booth, under four tabs: Frames, Props, Paint and Effects. The picker at the top holds ready-made looks from Beamwall (best fit for your event first) and the frames and effects included with every event; below it, a quick AI frame, your own pieces and the booth order — each switched On for guests or Off.',
        'Assets (add-on) — your uploads and your AI generations. Frames, stickers and 3D files all land here, and the chip you have active decides which kind an upload becomes.',
        'Wall — the big screen. Choose how photos arrive and how they are laid out, and get the link you open on the projector.',
        'Challenges — little missions for guests, worth points, optionally checked by AI from the photo itself, with a running count of how many passed.',
        'Cards — keepsake cards: a shareable page friends and family contribute photos and messages to, which can be rendered into a short film. It appears on Premium and above, and on every remote celebration.',
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
          body: 'Opens the Copilot anywhere in your event. Describe what you want — type it, or tap the microphone and say it — and it proposes; you confirm.',
        },
        {
          title: 'The guest link chip',
          body: 'One tap copies your event’s welcome link — the exact address your QR signage points at. Report a problem sits beside it if anything ever feels off.',
        },
      ],
    },
    {
      kind: 'prose',
      title: 'Worth knowing early',
      body: [
        'Test on phone does what it says: it gives you a link to open on your own handset so you can check the AR on a real camera without publishing anything to guests.',
        `The Copilot floats on every host screen. It plans with you rather than acting behind your back — it proposes up to ${GUIDE_COUNTS.copilotMaxActions} changes at a time, and every one of them is a card you confirm before anything is written. One change is one card. Two or more arrive together as a single plan card with a box ticked beside each step: untick what you do not want and press Run selected. The free steps run in order, and a step that spends credits opens its own card last, so you always see the cost before it goes. While it is thinking there is a Stop button; press it and the chat simply says Stopped.`,
        'With the Studio add-on, ask it for a whole look — "put my guests in a moonlit jungle, with a filter to match" — and instead of guessing at three separate pieces it offers to open the Scene Director, the studio tool that designs frame, filter and 3D prop together, with your brief already typed in. Ask for a person, or for help with billing or your account, and it offers to open a support message for you, pre-filled with what you were trying to do. Both are cards you confirm; nothing happens on its own.',
        'The cards show their work. Rename the event, move the date or edit a challenge and the card shows a before → after line. Pick a frame or a 3D prop and you choose from thumbnails, not names. A pack of challenges arrives as a list you can untick or retitle one mission at a time. And the chips under its hello change with your event — while it has no challenges, one of them adds the starter pack in a single tap, and the greeting says so.',
        'Three small things. Rate any reply with a thumb up or down — hover it on a desktop, or just look under it on a phone. The microphone in the message box takes dictation on browsers that can listen (Chrome and Safari can; where the browser cannot, the button simply is not there) — what you say lands in the box for you to read and edit, and nothing is sent until you press send. And if a 3D prop it ordered is still sculpting when the wait runs long, the card offers Keep waiting: it picks the same job back up, so nothing is charged twice.',
        'Small type is a choice, not a rule. Larger text, in the host menu beside Support, scales the chats and their cards up on that device — the studio canvas stays exactly as it is — and stays on until you tap it again.',
      ],
    },
    {
      kind: 'spec',
      title: 'The limits, stated plainly',
      rows: [
        {
          label: 'Tabs in an event',
          value: `${GUIDE_COUNTS.studioTabs}`,
          why: 'Dashboard, Studio, Looks, Assets, Wall, Challenges, Cards and Share. Studio and Assets come with the Studio add-on; Cards appears on Premium and above.',
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
          why: 'Four from the face, five from the hands. Guest booths use the face cues for now.',
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
          why: 'Power FX, 3D Name Jewelry, Face Paint and Coloured Contacts — guided builders that write normal objects back into your scene.',
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
  minutes: 9,
  hue: '#34D399',
  cover: 'setup-launch',
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
        'Press New event and a short guided setup walks you through it, one screen at a time. Each step is one card with the steps across its top and a live preview inside it — your camera if you switch it on, or a 3D head wearing your picks if not — so you see what guests will see before you commit to anything.',
        'Everything saves as you go. Close the tab halfway through and your dashboard shows Continue setup on the event, with how far you got. Steps with several separate choices (the welcome page, power-ups and the live wall) walk you through them one part at a time with Next the first time; come back later and every part is a tap away.',
        'Then you go live. Guests scan a QR code and their camera opens in the browser. Nothing to install, on any phone.',
      ],
    },
    {
      kind: 'steps',
      title: 'Set it up, one screen at a time',
      steps: [
        {
          title: 'Name it and pick a date',
          body: 'Type the event’s name, say what you are celebrating (wedding, birthday, party, gala or a work event) and pick the date, or tick Not sure yet. That one choice sets sensible starting colours, frames and challenge ideas, so nothing starts blank. Rather describe it in a sentence? Use the assistant link on the first screen and the Concierge designs it for you instead.',
          screen: 'setup-basics',
        },
        {
          title: 'Design the welcome page',
          body: 'This is the page guests land on when they scan. Pick a template, a gradient or a single colour, or a photo of your own with a fit tool that shows it on a phone and on the live wall at once. Then add a border and a line of welcome in your own words.',
          tip: 'Use a photo at least 1600 pixels on its long side for the welcome page. The setup warns you if yours will look soft on the live wall.',
          screen: 'setup-welcome',
        },
        {
          title: 'Pick the looks and filters',
          body: 'On Looks, the tabs are Frames, 3D props, Face paint and Effects. Narrow a tab with the occasion menu (wedding, birthday, party and more) and the quick pills, then tap anything to offer it to guests — it goes straight onto the preview so you can see it on a face. Add all or Clear works on whatever is showing. Below that, Filters bundle a whole look into one tap: switch on a ready-made filter, or press Make your own filter, name it, and pick a frame, up to four props, a face paint and an effect, all on one screen. Open with this chooses the filter the booth starts on.',
          tip: 'Want a frame with your names on it? Make a frame with AI in your event’s Looks does it in about a minute — your first 3 are free.',
          screen: 'setup-looks',
        },
        {
          title: 'Add a power-up or two',
          body: 'Power-ups adds gestures that work with every look: a smile showers sparkles and an open mouth pops confetti. Each has a Preview button so you can see it first. They are optional, so Skip for now is always there.',
          screen: 'setup-powerups',
        },
        {
          title: 'Give guests some photo challenges',
          body: `Tap any of the ${GUIDE_COUNTS.starterPackMissions} challenge ideas for your occasion to add it, or write your own. Each one is a little mission worth points, like a toast with your table or a first dance floor shot, and the scores climb the live wall’s leaderboard as guests complete them.`,
          screen: 'setup-challenges',
        },
        {
          title: 'Style your live wall',
          body: 'The live wall is the photo wall on a TV or projector at the event. Start from a style (Beamwall, Aurora, Neon night, Gallery and more), then make it yours: the layout (Grid, Gallery, Scrolling, Carousel or Slideshow), the background (your welcome page, a gradient, a plain colour or your own photo), the photo cards (liquid glass, clean, polaroid or neon, with a glow in any colour), how a new photo arrives (a beam, a sparkle or a reveal) and whether it shows the QR code, a spotlight, the leaderboard and the challenges. The preview beside it is your real live wall with sample photos — press Beam a photo to watch one land.',
          screen: 'setup-livewall',
        },
        {
          title: 'Set up the keepsake',
          body: 'The keepsake is the album every guest gets the morning after. Choose its look, greeting, what guests can save, the music and when it is sent, ending on a Review where Save puts it on your guests’ album.',
          screen: 'setup-keepsake',
        },
        {
          title: 'Launch: check it over and go live',
          body: 'The last screen ticks off every part of your event with an Edit beside each, so anything you skipped is one tap away. Go live is one switch. Until you flip it, the guest link shows a friendly not-yet page, so you can share it in advance without anyone seeing a half-built booth. Open or print has the welcome page, the booth, the live wall and Print signs.',
          screen: 'setup-launch',
        },
        {
          title: 'Take a test photo yourself',
          body: 'Press Take a test photo on your event dashboard’s checklist, or scan your own QR code from the Share tab, and take one real shot on your own handset. This is the single highest-value five minutes you will spend — it catches a frame that crops badly or a prop that is too heavy, while there is still time. Until you go live the booth opens only for you, so sign in on that phone first.',
          tip: 'Test on the phone you will hand to a guest, not just your desktop browser.',
          screen: 'guest-send',
        },
        {
          title: 'Work the checklist',
          body: 'Your event dashboard shows a short list: name it, choose the look, add frames & effects, take a test photo. Each item links straight to the screen that finishes it — frames open Looks — and it ticks itself off as you go. No design skills needed.',
        },
        {
          title: 'Print the signage',
          body: 'The Share kit gives you QR signage and table cards pointing at your welcome page. Print them, put one on every table, and your job on the night is basically done.',
          tip: 'Put a card at the bar and one by the door. Those two spots get scanned more than every table combined.',
        },
      ],
    },
    {
      kind: 'screens',
      title: 'What your guests see',
      blurb: 'The same night from a guest’s phone: scan, try on a look, snap, and send it to the wall.',
      items: [
        { screen: 'guest-welcome', caption: 'They scan your QR and land on your welcome page' },
        { screen: 'guest-frame', caption: 'The booth opens with your frame already on' },
        { screen: 'guest-crown', caption: 'They swipe through your looks and try one on' },
        { screen: 'guest-send', caption: 'One tap sends the photo to the live wall' },
      ],
    },
    {
      kind: 'prose',
      title: 'The brief every assistant reads',
      body: [
        'While you describe the event, the Concierge keeps a short brief: the occasion, who it is for, the colours, the mood, and anything to avoid ("no balloons"). Every AI helper in your event reads it on every turn, so the Copilot (and, with the Studio add-on, the Scene Director) already knows your palette and never suggests the thing you ruled out. Change it any time in your event under Settings, then Branding — the Event brief card has a box for each — and when you tell the Copilot something new about the night, it offers to update the brief too.',
        'Two lines for your guests are written from that brief as well: the welcome line on your guest page, and the opening line of the keepsake email you send after the night. They are written once, when the event is created (or when it goes live, if you skipped the brief), and never rewritten — so anything you change in Branding stays yours.',
      ],
    },
    {
      kind: 'prose',
      title: 'Make the guest page yours',
      screen: 'guest-welcome',
      body: [
        'Your welcome page is the first thing a guest sees after scanning the QR code, and it already looks like the night itself: the background is your live photo wall, tilted and made of glass, with the newest photos beaming onto it as they are taken. Before anyone has snapped, the empty tiles lift and glow and the page says "Time to fill the wall", so the first guest knows they can be the first photo up there. Beside your event’s name sits a preview of the booth, and its shutter is the button that takes them in.',
        'To change how it looks, open your event, go to Settings, then Branding, and find Event page look. Pick a ready-made template, a gradient, a single colour, a photo of your own (the venue, the couple, your logo wall), or one of your booth frames. The phone beside the picker shows what guests get as you click, and nothing changes for them until you press Save look. Reset to default puts it back. The gold line-art look, Gilded, is there if you want it, but it is never chosen for you.',
        'Underneath sits Page border: None, Glow (a thin rim of light that slowly travels round), Glass (a frosted frame), Film strip (sprocket rails down both sides) or Gilded (fine gold lines with corner flourishes). It stays put when you change the look above it.',
        'Want the whole night in one style? Pick a full event theme under Settings, then Branding, then Event theme. A theme dresses everything a guest touches, not just the welcome page: the booth’s buttons and shutter, the send screen, the live wall and its photo cards, the fonts and the main buttons, all in the theme’s own colours. Island Golden Hour is a paper-cut island at sunset — layered hills, the sea, palms and hibiscus in molten gold, copper and verdigris, with the names set in a flowing script. Remove theme puts your previous look back.',
      ],
    },
    {
      kind: 'prose',
      title: 'What guests see in the booth',
      screen: 'guest-more-looks',
      body: [
        'Inside the booth, every look you left switched on sits above the shutter under four tabs: Frames, Props, Paint and Effects. A tab only shows when your event has something in it, and the booth opens on the tab that holds the look already on. Guests tap a tab, swipe its row and tap a look to try it on; the next one always peeks in from the edge so it is obvious there are more. Looks combine, so a frame, a crown, a face paint and an effect can all go on together. Each tab holds one look at a time: picking another prop swaps the prop, and picking another paint swaps the paint.',
        'Beside the shutter is a More looks button. It opens everything at once with the same Frames, Props, Paint and Effects chips, which is the quickest way through a big set. The first time a guest opens the booth they get a one-off nudge to swipe, and never again on that phone.',
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
      to: '/signup',
      blurb: 'One sentence is genuinely enough to start.',
    },
  ],
};

const RUN_THE_NIGHT: GuideDoc = {
  slug: 'run-the-night',
  eyebrow: 'Show night',
  title: 'Run the night like a pro',
  hook: 'Wall on the big screen, moderation set, someone else on the door — and you get to enjoy your own party.',
  minutes: 10,
  hue: '#E879F9',
  cover: 'wall-gallery',
  blocks: [
    {
      kind: 'prose',
      screen: 'wall-gallery',
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
          body: 'Gallery lays every photo out in a grid. Carousel turns a slow 3D ring of them, and a new photo beams straight onto the card at the front. Slideshow gives each one the whole screen in turn. Leaderboard puts the challenge scores up so the room starts competing. Projection mode is the one to use on an actual projector — it drops the interface and goes edge to edge.',
          tip: 'Slideshow reads best on a big screen far from the crowd; Gallery reads best on a TV people can walk up to; Carousel is the one people stop and watch.',
          screen: 'wall-grid',
        },
        {
          title: 'Give the wall its own look',
          body: 'In your event’s Wall tab, open Wall design. Layout sets how the photos fill the screen: Grid, Gallery, Scrolling (rows gliding past in opposite directions), Carousel or Slideshow. Grid comes in 3 × 3, 4 × 4 or 5 × 5 live tiles that turn over one at a time, and you choose how a tile changes: Flip, Fade or Zoom. Backdrop sets what sits behind the photos: your event theme, one of the gradients, a solid colour or an image of your own. Light or dark sets the text, and Auto follows the backdrop you picked. The preview updates as you go, so you can see it before the room does.',
          tip: 'A dark backdrop reads best on a projector; a light one suits a daytime TV in a bright room.',
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
      title: 'What guests can do from their phones',
      body: [
        'Not sure what to wear? The Surprise me tile at the start of the Looks row puts a random frame, prop and effect on in one tap, always a combination that works together.',
        'After a photo is sent, one Save or share button hands guests the real photo or clip. On an iPhone that opens the share sheet, where Save to Photos, Instagram and WhatsApp all sit, and every share carries your event’s name. Find it on the wall opens the live wall on their own photo, and a Mine chip shows just theirs.',
        'Anyone looking at a photo on the wall from their phone can send it a reaction: a heart, a laugh, fire, heart eyes, applause or a party popper. It floats up from that photo on the big screen, so the person in it sees the room cheering.',
      ],
    },
    {
      kind: 'prose',
      title: 'Challenges give people a reason to keep going',
      screen: 'guest-challenges',
      body: [
        'A challenge is a small mission worth points: "get a photo with someone you have never met", "find the couple’s parents". Guests see them in the booth, and the Leaderboard wall mode turns the whole thing into a game.',
        'Guests can tap any mission on the Challenges page and the camera opens already on it. After they send, the Sent screen shows the points they just earned and offers the next mission, one tap back into the camera.',
        'You can also have AI check the photo against the mission before it counts. Worth knowing how that behaves: if the check cannot run — bad wifi, a slow response — it lets the photo through anyway. A guest is never blocked by a hiccup on our side. If the check runs and disagrees, the guest can retake it or post without the challenge tag.',
        'Back in the Challenges tab, every checked mission shows a running score — "12 checked · 9 passed" — and the last few reasons a photo did not pass, so a mission that turns out too strict is easy to spot and soften.',
      ],
    },
    {
      kind: 'prose',
      title: 'Keepsake cards, after the night',
      body: [
        'A keepsake card is a shareable page for one person or one couple. Friends and family add photos and messages to it — up to 8 MB per photo, 60 MB and 20 seconds for a video — and it becomes something worth keeping rather than a folder of files.',
        'Friends who open the link can step into the same AR booth your guests use, with frames, sparkle effects and 3D props that follow their face, and take a photo or record a short video message there. A plain camera is one tap away for older phones.',
        'You don’t have to remember the big day either. Pick a date, a time and the time zone you mean it in, and the card closes, publishes itself and lands in the recipient’s inbox right then. Friends can keep adding messages until it goes.',
        'You choose how it looks, and everyone who opens it sees the same thing. Open a card and find How it arrives. The card style sets how the messages are laid out: Storybook turns page by page, Film strip reads as a reel, Polaroid scatters instant prints with their captions, Carousel spins the photos in a 3D ring, and Constellation sets every photo and video floating in 3D. You can set a default style for the whole event and still change any single card.',
        'Or give it a design: a hand-cut paper scene for the occasion that the recipient taps open, which stays behind the card while they read, drifting gently as they scroll. Garden gate swings wisteria gates open onto a lantern-lit aisle. Balloon bash lifts a wall of balloons off a party. Gala night parts deco doors onto a chandelier ballroom. Owambe draws back woven cloth onto a decorated hall. City lights opens onto a rooftop at night. Moon gate opens a round cut-out onto a lantern garden. Cloud nine parts soft clouds onto a nursery sky. Grand hall opens carved doors onto a graduation hall. Island sunset parts palm leaves onto the sea. Love notes opens a heart in a wall of roses onto a moonlit garden. Festival of lights swings carved doors open onto a lamp-lit courtyard under fireworks. Crescent night opens an arch in a carved lattice onto a lantern-lit courtyard under a new moon. Golden hour lifts gold drapes onto a long table on a hillside at sunset. Jungle party slides a wall of leaves apart onto a party in a sunny clearing. Winter glow opens a frosted arch onto a snowy village. Balloon release lets a wall of balloons go one by one, from the middle out. Showtime gathers red velvet curtains fold by fold onto a spotlit stage. Pop party has the recipient pop a wall of balloons, each one bursting into confetti, onto a candy-bright party. Jewel box has them slide three gold bolts aside before its lacquered doors swing open onto velvet and gems. Deep blue has them turn a brass wheel on a ship’s porthole, which opens onto a sunlit reef. Every opening ends with the design’s own flourish, like petals bursting out of the garden gate or frost melting off the winter window, and some gates break apart as they open: the garden gate into petals, the balloon wall into confetti, the hall doors into gold, while the festival doors and the sunset drapes burn away. Each design opens the way its art suggests. The window-shaped designs (Moon gate, Love notes, Crescent night, Winter glow) open when the recipient traces the shape with a finger; doors, seals and lifting walls open when they press and hold the seal until its ring of light fills; curtains, cloth, leaves and clouds open when they pull them apart. For any design you can also choose Trace their initials in How it arrives: the recipient’s initials hang over the closed scene in its own lettering (gilded, neon, frosted, foil, ribbon, marquee bulbs or pearls) and light up as they trace them. There is always a tap to open instead. A design brings its own colours, and you can keep its opening or go straight to the card. Its tile in How it arrives shows the scene, and Preview plays it.',
        'Then pick the opening: the moment the link opens, before the card itself. Envelope breaks a wax seal and lets the light out. Satin ribbon unties a bow. Grand reveal parts the screen like stage doors onto a card floating in 3D. Paper airplane glides in and unfolds. Stardust gathers glowing particles into the card. Pop-up paper springs up in layers that drift as the phone tilts. Straight to the card skips the moment entirely. Each tile says which occasions it suits. The ones marked 3D need a phone that can draw 3D, and on one that cannot, the envelope plays instead, so nobody misses the moment.',
        'The email that delivers it comes in three styles. Glow is calm and roomy: your title, a glimpse of the photos and one button. Sealed is a closed envelope with a glowing wax seal carrying an initial, and it shows nothing until they open it. Spotlight puts one big photo from the card across the whole email with your title over it. None of them print a greeting or your event’s name, so the title you wrote is the headline. Colours sets whose palette the card and the email wear: Automatic uses your event’s colours when you have set custom branding and the Beamwall look otherwise, Beamwall always uses the soft dusk-blue look, and Event colours always uses yours.',
        'Press Preview to see it full screen, exactly as they will: the opening, then the card, holding every message that is in it so far, even while friends are still adding to it. Flip the opening, the card style and the colours along the bottom and watch it change. Nothing there is saved until you press Use these. Everything else in How it arrives saves the moment you tap it, and you can still change the opening, style and colours after the card has gone out; the next person to open the link sees your new choice.',
        'When it is full you can render it into a short film, which costs around 30 credits. Guests can also bulk-save everything they appear in from their own gallery, so nobody has to ask you for their photos afterwards.',
      ],
    },
    {
      kind: 'prose',
      title: 'After the event',
      body: [
        'When the party is over, hit End on the event. The booth shuts to new photos immediately — anyone who scans the QR after that gets your thank-you screen instead of a camera, so give guests their last call before you press it.',
        'Later, once an old event is just taking up room in Your events, open its ⋯ menu and choose Archive. It slides into a collapsed Archived shelf at the bottom of the page and nothing is deleted — the wall, every photo, the keepsake cards and the credits you spent are all exactly where you left them, and one click brings it back.',
        'Your plan keeps guest photos and videos for a set time, counted from the end of the event: 7 days on Free, 90 days on Essentials, a year on Premium and two years on Deluxe. The Dashboard shows the exact date under Your photos, with a Download everything button that saves the lot as a zip (a big event comes in a few parts). We email you two weeks before anything is removed, and nothing goes without that email.',
      ],
    },
    {
      kind: 'prose',
      title: 'Send everyone the album',
      body: [
        'The album is a public page holding every photo from the night, plus a collage each guest can build and save on their own phone — mosaic, filmstrip or scattered prints, their pick. Their own shots go in first and never get cut.',
        'It has its own QR card in Share & Print, next to the booth and wall ones. That code is the one worth putting in a thank-you message, because unlike the others it keeps working after you end the event — the thank-you screen a late scanner gets now links straight to it.',
        'Getting it into inboxes takes no presses at all. Guests are offered a "Send me the album" box in the booth after they send their first photo — nobody has to fill it in, and nobody is asked twice. The morning after your event (around 10 AM the day after your event date, or 12 hours after you hit End), everyone who left an address gets one email, with an unsubscribe link at the bottom. Nobody else is contacted.',
        'On a paid plan that email opens with a short film of the night, made automatically from the booth photos, and the same film plays at the top of the album page. Want it out sooner, or not at all? Design your keepsake in Share & Print has an Email it the next day switch, and once you have hit End a Send keepsakes now button does it on the spot. Guests who already got it are never sent it twice.',
        'Send yourself a preview first if you want to see exactly what lands. That button works at any stage, including before the doors open, and it touches nothing but your own inbox.',
      ],
    },
    {
      kind: 'prose',
      title: 'Make the album yours',
      screen: 'setup-keepsake',
      body: [
        'Open Share & Print and find Design your keepsake. It is one panel with five steps, Look, Greeting, Take-home, Music and Sending, and the live preview beside them (above them on a phone) shows whatever the step you are on decides. The first time, the editor walks you through each step in order: a tick lands on every step you have seen, Next takes you on to the one after, and a last Review step lists everything you chose, with a Change link beside each line. Once you have seen them all, the steps become tabs you can jump between whenever you like. You can press Save on any step; nothing changes for guests until you do. A small dot marks every step with unsaved changes, and Reset to defaults puts the look and the words back if you change your mind.',
        'Look sets the colours and the opening moment. The theme is the colours: Beamwall (the default, deep night with a warm glow), Golden hour (warm amber), Midnight bloom (inky blue with soft pink), Confetti (bright and playful) and Ivory (light and classic). The opening moment is what guests see when they tap their album link, and the preview plays it in your colours: Beamwall beam (the default, a beam of light sweeping across), Envelope, Satin ribbon, Grand reveal, Paper airplane, Stardust, Pop-up paper, or Straight to the album if you would rather the photos were there the second the link opens.',
        'Greeting is where Beamy, our little crystal mascot, says hello at the top of the album. Write the headline, a short message, a sign-off and the name it is signed by — we fill that in with your organisation’s name to start you off. Tap Event name, Photo count, Guest count, Day or Host to drop in a detail that fills itself in, and the preview shows exactly how it reads. Rather the photos spoke for themselves? Switch Beamy off.',
        'Take-home decides what guests can save: the Film, a Collage they build themselves (filmstrip, mosaic or scattered prints) and the Photos, shown in the preview as the buttons guests will tap. At least one always stays on, because an album with nothing to save is not much of a keepsake. The film comes with paid plans; on Free the switch is kept for when you upgrade.',
        'Music is the soundtrack under the film. Play any track before you choose it: Afterglow (warm and cinematic), Raise a Glass (bright and upbeat), Black Tie (piano and strings), Keep This (soft and sentimental) and Late Set (deep and shimmering for after-parties), or No music. Every track is made by Beamwall and free to use, with no licence fee and no credit to give.',
        'Sending is the next-day email. Leave it on and guests who left an address get their album around 10 AM the day after your event; switch it off and nothing goes out until you press Send keepsakes now.',
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
        {
          label: 'Photos and videos',
          value: 'Unlimited on Premium and up',
          why: 'No cap on how many your guests take. Fair use is up to 2,000 new shots a day per event, more than a big gala takes. Free carries 25 and Essentials 500.',
        },
        {
          label: 'Video clip length',
          value: '30 s · 60 s on Premium · 90 s on Deluxe',
          why: 'Every plan records video, Free included. Longer clips come with the bigger plans, and every clip stays small enough to upload on busy venue wifi.',
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
  // The no-design path first; the two Studio add-on guides last.
  'first-event',
  'run-the-night',
  'make-a-frame',
  'make-3d-props',
  'use-the-studio',
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
  // Distinct real product screens a reader will see (the hub cover is the
  // card's own picture, so it is not counted as something inside).
  const screens = new Set<GuideScreenId>();
  for (const b of doc.blocks) {
    if (b.kind === 'prose' && b.screen !== undefined) {
      screens.add(b.screen);
    } else if (b.kind === 'steps') {
      for (const st of b.steps) if (st.screen !== undefined) screens.add(st.screen);
    } else if (b.kind === 'screens') {
      for (const it of b.items) screens.add(it.screen);
    }
  }
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
  if (screens.size > 1) out.push(`${screens.size} real screens`);
  // Steps are the filler chip: every guide has them, so they only say anything
  // on a card that has nothing rarer to offer.
  if (steps > 0 && out.length < 2) out.push(`${steps} steps`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Feature films — the hub's "Watch it in action" section              */
/* ------------------------------------------------------------------ */

/**
 * The five product films that used to sit in the homepage's film section.
 * Their media is the SAME bundled files (src/assets/landing/*-feature.*, wired
 * in guidesMedia.FEATURE_FILM_MEDIA), so a re-render reaches both pages.
 *
 * The words are copied in rather than imported: this module stays import-free
 * (see the header), and the homepage is free to retire its own copy without
 * breaking the guides. They read the same as the homepage did on the day they
 * moved: brandLanding FILMS for the first four, beamyVirtual VC_FILM for the
 * fifth. The celebrations line is held to beamyVirtual's AUTO_DELIVERY_RE in
 * guidesContent.test.ts. The film itself ends on the host pressing "Send", and
 * nothing may promise automatic delivery while that does not exist.
 */
export type FeatureFilmId = 'booth' | 'wall' | 'challenges' | 'cards' | 'celebrations';

export interface FeatureFilm {
  id: FeatureFilmId;
  /** The short tile label. */
  eyebrow: string;
  title: string;
  /** ONE line. The film carries the detail as in-video callouts, so the copy
   *  never pre-states it. */
  hook: string;
  /** Tile accent, from the guides' own spectrum. */
  hue: string;
}

export const FEATURE_FILMS_COPY = {
  eyebrow: 'Watch it in action',
  title: 'Five short films, one for every part of the night',
  blurb:
    'From the first scan to the keepsake everyone takes home. Each one is under half a minute and plays muted, so pick one and watch it right here.',
} as const;

export const FEATURE_FILMS: readonly FeatureFilm[] = [
  {
    id: 'booth',
    eyebrow: 'Photo booth',
    title: 'A photo booth that lives in every pocket',
    hook: 'One scan drops every guest into a magical booth, right in their browser.',
    hue: '#FB923C',
  },
  {
    id: 'wall',
    eyebrow: 'Live photo wall',
    title: 'Every shot beams onto the wall',
    hook: 'The moment a photo lands, the whole room turns to look.',
    hue: '#22D3EE',
  },
  {
    id: 'challenges',
    eyebrow: 'Challenges',
    title: 'Turn the room into the game',
    hook: 'Give guests a mission, and watch every table race to beat it.',
    hue: '#34D399',
  },
  {
    id: 'cards',
    eyebrow: 'Digital keepsakes',
    title: 'The morning-after keepsake',
    hook: 'Long after the lights go up, everyone still has a piece of the night.',
    hue: '#E879F9',
  },
  {
    id: 'celebrations',
    eyebrow: 'Celebrations',
    title: 'Celebrate together, from anywhere',
    hook: 'One link gathers notes, photos and videos from friends everywhere onto one card.',
    // Lighter than the 3D-props guide's #7C6CF7, which reads at ~2.9:1 as
    // 10px label text on the purple page; this is ~6:1.
    hue: '#C4B5FD',
  },
];

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
    studio: { guide: 'use-the-studio', note: 'What each tab is for — Studio (add-on); the 2D/3D/Preview split and the editor hotspots.' },
    experiences: { guide: 'make-a-frame', note: 'Four ways to get your frame — Pick a ready-made one and Make one with AI, both in the Looks tab.' },
    assets: { guide: 'make-a-frame', note: 'Four ways to get your frame — the Studio add-on upload path, and the frame-or-sticker chip.' },
    wall: { guide: 'run-the-night', note: 'Set up the wall — the five modes (Gallery, Carousel, Slideshow, Leaderboard, Projection), Give the wall its own look (Wall design: layouts incl. Grid 3/4/5, transitions, backdrops, light or dark) and the projector link.' },
    challenges: { guide: 'run-the-night', note: 'Challenges give people a reason to keep going, including the AI photo check and its checked/passed counts.' },
    cards: { guide: 'run-the-night', note: 'Keepsake cards, after the night — How it arrives: the ten illustrated designs, the card styles (Storybook, Film strip, Polaroid, Carousel, Constellation), the seven openings, the three email styles, Colours and the full-screen Preview; contribution limits and the film render.' },
    share: { guide: 'first-event', note: 'Five steps to a live booth — Print the signage (QR kit).' },
  },
  hostNav: {
    events: { guide: 'first-event', note: 'Five steps to a live booth — creating and going live with an event.' },
    concierge: { guide: 'first-event', note: 'Describe your event — the Concierge designs from a sentence or a photo, "Set it all up for me", the starter pack, and the brief every assistant reads.' },
    billing: { guide: 'run-the-night', note: 'What things cost — the credit table covers what billing buys.' },
    support: { guide: 'use-the-studio', note: 'Worth knowing early — the Copilot (which can open a support message for you), and where help lives on every host screen.' },
  },
  addOns: {
    'power-fx': { guide: 'make-3d-props', note: 'Make it react — Power FX pairs a prop like the visor with a gesture-fired blast.' },
    'name-jewelry': { guide: 'make-3d-props', note: 'Make it react — 3D Name Jewelry builds a necklace, earrings or floating text from a name.' },
    'face-paint': { guide: 'make-3d-props', note: 'Make it react — Face Paint puts a living look or your logo on the guest\'s skin.' },
    contacts: { guide: 'make-3d-props', note: 'Make it react — Coloured Contacts puts a lens on each of the guest\'s eyes.' },
  },
  helpTopics: {
    library: { guide: 'make-a-frame', note: 'Four ways to get your frame — the library, uploads and AI Frame Studio.' },
    modes: { guide: 'use-the-studio', note: 'What each tab is for — Studio; 2D, 3D and Preview are one scene.' },
    director: { guide: 'first-event', note: 'Describe your event — the AI designs the whole scene, you keep what you like.' },
    triggers: { guide: 'make-3d-props', note: 'Make it react — the gesture cues, the actions and the per-scene cap.' },
  },
  featureKeys: {
    maxPosts: { guide: 'run-the-night', note: 'What things cost — how many photos a plan carries.' },
    videoMaxSec: { guide: 'run-the-night', note: 'What things cost — video clip length per plan (30 / 60 / 90 seconds).' },
    videoEnabled: { guide: 'make-3d-props', note: 'Put a crown on every guest — video capture is what makes a reacting prop worth having.' },
    watermark: { guide: 'run-the-night', note: 'What things cost — paid plans remove the Beamwall signature from guest photos.' },
    aiStudio: { guide: 'make-a-frame', note: 'Describe it to AI Frame Studio, and the credit table in run-the-night.' },
    cardsStandard: { guide: 'run-the-night', note: 'Keepsake cards, after the night — contributing photos and messages.' },
    cardsPremiumRender: { guide: 'run-the-night', note: 'Keepsake cards / What things cost — the ≈30-credit film render.' },
    projectionMode: { guide: 'run-the-night', note: 'Set up the wall — Projection mode for an actual projector.' },
    retentionDays: { guide: 'run-the-night', note: 'After the event — how long each plan keeps photos, the Dashboard date, Download everything and the reminder email.' },
    studio: { guide: 'use-the-studio', note: 'Opening prose — the Studio and Assets tabs are an add-on for teams and large organisations; every host gets Looks.' },
  },
};
