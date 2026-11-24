/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What THIS host can actually use, as the copilot sees it — so the assistant
 * never offers (or starts paying for) something that can only fail.
 *
 * The server is still the authority: ai-generate-3d answers 403
 * upgrade_required unless the resolver says `aiStudio` AND not `studio:false`
 * (index.ts step 4), and the Scene Director lives in the Studio add-on. This
 * module only PREDICTS those answers from the same resolver read the studio
 * gate already makes (studioAccess.fetchStudioAccess), and — like every other
 * client-side gate here — fails OPEN: an unknown answer offers everything and
 * lets the server say no. That is a sales gate, never a security boundary.
 *
 * PURE: no React, no supabase.
 */
import { A2UI_VERSION, BEAMWALL_CATALOG_ID, type A2uiComponent, type A2uiMessage } from './a2ui';
import type { CopilotAction } from './copilot';
import type { FeatureSet } from './features';

export interface HostEntitlements {
  /** The Studio add-on (creative studio + Scene Director). */
  studio: boolean;
  /** AI-generated 3D props (ai-generate-3d's gate: aiStudio AND studio). */
  ai3d: boolean;
  /** Paid AI frames beyond the event's free allowance. */
  aiFrames: boolean;
  /** Video capture in the booth. */
  video: boolean;
}

/** Fail-open answer: nothing is hidden or intercepted. */
export const ALL_ENTITLED: HostEntitlements = { studio: true, ai3d: true, aiFrames: true, video: true };

/**
 * A resolved studio-access read → entitlements. `null` (not read yet / the
 * read threw) and `features: null` (the resolver call failed) both fail OPEN,
 * exactly like studioAllowed. `access.studio` already folds in the platform-
 * admin and legacy-slug exceptions, so it is used as-is for the Studio; the
 * 3D rule mirrors the SERVER's gate on the raw resolver answer, because that
 * gate does not exempt admins.
 */
export function hostEntitlementsFrom(
  access: { features: FeatureSet | null; studio: boolean } | null,
): HostEntitlements {
  if (access === null) return ALL_ENTITLED;
  const f = access.features;
  if (f === null) return { ...ALL_ENTITLED, studio: access.studio };
  return {
    studio: access.studio,
    ai3d: f.aiStudio && f.studio,
    aiFrames: f.aiStudio,
    video: f.videoEnabled,
  };
}

export type LockKind = 'ai3d' | 'studio';

/** The lock a proposal would hit, or null when this host can run it. */
export function lockFor(action: CopilotAction, ent: HostEntitlements): LockKind | null {
  if (action.tool === 'add_head_piece' && action.proposal.source === 'generate' && !ent.ai3d) return 'ai3d';
  if (action.tool === 'open_scene_director' && !ent.studio) return 'studio';
  return null;
}

/** The ToolResultCode the model reads for a lock (see copilot.ts). */
export const LOCKED_CODE = 'upgrade_required' as const;

/** The [tool_result] fields for a lock. `code=upgrade_required
 *  retryable=false` is what tells the model to stop re-offering it (with the
 *  PLAN LIMITS context line); the summary is also the host's pill, so it is
 *  short, plain, and says nothing was spent. */
export function lockedResult(lock: LockKind): { ok: false; code: typeof LOCKED_CODE; retryable: false; summary: string } {
  return {
    ok: false,
    code: LOCKED_CODE,
    retryable: false,
    summary: lock === 'ai3d'
      ? 'Not on this plan — AI-made 3D props come with the Studio add-on. Nothing was generated or charged.'
      : 'Not on this plan — the Scene Director comes with the Studio add-on. Nothing was opened or charged.',
  };
}

/**
 * One line for the copilot's event context so the model knows the limits
 * BEFORE it proposes. Null when everything is available, so an entitled
 * host's context is byte-identical to before this existed.
 */
export function entitlementContextLine(ent: HostEntitlements): string | null {
  const off: string[] = [];
  if (!ent.ai3d) off.push('AI-generated 3D props (add_head_piece with source "generate")');
  if (!ent.studio) off.push('the Scene Director (open_scene_director)');
  if (off.length === 0) return null;
  const extras = [
    ...(!ent.aiFrames ? ['AI frames are limited to the event’s free allowance'] : []),
    ...(!ent.video ? ['the booth takes photos only (no video)'] : []),
  ];
  return `PLAN LIMITS: NOT available on this plan — ${off.join('; ')}. Never propose or price these; offer built-in library props (add_head_piece source "builtin"), ready-made frames/filters, or generate_frame instead.${
    extras.length > 0 ? ` Also: ${extras.join('; ')}.` : ''
  }`;
}

/** The host-facing card shown instead of a proposal that cannot run.
 *  Its two alternative buttons fire `open_locked_alt` with `{ alt }`. */
export function buildLockedSurface(surfaceId: string, lock: LockKind, prompt = ''): A2uiMessage[] {
  const heading = lock === 'ai3d' ? '3D props are part of the Studio add-on' : 'The Scene Director is part of the Studio add-on';
  const body = lock === 'ai3d'
    ? 'Nothing was generated or charged. On your plan you can add a ready-made 3D prop from the library, or have me make an AI frame — your event’s first 3 are free.'
    : 'Nothing was opened or charged. On your plan you can pick ready-made frames, props and effects, or have me make an AI frame — your event’s first 3 are free.';
  const alt = (id: string, label: string, value: 'library_prop' | 'frame', primary: boolean): A2uiComponent[] => [
    {
      id, component: 'Button', variant: primary ? 'primary' : 'borderless', child: `${id}Label`,
      action: { event: { name: 'open_locked_alt', context: { alt: value, prompt: { path: '/locked/prompt' } } } },
    },
    { id: `${id}Label`, component: 'Text', text: label },
  ];
  const components: A2uiComponent[] = [
    { id: 'root', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['heading', 'msg', 'altRow', 'actionsRow'] },
    { id: 'heading', component: 'Text', text: heading, variant: 'h5' },
    { id: 'msg', component: 'Text', variant: 'caption', text: body },
    { id: 'altRow', component: 'Row', justify: 'start', children: ['propBtn', 'frameBtn'] },
    ...alt('propBtn', 'Pick a library prop', 'library_prop', true),
    ...alt('frameBtn', 'Make an AI frame', 'frame', false),
    { id: 'actionsRow', component: 'Row', justify: 'end', children: ['dismissBtn'] },
    { id: 'dismissBtn', component: 'Button', variant: 'borderless', child: 'dismissLabel', action: { event: { name: 'cancel_action', context: {} } } },
    { id: 'dismissLabel', component: 'Text', text: 'Dismiss' },
  ];
  return [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: BEAMWALL_CATALOG_ID } },
    { version: A2UI_VERSION, updateDataModel: { surfaceId, path: '/', value: { locked: { kind: lock, prompt } } } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ];
}

/** The frame brief offered in place of a locked 3D prop: the same idea, as
 *  ornament around the photo (a frame cannot sit on the head). */
export function frameBriefFromPropPrompt(prompt: string): string {
  const idea = prompt.trim().replace(/[.\s]+$/, '');
  return idea
    ? `A frame themed around ${idea.slice(0, 200)} — ornament hugging the edges, centre fully clear`
    : 'An elegant frame for this event — refined ornament hugging the edges, centre fully clear';
}
