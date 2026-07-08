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

function textField(id: string, label: string, path: string): A2uiComponent {
  return { id, component: 'TextField', label, value: { path } };
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
          children: ['heading', 'titleField', 'emojiField', 'pointsField', 'descField', ...confirm.ids],
        },
        { id: 'heading', component: 'Text', text: 'New photo challenge', variant: 'h5' },
        textField('titleField', 'Title', '/proposal/title'),
        textField('emojiField', 'Emoji', '/proposal/emoji'),
        textField('pointsField', 'Points', '/proposal/points'),
        textField('descField', 'Description (optional)', '/proposal/description'),
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
    default:
      return []; // read-only tools auto-execute — no confirm card
  }
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
