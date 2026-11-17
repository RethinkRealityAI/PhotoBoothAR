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
import { isGreenFamily, resolveRegisterKey, type FrameLayout } from './assetPrompt';

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

/**
 * Art-style sentence per preset — the mirrored table. STYLE ONLY: motifs, line
 * quality, material finish. No colour names: when the host (or the event) has
 * a palette, that palette is the colour authority, and a look that said
 * "antique-gold foil on ink-navy" painted navy-and-gold frames for a host who
 * picked red (seen in a real run). The preset's own colours live apart in
 * FRAME_PRESET_COLOURS and are used only when no palette is in play.
 * The green bans stay here: they hold whatever the palette is.
 */
export const FRAME_PRESET_STYLE: Record<FramePresetId, string> = {
  'botanical-watercolour':
    'loose botanical watercolour — peonies, ranunculus and trailing vines painted in soft washes with visible ' +
    'paper grain and fine pen outlines; foliage is never green',
  'art-deco-foil':
    'art-deco stationery — stepped geometric borders, sunburst fans and fine parallel rules in raised ' +
    'metallic foil on solid border panels, strictly symmetrical',
  'neon-night':
    'neon-sign night — bent glass tubes glowing with soft halation, mounted on dark brick border panels; ' +
    'no green or lime neon',
  'confetti-pop':
    'confetti pop — bold paper confetti, streamers and balloon clusters as flat graphic shapes with crisp edges ' +
    'and vivid colour',
  'minimal-line':
    'minimal line art — a single continuous fine metallic hairline with generous negative space, one small ' +
    'geometric accent per corner, gallery-card restraint',
  storybook:
    'storybook illustration — a whimsical hand-painted gouache world with rounded shapes, soft rim light and ' +
    'gentle texture; trees and grass are never green',
  'retro-70s':
    'retro 1970s — chunky rounded stripes and sunburst arcs with a slight risograph grain',
  'luxe-marble':
    'luxe marble — polished marble slabs with fine metallic veining and thin brushed-metal inlay bands, ' +
    'architectural; no green marble',
};

/** Each preset's OWN colours (mirrored, drift-tested) — appended to the style
 *  only when no host/event palette is in play. Plain colour names only, so a
 *  test can derive the colour vocabulary from this table. */
export const FRAME_PRESET_COLOURS: Record<FramePresetId, readonly string[]> = {
  'botanical-watercolour': ['blush', 'dusty rose', 'cream', 'gold'],
  'art-deco-foil': ['antique gold', 'ink navy'],
  'neon-night': ['hot magenta', 'electric blue', 'violet'],
  'confetti-pop': ['coral', 'sunshine yellow', 'cobalt', 'pink'],
  'minimal-line': [],
  storybook: ['plum', 'lavender', 'peach'],
  'retro-70s': ['burnt orange', 'mustard', 'rust', 'chocolate brown'],
  'luxe-marble': ['white Carrara', 'black Nero', 'gold'],
};

const listWords = (words: readonly string[]): string =>
  words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * The art-style sentence a prompt carries. `hasPalette` = a usable host/event
 * palette is the colour authority → STYLE ONLY; otherwise the preset's own
 * colours are appended. Mirror: ai-generate-image frameLayout `presetStyle`.
 */
export function presetArtStyle(id: FramePresetId, hasPalette: boolean): string {
  const own = FRAME_PRESET_COLOURS[id];
  return hasPalette || own.length === 0 ? FRAME_PRESET_STYLE[id] : `${FRAME_PRESET_STYLE[id]}, in ${listWords(own)}`;
}

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
export function composePresetPrompt(presetId: FramePresetId, extra: string, palette?: FramePalette | null): string {
  const extraClean = extra.trim();
  const hasPalette = !!palette && palette.hexes.length > 0;
  const style = presetArtStyle(presetId, hasPalette);
  // The event swatch carries hexes but no words — never a dangling ", in ".
  const words = hasPalette ? palette?.words ?? '' : '';
  const colours = words ? `${style}, in ${words}` : style;
  return extraClean ? `${colours}. ${extraClean}` : colours;
}

/* ── Palette swatches ─────────────────────────────────────────────────────
 * The first screen's colour choice. 'event' means "the event's own colours"
 * (the server already reads events.config.accentHexes, so nothing is sent);
 * every other swatch is sent as `palette` (hexes, for the art-direction layer)
 * AND spelled out in `prompt` (words, for the currently deployed server, which
 * ignores `palette`). No swatch may contain a green-family colour — it would be
 * keyed out of the frame with the backdrop. */
export interface FramePalette {
  id: string;
  label: string;
  hexes: string[];
  /** How the colours read in a prompt. */
  words: string;
}

export const FRAME_PALETTES: readonly FramePalette[] = [
  { id: 'gilt', label: 'Gold & ink', hexes: ['#C9A24B', '#1E1A22', '#FBF7EF'], words: 'antique gold, ink black and ivory' },
  { id: 'blush', label: 'Blush', hexes: ['#E8B4B8', '#B08D57', '#FFF8F2'], words: 'blush pink, champagne gold and cream' },
  { id: 'jewel', label: 'Jewel', hexes: ['#1F3A68', '#7A1F3D', '#D4AF37'], words: 'sapphire navy, garnet red and gold' },
  { id: 'sorbet', label: 'Sorbet', hexes: ['#FF8FA3', '#FFC15E', '#7EC8E3'], words: 'watermelon pink, mango and sky blue' },
  { id: 'mono', label: 'Black & white', hexes: ['#111111', '#F5F5F5', '#9A9A9A'], words: 'black, white and soft grey' },
];

export function framePaletteById(id: string | null | undefined): FramePalette | null {
  return FRAME_PALETTES.find((p) => p.id === id) ?? null;
}

/** The event's own colours as a swatch, or null when it has none usable. */
export function eventPalette(accentHexes: readonly string[] | null | undefined): FramePalette | null {
  const hexes = (accentHexes ?? []).filter((h) => /^#[0-9a-fA-F]{6}$/.test(h) && !isGreenFamily(h)).slice(0, 3);
  return hexes.length > 0 ? { id: 'event', label: 'Your colours', hexes, words: '' } : null;
}

/**
 * The honest line for a host whose colours lost a green to the cut-out key
 * (eventPalette above and the server's framePalette both drop green-family
 * hexes: green is the chroma key, so green art would be punched out). Null
 * when nothing was dropped — including a green that sat past the first three
 * usable colours, which the 3-colour cap would never have used anyway.
 * The keying itself is unchanged; this only says what it did.
 */
export function eventPaletteGreenNote(accentHexes: readonly string[] | null | undefined): string | null {
  const valid = (accentHexes ?? []).filter((h) => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h));
  if (!valid.slice(0, 3).some((h) => isGreenFamily(h))) return null;
  return eventPalette(accentHexes) !== null
    ? 'Green is used to cut the photo window, so this frame uses your other colours.'
    : 'Green is used to cut the photo window, so your colour can’t go in this frame — pick one of these colours instead.';
}
