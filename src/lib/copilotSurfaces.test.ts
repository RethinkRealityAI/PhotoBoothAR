import { describe, it, expect } from 'vitest';
import {
  buildProposalSurface, buildCardLinkSurface, buildStatsSurface, buildLinksSurface,
} from './copilotSurfaces';
import { applySurfaceMessages, getPath, resolveContext } from './a2ui';
import type { CopilotAction } from './copilot';

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
