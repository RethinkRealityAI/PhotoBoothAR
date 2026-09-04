import { describe, it, expect } from 'vitest';
import {
  buildProposalSurface, buildCardLinkSurface, buildStatsSurface, buildLinksSurface,
  buildFramePreviewSurface, buildHeadPiecePreviewSurface, buildGenErrorSurface,
  buildBoothTestSurface, buildChecklistSurface, buildHandoffSurface,
  buildBundleSurface, bundleStepsFor, isPaidAction, summarizeAction,
} from './copilotSurfaces';
import { applySurfaceMessages, getPath, resolveBindingPath, resolveContext, resolveDynamic, setPath, type A2uiMessage, type SurfaceState } from './a2ui';
import { applyIncludeFlags, normalizeActions, type CopilotAction } from './copilot';
import { COPILOT_TOOLS, TOOL_NAMES } from './copilotTools';
import type { EventSnapshot } from './eventSnapshot';
import { FILTER_SHADERS } from './shaders';
import { GENERIC_FRAMES } from './borders';
import { HEAD_PIECES } from './headPieces';

/** Every child/children id a component references must exist in the surface. */
function assertReducerValid(s: SurfaceState) {
  expect(s.components.root, 'root').toBeDefined();
  for (const c of Object.values(s.components)) {
    if (typeof c.child === 'string') expect(s.components[c.child], `${c.id}.child`).toBeDefined();
    if (Array.isArray(c.children)) {
      for (const id of c.children) expect(s.components[id as string], `${c.id}.children`).toBeDefined();
    }
  }
}

/**
 * Stronger: fold the messages, then require every `child`, every `children`
 * id AND every templated ChildList (`{ path, componentId }`) to resolve — the
 * template component must exist and the path must point at an ARRAY in the
 * data model. Returns the surface for further assertions.
 */
function assertResolvable(msgs: A2uiMessage[]): SurfaceState {
  const id = msgs[0].createSurface?.surfaceId;
  expect(id, 'createSurface first').toBeTruthy();
  const s = applySurfaceMessages({}, msgs)[id!];
  assertReducerValid(s);
  for (const c of Object.values(s.components)) {
    const ch = c.children as unknown;
    if (ch !== null && typeof ch === 'object' && !Array.isArray(ch)) {
      const t = ch as { path?: unknown; componentId?: unknown };
      expect(typeof t.path, `${c.id}.children.path`).toBe('string');
      expect(typeof t.componentId, `${c.id}.children.componentId`).toBe('string');
      expect(s.components[t.componentId as string], `${c.id}.children.componentId`).toBeDefined();
      expect(Array.isArray(resolveDynamic({ path: t.path }, s.dataModel)), `${c.id}.children.path → array`).toBe(true);
    }
  }
  return s;
}

const addAction: CopilotAction = {
  tool: 'add_challenge',
  proposal: { title: 'Best dunk pose', emoji: '🏀', points: 20, description: '' },
};

describe('buildProposalSurface', () => {
  it('builds a reducer-valid confirm card whose confirm resolves the EDITED proposal', () => {
    const surfaces = applySurfaceMessages({}, buildProposalSurface(addAction, 'p1'));
    const s = surfaces.p1;
    expect(s.components.root.component).toBe('Card');
    // every referenced child exists
    for (const c of Object.values(s.components)) {
      if (typeof c.child === 'string') expect(s.components[c.child], `${c.id}.child`).toBeDefined();
      if (Array.isArray(c.children)) {
        for (const id of c.children) expect(s.components[id as string], `${c.id}.children`).toBeDefined();
      }
    }
    // confirm binds /proposal and sees two-way edits at click time
    const action = (s.components.confirmBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    expect(action.name).toBe('confirm_action');
    const edited = { ...s, dataModel: { proposal: { tool: 'add_challenge', title: 'Renamed', emoji: '⭐', points: 5, description: '' } } };
    const ctx = resolveContext(action.context, edited.dataModel);
    expect((ctx.proposal as { title: string }).title).toBe('Renamed');
    expect(getPath(s.dataModel, '/proposal/tool')).toBe('add_challenge');
  });

  it('add_challenge card exposes an editable AI-check field bound to /proposal/validationPrompt', () => {
    const withCheck: CopilotAction = {
      tool: 'add_challenge',
      proposal: { title: 'Spot the red', emoji: '🔴', points: 20, description: '', validationPrompt: 'Someone wearing red' },
    };
    const s = applySurfaceMessages({}, buildProposalSurface(withCheck, 'pc'))!.pc;
    assertReducerValid(s);
    expect(getPath(s.dataModel, '/proposal/validationPrompt')).toBe('Someone wearing red');
    // The confirm resolves an EDITED validationPrompt.
    const ev = (s.components.confirmBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    const edited = { ...s, dataModel: { proposal: { ...(s.dataModel as { proposal: object }).proposal, validationPrompt: 'A dog is visible' } } };
    const ctx = resolveContext(ev.context, edited.dataModel);
    expect((ctx.proposal as { validationPrompt: string }).validationPrompt).toBe('A dog is visible');
  });

  it('delete card carries a warning and a cancel path', () => {
    const surfaces = applySurfaceMessages(
      {},
      buildProposalSurface({ tool: 'delete_challenge', proposal: { challengeId: 'ch-1' } }, 'p2'),
    );
    const s = surfaces.p2;
    expect(String(s.components.warning.text)).toMatch(/permanently/i);
    expect((s.components.cancelBtn.action as { event: { name: string } }).event.name).toBe('cancel_action');
  });

  it('names the challenge a delete targets — the uuid alone told the host nothing', () => {
    const row = { id: 'ch-1', title: 'Dunk pose', emoji: '🏀', points: 20 };
    const s = applySurfaceMessages(
      {},
      buildProposalSurface({ tool: 'delete_challenge', proposal: { challengeId: 'ch-1' } }, 'pd', row),
    ).pd;
    assertReducerValid(s);
    expect(s.components.target.text).toBe('🏀 Dunk pose · 20 pts');
    // The id stays, demoted to a caption — the executor still keys on it.
    expect(s.components.targetId.variant).toBe('caption');
    expect(s.components.targetId.text).toEqual({ path: '/proposal/challengeId' });
  });

  it('falls back to the id alone when no snapshot row was found', () => {
    const s = applySurfaceMessages(
      {},
      buildProposalSurface({ tool: 'delete_challenge', proposal: { challengeId: 'ch-1' } }, 'pn'),
    ).pn;
    assertReducerValid(s);
    expect(s.components.target).toBeUndefined();
    expect(s.components.targetId.text).toEqual({ path: '/proposal/challengeId' });
  });

  it('the EDIT card names the challenge WITHOUT its current points (the box holds the new one)', () => {
    const row = { id: 'ch-1', title: 'Dunk pose', emoji: '🏀', points: 20 };
    const s = applySurfaceMessages(
      {},
      buildProposalSurface({ tool: 'update_challenge', proposal: { challengeId: 'ch-1', points: 30 } }, 'pu', row),
    ).pu;
    assertReducerValid(s);
    expect(s.components.target.text).toBe('🏀 Dunk pose');
    expect(String(s.components.target.text)).not.toContain('20 pts');
    expect(getPath(s.dataModel, '/proposal/points')).toBe(30);
  });

  it('returns no surface for read-only tools', () => {
    expect(buildProposalSurface({ tool: 'get_stats' }, 'p3')).toEqual([]);
    expect(buildProposalSurface({ tool: 'share_links' }, 'p4')).toEqual([]);
  });

  it('builds reducer-valid cards for the experience-building tools', () => {
    const cases: CopilotAction[] = [
      { tool: 'generate_frame', proposal: { prompt: 'gold border' } },
      { tool: 'set_filter', proposal: { shaderId: 'none' } },
      { tool: 'add_head_piece', proposal: { source: 'builtin', pieceId: 'royal-crown' } },
      { tool: 'add_head_piece', proposal: { source: 'generate', prompt: 'foam crown' } },
      { tool: 'set_default_experience', proposal: { experienceId: 'exp-1' } },
      { tool: 'go_live' },
    ];
    cases.forEach((a, i) => {
      const s = applySurfaceMessages({}, buildProposalSurface(a, `x${i}`))[`x${i}`];
      assertReducerValid(s);
    });
  });

  it('generate_frame card kicks off generation via confirm_action bound to /proposal', () => {
    const s = applySurfaceMessages({}, buildProposalSurface({ tool: 'generate_frame', proposal: { prompt: 'gold border' } }, 'g1')).g1;
    const ev = (s.components.genBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    expect(ev.name).toBe('confirm_action');
    const edited = { ...s, dataModel: { proposal: { tool: 'generate_frame', prompt: 'art deco silver' } } };
    const ctx = resolveContext(ev.context, edited.dataModel);
    expect((ctx.proposal as { prompt: string; tool: string })).toMatchObject({ tool: 'generate_frame', prompt: 'art deco silver' });
  });

  it('generate_frame card offers a provider picker, defaulting to the platform path', () => {
    const s = applySurfaceMessages({}, buildProposalSurface({ tool: 'generate_frame', proposal: { prompt: 'gold border' } }, 'gp')).gp;
    assertReducerValid(s);
    const picker = s.components.providerPicker;
    expect(picker.component).toBe('ChoicePicker');
    expect(picker.value).toEqual({ path: '/proposal/provider' });
    expect(picker.options).toEqual([
      { label: 'Beamwall AI (1 credit)', value: 'gemini' },
      { label: 'Higgsfield (2 credits · or your connected account)', value: 'higgsfield' },
    ]);
    // Seeded even when the agent named no provider, so the picker has a
    // selection and the confirm payload always says which one.
    expect(getPath(s.dataModel, '/proposal/provider')).toBe('gemini');
  });

  it('seeds the picker with the provider the agent proposed and carries a host edit through confirm', () => {
    const s = applySurfaceMessages({}, buildProposalSurface(
      { tool: 'generate_frame', proposal: { prompt: 'gold border', provider: 'higgsfield' } }, 'gp2',
    )).gp2;
    expect(getPath(s.dataModel, '/proposal/provider')).toBe('higgsfield');
    const ev = (s.components.genBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    const edited = { proposal: { ...(getPath(s.dataModel, '/proposal') as object), provider: 'gemini' } };
    const ctx = resolveContext(ev.context, edited);
    expect((ctx.proposal as { provider: string }).provider).toBe('gemini');
  });
});

/**
 * CONTRACT: CopilotChat re-validates on confirm by feeding the surface's
 * `/proposal` data model back through normalizeActions([proposal], snapshot).
 * That silently depends on buildProposalSurface emitting the exact flat
 * `{ tool, ...args }` shape normalizeActions reads. This test locks that
 * round-trip so a future surface refactor (e.g. re-nesting `proposal`) can't
 * break every confirm with no failing test.
 */
describe('proposal round-trip: surface /proposal survives normalizeActions', () => {
  const filterId = FILTER_SHADERS.find((s) => s.id !== 'none')!.id;
  const snap = {
    eventUuid: 'u-1', slug: 'e', name: 'E', status: 'draft', planTier: 'free', eventType: 'party',
    failed: false, postCount: 0, showChallenges: true,
    challenges: [{ id: 'ch-1', title: 'C', emoji: '⭐', points: 10, active: true }],
    experiences: [{ id: 'exp-1', name: 'Frame', kind: 'border', published: true }],
    cards: [],
  } satisfies EventSnapshot;

  const cases: CopilotAction[] = [
    { tool: 'add_challenge', proposal: { title: 'Best pose', emoji: '🏆', points: 20, description: '', validationPrompt: 'Someone jumping' } },
    { tool: 'add_frame', proposal: { borderId: 'dw-frame-classic' } },
    { tool: 'set_filter', proposal: { shaderId: filterId } },
    { tool: 'set_event_date', proposal: { date: '2026-09-12' } },
    { tool: 'rename_event', proposal: { name: 'Renamed' } },
    { tool: 'set_default_experience', proposal: { experienceId: 'exp-1' } },
    { tool: 'go_live' },
  ];

  cases.forEach((action) => {
    it(`${action.tool} confirm re-validates to the same tool`, () => {
      const s = applySurfaceMessages({}, buildProposalSurface(action, 'r'))!.r;
      const proposal = getPath(s.dataModel, '/proposal');
      const [revalidated] = normalizeActions([proposal], snap);
      expect(revalidated, `${action.tool} was dropped by re-validation`).toBeDefined();
      expect(revalidated.tool).toBe(action.tool);
    });
  });

  it('preserves the edited validationPrompt through the round-trip', () => {
    const s = applySurfaceMessages({}, buildProposalSurface(
      { tool: 'add_challenge', proposal: { title: 'x', emoji: '⭐', points: 5, description: '', validationPrompt: 'red' } }, 'r2',
    ))!.r2;
    // simulate a host edit of the field, then confirm
    const edited = { proposal: { ...(getPath(s.dataModel, '/proposal') as object), validationPrompt: 'a balloon is visible' } };
    const [act] = normalizeActions([edited.proposal], snap);
    expect((act as { proposal: { validationPrompt?: string } }).proposal.validationPrompt).toBe('a balloon is visible');
  });
});

describe('generation two-phase surfaces', () => {
  it('frame preview resolves experienceId + transform on apply_generated', () => {
    const s = applySurfaceMessages({}, buildFramePreviewSurface('f1', { experienceId: 'exp-9', assetUrl: 'https://x/a.png' })).f1;
    assertReducerValid(s);
    expect(getPath(s.dataModel, '/gen/assetUrl')).toBe('https://x/a.png');
    const ev = (s.components.applyBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    expect(ev.name).toBe('apply_generated');
    const ctx = resolveContext(ev.context, s.dataModel);
    expect(ctx.kind).toBe('frame');
    expect(ctx.experienceId).toBe('exp-9');
    expect(ctx.transform).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('3D preview omits the thumbnail when there is none and still applies', () => {
    const withThumb = applySurfaceMessages({}, buildHeadPiecePreviewSurface('h1', { experienceId: 'e1', thumbUrl: 'https://x/t.png', label: 'Foam crown' })).h1;
    assertReducerValid(withThumb);
    expect(withThumb.components.thumb?.component).toBe('Image');
    const noThumb = applySurfaceMessages({}, buildHeadPiecePreviewSurface('h2', { experienceId: 'e1', thumbUrl: null, label: 'Foam crown' })).h2;
    assertReducerValid(noThumb);
    expect(noThumb.components.thumb).toBeUndefined();
    const ev = (noThumb.components.applyBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    expect(resolveContext(ev.context, noThumb.dataModel)).toMatchObject({ kind: 'headpiece', experienceId: 'e1' });
  });

  it('preview cards carry the host’s tweak note on regenerate (frame + 3D)', () => {
    // Without this the Regenerate button re-ran the IDENTICAL stored prompt, so
    // "make it warmer" was impossible — the host could only re-roll the dice.
    const frame = applySurfaceMessages({}, buildFramePreviewSurface('f2', { experienceId: 'exp-1', assetUrl: 'https://x/a.png' })).f2;
    assertReducerValid(frame);
    expect(frame.components.tweakField.component).toBe('TextField');
    const edited = { ...frame, dataModel: setPath(frame.dataModel, '/gen/feedback', 'warmer gold, thinner border') as Record<string, unknown> };
    const ev = (frame.components.regenBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    expect(ev.name).toBe('regenerate_generated');
    expect(resolveContext(ev.context, edited.dataModel)).toMatchObject({ kind: 'frame', feedback: 'warmer gold, thinner border' });
    // An untouched field resolves to the empty string, never undefined.
    expect(resolveContext(ev.context, frame.dataModel).feedback).toBe('');

    const piece = applySurfaceMessages({}, buildHeadPiecePreviewSurface('h3', { experienceId: 'e2', thumbUrl: null, label: 'Foam crown' })).h3;
    assertReducerValid(piece);
    expect(piece.components.tweakField.component).toBe('TextField');
    const pieceEv = (piece.components.regenBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    const pieceModel = setPath(piece.dataModel, '/gen/feedback', 'taller, more jewels') as Record<string, unknown>;
    expect(resolveContext(pieceEv.context, pieceModel)).toMatchObject({ kind: 'headpiece', feedback: 'taller, more jewels' });
  });

  it('error surface shows retry only when retryable', () => {
    const retry = applySurfaceMessages({}, buildGenErrorSurface('e1', 'Out of credits', { kind: 'frame', retryable: true })).e1;
    assertReducerValid(retry);
    expect(retry.components.retryBtn).toBeDefined();
    const noRetry = applySurfaceMessages({}, buildGenErrorSurface('e2', 'nope', { kind: 'frame', retryable: false })).e2;
    expect(noRetry.components.retryBtn).toBeUndefined();
  });
});

describe('test + checklist surfaces', () => {
  it('booth-test shows a go-live CTA in draft, not when live', () => {
    const draft = applySurfaceMessages({}, buildBoothTestSurface('t1', { slug: 'gala', status: 'draft', boothUrl: 'https://x/e/gala/booth' })).t1;
    assertReducerValid(draft);
    expect(draft.components.test.component).toBe('BoothTest');
    expect(draft.components.goLiveBtn).toBeDefined();
    const goLive = (draft.components.goLiveBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    // It OPENS the go-live confirm card — it must never fire the mutation
    // itself, which is what skipped the "anyone with the link can post" warning.
    expect(goLive.name).toBe('open_go_live_card');
    expect(goLive.name).not.toBe('confirm_action');
    expect(goLive.context.proposal).toBeUndefined();

    const live = applySurfaceMessages({}, buildBoothTestSurface('t2', { slug: 'gala', status: 'live', boothUrl: 'https://x/e/gala/booth' })).t2;
    expect(live.components.goLiveBtn).toBeUndefined();
  });

  it('checklist renders a ✓/○ row per item', () => {
    const s = applySurfaceMessages({}, buildChecklistSurface('c9', [
      { label: 'Add a frame', done: true },
      { label: 'Go live', done: false },
    ])).c9;
    assertReducerValid(s);
    expect(String(s.components.chk0.text)).toMatch(/^✓/);
    expect(String(s.components.chk1.text)).toMatch(/^○/);
  });
});

describe('result/readonly surfaces', () => {
  it('card-link surface exposes QR + copy + open bound to the card urls', () => {
    const surfaces = applySurfaceMessages({}, buildCardLinkSurface(
      { title: 'For Grandma', contributeUrl: 'https://x/c/ab/contribute?t=tok', viewerUrl: 'https://x/c/ab' },
      'c1',
    ));
    const s = surfaces.c1;
    expect(getPath(s.dataModel, '/card/contributeUrl')).toContain('contribute');
    const copy = (s.components.copyBtn.action as { functionCall: { call: string } }).functionCall;
    expect(copy.call).toBe('copyToClipboard');
  });

  it('stats and links surfaces render one node per item', () => {
    const stats = applySurfaceMessages({}, buildStatsSurface(
      [{ label: 'Posts', value: 42 }, { label: 'Challenges', value: 3 }], 's1',
    )).s1;
    expect(stats.components.stat0.value).toBe('42');
    expect(stats.components.stat1.component).toBe('EventStat');

    const links = applySurfaceMessages({}, buildLinksSurface(
      [{ title: 'Booth', url: 'https://x/e/a/booth' }, { title: 'Wall', url: 'https://x/e/a/wall' }], 'l1',
    )).l1;
    expect(links.components.qr0.component).toBe('QrCode');
    expect(links.components.qr1.value).toBe('https://x/e/a/wall');
  });
});

describe('handoff surfaces (open_scene_director / contact_support)', () => {
  it('scene-director card: editable brief bound to /proposal/brief, standard confirm_action', () => {
    const msgs = buildHandoffSurface({ tool: 'open_scene_director', proposal: { brief: 'a jungle at dusk' } }, 'h1');
    const s = applySurfaceMessages({}, msgs).h1;
    assertReducerValid(s);
    expect(String(s.components.heading.text)).toBe('Open the Scene Director');
    expect(s.components.textField).toMatchObject({ component: 'TextField', value: { path: '/proposal/brief' } });
    const confirm = s.components.confirmBtn as unknown as { action: { event: { name: string; context: unknown } } };
    expect(confirm.action.event.name).toBe('confirm_action');
    const edited = setPath(s.dataModel, '/proposal/brief', 'a moonlit jungle, emerald and brass');
    const ctx = resolveContext(confirm.action.event.context as Record<string, unknown>, edited) as { proposal: Record<string, unknown> };
    expect(ctx.proposal).toEqual({ tool: 'open_scene_director', brief: 'a moonlit jungle, emerald and brass' });
    expect(s.components.cancelBtn !== undefined).toBe(true);
  });

  it('support card: editable summary bound to /proposal/summary', () => {
    const s = applySurfaceMessages({}, buildHandoffSurface({ tool: 'contact_support', proposal: { summary: 'it failed twice' } }, 'h2')).h2;
    assertReducerValid(s);
    expect(String(s.components.heading.text)).toBe('Contact support');
    expect(s.components.textField).toMatchObject({ value: { path: '/proposal/summary' } });
    expect(getPath(s.dataModel, '/proposal/summary')).toBe('it failed twice');
  });

  it('buildProposalSurface routes both handoff tools to the handoff card, and they round-trip', () => {
    for (const action of [
      { tool: 'open_scene_director', proposal: { brief: 'a jungle at dusk' } },
      { tool: 'contact_support', proposal: { summary: 'it failed twice' } },
    ] as CopilotAction[]) {
      const msgs = buildProposalSurface(action, 'r');
      expect(msgs).toEqual(buildHandoffSurface(action as Extract<CopilotAction, { tool: 'open_scene_director' | 'contact_support' }>, 'r'));
      const s = applySurfaceMessages({}, msgs).r;
      const [re] = normalizeActions([getPath(s.dataModel, '/proposal')], null);
      expect(re.tool).toBe(action.tool);
    }
  });

  it('every confirm card heading is the registry label', () => {
    const s = applySurfaceMessages({}, buildProposalSurface({ tool: 'rename_event', proposal: { name: 'X' } }, 'l')).l;
    expect(String(s.components.heading.text)).toBe(COPILOT_TOOLS.rename_event.label);
  });
});

/* ── Wave A+B: templated pack card, Diff/ThumbPicker producers, bundles ── */

const ctxSnap = {
  eventUuid: 'u-1', slug: 'e', name: 'Old name', status: 'draft', planTier: 'free', eventType: 'party',
  failed: false, postCount: 0, showChallenges: true, startsAt: null, defaultExperienceId: 'exp-1',
  challenges: [{ id: 'ch-1', title: 'Dunk pose', emoji: '🏀', points: 20, active: true }],
  experiences: [{ id: 'exp-1', name: 'Gold frame', kind: 'border', published: true }, { id: 'exp-2', name: 'Neon', kind: 'shader', published: true }],
  cards: [],
  brief: { occasion: 'gala', honorees: ['Ada'], palette: 'gold', tone: '', avoid: ['balloons'], notes: '', updatedAt: null },
} satisfies EventSnapshot;

describe('add_challenge_pack — templated list with per-row include/title', () => {
  const pack: CopilotAction = {
    tool: 'add_challenge_pack',
    proposal: { theme: 'T', packId: 'party', challenges: [
      { title: 'A', emoji: '🅰️', points: 10, description: '' },
      { title: 'B', emoji: '🅱️', points: 20, description: 'b' },
    ] },
  };

  it('renders ONE row template over /proposal/challenges with relative bindings, every row include:true', () => {
    const s = assertResolvable(buildProposalSurface(pack, 'pk'));
    expect(s.components.packList).toEqual({ id: 'packList', component: 'List', children: { path: '/proposal/challenges', componentId: 'packRow' } });
    expect(s.components.packInclude).toMatchObject({ component: 'CheckBox', label: { path: 'emoji' }, value: { path: 'include' } });
    expect(s.components.packRowTitle).toMatchObject({ component: 'TextField', value: { path: 'title' } });
    expect(s.components.packPoints).toMatchObject({ component: 'Text', text: { path: 'points' } });
    expect(getPath(s.dataModel, '/proposal/challenges')).toEqual([
      { title: 'A', emoji: '🅰️', points: 10, description: '', include: true },
      { title: 'B', emoji: '🅱️', points: 20, description: 'b', include: true },
    ]);
    expect(getPath(s.dataModel, '/proposal/packId')).toBe('party');
    expect(String(s.components.confirmLabel.text)).toBe('Add selected');
    // relative bindings resolve per item scope, exactly as the renderer scopes them
    const base = resolveBindingPath('/proposal/challenges', '');
    expect(resolveDynamic({ path: 'emoji' }, s.dataModel, `${base}/1`)).toBe('🅱️');
    expect(resolveBindingPath('include', `${base}/1`)).toBe('/proposal/challenges/1/include');
  });

  it('an untick flows through confirm → applyIncludeFlags → normalizeActions as a dropped row', () => {
    const s = assertResolvable(buildProposalSurface(pack, 'pk'));
    const edited = setPath(setPath(s.dataModel, '/proposal/challenges/0/include', false), '/proposal/challenges/1/title', 'B renamed');
    const ev = (s.components.confirmBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    expect(ev.name).toBe('confirm_action');
    const proposal = resolveContext(ev.context, edited).proposal as Record<string, unknown>;
    const [out] = normalizeActions([applyIncludeFlags(proposal)], ctxSnap);
    expect(out).toEqual({ tool: 'add_challenge_pack', proposal: { theme: 'T', packId: 'party', challenges: [{ title: 'B renamed', emoji: '🅱️', points: 20, description: 'b' }] } });
  });
});

describe('ThumbPicker producers', () => {
  it('add_frame offers every generic frame as a frameId tile bound to /proposal/borderId', () => {
    const s = assertResolvable(buildProposalSurface({ tool: 'add_frame', proposal: { borderId: GENERIC_FRAMES[0].id } }, 'f'));
    expect(s.components.picker).toMatchObject({ component: 'ThumbPicker', value: { path: '/proposal/borderId' } });
    expect(s.components.picker.options).toEqual(GENERIC_FRAMES.map((f) => ({ value: f.id, label: f.name, frameId: f.id })));
  });

  it('builtin add_head_piece offers emoji tiles for every catalog piece', () => {
    const s = assertResolvable(buildProposalSurface({ tool: 'add_head_piece', proposal: { source: 'builtin', pieceId: HEAD_PIECES[0].id } }, 'h'));
    const options = s.components.picker.options as { value: string; label: string; emoji: string }[];
    expect(s.components.picker.component).toBe('ThumbPicker');
    expect(options.map((o) => o.value)).toEqual(HEAD_PIECES.map((p) => p.id));
    for (const o of options) expect(o.emoji.length, o.value).toBeGreaterThan(0);
  });
});

describe('Diff producers (need a ProposalContext snapshot; absent → the old id-only card)', () => {
  const diffOf = (s: SurfaceState) => s.components.diff?.rows as { label: string; before: string; after: unknown }[] | undefined;

  it('rename_event shows Old name → the live /proposal/name binding, then a Divider', () => {
    const s = assertResolvable(buildProposalSurface({ tool: 'rename_event', proposal: { name: 'New' } }, 'r', null, { snapshot: ctxSnap }));
    expect(diffOf(s)).toEqual([{ label: 'Name', before: 'Old name', after: { path: '/proposal/name' } }]);
    expect(s.components.diffDivider.component).toBe('Divider');
    expect((s.components.body.children as string[]).indexOf('diff')).toBeLessThan((s.components.body.children as string[]).indexOf('nameField'));
    expect(diffOf(assertResolvable(buildProposalSurface({ tool: 'rename_event', proposal: { name: 'New' } }, 'r2')))).toBeUndefined();
  });

  it('set_event_date reads "not set" from a null startsAt', () => {
    const s = assertResolvable(buildProposalSurface({ tool: 'set_event_date', proposal: { date: '2026-07-12' } }, 'd', null, { snapshot: ctxSnap }));
    expect(diffOf(s)).toEqual([{ label: 'Date', before: 'not set', after: { path: '/proposal/date' } }]);
  });

  it('update_challenge diffs only the proposed fields against the snapshot row', () => {
    const s = assertResolvable(buildProposalSurface(
      { tool: 'update_challenge', proposal: { challengeId: 'ch-1', points: 30, active: false } }, 'u',
      { id: 'ch-1', title: 'Dunk pose', emoji: '🏀', points: 20 }, { snapshot: ctxSnap },
    ));
    expect(diffOf(s)).toEqual([
      { label: 'Points', before: '20', after: { path: '/proposal/points' } },
      { label: 'Status', before: 'Active', after: 'Paused' },
    ]);
  });

  it('set_default_experience and set_filter name the current booth default', () => {
    const d = assertResolvable(buildProposalSurface({ tool: 'set_default_experience', proposal: { experienceId: 'exp-2' } }, 'sd', null, { snapshot: ctxSnap }));
    expect(diffOf(d)).toEqual([{ label: 'Booth default', before: 'Gold frame', after: 'Neon' }]);
    const f = assertResolvable(buildProposalSurface({ tool: 'set_filter', proposal: { shaderId: FILTER_SHADERS[1].id } }, 'sf', null, { snapshot: ctxSnap }));
    expect(diffOf(f)).toEqual([{ label: 'Booth default', before: 'Gold frame', after: { path: '/proposal/shaderId' } }]);
    const none = assertResolvable(buildProposalSurface({ tool: 'set_default_experience', proposal: { experienceId: 'exp-2' } }, 'sd2', null, { snapshot: { ...ctxSnap, defaultExperienceId: null } }));
    expect(diffOf(none)![0].before).toBe('none');
  });

  it('update_brief diffs each proposed field against the snapshot brief and edits only those fields', () => {
    const s = assertResolvable(buildProposalSurface({ tool: 'update_brief', proposal: { palette: 'navy', avoid: 'puns' } }, 'b', null, { snapshot: ctxSnap }));
    expect(diffOf(s)).toEqual([
      { label: 'Palette', before: 'gold', after: { path: '/proposal/palette' } },
      { label: 'Avoid', before: 'balloons', after: { path: '/proposal/avoid' } },
    ]);
    expect(s.components.paletteField).toMatchObject({ component: 'TextField', value: { path: '/proposal/palette' } });
    expect(s.components.occasionField).toBeUndefined();
    expect(String(s.components.heading.text)).toContain(COPILOT_TOOLS.update_brief.label);
    const bare = assertResolvable(buildProposalSurface({ tool: 'update_brief', proposal: { tone: 'loud' } }, 'b2'));
    expect(diffOf(bare)).toEqual([{ label: 'Tone', before: '—', after: { path: '/proposal/tone' } }]);
  });
});

describe('summarizeAction / isPaidAction — every registry tool', () => {
  for (const name of TOOL_NAMES) {
    it(`${name}: a non-empty line of at most 90 characters`, () => {
      const [action] = normalizeActions([{ tool: name, ...COPILOT_TOOLS[name].example }], ctxSnap);
      const line = summarizeAction(action, ctxSnap);
      expect(line.length).toBeGreaterThan(0);
      expect(line.length, line).toBeLessThanOrEqual(90);
      expect(line).not.toContain('\n');
      expect(isPaidAction(action)).toBe(name === 'generate_frame' || (name === 'add_head_piece' && COPILOT_TOOLS[name].example.source === 'generate'));
    });
  }

  it('names rows from the snapshot and clips long text', () => {
    expect(summarizeAction({ tool: 'delete_challenge', proposal: { challengeId: 'ch-1' } }, ctxSnap)).toBe('Delete challenge “Dunk pose”');
    expect(summarizeAction({ tool: 'delete_challenge', proposal: { challengeId: 'ch-9' } }, ctxSnap)).toBe('Delete challenge “ch-9”');
    expect(summarizeAction({ tool: 'update_challenge', proposal: { challengeId: 'ch-1', points: 30, active: false } }, ctxSnap)).toBe('Edit “Dunk pose”: 30 pts, pause');
    expect(summarizeAction({ tool: 'add_head_piece', proposal: { source: 'builtin', pieceId: 'royal-crown' } })).toBe('Add 3D prop “Royal Crown”');
    expect(summarizeAction({ tool: 'generate_frame', proposal: { prompt: 'x'.repeat(200) } }).length).toBeLessThanOrEqual(90);
    expect(summarizeAction({ tool: 'update_brief', proposal: { palette: 'a', tone: 'b' } })).toBe('Update the brief (palette, tone)');
  });
});

describe('buildBundleSurface / bundleStepsFor', () => {
  const actions: CopilotAction[] = [
    { tool: 'generate_frame', proposal: { prompt: 'art-deco brass sunburst, centre clear' } },
    { tool: 'add_challenge', proposal: { title: 'A', emoji: '⭐', points: 10, description: '' } },
    { tool: 'set_filter', proposal: { shaderId: FILTER_SHADERS[1].id } },
  ];

  it('orders free steps first and paid last (stable), all included, paid notes only on paid', () => {
    const steps = bundleStepsFor(actions, ctxSnap);
    expect(steps.map((s) => s.action.tool)).toEqual(['add_challenge', 'set_filter', 'generate_frame']);
    expect(steps.map((s) => s.paid)).toEqual([false, false, true]);
    expect(steps.every((s) => s.include)).toBe(true);
    expect(steps[0].paidNote).toBe('');
    expect(steps[2].paidNote).toMatch(/Spends credits/);
    expect(steps[2].summary).toBe(summarizeAction(actions[0], ctxSnap));
  });

  it('is one templated card whose confirm_bundle resolves the (edited) steps from the data model', () => {
    const steps = bundleStepsFor(actions, ctxSnap);
    const s = assertResolvable(buildBundleSurface(steps, 'bd'));
    expect(s.components.stepList).toEqual({ id: 'stepList', component: 'List', children: { path: '/bundle/steps', componentId: 'bundleRow' } });
    expect(s.components.bundleInclude).toMatchObject({ component: 'CheckBox', label: { path: 'summary' }, value: { path: 'include' } });
    expect(s.components.bundleNote).toMatchObject({ component: 'Text', text: { path: 'paidNote' } });
    expect(String(s.components.heading.text)).toBe('Set it up in 3 steps');
    const ev = (s.components.confirmBtn.action as { event: { name: string; context: Record<string, unknown> } }).event;
    expect(ev.name).toBe('confirm_bundle');
    const edited = setPath(s.dataModel, '/bundle/steps/1/include', false);
    const resolved = resolveContext(ev.context, edited).steps as { include: boolean; action: CopilotAction }[];
    expect(resolved.map((st) => st.include)).toEqual([true, false, true]);
    // actions live in the model as JSON → a refreshed page keeps a working card
    expect(JSON.parse(JSON.stringify(resolved[0].action))).toEqual(actions[1]);
    expect(normalizeActions([{ tool: resolved[2].action.tool, ...(resolved[2].action as { proposal: object }).proposal }], ctxSnap)).toHaveLength(1);
  });
});

describe('every proposal card is resolvable (templated lists included)', () => {
  for (const name of TOOL_NAMES) {
    if (!COPILOT_TOOLS[name].confirm) continue;
    it(name, () => {
      const [action] = normalizeActions([{ tool: name, ...COPILOT_TOOLS[name].example }], ctxSnap);
      assertResolvable(buildProposalSurface(action, 'x', null, { snapshot: ctxSnap }));
      assertResolvable(buildProposalSurface(action, 'y'));
    });
  }
});
