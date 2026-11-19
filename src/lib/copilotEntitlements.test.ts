import { describe, it, expect } from 'vitest';
import {
  ALL_ENTITLED, buildLockedSurface, entitlementContextLine, frameBriefFromPropPrompt, hostEntitlementsFrom,
  lockFor, lockedResult, LOCKED_CODE,
} from './copilotEntitlements';
import { formatToolResult, type CopilotAction } from './copilot';
import { ENTITLEMENTS } from './plans';
import { normalizeResolvedFeatures } from './features';

const FREE_NO_STUDIO = hostEntitlementsFrom({ features: { ...ENTITLEMENTS.free, studio: false }, studio: false });
// Free records video since 2026-11-19; the photo-only path is still reachable
// through a videoEnabled=false override, so it keeps its own fixture.
const NO_VIDEO = hostEntitlementsFrom({ features: { ...ENTITLEMENTS.free, videoEnabled: false, studio: false }, studio: false });

const gen3d: CopilotAction = { tool: 'add_head_piece', proposal: { source: 'generate', prompt: 'a Santa hat' } };
const builtin: CopilotAction = { tool: 'add_head_piece', proposal: { source: 'builtin', pieceId: 'royal-crown' } };
const director: CopilotAction = { tool: 'open_scene_director', proposal: { brief: 'cosy Christmas look' } };
const frame: CopilotAction = { tool: 'generate_frame', proposal: { prompt: 'snowy pines' } };

describe('hostEntitlementsFrom', () => {
  it('a brand-new free host without the Studio add-on can neither generate 3D nor open the Director', () => {
    expect(FREE_NO_STUDIO).toEqual({ studio: false, ai3d: false, aiFrames: false, video: true });
    expect(NO_VIDEO).toEqual({ studio: false, ai3d: false, aiFrames: false, video: false });
  });

  it('fails OPEN on an unknown answer (not read yet / resolver failed)', () => {
    expect(hostEntitlementsFrom(null)).toEqual(ALL_ENTITLED);
    expect(hostEntitlementsFrom({ features: null, studio: true })).toEqual(ALL_ENTITLED);
  });

  it('3D needs BOTH aiStudio and studio — the same two checks ai-generate-3d makes', () => {
    const paidNoStudio = hostEntitlementsFrom({ features: { ...ENTITLEMENTS.premium, studio: false }, studio: false });
    expect(paidNoStudio.ai3d).toBe(false);
    expect(paidNoStudio.aiFrames).toBe(true);
    const both = hostEntitlementsFrom({ features: { ...ENTITLEMENTS.premium, studio: true }, studio: true });
    expect(both.ai3d).toBe(true);
    expect(both.studio).toBe(true);
  });

  it('a resolver answer WITHOUT the studio key (pre-rollout) keeps 3D for a paid host', () => {
    const f = normalizeResolvedFeatures({ ...ENTITLEMENTS.premium, studio: undefined });
    expect(hostEntitlementsFrom({ features: f, studio: true }).ai3d).toBe(true);
  });

  it('a platform admin keeps the Studio, but 3D follows the raw resolver (the server does not exempt admins)', () => {
    const e = hostEntitlementsFrom({ features: { ...ENTITLEMENTS.free, studio: false }, studio: true });
    expect(e.studio).toBe(true);
    expect(e.ai3d).toBe(false);
  });
});

describe('lockFor', () => {
  it('locks 3D generation and the Director for a free no-Studio host, nothing else', () => {
    expect(lockFor(gen3d, FREE_NO_STUDIO)).toBe('ai3d');
    expect(lockFor(director, FREE_NO_STUDIO)).toBe('studio');
    expect(lockFor(builtin, FREE_NO_STUDIO)).toBeNull(); // a library prop is free
    expect(lockFor(frame, FREE_NO_STUDIO)).toBeNull(); // 3 free AI frames per event
  });

  it('locks nothing when entitled or unknown', () => {
    for (const a of [gen3d, director, builtin, frame]) expect(lockFor(a, ALL_ENTITLED)).toBeNull();
  });
});

describe('lockedResult', () => {
  it('is a non-retryable machine-readable upgrade_required result', () => {
    const r = lockedResult('ai3d');
    expect(r).toMatchObject({ ok: false, code: 'upgrade_required', retryable: false });
    expect(LOCKED_CODE).toBe('upgrade_required');
    expect(formatToolResult('add_head_piece', r))
      .toMatch(/^\[tool_result\] tool=add_head_piece ok=false code=upgrade_required retryable=false — Not on this plan/);
    expect(r.summary).toContain('Nothing was generated or charged');
    expect(lockedResult('studio').summary).toContain('Scene Director');
    expect(lockedResult('studio').retryable).toBe(false);
  });
});

describe('entitlementContextLine', () => {
  it('is null when everything is available, so an entitled context is unchanged', () => {
    expect(entitlementContextLine(ALL_ENTITLED)).toBeNull();
  });

  it('names what is off and what to offer instead', () => {
    const line = entitlementContextLine(FREE_NO_STUDIO) ?? '';
    expect(line).toMatch(/^PLAN LIMITS: NOT available on this plan/);
    expect(line).toContain('add_head_piece with source "generate"');
    expect(line).toContain('open_scene_director');
    expect(line).toContain('Never propose or price these');
    expect(line).not.toContain('photos only'); // Free has video now
    expect(entitlementContextLine(NO_VIDEO) ?? '').toContain('photos only');
    expect(line).not.toContain('\n');
    expect(line).not.toMatch(/-{3,}/); // can never read as a fence marker
  });
});

describe('buildLockedSurface', () => {
  it('renders the honest heading, the two alternatives and a dismiss', () => {
    const msgs = buildLockedSurface('lock_1', 'ai3d', 'a Santa hat');
    const comps = msgs.find((m) => m.updateComponents)?.updateComponents?.components ?? [];
    const texts = comps.filter((c) => c.component === 'Text').map((c) => c.text);
    expect(texts).toContain('3D props are part of the Studio add-on');
    expect(texts).toContain('Pick a library prop');
    expect(texts).toContain('Make an AI frame');
    expect(texts).toContain('Dismiss');
    const model = msgs.find((m) => m.updateDataModel)?.updateDataModel?.value as { locked: { prompt: string } };
    expect(model.locked.prompt).toBe('a Santa hat');
    const alts = comps.filter((c) => (c.action as { event?: { name?: string } } | undefined)?.event?.name === 'open_locked_alt');
    expect(alts).toHaveLength(2);
  });

  it('names the Director for a studio lock', () => {
    const comps = buildLockedSurface('s', 'studio').find((m) => m.updateComponents)?.updateComponents?.components ?? [];
    expect(comps.some((c) => c.text === 'The Scene Director is part of the Studio add-on')).toBe(true);
  });
});

describe('frameBriefFromPropPrompt', () => {
  it('turns the prop idea into a frame brief, and has a default', () => {
    expect(frameBriefFromPropPrompt('a classic Santa hat.')).toBe(
      'A frame themed around a classic Santa hat — ornament hugging the edges, centre fully clear',
    );
    expect(frameBriefFromPropPrompt('  ')).toMatch(/^An elegant frame/);
  });
});
