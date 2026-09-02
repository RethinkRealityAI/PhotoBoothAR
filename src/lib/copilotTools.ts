/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Platform Copilot's tool registry — the SINGLE source of truth for what
 * each tool is, when to call it, and what every parameter means.
 *
 * Three consumers read it so they cannot drift from each other:
 *   • the server prompt's `# Tools` section (rendered by renderToolsSection and
 *     written to supabase/functions/ai-event-designer/tools.generated.ts by
 *     scripts/gen-agent-tools.ts — a drift test fails CI when they diverge);
 *   • the client: TOOL_LABELS (copilot.ts), required-param gaps
 *     (proposalGaps.ts) and confirm-card headings (copilotSurfaces.ts);
 *   • copilotTools.test.ts, which round-trips every `example` through
 *     normalizeActions / proposalGaps / buildProposalSurface.
 *
 * `satisfies Record<CopilotAction['tool'], ToolSpec>` makes union↔registry
 * exhaustiveness a tsc check: add a tool to the union without describing it
 * here (or vice versa) and `npm run lint` fails.
 *
 * PURE: type-only import from ./copilot (copilot.ts imports runtime values
 * from here — a runtime import back would be a cycle). Credit numbers come
 * from sceneDirector's constants, never typed out here.
 */
import type { CopilotAction } from './copilot';
import { FRAME_CREDIT_COST, GENERATE_3D_CREDIT_COST } from './studio/sceneDirector';

export interface ToolParam {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array';
  required: boolean;
  /** Action-oriented: what to put here and how to normalise it. */
  description: string;
  /** A concrete value, shown to the model as `e.g. …`. */
  example: string;
  enum?: readonly string[];
  /** Host-facing ask when a REQUIRED field is empty on the confirm card
   *  (proposalGaps): the question in the host's own terms and an example a
   *  person would type. Absent → proposalGaps falls back to the description. */
  ask?: { question: string; example: string };
}

export interface ToolSpec {
  name: CopilotAction['tool'];
  /** Host-facing name: the confirm card's heading and the failure line. */
  label: string;
  /** What the tool does — one sentence, sentence case. */
  description: string;
  /** When the model should call it. */
  whenToUse: string;
  /** When it must NOT be called (a sibling tool covers that case). */
  whenNotToUse?: string;
  params: Record<string, ToolParam>;
  /** What it costs the host, or null when free / read-only. */
  costNote: string | null;
  /** true → the host reviews a confirm card before anything runs. */
  confirm: boolean;
  /** true → reads only; runs without a card. */
  readOnly: boolean;
  /** A raw proposal (tool key excluded) that MUST survive normalizeActions and
   *  leave proposalGaps empty — copilotTools.test.ts proves it. */
  example: Record<string, unknown>;
  /** Extra one-rule-per-line guidance rendered under the parameters. Each
   *  entry is one explicit instruction; keep every line under ~300 chars. */
  rules?: readonly string[];
}

/** A registry entry whose `example` is typed loosely on purpose: the value is
 *  untrusted model-shaped input, exactly what normalizeActions consumes. */
const CHALLENGE_PARAMS = {
  title: {
    type: 'string', required: true,
    description: 'A short punchy name you write for the mission (2-6 words), never the host\'s whole sentence.',
    example: 'Best dance move',
    ask: { question: 'What should the challenge be called?', example: 'Best dance move' },
  },
  emoji: {
    type: 'string', required: false,
    description: 'One emoji that sells the mission; omit to get ⭐.',
    example: '💃',
  },
  points: {
    type: 'number', required: false,
    description: 'Points a completed photo earns, 0-1000; only when the host stated them, else omit (default 10).',
    example: '20',
  },
  description: {
    type: 'string', required: false,
    description: 'The guest instruction as one full sentence.',
    example: 'Show us your best move on the dance floor.',
  },
  validationPrompt: {
    type: 'string', required: false,
    description: 'Turns on an AI photo-check: ONE sentence saying what a guest\'s photo must visibly contain. Set it whenever the mission implies a visual test; omit for open-ended fun missions.',
    example: 'At least one person clearly wearing red clothing is visible',
  },
} satisfies Record<string, ToolParam>;

export const COPILOT_TOOLS = {
  generate_frame: {
    name: 'generate_frame',
    label: 'Design a signature frame',
    description: 'AI-generate a NEW custom 9:16 booth frame from a described look.',
    whenToUse: 'Use whenever the host wants a personalised flat 2D frame, border, overlay or sticker for THEIR event, or "one like <a built-in>" re-themed for this event.',
    whenNotToUse: 'a 3D model or prop request (that is add_head_piece), or a quick standard frame (add_frame).',
    params: {
      prompt: {
        type: 'string', required: true,
        description: 'The brief, written by you as an art director — never the host\'s words unchanged, never under 6 words. Name (1) a concrete style or era, (2) the palette (reuse the event\'s colours when known), (3) a specific motif, (4) the layout archetype and where the faces go.',
        example: 'art-deco sunburst corners in brass on matte black, centre clear for faces',
      },
      lettering: {
        type: 'object', required: false,
        description: 'Real words on the frame: { text, style, placement } (the three rules below). Omit the whole key for a wordless frame; never invent a name, and never add a date or hashtag the host did not give you.',
        example: '{ "text": "Maya & Sam", "style": "script-name", "placement": "bottom" }',
      },
      provider: {
        type: 'enum', required: false, enum: ['gemini', 'higgsfield'],
        description: 'Which image model paints it; omit unless the host named one. gemini is the platform path, higgsfield costs 2 credits or the org\'s connected account.',
        example: 'gemini',
      },
    },
    costNote: `The first 3 frames on an event are free, then ${FRAME_CREDIT_COST} credit each (Higgsfield: 2 credits, or free on the org's own connected account).`,
    confirm: true,
    readOnly: false,
    example: { prompt: 'art-deco sunburst corners in brass on matte black, fine chevron rules thinning along the long edges, centre clear for faces' },
    rules: [
      'Name the layout archetype in the prompt itself — the image pipeline reads the layout from those words. The four archetypes are the next four lines.',
      'EDGE BORDER: "ornament hugging the edges, centre fully clear for faces".',
      'FULL-SCENE FRAME: "full-bleed scene with a head cutout" — a complete illustrated environment filling the 9:16 canvas with ONE or TWO face-sized openings the guests\' faces fill; this is the one for "put my guests inside a scene".',
      'CORNER-WEIGHTED: "heavier in two opposite corners, thinning along the edges".',
      'BOTTOM BANNER: "lower-third stage, upper two-thirds clear".',
      'Bad briefs: "gold frame", "elegant border", "nice wedding frame" — they produce generic art and cost the host a credit.',
      'lettering.text is what to spell, 1-40 characters, exactly as it should read.',
      'lettering.style is one of cursive-monogram | serif-initials | script-name | modern-block.',
      'lettering.placement is one of top | bottom | integrated (woven into the ornament) | beyond-edge (overflowing past the frame) | standalone (name art ONLY, no frame around it).',
      'Ask before lettering: when the brief or the event data names an event, an honoree, couple or guest of honour, or a logo, and the host has not said what they want on the frame, propose nothing ("[]") and ask ONE question laying out the choices.',
      'The lettering choices to lay out: lettering on the frame (cursive monogram · serif initials · script name · modern block; top, bottom, woven in, or overflowing the edge), name art only with no frame, or no lettering at all.',
      'Ask about lettering once; a partial answer or "you pick" means choose confidently and propose. If the host already said what they want on it, do not ask — set lettering.',
    ],
  },
  add_frame: {
    name: 'add_frame',
    label: 'Add a ready-made frame',
    description: 'Add a ready-made, event-neutral built-in frame as-is.',
    whenToUse: 'Use when the host wants a quick standard frame rather than a custom one.',
    whenNotToUse: 'a described look or a personalised frame (generate_frame).',
    params: {
      borderId: {
        type: 'string', required: true,
        description: 'Exactly one of the frame ids listed under # Catalogs; never invent an id.',
        example: 'dw-frame-classic',
        ask: { question: 'Which ready-made frame?', example: 'pick one from the list' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { borderId: 'dw-frame-classic' },
  },
  set_filter: {
    name: 'set_filter',
    label: 'Add a booth filter',
    description: 'Apply a whole-booth colour filter and set it as the booth default.',
    whenToUse: 'Use when the host asks for a filter, a colour treatment or a mood over the whole booth.',
    params: {
      shaderId: {
        type: 'string', required: true,
        description: 'Exactly one of the filter ids listed under # Catalogs; never invent an id.',
        example: 'champagne-sparkle',
        ask: { question: 'Which filter?', example: 'pick one from the list' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { shaderId: 'champagne-sparkle' },
  },
  add_head_piece: {
    name: 'add_head_piece',
    label: 'Add a 3D prop',
    description: 'Add a real face-tracked 3D model — any prop worn or held near the face (hat, crown, glasses, mask, jewelry, trophy).',
    whenToUse: 'Use for EVERY text-to-3D request and anything mentioning "3D", "model", "prop" or an object to wear or hold.',
    whenNotToUse: 'a flat frame, border, overlay or sticker (generate_frame / add_frame), or names and dates to wear (see the rules).',
    params: {
      source: {
        type: 'enum', required: true, enum: ['builtin', 'generate'],
        description: '"builtin" adds a free catalog piece by pieceId; "generate" sculpts a new one from prompt.',
        example: 'generate',
      },
      pieceId: {
        type: 'string', required: false,
        description: 'With source "builtin": exactly one of the 3D piece ids listed under # Catalogs.',
        example: 'royal-crown',
        ask: { question: 'Which 3D prop?', example: 'pick one from the list' },
      },
      prompt: {
        type: 'string', required: false,
        description: 'With source "generate": the brief for ONE 3D object, written by you and never under 6 words — (1) what it physically IS, (2) its material or colour, (3) one distinguishing detail. Describe the LOOK, never the geometry (hollow, wall thickness, openings).',
        example: 'a venetian masquerade mask in brushed gold with peacock feathers along the brow',
      },
    },
    costNote: `Built-in pieces are free. A generated piece costs ~${GENERATE_3D_CREDIT_COST + FRAME_CREDIT_COST} credits (a concept image then a 3D model) and takes minutes.`,
    confirm: true,
    readOnly: false,
    example: { source: 'generate', prompt: 'a venetian masquerade mask in brushed gold with peacock feathers along the brow' },
    rules: [
      'Pick source "builtin" with a catalog pieceId for speed; source "generate" with a brief for a custom piece or "one like <X>".',
      'Think beyond hats: jewelry (nose rings, septum pieces, ear cuffs, chandelier earrings), face gems and stickers, monocles, veils, laurel wreaths, masks — suggest the piece that sells the idea, not the obvious crown.',
      'Bad briefs: "a mask", "something cool".',
      'Names, dates or short slogans the host wants to WEAR or float beside them: do NOT generate them. Point them to the FREE "3D Name Jewelry" builder in My Assets (wearable 3D text, no credits) — a place in the app, not a tool you can call; never invent an action for it.',
      'If you cannot name all three (object, material, detail) from what the host said, ask ONE question instead of proposing.',
    ],
  },
  set_default_experience: {
    name: 'set_default_experience',
    label: 'Set the booth default',
    description: 'Make an EXISTING experience the one the booth opens with.',
    whenToUse: 'Use when the host wants a frame, filter or prop they already have to be the default look.',
    params: {
      experienceId: {
        type: 'string', required: true,
        description: 'The id copied EXACTLY from the EXPERIENCES list in the current event data.',
        example: 'exp-1',
        ask: { question: 'Which experience should the booth open with?', example: 'one of the experiences in your studio' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { experienceId: 'exp-1' },
  },
  set_event_date: {
    name: 'set_event_date',
    label: 'Update the event date',
    description: 'Change the event date.',
    whenToUse: 'Use when the host states or changes the date.',
    params: {
      date: {
        type: 'string', required: true,
        description: 'The event date as YYYY-MM-DD. Normalise whatever the host said.',
        example: '2026-07-12',
        ask: { question: 'What date is the event?', example: '2026-09-12' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { date: '2026-07-12' },
  },
  rename_event: {
    name: 'rename_event',
    label: 'Rename the event',
    description: 'Rename the event.',
    whenToUse: 'Use when the host wants a different event name.',
    params: {
      name: {
        type: 'string', required: true,
        description: 'The new event name, up to 80 characters.',
        example: 'Maya & Sam’s Wedding',
        ask: { question: 'What should the event be called?', example: 'Maya & Sam’s Wedding' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { name: 'Maya & Sam’s Wedding' },
  },
  add_challenge: {
    name: 'add_challenge',
    label: 'Add a photo challenge',
    description: 'Add one photo mission guests complete for points.',
    whenToUse: 'Use when the host asks for a single challenge, mission or scavenger item.',
    whenNotToUse: 'three or more at once (add_challenge_pack).',
    params: CHALLENGE_PARAMS,
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { title: 'Best dance move', emoji: '💃', points: 20, description: 'Show us your best move on the dance floor.' },
  },
  add_challenge_pack: {
    name: 'add_challenge_pack',
    label: 'Add a challenge pack',
    description: 'Add a themed set of 3-6 photo missions in one go.',
    whenToUse: 'Use when the host asks for several challenges, a set, a pack or "some missions".',
    whenNotToUse: 'a single mission (add_challenge).',
    params: {
      theme: {
        type: 'string', required: false,
        description: 'The pack\'s theme in 2-5 words; omit to get "Challenge pack".',
        example: 'Wedding reception',
      },
      challenges: {
        type: 'array', required: true,
        description: '3-6 entries, each shaped like add_challenge (title, emoji?, points?, description?, validationPrompt?).',
        example: '[{ "title": "First dance", "emoji": "💃", "points": 20 }, …]',
        ask: { question: 'What should the challenges be?', example: 'a five-challenge pack for a wedding reception' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: {
      theme: 'Wedding reception',
      challenges: [
        { title: 'First dance', emoji: '💃', points: 20 },
        { title: 'Cake moment', emoji: '🍰', points: 15 },
        { title: 'Group toast', emoji: '🥂', points: 10 },
      ],
    },
  },
  update_challenge: {
    name: 'update_challenge',
    label: 'Edit a challenge',
    description: 'Change an existing challenge\'s title, emoji, points or active state.',
    whenToUse: 'Use when the host wants to rename, re-point, pause or resume a challenge that is in the current event data.',
    params: {
      challengeId: {
        type: 'string', required: true,
        description: 'The id copied EXACTLY from the CHALLENGES list in the current event data.',
        example: 'ch-1',
        ask: { question: 'Which challenge do you mean?', example: 'the name of the one you want to change' },
      },
      title: { type: 'string', required: false, description: 'A new short title, only if it changes.', example: 'Best dance move' },
      emoji: { type: 'string', required: false, description: 'A new emoji, only if it changes.', example: '🕺' },
      points: { type: 'number', required: false, description: 'New points, 0-1000, only if they change.', example: '30' },
      active: { type: 'boolean', required: false, description: 'false pauses the challenge, true resumes it.', example: 'true' },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { challengeId: 'ch-1', points: 30 },
  },
  delete_challenge: {
    name: 'delete_challenge',
    label: 'Delete a challenge',
    description: 'Permanently remove a challenge (completed posts keep their points).',
    whenToUse: 'Use only when the host clearly asks to remove a challenge that is in the current event data.',
    params: {
      challengeId: {
        type: 'string', required: true,
        description: 'The id copied EXACTLY from the CHALLENGES list in the current event data.',
        example: 'ch-1',
        ask: { question: 'Which challenge do you mean?', example: 'the name of the one you want to change' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { challengeId: 'ch-1' },
  },
  create_card: {
    name: 'create_card',
    label: 'Create a greeting card',
    description: 'Create a collaborative greeting card guests contribute to.',
    whenToUse: 'Use when the host wants a keepsake card, a group card or messages collected for someone.',
    params: {
      cardTitle: {
        type: 'string', required: true,
        description: 'A short card title you write (2-6 words).',
        example: 'Happy 40th, Maya!',
        ask: { question: 'What should the card be called?', example: 'Happy 40th, Maya!' },
      },
      recipientName: { type: 'string', required: false, description: 'Who the card is for, when the host named them.', example: 'Maya' },
      cardTemplate: {
        type: 'enum', required: false, enum: ['storybook', 'filmstrip'],
        description: 'The card layout; omit for storybook.',
        example: 'storybook',
      },
      deadline: {
        type: 'string', required: false,
        description: 'Contribution deadline as YYYY-MM-DD, only if the host stated one.',
        example: '2026-07-10',
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { cardTitle: 'Happy 40th, Maya!', recipientName: 'Maya' },
  },
  go_live: {
    name: 'go_live',
    label: 'Take your event live',
    description: 'Take the event live so anyone with the link can take pictures and post to the wall.',
    whenToUse: 'Propose ONLY when the host explicitly asks to go live, open or launch.',
    params: {},
    costNote: null,
    confirm: true,
    readOnly: false,
    example: {},
  },
  test_experience: {
    name: 'test_experience',
    label: 'Test the booth',
    description: 'Show a QR code and link to test the booth on a phone.',
    whenToUse: 'Use when the host wants to try, preview or test the booth.',
    params: {},
    costNote: null,
    confirm: false,
    readOnly: true,
    example: {},
  },
  get_stats: {
    name: 'get_stats',
    label: 'Event stats',
    description: 'Read the live numbers — wall posts, challenges, experiences, cards.',
    whenToUse: 'Use when the host asks how the event is doing or for any count.',
    params: {},
    costNote: null,
    confirm: false,
    readOnly: true,
    example: {},
  },
  share_links: {
    name: 'share_links',
    label: 'Share links',
    description: 'Show the guest-surface links and QR codes (booth, wall, welcome).',
    whenToUse: 'Use when the host asks for the link, the QR code or how guests join.',
    params: {},
    costNote: null,
    confirm: false,
    readOnly: true,
    example: {},
  },
  open_scene_director: {
    name: 'open_scene_director',
    label: 'Open the Scene Director',
    description: 'Hand off to the studio Scene Director, which designs a WHOLE coordinated look — frame, filter and 3D piece together — from one brief.',
    whenToUse: 'Use when the host wants the whole look at once, says "design the scene", "the whole vibe" or "put my guests inside a <world> and add a filter".',
    whenNotToUse: 'a single frame, filter or prop request — each has its own tool.',
    params: {
      brief: {
        type: 'string', required: true,
        description: 'The scene brief for the Director, 6-600 characters: the world, the palette and the mood, in the host\'s intent.',
        example: 'a moonlit jungle at a 1920s garden party — emerald and brass, soft golden haze, guests peeking through vines',
        ask: { question: 'What should the whole scene feel like?', example: 'a moonlit jungle garden party in emerald and brass' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { brief: 'a moonlit jungle at a 1920s garden party — emerald and brass, soft golden haze, guests peeking through vines' },
  },
  contact_support: {
    name: 'contact_support',
    label: 'Contact support',
    description: 'Hand the host to a human: opens the support dialog pre-filled with a summary.',
    whenToUse: 'Use when a tool has failed twice for the same request, the host asks for a human, or the request is billing, account or legal — or otherwise has no tool AND no studio tab.',
    params: {
      summary: {
        type: 'string', required: true,
        description: 'What support should know, up to 600 characters: what the host wanted, what was tried, what happened.',
        example: 'Host asked to add a challenge twice; both attempts failed with a permission error on event maya-sam.',
        ask: { question: 'What should support know?', example: 'what you were trying to do and what happened' },
      },
    },
    costNote: null,
    confirm: true,
    readOnly: false,
    example: { summary: 'Host asked to add a challenge twice; both attempts failed with a permission error on event maya-sam.' },
  },
} satisfies Record<CopilotAction['tool'], ToolSpec>;

export const TOOL_NAMES = Object.keys(COPILOT_TOOLS) as ReadonlyArray<CopilotAction['tool']>;

/** `{ title, emoji?, points? }` — the signature the model sees on the tool line. */
function paramSignature(params: Record<string, ToolParam>): string {
  const names = Object.entries(params).map(([n, p]) => (p.required ? n : `${n}?`));
  return names.length > 0 ? `{ ${names.join(', ')} }` : '{}';
}

/**
 * The prompt's `# Tools` section. One tool per line, then one line per
 * parameter (`  · name (type, required|optional): description e.g. example`)
 * and one line per extra rule. Sentence case, one explicit action per line.
 */
export function renderToolsSection(tools: Record<string, ToolSpec> = COPILOT_TOOLS): string {
  const lines: string[] = ['# Tools'];
  for (const spec of Object.values(tools)) {
    const head = `- ${spec.name} ${paramSignature(spec.params)} — ${spec.description} ${spec.whenToUse}`;
    lines.push(spec.whenNotToUse ? `${head} Not for: ${spec.whenNotToUse}` : head);
    for (const [name, p] of Object.entries(spec.params)) {
      const type = p.type === 'enum' && p.enum ? p.enum.join(' | ') : p.type;
      lines.push(`  · ${name} (${type}, ${p.required ? 'required' : 'optional'}): ${p.description} e.g. ${p.example}`);
    }
    if (spec.costNote) lines.push(`  · Cost: ${spec.costNote}`);
    for (const rule of spec.rules ?? []) lines.push(`  - ${rule}`);
  }
  return lines.join('\n');
}

/**
 * The generated Deno-side module (supabase/functions/ai-event-designer/
 * tools.generated.ts). Written by scripts/gen-agent-tools.ts; the drift test
 * re-renders and compares, so edits go here, never in the generated file.
 */
export function renderToolsGeneratedFile(tools: Record<string, ToolSpec> = COPILOT_TOOLS): string {
  return (
    '// @generated by scripts/gen-agent-tools.ts from src/lib/copilotTools.ts — DO NOT EDIT; run npm run gen:agent-tools\n' +
    `export const TOOLS_SECTION: string = ${JSON.stringify(renderToolsSection(tools))};\n` +
    `export const TOOL_NAMES = ${JSON.stringify(Object.keys(tools))} as const;\n`
  );
}
