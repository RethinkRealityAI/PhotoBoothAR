import { describe, expect, it } from 'vitest';
import {
  BEAM_STYLE_TIMING,
  OPTIC_RED,
  beamPhaseAt,
  beamRegionId,
  estimateHandDepthCm,
  lightenTowardWhite,
  makeBeamSpec,
  resolveBeamColor,
  unprojectToDepth,
  type BeamAction,
} from './beam';
import type { AssetTemplate } from './assetTemplate';
import { BEAM_STYLES } from './triggers';

function template(regions: AssetTemplate['regions']): AssetTemplate {
  return {
    id: 't',
    name: 'T',
    glbUrl: '/models/t.glb',
    fitCm: 15,
    regions,
    textSlots: [],
    preparedBy: 'human',
  };
}

const LENS_TEMPLATE = template([
  { id: 'frame', label: 'Frame', recolourable: false, defaultHex: '#222222', refLuminance: 0.2 },
  { id: 'lens', label: 'Lens', recolourable: true, defaultHex: '#ff3b30', refLuminance: 0.3 },
]);

const beam = (over: Partial<BeamAction> = {}): BeamAction => ({
  type: 'beam',
  style: 'optic',
  ...over,
});

describe('timing envelope', () => {
  it('every style completes inside the 2.5s default trigger cooldown', () => {
    for (const style of BEAM_STYLES) {
      const t = BEAM_STYLE_TIMING[style];
      expect(t.chargeMs + t.fireMs + t.holdMs + t.fadeMs).toBeLessThanOrEqual(2500);
    }
  });
});

describe('beamRegionId', () => {
  it("prefers a region literally named 'lens'", () => {
    expect(beamRegionId(LENS_TEMPLATE)).toBe('lens');
  });
  it('falls back to the first recolourable region, then regions[0]', () => {
    const noLens = template([
      { id: 'a', label: 'A', recolourable: false, defaultHex: '#111111', refLuminance: 0.2 },
      { id: 'b', label: 'B', recolourable: true, defaultHex: '#222222', refLuminance: 0.2 },
    ]);
    expect(beamRegionId(noLens)).toBe('b');
    const locked = template([
      { id: 'a', label: 'A', recolourable: false, defaultHex: '#111111', refLuminance: 0.2 },
    ]);
    expect(beamRegionId(locked)).toBe('a');
    expect(beamRegionId(template([]))).toBeNull();
    expect(beamRegionId(null)).toBeNull();
  });
});

describe('resolveBeamColor', () => {
  it('explicit action hex wins over everything', () => {
    const c = resolveBeamColor(beam({ color: '#0F0' }), {
      template: LENS_TEMPLATE,
      customization: { parts: { lens: { hex: '#0000ff' } } },
    });
    expect(c).toBe('#00ff00');
  });
  it("'auto' reads the guest/host customized lens hex", () => {
    const c = resolveBeamColor(beam({ color: 'auto' }), {
      template: LENS_TEMPLATE,
      customization: { parts: { lens: { hex: '#00c853' } } },
    });
    expect(c).toBe('#00c853');
  });
  it('falls back to the authored region default, then OPTIC_RED', () => {
    expect(resolveBeamColor(beam(), { template: LENS_TEMPLATE })).toBe('#ff3b30');
    expect(resolveBeamColor(beam(), null)).toBe(OPTIC_RED);
    expect(resolveBeamColor(beam(), { template: template([]) })).toBe(OPTIC_RED);
  });
});

describe('makeBeamSpec', () => {
  it("resolves origin 'auto' by the firing gesture family", () => {
    expect(makeBeamSpec(beam(), null, true, 0).origin).toBe('hand');
    expect(makeBeamSpec(beam(), null, false, 0).origin).toBe('head');
    expect(makeBeamSpec(beam({ origin: 'head' }), null, true, 0).origin).toBe('head');
  });
  it('durationMs overrides hold, capped at 4s', () => {
    expect(makeBeamSpec(beam({ durationMs: 900 }), null, false, 0).holdMs).toBe(900);
    expect(makeBeamSpec(beam({ durationMs: 99999 }), null, false, 0).holdMs).toBe(4000);
    expect(makeBeamSpec(beam(), null, false, 0).holdMs).toBe(BEAM_STYLE_TIMING.optic.holdMs);
  });
  it('derives a near-white core from the beam colour', () => {
    const spec = makeBeamSpec(beam({ color: '#ff0000' }), null, false, 0);
    expect(spec.colorHex).toBe('#ff0000');
    expect(spec.coreHex).toBe(lightenTowardWhite('#ff0000', 0.82));
  });
});

describe('beamPhaseAt', () => {
  const spec = makeBeamSpec(beam(), null, false, 1000);
  it('charges from zero, erupts, holds, fades, ends', () => {
    expect(beamPhaseAt(spec, 1000)).toMatchObject({ phase: 'charge', intensity: 0, length01: 0 });
    const mid = beamPhaseAt(spec, 1000 + spec.chargeMs / 2);
    expect(mid.phase).toBe('charge');
    expect(mid.intensity).toBeGreaterThan(0);
    expect(mid.intensity).toBeLessThan(0.6);
    const erupt = beamPhaseAt(spec, 1000 + spec.chargeMs);
    expect(erupt.phase).toBe('fire');
    expect(erupt.flash).toBeCloseTo(1, 5);
    const held = beamPhaseAt(spec, 1000 + spec.chargeMs + spec.fireMs + 1);
    expect(held.phase).toBe('hold');
    expect(held.length01).toBe(1);
    const total = spec.chargeMs + spec.fireMs + spec.holdMs + spec.fadeMs;
    expect(beamPhaseAt(spec, 1000 + total + 1).phase).toBe('done');
    expect(beamPhaseAt(spec, 1000 + total + 1).intensity).toBe(0);
  });
  it('flash is confined to the eruption neighbourhood', () => {
    expect(beamPhaseAt(spec, 1000 + 10).flash).toBe(0);
    const fadeT = 1000 + spec.chargeMs + spec.fireMs + spec.holdMs + 1;
    expect(beamPhaseAt(spec, fadeT).flash).toBe(0);
  });
});

describe('unprojectToDepth', () => {
  it('maps frame centre to the optical axis', () => {
    const [x, y, z] = unprojectToDepth(0.5, 0.5, 100, 63, 9 / 16);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBe(-100);
  });
  it('maps the frame top edge to +Y = tan(fov/2)·depth', () => {
    const [, y] = unprojectToDepth(0.5, 0, 100, 63, 9 / 16);
    expect(y).toBeCloseTo(Math.tan((63 * Math.PI) / 360) * 100, 4);
  });
  it('scales X by aspect', () => {
    const [x] = unprojectToDepth(1, 0.5, 100, 63, 2);
    expect(x).toBeCloseTo(Math.tan((63 * Math.PI) / 360) * 100 * 2, 4);
  });
});

describe('estimateHandDepthCm', () => {
  it('recovers depth from palm span via the pinhole model', () => {
    // span of a 10cm palm at 60cm on a 63° camera
    const spanNorm = ((0.5 / Math.tan((63 * Math.PI) / 360)) * 10) / 60;
    expect(estimateHandDepthCm(spanNorm, null)).toBeCloseTo(60, 0);
  });
  it('falls back and clamps on degenerate spans', () => {
    expect(estimateHandDepthCm(0, null)).toBe(60);
    expect(estimateHandDepthCm(0, 80)).toBe(80);
    expect(estimateHandDepthCm(1e-9, null)).toBe(60);
    expect(estimateHandDepthCm(0.0001, null)).toBe(60); // <= guard boundary
    expect(estimateHandDepthCm(10, null)).toBe(25); // absurdly close hand → floor
  });
  it('clamps around the tracked head depth when available', () => {
    expect(estimateHandDepthCm(0.01, 60)).toBe(132); // 2.2 × headZ ceiling
    expect(estimateHandDepthCm(0.5, 60)).toBe(30); // 0.5 × headZ floor
  });
});
