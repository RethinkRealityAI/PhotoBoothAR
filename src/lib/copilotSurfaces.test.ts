import { describe, it, expect } from 'vitest';
import {
  buildProposalSurface, buildCardLinkSurface, buildStatsSurface, buildLinksSurface,
  buildFramePreviewSurface, buildHeadPiecePreviewSurface, buildGenErrorSurface,
  buildBoothTestSurface, buildChecklistSurface,
} from './copilotSurfaces';
import { applySurfaceMessages, getPath, resolveContext, type SurfaceState } from './a2ui';
import type { CopilotAction } from './copilot';

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

  it('delete card carries a warning and a cancel path', () => {
    const surfaces = applySurfaceMessages(
      {},
      buildProposalSurface({ tool: 'delete_challenge', proposal: { challengeId: 'ch-1' } }, 'p2'),
    );
    const s = surfaces.p2;
    expect(String(s.components.warning.text)).toMatch(/permanently/i);
    expect((s.components.cancelBtn.action as { event: { name: string } }).event.name).toBe('cancel_action');
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
    expect(goLive.name).toBe('confirm_action');
    expect((goLive.context.proposal as { tool: string }).tool).toBe('go_live');

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
