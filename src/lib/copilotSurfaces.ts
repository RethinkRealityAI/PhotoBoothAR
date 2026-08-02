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
import { FILTER_SHADERS } from './shaders';
import { HEAD_PIECES } from './headPieces';
import { GENERIC_FRAMES } from './borders';
import { frameBriefGaps, gapSummary, pieceBriefGaps } from './assetBrief';
import { providerCostLabel } from './providerPricing';

const FILTER_OPTIONS = FILTER_SHADERS.filter((s) => s.id !== 'none').map((s) => ({ label: s.name, value: s.id }));
const PIECE_OPTIONS = HEAD_PIECES.map((p) => ({ label: p.name, value: p.id }));
const FRAME_OPTIONS = GENERIC_FRAMES.map((f) => ({ label: f.name, value: f.id }));

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

/** Confirm card for a MUTATION proposal — every field the executor will use
 *  is editable in the card. Returns [] for read-only tools (no confirm). */
export function buildProposalSurface(action: CopilotAction, surfaceId: string): A2uiMessage[] {
  const p = 'proposal' in action ? action.proposal : undefined;
  switch (action.tool) {
    case 'add_challenge': {
      const confirm = confirmRow('Add challenge');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        {
          id: 'body', component: 'Column',
          children: ['heading', 'titleField', 'emojiField', 'pointsField', 'descField', 'checkField', 'checkHint', ...confirm.ids],
        },
        { id: 'heading', component: 'Text', text: 'New photo challenge', variant: 'h5' },
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
      const confirm = confirmRow('Add all');
      const rows = action.proposal.challenges;
      const rowIds = rows.map((_, i) => `chal_${i}`);
      return surface(surfaceId, { proposal: { tool: action.tool, ...action.proposal } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'themeField', ...rowIds, ...confirm.ids] },
        { id: 'heading', component: 'Text', text: `Challenge pack · ${rows.length} challenges`, variant: 'h5' },
        textField('themeField', 'Theme', '/proposal/theme'),
        ...rows.flatMap((c, i): A2uiComponent[] => [
          { id: `chal_${i}`, component: 'Column', children: [`chal_${i}_t`, `chal_${i}_d`] },
          { id: `chal_${i}_t`, component: 'Text', text: `${c.emoji} ${c.title} · ${c.points} pts` },
          { id: `chal_${i}_d`, component: 'Text', variant: 'caption', text: c.description || '—' },
        ]),
        ...confirm.components,
      ]);
    }
    case 'update_challenge': {
      const confirm = confirmRow('Apply changes');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        {
          id: 'body', component: 'Column',
          children: ['heading', 'target', 'titleField', 'emojiField', 'pointsField', 'activeCheck', ...confirm.ids],
        },
        { id: 'heading', component: 'Text', text: 'Edit challenge', variant: 'h5' },
        { id: 'target', component: 'Text', variant: 'caption', text: { path: '/proposal/challengeId' } },
        textField('titleField', 'Title', '/proposal/title'),
        textField('emojiField', 'Emoji', '/proposal/emoji'),
        textField('pointsField', 'Points', '/proposal/points'),
        { id: 'activeCheck', component: 'CheckBox', label: 'Active', value: { path: '/proposal/active' } },
        ...confirm.components,
      ]);
    }
    case 'delete_challenge': {
      const confirm = confirmRow('Delete it');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'warning', 'target', ...confirm.ids] },
        { id: 'heading', component: 'Text', text: 'Delete challenge', variant: 'h5' },
        {
          id: 'warning', component: 'Text', variant: 'caption',
          text: 'This permanently removes the challenge (completed posts keep their points).',
        },
        { id: 'target', component: 'Text', variant: 'caption', text: { path: '/proposal/challengeId' } },
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
        { id: 'heading', component: 'Text', text: 'New greeting card', variant: 'h5' },
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
        { id: 'heading', component: 'Text', text: 'Design a signature frame', variant: 'h5' },
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
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'picker', 'desc', ...confirm.ids] },
        { id: 'heading', component: 'Text', text: 'Add a booth filter', variant: 'h5' },
        { id: 'picker', component: 'ChoicePicker', label: 'Filter', options: FILTER_OPTIONS, value: { path: '/proposal/shaderId' } },
        { id: 'desc', component: 'Text', variant: 'caption', text: 'Applied to the whole booth and set as the default look.' },
        ...confirm.components,
      ]);
    }
    case 'add_head_piece': {
      if (action.proposal.source === 'generate') {
        // Generation card (two-phase, like generate_frame) — confirm kicks off gen.
        return surface(surfaceId, { proposal: { tool: action.tool, source: 'generate', prompt: action.proposal.prompt } }, [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['heading', 'sub', 'promptField', 'genRow'] },
          { id: 'heading', component: 'Text', text: 'Generate a 3D prop', variant: 'h5' },
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
        { id: 'heading', component: 'Text', text: 'Add a 3D prop', variant: 'h5' },
        { id: 'picker', component: 'ChoicePicker', label: 'Prop', options: PIECE_OPTIONS, value: { path: '/proposal/pieceId' } },
        { id: 'desc', component: 'Text', variant: 'caption', text: 'A face-tracked 3D piece guests wear in the booth — set as the booth default.' },
        ...confirm.components,
      ]);
    }
    case 'add_frame': {
      const confirm = confirmRow('Add frame');
      // Picker of generic (no event-locked text) built-in frames.
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'picker', 'desc', ...confirm.ids] },
        { id: 'heading', component: 'Text', text: 'Add a ready-made frame', variant: 'h5' },
        { id: 'picker', component: 'ChoicePicker', label: 'Frame', options: FRAME_OPTIONS, value: { path: '/proposal/borderId' } },
        { id: 'desc', component: 'Text', variant: 'caption', text: 'A clean, event-neutral frame — set as the booth default. Want it personalised? Ask me to generate one instead.' },
        ...confirm.components,
      ]);
    }
    case 'set_default_experience': {
      const confirm = confirmRow('Set as default');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'desc', ...confirm.ids] },
        { id: 'heading', component: 'Text', text: 'Set the booth default', variant: 'h5' },
        { id: 'desc', component: 'Text', variant: 'caption', text: 'This is what the booth opens with when guests scan in.' },
        ...confirm.components,
      ]);
    }
    case 'set_event_date': {
      const confirm = confirmRow('Update date');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'dateField', ...confirm.ids] },
        { id: 'heading', component: 'Text', text: 'Update the event date', variant: 'h5' },
        { id: 'dateField', component: 'DateTimeInput', label: 'Event date', enableDate: true, enableTime: false, value: { path: '/proposal/date' } },
        ...confirm.components,
      ]);
    }
    case 'rename_event': {
      const confirm = confirmRow('Rename');
      return surface(surfaceId, { proposal: { tool: action.tool, ...p } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'nameField', ...confirm.ids] },
        { id: 'heading', component: 'Text', text: 'Rename the event', variant: 'h5' },
        textField('nameField', 'Event name', '/proposal/name'),
        ...confirm.components,
      ]);
    }
    case 'go_live': {
      const confirm = confirmRow('Go live');
      return surface(surfaceId, { proposal: { tool: 'go_live' } }, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['heading', 'warn', ...confirm.ids] },
        { id: 'heading', component: 'Text', text: 'Take your event live', variant: 'h5' },
        { id: 'warn', component: 'Text', variant: 'caption', text: 'Going live lets anyone with the link take pictures and post to your wall. You can pause it again anytime.' },
        ...confirm.components,
      ]);
    }
    default:
      return []; // read-only tools auto-execute — no confirm card
  }
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
      { id: 'goLiveBtn', component: 'Button', variant: 'primary', child: 'goLiveLabel', action: { event: { name: 'confirm_action', context: { proposal: { tool: 'go_live' } } } } },
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
