/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure A2UI builders for the Platform Copilot. The model only ever PROPOSES
 * typed actions — these trusted builders turn each proposal into a
 * preview-first confirm card (editable fields bound to /proposal/*), and
 * tool results into stat rows / link grids. Zero React or supabase imports:
 * everything here runs under the vitest node env.
 */
import { A2UI_VERSION, BEAMWALL_CATALOG_ID, type A2uiComponent, type A2uiMessage } from './a2ui';
import type { CopilotAction } from './copilot';
import { COPILOT_TOOLS } from './copilotTools';
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECES } from './headPieces';
import { GENERIC_FRAMES } from './borders';
import { frameBriefGaps, gapSummary, pieceBriefGaps } from './assetBrief';
import { providerCostLabel } from './providerPricing';
import type { EventSnapshot } from './eventSnapshot';
import type { EventBrief } from './eventBrief';

const FILTER_OPTIONS = FILTER_SHADERS.filter((s) => s.id !== 'none').map((s) => ({ label: s.name, value: s.id }));

/** Emoji tiles for the built-in 3D pieces (the catalog carries no thumbnails;
 *  a ThumbPicker needs SOMETHING to show besides the label). */
const PIECE_EMOJI: Record<string, string> = {
  'royal-crown': '👑', 'queen-tiara': '👸', 'cheek-stars': '✨', 'hope-halo': '😇', 'neon-shades': '🕶️', 'cyclops-visor': '🥽',
};
const PIECE_THUMBS = HEAD_PIECES.map((p) => ({ value: p.id, label: p.name, emoji: PIECE_EMOJI[p.id] ?? '🎭' }));
/** `frameId` lets the renderer draw the real SVG (toDataUrl at render time —
 *  no SVG bytes persist in the surface data model). */
const FRAME_THUMBS = GENERIC_FRAMES.map((f) => ({ value: f.id, label: f.name, frameId: f.id }));

/** What a proposal card may read from the live event to show BEFORE → AFTER
 *  (Diff rows) — the snapshot slice the chat already holds. Optional so every
 *  existing caller keeps its id-only rendering. */
export interface ProposalContext {
  snapshot?: EventSnapshot | null;
}

/** One `Diff` row: `after` may be a `{ path }` binding so it tracks edits. */
interface DiffRow { label: string; before: string; after: string | { path: string } }

function diff(id: string, rows: DiffRow[]): A2uiComponent {
  return { id, component: 'Diff', rows };
}

function divider(id: string): A2uiComponent {
  return { id, component: 'Divider', axis: 'horizontal' };
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function surface(
  surfaceId: string,
  dataModel: Record<string, unknown>,
  components: A2uiComponent[],
): A2uiMessage[] {
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: BEAMWALL_CATALOG_ID } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: '/', value: dataModel } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/** Cancel + confirm buttons; confirm resolves /proposal at click time. */
function confirmRow(confirmLabel: string): { ids: string[]; components: A2uiComponent[] } {
  return {
    ids: ['actionsRow'],
    components: [
      { id: 'actionsRow', component: 'Row', justify: 'end', children: ['cancelBtn', 'confirmBtn'] },
      {
        id: 'cancelBtn', component: 'Button', variant: 'borderless', child: 'cancelLabel',
        action: { event: { name: 'cancel_action', context: {} } },
      },
      { id: 'cancelLabel', component: 'Text', text: 'Dismiss' },
      {
        id: 'confirmBtn', component: 'Button', variant: 'primary', child: 'confirmLabel',
        action: { event: { name: 'confirm_action', context: { proposal: { path: '/proposal' } } } },
      },
      { id: 'confirmLabel', component: 'Text', text: confirmLabel },
    ],
  };
}

/* ── Brief hints ─────────────────────────────────────────────────────────
 * A generation card used to say the same thing whatever the brief was, so a
 * card offering to spend a credit on "gold" looked identical to one with a
 * real brief. These name what is still missing, in the caption, before the
 * host spends anything.
 *
 * The caption is only half of it: CopilotChat's confirm handler runs
 * proposalGaps() on the CURRENT (host-edited) field values and asks the
 * question instead of generating. It asks once for a vague brief and every
 * time for an absent one — see src/lib/proposalGaps.ts. */

function frameHint(prompt: unknown): string {
  const brief = typeof prompt === 'string' ? prompt : '';
  const gaps = frameBriefGaps(brief);
  const base = 'Generated at 9:16 with a clear centre for faces. Your first 3 frames are free.';
  const summary = gapSummary(gaps);
  return summary ? `${summary} I’ll check before spending anything. ${base}` : base;
}

function pieceHint(prompt: unknown): string {
  const brief = typeof prompt === 'string' ? prompt : '';
  const gaps = pieceBriefGaps(brief);
  const base = 'A head-worn 3D piece from your description (~11 credits — a concept image then a 3D model).';
  const summary = gapSummary(gaps);
  return summary ? `${summary} I’ll check before spending anything. ${base}` : base;
}

function textField(id: string, label: string, path: string): A2uiComponent {
  return { id, component: 'TextField', label, value: { path } };
}

/** Card heading — the tool's registry label, so the card, the failure line
 *  and the prompt all call the tool the same thing. */
function heading(tool: CopilotAction['tool'], suffix = ''): A2uiComponent {
  return { id: 'heading', component: 'Text', text: `${COPILOT_TOOLS[tool].label}${suffix}`, variant: 'h5' };
}

/* ── Frame lettering (the "put our names on it" choice) ───────────────────
 * Hosts do not know what "beyond-edge" means, and a wall of radio labels does
 * not tell them — so the card SHOWS the four looks. The thumbnails are
 * vendored to /samples/lettering/ (scripts/remote-assets.json); the renderer
 * hides any that 404, so the card degrades to plain labelled pickers rather
 * than a row of broken-image icons. */

const LETTERING_STYLE_OPTIONS = [
  { label: 'Cursive monogram', value: 'cursive-monogram' },
  { label: 'Serif initials', value: 'serif-initials' },
  { label: 'Script name', value: 'script-name' },
  { label: 'Modern block', value: 'modern-block' },
];

const LETTERING_PLACEMENT_OPTIONS = [
  { label: 'Bottom of the frame', value: 'bottom' },
  { label: 'Top of the frame', value: 'top' },
  { label: 'Woven into the art', value: 'integrated' },
  { label: 'Overflowing the edge', value: 'beyond-edge' },
  { label: 'Name art only — no frame', value: 'standalone' },
];

/* ── Frame provider (which model paints it, and what it costs) ────────────
 * Labelled with the PRICE, not the vendor's marketing name, because that is the
 * only part of the choice a host can act on. The Higgsfield label says "or your
 * connected account" because an org that brought its own key (providerKeys.ts)
 * pays Higgsfield directly and spends ZERO platform credits — the card must not
 * imply a charge that will not happen.
 *
 * The numbers come from providerPricing (a `null` status = the platform price,
 * which is what a card with no key read can honestly quote) rather than being
 * typed out here — CopilotChat's cost caption below the card reads the same
 * function, and the two disagreeing is exactly audit F4. */
const PROVIDER_OPTIONS = [
  { label: `Beamwall AI (${providerCostLabel('gemini', null)})`, value: 'gemini' },
  { label: `Higgsfield (${providerCostLabel('higgsfield', null)} · or your connected account)`, value: 'higgsfield' },
];

/** [sample id, caption] for the visual legend, in style/placement order. */
const LETTERING_SAMPLES: [string, string][] = [
  ['cursive-monogram-bottom', 'Cursive monogram · bottom'],
  ['serif-initials-top', 'Serif initials · top'],
  ['script-name-extending', 'Script name · past the edge'],
  ['block-name-integrated', 'Block name · woven in'],
];

/** The two cases the four-up legend cannot show: no frame at all, and leaving
 *  room for a logo (which is guidance, not an option — hence the caption). */
const LETTERING_EXTRA_SAMPLES: [string, string][] = [
  ['name-art-standalone', 'Name art only — no frame'],
  ['logo-space-bottom', 'Ask for “a clear band for our logo” in the brief'],
];

/** One legend cell: thumbnail above its caption. */
function sampleCell(prefix: string, sample: string, caption: string): A2uiComponent[] {
  return [
    { id: `${prefix}Col`, component: 'Column', children: [`${prefix}Img`, `${prefix}Cap`] },
    { id: `${prefix}Img`, component: 'Image', variant: 'thumb', url: `/samples/lettering/${sample}.png` },
    { id: `${prefix}Cap`, component: 'Text', variant: 'caption', text: caption },
  ];
}

/**
 * The snapshot row for the challenge a proposal targets, when the caller could
 * find one. `null` (no snapshot, or an id the snapshot does not know) keeps the
 * id-only rendering these cards always had.
 */
export type ProposalChallenge = { id: string; title: string; emoji: string; points: number } | null;

/**
 * Identity line for a card that acts on an EXISTING challenge. The card used to
 * show the raw uuid and nothing else, so "Delete it" asked the host to approve
 * destroying `9f3c1a…` — a string they have never seen anywhere in the product.
 * The name goes on top; the id stays, demoted to a caption, because it is still
 * the thing the executor keys on.
 *
 * `withPoints` is false on the EDIT card: its points box is seeded with the
 * PROPOSED value, so repeating the current one beside it reads as a
 * contradiction rather than as context.
 */
function challengeTarget(challenge: ProposalChallenge, withPoints: boolean): { ids: string[]; components: A2uiComponent[] } {
  const idRow: A2uiComponent = {
    id: 'targetId', component: 'Text', variant: 'caption', text: { path: '/proposal/challengeId' },
  };
  if (!challenge) return { ids: ['targetId'], components: [idRow] };
  return {
    ids: ['target', 'targetId'],
    components: [
      {
        id: 'target', component: 'Text',
        text: withPoints
          ? `${challenge.emoji} ${challenge.title} · ${challenge.points} pts`
          : `${challenge.emoji} ${challenge.title}`,
      },
      idRow,
    ],
  };
}

/** Confirm card for a MUTATION proposal — every field the executor will use
 *  is editable in the card. Returns [] for read-only tools (no confirm).
 *  `challenge` names the row an update/delete targets (see challengeTarget). */
export function buildProposalSurface(
  action: CopilotAction,
  surfaceId: string,
  challenge: ProposalChallenge = null,
  ctx: ProposalContext = {},
): A2uiMessage[] {
  const p = 'proposal' in action ? action.proposal : undefined;
  const snap = ctx.snapshot ?? null;
  const expName = (id: string | null | undefined): string =>
    (id && snap?.experiences.find((e) => e.id === id)?.name) || (id ? id : 'none');
  switch (action.tool) {
    case 'add_challenge': {
      const confirm = confirmRow('Add challenge');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        {
          id: 'body', component: 'Column',
          children: ['heading', 'titleField', 'emojiField', 'pointsField', 'descField', 'checkField', 'checkHint', ...confirm.ids],
        },
        heading(action.tool),
        textField('titleField', 'Title', '/proposal/title'),
        textField('emojiField', 'Emoji', '/proposal/emoji'),
        textField('pointsField', 'Points', '/proposal/points'),
        textField('descField', 'Description (optional)', '/proposal/description'),
        // AI photo check — filled when the host's request implies a visual test
        // ("find someone in red"); editable, and leaving it blank = no check.
        textField('checkField', 'AI photo check (optional)', '/proposal/validationPrompt'),
        { id: 'checkHint', component: 'Text', variant: 'caption', text: 'If set, the AI verifies each guest photo matches this before it counts.' },
        ...confirm.components,
      ]);
    }
    case 'add_challenge_pack': {
      // Templated ChildList: ONE row template rendered per challenge, each
      // scoped to `/proposal/challenges/<i>` so the relative bindings
      // (`include`, `title`, …) read and write that row. The confirm handler
      // runs applyIncludeFlags BEFORE normalizeActions to honour the ticks.
      const confirm = confirmRow('Add selected');
      const rows = action.proposal.challenges.map((c) => ({ ...c, include: true }));
      return surface(surfaceId, { proposal: { tool: action.tool, ...action.proposal, challenges: rows } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'themeField', 'packList', 'packHint', ...confirm.ids] },
        heading(action.tool, ` · ${rows.length} challenges`),
        textField('themeField', 'Theme', '/proposal/theme'),
        { id: 'packList', component: 'List', children: { path: '/proposal/challenges', componentId: 'packRow' } },
        { id: 'packRow', component: 'Column', children: ['packRowTop', 'packRowTitle'] },
        { id: 'packRowTop', component: 'Row', justify: 'start', children: ['packInclude', 'packPoints'] },
        { id: 'packInclude', component: 'CheckBox', label: { path: 'emoji' }, value: { path: 'include' } },
        { id: 'packPoints', component: 'Text', variant: 'caption', text: { path: 'points' } },
        { id: 'packRowTitle', component: 'TextField', label: 'Title', value: { path: 'title' } },
        { id: 'packHint', component: 'Text', variant: 'caption', text: 'Untick any mission you don’t want; edit titles freely.' },
        ...confirm.components,
      ]);
    }
    case 'update_challenge': {
      const confirm = confirmRow('Apply changes');
      const target = challengeTarget(challenge, false);
      // BEFORE → AFTER for each field the proposal touches (after tracks edits).
      const cur = snap?.challenges.find((c) => c.id === action.proposal.challengeId) ?? challenge;
      const rows: DiffRow[] = [];
      if (cur && action.proposal.title !== undefined) rows.push({ label: 'Title', before: cur.title, after: { path: '/proposal/title' } });
      if (cur && action.proposal.emoji !== undefined) rows.push({ label: 'Emoji', before: cur.emoji, after: { path: '/proposal/emoji' } });
      if (cur && action.proposal.points !== undefined) rows.push({ label: 'Points', before: String(cur.points), after: { path: '/proposal/points' } });
      if (cur && 'active' in cur && action.proposal.active !== undefined) {
        rows.push({ label: 'Status', before: cur.active ? 'Active' : 'Paused', after: action.proposal.active ? 'Active' : 'Paused' });
      }
      const diffIds = rows.length > 0 ? ['diff', 'diffDivider'] : [];
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        {
          id: 'body', component: 'Column',
          children: ['heading', ...target.ids, ...diffIds, 'titleField', 'emojiField', 'pointsField', 'activeCheck', ...confirm.ids],
        },
        heading(action.tool),
        ...target.components,
        ...(rows.length > 0 ? [diff('diff', rows), divider('diffDivider')] : []),
        textField('titleField', 'Title', '/proposal/title'),
        textField('emojiField', 'Emoji', '/proposal/emoji'),
        textField('pointsField', 'Points', '/proposal/points'),
        { id: 'activeCheck', component: 'CheckBox', label: 'Active', value: { path: '/proposal/active' } },
        ...confirm.components,
      ]);
    }
    case 'delete_challenge': {
      const confirm = confirmRow('Delete it');
      const target = challengeTarget(challenge, true);
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', ...target.ids, 'warning', ...confirm.ids] },
        heading(action.tool),
        ...target.components,
        {
          id: 'warning', component: 'Text', variant: 'caption',
          text: 'This permanently removes the challenge (completed posts keep their points).',
        },
        ...confirm.components,
      ]);
    }
    case 'create_card': {
      const confirm = confirmRow('Create card');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        {
          id: 'body', component: 'Column',
          children: ['heading', 'titleField', 'recipientField', 'deadlineField', ...confirm.ids],
        },
        heading(action.tool),
        textField('titleField', 'Card title', '/proposal/cardTitle'),
        textField('recipientField', 'For (recipient)', '/proposal/recipientName'),
        { id: 'deadlineField', component: 'DateTimeInput', label: 'Contribution deadline (optional)', enableDate: true, enableTime: false, value: { path: '/proposal/deadline' } },
        ...confirm.components,
      ]);
    }
    case 'generate_frame': {
      // Generation card: confirm KICKS OFF generation (client-side, two-phase),
      // it does NOT execute a mutation — CopilotChat routes confirm_action for
      // generation tools to the async generator instead of executeAction.
      //
      // The lettering block is ALWAYS seeded (with the agent's proposal when it
      // made one) so the pickers have a selection to show. An empty text box
      // means no lettering: normalizeLettering rejects it and the frame
      // generates wordless, exactly as before this card had the fields.
      const lettering = {
        text: action.proposal.lettering?.text ?? '',
        style: action.proposal.lettering?.style ?? 'script-name',
        placement: action.proposal.lettering?.placement ?? 'bottom',
      };
      // The provider is ALWAYS seeded (the agent's choice, else 'gemini') so the
      // picker has a selection to show and the confirm payload always names a
      // provider — the generator then never has to guess what the host chose.
      const provider = action.proposal.provider ?? 'gemini';
      const legendIds = LETTERING_SAMPLES.map(([s]) => `lg_${s}Col`);
      const extraIds = LETTERING_EXTRA_SAMPLES.map(([s]) => `lg_${s}Col`);
      return surface(surfaceId, { proposal: { tool: action.tool, ...p, lettering, provider } }, [
        { id: 'root', component: 'Card', child: 'body' },
        {
          id: 'body', component: 'Column',
          children: [
            'heading', 'sub', 'promptField', 'providerPicker',
            'letterHeading', 'letterField', 'legendRow', 'stylePicker', 'placePicker', 'extraRow', 'letterHint',
            'genRow',
          ],
        },
        heading(action.tool),
        { id: 'sub', component: 'Text', variant: 'caption', text: frameHint(action.proposal.prompt) },
        textField('promptField', 'Describe your frame', '/proposal/prompt'),
        { id: 'providerPicker', component: 'ChoicePicker', label: 'Generate with', options: PROVIDER_OPTIONS, value: { path: '/proposal/provider' } },
        { id: 'letterHeading', component: 'Text', text: 'Names on the frame (optional)', variant: 'h5' },
        textField('letterField', 'Text to letter — names, initials, a monogram', '/proposal/lettering/text'),
        { id: 'legendRow', component: 'Row', children: legendIds },
        ...LETTERING_SAMPLES.flatMap(([s, cap]) => sampleCell(`lg_${s}`, s, cap)),
        { id: 'stylePicker', component: 'ChoicePicker', label: 'Lettering style', options: LETTERING_STYLE_OPTIONS, value: { path: '/proposal/lettering/style' } },
        { id: 'placePicker', component: 'ChoicePicker', label: 'Where it goes', options: LETTERING_PLACEMENT_OPTIONS, value: { path: '/proposal/lettering/placement' } },
        { id: 'extraRow', component: 'Row', children: extraIds },
        ...LETTERING_EXTRA_SAMPLES.flatMap(([s, cap]) => sampleCell(`lg_${s}`, s, cap)),
        {
          id: 'letterHint', component: 'Text', variant: 'caption',
          text: 'Leave the box empty for a frame with no words on it. Keep it short — up to 40 characters spells reliably.',
        },
        { id: 'genRow', component: 'Row', justify: 'end', children: ['cancelBtn', 'genBtn'] },
        { id: 'cancelBtn', component: 'Button', variant: 'borderless', child: 'cancelLabel', action: { event: { name: 'cancel_action', context: {} } } },
        { id: 'cancelLabel', component: 'Text', text: 'Dismiss' },
        { id: 'genBtn', component: 'Button', variant: 'primary', child: 'genLabel', action: { event: { name: 'confirm_action', context: { proposal: { path: '/proposal' } } } } },
        { id: 'genLabel', component: 'Text', text: 'Generate frame' },
      ]);
    }
    case 'set_filter': {
      const confirm = confirmRow('Add filter');
      // A picker (bound to /proposal/shaderId) lets the host swap the suggested
      // filter — so the build-mode chip works even before an AI round-trip.
      const diffIds = snap ? ['diff', 'diffDivider'] : [];
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', ...diffIds, 'picker', 'desc', ...confirm.ids] },
        heading(action.tool),
        ...(snap ? [diff('diff', [{ label: 'Booth default', before: expName(snap.defaultExperienceId), after: { path: '/proposal/shaderId' } }]), divider('diffDivider')] : []),
        { id: 'picker', component: 'ChoicePicker', label: 'Filter', options: FILTER_OPTIONS, value: { path: '/proposal/shaderId' } },
        { id: 'desc', component: 'Text', variant: 'caption', text: 'Applied to the whole booth and set as the default look.' },
        ...confirm.components,
      ]);
    }
    case 'update_brief': {
      const confirm = confirmRow('Update brief');
      const fields = (['occasion', 'honorees', 'palette', 'tone', 'avoid', 'notes'] as const).filter((k) => action.proposal[k] !== undefined);
      const label = (k: string) => k[0].toUpperCase() + k.slice(1);
      const before = (k: keyof EventBrief): string => {
        const v = snap?.brief?.[k];
        return Array.isArray(v) ? (v.length > 0 ? v.join(', ') : '—') : (typeof v === 'string' && v ? v : '—');
      };
      const rows: DiffRow[] = fields.map((k) => ({ label: label(k), before: before(k), after: { path: `/proposal/${k}` } }));
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'diff', 'diffDivider', ...fields.map((k) => `${k}Field`), 'briefHint', ...confirm.ids] },
        heading(action.tool),
        diff('diff', rows),
        divider('diffDivider'),
        ...fields.map((k) => textField(`${k}Field`, label(k), `/proposal/${k}`)),
        { id: 'briefHint', component: 'Text', variant: 'caption', text: 'Only these fields change; everything else in the brief stays as it is.' },
        ...confirm.components,
      ]);
    }
    case 'add_head_piece': {
      if (action.proposal.source === 'generate') {
        // Generation card (two-phase, like generate_frame) — confirm kicks off gen.
        return surface(surfaceId, { proposal: { tool: action.tool, source: 'generate', prompt: action.proposal.prompt } }, [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['heading', 'sub', 'promptField', 'genRow'] },
          heading(action.tool),
          { id: 'sub', component: 'Text', variant: 'caption', text: pieceHint(action.proposal.prompt) },
          textField('promptField', 'Describe your 3D prop', '/proposal/prompt'),
          { id: 'genRow', component: 'Row', justify: 'end', children: ['cancelBtn', 'genBtn'] },
          { id: 'cancelBtn', component: 'Button', variant: 'borderless', child: 'cancelLabel', action: { event: { name: 'cancel_action', context: {} } } },
          { id: 'cancelLabel', component: 'Text', text: 'Dismiss' },
          { id: 'genBtn', component: 'Button', variant: 'primary', child: 'genLabel', action: { event: { name: 'confirm_action', context: { proposal: { path: '/proposal' } } } } },
          { id: 'genLabel', component: 'Text', text: 'Generate prop' },
        ]);
      }
      const confirm = confirmRow('Add 3D prop');
      return surface(surfaceId, { proposal: { tool: action.tool, source: 'builtin', pieceId: action.proposal.pieceId } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'picker', 'desc', ...confirm.ids] },
        heading(action.tool),
        { id: 'picker', component: 'ThumbPicker', label: 'Prop', options: PIECE_THUMBS, value: { path: '/proposal/pieceId' } },
        { id: 'desc', component: 'Text', variant: 'caption', text: 'A face-tracked 3D piece guests wear in the booth — set as the booth default.' },
        ...confirm.components,
      ]);
    }
    case 'add_frame': {
      const confirm = confirmRow('Add frame');
      // Thumbnail picker of generic (no event-locked text) built-in frames.
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'picker', 'desc', ...confirm.ids] },
        heading(action.tool),
        { id: 'picker', component: 'ThumbPicker', label: 'Frame', options: FRAME_THUMBS, value: { path: '/proposal/borderId' } },
        { id: 'desc', component: 'Text', variant: 'caption', text: 'A clean, event-neutral frame — set as the booth default. Want it personalised? Ask me to generate one instead.' },
        ...confirm.components,
      ]);
    }
    case 'set_default_experience': {
      const confirm = confirmRow('Set as default');
      const diffIds = snap ? ['diff', 'diffDivider'] : [];
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', ...diffIds, 'desc', ...confirm.ids] },
        heading(action.tool),
        ...(snap ? [diff('diff', [{ label: 'Booth default', before: expName(snap.defaultExperienceId), after: expName(action.proposal.experienceId) }]), divider('diffDivider')] : []),
        { id: 'desc', component: 'Text', variant: 'caption', text: 'This is what the booth opens with when guests scan in.' },
        ...confirm.components,
      ]);
    }
    case 'set_event_date': {
      const confirm = confirmRow('Update date');
      const diffIds = snap ? ['diff', 'diffDivider'] : [];
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', ...diffIds, 'dateField', ...confirm.ids] },
        heading(action.tool),
        ...(snap ? [diff('diff', [{ label: 'Date', before: snap.startsAt ?? 'not set', after: { path: '/proposal/date' } }]), divider('diffDivider')] : []),
        { id: 'dateField', component: 'DateTimeInput', label: 'Event date', enableDate: true, enableTime: false, value: { path: '/proposal/date' } },
        ...confirm.components,
      ]);
    }
    case 'rename_event': {
      const confirm = confirmRow('Rename');
      const diffIds = snap ? ['diff', 'diffDivider'] : [];
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', ...diffIds, 'nameField', ...confirm.ids] },
        heading(action.tool),
        ...(snap ? [diff('diff', [{ label: 'Name', before: snap.name, after: { path: '/proposal/name' } }]), divider('diffDivider')] : []),
        textField('nameField', 'Event name', '/proposal/name'),
        ...confirm.components,
      ]);
    }
    case 'go_live': {
      const confirm = confirmRow('Go live');
      return surface(surfaceId, { proposal: { tool: 'go_live' } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'warn', ...confirm.ids] },
        heading(action.tool),
        { id: 'warn', component: 'Text', variant: 'caption', text: 'Going live lets anyone with the link take pictures and post to your wall. You can pause it again anytime.' },
        ...confirm.components,
      ]);
    }
    case 'open_scene_director':
    case 'contact_support':
      return buildHandoffSurface(action, surfaceId);
    default:
      return []; // read-only tools auto-execute — no confirm card
  }
}

/* ── Bundles (several mutating proposals in one card) ────────────────── */

export interface BundleStep {
  /** The normalized action — lives in the data model as JSON so a refreshed
   *  page keeps a working card. */
  action: CopilotAction;
  /** ≤90-char host line (summarizeAction). */
  summary: string;
  include: boolean;
  /** Spends credits: runs LAST and opens its own generation card. */
  paid: boolean;
  /** '' for free steps; the caption under a paid one. */
  paidNote: string;
}

const SUMMARY_MAX = 90;

/** Spends credits (the two generation tools). */
export function isPaidAction(action: CopilotAction): boolean {
  return action.tool === 'generate_frame'
    || (action.tool === 'add_head_piece' && action.proposal.source === 'generate');
}

/** One host-readable line (≤ 90 chars) for ANY action — bundle rows, the
 *  "Stopped." recap, telemetry. Names things from the snapshot when it can. */
export function summarizeAction(action: CopilotAction, snapshot: EventSnapshot | null = null): string {
  const ch = (id: string) => snapshot?.challenges.find((c) => c.id === id)?.title ?? id;
  const ex = (id: string) => snapshot?.experiences.find((e) => e.id === id)?.name ?? id;
  let line: string;
  switch (action.tool) {
    case 'add_challenge':
      line = `Add challenge “${clip(action.proposal.title, 40)}” (${action.proposal.points} pts)`;
      break;
    case 'add_challenge_pack':
      line = `Add ${action.proposal.challenges.length} challenges — ${clip(action.proposal.theme, 40)}`;
      break;
    case 'update_challenge': {
      const p = action.proposal;
      const bits = [
        ...(p.title !== undefined ? [`title → “${clip(p.title, 24)}”`] : []),
        ...(p.points !== undefined ? [`${p.points} pts`] : []),
        ...(p.emoji !== undefined ? [p.emoji] : []),
        ...(p.active !== undefined ? [p.active ? 'resume' : 'pause'] : []),
      ];
      line = `Edit “${clip(ch(p.challengeId), 30)}”${bits.length > 0 ? `: ${bits.join(', ')}` : ''}`;
      break;
    }
    case 'delete_challenge':
      line = `Delete challenge “${clip(ch(action.proposal.challengeId), 40)}”`;
      break;
    case 'create_card':
      line = `Create card “${clip(action.proposal.cardTitle, 40)}”${action.proposal.recipientName ? ` for ${clip(action.proposal.recipientName, 20)}` : ''}`;
      break;
    case 'generate_frame':
      line = `Generate a frame: ${clip(action.proposal.prompt, 60)}`;
      break;
    case 'add_frame':
      line = `Add frame “${GENERIC_FRAMES.find((f) => f.id === action.proposal.borderId)?.name ?? action.proposal.borderId}”`;
      break;
    case 'set_filter':
      line = `Set filter “${FILTER_SHADERS.find((s) => s.id === action.proposal.shaderId)?.name ?? action.proposal.shaderId}”`;
      break;
    case 'add_head_piece': {
      const hp = action.proposal;
      line = hp.source === 'builtin'
        ? `Add 3D prop “${HEAD_PIECES.find((h) => h.id === hp.pieceId)?.name ?? hp.pieceId}”`
        : `Generate a 3D prop: ${clip(hp.prompt, 60)}`;
      break;
    }
    case 'set_default_experience':
      line = `Set the booth default to “${clip(ex(action.proposal.experienceId), 40)}”`;
      break;
    case 'set_event_date':
      line = `Set the date to ${action.proposal.date}`;
      break;
    case 'rename_event':
      line = `Rename the event to “${clip(action.proposal.name, 50)}”`;
      break;
    case 'update_brief':
      line = `Update the brief (${Object.keys(action.proposal).join(', ')})`;
      break;
    case 'go_live': line = 'Take the event live'; break;
    case 'test_experience': line = 'Show the booth test link'; break;
    case 'get_stats': line = 'Show event stats'; break;
    case 'share_links': line = 'Show the share links'; break;
    case 'open_scene_director': line = 'Open the Scene Director'; break;
    case 'contact_support': line = 'Contact support'; break;
  }
  return clip(line, SUMMARY_MAX);
}

/** Actions → bundle steps: everything included, paid steps moved LAST (stable). */
export function bundleStepsFor(actions: CopilotAction[], snapshot: EventSnapshot | null = null): BundleStep[] {
  const step = (action: CopilotAction): BundleStep => {
    const paid = isPaidAction(action);
    return {
      action, summary: summarizeAction(action, snapshot), include: true, paid,
      paidNote: paid ? `Spends credits — ${COPILOT_TOOLS[action.tool].costNote ?? ''} Opens its own card last.`.replace(/\s+/g, ' ').trim() : '',
    };
  };
  return [...actions.filter((a) => !isPaidAction(a)), ...actions.filter(isPaidAction)].map(step);
}

/**
 * One card for a multi-step proposal: a templated list with a CheckBox per
 * step, and ONE confirm (`confirm_bundle`, context `{ steps }` resolved from
 * the data model at click time — so unticks and a page refresh both survive).
 */
export function buildBundleSurface(steps: BundleStep[], surfaceId: string): A2uiMessage[] {
  return surface(surfaceId, { bundle: { steps } }, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['heading', 'sub', 'stepList', 'divider', 'actionsRow'] },
    { id: 'heading', component: 'Text', text: `Set it up in ${steps.length} steps`, variant: 'h5' },
    {
      id: 'sub', component: 'Text', variant: 'caption',
      text: 'Untick anything you don’t want. Free steps run in order; a step that spends credits opens its own card last.',
    },
    { id: 'stepList', component: 'List', children: { path: '/bundle/steps', componentId: 'bundleRow' } },
    { id: 'bundleRow', component: 'Column', children: ['bundleInclude', 'bundleNote'] },
    { id: 'bundleInclude', component: 'CheckBox', label: { path: 'summary' }, value: { path: 'include' } },
    { id: 'bundleNote', component: 'Text', variant: 'caption', text: { path: 'paidNote' } },
    divider('divider'),
    { id: 'actionsRow', component: 'Row', justify: 'end', children: ['cancelBtn', 'confirmBtn'] },
    { id: 'cancelBtn', component: 'Button', variant: 'borderless', child: 'cancelLabel', action: { event: { name: 'cancel_action', context: {} } } },
    { id: 'cancelLabel', component: 'Text', text: 'Dismiss' },
    {
      id: 'confirmBtn', component: 'Button', variant: 'primary', child: 'confirmLabel',
      action: { event: { name: 'confirm_bundle', context: { steps: { path: '/bundle/steps' } } } },
    },
    { id: 'confirmLabel', component: 'Text', text: 'Run selected' },
  ]);
}

/** The two handoff tools: an editable brief / summary and the standard
 *  cancel + confirm row. Confirm is the same `confirm_action` every proposal
 *  card fires, so the chat's one handler runs — executeAction then returns
 *  `handoff` and the chat navigates / opens the support dialog. */
export function buildHandoffSurface(
  action: Extract<CopilotAction, { tool: 'open_scene_director' | 'contact_support' }>,
  surfaceId: string,
): A2uiMessage[] {
  const director = action.tool === 'open_scene_director';
  const confirm = confirmRow(director ? 'Open the Director' : 'Contact support');
  return surface(surfaceId, { proposal: { tool: action.tool, ...action.proposal } }, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['heading', 'desc', 'textField', ...confirm.ids] },
    heading(action.tool),
    {
      id: 'desc', component: 'Text', variant: 'caption',
      text: director
        ? 'The studio Scene Director designs the whole look — frame, filter and 3D piece together — from this brief.'
        : 'A person will read this and get back to you by email.',
    },
    director
      ? textField('textField', 'Brief for the Director', '/proposal/brief')
      : textField('textField', 'What should support know?', '/proposal/summary'),
    ...confirm.components,
  ]);
}

/* ── Generation two-phase surfaces (frame / 3D prop) ─────────────────── */

/** Phase 2: a "working" card while generation runs. Carries a Dismiss so a card
 *  orphaned by a page refresh (its in-flight promise gone) is never stuck. */
export function buildGeneratingSurface(surfaceId: string, label: string): A2uiMessage[] {
  return surface(surfaceId, {}, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['statusRow', 'actionsRow'] },
    { id: 'statusRow', component: 'Row', justify: 'start', children: ['icon', 'label'] },
    { id: 'icon', component: 'Icon', name: 'sparkles' },
    { id: 'label', component: 'Text', text: label },
    { id: 'actionsRow', component: 'Row', justify: 'end', children: ['dismissBtn'] },
    { id: 'dismissBtn', component: 'Button', variant: 'borderless', child: 'dismissLabel', action: { event: { name: 'cancel_action', context: {} } } },
    { id: 'dismissLabel', component: 'Text', text: 'Dismiss' },
  ]);
}

/** Phase 3 (frame): the generated frame previewed over a sample face, with
 *  apply / tweak+regenerate / dismiss. The apply button carries the experience
 *  id + identity transform to CopilotChat's `apply_generated` handler; the
 *  regenerate button carries the host's "what should change" note so the next
 *  take is an ITERATION, not the identical prompt run again (mirrors the studio
 *  Director's RejectPanel). */
export function buildFramePreviewSurface(
  surfaceId: string,
  gen: { experienceId: string; assetUrl: string },
): A2uiMessage[] {
  const model = { gen: { kind: 'frame', experienceId: gen.experienceId, assetUrl: gen.assetUrl, feedback: '', transform: { scale: 1, x: 0, y: 0 } } };
  return surface(surfaceId, model, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', align: 'center', children: ['heading', 'preview', 'hint', 'tweakField', 'actionsRow'] },
    { id: 'heading', component: 'Text', text: 'Here’s your frame', variant: 'h5' },
    { id: 'preview', component: 'FramePreview', assetUrl: { path: '/gen/assetUrl' }, transform: { path: '/gen/transform' } },
    { id: 'hint', component: 'Text', variant: 'caption', text: 'Fine-tune its placement anytime in the studio’s 2D creator.' },
    textField('tweakField', 'Tweak it (optional) — what should change?', '/gen/feedback'),
    { id: 'actionsRow', component: 'Row', justify: 'center', children: ['regenBtn', 'applyBtn'] },
    { id: 'regenBtn', component: 'Button', variant: 'borderless', child: 'regenLabel', action: { event: { name: 'regenerate_generated', context: { kind: { path: '/gen/kind' }, feedback: { path: '/gen/feedback' } } } } },
    { id: 'regenLabel', component: 'Text', text: 'Regenerate' },
    {
      id: 'applyBtn', component: 'Button', variant: 'primary', child: 'applyLabel',
      action: { event: { name: 'apply_generated', context: { kind: { path: '/gen/kind' }, experienceId: { path: '/gen/experienceId' }, transform: { path: '/gen/transform' } } } },
    },
    { id: 'applyLabel', component: 'Text', text: 'Use as booth frame' },
  ]);
}

/** Phase 3 (3D prop): the generated model previewed as a thumbnail + label
 *  (no interactive 3D viewer in the chat), with apply / regenerate / dismiss. */
export function buildHeadPiecePreviewSurface(
  surfaceId: string,
  gen: { experienceId: string; thumbUrl: string | null; label: string },
): A2uiMessage[] {
  const model = { gen: { kind: 'headpiece', experienceId: gen.experienceId, feedback: '' } };
  const children = ['heading', ...(gen.thumbUrl ? ['thumb'] : []), 'label', 'hint', 'tweakField', 'actionsRow'];
  const comps: A2uiComponent[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', align: 'center', children },
    { id: 'heading', component: 'Text', text: 'Your 3D prop is ready', variant: 'h5' },
    ...(gen.thumbUrl ? [{ id: 'thumb', component: 'Image', url: gen.thumbUrl } as A2uiComponent] : []),
    { id: 'label', component: 'Text', text: gen.label },
    { id: 'hint', component: 'Text', variant: 'caption', text: 'Preview it live in the booth after you add it.' },
    // A regenerate that re-ran the identical prompt could only ever produce
    // "the same thing again, differently" — the note makes it an iteration.
    textField('tweakField', 'Tweak it (optional) — what should change?', '/gen/feedback'),
    { id: 'actionsRow', component: 'Row', justify: 'center', children: ['regenBtn', 'applyBtn'] },
    { id: 'regenBtn', component: 'Button', variant: 'borderless', child: 'regenLabel', action: { event: { name: 'regenerate_generated', context: { kind: { path: '/gen/kind' }, feedback: { path: '/gen/feedback' } } } } },
    { id: 'regenLabel', component: 'Text', text: 'Regenerate' },
    {
      id: 'applyBtn', component: 'Button', variant: 'primary', child: 'applyLabel',
      action: { event: { name: 'apply_generated', context: { kind: { path: '/gen/kind' }, experienceId: { path: '/gen/experienceId' } } } },
    },
    { id: 'applyLabel', component: 'Text', text: 'Use as booth prop' },
  ];
  return surface(surfaceId, model, comps);
}

/** Generation error card: a message + optional retry (retries respect the same
 *  regenerate_generated action so a failed leg is re-run, never double-applied).
 *  `topUpUrl` (absolute, e.g. `${origin}/host/billing`) adds a "Top up credits"
 *  button for insufficient_credits — openUrl only accepts http(s) URLs. */
export function buildGenErrorSurface(
  surfaceId: string,
  message: string,
  opts: { kind: 'frame' | 'headpiece'; retryable: boolean; topUpUrl?: string },
): A2uiMessage[] {
  const children = ['heading', 'msg', 'actionsRow'];
  const actionIds = [
    'dismissBtn',
    ...(opts.topUpUrl ? ['topUpBtn'] : []),
    ...(opts.retryable ? ['retryBtn'] : []),
  ];
  return surface(surfaceId, { gen: { kind: opts.kind } }, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children },
    { id: 'heading', component: 'Text', text: 'That didn’t work', variant: 'h5' },
    { id: 'msg', component: 'Text', variant: 'caption', text: message },
    { id: 'actionsRow', component: 'Row', justify: 'end', children: actionIds },
    { id: 'dismissBtn', component: 'Button', variant: 'borderless', child: 'dismissLabel', action: { event: { name: 'cancel_action', context: {} } } },
    { id: 'dismissLabel', component: 'Text', text: 'Dismiss' },
    ...(opts.topUpUrl
      ? [
          { id: 'topUpBtn', component: 'Button', variant: 'primary', child: 'topUpLabel', action: { functionCall: { call: 'openUrl', args: { url: opts.topUpUrl } } } } as A2uiComponent,
          { id: 'topUpLabel', component: 'Text', text: 'Top up credits' } as A2uiComponent,
        ]
      : []),
    ...(opts.retryable
      ? [
          { id: 'retryBtn', component: 'Button', variant: 'primary', child: 'retryLabel', action: { event: { name: 'regenerate_generated', context: { kind: { path: '/gen/kind' } } } } } as A2uiComponent,
          { id: 'retryLabel', component: 'Text', text: 'Try again' } as A2uiComponent,
        ]
      : []),
  ]);
}

/* ── Test experience (read-only) + completion checklist ──────────────── */

/** Device-aware booth-test card: QR (scanned on the host's own device) / open
 *  button, with honest draft-vs-live copy and a Go-live CTA when not live. */
export function buildBoothTestSurface(
  surfaceId: string,
  info: { slug: string; status: string; boothUrl: string },
): A2uiMessage[] {
  const live = info.status === 'live';
  const children = ['heading', 'test', 'note', ...(live ? [] : ['goLiveRow'])];
  const comps: A2uiComponent[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', align: 'center', children },
    { id: 'heading', component: 'Text', text: live ? 'Test your live booth' : 'Preview your booth', variant: 'h5' },
    { id: 'test', component: 'BoothTest', url: info.boothUrl, status: info.status },
    {
      id: 'note', component: 'Text', variant: 'caption',
      text: live
        ? 'Guests can scan this now to take pictures and post to your wall.'
        : 'While in draft, only you (signed in) can open this — go live to let guests join and beam to the wall.',
    },
  ];
  if (!live) {
    comps.push(
      { id: 'goLiveRow', component: 'Row', justify: 'center', children: ['goLiveBtn'] },
      // OPENS the go-live confirm card; it must not fire confirm_action itself.
      // Doing that skipped the one card that tells the host what going live
      // means ("anyone with the link can post to your wall") — a preview card
      // publishing the event on a single tap, with no warning and no undo.
      { id: 'goLiveBtn', component: 'Button', variant: 'primary', child: 'goLiveLabel', action: { event: { name: 'open_go_live_card', context: {} } } },
      { id: 'goLiveLabel', component: 'Text', text: '🚀 Go live' },
    );
  }
  return surface(surfaceId, {}, comps);
}

/** Beam-ready checklist built from the live snapshot — orients the host to the
 *  next step. Each item is a ✓/○ row; the whole thing is informational. */
export function buildChecklistSurface(
  surfaceId: string,
  items: { label: string; done: boolean }[],
): A2uiMessage[] {
  const rows = items.map((it, i) => ({
    id: `chk${i}`, component: 'Text',
    text: `${it.done ? '✓' : '○'}  ${it.label}`,
  }));
  return surface(surfaceId, {}, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['heading', ...rows.map((r) => r.id)] },
    { id: 'heading', component: 'Text', text: 'Beam-ready checklist', variant: 'h5' },
    ...rows,
  ]);
}

/** Result card after create_card succeeds: the contribution link as QR +
 *  copy chip + open action. */
export function buildCardLinkSurface(
  card: { title: string; contributeUrl: string; viewerUrl: string },
  surfaceId: string,
): A2uiMessage[] {
  return surface(surfaceId, { card }, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', align: 'center', children: ['heading', 'qr', 'linksRow'] },
    { id: 'heading', component: 'Text', text: { path: '/card/title' }, variant: 'h5' },
    { id: 'qr', component: 'QrCode', value: { path: '/card/contributeUrl' }, caption: 'Scan to contribute' },
    { id: 'linksRow', component: 'Row', justify: 'center', children: ['copyBtn', 'openBtn'] },
    {
      id: 'copyBtn', component: 'Button', variant: 'borderless', child: 'copyLabel',
      action: { functionCall: { call: 'copyToClipboard', args: { value: { path: '/card/contributeUrl' } } } },
    },
    { id: 'copyLabel', component: 'Text', text: 'Copy contribute link' },
    {
      id: 'openBtn', component: 'Button', variant: 'borderless', child: 'openLabel',
      action: { functionCall: { call: 'openUrl', args: { url: { path: '/card/viewerUrl' } } } },
    },
    { id: 'openLabel', component: 'Text', text: 'Open card' },
  ]);
}

/** Stat tiles (get_stats). */
export function buildStatsSurface(
  stats: { label: string; value: string | number }[],
  surfaceId: string,
): A2uiMessage[] {
  const rows = stats.map((s, i) => ({
    id: `stat${i}`, component: 'EventStat', label: s.label, value: String(s.value),
  }));
  return surface(surfaceId, {}, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Row', justify: 'center', children: rows.map((r) => r.id) },
    ...rows,
  ]);
}

/** QR grid (share_links). */
export function buildLinksSurface(
  links: { title: string; url: string }[],
  surfaceId: string,
): A2uiMessage[] {
  const items = links.flatMap((l, i) => ([
    { id: `link${i}`, component: 'Column', align: 'center', children: [`qr${i}`] },
    { id: `qr${i}`, component: 'QrCode', value: l.url, caption: l.title },
  ]));
  return surface(surfaceId, {}, [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Row', justify: 'center', children: links.map((_l, i) => `link${i}`) },
    ...items,
  ]);
}
