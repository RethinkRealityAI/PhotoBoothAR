/**
 * framePresets — the guided "pick a look" step of AI frame generation.
 *
 * A non-designer host does not know what to type. A preset is a tested
 * art-style sentence (what a designer would brief) plus the layout it works
 * best in and an ADVISORY provider hint. PURE — no React, no supabase.
 *
 * The style strings are MIRRORED into supabase/functions/ai-generate-image/
 * frameLayout.ts (`FRAME_PRESET_STYLE`), where the server resolves a `preset`
 * id into the art-direction layer — outside the fenced host brief, because
 * this text is ours, not the host's. src/lib/assetPrompt.drift.test.ts goes
 * red if the two tables diverge.
 *
 * Every style names its colours away from green: green is the chroma-key
 * cut-out colour, so "botanical" or "neon" left to the model's defaults
 * would paint leaves and tubes that key out as holes.
 */
import { resolveRegisterKey, type FrameLayout } from './assetPrompt';

export type FramePresetId =
  | 'botanical-watercolour'
  | 'art-deco-foil'
  | 'neon-night'
  | 'confetti-pop'
  | 'minimal-line'
  | 'storybook'
  | 'retro-70s'
  | 'luxe-marble';

/** 'higgsfield' = a vector/typographic look where a Recraft-class model is
 *  stronger. ADVISORY ONLY — used only when the org already has Higgsfield
 *  configured; never a reason to switch an org that has not. */
export type ProviderHint = 'gemini' | 'higgsfield';

export interface FramePreset {
  id: FramePresetId;
  /** Host-facing chip label. */
  label: string;
  /** One short host-facing line under the chip. */
  blurb: string;
  layout: FrameLayout;
  providerHint: ProviderHint;
}

/** Art-style sentence per preset — the mirrored table. */
export const FRAME_PRESET_STYLE: Record<FramePresetId, string> = {
  'botanical-watercolour':
    'loose botanical watercolour — peonies, ranunculus and trailing vines painted in soft washes with visible ' +
    'paper grain and fine ink outlines; foliage is rendered in blush, dusty rose, cream and gold, never green',
  'art-deco-foil':
    'art-deco stationery — stepped geometric borders, sunburst fans and fine parallel rules in raised ' +
    'antique-gold foil on deep ink-navy border panels, strictly symmetrical',
  'neon-night':
    'neon-sign night — bent glass tubes glowing in hot magenta, electric blue and violet with soft halation, ' +
    'mounted on dark brick border panels; no green or lime neon',
  'confetti-pop':
    'confetti pop — bold paper confetti, streamers and balloon clusters in saturated coral, sunshine yellow, ' +
    'cobalt and pink, flat graphic shapes with crisp edges',
  'minimal-line':
    'minimal line art — a single continuous fine metallic hairline with generous negative space, one small ' +
    'geometric accent per corner, gallery-card restraint',
  storybook:
    'storybook illustration — a whimsical hand-painted gouache world with rounded shapes, soft rim light and ' +
    'gentle texture; trees and grass are painted in plum, lavender and peach, never green',
  'retro-70s':
    'retro 1970s — chunky rounded stripes and sunburst arcs in burnt orange, mustard, rust and chocolate brown ' +
    'with a slight risograph grain',
  'luxe-marble':
    'luxe marble — white Carrara and black Nero marble slabs with gold veining and thin brushed-gold inlay ' +
    'bands, polished and architectural; no green marble',
};

export const FRAME_PRESETS: readonly FramePreset[] = [
  { id: 'botanical-watercolour', label: 'Botanical watercolour', blurb: 'Soft painted florals', layout: 'classic-border', providerHint: 'gemini' },
  { id: 'art-deco-foil', label: 'Art-deco foil', blurb: 'Gold geometry, black tie', layout: 'classic-border', providerHint: 'higgsfield' },
  { id: 'neon-night', label: 'Neon night', blurb: 'Glowing signs after dark', layout: 'classic-border', providerHint: 'gemini' },
  { id: 'confetti-pop', label: 'Confetti pop', blurb: 'Bright and playful', layout: 'corner-overlay', providerHint: 'gemini' },
  { id: 'minimal-line', label: 'Minimal line', blurb: 'Clean, quiet, modern', layout: 'classic-border', providerHint: 'higgsfield' },
  { id: 'storybook', label: 'Storybook illustration', blurb: 'A painted little world', layout: 'full-scene', providerHint: 'gemini' },
  { id: 'retro-70s', label: 'Retro 70s', blurb: 'Warm stripes and sunbursts', layout: 'bottom-third', providerHint: 'gemini' },
  { id: 'luxe-marble', label: 'Luxe marble', blurb: 'Marble and gold inlay', layout: 'classic-border', providerHint: 'gemini' },
];

const BY_ID = new Map<string, FramePreset>(FRAME_PRESETS.map((p) => [p.id, p]));

export function framePresetById(id: string | null | undefined): FramePreset | null {
  return (id && BY_ID.get(id)) || null;
}

/** Register key (event_type values + occasion keys) → the preset pre-selected
 *  on the first screen. Unknown → 'minimal-line', the safest look. */
const DEFAULT_BY_REGISTER: Record<string, FramePresetId> = {
  wedding: 'botanical-watercolour',
  gala: 'art-deco-foil',
  birthday: 'confetti-pop',
  party: 'neon-night',
  corporate: 'minimal-line',
  conference: 'minimal-line',
  'baby-shower': 'storybook',
  graduation: 'art-deco-foil',
  quinceanera: 'luxe-marble',
  holiday: 'storybook',
  'brand-activation': 'minimal-line',
  sports: 'retro-70s',
};

export function defaultPresetFor(eventType?: string | null, occasion?: string | null): FramePresetId {
  const key = resolveRegisterKey(occasion, eventType);
  return (key && DEFAULT_BY_REGISTER[key]) || 'minimal-line';
}

/**
 * The provider to use for a preset. The hint only applies when the org has
 * Higgsfield available — otherwise the caller's current choice stands.
 */
export function providerForPreset(
  preset: FramePreset,
  current: ProviderHint,
  higgsfieldAvailable: boolean,
): ProviderHint {
  if (preset.providerHint === 'higgsfield' && higgsfieldAvailable) return 'higgsfield';
  return current;
}

/**
 * The brief the client sends as `prompt`. The CURRENTLY DEPLOYED server
 * ignores `preset`, so the style must also travel in the prompt to keep
 * working; a server that knows `preset` puts the style in the art-direction
 * layer and fences only `extra` (ai-generate-image index.ts), so the style is
 * never said twice.
 */
export function composePresetPrompt(presetId: FramePresetId, extra: string): string {
  const extraClean = extra.trim();
  const style = FRAME_PRESET_STYLE[presetId];
  return extraClean ? `${style}. ${extraClean}` : style;
}
