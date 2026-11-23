/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keepsake editor · Look tab: the theme (colours) and the reveal (the
 * tap-to-open moment). Two independent choices (lib/keepsakeSettings): the
 * pinned preview plays the chosen reveal in the chosen colours.
 */
import { Check, Gift, Images, Layers, Mail, Send, Sparkles, Theater, Zap, type LucideIcon } from 'lucide-react';
import { DEFAULT_KEEPSAKE_SETTINGS, KEEPSAKE_THEMES, keepsakeTheme, type KeepsakeRevealId, type KeepsakeSettings } from '../../../lib/keepsakeSettings';
import { KEEPSAKE_REVEAL_CHOICES, keepsakeRevealChoice } from '../../../lib/keepsakeEditor';

export const REVEAL_ICON: Record<KeepsakeRevealId, LucideIcon> = {
  beam: Zap,
  envelope: Mail,
  ribbon: Gift,
  curtain: Theater,
  airplane: Send,
  stardust: Sparkles,
  papercut: Layers,
  none: Images,
};

function DefaultBadge() {
  return <span className="inline-block rounded-md border border-accent/40 px-1 align-middle font-label uppercase tracking-luxe text-[10px] leading-4 text-accent-2">Default</span>;
}

export function LookPanel({ draft, onChange }: { draft: KeepsakeSettings; onChange: (fn: (s: KeepsakeSettings) => KeepsakeSettings) => void }) {
  const theme = keepsakeTheme(draft.theme);
  const reveal = keepsakeRevealChoice(draft.reveal);
  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2.5">
        <legend id="ks-theme-legend" className="mb-2.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/80">Colours</legend>
        <div role="radiogroup" aria-labelledby="ks-theme-legend" className="grid grid-cols-3 gap-2 @lg:grid-cols-5">
          {KEEPSAKE_THEMES.map((t) => {
            const p = t.palette;
            const selected = draft.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange((s) => ({ ...s, theme: t.id }))}
                className={`relative flex min-h-11 flex-col gap-1.5 rounded-2xl p-1.5 text-left transition ${selected ? 'glass-strong ring-2 ring-accent' : 'glass hover:ring-1 hover:ring-white/20'}`}
              >
                <span aria-hidden className="relative flex h-10 items-end gap-0.5 overflow-hidden rounded-xl p-1.5" style={{ background: `linear-gradient(135deg, ${p.surface}, ${p.background})` }}>
                  {[p.accent, p.glow, p.ink].map((c, i) => (
                    <span key={i} className="h-3 w-3 rounded-full border border-white/25" style={{ background: c }} />
                  ))}
                  {selected && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[color:var(--on-accent)]">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </span>
                <span className="px-0.5 font-sans text-xs leading-tight text-brand-fg">{t.label}</span>
              </button>
            );
          })}
        </div>
        <p className="font-sans text-xs leading-relaxed text-brand-muted/70" aria-live="polite">
          <span className="text-brand-fg">{theme.label}</span>{theme.id === DEFAULT_KEEPSAKE_SETTINGS.theme && <> <DefaultBadge /></>}. {theme.description}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <legend id="ks-reveal-legend" className="mb-1 font-label uppercase tracking-luxe text-[10px] text-brand-muted/80">Opening moment</legend>
        <p className="font-sans text-xs leading-relaxed text-brand-muted/60">What guests see when they tap their album link, before the photos.</p>
        <div role="radiogroup" aria-labelledby="ks-reveal-legend" className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
          {KEEPSAKE_REVEAL_CHOICES.map((c) => {
            const Icon = REVEAL_ICON[c.id];
            const selected = draft.reveal === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-describedby={selected ? 'ks-reveal-desc' : undefined}
                onClick={() => onChange((s) => ({ ...s, reveal: c.id }))}
                className={`flex min-h-11 items-center gap-2 rounded-2xl px-3 py-2 text-left transition ${selected ? 'glass-strong ring-2 ring-accent' : 'glass hover:ring-1 hover:ring-white/20'}`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-accent-2' : 'text-brand-muted/70'}`} aria-hidden />
                <span className="min-w-0 font-sans text-xs leading-tight text-brand-fg">{c.label}</span>
              </button>
            );
          })}
        </div>
        <p id="ks-reveal-desc" className="font-sans text-xs leading-relaxed text-brand-muted/70" aria-live="polite">
          <span className="text-brand-fg">{reveal.label}</span>{reveal.id === DEFAULT_KEEPSAKE_SETTINGS.reveal && <> <DefaultBadge /></>}. {reveal.description}
        </p>
      </fieldset>
    </div>
  );
}
